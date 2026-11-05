/**
 * Scenario time is plain hours from the scenario epoch (a number). `Infinity`
 * means "open ended" and `-Infinity` means "since before the record starts".
 * Keeping time numeric makes every engine operation exact and cheap; wall-clock
 * rendering is a display concern handled here.
 */
export type Hours = number;

export const EPS = 1e-9;

export function approxEq(a: number, b: number, eps = 1e-6): boolean {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= eps;
}

/** "1d 4h 30m", "-1h 15m", "0m", "∞". */
export function fmtDur(h: number): string {
  if (h === Infinity) return '∞';
  if (h === -Infinity) return '-∞';
  if (Number.isNaN(h)) return '?';
  const neg = h < 0;
  let mins = Math.round(Math.abs(h) * 60);
  const d = Math.floor(mins / 1440);
  mins -= d * 1440;
  const hh = Math.floor(mins / 60);
  const mm = mins - hh * 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (hh) parts.push(`${hh}h`);
  if (mm || parts.length === 0) parts.push(`${mm}m`);
  return (neg ? '-' : '') + parts.join(' ');
}

/** Relative label against a reference hour, e.g. H-6, H+2.5. */
export function fmtRel(t: number, ref: number, label = 'H'): string {
  if (!Number.isFinite(t)) return t > 0 ? 'never' : 'always';
  const d = t - ref;
  const r = Math.round(d * 10) / 10;
  if (r === 0) return label;
  return `${label}${r > 0 ? '+' : ''}${r}`;
}

/** Military date-time group in Zulu, e.g. 041530Z NOV 26. */
export function fmtDtg(t: number, epochUtcMs: number): string {
  if (!Number.isFinite(t)) return t > 0 ? 'NEVER' : 'ALWAYS';
  const d = new Date(epochUtcMs + t * 3_600_000);
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z ${months[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
}
