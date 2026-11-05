import {
  contains, covering, depsOf, firstFrom, relabel, shiftable, timelineDeps, toMap, UNCERTAIN_FLAGS,
  type Cause, type EngineResult, type GraphSpec, type NodeResult, type NodeSpec, type Num, type RequirementNode, type RequirementResult,
} from '../engine';
import type {
  CapabilityView, Control, ControllingConstraint, Domain, EngineKind, EngineView, MarginKind, NodeKind, NodeState, QualityFlag, ShipPart, SourceRef, ViewNode,
} from './contract';
import { fmtT, type TimeFrame } from './format';

/**
 * Engine graph and results → the shapes the HAWSIR screens draw. This is a
 * lossless-where-it-matters projection: every number shown comes straight from
 * the engine; only presentation (display class, ship part, clamped times) is
 * added here.
 */
const DISPLAY: Record<EngineKind, NodeKind> = {
  event: 'input', window: 'input', scalar: 'input', routine: 'input', check: 'input', stock: 'input',
  person: 'person', task: 'task', delay: 'task', gate: 'gate', all: 'all', threshold: 'all', any: 'any', kofn: 'kofn', requirement: 'capability',
};

const DOMAINS: Domain[] = ['maintenance', 'logistics', 'personnel', 'schedule', 'capability', 'ordnance', 'comms'];
const DOMAIN_ALIAS: Record<string, Domain> = { readiness: 'capability', fuel: 'logistics', c2: 'comms', aviation: 'schedule', network: 'logistics' };

function domainOf(n: NodeSpec): Domain {
  if (n.kind === 'requirement') return 'capability';
  const d = n.domain ?? '';
  return (DOMAINS as string[]).includes(d) ? (d as Domain) : DOMAIN_ALIAS[d] ?? 'schedule';
}

const PART_RULES: [RegExp, ShipPart][] = [
  [/satcom|modem/i, 'satcom'],
  [/link.?16|relay|launch.authority|c2:/i, 'link16'],
  [/spy|radar|aegis|\bAW\b|air.?defen/i, 'spy_a'],
  [/tlam|vls|\bSM\b|salvo|magazine|mag:|strike|STW/i, 'vls'],
  [/fuel|unrep|consol|replenish/i, 'gtm'],
  [/emcon/i, 'ew'],
  [/helo|cod|cross.?deck|vertrep/i, 'helo'],
  [/person|team|crew|\bET\d?\b|\bFC\d?\b/i, 'crew'],
  [/MOB|propuls|engine/i, 'gtm'],
];

function partOf(n: NodeSpec, ownShip: string): ShipPart | undefined {
  const tag = n.tags?.find((t) => t.startsWith('part:'));
  if (tag) return tag.slice(5) as ShipPart;
  if (n.owner !== ownShip) return undefined;
  if (n.kind === 'person') return 'crew';
  const text = `${n.id} ${n.label}`;
  return PART_RULES.find(([re]) => re.test(text))?.[1];
}

function numOf(x: Num | null | undefined, res: Record<string, NodeResult>): number | null | undefined {
  if (x === null || x === undefined) return x;
  if (typeof x === 'number') return x;
  const v = res[x.ref]?.value;
  return typeof v === 'number' ? v : null;
}

function sourcesOf(n: NodeSpec): SourceRef[] {
  return (n.prov?.sources ?? []).map((s) => ({ system: s.system, recordId: s.recordId ?? '', asOf: s.observedAt ?? 0, factId: s.factId, note: s.note }));
}

export function viewNode(n: NodeSpec, res: Record<string, NodeResult>, now: number, ownShip: string): ViewNode {
  const crewPool = n.kind === 'task' ? n.crew?.pool ?? [] : [];
  const v: ViewNode = {
    id: n.id,
    kind: DISPLAY[n.kind],
    engineKind: n.kind,
    label: n.label,
    domain: domainOf(n),
    deps: depsOf(n).filter((d) => !crewPool.includes(d)),
    owner: n.owner,
    part: partOf(n, ownShip),
    detail: n.detail,
    sources: sourcesOf(n),
    flags: [...(n.flags ?? [])] as QualityFlag[],
    shiftable: shiftable(n, now),
    uncertainty: n.uncertainty && (n.uncertainty.kind ?? 'delay') === 'delay' ? { min: n.uncertainty.min, mode: n.uncertainty.mode, max: n.uncertainty.max } : undefined,
  };
  switch (n.kind) {
    case 'event':
      v.value = numOf(n.at, res);
      v.assumed = n.assumedAt;
      break;
    case 'person':
      v.value = n.from ?? null;
      v.rate = n.rate;
      v.qual = n.qual;
      v.unavailable = n.unavailable?.map((u) => ({ start: u.start, end: u.end, reason: u.reason }));
      break;
    case 'task':
      v.duration = numOf(n.duration, res) ?? null;
      v.assumedDuration = n.assumedDuration;
      if (n.crew) v.crew = { pool: n.crew.pool, k: n.crew.k, label: n.crew.label ?? `${n.crew.k} qualified` };
      break;
    case 'delay':
      v.duration = numOf(n.lag, res) ?? null;
      break;
    case 'kofn':
      v.k = n.k;
      break;
    case 'gate':
      v.windows = n.slots.map((s) => ({
        id: s.id, label: s.label, start: s.start, end: s.end, lag: numOf(s.lag, res) ?? undefined, enabled: s.enabled !== false,
        disabledReason: s.disabledReason, authority: s.authority,
      }));
      break;
    case 'requirement': {
      v.code = n.code ?? n.id;
      v.requiredBy = numOf(n.window.start, res) ?? undefined;
      v.qMargin = n.qMargin;
      v.level = n.level;
      break;
    }
    case 'stock':
    case 'scalar':
      v.unit = n.unit;
      break;
    default:
      break;
  }
  return v;
}

/** When the node is (or next becomes) available as seen from `now`, clamped to the horizon start. */
export function readyOf(r: NodeResult | undefined, now: number, h0: number): number {
  if (!r) return Infinity;
  if (!r.timeline) return h0;
  const iv = covering(r.timeline, now);
  if (iv) return Math.max(iv[0], h0);
  const next = firstFrom(r.timeline, now);
  return Number.isFinite(next) ? Math.max(next, h0) : Infinity;
}

const near = (a: number, b: number) => a === b || Math.abs(a - b) < 1e-6;

function bindingOf(n: NodeSpec, ready: (id: string) => number): string[] {
  const deps = timelineDeps(n);
  if (!deps.length) return [];
  const rs = deps.map((d) => ({ d, t: ready(d) }));
  let pick: number;
  if (n.kind === 'any') pick = Math.min(...rs.map((x) => x.t));
  else if (n.kind === 'kofn') pick = rs.map((x) => x.t).sort((a, b) => a - b)[Math.min(n.k, rs.length) - 1];
  else pick = Math.max(...rs.map((x) => x.t));
  return rs.filter((x) => near(x.t, pick)).map((x) => x.d);
}

export function nodeState(n: NodeSpec, r: NodeResult | undefined, now: number, h0: number, ready: (id: string) => number): NodeState {
  const t = readyOf(r, now, h0);
  const binding = bindingOf(n, ready);
  let control: Control;
  if (!Number.isFinite(t)) control = { type: 'unreachable', reason: r?.notes[0] ?? 'not available inside the planning horizon' };
  else if (r?.slot?.waited) control = { type: 'window', windowId: r.slot.id, waitFrom: Math.max(...binding.map(ready).filter(Number.isFinite), h0) };
  else if (r?.crew?.waitedFor.length) control = { type: 'crew', waitFrom: r.start ?? t };
  else if (binding.length) control = { type: 'deps' };
  else control = { type: 'self' };
  return {
    id: n.id,
    ready: t,
    upNow: r?.timeline ? contains(r.timeline, now) : true,
    start: r?.start,
    predsReady: binding.length ? ready(binding[0]) : undefined,
    binding,
    control,
    usedWindow: r?.slot?.id,
    crew: r?.crew ? { need: r.crew.need, assigned: r.crew.assigned } : undefined,
    value: typeof r?.value === 'number' || r?.value === null ? r.value : r?.series?.length ? r.series[r.series.length - 1].v : undefined,
    unit: r?.unit,
    flags: (r?.flags ?? []) as QualityFlag[],
    notes: r?.notes ?? [],
  };
}

const TERMINAL_KIND: Record<string, ControllingConstraint['kind']> = {
  'input-time': 'input', missing: 'input', value: 'input', unreachable: 'input', lag: 'input', 'late-transfer': 'input',
  person: 'person', window: 'window', slot: 'window', duration: 'duration', crew: 'crew', consumption: 'stock', expenditure: 'stock', check: 'check',
};

export function marginOf(rr: RequirementResult, horizon: [number, number]): { margin: number; kind: MarginKind } {
  if (rr.status === 'UNK') return { margin: rr.margin, kind: 'unknown' };
  if (rr.margin === -Infinity) return { margin: -Infinity, kind: 'never' };
  if (rr.margin === Infinity) return { margin: Math.max(0, horizon[1] - rr.window[1]), kind: 'atLeast' };
  return { margin: rr.margin, kind: 'exact' };
}

export function capabilityView(rr: RequirementResult, spec: RequirementNode, g: GraphSpec, res: EngineResult, frame: TimeFrame): CapabilityView {
  const nodes = toMap(g);
  const rel = (s: string) => relabel(s, {}).replace(/t=(-?\d+(?:\.\d+)?)/g, (_, x) => fmtT(frame, Number(x)));
  const tl = (s: string) => s.replace(/t=(-?\d+(?:\.\d+)?|-?Infinity)/g, (_, x) => fmtT(frame, Number(x)));
  const leaves = rr.leaves.map((c: Cause) => ({ node: c.node, label: nodes[c.node]?.label ?? c.label, why: tl(rel(c.why)), terminal: c.terminal }));
  const first = rr.leaves[0];
  const controlling: ControllingConstraint = first
    ? {
        nodeId: first.node,
        kind: TERMINAL_KIND[first.terminal ?? ''] ?? 'input',
        label: nodes[first.node]?.label ?? first.label,
        detail: tl(rel(first.why)),
        windowId: first.terminal === 'slot' ? res.nodes[first.node]?.slot?.id : undefined,
      }
    : { nodeId: rr.id, kind: 'input', label: 'Nothing limits it inside the horizon', detail: 'Up now and stays up through the end of the planning horizon' };
  const { margin, kind } = marginOf(rr, g.horizon);
  const watch: QualityFlag[] = [...(UNCERTAIN_FLAGS as QualityFlag[]), 'no-redundancy', 'degraded'];
  const flagsOnChain = rr.chain.flatMap((id) => (res.nodes[id]?.flags ?? []).filter((f) => watch.includes(f as QualityFlag)).map((flag) => ({ nodeId: id, flag: flag as QualityFlag })));
  return {
    id: rr.id,
    code: spec.code ?? rr.id,
    label: spec.label,
    owner: spec.owner,
    level: spec.level,
    ready: rr.cover ? Math.max(rr.cover[0], g.horizon[0]) : Infinity,
    requiredBy: rr.window[0],
    window: rr.window,
    margin,
    marginKind: kind,
    status: rr.status,
    upNow: rr.upNow,
    chain: rr.chain,
    coCritical: [...new Set(rr.leaves.slice(1).map((c) => c.node))].filter((id) => id !== first?.node),
    controlling,
    leaves,
    bindingEdge: rr.bindingEdge,
    quantity: rr.quantity.map((q) => ({ stock: q.stock, unit: q.unit, level: q.level, minInWindow: q.minInWindow, minAt: q.minAt, margin: q.margin, hours: q.hours })),
    reasons: rr.reasons.map(tl),
    flagsOnChain,
  };
}

/** Requirements the screens show, most important first: the mission's focus, then the rest by level. */
export function orderedRequirements(g: GraphSpec, focus: string[]): RequirementNode[] {
  const reqs = g.nodes.filter((n): n is RequirementNode => n.kind === 'requirement');
  const rank = (n: RequirementNode) => {
    const i = focus.indexOf(n.id);
    if (i >= 0) return i;
    return 100 + ({ mission: 0, group: 1, phase: 2, asset: 3 }[n.level ?? 'asset'] ?? 4);
  };
  return reqs.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

export function engineView(g: GraphSpec, r: EngineResult, focus: string[], frame: TimeFrame): EngineView {
  const now = r.now;
  const h0 = g.horizon[0];
  const memo = new Map<string, number>();
  const ready = (id: string) => {
    let v = memo.get(id);
    if (v === undefined) {
      v = readyOf(r.nodes[id], now, h0);
      memo.set(id, v);
    }
    return v;
  };
  const nodes: Record<string, NodeState> = {};
  for (const n of g.nodes) nodes[n.id] = nodeState(n, r.nodes[n.id], now, h0, ready);
  const capabilities = orderedRequirements(g, focus)
    .filter((n) => r.requirements[n.id])
    .map((n) => capabilityView(r.requirements[n.id], n, g, r, frame));
  return { at: now, graphHash: r.graphHash, nodes, capabilities, order: r.order, errors: r.errors };
}

export function viewNodes(g: GraphSpec, r: EngineResult, ownShip: string): ViewNode[] {
  return g.nodes.map((n) => viewNode(n, r.nodes, r.now, ownShip));
}
