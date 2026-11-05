import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { MarginKind, QualityFlag, Readiness } from '@/api/types';

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));

export const STATUS_COLOR: Record<Readiness, string> = { Y: '#34d399', Q: '#fbbf24', N: '#fb3b5c', UNK: '#a78bfa' };
export const STATUS_TEXT: Record<Readiness, string> = { Y: 'text-ok', Q: 'text-unc', N: 'text-crit', UNK: 'text-ai' };
export const STATUS_WORD: Record<Readiness, string> = { Y: 'READY', Q: 'QUALIFIED', N: 'NOT READY', UNK: 'UNKNOWN' };
/** Worst first. UNK sits between Q and N: it cannot be called green, and it is not a known miss. */
export const STATUS_RANK: Record<Readiness, number> = { N: 0, UNK: 1, Q: 2, Y: 3 };

export const FLAG_META: Record<QualityFlag, { label: string; color: string }> = {
  missing: { label: 'MISSING', color: '#fb3b5c' },
  assumed: { label: 'ASSUMED', color: '#fbbf24' },
  stale: { label: 'STALE', color: '#fbbf24' },
  contradictory: { label: 'CONFLICT', color: '#f97316' },
  malformed: { label: 'MALFORMED', color: '#fb3b5c' },
  'no-redundancy': { label: 'NO REDUNDANCY', color: '#fbbf24' },
  degraded: { label: 'DEGRADED', color: '#fbbf24' },
  extrapolated: { label: 'EXTRAPOLATED', color: '#7dd3fc' },
  synthetic: { label: 'SYNTHETIC', color: '#64748b' },
  'non-monotone': { label: 'NON-MONOTONE', color: '#a78bfa' },
  'routine-contract': { label: 'ROUTINE CHECK', color: '#fb3b5c' },
  'unverified-routine': { label: 'UNVERIFIED', color: '#fbbf24' },
  'transfer-skipped': { label: 'TRANSFER SKIPPED', color: '#fbbf24' },
  'reported-mismatch': { label: 'REPORT MISMATCH', color: '#f97316' },
  'unreported-change': { label: 'UNREPORTED', color: '#f97316' },
  'planning-assumption': { label: 'PLANNING ASSUMPTION', color: '#a78bfa' },
};

export const DOMAIN_COLOR: Record<string, string> = {
  maintenance: '#22d3ee',
  logistics: '#60a5fa',
  personnel: '#c084fc',
  schedule: '#2dd4bf',
  capability: '#e0f2fe',
  ordnance: '#f472b6',
  comms: '#818cf8',
};

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Tone for a margin. "Nothing in the horizon limits it" is good news, not a red infinity. */
export function marginTone(margin: number, q: number, kind: MarginKind = 'exact'): 'ok' | 'unc' | 'crit' {
  if (kind === 'unknown') return 'unc';
  if (kind === 'never' || margin === -Infinity) return 'crit';
  if (kind === 'atLeast' || margin === Infinity) return 'ok';
  if (Number.isNaN(margin) || margin < 0) return 'crit';
  return margin < q ? 'unc' : 'ok';
}

export const TONE_HEX = { ok: '#34d399', unc: '#fbbf24', crit: '#fb3b5c', calc: '#22d3ee', ai: '#a78bfa', info: '#7dd3fc', warn: '#fbbf24' } as const;
