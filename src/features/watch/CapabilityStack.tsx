import { motion } from 'motion/react';
import { fmtDur, fmtMargin, fmtT } from '@/lib/time';
import { useEngine } from '@/state/engine';
import { useStore } from '@/state/store';
import { cn, STATUS_COLOR } from '@/lib/util';
import { MarginValue, Panel, StatusBadge } from '@/components/ui';

export function CapabilityStack() {
  const { result, scenario, at, authResult, whatIfActive, plannedActive } = useEngine();
  const selected = useStore((s) => s.selectedCap);
  const select = useStore((s) => s.selectCap);
  const counts = { Y: 0, Q: 0, N: 0, UNK: 0 };
  for (const c of result.capabilities) counts[c.status]++;

  return (
    <Panel
      title="Mission capabilities"
      index="CAP"
      className="h-full"
      bodyClass="overflow-y-auto p-2 space-y-1.5"
      right={
        <span className="flex gap-1.5 font-mono text-[10px]">
          <span className="text-ok">{counts.Y}Y</span>
          <span className="text-unc">{counts.Q}Q</span>
          <span className="text-crit">{counts.N}N</span>
          {counts.UNK > 0 && <span className="text-ai">{counts.UNK}?</span>}
        </span>
      }
    >
      {result.capabilities.map((c) => {
        const sel = c.id === selected;
        const color = STATUS_COLOR[c.status];
        const auth = authResult.capabilities.find((x) => x.id === c.id);
        const changedByPlan = (whatIfActive || plannedActive) && auth && (auth.marginKind !== c.marginKind || Math.abs(auth.margin - c.margin) > 1e-6);
        const span = Math.max(1, c.requiredBy - at);
        const readyPct = Number.isFinite(c.ready) ? Math.min(100, Math.max(0, ((c.ready - at) / span) * 100)) : 100;
        return (
          <motion.button
            layout
            key={c.id}
            type="button"
            onClick={() => select(c.id)}
            className={cn(
              'group relative w-full overflow-hidden rounded-[3px] border p-2.5 text-left transition',
              sel ? 'border-calc/60 bg-calc/[0.07] shadow-[0_0_24px_-8px_#22d3ee]' : 'border-sky-300/10 bg-black/20 hover:border-sky-300/30',
            )}
          >
            {c.status !== 'Y' && <div className="pointer-events-none absolute inset-y-0 left-0 w-[3px]" style={{ background: color, boxShadow: `0 0 12px ${color}` }} />}
            <div className="flex items-center gap-2.5">
              <StatusBadge status={c.status} size="lg" pulse={c.status !== 'Y'} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-[17px] font-bold tracking-[0.12em] text-white">{c.code}</span>
                  <span
                    className={cn(
                      'rounded-[2px] px-1 font-mono text-[9px] font-bold',
                      c.upNow ? 'bg-ok/15 text-ok' : c.status === 'Y' ? 'bg-calc/10 text-calc/80' : 'bg-crit/15 text-crit',
                    )}
                    title="Current material state, independent of the readiness forecast at mission start"
                  >
                    {c.upNow ? 'UP NOW' : c.status === 'Y' ? 'NOT UP YET' : 'DOWN NOW'}
                  </span>
                </div>
                <div className="truncate text-[11px] text-sky-200/60">{c.label}</div>
              </div>
              <div className="text-right">
                <div className="label !text-[8.5px]">Margin</div>
                <MarginValue margin={c.margin} kind={c.marginKind} className="font-mono text-[15px] font-semibold" />
              </div>
            </div>
            <div className="mt-2">
              <div className="relative h-[6px] rounded-full bg-white/[0.05]">
                <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ background: `linear-gradient(90deg, ${color}55, ${color})`, boxShadow: `0 0 10px ${color}88` }} animate={{ width: `${c.upNow ? 100 : 100 - readyPct}%` }} />
                {!c.upNow && <motion.div className="absolute -top-[3px] h-3 w-[2px] bg-white" animate={{ left: `${readyPct}%` }} />}
              </div>
              <div className="mt-1 flex justify-between font-mono text-[9.5px] text-mute">
                <span>ready {c.upNow ? 'now' : fmtT(scenario, c.ready)}</span>
                <span>req {fmtT(scenario, c.requiredBy)}</span>
              </div>
            </div>
            {changedByPlan && auth && (
              <div className="mt-1 font-mono text-[9.5px] text-ai">
                plan/what-if: {c.marginKind === 'exact' && auth.marginKind === 'exact' ? fmtDur(c.margin - auth.margin, { signed: true }) : `${fmtMargin(auth.margin, auth.marginKind)} → ${fmtMargin(c.margin, c.marginKind)}`} vs authoritative
              </div>
            )}
          </motion.button>
        );
      })}
    </Panel>
  );
}
