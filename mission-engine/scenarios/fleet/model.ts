import { slackFor, downstreamOf } from '../../src/core/analysis';
import { compute, type ComputeContext } from '../../src/core/compute';
import type { EngineResult, GraphSpec, NodeSpec, Readiness, RequirementResult } from '../../src/core/graph';
import { firstFrom } from '../../src/core/intervals';
import { applyPatches, type Patch } from '../../src/core/patch';
import { RoutineRegistry } from '../../src/core/routines';
import { positionAt } from '../../src/packs/naval/model';
import { atlasShieldDisplay } from '../atlas-shield';
import { ATLAS_SHIELD, sessionFor } from '../index';
import {
  CAP_LABEL, DETAIL_LEGS, DISRUPTIONS, FLEET_NAME, MISSIONS, PLACES, ROUTINE_DEPOTS, ROUTINE_ITEMS, SHIPS,
  type Disruption, type FleetCap, type Issue, type MissionSpec, type Mode, type ShipSpec,
} from './data';

/**
 * The fleet lab: every hull's readiness computed by the same engine, then
 * rolled up into missions that need k of n ships. Generated hulls get a small
 * graph each (inputs → gates → install tasks → capabilities); DDG-170 runs the
 * full ATLAS SHIELD thread. A disruption (weather, SATCOM, NSIPS, a port
 * closure) is a set of patches on those graphs, so its consequence is computed,
 * not looked up. Times are hours from the fleet "now". Nothing is real force posture.
 */
export const FLEET_Q = 24;
const SLACK_MAX = 24 * 30;

export type LonLat = [number, number];
export type ShipStatus = Readiness | 'M';
export type PkgTone = 'crit' | 'risk' | 'ok';
export type MarginKind = 'exact' | 'atLeast' | 'never' | 'unknown';

export interface FleetCapRes {
  cap: string;
  label: string;
  status: Readiness;
  margin: number;
  marginKind: MarginKind;
  requiredBy: number;
  controlling: string;
}

export interface FleetPackage {
  id: string;
  hull: string;
  item: string;
  kind: Issue['kind'];
  mode: Mode;
  cap: string;
  fromName: string;
  toName: string;
  from: LonLat;
  to: LonLat;
  /** Arrival or rejoin, hours after the ship's "now". */
  eta: number;
  /** How much later it can arrive before its capability misses (negative: it must arrive this much earlier). */
  slack: number;
  /** How much later it can arrive with no change at all to its capability's ready time. */
  noImpact: number;
  recoverable: boolean;
  unbounded: boolean;
  onChain: boolean;
  tone: PkgTone;
  hits: string[];
  routine: boolean;
}

export interface FleetShip {
  spec: ShipSpec;
  pos: LonLat;
  status: ShipStatus;
  caps: FleetCapRes[];
  worst: FleetCapRes | null;
  packages: FleetPackage[];
}

export interface Contribution {
  hull: string;
  margin: number;
  status: Readiness;
  reason: string;
}

export interface ReqRes {
  cap: FleetCap;
  k: number;
  n: number;
  margin: number;
  status: Readiness;
  selected: Contribution[];
  absorbed: Contribution[];
  contributions: Contribution[];
}

export interface FleetMission {
  spec: MissionSpec;
  status: Readiness;
  margin: number;
  reqs: ReqRes[];
  controlling: { hull: string; cap: FleetCap; reason: string } | null;
}

export interface FleetCatalog {
  places: typeof PLACES;
  fleets: typeof FLEET_NAME;
  capLabels: typeof CAP_LABEL;
  disruptions: Disruption[];
  missions: MissionSpec[];
  ships: ShipSpec[];
  q: number;
}

export interface FleetPicture {
  ships: FleetShip[];
  missions: FleetMission[];
  packages: FleetPackage[];
  active: string[];
  /** Graphs computed for this picture (one per hull, plus slack searches). */
  graphs: number;
  ms: number;
}

const RANK: Record<Readiness, number> = { Y: 0, Q: 1, UNK: 2, N: 3 };
const worse = (a: Readiness, b: Readiness): Readiness => (RANK[a] >= RANK[b] ? a : b);

const SYS: Record<Mode, string> = {
  AMC: 'AMC', COMAIR: 'DLA-TRACK', COD: 'R-SUPPLY', VERTREP: 'SKED', SEALIFT: 'DLA-TRACK', TRUCK: 'R-SUPPLY', COURIER: 'CMS', DATA: 'AMHS', ORDERS: 'NSIPS',
};

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function km([lon1, lat1]: LonLat, [lon2, lat2]: LonLat) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

function marginOf(rr: RequirementResult, horizon: [number, number]): { margin: number; kind: MarginKind } {
  if (rr.status === 'UNK') return { margin: rr.margin, kind: 'unknown' };
  if (rr.margin === -Infinity) return { margin: -Infinity, kind: 'never' };
  if (rr.margin === Infinity) return { margin: Math.max(0, horizon[1] - rr.window[1]), kind: 'atLeast' };
  return { margin: rr.margin, kind: 'exact' };
}

function shipCaps(spec: ShipSpec): { cap: FleetCap; requiredBy: number }[] {
  const m = spec.mission ? MISSIONS.find((x) => x.id === spec.mission) : undefined;
  if (m) {
    const caps = new Set<FleetCap>(['MOB', ...m.reqs.filter((r) => r.ships.includes(spec.hull)).map((r) => r.cap)]);
    return [...caps].map((cap) => ({ cap, requiredBy: m.startH }));
  }
  return (spec.caps ?? ['MOB']).map((cap) => ({ cap, requiredBy: spec.dueH ?? 168 }));
}

/** Routine resupply so the picture shows the full flow, not just the problems. Deterministic per hull. */
function routineFor(spec: ShipSpec, caps: { cap: FleetCap; requiredBy: number }[]): Issue[] {
  if (spec.detail) return [];
  const r = rng(hash(spec.hull));
  const big = /^(CVN|LHA|T-A)/.test(spec.hull);
  const n = big ? 4 : 2 + (r() < 0.45 ? 1 : 0);
  const depots = ROUTINE_DEPOTS[spec.fleet];
  const req = Math.min(...caps.map((c) => c.requiredBy));
  const maxEta = Math.max(2, Math.min(req - 36, req * 0.5, 240));
  const out: Issue[] = [];
  for (let i = 0; i < n; i++) {
    const cap = caps[Math.floor(r() * caps.length)].cap;
    const from = depots[Math.floor(r() * depots.length)];
    const item = ROUTINE_ITEMS[Math.floor(r() * ROUTINE_ITEMS.length)];
    const eta = Math.round(1 + r() * (maxEta - 1));
    const repair = 1 + Math.floor(r() * 3);
    const p = PLACES[from];
    const far = km([p.lon, p.lat], spec.pos) > 400;
    const mode: Mode = spec.state === 'underway' ? (big && r() < 0.6 ? 'COD' : 'VERTREP') : far ? 'COMAIR' : 'TRUCK';
    out.push({ kind: 'part', cap, item, from, to: 'ship', eta, repair, mode, routine: true });
  }
  return out;
}

type Movement = { kind: Issue['kind']; mode: Mode; from: string; to: string; via?: 'suez'; windows?: Issue['windows'] };

function hits(d: Disruption, i: Movement) {
  const m = d.match;
  if (m.mode && !m.mode.includes(i.mode)) return false;
  if (m.via && i.via !== m.via) return false;
  if (m.from && !m.from.includes(i.from)) return false;
  if (m.kind && i.kind !== m.kind) return false;
  if (m.place && i.from !== m.place && i.to !== m.place && !(i.windows ?? []).some((w) => w.at === m.place)) return false;
  return true;
}

function disrupt(i: Issue, active: Disruption[]) {
  const ids: string[] = [];
  let eta = i.eta;
  let windows = i.windows;
  let stale = false;
  for (const d of active) {
    if (!hits(d, i)) continue;
    ids.push(d.id);
    eta += d.delayH ?? 0;
    if (d.stale) stale = true;
    if (d.closePlace && windows) {
      const { place, until } = d.closePlace;
      windows = windows.map((w) => (w.at === place ? { ...w, start: Math.max(w.start, until) } : w));
    }
  }
  return { issue: { ...i, eta, windows }, ids, stale };
}

function capRes(g: GraphSpec, r: EngineResult, id: string): FleetCapRes {
  const rr = r.requirements[id];
  const spec = g.nodes.find((n) => n.id === id)!;
  const leaf = rr.leaves[0];
  const leafNode = leaf ? g.nodes.find((n) => n.id === leaf.node) : undefined;
  const slot = leaf?.terminal === 'slot' && leafNode?.kind === 'gate' ? leafNode.slots.find((s) => s.id === r.nodes[leaf.node]?.slot?.id) : undefined;
  const controlling = leaf ? (slot ? `${leafNode!.label} · ${slot.label}` : leafNode?.label ?? leaf.label) : 'Nothing limits it in the horizon';
  const m = marginOf(rr, g.horizon);
  return {
    cap: spec.kind === 'requirement' ? spec.code ?? id : id, label: spec.label, status: rr.status, margin: m.margin, marginKind: m.kind,
    requiredBy: rr.window[0], controlling,
  };
}

interface Slack {
  toFailure: number;
  noImpact: number;
  recoverable: boolean;
  unbounded: boolean;
}

function slackOf(g: GraphSpec, ctx: ComputeContext, r: EngineResult, node: string, cap: string): Slack {
  const s = slackFor(g, ctx, node, cap, r, { maxH: SLACK_MAX, tol: 0.05 });
  if (s.baseMargin >= 0) return { toFailure: s.toFailure, noImpact: s.noImpact, recoverable: true, unbounded: s.noImpact === Infinity };
  if (!Number.isFinite(s.baseMargin)) return { toFailure: -Infinity, noImpact: s.noImpact, recoverable: false, unbounded: false };
  const back = compute(applyPatches(g, [{ op: 'shift', id: node, hours: s.baseMargin - 0.05 }]), { ...ctx, hash: false });
  return { toFailure: s.baseMargin, noImpact: s.noImpact, recoverable: (back.requirements[cap]?.margin ?? -Infinity) >= 0, unbounded: false };
}

/** A package that cannot recover its capability (something else is failing it) is only red if it is on the chain. */
function pkgTone(sl: Slack, onChain: boolean): PkgTone {
  if (!sl.recoverable) return onChain ? 'crit' : 'risk';
  return sl.toFailure < 0 ? 'crit' : sl.toFailure < FLEET_Q ? 'risk' : 'ok';
}

function shipStatus(spec: ShipSpec, caps: FleetCapRes[]): { status: ShipStatus; worst: FleetCapRes | null } {
  let worst: FleetCapRes | null = null;
  for (const c of caps) if (!worst || RANK[c.status] > RANK[worst.status] || (c.status === worst.status && c.margin < worst.margin)) worst = c;
  return { status: spec.state === 'maint' ? 'M' : (worst?.status ?? 'Y'), worst };
}

const CTX: ComputeContext = { now: 0, routines: new RoutineRegistry(), hash: false };
const g0 = -24 * 30;
const readyAt = (r: EngineResult, id: string, now: number) => firstFrom(r.nodes[id]?.timeline ?? [], now);

function buildGenerated(spec: ShipSpec, active: Disruption[], count: { n: number }): FleetShip {
  const caps = shipCaps(spec);
  const nodes: NodeSpec[] = [];
  const req = new Map<string, NodeSpec & { kind: 'requirement' }>();
  for (const c of caps) {
    nodes.push({ id: `sys_${c.cap}`, kind: 'event', label: `${CAP_LABEL[c.cap]} systems`, domain: 'maintenance', at: 0, prov: { sources: [{ system: 'OMMS-NG', recordId: `${spec.hull}-${c.cap}`, observedAt: 0 }] } });
    const r = { id: `c_${c.cap}`, kind: 'requirement' as const, code: c.cap, label: CAP_LABEL[c.cap], domain: 'readiness', deps: [`sys_${c.cap}`], window: { start: c.requiredBy, end: c.requiredBy }, qMargin: FLEET_Q };
    nodes.push(r);
    req.set(c.cap, r);
  }
  const issues = [...spec.issues, ...routineFor(spec, caps)];
  const moved: { issue: Issue; node: string; cap: string; ids: string[] }[] = [];
  issues.forEach((raw, j) => {
    const { issue: i, ids, stale } = disrupt(raw, active);
    const cap = req.get(i.cap);
    if (!cap) return;
    const prov = { sources: [{ system: SYS[i.mode], recordId: `${spec.hull}-${String(j + 1).padStart(3, '0')}`, observedAt: stale ? -72 : 0 }] };
    const flags = stale ? (['stale'] as const) : [];
    let tail: string;
    if (i.kind === 'person') {
      tail = `p_${j}`;
      nodes.push({ id: tail, kind: 'person', label: i.item, domain: 'personnel', unavailable: [{ start: g0, end: i.eta, reason: 'away' }], prov, flags: [...flags] });
    } else {
      tail = `in_${j}`;
      nodes.push({ id: tail, kind: 'event', label: i.item, domain: i.kind === 'data' ? 'comms' : 'logistics', at: i.eta, prov, flags: [...flags] });
    }
    const node = tail;
    if (i.windows?.length) {
      const g = `g_${j}`;
      nodes.push({
        id: g, kind: 'gate', label: `${i.item} delivered`, domain: 'logistics', deps: [tail], mode: 'arrive',
        slots: i.windows.map((w, k) => ({ id: `w${k}`, label: w.label, start: w.start, end: w.end, enabled: w.enabled, authority: w.authority })),
      });
      tail = g;
    }
    if (i.repair) {
      const t = `t_${j}`;
      nodes.push({ id: t, kind: 'task', label: i.kind === 'data' ? `Load ${i.item}` : `Install & test: ${i.item}`, domain: 'maintenance', deps: [tail], duration: i.repair });
      tail = t;
    }
    cap.deps = [...cap.deps, tail];
    moved.push({ issue: i, node, cap: cap.id, ids });
  });

  const g: GraphSpec = { id: `fleet:${spec.hull}`, horizon: [g0, 24 * 60], nodes, qMargin: FLEET_Q };
  const res = compute(g, CTX);
  count.n++;
  const capList = [...req.values()].map((r) => capRes(g, res, r.id));
  const packages: FleetPackage[] = moved.map(({ issue: i, node, cap, ids }, j) => {
    const sl = slackOf(g, CTX, res, node, cap);
    count.n++;
    const from = PLACES[i.from];
    const to = i.to === 'ship' ? null : PLACES[i.to];
    const rr = res.requirements[cap];
    return {
      id: `${spec.hull}:${j}`, hull: spec.hull, item: i.item, kind: i.kind, mode: i.mode, cap: (req.get(i.cap)!.code ?? i.cap),
      fromName: from.name, toName: to ? to.name : spec.hull, from: [from.lon, from.lat], to: to ? [to.lon, to.lat] : spec.pos,
      eta: readyAt(res, node, 0), slack: sl.toFailure, noImpact: sl.noImpact, recoverable: sl.recoverable, unbounded: sl.unbounded,
      onChain: rr.chain.includes(node), tone: pkgTone(sl, rr.chain.includes(node)), hits: ids, routine: !!i.routine,
    };
  });
  return { spec, pos: spec.pos, caps: capList, ...shipStatus(spec, capList), packages };
}

let detailCache: ReturnType<typeof detailBase> | undefined;

/** ATLAS SHIELD as the watch stands after the last scripted report. */
function detailBase() {
  const s = sessionFor(ATLAS_SHIELD);
  const events = ATLAS_SHIELD.events();
  const at = events[events.length - 1].t + 1;
  const ev = s.evaluate(at);
  return { at, graph: ev.graph, ctx: ev.ctx };
}

function buildDetail(spec: ShipSpec, active: Disruption[], count: { n: number }): FleetShip {
  detailCache ??= detailBase();
  const { at, graph: base, ctx } = detailCache;
  const d = atlasShieldDisplay;
  const ids = new Set(base.nodes.map((n) => n.id));
  const patches: Patch[] = [];
  const hit: Record<string, string[]> = {};
  for (const leg of d.legs) {
    const meta = DETAIL_LEGS['atlas-shield'][leg.id];
    if (!meta || !ids.has(meta.node)) continue;
    const mv: Movement = { kind: meta.kind, mode: meta.mode, from: meta.from, to: leg.to, via: meta.via };
    for (const dis of active) {
      if (!hits(dis, mv)) continue;
      (hit[leg.id] ??= []).push(dis.id);
      if (dis.delayH) patches.push({ op: 'shift', id: meta.node, hours: dis.delayH });
      if (dis.stale) {
        const n = base.nodes.find((x) => x.id === meta.node)!;
        patches.push({ op: 'set', id: meta.node, fields: { flags: [...new Set([...(n.flags ?? []), 'stale'])] } });
      }
    }
  }
  const g = applyPatches(base, patches);
  const res = compute(g, { ...ctx, hash: false });
  count.n++;
  const reqIds = Object.keys(res.requirements);
  const caps = reqIds.map((id) => capRes(g, res, id));
  const pos = (positionAt(d.tracks[d.ownShip.id], at) as LonLat | undefined) ?? spec.pos;
  const place = (pid: string): LonLat | null => {
    const p = d.places[pid];
    return p ? [p.lon, p.lat] : null;
  };
  const packages: FleetPackage[] = [];
  for (const leg of d.legs) {
    const meta = DETAIL_LEGS['atlas-shield'][leg.id];
    if (!meta || !ids.has(meta.node)) continue;
    const down = downstreamOf(g, meta.node);
    const targets = reqIds.filter((id) => down.has(id));
    if (!targets.length) continue;
    let best: { sl: Slack; id: string } | null = null;
    for (const id of targets) {
      const sl = slackOf(g, { ...ctx, hash: false }, res, meta.node, id);
      count.n++;
      if (!best || sl.toFailure < best.sl.toFailure) best = { sl, id };
    }
    const used = leg.bySlot ? res.nodes[leg.nodeId]?.slot?.id : undefined;
    const toId = used && leg.bySlot?.[used] ? leg.bySlot[used] : leg.to;
    const from = place(leg.from) ?? pos;
    const to = toId === 'ship' ? pos : (place(toId) ?? pos);
    const { sl, id } = best!;
    const rr = res.requirements[id];
    packages.push({
      id: `${spec.hull}:${leg.id}`, hull: spec.hull, item: leg.label, kind: meta.kind, mode: meta.mode, cap: caps[reqIds.indexOf(id)].cap,
      fromName: d.places[leg.from]?.name ?? leg.from, toName: toId === 'ship' ? spec.hull : (d.places[toId]?.name ?? toId), from, to,
      eta: readyAt(res, meta.node, at) - at, slack: sl.toFailure, noImpact: sl.noImpact, recoverable: sl.recoverable, unbounded: sl.unbounded,
      onChain: rr.chain.includes(meta.node), tone: pkgTone(sl, rr.chain.includes(meta.node)), hits: hit[leg.id] ?? [], routine: false,
    });
  }
  return { spec, pos, caps, ...shipStatus(spec, caps), packages };
}

function contribution(ship: FleetShip | undefined, hull: string, cap: FleetCap): Contribution {
  const c = ship?.caps.find((x) => x.cap === cap);
  if (!ship || !c) return { hull, margin: -Infinity, status: 'N', reason: `${cap} not tracked` };
  // The detailed scenario already times every capability chain to its own mission; generated hulls share one required-by.
  const mob = cap === 'MOB' || ship.spec.detail ? undefined : ship.caps.find((x) => x.cap === 'MOB');
  const mobWorse = mob && (RANK[mob.status] > RANK[c.status] || (mob.status === c.status && mob.margin < c.margin));
  return {
    hull,
    margin: Math.min(c.margin, mob?.margin ?? Infinity),
    status: worse(c.status, mob?.status ?? 'Y'),
    reason: mobWorse ? `Mobility: ${mob!.controlling}` : c.controlling,
  };
}

function rollup(m: MissionSpec, byHull: Map<string, FleetShip>): FleetMission {
  const reqs: ReqRes[] = m.reqs.map((r) => {
    const contributions = r.ships.map((h) => contribution(byHull.get(h), h, r.cap));
    const ranked = [...contributions].sort((a, b) => RANK[a.status] - RANK[b.status] || b.margin - a.margin);
    const selected = ranked.slice(0, r.k);
    if (selected.length < r.k) return { cap: r.cap, k: r.k, n: r.ships.length, margin: -Infinity, status: 'N' as Readiness, selected, absorbed: [], contributions };
    const weakest = selected.reduce((a, b) => (RANK[b.status] > RANK[a.status] || (b.status === a.status && b.margin < a.margin) ? b : a));
    // Only "absorbed" if the redundancy actually holds the requirement.
    const absorbed = weakest.status === 'N' ? [] : ranked.slice(r.k).filter((c) => c.status === 'N');
    return { cap: r.cap, k: r.k, n: r.ships.length, margin: Math.min(...selected.map((c) => c.margin)), status: weakest.status, selected, absorbed, contributions };
  });
  let ctl: ReqRes | null = null;
  for (const r of reqs) if (!ctl || RANK[r.status] > RANK[ctl.status] || (r.status === ctl.status && r.margin < ctl.margin)) ctl = r;
  const weakest = ctl?.selected.reduce((a, b) => (RANK[b.status] > RANK[a.status] || (b.status === a.status && b.margin < a.margin) ? b : a), ctl.selected[0]);
  return {
    spec: m,
    status: reqs.reduce<Readiness>((s, r) => worse(s, r.status), 'Y'),
    margin: Math.min(...reqs.map((r) => r.margin)),
    reqs,
    controlling: ctl && weakest ? { hull: weakest.hull, cap: ctl.cap, reason: weakest.reason } : null,
  };
}

export function fleetCatalog(): FleetCatalog {
  return { places: PLACES, fleets: FLEET_NAME, capLabels: CAP_LABEL, disruptions: DISRUPTIONS, missions: MISSIONS, ships: SHIPS, q: FLEET_Q };
}

export function buildFleet(activeIds: string[] = []): FleetPicture {
  const t0 = performance.now();
  const active = DISRUPTIONS.filter((d) => activeIds.includes(d.id));
  const count = { n: 0 };
  const ships = SHIPS.map((spec) => (spec.detail ? buildDetail(spec, active, count) : buildGenerated(spec, active, count)));
  const byHull = new Map(ships.map((s) => [s.spec.hull, s]));
  const missions = MISSIONS.map((m) => rollup(m, byHull));
  const packages = ships.flatMap((s) => s.packages);
  return { ships, missions, packages, active: active.map((d) => d.id), graphs: count.n, ms: performance.now() - t0 };
}

export { DISRUPTIONS, MISSIONS as FLEET_MISSIONS, SHIPS as FLEET_SHIPS };
