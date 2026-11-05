import { Clock, type ClockData } from './clock';
import type { Actor, ClockState, DecisionRequest, PeerState } from './views/contract';
import {
  contentOf, DecisionLog, FactLog, hashOf, knownAt, MissionSession, PackRegistry, validate,
  type Decision, type Evaluation, type Fact, type FactInput, type MissionDef, type ScenarioEvent,
} from './engine';
import { Labels } from './labels';
import type { NodeRuntime } from './node';
import * as store from './pgstore';
import { missionScript, type Inject } from './script';
import { fmtT, type TimeFrame } from './views/format';

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

interface PeerContact {
  node: string;
  ship?: string;
  lastT?: number;
  lastWall?: string;
  factsIn: number;
}

export interface ManualFactInput {
  entity?: unknown;
  attr?: unknown;
  value?: unknown;
  unit?: string;
  reason?: unknown;
  observedAt?: unknown;
  validFrom?: unknown;
  validTo?: unknown;
}

const ENTITY_RE = /^[A-Za-z0-9][A-Za-z0-9_.:~/-]{0,79}$/;

/**
 * One mission on this node: its fact and decision logs (written through to
 * Postgres), its watch script and clock, and a small evaluation cache. Writes
 * go through the node's single queue, so the in-memory chains and the tables
 * never diverge.
 */
export class MissionRuntime {
  readonly id: string;
  readonly reg: PackRegistry;
  readonly labels: Labels;
  readonly frame: TimeFrame;
  readonly ownShip: string;
  readonly events: ScenarioEvent[];
  readonly script: Inject[];
  log!: FactLog;
  decisions!: DecisionLog;
  session!: MissionSession;
  clock!: Clock;
  peerDecisions = new Map<string, Decision[]>();
  integrity = { factMismatches: [] as number[] };
  /** Shore: last contact per ship node. */
  readonly contacts = new Map<string, PeerContact>();
  /** Shore: fact ids each peer pushed (so pulls do not echo them back). */
  readonly fromPeer = new Map<string, Set<string>>();
  /** Ship: what the sync client last reported. */
  syncInfo: { pending: number; last?: { t: number; wall: string } } = { pending: 0 };
  private firedLinks = new Set<string>();
  private cache = new Map<string, unknown>();

  constructor(readonly node: NodeRuntime, readonly def: MissionDef) {
    this.id = def.id;
    this.reg = new PackRegistry();
    for (const p of def.packs) this.reg.register(p);
    this.labels = new Labels(def);
    const d = def.display;
    const epoch = (def.model as { epochUtc?: string }).epochUtc;
    this.frame = { timeScale: d.timeScale === 'hhour' ? 'hours' : 'days', dDay: d.dDay ?? 0, hHour: d.hHour, epochUtc: epoch ? Date.parse(epoch) : 0 };
    this.ownShip = d.ownShip.id;
    this.events = def.events();
    const scratch = new FactLog(this.reg.attrs, 'script');
    this.script = missionScript(def, this.events, this.labels).map((i) => (i.fact ? { ...i, factId: scratch.append(i.fact).id } : i));
  }

  get horizon(): [number, number] {
    return (this.def.model as { horizon: [number, number] }).horizon;
  }

  /** Where the replay stops: a little after the last scripted report (or the mission start, if later). */
  /** Where the replay stops: just after the last scripted report, while its options can still be acted on. */
  get watchEnd(): number {
    const last = Math.max(...this.events.map((e) => e.t), this.def.display.watchStart);
    return Math.min(this.horizon[1], last + (this.frame.timeScale === 'hours' ? 0.5 : 1));
  }

  private k(key: string): string {
    return `${this.id}:${key}`;
  }

  private get cfg() {
    return this.node.cfg;
  }

  /* ------------------------------------------------------------- startup */

  async load(): Promise<void> {
    const pool = this.node.pool;
    const { log, mismatches } = await store.loadFacts(pool, this.id, this.reg.attrs, this.cfg.nodeId);
    this.log = log;
    this.integrity.factMismatches = mismatches;
    this.decisions = await store.loadDecisions(pool, this.id);
    this.peerDecisions = await store.loadPeerDecisions(pool, this.id);
    this.labels.learn(this.log.all());
    this.session = new MissionSession({ packs: this.def.packs, main: this.def.main, model: this.def.model, log: this.log, decisions: this.decisions });
    const c = await store.getState<ClockData>(pool, this.k('clock'));
    this.clock = new Clock(c ?? this.freshClock(), this.horizon);
    this.firedLinks = new Set((await store.getState<string[]>(pool, this.k('firedLinks'))) ?? []);
    this.contacts.clear();
    for (const s of await store.allSync(pool, this.id)) {
      if (s.peer === 'shore') continue;
      this.contacts.set(s.peer, { node: s.peer, lastT: s.last_ok_t ?? undefined, lastWall: s.last_ok_wall?.toISOString(), factsIn: s.facts_in });
    }
    this.cache.clear();
    if (this.log.size() === 0) await this.seed();
  }

  private freshClock(): ClockData {
    return { t0: this.def.display.watchStart, wall0: Date.now(), playing: false, speed: this.cfg.startSpeed };
  }

  private async seed(): Promise<void> {
    const facts = this.log.appendMany(this.def.baseline());
    await store.insertFacts(this.node.pool, this.id, facts);
    this.labels.learn(facts);
    await store.setState(this.node.pool, this.k('clock'), this.clock.data);
  }

  /* --------------------------------------------------------------- clock */

  now(): number {
    return this.clock.now();
  }

  /** Requested viewing time, never ahead of this node's clock (a node cannot show what it has not received). */
  parseAt(q: unknown): number {
    const now = this.now();
    if (q === undefined || q === '' || q === null) return now;
    const t = Number(q);
    if (!Number.isFinite(t)) throw new HttpError(400, 'at must be a number (scenario hours)');
    return Math.max(this.horizon[0], Math.min(now, t));
  }

  clockState(): ClockState {
    return { mission: this.id, t: this.now(), playing: this.clock.data.playing, speed: this.clock.data.speed, horizon: this.horizon };
  }

  async clockCommand(cmd: { action?: string; t?: number; speed?: number; data?: ClockData }): Promise<ClockState> {
    await this.node.serial(async () => {
      switch (cmd.action) {
        case 'play':
          if (this.now() >= this.watchEnd - 1e-9) this.clock.seek(this.def.display.watchStart);
          this.clock.play();
          break;
        case 'pause':
          this.clock.pause();
          break;
        case 'seek':
          if (typeof cmd.t !== 'number' || !Number.isFinite(cmd.t)) throw new HttpError(400, 'seek needs t (scenario hours)');
          this.clock.seek(cmd.t);
          break;
        case 'speed':
          if (typeof cmd.speed !== 'number' || !Number.isFinite(cmd.speed)) throw new HttpError(400, 'speed needs a number');
          this.clock.setSpeed(cmd.speed);
          break;
        case 'set':
          if (!cmd.data || typeof cmd.data.t0 !== 'number') throw new HttpError(400, 'set needs clock data');
          this.clock = new Clock(cmd.data, this.horizon);
          break;
        default:
          throw new HttpError(400, `unknown clock action ${String(cmd.action)}`);
      }
      await store.setState(this.node.pool, this.k('clock'), this.clock.data);
    });
    await this.deliverDue();
    this.node.emit({ type: 'clock', mission: this.id, clock: this.clockState() });
    return this.clockState();
  }

  /* ------------------------------------------------------------- injects */

  /** Whether this node receives a scripted report directly (rather than over sync). */
  receives(inj: Inject): boolean {
    const split = this.def.splitDelivery && this.cfg.injectMode === 'split';
    // a single node has no data link to lose: it receives every report and ignores link events
    if (!split) return inj.kind !== 'link';
    if (inj.kind === 'link') return this.cfg.nodeKind === 'ship' && inj.link?.ship === this.cfg.nodeShip;
    if (this.cfg.nodeKind === 'ship') return inj.origin === 'ship' && inj.ship === this.cfg.nodeShip;
    // shore: shore-side reports, plus reports from ships that are not running their own node
    return inj.origin === 'shore' || (inj.origin === 'ship' && !this.cfg.simShips.includes(inj.ship ?? ''));
  }

  delivered(inj: Inject): boolean {
    if (inj.kind === 'link') return this.firedLinks.has(inj.id);
    return this.log.has(inj.factId!);
  }

  arrivesAt(inj: Inject): 'ship' | 'shore' {
    if (inj.kind === 'link') return 'ship';
    return inj.origin === 'ship' && this.cfg.simShips.includes(inj.ship ?? '') ? 'ship' : 'shore';
  }

  /** Deliver every scripted report due by now (also run before each sync so a link drop is never raced). */
  async deliverDue(): Promise<void> {
    const t = this.now();
    const due = this.script.filter((i) => i.at <= t + 1e-9 && this.receives(i) && !this.delivered(i));
    if (!due.length) return;
    await this.node.serial(async () => {
      const facts: Fact[] = [];
      for (const inj of due) {
        if (this.delivered(inj)) continue;
        if (inj.kind === 'fact') {
          const before = this.log.size();
          const f = this.log.append(inj.fact!);
          if (this.log.size() > before) facts.push(f);
        } else if (inj.link) {
          this.firedLinks.add(inj.id);
          await store.setState(this.node.pool, this.k('firedLinks'), [...this.firedLinks]);
          await this.node.setLinkInner(inj.link.up, inj.link.reason, inj.at);
        }
      }
      if (facts.length) {
        await this.persistOrReload(() => store.insertFacts(this.node.pool, this.id, facts));
        this.labels.learn(facts);
        this.node.emit({ type: 'facts', mission: this.id, count: facts.length, via: 'inject', labels: [...new Set(due.filter((d) => d.kind === 'fact').map((d) => d.label))] });
      }
    });
  }

  /* --------------------------------------------------------------- reset */

  async reset(): Promise<void> {
    await this.node.serial(async () => {
      await store.wipeMission(this.node.pool, this.id);
      this.fromPeer.clear();
      this.syncInfo = { pending: 0 };
      await store.setState(this.node.pool, this.k('clock'), this.freshClock());
      await this.load();
      this.firedLinks.clear();
    });
    this.node.emit({ type: 'reset', mission: this.id });
    this.node.emit({ type: 'clock', mission: this.id, clock: this.clockState() });
  }

  /* --------------------------------------------------------------- writes */

  private async persistOrReload(write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch (e) {
      console.error(`[${this.id}] write-through failed; reloading from the database`, e);
      await this.load();
      throw new HttpError(503, 'storage write failed; nothing was recorded');
    }
  }

  async addManualFact(input: ManualFactInput, actor: Actor): Promise<Fact> {
    return this.node.serial(async () => {
      const def = this.reg.attrs.get(String(input.attr ?? ''));
      if (!def) throw new HttpError(422, `unknown attribute "${String(input.attr)}"`);
      if (typeof input.entity !== 'string' || !ENTITY_RE.test(input.entity)) throw new HttpError(422, 'entity must be a short identifier (letters, digits, - _ . : ~ /)');
      const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
      if (!reason) throw new HttpError(422, 'a reason is required for every manual entry');
      if (reason.length > 500) throw new HttpError(422, 'reason is limited to 500 characters');
      const bad = validate(def, input.value);
      if (bad) throw new HttpError(422, `value rejected: ${bad}`);
      const t = this.now();
      const num = (x: unknown, name: string) => {
        if (x === undefined || x === null || x === '') return undefined;
        const n = Number(x);
        if (!Number.isFinite(n)) throw new HttpError(422, `${name} must be a number`);
        return n;
      };
      const observedAt = num(input.observedAt, 'observedAt') ?? t;
      if (observedAt > t + 1e-9) throw new HttpError(422, 'observedAt cannot be later than now');
      const n = this.log.all().filter((f) => f.source.kind === 'manual' && f.origin === this.cfg.nodeId).length + 1;
      const fact: FactInput = {
        entity: input.entity, attr: def.key, value: input.value, unit: input.unit ?? def.unit, scope: 'global',
        source: { system: 'WATCH-LOG', kind: 'manual', recordId: `WL-${this.cfg.nodeId.toUpperCase()}-${String(n).padStart(4, '0')}` },
        observedAt, validFrom: num(input.validFrom, 'validFrom'), validTo: num(input.validTo, 'validTo'),
        recordedAt: t, recordedBy: actor.id, reason, origin: this.cfg.nodeId,
      };
      const before = this.log.size();
      const f = this.log.append(fact);
      if (this.log.size() > before) {
        await this.persistOrReload(() => store.insertFacts(this.node.pool, this.id, [f]));
        this.labels.learn([f]);
        this.node.emit({ type: 'facts', mission: this.id, count: 1, via: 'manual', labels: [`WATCH-LOG: ${reason}`] });
      }
      return f;
    });
  }

  async decide(req: DecisionRequest, actor: Actor): Promise<Decision> {
    return this.node.serial(async () => {
      const at = this.now();
      const last = this.decisions.all().at(-1);
      if (last && last.at > at + 1e-9) {
        throw new HttpError(409, `decisions are recorded in time order: the watch is at ${this.fmt(at)}, the last decision was at ${this.fmt(last.at)}. Move forward or reset the mission.`);
      }
      const wallClock = new Date().toISOString();
      const note = typeof req.note === 'string' ? req.note.trim().slice(0, 1000) || undefined : undefined;
      let d: Decision;
      try {
        switch (req.kind) {
          case 'approve':
            if (!req.lever) throw new HttpError(422, 'approve needs a lever');
            d = this.session.approve(req.lever, actor, at, note, { wallClock });
            break;
          case 'reject':
            d = this.session.reject(String(req.lever ?? ''), actor, at, note ?? '', { wallClock });
            break;
          case 'withdraw':
          case 'monitor':
          case 'override':
          case 'stop':
          case 'resume':
          case 'note':
            d = this.decisions.record({ kind: req.kind, at, actor, lever: req.lever, requirement: req.requirement, note, status: req.status, wallClock, basis: { factsHead: this.log.head() } });
            break;
          default:
            throw new HttpError(422, `decision kind "${String(req.kind)}" is not accepted here`);
        }
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(422, (e as Error).message);
      }
      await this.persistOrReload(() => store.insertDecision(this.node.pool, this.id, d));
      this.node.emit({ type: 'decision', mission: this.id, seq: d.seq, kind: d.kind, by: actor.id });
      return d;
    });
  }

  /** Append facts received from a peer; returns the ones that were new here. */
  async mergeFacts(incoming: Fact[], peer: string): Promise<{ added: Fact[]; duplicates: number; rejected: number; contested: string[] }> {
    return this.node.serial(async () => {
      const check = new FactLog(this.reg.attrs, this.cfg.nodeId);
      const ok: Fact[] = [];
      let rejected = 0;
      for (const f of incoming) {
        const id = check.append(contentOf(f)).id;
        if (id === f.id) ok.push(f);
        else rejected++;
      }
      const before = this.log.size();
      const r = this.log.merge(ok, { receivedAt: this.now() });
      const added = this.log.all().slice(before) as Fact[];
      if (added.length) {
        await this.persistOrReload(() => store.insertFacts(this.node.pool, this.id, added));
        this.labels.learn(added);
        this.node.emit({
          type: 'facts', mission: this.id, count: added.length, via: 'sync',
          labels: added.slice(0, 6).map((f) => `${f.source.system}: ${f.reason ?? `${this.labels.label(f.entity)} ${f.attr}`} (via ${peer})`),
        });
      }
      return { added, duplicates: r.duplicates, rejected, contested: r.contested };
    });
  }

  async storePeerDecisions(node: string, entries: Decision[]): Promise<number> {
    return this.node.serial(async () => {
      const n = await store.insertPeerDecisions(this.node.pool, this.id, node, entries, this.now());
      if (n) {
        this.peerDecisions = await store.loadPeerDecisions(this.node.pool, this.id);
        this.node.emit({ type: 'decision', mission: this.id, seq: -1, kind: 'note', by: node });
      }
      return n;
    });
  }

  async touchPeer(node: string, ship: string | undefined, factsIn: number): Promise<void> {
    const c = this.contacts.get(node) ?? { node, ship, factsIn: 0 };
    c.ship = ship ?? c.ship;
    c.lastT = this.now();
    c.lastWall = new Date().toISOString();
    c.factsIn += factsIn;
    this.contacts.set(node, c);
    const row = await store.getSync(this.node.pool, this.id, node);
    await store.putSync(this.node.pool, { ...row, last_ok_t: c.lastT, last_ok_wall: new Date(c.lastWall), facts_in: c.factsIn, last_error: null });
  }

  peersView(): PeerState[] {
    const out: PeerState[] = [];
    for (const node of new Set([...this.contacts.keys(), ...this.peerDecisions.keys()])) {
      const c = this.contacts.get(node);
      const entries = this.peerDecisions.get(node) ?? [];
      const ship = c?.ship ?? node.replace(/^ship-/, '');
      const shipId = [...this.labels.shipName.keys()].find((k) => k.toLowerCase() === ship.toLowerCase());
      out.push({
        node,
        label: shipId ? `${this.labels.shipName.get(shipId)} (shipboard node)` : node,
        lastContact: c?.lastT !== undefined ? { t: c.lastT, wall: c.lastWall ?? '' } : undefined,
        factsReceived: c?.factsIn ?? 0,
        decisions: entries.length,
        chainOk: DecisionLog.fromEntries(entries).verify().ok,
      });
    }
    return out;
  }

  /* ----------------------------------------------------------- evaluation */

  /** Content key for "the picture at t": the time, the facts this node knew then, the decisions made by then. */
  key(t: number): string {
    const ids = this.log.all().filter((f) => knownAt(f) <= t + 1e-9).map((f) => f.id);
    const dec = this.decisions.all().filter((d) => d.at <= t + 1e-9).map((d) => d.hash);
    return `${t.toFixed(4)}|${hashOf([ids, dec])}`;
  }

  /** Content key without the time: changes only when knowledge or decisions change. */
  knowledgeKey(t: number): string {
    return this.key(t).split('|')[1];
  }

  memo<T>(name: string, k: string, f: () => T): T {
    const key = `${name}|${k}`;
    if (this.cache.has(key)) {
      const v = this.cache.get(key) as T;
      this.cache.delete(key);
      this.cache.set(key, v);
      return v;
    }
    const v = f();
    this.cache.set(key, v);
    if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value!);
    return v;
  }

  evaluate(t: number): Evaluation {
    return this.memo('ev', this.key(t), () => this.session.evaluate(t));
  }

  evaluateAuthoritative(t: number): Evaluation {
    return this.memo('ev-auth', this.key(t), () => this.session.evaluate(t, { assumptions: false }));
  }

  /** A session over a chosen subset of this node's facts (for "the picture just before / just after this report"). */
  sessionOver(facts: readonly Fact[]): MissionSession {
    const log = new FactLog(this.reg.attrs, this.cfg.nodeId);
    for (const f of facts) log.append(contentOf(f), { receivedAt: f.receivedAt });
    return new MissionSession({ packs: this.def.packs, main: this.def.main, model: this.def.model, log, decisions: this.decisions });
  }

  /** Facts this node holds for a scripted event (whether delivered directly or over sync). */
  eventFacts(e: ScenarioEvent): Fact[] {
    const ids = new Set(this.script.filter((i) => i.eventId === e.id && i.factId).map((i) => i.factId!));
    return this.log.all().filter((f) => ids.has(f.id)) as Fact[];
  }

  /** When this node learned of an event (undefined if it has not, as of t). */
  eventKnownAt(e: ScenarioEvent, t: number): number | undefined {
    if (!e.facts.length) {
      const inj = this.script.find((i) => i.eventId === e.id && i.kind === 'link');
      return inj && this.firedLinks.has(inj.id) && e.t <= t + 1e-9 ? e.t : undefined;
    }
    const known = this.eventFacts(e).map(knownAt).filter((k) => k <= t + 1e-9);
    return known.length ? Math.min(...known) : undefined;
  }

  fmt(t: number): string {
    return fmtT(this.frame, t);
  }
}
