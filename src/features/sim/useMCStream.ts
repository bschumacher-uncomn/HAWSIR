import { useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import type { McChunk, Readiness } from '@/api/types';
import { useAnalysisAt, useAnalysisKey } from '@/state/analysis';
import { useEngine } from '@/state/engine';
import { useStore } from '@/state/store';

export interface MCTarget {
  /** One margin per run with a known outcome: −∞ no delivery window, +∞ unbounded. */
  margins: Float64Array;
  pMeet: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface MCResult {
  n: number;
  seed: number;
  targets: Record<string, MCTarget>;
  /** Per capability: share of futures in which each node was on its critical chain. */
  criticality: Record<string, Record<string, number>>;
  /** Per capability: share of futures in which each leaf constraint controlled readiness. */
  controlling: Record<string, Record<string, number>>;
  uncertain: string[];
}

export interface MCStream {
  snap: MCResult | null;
  progress: number;
  rate: number;
  elapsedMs: number;
  running: boolean;
  error?: string;
  rerun: () => void;
}

interface Acc {
  margins: number[];
  never: number;
  unbounded: number;
  status: Record<Readiness, number>;
  chain: Record<string, number>;
  controlling: Record<string, number>;
}

const add = (into: Record<string, number>, from: Record<string, number>) => {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
};

function snapshotOf(acc: Record<string, Acc>, done: number, seed: number, uncertain: string[]): MCResult {
  const n = Math.max(1, done);
  const targets: MCResult['targets'] = {};
  const criticality: MCResult['criticality'] = {};
  const controlling: MCResult['controlling'] = {};
  for (const [id, a] of Object.entries(acc)) {
    const m = new Float64Array(a.margins.length + a.never + a.unbounded);
    m.set(a.margins);
    m.fill(-Infinity, a.margins.length, a.margins.length + a.never);
    m.fill(Infinity, a.margins.length + a.never);
    const sorted = Float64Array.from(m).sort();
    const q = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))] : NaN);
    targets[id] = { margins: m, pMeet: (a.status.Y + a.status.Q) / n, p10: q(0.1), p50: q(0.5), p90: q(0.9) };
    criticality[id] = Object.fromEntries(Object.entries(a.chain).map(([k, v]) => [k, v / n]));
    controlling[id] = Object.fromEntries(Object.entries(a.controlling).map(([k, v]) => [k, v / n]));
  }
  return { n: done, seed, targets, criticality, controlling, uncertain };
}

/**
 * Streams a seeded Monte Carlo from mission-api in chunks so the distribution
 * visibly builds. Chunks of one seed concatenate into the same futures however
 * they are split, so a run is reproducible from (picture, what-ifs, n, seed).
 */
export function useMCStream(n: number, seed: number): MCStream {
  const { snapshot, whatIfActive } = useEngine();
  const shifts = useStore((s) => s.shifts);
  const key = useAnalysisKey();
  const at = useAnalysisAt();
  const live = useRef({ mission: snapshot.mission, at, shifts: whatIfActive ? shifts : {} });
  live.current = { mission: snapshot.mission, at, shifts: whatIfActive ? shifts : {} };
  const shiftKey = whatIfActive ? JSON.stringify(Object.entries(shifts).filter(([, v]) => v).sort()) : '';
  const [state, setState] = useState<Omit<MCStream, 'rerun'>>({ snap: null, progress: 0, rate: 0, elapsedMs: 0, running: false });
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    const { mission, at: t, shifts: sh } = live.current;
    const ctl = new AbortController();
    const chunk = Math.max(50, Math.min(500, Math.ceil(n / 20)));
    const t0 = performance.now();
    const acc: Record<string, Acc> = {};
    let done = 0;
    let uncertain: string[] = [];
    setState((st) => ({ ...st, running: true, progress: 0, error: undefined }));
    (async () => {
      try {
        while (done < n && !ctl.signal.aborted) {
          const count = Math.min(chunk, n - done);
          const r = await api.post<McChunk>(`/m/${mission}/montecarlo`, { at: t, seed, start: done, count, shifts: sh }, ctl.signal);
          if (ctl.signal.aborted) return;
          for (const [id, x] of Object.entries(r.targets)) {
            const a = (acc[id] ??= { margins: [], never: 0, unbounded: 0, status: { Y: 0, Q: 0, N: 0, UNK: 0 }, chain: {}, controlling: {} });
            for (const v of x.margins) a.margins.push(v);
            a.never += x.never;
            a.unbounded += x.unbounded;
            add(a.status, x.status);
            add(a.chain, x.chain);
            add(a.controlling, x.controlling);
          }
          uncertain = r.uncertain;
          done += count;
          const el = performance.now() - t0;
          setState({ snap: snapshotOf(acc, done, seed, uncertain), progress: done / n, rate: done / Math.max(0.001, el / 1000), elapsedMs: el, running: done < n });
        }
      } catch (e) {
        if (!ctl.signal.aborted) setState((st) => ({ ...st, running: false, error: (e as Error).message }));
      }
    })();
    return () => ctl.abort();
  }, [key, shiftKey, n, seed, runId]);

  return { ...state, rerun: () => setRunId((x) => x + 1) };
}
