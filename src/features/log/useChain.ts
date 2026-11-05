import { useEffect, useRef, useState } from 'react';

/** One entry of a hash chain as the log screen draws it (a decision or an ingested report). */
export interface ChainRow {
  seq: number;
  wall: string;
  t: number;
  actor: string;
  action: string;
  detail: string;
  prev: string;
  hash: string;
  flagged?: boolean;
}

export type LinkState = 'ok' | 'bad' | 'after';

/** Per-entry state from a verification result: 'bad' at the first entry that fails, 'after' for everything chained after it. */
export function chainStates(n: number, brokenAt: number | undefined): LinkState[] {
  return Array.from({ length: n }, (_, i) => (brokenAt === undefined || i < brokenAt ? 'ok' : i === brokenAt ? 'bad' : 'after'));
}

/** Animated verification sweep across the chain; returns the seq the scan has reached. */
export function useVerifyScan(n: number) {
  const [scan, setScan] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  const raf = useRef(0);
  const nRef = useRef(n);
  nRef.current = n;
  const start = () => {
    cancelAnimationFrame(raf.current);
    setDone(false);
    const t0 = performance.now();
    const tick = (now: number) => {
      const total = nRef.current;
      const f = Math.min(1, (now - t0) / Math.min(2200, 500 + total * 18));
      setScan(Math.ceil(f * total) - 1);
      if (f < 1) raf.current = requestAnimationFrame(tick);
      else setDone(true);
    };
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return { scan, done, start, reset: () => (setScan(null), setDone(false)) };
}
