import { useEffect, useRef, useState } from 'react';
import { createMonteCarlo, type MCResult } from '@/engine';
import { useAnalysisKey } from '@/state/analysis';
import { useEngine } from '@/state/engine';

export interface MCStream {
  snap: MCResult | null;
  progress: number;
  rate: number;
  elapsedMs: number;
  running: boolean;
  rerun: () => void;
}

/** Streams a seeded Monte Carlo into the UI over ~1s so the distribution visibly builds. */
export function useMCStream(n: number, seed: number): MCStream {
  const { scenario, nodes, at } = useEngine();
  const key = useAnalysisKey();
  const live = useRef({ scenario, nodes, at });
  live.current = { scenario, nodes, at };
  const [state, setState] = useState<Omit<MCStream, 'rerun'>>({ snap: null, progress: 0, rate: 0, elapsedMs: 0, running: false });
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    const { scenario: s, nodes: ns, at: t } = live.current;
    const runner = createMonteCarlo(s, ns, t, n, seed);
    const t0 = performance.now();
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = 0;
    const chunk = Math.max(10, Math.ceil(n / 55));
    const tick = () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      const start = performance.now();
      // hidden tabs throttle rAF to ~1 Hz; finish synchronously there
      const target = document.hidden ? n : runner.done + chunk;
      while (runner.done < target && (document.hidden || performance.now() - start < 24)) runner.step(Math.min(10, target - runner.done));
      busy += performance.now() - start;
      const el = performance.now() - t0;
      setState({ snap: runner.snapshot(), progress: runner.done / n, rate: runner.done / Math.max(0.001, busy / 1000), elapsedMs: el, running: runner.done < n });
      if (runner.done < n) schedule();
    };
    const schedule = () => {
      raf = requestAnimationFrame(tick);
      timer = setTimeout(tick, 40);
    };
    setState((st) => ({ ...st, running: true, progress: 0 }));
    schedule();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [key, n, seed, runId]);

  return { ...state, rerun: () => setRunId((x) => x + 1) };
}
