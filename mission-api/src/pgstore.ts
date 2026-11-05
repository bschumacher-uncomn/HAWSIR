import type { Pool } from './db';
import { encode, revive } from './json';
import { contentOf, DecisionLog, FactLog, type AttributeRegistry, type Decision, type Fact } from './engine';

/**
 * Postgres persistence for the engine's logs, scoped by mission. The
 * in-memory logs are the working copy; every append is written through. On
 * load the chains are rebuilt from content and compared with what was stored,
 * so a row edited in the database shows up as an integrity failure instead of
 * a silent change.
 */
interface FactRow {
  seq: number;
  id: string;
  hash: string;
  received_at: number | null;
  body: unknown;
}

export async function loadFacts(pool: Pool, mission: string, attrs: AttributeRegistry, origin: string): Promise<{ log: FactLog; mismatches: number[] }> {
  const rows = (await pool.query<FactRow>('select seq, id, hash, received_at, body from fact where mission = $1 order by seq', [mission])).rows;
  const log = new FactLog(attrs, origin);
  const mismatches: number[] = [];
  for (const r of rows) {
    const content = contentOf(revive(r.body));
    const f = log.append(content, { receivedAt: r.received_at ?? undefined });
    if (f.id !== r.id || f.hash !== r.hash) mismatches.push(r.seq);
  }
  return { log, mismatches };
}

export async function insertFacts(pool: Pool, mission: string, facts: readonly Fact[]): Promise<void> {
  if (!facts.length) return;
  const c = await pool.connect();
  try {
    await c.query('begin');
    for (const f of facts) {
      await c.query(
        `insert into fact (mission, seq, id, hash, prev_hash, entity, attr, recorded_at, received_at, origin, quarantine, body)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) on conflict (mission, id) do nothing`,
        [mission, f.seq, f.id, f.hash, f.prevHash, f.entity, f.attr, f.recordedAt, f.receivedAt ?? null, f.origin ?? null, f.quarantine ?? null, encode(contentOf(f))],
      );
    }
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

export async function loadDecisions(pool: Pool, mission: string): Promise<DecisionLog> {
  const rows = (await pool.query<{ body: unknown }>('select body from decision where mission = $1 order by seq', [mission])).rows;
  return DecisionLog.fromEntries(rows.map((r) => revive<Decision>(r.body)));
}

export async function insertDecision(pool: Pool, mission: string, d: Decision): Promise<void> {
  await pool.query('insert into decision (mission, seq, hash, prev_hash, kind, at, actor_id, body) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)', [
    mission, d.seq, d.hash, d.prevHash, d.kind, d.at, d.actor.id, encode(d),
  ]);
}

export async function loadPeerDecisions(pool: Pool, mission: string): Promise<Map<string, Decision[]>> {
  const rows = (await pool.query<{ node: string; body: unknown }>('select node, body from peer_decision where mission = $1 order by node, seq', [mission])).rows;
  const m = new Map<string, Decision[]>();
  for (const r of rows) {
    const list = m.get(r.node) ?? [];
    list.push(revive<Decision>(r.body));
    m.set(r.node, list);
  }
  return m;
}

export async function insertPeerDecisions(pool: Pool, mission: string, node: string, entries: Decision[], receivedAt: number): Promise<number> {
  let n = 0;
  for (const d of entries) {
    const r = await pool.query('insert into peer_decision (mission, node, seq, hash, body, received_at) values ($1,$2,$3,$4,$5::jsonb,$6) on conflict do nothing', [
      mission, node, d.seq, d.hash, encode(d), receivedAt,
    ]);
    n += r.rowCount ?? 0;
  }
  return n;
}

export async function getState<T>(pool: Pool, key: string): Promise<T | undefined> {
  const r = await pool.query<{ value: unknown }>('select value from runtime_state where key = $1', [key]);
  return r.rowCount ? revive<T>(r.rows[0].value) : undefined;
}

export async function setState(pool: Pool, key: string, value: unknown): Promise<void> {
  await pool.query('insert into runtime_state (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value', [key, encode(value)]);
}

export interface SyncRow {
  mission: string;
  peer: string;
  pushed_seq: number;
  pushed_dec: number;
  pulled_seq: number;
  last_ok_t: number | null;
  last_ok_wall: Date | null;
  facts_in: number;
  last_error: string | null;
}

export async function getSync(pool: Pool, mission: string, peer: string): Promise<SyncRow> {
  const r = await pool.query<SyncRow>('select * from sync_state where mission = $1 and peer = $2', [mission, peer]);
  return r.rows[0] ?? { mission, peer, pushed_seq: -1, pushed_dec: -1, pulled_seq: -1, last_ok_t: null, last_ok_wall: null, facts_in: 0, last_error: null };
}

export async function allSync(pool: Pool, mission: string): Promise<SyncRow[]> {
  return (await pool.query<SyncRow>('select * from sync_state where mission = $1 order by peer', [mission])).rows;
}

export async function putSync(pool: Pool, s: SyncRow): Promise<void> {
  await pool.query(
    `insert into sync_state (mission, peer, pushed_seq, pushed_dec, pulled_seq, last_ok_t, last_ok_wall, facts_in, last_error)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (mission, peer) do update set pushed_seq = excluded.pushed_seq, pushed_dec = excluded.pushed_dec, pulled_seq = excluded.pulled_seq,
       last_ok_t = excluded.last_ok_t, last_ok_wall = excluded.last_ok_wall, facts_in = excluded.facts_in, last_error = excluded.last_error`,
    [s.mission, s.peer, s.pushed_seq, s.pushed_dec, s.pulled_seq, s.last_ok_t, s.last_ok_wall, s.facts_in, s.last_error],
  );
}

/** Demo only: empty one mission's tables (the mission is re-seeded afterwards). */
export async function wipeMission(pool: Pool, mission: string): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    for (const t of ['fact', 'decision', 'peer_decision', 'sync_state']) await c.query(`delete from ${t} where mission = $1`, [mission]);
    await c.query('delete from runtime_state where key like $1', [`${mission}:%`]);
    await c.query('commit');
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

/** Tests only: empty every table. */
export async function wipeAll(pool: Pool): Promise<void> {
  await pool.query('truncate fact, decision, peer_decision, sync_state, runtime_state, node_info');
}

export async function nodeInfo(pool: Pool): Promise<{ id: string; kind: string; ship: string | null } | undefined> {
  const r = await pool.query('select id, kind, ship from node_info limit 1');
  return r.rows[0];
}

export async function setNodeInfo(pool: Pool, id: string, kind: string, ship: string | undefined): Promise<void> {
  await pool.query('insert into node_info (id, kind, ship) values ($1,$2,$3) on conflict (id) do nothing', [id, kind, ship ?? null]);
}
