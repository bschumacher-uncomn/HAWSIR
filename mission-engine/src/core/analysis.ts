import { compute, toMap, type ComputeContext } from './compute';
import { depsOf, type EngineResult, type GraphSpec, type NodeSpec, type Readiness } from './graph';
import { applyPatches, shiftable, type Patch } from './patch';
import { approxEq } from './time';

/**
 * What-if analysis on a fixed graph (a fixed choice of options).
 *
 * Slack vs. margin: for each input, how far can it slip with no effect on the
 * target (upstream slack), and how far before the target fails (time to
 * failure)? When every node between the input and the target is monotone
 * (a later input can only make things later), the answer is a clean cutoff and
 * bisection finds it exactly. When a stock with top-off refuelling or capacity
 * clipping sits on the path, the response can be non-monotone, so we scan
 * first and then refine inside the first bracket.
 */
export interface Eval {
  margin: number;
  status: Readiness;
}

function evalTarget(g: GraphSpec, ctx: ComputeContext, target: string, patches: Patch[]): Eval {
  const r = compute(applyPatches(g, patches), { ...ctx, hash: false });
  const t = r.requirements[target];
  return t ? { margin: t.margin, status: t.status } : { margin: -Infinity, status: 'UNK' };
}

/** All nodes upstream of `target` (including it). */
export function coneOf(g: GraphSpec, target: string): Set<string> {
  const m = toMap(g);
  const out = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id) || !m[id]) continue;
    out.add(id);
    for (const d of depsOf(m[id])) stack.push(d);
  }
  return out;
}

/** Nodes downstream of `id` (including it). */
export function downstreamOf(g: GraphSpec, id: string): Set<string> {
  const users: Record<string, string[]> = {};
  for (const n of g.nodes) for (const d of depsOf(n)) (users[d] ??= []).push(n.id);
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const x = stack.pop()!;
    if (out.has(x)) continue;
    out.add(x);
    for (const u of users[x] ?? []) stack.push(u);
  }
  return out;
}

export function pathIsMonotone(g: GraphSpec, base: EngineResult, from: string, target: string): boolean {
  const cone = coneOf(g, target);
  const down = downstreamOf(g, from);
  for (const id of down) if (cone.has(id) && base.nodes[id]?.flags.includes('non-monotone')) return false;
  return true;
}

export interface SlackResult {
  node: string;
  label: string;
  target: string;
  baseMargin: number;
  /** Hours the input can slip with zero effect on the target. */
  noImpact: number;
  /** Hours the input can slip before the target is N. */
  toFailure: number;
  method: 'bisection' | 'scan';
}

export interface SlackOpts {
  maxH?: number;
  tol?: number;
  scanStep?: number;
}

function bisectLast(pred: (d: number) => boolean, lo: number, hi: number, tol: number): number {
  // pred(lo) true, pred(hi) false; returns the largest d with pred true (within tol)
  while (hi - lo > tol) {
    const mid = (lo + hi) / 2;
    if (pred(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function slackFor(g: GraphSpec, ctx: ComputeContext, nodeId: string, target: string, base: EngineResult, opts: SlackOpts = {}): SlackResult {
  const maxH = opts.maxH ?? 24 * 14;
  const tol = opts.tol ?? 1 / 60;
  const step = opts.scanStep ?? 0.5;
  const baseEval = evalTarget(g, ctx, target, []);
  const f = (d: number) => (d === 0 ? baseEval : evalTarget(g, ctx, target, [{ op: 'shift', id: nodeId, hours: d }]));
  const same = (e: Eval) => approxEq(e.margin, baseEval.margin, 1e-4);
  const ok = (e: Eval) => e.margin >= -1e-9;
  const monotone = pathIsMonotone(g, base, nodeId, target);
  const label = toMap(g)[nodeId]?.label ?? nodeId;

  const firstFailing = (pred: (e: Eval) => boolean): number => {
    // smallest d in (0, maxH] where pred(f(d)) is false, or Infinity
    if (monotone) {
      if (pred(f(maxH))) return Infinity;
      return bisectLast((d) => pred(f(d)), 0, maxH, tol);
    }
    let prev = 0;
    for (let d = step; d <= maxH + 1e-9; d += step) {
      if (!pred(f(d))) return bisectLast((x) => pred(f(x)), prev, d, tol);
      prev = d;
    }
    return Infinity;
  };

  const noImpact = firstFailing(same);
  const toFailure = !ok(baseEval) ? 0 : firstFailing(ok);
  return { node: nodeId, label, target, baseMargin: baseEval.margin, noImpact, toFailure, method: monotone ? 'bisection' : 'scan' };
}

/** Slack for every shiftable input upstream of the target, most critical first. */
export function slackTable(g: GraphSpec, ctx: ComputeContext, target: string, base: EngineResult, opts: SlackOpts = {}): SlackResult[] {
  const m = toMap(g);
  const ids = [...coneOf(g, target)].filter((id) => m[id] && shiftable(m[id] as NodeSpec, ctx.now));
  return ids
    .map((id) => slackFor(g, ctx, id, target, base, opts))
    .sort((a, b) => a.toFailure - b.toFailure || a.noImpact - b.noImpact || a.node.localeCompare(b.node));
}

export interface CurvePoint {
  delay: number;
  margin: number;
  status: Readiness;
}

export function consequenceCurve(g: GraphSpec, ctx: ComputeContext, nodeId: string, target: string, maxH = 72, steps = 144): CurvePoint[] {
  const out: CurvePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const d = (maxH * i) / steps;
    const e = evalTarget(g, ctx, target, d === 0 ? [] : [{ op: 'shift', id: nodeId, hours: d }]);
    out.push({ delay: d, margin: e.margin, status: e.status });
  }
  return out;
}

export interface Cliff {
  delay: number;
  /** Margin lost across the step, beyond the slip itself. */
  extraLoss: number;
}

/** Steps where one more increment of slip costs much more than the slip (a missed window). */
export function findCliffs(curve: CurvePoint[], factor = 2): Cliff[] {
  const out: Cliff[] = [];
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    const dd = b.delay - a.delay;
    if (!Number.isFinite(a.margin) || !Number.isFinite(b.margin)) {
      if (Number.isFinite(a.margin) && b.margin === -Infinity) out.push({ delay: b.delay, extraLoss: Infinity });
      continue;
    }
    const loss = a.margin - b.margin;
    if (loss > dd * factor + 1e-6) out.push({ delay: b.delay, extraLoss: loss - dd });
  }
  return out;
}

export interface TornadoBar {
  node: string;
  label: string;
  low: number;
  high: number;
  swing: number;
}

/** Margin at the low and high ends of each node's declared uncertainty. */
export function tornado(g: GraphSpec, ctx: ComputeContext, target: string): TornadoBar[] {
  const bars: TornadoBar[] = [];
  for (const n of g.nodes) {
    const u = n.uncertainty;
    if (!u) continue;
    const mk = (x: number): Patch[] => ((u.kind ?? 'delay') === 'scale' ? [{ op: 'scale', id: n.id, factor: x }] : [{ op: 'shift', id: n.id, hours: x }]);
    const lo = evalTarget(g, ctx, target, mk(u.min)).margin;
    const hi = evalTarget(g, ctx, target, mk(u.max)).margin;
    const fin = (x: number) => (Number.isFinite(x) ? x : x > 0 ? 1e6 : -1e6);
    bars.push({ node: n.id, label: n.label, low: lo, high: hi, swing: Math.abs(fin(lo) - fin(hi)) });
  }
  return bars.sort((a, b) => b.swing - a.swing);
}
