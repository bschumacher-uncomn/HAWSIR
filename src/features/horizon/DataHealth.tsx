import { useMemo } from 'react';
import type { QualityFlag, SourceSystem } from '@/engine/types';
import { fmtDur } from '@/engine/time';
import { useEngine } from '@/state/engine';
import { FLAG_META } from '@/lib/util';

/** Freshness of every feed and the data-quality flags currently in play. */
export function DataHealth() {
  const { scenario, at, nodes, result } = useEngine();
  const hours = scenario.timeScale === 'hours';
  const staleAt = hours ? 2 : 72;

  const feeds = useMemo(() => {
    const last: Partial<Record<SourceSystem, { asOf: number; n: number }>> = {};
    for (const n of Object.values(nodes)) {
      for (const s of [...(n.sources ?? []), ...(n.conflict ? [n.conflict.source] : [])]) {
        if (s.system === 'NAVIFI') continue;
        const cur = last[s.system];
        last[s.system] = { asOf: Math.max(cur?.asOf ?? -Infinity, s.asOf), n: (cur?.n ?? 0) + 1 };
      }
    }
    return (Object.entries(last) as [SourceSystem, { asOf: number; n: number }][]).sort((a, b) => a[1].asOf - b[1].asOf);
  }, [nodes]);

  const staleSystems = useMemo(() => {
    const out = new Set<SourceSystem>();
    for (const [id, r] of Object.entries(result.nodes)) if (r.flags.includes('stale')) for (const s of nodes[id]?.sources ?? []) out.add(s.system);
    return out;
  }, [result, nodes]);

  const flags = useMemo(() => {
    const out: Partial<Record<QualityFlag, string[]>> = {};
    for (const [id, r] of Object.entries(result.nodes)) for (const f of r.flags) if (f !== 'no-redundancy' || nodes[id]?.kind === 'kofn') (out[f] ??= []).push(id);
    return out;
  }, [result, nodes]);

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] gap-3 p-3">
      <div className="min-h-0 space-y-1 overflow-y-auto">
        <div className="label mb-1 !text-[9px]">Feeds · age of newest record in use</div>
        {feeds.map(([sys, f]) => {
          const age = at - f.asOf;
          const frac = Math.min(1, age / (staleAt * 4));
          const stale = staleSystems.has(sys);
          const col = stale ? '#fbbf24' : '#22d3ee';
          return (
            <div key={sys} className="grid grid-cols-[78px_minmax(0,1fr)_70px] items-center gap-2">
              <span className="font-mono text-[10px] text-sky-100">{sys}</span>
              <div className="relative h-[5px] rounded-full bg-white/[0.05]">
                <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(3, frac * 100)}%`, background: col, opacity: stale ? 1 : 0.55, boxShadow: stale ? `0 0 6px ${col}` : undefined }} />
              </div>
              <span className="text-right font-mono text-[10px] tabular" style={{ color: stale ? col : '#94a3b8' }}>
                {stale ? 'STALE · ' : ''}
                {age <= 0 ? 'live' : fmtDur(age)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="min-h-0 space-y-1.5 overflow-y-auto">
        <div className="label mb-1 !text-[9px]">Data quality in play</div>
        {(Object.keys(FLAG_META) as QualityFlag[]).map((f) => {
          const ids = flags[f] ?? [];
          return (
            <div key={f} className="flex items-start gap-2">
              <span
                className="w-[92px] shrink-0 rounded-[2px] px-1 py-px text-center font-mono text-[9px] font-semibold"
                style={{ color: ids.length ? FLAG_META[f].color : '#334155', border: `1px solid ${ids.length ? `${FLAG_META[f].color}66` : '#1e293b'}` }}
              >
                {FLAG_META[f].label} {ids.length}
              </span>
              <span className="min-w-0 truncate font-mono text-[9.5px] text-sky-200/60" title={ids.map((id) => nodes[id]?.label).join(', ')}>
                {ids.map((id) => nodes[id]?.label).join(' · ') || '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
