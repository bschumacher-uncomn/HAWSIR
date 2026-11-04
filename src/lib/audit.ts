import { sha256 } from './sha256';

export const GENESIS = '0'.repeat(64);

export interface ChainEntry {
  seq: number;
  wall: string;
  t: number;
  actor: string;
  action: string;
  detail: string;
  data?: unknown;
  prev: string;
  hash: string;
}

export const entryHash = (e: Omit<ChainEntry, 'hash'>) =>
  sha256(e.prev + JSON.stringify({ seq: e.seq, wall: e.wall, t: e.t, actor: e.actor, action: e.action, detail: e.detail, data: e.data ?? null }));

export function verifyChain(entries: ChainEntry[]): { ok: boolean; brokenAt?: number } {
  let prev = GENESIS;
  for (const e of entries) {
    if (e.prev !== prev || entryHash(e) !== e.hash) return { ok: false, brokenAt: e.seq };
    prev = e.hash;
  }
  return { ok: true };
}
