import { AlarmClock, CalendarClock, DoorClosed, Flag, Hourglass, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo } from 'react';
import { fmtDur, fmtT } from '@/engine/time';
import { useEngine } from '@/state/engine';
import { useStore } from '@/state/store';
import { cn } from '@/lib/util';

interface Item {
  t: number;
  kind: 'lever' | 'window' | 'required' | 'phase' | 'stale';
  title: string;
  sub: string;
  offShip?: boolean;
}

const ICON: Record<Item['kind'], LucideIcon> = { lever: AlarmClock, window: DoorClosed, required: Flag, phase: CalendarClock, stale: Hourglass };
const KIND: Record<Item['kind'], string> = { lever: 'DECISION DEADLINE', window: 'WINDOW CLOSES', required: 'CAPABILITY REQUIRED', phase: 'PHASE STARTS', stale: 'DATA GOES STALE' };

/** Everything that expires before the mission, soonest first: the "act by" list. */
export function Deadlines() {
  const { scenario, at, nodes, result } = useEngine();
  const approved = useStore((s) => s.approved);
  const hours = scenario.timeScale === 'hours';

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const l of scenario.levers) {
      if (l.deadline === undefined || approved.includes(l.id)) continue;
      if (l.requiresNodes?.some((id) => !nodes[id])) continue;
      out.push({ t: l.deadline, kind: 'lever', title: l.title, sub: l.authority, offShip: !l.withinShipAuthority });
    }
    for (const n of Object.values(nodes)) {
      for (const w of n.windows ?? []) {
        if (w.enabled === false) continue;
        out.push({ t: w.end, kind: 'window', title: w.label, sub: `${n.label}${result.nodes[n.id]?.usedWindow === w.id ? ' · IN USE' : ''}` });
      }
      if (n.staleAfter && n.sources?.length) {
        const asOf = Math.max(...n.sources.map((s) => s.asOf));
        out.push({ t: asOf + n.staleAfter, kind: 'stale', title: n.label, sub: `${n.sources[n.sources.length - 1].system} last report ${fmtT(scenario, asOf)}` });
      }
    }
    for (const c of result.capabilities) out.push({ t: c.requiredBy, kind: 'required', title: `${c.code} · ${c.label}`, sub: `projected ${c.upNow ? 'up now' : `ready ${fmtT(scenario, c.ready)}`}` });
    for (const p of scenario.phases) if (p.start > scenario.watchStart) out.push({ t: p.start, kind: 'phase', title: p.name, sub: p.location ?? '' });
    return out
      .filter((i) => i.t > at - (hours ? 0.5 : 6))
      .filter((i, k, a) => a.findIndex((j) => j.title === i.title && j.kind === i.kind) === k)
      .sort((a, b) => a.t - b.t)
      .slice(0, 14);
  }, [scenario, nodes, result, approved, at, hours]);

  return (
    <div className="space-y-1 p-2">
      {items.map((it) => {
        const left = it.t - at;
        const past = left < 0;
        const urgent = !past && left < (hours ? 1 : 24);
        const soon = !past && left < (hours ? 3 : 72);
        const tone = past ? 'text-mute' : urgent ? 'text-crit' : soon ? 'text-unc' : 'text-calc';
        const border = past ? 'border-sky-300/5' : urgent ? 'border-crit/50' : soon ? 'border-unc/30' : 'border-sky-300/10';
        const Icon = ICON[it.kind];
        return (
          <motion.div
            layout
            key={`${it.kind}-${it.title}`}
            className={cn('flex items-center gap-2.5 rounded-[3px] border bg-black/25 px-2 py-1.5', border, urgent && it.kind === 'lever' && 'animate-crit', past && 'opacity-50')}
          >
            <Icon size={14} className={cn('shrink-0', tone)} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className={cn('font-mono text-[8.5px] tracking-wider', tone)}>{KIND[it.kind]}</span>
                {it.offShip && <span className="rounded-[2px] border border-ai/40 px-0.5 font-mono text-[8px] text-ai">OFF-SHIP</span>}
              </div>
              <div className="truncate text-[11.5px] text-sky-50" title={it.title}>
                {it.title}
              </div>
              <div className="truncate font-mono text-[9px] text-mute">{it.sub}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className={cn('font-mono text-[12px] font-bold tabular', tone)}>{past ? 'passed' : `T−${fmtDur(left)}`}</div>
              <div className="font-mono text-[9px] text-mute">{fmtT(scenario, it.t)}</div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
