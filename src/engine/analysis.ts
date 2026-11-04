import { type NodeMap, shiftNode, isShiftable } from './apply';
import { compute, downstreamOf } from './compute';
import type { Hours, Scenario } from './types';

type S = Pick<Scenario, 'thresholds'>;

function readyWith(s: S, nodes: NodeMap, at: Hours, nodeId: string, delta: number, targetId: string): number {
  const shifted = { ...nodes, [nodeId]: shiftNode(nodes[nodeId], delta) };
  return compute(s, shifted, at).nodes[targetId]?.ready ?? Infinity;
}

const MINUTE = 1 / 60;
const snap = (h: number) => Math.round(h * 60) / 60;

function search(lo: number, hi: number, ok: (d: number) => boolean, res: number): number {
  // largest d in [lo, hi] where ok(d) is true; assumes ok(lo) is true and ok is monotone (true then false)
  if (ok(hi)) return hi;
  while (hi - lo > res) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return ok(snap(hi)) ? snap(hi) : snap(lo);
}

export interface SlackResult {
  nodeId: string;
  targetId: string;
  /** Hours this input can slip with zero change to the target's readiness. */
  noImpact: number;
  /** Hours this input can slip before the target misses its required time (negative = recovery needed). */
  toFailure: number;
  /** When already failing: true if improving this input alone can recover. */
  recoverable: boolean;
  unbounded: boolean;
}

/**
 * Distinguish upstream slack from true mission margin by perturbation.
 * All engine operators are monotone in their inputs, so bisection is exact to `res`.
 */
export function slackFor(s: S, nodes: NodeMap, at: Hours, nodeId: string, targetId: string, maxH = 24 * 30): SlackResult {
  const res = MINUTE;
  const target = nodes[targetId];
  const base = compute(s, nodes, at).nodes[targetId]?.ready ?? Infinity;
  const req = target?.requiredBy ?? Infinity;
  if (!isShiftable(nodes[nodeId])) return { nodeId, targetId, noImpact: 0, toFailure: req - base, recoverable: false, unbounded: false };

  const same = (d: number) => readyWith(s, nodes, at, nodeId, d, targetId) <= base + 1e-6;
  const noImpact = search(0, maxH, same, res);

  const meets = (d: number) => readyWith(s, nodes, at, nodeId, d, targetId) <= req + 1e-6;
  let toFailure: number;
  let recoverable = true;
  if (base <= req) {
    toFailure = search(0, maxH, meets, res);
  } else {
    // find the smallest advance that recovers, if any
    const lower = nodes[nodeId].kind === 'task' ? -((nodes[nodeId].duration ?? nodes[nodeId].assumedDuration) ?? 0) : -maxH;
    if (!meets(lower)) {
      recoverable = false;
      toFailure = req - base;
    } else {
      let lo = lower;
      let hi = 0;
      while (hi - lo > res) {
        const mid = (lo + hi) / 2;
        if (meets(mid)) lo = mid;
        else hi = mid;
      }
      toFailure = snap(lo);
    }
  }
  return { nodeId, targetId, noImpact, toFailure, recoverable, unbounded: noImpact >= maxH };
}

export interface CurvePoint {
  delta: number;
  margin: number;
}

/** Mission margin as a function of slip on a single input: exposes step-function cliffs. */
export function consequenceCurve(s: S, nodes: NodeMap, at: Hours, nodeId: string, targetId: string, range: [number, number], steps = 160): CurvePoint[] {
  const req = nodes[targetId]?.requiredBy ?? Infinity;
  const pts: CurvePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const delta = range[0] + ((range[1] - range[0]) * i) / steps;
    pts.push({ delta, margin: req - readyWith(s, nodes, at, nodeId, delta, targetId) });
  }
  return pts;
}

export interface Cliff {
  nodeId: string;
  targetId: string;
  /** Slip the input can absorb before the step. */
  slack: number;
  /** Readiness lost in the step itself. */
  drop: number;
}

/**
 * A cliff is a step in the consequence curve: one more increment of slip costs
 * far more readiness than the slip itself (missed sail date, missed fly-on window).
 */
export function findCliffs(s: Scenario, nodes: NodeMap, at: Hours, targetId: string, chain: string[]): Cliff[] {
  const out: Cliff[] = [];
  const base = compute(s, nodes, at).nodes[targetId]?.ready ?? Infinity;
  if (!Number.isFinite(base)) return out;
  const step = s.timeScale === 'hours' ? 0.25 : 1;
  const range = s.timeScale === 'hours' ? 6 : 24 * 7;
  for (const id of new Set(chain)) {
    if (!isShiftable(nodes[id])) continue;
    let prev = base;
    for (let d = step; d <= range + 1e-9; d += step) {
      const cur = readyWith(s, nodes, at, id, d, targetId);
      const jump = cur - prev;
      if (jump > step + s.thresholds.cliff || !Number.isFinite(cur)) {
        const lo = search(d - step, d, (x) => readyWith(s, nodes, at, id, x, targetId) - prev <= (x - (d - step)) + 1e-6, MINUTE);
        out.push({ nodeId: id, targetId, slack: lo, drop: Number.isFinite(cur) ? cur - prev - step : Infinity });
        break;
      }
      prev = cur;
    }
  }
  return out;
}

/** Inputs anywhere upstream that can affect this target. */
export function shiftableUpstream(nodes: NodeMap, targetId: string, cone: Set<string>): string[] {
  return [...cone].filter((id) => id !== targetId && isShiftable(nodes[id]));
}

export function affectedCapabilities(nodes: NodeMap, nodeId: string): string[] {
  return [...downstreamOf(nodes, nodeId)].filter((id) => nodes[id].kind === 'capability');
}
