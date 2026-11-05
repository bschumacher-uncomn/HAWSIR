import { compute, type ComputeContext } from './compute';
import type { GraphSpec, Readiness } from './graph';
import { applyPatches, type Patch } from './patch';
import { mulberry32, quantile, triSample } from './prng';

/**
 * Seeded Monte Carlo over declared uncertainty (triangular distributions on
 * times, durations, and burn rates). Same seed → same futures → auditable.
 */
export interface McRequirementStats {
  id: string;
  pY: number;
  pQ: number;
  pN: number;
  pUNK: number;
  margin: { p5: number; p10: number; p50: number; p90: number; p95: number; mean: number };
  /** How often each leaf constraint controlled the outcome. */
  controlling: Record<string, number>;
}

export interface McResult {
  n: number;
  seed: number;
  requirements: Record<string, McRequirementStats>;
  /** Fraction of runs in which each node was on some target's controlling chain. */
  criticality: Record<string, number>;
  uncertainNodes: string[];
}

export interface McBatchTarget {
  /** Margin per run, in run order. ±Infinity and NaN are kept: never ready, unbounded, unknown. */
  margins: number[];
  status: Record<Readiness, number>;
  /** Runs in which each node sat on this target's critical chain. */
  chain: Record<string, number>;
  /** Runs in which each leaf constraint controlled this target. */
  controlling: Record<string, number>;
}

export interface McBatch {
  seed: number;
  start: number;
  count: number;
  targets: Record<string, McBatchTarget>;
  uncertainNodes: string[];
}

/**
 * Runs [start, start + count) of a seeded Monte Carlo, with raw per-run
 * margins and counts so batches can be merged. Every run draws exactly one
 * number per uncertain node, so a batch skips straight to its place in the
 * stream: any chunking of the same seed gives the same futures.
 */
export function mcBatch(g: GraphSpec, ctx: ComputeContext, targets: string[], seed: number, start: number, count: number): McBatch {
  const rnd = mulberry32(seed);
  const uncertain = g.nodes.filter((x) => x.uncertainty);
  for (let i = 0; i < start * uncertain.length; i++) rnd();
  const out: Record<string, McBatchTarget> = {};
  for (const t of targets) out[t] = { margins: [], status: { Y: 0, Q: 0, N: 0, UNK: 0 }, chain: {}, controlling: {} };
  for (let i = 0; i < count; i++) {
    const patches: Patch[] = [];
    for (const u of uncertain) {
      const x = triSample(u.uncertainty!, rnd());
      if ((u.uncertainty!.kind ?? 'delay') === 'scale') patches.push({ op: 'scale', id: u.id, factor: x });
      else if (x !== 0) patches.push({ op: 'shift', id: u.id, hours: x });
    }
    const r = compute(applyPatches(g, patches), { ...ctx, hash: false });
    for (const t of targets) {
      const rr = r.requirements[t];
      const o = out[t];
      if (!rr) {
        o.margins.push(NaN);
        o.status.UNK++;
        continue;
      }
      o.margins.push(rr.margin);
      o.status[rr.status]++;
      for (const c of rr.chain) o.chain[c] = (o.chain[c] ?? 0) + 1;
      for (const leaf of rr.leaves) o.controlling[leaf.node] = (o.controlling[leaf.node] ?? 0) + 1;
    }
  }
  return { seed, start, count, targets: out, uncertainNodes: uncertain.map((u) => u.id) };
}

export function runMonteCarlo(g: GraphSpec, ctx: ComputeContext, targets: string[], n = 1000, seed = 1337): McResult {
  const rnd = mulberry32(seed);
  const uncertain = g.nodes.filter((x) => x.uncertainty);
  const margins: Record<string, number[]> = {};
  const status: Record<string, Record<Readiness, number>> = {};
  const ctrl: Record<string, Record<string, number>> = {};
  const crit: Record<string, number> = {};
  for (const t of targets) {
    margins[t] = [];
    status[t] = { Y: 0, Q: 0, N: 0, UNK: 0 };
    ctrl[t] = {};
  }
  for (let i = 0; i < n; i++) {
    const patches: Patch[] = [];
    for (const u of uncertain) {
      const x = triSample(u.uncertainty!, rnd());
      if ((u.uncertainty!.kind ?? 'delay') === 'scale') patches.push({ op: 'scale', id: u.id, factor: x });
      else if (x !== 0) patches.push({ op: 'shift', id: u.id, hours: x });
    }
    const r = compute(applyPatches(g, patches), { ...ctx, hash: false });
    const onChain = new Set<string>();
    for (const t of targets) {
      const rr = r.requirements[t];
      if (!rr) continue;
      margins[t].push(rr.margin);
      status[t][rr.status]++;
      for (const leaf of rr.leaves) ctrl[t][leaf.node] = (ctrl[t][leaf.node] ?? 0) + 1;
      for (const c of rr.chain) onChain.add(c);
    }
    for (const c of onChain) crit[c] = (crit[c] ?? 0) + 1;
  }
  const requirements: Record<string, McRequirementStats> = {};
  for (const t of targets) {
    const ms = margins[t].slice().sort((a, b) => a - b);
    const finite = ms.filter(Number.isFinite);
    requirements[t] = {
      id: t,
      pY: status[t].Y / n,
      pQ: status[t].Q / n,
      pN: status[t].N / n,
      pUNK: status[t].UNK / n,
      margin: {
        p5: quantile(ms, 0.05),
        p10: quantile(ms, 0.1),
        p50: quantile(ms, 0.5),
        p90: quantile(ms, 0.9),
        p95: quantile(ms, 0.95),
        mean: finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : NaN,
      },
      controlling: Object.fromEntries(Object.entries(ctrl[t]).map(([k, v]) => [k, v / n])),
    };
  }
  return {
    n, seed, requirements,
    criticality: Object.fromEntries(Object.entries(crit).map(([k, v]) => [k, v / n]).sort((a, b) => (b[1] as number) - (a[1] as number))),
    uncertainNodes: uncertain.map((u) => u.id),
  };
}
