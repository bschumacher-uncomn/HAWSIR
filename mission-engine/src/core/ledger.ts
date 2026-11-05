import { normalize, type Interval, type Timeline } from './intervals';
import { EPS } from './time';

/**
 * Quantity over time. A ledger is a stock (fuel %, missiles, stores) that drains
 * at piecewise-constant rates and jumps at transfers (UNREP, salvo, reload).
 * The result is a piecewise-linear series; threshold crossings of that series
 * become ordinary availability timelines so quantities and times share one graph.
 */
export interface SeriesPoint {
  t: number;
  v: number;
}

export interface BurnSegment {
  from: number;
  to: number;
  /** Units per hour consumed (negative = produced). */
  rate: number;
  label: string;
  /** Node that supplied the rate (routine or scalar), for attribution. */
  source?: string;
}

export type TransferKind = 'in' | 'out' | 'topoff' | 'toLevel';

export interface LedgerTransfer {
  id: string;
  at: number;
  kind: TransferKind;
  amount?: number;
  level?: number;
  label: string;
  /** Node whose rise sets the transfer time. */
  source?: string;
}

export interface AppliedTransfer {
  id: string;
  at: number;
  kind: TransferKind;
  before: number;
  after: number;
  requested: number;
  delivered: number;
  label: string;
  source?: string;
  clipped: boolean;
  short: boolean;
}

export interface LedgerInput {
  t0: number;
  v0: number;
  capacity?: number;
  floor?: number;
  segments: BurnSegment[];
  transfers: LedgerTransfer[];
  end: number;
}

export interface LedgerResult {
  points: SeriesPoint[];
  applied: AppliedTransfer[];
  skipped: LedgerTransfer[];
  clipped: boolean;
  short: boolean;
  emptyAt?: number;
  finalRate: number;
}

function rateAt(segments: BurnSegment[], a: number, b: number): number {
  const mid = Number.isFinite(b) ? (a + b) / 2 : a + 1;
  return segments.reduce((acc, s) => (s.from <= mid && mid < s.to ? acc + s.rate : acc), 0);
}

export function simulateLedger(inp: LedgerInput): LedgerResult {
  const floor = inp.floor ?? 0;
  const cap = inp.capacity ?? Infinity;
  const transfers = inp.transfers.filter((x) => Number.isFinite(x.at)).slice().sort((a, b) => a.at - b.at);
  const skipped = inp.transfers.filter((x) => !Number.isFinite(x.at) || x.at < inp.t0 - EPS || x.at > inp.end + EPS);
  const live = transfers.filter((x) => x.at >= inp.t0 - EPS && x.at <= inp.end + EPS);
  const times = new Set<number>([inp.t0, inp.end]);
  for (const s of inp.segments) {
    if (s.from > inp.t0 && s.from < inp.end) times.add(s.from);
    if (s.to > inp.t0 && s.to < inp.end) times.add(s.to);
  }
  for (const x of live) times.add(Math.max(inp.t0, x.at));
  const ts = [...times].sort((a, b) => a - b);

  const points: SeriesPoint[] = [{ t: inp.t0, v: inp.v0 }];
  const applied: AppliedTransfer[] = [];
  let v = inp.v0;
  let emptyAt: number | undefined;
  let clipped = false;
  let short = false;

  const applyAt = (t: number) => {
    for (const x of live) {
      if (Math.abs(Math.max(inp.t0, x.at) - t) > EPS) continue;
      const before = v;
      let requested = 0;
      let after = v;
      if (x.kind === 'in') {
        requested = x.amount ?? 0;
        after = v + requested;
      } else if (x.kind === 'out') {
        requested = -(x.amount ?? 0);
        after = v + requested;
      } else if (x.kind === 'topoff') {
        after = Number.isFinite(cap) ? cap : v;
        requested = after - v;
      } else {
        after = Math.max(v, x.level ?? v);
        requested = after - v;
      }
      let isClipped = false;
      let isShort = false;
      if (after > cap + EPS) {
        after = cap;
        isClipped = true;
        clipped = true;
      }
      if (after < floor - EPS) {
        after = floor;
        isShort = true;
        short = true;
      }
      v = after;
      applied.push({
        id: x.id, at: t, kind: x.kind, before, after, requested, delivered: after - before,
        label: x.label, source: x.source, clipped: isClipped, short: isShort,
      });
      points.push({ t, v });
    }
  };

  applyAt(inp.t0);
  for (let i = 1; i < ts.length; i++) {
    const a = ts[i - 1];
    const b = ts[i];
    const r = rateAt(inp.segments, a, b);
    let vb = v - r * (b - a);
    if (r > 0 && vb < floor && v > floor) {
      const tc = a + (v - floor) / r;
      points.push({ t: tc, v: floor });
      if (emptyAt === undefined) emptyAt = tc;
      vb = floor;
    } else if (vb < floor) vb = floor;
    v = vb;
    points.push({ t: b, v });
    applyAt(b);
  }
  const finalRate = v <= floor + EPS && rateAt(inp.segments, inp.end, Infinity) > 0 ? 0 : rateAt(inp.segments, inp.end, Infinity);
  return { points, applied, skipped, clipped, short, emptyAt, finalRate };
}

/** Right-continuous value at t (after any jump at t). */
export function valueAt(points: SeriesPoint[], t: number, finalRate = 0): number {
  if (points.length === 0) return NaN;
  if (t <= points[0].t) return points[0].v;
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p.t <= t + EPS) {
      const n = points[i + 1];
      if (!n) return p.v - finalRate * (t - p.t);
      if (n.t - p.t <= EPS) return n.v;
      return p.v + ((n.v - p.v) * (t - p.t)) / (n.t - p.t);
    }
  }
  return points[0].v;
}

/** Where the series is at or above `level`, as an availability timeline. */
export function thresholdTimeline(points: SeriesPoint[], level: number, finalRate: number): Timeline {
  if (points.length === 0) return [];
  const out: Interval[] = [];
  const first = points[0];
  if (first.v >= level - EPS) out.push([-Infinity, first.t]);
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i];
    const n = points[i + 1];
    if (n.t - p.t <= EPS) continue; // jump: the next piece starts from n
    const va = p.v;
    const vb = n.v;
    if (va >= level - EPS && vb >= level - EPS) out.push([p.t, n.t]);
    else if (va >= level - EPS && vb < level) out.push([p.t, p.t + ((va - level) / (va - vb)) * (n.t - p.t)]);
    else if (va < level && vb >= level - EPS) out.push([p.t + ((level - va) / (vb - va)) * (n.t - p.t), n.t]);
  }
  const last = points[points.length - 1];
  if (last.v >= level - EPS) {
    if (finalRate <= EPS) out.push([last.t, Infinity]);
    else out.push([last.t, last.t + (last.v - level) / finalRate]);
  } else if (finalRate < -EPS) {
    out.push([last.t + (level - last.v) / -finalRate, Infinity]);
  }
  return normalize(out);
}

export function minOver(points: SeriesPoint[], a: number, b: number, finalRate = 0): number {
  let m = Math.min(valueAt(points, a, finalRate), valueAt(points, b - EPS, finalRate));
  for (const p of points) if (p.t > a && p.t < b) m = Math.min(m, p.v);
  return m;
}

/** Sample for charts and trend displays. */
export function sample(points: SeriesPoint[], a: number, b: number, step: number, finalRate = 0): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let t = a; t <= b + EPS; t += step) out.push({ t, v: valueAt(points, t, finalRate) });
  return out;
}
