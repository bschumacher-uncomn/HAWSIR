import { encode, revive } from './json';
import type { Decision, Fact } from './engine';
import { HttpError, type MissionRuntime } from './mission';
import type { NodeRuntime } from './node';
import * as store from './pgstore';

/**
 * Ship ⇄ shore sync over the (simulated) data link, one exchange per mission.
 *
 *   ship ──push: facts and decisions it has not sent yet──▶ shore
 *   ship ◀──pull: shore facts it has not seen, filtered by the shore's sharing policy── shore
 *
 * The ship starts every exchange (an edge node dials out when it has a path).
 * Facts are merged by content id, so a report both sides already hold is never
 * duplicated, and nothing is overwritten. Each side stamps what it receives
 * with its own receipt time, so either side's picture "as of" a time shows only
 * what that side actually knew then. Decision logs are not merged: the shore
 * keeps a verified copy of each ship's log beside its own.
 */
export const SHARE_POLICY: { id: string; text: string; withhold: (f: Fact, ship: string, owner?: string) => boolean }[] = [
  {
    id: 'personnel-own-ship',
    text: "Personnel availability (sick in quarters, leave, TAD) is released only to the person's own ship.",
    withhold: (f, ship, owner) => f.attr === 'person_unavailable' && owner !== ship,
  },
];

export class SyncClient {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private lastError = new Map<string, string>();

  constructor(private readonly node: NodeRuntime, private readonly peer: string, private readonly token?: string) {}

  start(intervalMs: number): void {
    this.node.onLinkUp = () => void this.once();
    this.timer = setInterval(() => void this.once(), intervalMs);
    for (const m of this.node.missions.values()) void this.refreshPending(m);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', ...(this.token ? { 'x-sync-token': this.token } : {}) };
  }

  private async refreshPending(m: MissionRuntime): Promise<store.SyncRow> {
    const row = await store.getSync(this.node.pool, m.id, 'shore');
    const pending = m.log.all().filter((f) => f.seq > row.pushed_seq).length + m.decisions.all().filter((d) => d.seq > row.pushed_dec).length;
    m.syncInfo = { pending, last: row.last_ok_t !== null ? { t: row.last_ok_t, wall: row.last_ok_wall?.toISOString() ?? '' } : undefined };
    return row;
  }

  async once(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const m of this.node.missions.values()) await this.exchange(m);
    } finally {
      this.busy = false;
    }
  }

  private async exchange(m: MissionRuntime): Promise<void> {
    await m.deliverDue();
    if (!this.node.link.up) {
      await this.refreshPending(m);
      return;
    }
    try {
      const row = await this.refreshPending(m);
      const facts = m.log.all().filter((f) => f.seq > row.pushed_seq);
      const decisions = m.decisions.all().filter((d) => d.seq > row.pushed_dec);
      const node = this.node.cfg.nodeId;
      const ship = this.node.cfg.nodeShip;
      const q = `mission=${encodeURIComponent(m.id)}`;
      const push = await fetchJson(`${this.peer}/api/sync/push?${q}`, { method: 'POST', headers: this.headers(), body: encode({ node, ship, facts, decisions }) });
      const pull = await fetchJson(`${this.peer}/api/sync/pull?${q}&node=${encodeURIComponent(node)}&ship=${encodeURIComponent(ship ?? '')}&since=${row.pulled_seq}`, { headers: this.headers() });
      const merged = await m.mergeFacts(revive<Fact[]>(pull.facts ?? []), 'shore');
      // Advance the push cursor over everything the shore now holds: what we sent and what we just pulled from it.
      // Stop at the first fact that is neither (a report that arrived locally mid-exchange goes next time).
      const atShore = new Set([...facts.map((f) => f.id), ...merged.added.map((f) => f.id)]);
      let cursor = row.pushed_seq;
      for (const f of m.log.all()) {
        if (f.seq <= cursor) continue;
        if (!atShore.has(f.id)) break;
        cursor = f.seq;
      }
      await store.putSync(this.node.pool, {
        ...row,
        pushed_seq: cursor,
        pushed_dec: decisions.length ? decisions[decisions.length - 1].seq : row.pushed_dec,
        pulled_seq: typeof pull.next === 'number' ? pull.next : row.pulled_seq,
        last_ok_t: m.now(), last_ok_wall: new Date(), facts_in: row.facts_in + merged.added.length, last_error: null,
      });
      await this.refreshPending(m);
      const moved = facts.length + decisions.length + merged.added.length;
      if (moved || this.lastError.has(m.id)) {
        this.node.emit({
          type: 'sync', mission: m.id, pushed: facts.length + decisions.length, pulled: merged.added.length, withheld: Number(pull.withheld ?? 0),
          contested: [...new Set([...(push.contested ?? []), ...merged.contested])], ok: true,
        });
      }
      this.lastError.delete(m.id);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== this.lastError.get(m.id)) this.node.emit({ type: 'sync', mission: m.id, pushed: 0, pulled: 0, withheld: 0, contested: [], ok: false, error: msg });
      this.lastError.set(m.id, msg);
      const row = await store.getSync(this.node.pool, m.id, 'shore');
      await store.putSync(this.node.pool, { ...row, last_error: msg });
    }
  }
}

async function fetchJson(url: string, init: RequestInit): Promise<Record<string, any>> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`${r.status} from ${new URL(url).pathname}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(t);
  }
}

/* -------------------------------------------------------------- shore side */

export async function receivePush(m: MissionRuntime, body: unknown): Promise<Record<string, unknown>> {
  if (m.node.cfg.nodeKind !== 'shore') throw new HttpError(409, 'only the shore node accepts pushes');
  const b = revive<{ node?: unknown; ship?: unknown; facts?: unknown; decisions?: unknown }>(body);
  if (typeof b.node !== 'string' || !/^[a-z0-9-]{1,40}$/i.test(b.node)) throw new HttpError(422, 'push needs a node id');
  const facts = Array.isArray(b.facts) ? (b.facts as Fact[]) : [];
  const decisions = Array.isArray(b.decisions) ? (b.decisions as Decision[]) : [];
  if (facts.length > 5000 || decisions.length > 5000) throw new HttpError(413, 'push too large; send in batches');
  await m.deliverDue();
  const valid = facts.filter((f) => f && typeof f.id === 'string' && typeof f.entity === 'string' && typeof f.attr === 'string' && f.source && typeof f.recordedAt === 'number');
  const r = await m.mergeFacts(valid, m.labels.shipName.get(String(b.ship)) ?? b.node);
  const seen = m.fromPeer.get(b.node) ?? new Set<string>();
  for (const f of valid) seen.add(f.id);
  m.fromPeer.set(b.node, seen);
  const stored = decisions.length ? await m.storePeerDecisions(b.node, decisions) : 0;
  await m.touchPeer(b.node, typeof b.ship === 'string' ? b.ship : undefined, r.added.length);
  return { added: r.added.length, duplicates: r.duplicates, rejected: r.rejected + (facts.length - valid.length), contested: r.contested, decisions: stored };
}

export async function servePull(m: MissionRuntime, q: { node?: string; ship?: string; since?: string }): Promise<Record<string, unknown>> {
  if (m.node.cfg.nodeKind !== 'shore') throw new HttpError(409, 'only the shore node serves pulls');
  const node = String(q.node ?? '');
  const ship = String(q.ship ?? '');
  const since = Number(q.since ?? -1);
  if (!node) throw new HttpError(422, 'pull needs a node id');
  await m.deliverDue();
  const seen = m.fromPeer.get(node) ?? new Set<string>();
  let withheld = 0;
  const out: Fact[] = [];
  const all = m.log.all();
  for (const f of all) {
    if (f.seq <= since || seen.has(f.id)) continue;
    if (SHARE_POLICY.some((p) => p.withhold(f, ship, m.labels.ownerOf(f.entity)))) {
      withheld++;
      continue;
    }
    out.push(f as Fact);
  }
  await m.touchPeer(node, ship || undefined, 0);
  return { facts: JSON.parse(encode(out)), next: all.length ? all[all.length - 1].seq : since, withheld };
}
