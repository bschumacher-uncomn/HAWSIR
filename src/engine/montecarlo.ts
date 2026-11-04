import { type NodeMap, shiftNode } from './apply';
import { compute } from './compute';
import type { Hours, NodeDef, Scenario, Tri } from './types';

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function triSample(t: Tri, u: number): number {
  const { min, mode, max } = t;
  if (max <= min) return mode;
  const c = (mode - min) / (max - min);
  return u < c ? min + Math.sqrt(u * (max - min) * (mode - min)) : max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

/** Uncertainty actually used: declared spread, widened for stale / contradictory / assumed data. */
export function effectiveUncertainty(s: Pick<Scenario, 'timeScale'>, n: NodeDef, at: Hours): Tri | undefined {
  const unit = s.timeScale === 'hours' ? 1 : 24;
  let u = n.uncertainty ? { ...n.uncertainty } : undefined;
  const missing = (n.kind === 'input' && n.value == null) || (n.kind === 'task' && n.duration == null);
  if (missing) u = u ?? { min: -0.25 * unit, mode: 0, max: 1 * unit };
  if (n.conflict && n.value != null) {
    const lo = Math.min(0, n.conflict.value - n.value);
    u = { min: Math.min(u?.min ?? 0, lo), mode: 0, max: Math.max(u?.max ?? 0, 0.25 * unit) };
  }
  if (n.staleAfter && n.sources?.length) {
    const asOf = Math.max(...n.sources.map((x) => x.asOf));
    if (at - asOf > n.staleAfter) u = { min: u?.min ?? -0.25 * unit, mode: u?.mode ?? 0, max: (u?.max ?? 0) + 1 * unit };
  }
  return u;
}

export interface MCResult {
  n: number;
  seed: number;
  targets: Record<string, { margins: Float64Array; pMeet: number; p10: number; p50: number; p90: number }>;
  criticality: Record<string, Record<string, number>>;
  controlling: Record<string, Record<string, number>>;
  uncertain: string[];
}

export interface MCRunner {
  readonly n: number;
  readonly done: number;
  step(k: number): number;
  snapshot(): MCResult;
}

/** Incremental Monte Carlo: same seed and n give the same result however the runs are chunked. */
export function createMonteCarlo(s: Scenario, nodes: NodeMap, at: Hours, n: number, seed = 1337): MCRunner {
  const rnd = mulberry32(seed);
  const uncertain = Object.values(nodes)
    .map((nd) => ({ nd, u: effectiveUncertainty(s, nd, at) }))
    .filter((x) => x.u && (x.nd.kind === 'input' || x.nd.kind === 'person' || x.nd.kind === 'task'));
  const caps = Object.values(nodes).filter((x) => x.kind === 'capability');
  const margins: Record<string, Float64Array> = {};
  const crit: Record<string, Record<string, number>> = {};
  const ctrl: Record<string, Record<string, number>> = {};
  for (const c of caps) {
    margins[c.id] = new Float64Array(n);
    crit[c.id] = {};
    ctrl[c.id] = {};
  }
  let i = 0;
  return {
    n,
    get done() {
      return i;
    },
    step(k) {
      const end = Math.min(n, i + k);
      for (; i < end; i++) {
        const sampled: NodeMap = { ...nodes };
        for (const { nd, u } of uncertain) {
          // tasks: sampled offsets can't make a duration negative
          sampled[nd.id] = shiftNode(nd, triSample(u!, rnd()));
        }
        const r = compute(s, sampled, at);
        for (const c of r.capabilities) {
          margins[c.id][i] = c.margin;
          for (const id of c.chain) crit[c.id][id] = (crit[c.id][id] ?? 0) + 1;
          const key = c.controlling.windowId ? `${c.controlling.nodeId}#${c.controlling.windowId}` : c.controlling.nodeId;
          ctrl[c.id][key] = (ctrl[c.id][key] ?? 0) + 1;
        }
      }
      return i;
    },
    snapshot() {
      const m0 = Math.max(1, i);
      const targets: MCResult['targets'] = {};
      const criticality: MCResult['criticality'] = {};
      const controlling: MCResult['controlling'] = {};
      for (const c of caps) {
        const m = margins[c.id].subarray(0, i);
        const sorted = Float64Array.from(m).sort();
        const q = (p: number) => sorted[Math.min(m0 - 1, Math.max(0, Math.floor(p * m0)))] ?? 0;
        let meet = 0;
        for (const x of m) if (x >= -1e-6) meet++;
        targets[c.id] = { margins: m, pMeet: meet / m0, p10: q(0.1), p50: q(0.5), p90: q(0.9) };
        criticality[c.id] = Object.fromEntries(Object.entries(crit[c.id]).map(([k, v]) => [k, v / m0]));
        controlling[c.id] = Object.fromEntries(Object.entries(ctrl[c.id]).map(([k, v]) => [k, v / m0]));
      }
      return { n: i, seed, targets, criticality, controlling, uncertain: uncertain.map((x) => x.nd.id) };
    },
  };
}

export function runMonteCarlo(s: Scenario, nodes: NodeMap, at: Hours, n: number, seed = 1337): MCResult {
  const r = createMonteCarlo(s, nodes, at, n, seed);
  r.step(n);
  return r.snapshot();
}

export interface TornadoBar {
  nodeId: string;
  low: number;
  high: number;
  swing: number;
}

/** One-at-a-time sensitivity: margin when each uncertain input sits at its min vs max. */
export function tornado(s: Scenario, nodes: NodeMap, at: Hours, targetId: string): TornadoBar[] {
  const out: TornadoBar[] = [];
  for (const nd of Object.values(nodes)) {
    const u = effectiveUncertainty(s, nd, at);
    if (!u || !(nd.kind === 'input' || nd.kind === 'person' || nd.kind === 'task')) continue;
    const m = (d: number) => {
      const r = compute(s, { ...nodes, [nd.id]: shiftNode(nd, d) }, at);
      return r.capabilities.find((c) => c.id === targetId)?.margin ?? 0;
    };
    const low = m(u.max);
    const high = m(u.min);
    out.push({ nodeId: nd.id, low, high, swing: Math.abs(high - low) });
  }
  return out.filter((b) => b.swing > 1e-6).sort((a, b) => b.swing - a.swing);
}
