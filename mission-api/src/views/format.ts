/**
 * Time and margin formatting shared by the server (explanation text) and the
 * browser (labels), so a time reads the same everywhere. Pure functions, no
 * imports: the web build includes this file directly.
 */
export interface TimeFrame {
  timeScale: 'days' | 'hours';
  /** Calendar day (from epoch) labelled D-0. */
  dDay: number;
  /** H-hour (scenario hours) for hour-scale missions. */
  hHour?: number;
  epochUtc: number;
}

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');

export function hhmm(t: number): string {
  const m = Math.round(t * 60);
  const dayMin = ((m % 1440) + 1440) % 1440;
  return `${pad(dayMin / 60)}${pad(dayMin % 60)}`;
}

/** H-hour label: H-6:00, H+0:45, H-0:30. */
export function fmtH(t: number, h: number): string {
  if (!Number.isFinite(t)) return 'NEVER';
  const m = Math.round((t - h) * 60);
  const sign = m < 0 ? '-' : '+';
  const a = Math.abs(m);
  return `H${sign}${Math.floor(a / 60)}:${pad(a % 60)}`;
}

/** "D-12 0700" for day-scale missions, "H-6:00" for hour-scale ones. NEVER for an unbounded time. */
export function fmtT(s: TimeFrame, t: number): string {
  if (!Number.isFinite(t)) return t > 0 ? 'NEVER' : 'ALWAYS';
  if (s.timeScale === 'hours') return fmtH(t, s.hHour ?? 0);
  const day = Math.floor(Math.round(t * 60) / 1440);
  const rel = day - s.dDay;
  const d = rel === 0 ? 'D-0' : rel < 0 ? `D${rel}` : `D+${rel}`;
  return `${d} ${hhmm(t)}`;
}

/** Coarse label: D-12, or H-6 on an hour scale. */
export function fmtDay(s: TimeFrame, t: number): string {
  if (!Number.isFinite(t)) return t > 0 ? 'NEVER' : 'ALWAYS';
  if (s.timeScale === 'hours') {
    const rel = Math.round(t - (s.hHour ?? 0));
    return rel === 0 ? 'H' : rel < 0 ? `H${rel}` : `H+${rel}`;
  }
  const rel = Math.floor(t / 24) - s.dDay;
  return rel === 0 ? 'D-0' : rel < 0 ? `D${rel}` : `D+${rel}`;
}

/** Naval date-time group, e.g. 031300Z NOV 26. */
export function dtg(s: Pick<TimeFrame, 'epochUtc'>, t: number): string {
  if (!Number.isFinite(t)) return '—';
  const d = new Date(s.epochUtc + t * 3_600_000);
  return `${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z ${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}

/** Human duration: 3d 14h, 6h 30m, 45m. Unbounded durations read as words, never as a symbol. */
export function fmtDur(h: number, opts: { signed?: boolean } = {}): string {
  if (Number.isNaN(h)) return '?';
  if (!Number.isFinite(h)) return h > 0 ? 'no limit' : 'never';
  const sign = h < 0 ? '−' : opts.signed ? '+' : '';
  const m = Math.round(Math.abs(h) * 60);
  const d = Math.floor(m / 1440);
  const hr = Math.floor((m % 1440) / 60);
  const mi = m % 60;
  if (d > 0) return `${sign}${d}d ${hr}h`;
  if (hr > 0) return mi ? `${sign}${hr}h ${pad(mi)}m` : `${sign}${hr}h`;
  return `${sign}${mi}m`;
}

export type MarginKindLike = 'exact' | 'atLeast' | 'never' | 'unknown';

/** Margin label: "4d 10h", "≥ 8d 0h" when nothing in the horizon limits it, "NEVER" when there is no path, "UNKNOWN" when data is missing. */
export function fmtMargin(m: number, kind: MarginKindLike = 'exact', opts: { signed?: boolean } = {}): string {
  if (kind === 'unknown') return 'UNKNOWN';
  if (kind === 'never' || m === -Infinity) return 'NEVER';
  if (kind === 'atLeast' || m === Infinity) return Number.isFinite(m) ? `≥ ${fmtDur(m)}` : 'NO LIMIT';
  return fmtDur(m, opts);
}

/** A change in margin or time; unbounded changes read as words. */
export function fmtDelta(d: number): string {
  if (!Number.isFinite(d) || Math.abs(d) >= 1e5) return d > 0 ? 'no longer limited' : 'lost entirely';
  return fmtDur(d, { signed: true });
}

/** Finite stand-in for sorting and charts (keeps sign, caps magnitude). */
export function finiteOr(x: number, cap = 1e6): number {
  return Number.isFinite(x) ? x : x > 0 ? cap : -cap;
}
