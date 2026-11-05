import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, type Config } from '../src/config';
import { migrate, openPool, type Pool } from '../src/db';
import { revive, wireReplacer } from '../src/json';
import type { MissionRuntime } from '../src/mission';
import { faithful } from '../src/narrate';
import { NodeRuntime } from '../src/node';
import * as store from '../src/pgstore';
import { createServer } from '../src/server';
import { SyncClient } from '../src/sync';
import type { AuditView } from '../src/views/contract';
import { MissionViews } from '../src/views/service';

/**
 * These run against a real Postgres (PG_URL, default the local development
 * server). Each node gets its own database, as in the docker-compose stack.
 */
const PG = process.env.PG_URL ?? 'postgres://postgres:postgres@localhost:5432';
const actor = { id: 'lt.test', role: 'Readiness officer' };
const D = (d: number, hhmm: string) => (21 + d) * 24 + Number(hhmm.slice(0, 2)) + Number(hhmm.slice(2)) / 60;

interface TestNode {
  node: NodeRuntime;
  pool: Pool;
  server: Server;
  url: string;
  m: (id: string) => MissionRuntime;
  v: (id: string) => MissionViews;
}

async function start(db: string, env: Record<string, string>): Promise<TestNode> {
  const cfg: Config = loadConfig({ ...env, DATABASE_URL: `${PG}/${db}`, DEMO_MODE: '1' } as NodeJS.ProcessEnv);
  const pool = await openPool(cfg.databaseUrl, true);
  await migrate(pool);
  await store.wipeAll(pool);
  const node = new NodeRuntime(cfg, pool);
  await node.start();
  const server = createServer(node).listen(0);
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const views = new Map<string, MissionViews>();
  return {
    node, pool, server, url,
    m: (id) => node.mission(id),
    v: (id) => views.get(id) ?? views.set(id, new MissionViews(node.mission(id))).get(id)!,
  };
}

async function stop(n: TestNode): Promise<void> {
  n.node.stop();
  await new Promise((r) => n.server.close(r));
  await n.pool.end();
}

const getJson = async <T>(url: string): Promise<T> => revive<T>(await (await fetch(url)).json());
const seek = (n: TestNode, mission: string, t: number) => n.m(mission).clockCommand({ action: 'seek', t });
const cap = (n: TestNode, mission: string, t: number, id: string) => n.v(mission).snapshot(t).result.capabilities.find((c) => c.id === id)!;

describe('one node, two missions', () => {
  let a: TestNode;
  beforeAll(async () => {
    a = await start('mission_test_solo', { NODE_ID: 'solo', NODE_KIND: 'ship', NODE_SHIP: 'ddgB', INJECT_MODE: 'all' });
  });
  afterAll(async () => stop(a));

  it('serves both missions from one database, each seeded with its own baseline', async () => {
    const r = await getJson<{ missions: { id: string }[] }>(`${a.url}/api/missions`);
    expect(r.missions.map((m) => m.id).sort()).toEqual(['atlas-shield', 'steel-tide']);
    expect(a.m('steel-tide').log.size()).toBe(21);
    expect(a.m('atlas-shield').log.size()).toBeGreaterThan(10);
    const rows = (await a.pool.query('select mission, count(*)::int n from fact group by mission order by mission')).rows;
    expect(rows.map((x) => x.mission)).toEqual(['atlas-shield', 'steel-tide']);
  });

  it('ATLAS SHIELD at D-14 1400: AMD Q, ready D-5 2200, 4d 10h of margin, controlled by FC1 Martinez', async () => {
    await seek(a, 'atlas-shield', D(-14, '1400'));
    const amd = cap(a, 'atlas-shield', D(-14, '1400'), 'c_amd');
    expect(amd.status).toBe('Q');
    expect(amd.ready).toBeCloseTo(D(-5, '2200'), 6);
    expect(amd.margin).toBeCloseTo(4 * 24 + 10, 6);
    expect(amd.marginKind).toBe('exact');
    expect(amd.leaves.map((l) => l.node)).toContain('p_fc1_martinez');
  });

  it('explains each report: the CFA slip past sail is called out as nonlinear', () => {
    const snap = a.v('atlas-shield').snapshot(D(-14, '1400'));
    expect(snap.applied.length).toBe(10);
    const slip = Object.values(snap.impacts).find((i) => i.lines.some((l) => l.kind === 'nonlinear'));
    expect(slip?.event.kind).toBe('supply');
    expect(snap.impacts.E03.lines.some((l) => l.kind === 'nochange')).toBe(true);
  });

  it('never loses an unbounded value on the wire, and labels it instead of printing infinity', () => {
    const snap = a.v('atlas-shield').snapshot(D(-14, '1400'));
    const wire = revive<typeof snap>(JSON.parse(JSON.stringify(snap, wireReplacer)));
    const up = wire.result.capabilities.filter((c) => c.marginKind === 'atLeast');
    expect(up.length).toBeGreaterThan(0);
    for (const c of up) expect(Number.isFinite(c.margin) && c.margin >= 0).toBe(true);
    expect(JSON.stringify(snap, wireReplacer)).not.toMatch(/null,"marginKind"/);
    expect(wire.result.capabilities.every((c) => typeof c.ready === 'number')).toBe(true);
  });

  it('analyses options: expedite alone recovers nothing; expedite with the fly-away team recovers a week', () => {
    const an = a.v('atlas-shield').capAnalysis(D(-14, '1400'), 'c_amd');
    expect(an.options.singles.find((o) => o.id === 'L_EXPEDITE')!.recovered).toBeLessThan(1);
    const best = an.options.combos.sort((x, y) => y.recovered - x.recovered)[0];
    expect(best.levers.map((l) => l.id)).toContain('L_EXPEDITE');
    expect(best.recovered).toBeGreaterThan(24 * 7);
    expect(an.mc.targets.c_amd.pMeet).toBeGreaterThan(0);
    expect(an.lines[0].kind).toBe('headline');
    expect(a.v('atlas-shield').capAnalysis(D(-14, '1400'), 'c_asw').cliffs.length).toBeGreaterThan(0);
  });

  it('a random slip reports the delay to the capability first', () => {
    const s = a.v('atlas-shield').slipChallenge(D(-14, '1400'), 42);
    expect(s.slip).toBeGreaterThan(0);
    expect(typeof s.delay).toBe('number');
    expect(s.absorbed).toBe(Math.abs(s.delay) < 1e-6 && s.statusBefore === s.statusAfter);
  });

  it('what-if never touches the logs', () => {
    const before = a.m('atlas-shield').log.head();
    const w = a.v('atlas-shield').whatIf(D(-14, '1400'), { p_fc1_martinez: 48 });
    expect(w.result.capabilities.find((c) => c.id === 'c_amd')!.margin).toBeLessThan(4 * 24 + 10);
    expect(a.m('atlas-shield').log.head()).toBe(before);
  });

  it('STEEL TIDE at H-5: the strike is N on the ship', async () => {
    await seek(a, 'steel-tide', 55);
    const snap = a.v('steel-tide').snapshot(55);
    expect(snap.result.capabilities.find((c) => c.id === 'strike:tide')!.status).toBe('N');
    expect(snap.applied).toEqual(expect.arrayContaining(['ST03', 'ST04', 'ST06', 'ST07']));
  });

  it('records decisions per mission with their rules: notes, STOP, time order', async () => {
    const st = a.m('steel-tide');
    await expect(st.decide({ kind: 'reject', lever: 'slip:tide:12' }, actor)).rejects.toThrow(/note/);
    const d = await st.decide({ kind: 'approve', lever: 'prebrief:tide:ddgB', note: 'approved by CSG-X (HF voice)' }, actor);
    expect(d.patches?.length).toBeGreaterThan(0);
    expect(a.v('steel-tide').snapshot(55).approved).toContain('prebrief:tide:ddgB');
    await st.decide({ kind: 'stop', note: 'picture under review' }, actor);
    expect(a.v('steel-tide').snapshot(55).halted.stopped).toBe(true);
    await expect(st.decide({ kind: 'approve', lever: 'emcon-relay:tide' }, actor)).rejects.toThrow(/stopped/);
    await st.decide({ kind: 'resume', note: 'review complete' }, actor);
    await seek(a, 'steel-tide', 50);
    await expect(st.decide({ kind: 'note', note: 'late' }, actor)).rejects.toThrow(/time order/);
    await seek(a, 'steel-tide', 57);
    expect(a.m('atlas-shield').decisions.all()).toHaveLength(0);
  });

  it('reloads identical chains from Postgres per mission and detects an edited row', async () => {
    const st = a.m('steel-tide');
    const { log, mismatches } = await store.loadFacts(a.pool, 'steel-tide', st.reg.attrs, 'solo');
    expect(log.head()).toBe(st.log.head());
    expect(mismatches).toEqual([]);
    expect((await store.loadDecisions(a.pool, 'steel-tide')).head()).toBe(st.decisions.head());
    const edited = (await a.pool.query(`select seq from fact where mission = 'steel-tide' and attr = 'fuel_pct' order by seq limit 1`)).rows[0].seq;
    await a.pool.query(`update fact set body = jsonb_set(body, '{value}', '99') where mission = 'steel-tide' and seq = $1`, [edited]);
    const again = await store.loadFacts(a.pool, 'steel-tide', st.reg.attrs, 'solo');
    expect(again.mismatches[0]).toBe(edited);
    const other = await store.loadFacts(a.pool, 'atlas-shield', a.m('atlas-shield').reg.attrs, 'solo');
    expect(other.mismatches).toEqual([]);
  });

  it('serves the audit for client-side verification and the fleet lab', async () => {
    const audit = await getJson<AuditView>(`${a.url}/api/m/atlas-shield/audit`);
    expect(audit.serverVerify.facts.ok).toBe(true);
    expect(audit.facts.length).toBe(a.m('atlas-shield').log.size());
    const fleet = await getJson<{ active: string[]; missions: unknown[] }>(`${a.url}/api/fleet?active=amc`);
    expect(fleet.active).toEqual(['amc']);
    expect(fleet.missions).toHaveLength(12);
  });

  it('keeps a narrative faithful to the computed values', () => {
    expect(faithful('AMD is qualified with 4d 10h of margin, ready D-5 2200.', ['AMD Q · margin 4d 10h · ready D-5 2200']).ok).toBe(true);
    expect(faithful('AMD has 6d of margin.', ['AMD Q · margin 4d 10h']).ok).toBe(false);
  });
});

describe('ship and shore over a degraded link (STEEL TIDE)', () => {
  let shore: TestNode;
  let ship: TestNode;
  let sync: SyncClient;
  const M = 'steel-tide';
  const strike = (n: TestNode, t: number) => cap(n, M, t, 'strike:tide').status;
  beforeAll(async () => {
    shore = await start('mission_test_shore', { NODE_ID: 'shore', NODE_KIND: 'shore', INJECT_MODE: 'split', SIM_SHIPS: 'ddgB' });
    ship = await start('mission_test_ship', { NODE_ID: 'ship-ddgb', NODE_KIND: 'ship', NODE_SHIP: 'ddgB', INJECT_MODE: 'split' });
    sync = new SyncClient(ship.node, shore.url);
  });
  afterAll(async () => {
    sync.stop();
    await stop(ship);
    await stop(shore);
  });

  it('runs the DDIL thread end to end', async () => {
    await seek(shore, M, 52);
    await seek(ship, M, 52);
    await sync.once();
    expect(ship.m(M).syncInfo.pending).toBe(0);

    // H-6: Kittredge loses SATCOM; the casualty arrives on the ship and the data link drops
    await seek(shore, M, 55.5);
    await seek(ship, M, 55.5);
    expect(ship.node.link.up).toBe(false);
    await sync.once();
    expect(strike(ship, 55.5)).toBe('N');
    expect(strike(shore, 55.5)).toBe('Y'); // shore has not heard
    expect(ship.m(M).syncInfo.pending).toBeGreaterThan(0);
    expect(ship.v(M).snapshot(55.5).applied).toContain('ST05');

    // the ship acts on its own picture
    await ship.m(M).decide({ kind: 'approve', lever: 'prebrief:tide:ddgB', note: 'CSG-X approved by HF voice' }, actor);
    expect(strike(ship, 55.5)).toBe('Y');

    // shore-side reports keep arriving ashore only
    await seek(shore, M, 59);
    await seek(ship, M, 59);
    expect(ship.m(M).log.all().some((f) => f.attr === 'node_status')).toBe(false);
    await shore.m(M).addManualFact({ entity: 'ddgC-p2', attr: 'person_unavailable', value: [[59, 70]], reason: 'medevac' }, actor);

    // link restored: one exchange each way
    await ship.node.setLink(true, 'restored', 59);
    await sync.once();
    const casrep = shore.m(M).log.all().find((f) => f.attr === 'casrep' && f.entity === 'ddgB-satcom');
    expect(casrep?.receivedAt).toBe(59);
    expect(strike(shore, 59)).toBe('N'); // the ship's approval is its own
    expect(strike(shore, 55.5)).toBe('Y'); // what the shore knew then is unchanged
    expect(shore.m(M).peersView()[0].chainOk).toBe(true);
    expect(ship.m(M).log.all().find((f) => f.attr === 'node_status')?.receivedAt).toBe(59);
    expect(ship.m(M).log.all().some((f) => f.entity === 'ddgC-p2')).toBe(false);
    expect(ship.m(M).log.verify().ok).toBe(true);
    expect(shore.m(M).log.verify().ok).toBe(true);

    const sizes = [ship.m(M).log.size(), shore.m(M).log.size()];
    await sync.once();
    expect([ship.m(M).log.size(), shore.m(M).log.size()]).toEqual(sizes);
  });
});
