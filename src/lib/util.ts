import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { QualityFlag, Readiness } from '@/engine/types';

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));

export const STATUS_COLOR: Record<Readiness, string> = { Y: '#34d399', Q: '#fbbf24', N: '#fb3b5c' };
export const STATUS_TEXT: Record<Readiness, string> = { Y: 'text-ok', Q: 'text-unc', N: 'text-crit' };
export const STATUS_WORD: Record<Readiness, string> = { Y: 'READY', Q: 'QUALIFIED', N: 'NOT READY' };

export const FLAG_META: Record<QualityFlag, { label: string; color: string }> = {
  missing: { label: 'MISSING', color: '#fb3b5c' },
  assumed: { label: 'ASSUMED', color: '#fbbf24' },
  stale: { label: 'STALE', color: '#fbbf24' },
  contradictory: { label: 'CONFLICT', color: '#f97316' },
  malformed: { label: 'MALFORMED', color: '#fb3b5c' },
  'no-redundancy': { label: 'NO REDUNDANCY', color: '#fbbf24' },
  degraded: { label: 'DEGRADED', color: '#fbbf24' },
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

export function marginTone(margin: number, q: number): 'ok' | 'unc' | 'crit' {
  if (!Number.isFinite(margin) || margin < 0) return 'crit';
  return margin < q ? 'unc' : 'ok';
}

export const TONE_HEX = { ok: '#34d399', unc: '#fbbf24', crit: '#fb3b5c', calc: '#22d3ee', ai: '#a78bfa', info: '#7dd3fc', warn: '#fbbf24' } as const;
