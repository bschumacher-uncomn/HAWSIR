import { explain, leavesOf } from './attribution';
import { toMap } from './compute';
import type { Cause, EngineResult, GraphSpec, Readiness } from './graph';
import { clip } from './intervals';
import { sample, type SeriesPoint } from './ledger';

/**
 * Trends over time, two kinds:
 *   - outlook: from one evaluation, how a capability's availability and a
 *     stock's level evolve across the horizon, with the cause of every change;
 *   - burn-down: margin and status re-evaluated as of successive knowledge
 *     times (what we knew when), which shows how each report moved the answer.
 */
export interface OutlookSegment {
  start: number;
  end: number;
  up: boolean;
  /** Why it changes at `start` (rise or fall). */
  cause?: Cause;
  causeText?: string;
}

export function outlook(g: GraphSpec, r: EngineResult, id: string, from: number, to: number): OutlookSegment[] {
  const tl = clip(r.nodes[id]?.timeline ?? [], from, to);
  const nodes = toMap(g);
  const segs: OutlookSegment[] = [];
  let cur = from;
  for (const [s, e] of tl) {
    if (s > cur + 1e-9) {
      const c = cur === from ? undefined : explain(nodes, r.nodes, id, 'fall', cur);
      segs.push({ start: cur, end: s, up: false, cause: c, causeText: c ? leavesOf(c).map((l) => l.why).join('; ') : undefined });
    }
    const c = s <= from + 1e-9 ? undefined : explain(nodes, r.nodes, id, 'rise', s);
    segs.push({ start: Math.max(s, from), end: Math.min(e, to), up: true, cause: c, causeText: c ? leavesOf(c).map((l) => l.why).join('; ') : undefined });
    cur = Math.min(e, to);
  }
  if (cur < to - 1e-9) {
    const c = cur === from ? undefined : explain(nodes, r.nodes, id, 'fall', cur);
    segs.push({ start: cur, end: to, up: false, cause: c, causeText: c ? leavesOf(c).map((l) => l.why).join('; ') : undefined });
  }
  return segs;
}

export function stockSeries(r: EngineResult, stockId: string, from: number, to: number, step = 1): SeriesPoint[] {
  const n = r.nodes[stockId];
  if (!n?.series?.length) return [];
  return sample(n.series, from, to, step, n.finalRate ?? 0);
}

export interface BurnDownRow {
  asOf: number;
  requirements: Record<string, { status: Readiness; margin: number; controlling: string }>;
}

export function burnDown(evaluateAt: (asOf: number) => EngineResult, ids: string[], times: number[]): BurnDownRow[] {
  return times.map((asOf) => {
    const r = evaluateAt(asOf);
    const out: BurnDownRow['requirements'] = {};
    for (const id of ids) {
      const rr = r.requirements[id];
      if (!rr) continue;
      out[id] = { status: rr.status, margin: rr.margin, controlling: rr.leaves.map((l) => l.label).join(', ') || '—' };
    }
    return { asOf, requirements: out };
  });
}

/** Compact ASCII sparkline for CLI and log output. */
export function sparkline(values: number[], lo?: number, hi?: number): string {
  const bars = '▁▂▃▄▅▆▇█';
  const fin = values.filter(Number.isFinite);
  const a = lo ?? Math.min(...fin);
  const b = hi ?? Math.max(...fin);
  return values.map((v) => (Number.isFinite(v) ? bars[Math.max(0, Math.min(7, Math.round(((v - a) / (b - a || 1)) * 7)))] : ' ')).join('');
}
