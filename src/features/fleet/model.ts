import { shiftNode, stateAt, type NodeMap } from '@/engine/apply';
import { slackFor } from '@/engine/analysis';
import { compute, downstreamOf } from '@/engine/compute';
import type { CapabilityResult, NodeDef, Readiness, Scenario, SourceSystem } from '@/engine/types';
import { scenarioById } from '@/data/scenarios';
import {
  CAP_LABEL,
  DETAIL_LEGS,
  DISRUPTIONS,
  MISSIONS,
  PLACES,
  ROUTINE_DEPOTS,
  ROUTINE_ITEMS,
  SHIPS,
  type Disruption,
  type FleetCap,
  type Issue,
  type MissionSpec,
  type Mode,
  type ShipSpec,
} from '@/data/fleet';
import { positionAt } from '@/features/theater/geo';

/** Fleet-level Q threshold: a mission or ship with less than this margin is rated Q. */
export const FLEET_Q = 24;
const FLEET_S: Pick<Scenario, 'thresholds'> = { thresholds: { qMargin: FLEET_Q, cliff: 12 } };
const SLACK_MAX = 24 * 30;

export type LonLat = [number, number];
export type ShipStatus = Readiness | 'M';
export type PkgTone = 'crit' | 'risk' | 'ok';

export interface FleetCapRes {
  cap: string;
  label: string;
  status: Readiness;
  margin: number;
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

export interface FleetPicture {
  ships: FleetShip[];
  missions: FleetMission[];
  packages: FleetPackage[];
  active: string[];
  ms: number;
}

const RANK: Record<Readiness, number> = { Y: 0, Q: 1, N: 2 };
const worse = (a: Readiness, b: Readiness): Readiness => (RANK[a] >= RANK[b] ? a : b);

const SYS: Record<Mode, SourceSystem> = {
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

export function missionOf(hull: string) {
  const spec = SHIPS.find((s) => s.hull === hull);
  return spec?.mission ? MISSIONS.find((m) => m.id === spec.mission) : undefined;
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

function capRes(c: CapabilityResult, nodes: NodeMap): FleetCapRes {
  const gate = c.controlling.kind === 'window' ? nodes[c.controlling.nodeId] : undefined;
  const controlling = gate ? `${gate.label} · ${c.controlling.label}` : c.controlling.label;
  return { cap: c.code, label: c.label, status: c.status, margin: c.margin, requiredBy: c.requiredBy, controlling };
}

/** A package that cannot recover its capability (something else is failing it) is only red if it is on the chain. */
function pkgTone(sl: { toFailure: number; recoverable: boolean }, onChain: boolean): PkgTone {
  if (!sl.recoverable) return onChain ? 'crit' : 'risk';
  return sl.toFailure < 0 ? 'crit' : sl.toFailure < FLEET_Q ? 'risk' : 'ok';
}

function shipStatus(spec: ShipSpec, caps: FleetCapRes[]): { status: ShipStatus; worst: FleetCapRes | null } {
  let worst: FleetCapRes | null = null;
  for (const c of caps) if (!worst || RANK[c.status] > RANK[worst.status] || (c.status === worst.status && c.margin < worst.margin)) worst = c;
  return { status: spec.state === 'maint' ? 'M' : (worst?.status ?? 'Y'), worst };
}

function buildGenerated(spec: ShipSpec, active: Disruption[]): FleetShip {
  const caps = shipCaps(spec);
  const nodes: NodeMap = {};
  for (const c of caps) {
    nodes[`sys_${c.cap}`] = {
      id: `sys_${c.cap}`, kind: 'input', label: `${CAP_LABEL[c.cap]} systems`, domain: 'maintenance', value: 0,
      sources: [{ system: 'OMMS-NG', recordId: `${spec.hull}-${c.cap}`, asOf: 0 }],
    };
    nodes[`c_${c.cap}`] = {
      id: `c_${c.cap}`, kind: 'capability', code: c.cap, label: CAP_LABEL[c.cap], domain: 'capability',
      deps: [`sys_${c.cap}`], requiredBy: c.requiredBy, qMargin: FLEET_Q,
    };
  }

  const issues = [...spec.issues, ...routineFor(spec, caps)];
  const moved: { issue: Issue; node: string; cap: string; ids: string[] }[] = [];
  issues.forEach((raw, j) => {
    const { issue: i, ids, stale } = disrupt(raw, active);
    const cap = nodes[`c_${i.cap}`];
    if (!cap) return;
    const src = { system: SYS[i.mode], recordId: `${spec.hull}-${String(j + 1).padStart(3, '0')}`, asOf: stale ? -72 : 0 };
    const quality: Partial<NodeDef> = stale ? { staleAfter: 12 } : {};
    let tail: string;
    if (i.kind === 'person') {
      tail = `p_${j}`;
      nodes[tail] = { id: tail, kind: 'person', label: i.item, domain: 'personnel', value: i.eta, sources: [src], ...quality };
    } else {
      tail = `in_${j}`;
      nodes[tail] = { id: tail, kind: 'input', label: i.item, domain: i.kind === 'data' ? 'comms' : 'logistics', value: i.eta, sources: [src], ...quality };
    }
    const node = tail;
    if (i.windows?.length) {
      const g = `g_${j}`;
      nodes[g] = {
        id: g, kind: 'gate', label: `${i.item} delivered`, domain: 'logistics', deps: [tail],
        windows: i.windows.map((w, k) => ({ id: `w${k}`, label: w.label, start: w.start, end: w.end, enabled: w.enabled, authority: w.authority })),
      };
      tail = g;
    }
    if (i.repair) {
      const t = `t_${j}`;
      nodes[t] = { id: t, kind: 'task', label: i.kind === 'data' ? `Load ${i.item}` : `Install & test: ${i.item}`, domain: 'maintenance', deps: [tail], duration: i.repair };
      tail = t;
    }
    cap.deps = [...(cap.deps ?? []), tail];
    moved.push({ issue: i, node, cap: cap.id, ids });
  });

  const res = compute(FLEET_S, nodes, 0);
  const caps2 = res.capabilities.map((c) => capRes(c, nodes));
  const packages: FleetPackage[] = moved.map(({ issue: i, node, cap, ids }, j) => {
    const sl = slackFor(FLEET_S, nodes, 0, node, cap, SLACK_MAX);
    const from = PLACES[i.from];
    const to = i.to === 'ship' ? null : PLACES[i.to];
    const capR = res.capabilities.find((c) => c.id === cap)!;
    return {
      id: `${spec.hull}:${j}`,
      hull: spec.hull,
      item: i.item,
      kind: i.kind,
      mode: i.mode,
      cap: capR.code,
      fromName: from.name,
      toName: to ? to.name : spec.hull,
      from: [from.lon, from.lat],
      to: to ? [to.lon, to.lat] : spec.pos,
      eta: res.nodes[node].ready,
      slack: sl.toFailure,
      noImpact: sl.noImpact,
      recoverable: sl.recoverable,
      unbounded: sl.unbounded,
      onChain: capR.chain.includes(node),
      tone: pkgTone(sl, capR.chain.includes(node)),
      hits: ids,
      routine: !!i.routine,
    };
  });
  return { spec, pos: spec.pos, caps: caps2, ...shipStatus(spec, caps2), packages };
}

export function detailNodes(id: 'ddg21' | 'reload72', active: Disruption[]) {
  const s = scenarioById(id);
  const last = s.events[s.events.length - 1];
  const at = s.timeScale === 'hours' ? s.watchStart : last.t + 1;
  let nodes = stateAt(s, at).nodes;
  const hit: Record<string, string[]> = {};
  for (const leg of s.legs ?? []) {
    const meta = DETAIL_LEGS[id][leg.id];
    if (!meta) continue;
    const mv: Movement = { kind: meta.kind, mode: meta.mode, from: meta.from, to: leg.to, via: meta.via };
    for (const d of active) {
      if (!hits(d, mv)) continue;
      (hit[leg.id] ??= []).push(d.id);
      const n = nodes[meta.node];
      if (!n) continue;
      if (d.delayH) nodes = { ...nodes, [meta.node]: shiftNode(nodes[meta.node], d.delayH) };
      if (d.stale) {
        const cur = nodes[meta.node];
        nodes = { ...nodes, [meta.node]: { ...cur, staleAfter: 12, sources: (cur.sources ?? [{ system: 'NSIPS', recordId: meta.node, asOf: at }]).map((x) => ({ ...x, asOf: Math.min(x.asOf, at - 72) })) } };
      }
    }
  }
  return { s, at, nodes, hit };
}

function buildDetail(spec: ShipSpec, active: Disruption[]): FleetShip {
  const id = spec.detail!;
  const { s, at, nodes, hit } = detailNodes(id, active);
  const res = compute(s, nodes, at);
  const caps = res.capabilities.map((c) => capRes(c, nodes));
  const pos: LonLat = s.track?.length ? (positionAt(s.track, at).pos as LonLat) : spec.pos;
  const place = (pid: string): LonLat | null => {
    const p = s.places?.[pid];
    return p ? [p.lon, p.lat] : null;
  };
  const packages: FleetPackage[] = [];
  for (const leg of s.legs ?? []) {
    const meta = DETAIL_LEGS[id][leg.id];
    if (!meta || !nodes[meta.node]) continue;
    const down = downstreamOf(nodes, meta.node);
    const targets = res.capabilities.filter((c) => down.has(c.id));
    if (!targets.length) continue;
    let best: { sl: ReturnType<typeof slackFor>; c: CapabilityResult } | null = null;
    for (const c of targets) {
      const sl = slackFor(s, nodes, at, meta.node, c.id, SLACK_MAX);
      if (!best || sl.toFailure < best.sl.toFailure) best = { sl, c };
    }
    const used = leg.gateId ? res.nodes[leg.gateId]?.usedWindow : undefined;
    const toId = used && leg.byWindow?.[used] ? leg.byWindow[used] : leg.to;
    const from = place(leg.from) ?? pos;
    const to = toId === 'ship' ? pos : (place(toId) ?? pos);
    const { sl, c } = best!;
    packages.push({
      id: `${spec.hull}:${leg.id}`,
      hull: spec.hull,
      item: leg.label,
      kind: meta.kind,
      mode: meta.mode,
      cap: c.code,
      fromName: s.places?.[leg.from]?.name ?? leg.from,
      toName: toId === 'ship' ? spec.hull : (s.places?.[toId]?.name ?? toId),
      from,
      to,
      eta: (res.nodes[meta.node]?.ready ?? Infinity) - at,
      slack: sl.toFailure,
      noImpact: sl.noImpact,
      recoverable: sl.recoverable,
      unbounded: sl.unbounded,
      onChain: c.chain.includes(meta.node),
      tone: pkgTone(sl, c.chain.includes(meta.node)),
      hits: hit[leg.id] ?? [],
      routine: false,
    });
  }
  return { spec, pos, caps, ...shipStatus(spec, caps), packages };
}

function contribution(ship: FleetShip | undefined, hull: string, cap: FleetCap): Contribution {
  const c = ship?.caps.find((x) => x.cap === cap);
  if (!ship || !c) return { hull, margin: -Infinity, status: 'N', reason: `${cap} not tracked` };
  // Detailed scenarios already time every capability chain to their own mission; generated hulls share one required-by.
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
    if (selected.length < r.k) return { cap: r.cap, k: r.k, n: r.ships.length, margin: -Infinity, status: 'N', selected, absorbed: [], contributions };
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

export function buildFleet(activeIds: string[] = []): FleetPicture {
  const t0 = performance.now();
  const active = DISRUPTIONS.filter((d) => activeIds.includes(d.id));
  const ships = SHIPS.map((spec) => (spec.detail ? buildDetail(spec, active) : buildGenerated(spec, active)));
  const byHull = new Map(ships.map((s) => [s.spec.hull, s]));
  const missions = MISSIONS.map((m) => rollup(m, byHull));
  const packages = ships.flatMap((s) => s.packages);
  return { ships, missions, packages, active: active.map((d) => d.id), ms: performance.now() - t0 };
}
