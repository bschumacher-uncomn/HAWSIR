import { EPS } from './time';

/**
 * Availability timelines: sorted, disjoint, half-open intervals [start, end).
 * Every boolean "is it available at time t" fact in the engine is a Timeline,
 * so a system that is up now, goes down at a CASREP and comes back after the
 * repair is simply [[-∞, 54), [71.25, ∞)].
 */
export type Interval = readonly [number, number];
export type Timeline = readonly Interval[];

export const ALWAYS: Timeline = Object.freeze([[-Infinity, Infinity] as Interval]);
export const NEVER: Timeline = Object.freeze([] as Interval[]);

export function normalize(ivs: readonly Interval[]): Timeline {
  const xs = ivs.filter(([s, e]) => e > s + EPS || (s === -Infinity && e > s)).slice().sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of xs) {
    const last = out[out.length - 1];
    if (last && s <= last[1] + EPS) {
      if (e > last[1]) last[1] = e;
    } else out.push([s, e]);
  }
  return out;
}

export function from(t: number): Timeline {
  return t === Infinity ? NEVER : [[t, Infinity]];
}

export function between(s: number, e: number): Timeline {
  return normalize([[s, e]]);
}

export function union(...tls: Timeline[]): Timeline {
  return normalize(tls.flat());
}

export function intersect(a: Timeline, b: Timeline): Timeline {
  const out: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i][0], b[j][0]);
    const e = Math.min(a[i][1], b[j][1]);
    if (e > s + EPS || (s === -Infinity && e > s)) out.push([s, e]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return normalize(out);
}

export function intersectAll(tls: Timeline[]): Timeline {
  if (tls.length === 0) return ALWAYS;
  return tls.reduce((acc, t) => intersect(acc, t));
}

/** Times at which at least k of the timelines are available (sweep line). */
export function kOfN(tls: Timeline[], k: number): Timeline {
  if (k <= 0) return ALWAYS;
  if (k > tls.length) return NEVER;
  const ev: [number, number][] = [];
  for (const tl of tls) for (const [s, e] of tl) {
    ev.push([s, +1]);
    ev.push([e, -1]);
  }
  // ends before starts at the same instant (half-open intervals)
  ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out: [number, number][] = [];
  let c = 0;
  let open: number | null = null;
  for (const [t, d] of ev) {
    c += d;
    if (c >= k && open === null) open = t;
    if (c < k && open !== null) {
      out.push([open, t]);
      open = null;
    }
  }
  if (open !== null) out.push([open, Infinity]);
  return normalize(out);
}

export function complement(tl: Timeline): Timeline {
  const out: [number, number][] = [];
  let cur = -Infinity;
  for (const [s, e] of tl) {
    if (s > cur) out.push([cur, s]);
    cur = e;
  }
  if (cur < Infinity) out.push([cur, Infinity]);
  return normalize(out);
}

export function shift(tl: Timeline, d: number): Timeline {
  return normalize(tl.map(([s, e]) => [s + d, e + d] as Interval));
}

export function contains(tl: Timeline, t: number): boolean {
  return tl.some(([s, e]) => s <= t + EPS && t < e - EPS);
}

export function covering(tl: Timeline, t: number): Interval | undefined {
  return tl.find(([s, e]) => s <= t + EPS && t < e - EPS);
}

/** Interval that contains the whole window [a, b), if any. */
export function coveringWindow(tl: Timeline, a: number, b: number): Interval | undefined {
  return tl.find(([s, e]) => s <= a + EPS && e >= b - EPS);
}

/** First interval that starts strictly after t. */
export function nextAfter(tl: Timeline, t: number): Interval | undefined {
  return tl.find(([s]) => s > t + EPS);
}

/** Earliest instant >= t at which the timeline is available, or Infinity. */
export function firstFrom(tl: Timeline, t: number): number {
  const c = covering(tl, t);
  if (c) return t;
  const n = tl.find(([s]) => s >= t - EPS);
  return n ? n[0] : Infinity;
}

export function risesAt(tl: Timeline, t: number, eps = 1e-6): boolean {
  return tl.some(([s]) => Number.isFinite(s) && Math.abs(s - t) <= eps);
}

export function fallsAt(tl: Timeline, t: number, eps = 1e-6): boolean {
  return tl.some(([, e]) => Number.isFinite(e) && Math.abs(e - t) <= eps);
}

export function clip(tl: Timeline, a: number, b: number): Timeline {
  return intersect(tl, [[a, b]]);
}

export function measure(tl: Timeline, a = -Infinity, b = Infinity): number {
  return clip(tl, a, b).reduce((acc, [s, e]) => acc + (e - s), 0);
}

export function equals(a: Timeline, b: Timeline, eps = 1e-6): boolean {
  if (a.length !== b.length) return false;
  return a.every(([s, e], i) => {
    const [s2, e2] = b[i];
    const eq = (x: number, y: number) => x === y || Math.abs(x - y) <= eps;
    return eq(s, s2) && eq(e, e2);
  });
}

/** Boundary instants (rises and falls) inside [a, b]. */
export function edges(tl: Timeline, a = -Infinity, b = Infinity): { t: number; edge: 'rise' | 'fall' }[] {
  const out: { t: number; edge: 'rise' | 'fall' }[] = [];
  for (const [s, e] of tl) {
    if (Number.isFinite(s) && s >= a && s <= b) out.push({ t: s, edge: 'rise' });
    if (Number.isFinite(e) && e >= a && e <= b) out.push({ t: e, edge: 'fall' });
  }
  return out.sort((x, y) => x.t - y.t);
}
