import type { Hours, Scenario } from './types';

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');

export function hhmm(t: Hours): string {
  const m = Math.round(t * 60);
  const dayMin = ((m % 1440) + 1440) % 1440;
  return `${pad(dayMin / 60)}${pad(dayMin % 60)}`;
}

/** Ship's local "D-12 0700" style label, or clock time for hour-scale scenarios. */
export function fmtT(s: Pick<Scenario, 'dDay' | 'timeScale'>, t: Hours): string {
  if (!Number.isFinite(t)) return 'NEVER';
  const m = Math.round(t * 60);
  const day = Math.floor(m / 1440);
  if (s.timeScale === 'hours') {
    return day === 0 ? hhmm(t) : `${hhmm(t)}${day > 0 ? ` +${day}d` : ` ${day}d`}`;
  }
  const rel = day - s.dDay;
  const d = rel === 0 ? 'D-0' : rel < 0 ? `D${rel}` : `D+${rel}`;
  return `${d} ${hhmm(t)}`;
}

/** Day label only (D-12). */
export function fmtDay(s: Pick<Scenario, 'dDay'>, t: Hours): string {
  const rel = Math.floor(t / 24) - s.dDay;
  return rel === 0 ? 'D-0' : rel < 0 ? `D${rel}` : `D+${rel}`;
}

/** Naval date-time group, e.g. 031300Z NOV 26 */
export function dtg(s: Pick<Scenario, 'epochUtc'>, t: Hours): string {
  if (!Number.isFinite(t)) return '—';
  const d = new Date(s.epochUtc + t * 3600_000);
  return `${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z ${MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}

/** Signed human duration: 3d 14h, 6h 30m, 45m */
export function fmtDur(h: number, opts: { signed?: boolean } = {}): string {
  if (!Number.isFinite(h)) return h > 0 ? '∞' : '−∞';
  const sign = h < 0 ? '−' : opts.signed ? '+' : '';
  const m = Math.round(Math.abs(h) * 60);
  const d = Math.floor(m / 1440);
  const hr = Math.floor((m % 1440) / 60);
  const mi = m % 60;
  if (d > 0) return `${sign}${d}d ${hr}h`;
  if (hr > 0) return mi ? `${sign}${hr}h ${pad(mi)}m` : `${sign}${hr}h`;
  return `${sign}${mi}m`;
}
