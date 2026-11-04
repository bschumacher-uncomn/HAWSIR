import { useEffect, useMemo, useRef, useState } from 'react';
import { entryHash, GENESIS } from '@/lib/audit';
import type { AuditEntry } from '@/state/store';

export type LinkState = 'ok' | 'bad' | 'after';

/** Per-entry verification: 'bad' where content no longer matches its hash, 'after' for entries downstream of a break. */
export function useChainStatus(audit: AuditEntry[]) {
  return useMemo(() => {
    const out: LinkState[] = [];
    let prev = GENESIS;
    let broken = false;
    for (const e of audit) {
      const ok = e.prev === prev && entryHash(e) === e.hash;
      out.push(broken ? 'after' : ok ? 'ok' : 'bad');
      if (!ok) broken = true;
      prev = e.hash;
    }
    const brokenAt = out.indexOf('bad');
    return { states: out, brokenAt: brokenAt >= 0 ? audit[brokenAt].seq : undefined };
  }, [audit]);
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
      setScan(Math.ceil(f * total));
      if (f < 1) raf.current = requestAnimationFrame(tick);
      else setDone(true);
    };
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return { scan, done, start, reset: () => (setScan(null), setDone(false)) };
}

export interface EdgeRow extends AuditEntry {
  serverVerified: boolean;
  receivedAt: string;
}

/** The edge node's append-only copy of the audit (GET /api/audit). Null when unreachable. */
export function useEdgeCopy(pollMs = 4000) {
  const [rows, setRows] = useState<EdgeRow[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    const pull = () =>
      fetch('/api/audit', { signal: AbortSignal.timeout(2500) })
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((j: EdgeRow[]) => alive && (setRows(j), setErr(false)))
        .catch(() => alive && setErr(true));
    pull();
    const id = setInterval(pull, pollMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pollMs]);
  const byHash = useMemo(() => new Map((rows ?? []).map((r) => [r.hash, r])), [rows]);
  return { rows, err, byHash };
}
