import { AnimatePresence, motion } from 'motion/react';
import { fmtDelta, fmtT } from '@/lib/time';
import { useEngine, type EventImpact } from '@/state/engine';
import { useStore } from '@/state/store';
import { cn } from '@/lib/util';
import { Panel, RadarSweep } from '@/components/ui';

export function impactTag(imp: EventImpact): { text: string; color: string } {
  if (imp.event.kind === 'baseline') return { text: 'BASELINE', color: '#7dd3fc' };
  const moved = imp.diff.caps.filter((c) => Math.abs(c.marginDelta) > 1e-6 || c.statusChanged || c.controlChanged);
  if (!moved.length) return { text: imp.event.kind === 'quality' ? 'FLAGGED · NO CONSEQUENCE' : 'NO MISSION CONSEQUENCE', color: '#34d399' };
  const worst = [...moved].sort((a, b) => a.marginDelta - b.marginDelta)[0];
  if (worst.marginDelta < -1e-6) return { text: `${worst.code} ${fmtDelta(worst.marginDelta)}`, color: worst.after.status === 'N' || worst.marginDelta < -48 ? '#fb3b5c' : '#fbbf24' };
  if (worst.controlChanged) return { text: `${worst.code} CONTROL SHIFT`, color: '#fbbf24' };
  if (worst.marginDelta > 1e-6) return { text: `${worst.code} ${fmtDelta(worst.marginDelta)}`, color: '#34d399' };
  return { text: `${worst.code} ${worst.before?.status}→${worst.after.status}`, color: '#fbbf24' };
}

const SEV = { info: '#7dd3fc', warn: '#fbbf24', crit: '#fb3b5c' };

export function ChangeFeed() {
  const { applied, impacts, scenario, focus } = useEngine();
  const focusEvent = useStore((s) => s.focusEvent);
  const next = scenario.events.find((e) => !applied.includes(e));
  const items = [...applied].reverse();

  return (
    <Panel
      title="Incoming change stream"
      index="FEED"
      className="h-full"
      bodyClass="flex gap-2 overflow-x-auto p-2"
      right={
        <span className="flex items-center gap-2 font-mono text-[10px] text-mute">
          <RadarSweep size={14} />
          {next ? 'listening…' : 'all feeds current'}
        </span>
      }
    >
      <AnimatePresence initial={false}>
        {items.map((e) => {
          const imp = impacts[e.id];
          const tag = imp ? impactTag(imp) : { text: '', color: '#64748b' };
          const sel = focus?.event.id === e.id;
          return (
            <motion.button
              layout
              key={e.id}
              type="button"
              initial={{ opacity: 0, x: -30, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => focusEvent(e.id)}
              className={cn('relative flex w-[230px] shrink-0 flex-col rounded-[3px] border p-2 text-left transition', sel ? 'border-calc/60 bg-calc/[0.07]' : 'border-sky-300/10 bg-black/25 hover:border-sky-300/30')}
            >
              <span className="absolute inset-y-0 left-0 w-[2px]" style={{ background: SEV[e.severity] }} />
              <div className="flex items-center gap-1.5 font-mono text-[10px]">
                <span className="text-calc">{fmtT(scenario, e.t)}</span>
                <span className="rounded-[2px] bg-white/5 px-1 text-sky-200/70">{e.source.system}</span>
                <span className="ml-auto text-[9px] uppercase text-mute">{e.kind}</span>
              </div>
              <div className="mt-1 line-clamp-2 text-[12px] font-semibold leading-snug text-sky-50">{e.title}</div>
              <div className="mt-auto pt-1.5">
                <span className="inline-block rounded-[2px] px-1.5 py-0.5 font-mono text-[9.5px] font-bold" style={{ color: tag.color, background: `${tag.color}16`, border: `1px solid ${tag.color}44` }}>
                  {tag.text}
                </span>
              </div>
            </motion.button>
          );
        })}
      </AnimatePresence>
      {next && (
        <div className="flex w-[160px] shrink-0 flex-col items-center justify-center rounded-[3px] border border-dashed border-sky-300/15 p-2 text-center">
          <span className="label !text-[9px]">Next feed</span>
          <span className="mt-1 font-mono text-[10px] text-sky-300/50">awaiting {next.source.system}</span>
        </div>
      )}
    </Panel>
  );
}
