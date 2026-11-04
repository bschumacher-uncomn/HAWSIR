import { motion } from 'motion/react';
import { fmtDay, fmtT } from '@/engine/time';
import { useEngine } from '@/state/engine';
import { STATUS_COLOR } from '@/lib/util';
import { Legend } from '@/components/ui';

export function MissionStrip() {
  const { scenario, at, result, nodes } = useEngine();
  const [h0, h1] = scenario.horizon;
  const x = (t: number) => `${((Math.min(h1, Math.max(h0, t)) - h0) / (h1 - h0)) * 100}%`;
  const days = scenario.timeScale === 'days' ? Array.from({ length: Math.floor((h1 - h0) / 24) + 1 }, (_, i) => h0 + i * 24) : Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i);
  const windows = Object.values(nodes)
    .flatMap((n) => (n.windows ?? []).filter((w) => w.enabled !== false).map((w) => ({ ...w, node: n.id })))
    .filter((w, i, a) => a.findIndex((y) => y.label === w.label) === i);

  return (
    <div className="hud relative h-[78px] shrink-0 overflow-hidden px-3 pt-2">
      <div className="mb-1 flex items-center gap-3">
        <span className="label !text-sky-200/80">Mission timeline</span>
        <span className="font-mono text-[10px] text-mute">{scenario.mission.tasking}</span>
        <span className="ml-auto">
          <Legend />
        </span>
      </div>
      <div className="relative h-[46px]">
        {days.map((d, i) => (
          <div key={d} className="absolute top-0 h-full border-l border-sky-300/[0.07]" style={{ left: x(d) }}>
            {(scenario.timeScale === 'hours' || i % 2 === 0) && <span className="absolute -top-0.5 left-1 font-mono text-[8.5px] text-sky-300/35">{scenario.timeScale === 'days' ? fmtDay(scenario, d) : fmtT(scenario, d)}</span>}
          </div>
        ))}
        {windows.map((w) => (
          <div key={w.id + w.label} className="absolute top-3 h-[30px] rounded-[2px] border border-teal-300/25 bg-teal-300/[0.06]" style={{ left: x(w.start), width: `calc(${x(w.end)} - ${x(w.start)})`, minWidth: 2 }} title={`${w.label}: ${fmtT(scenario, w.start)} – ${fmtT(scenario, w.end)}`} />
        ))}
        {scenario.phases.map((p) => (
          <div
            key={p.id}
            className="absolute bottom-0 flex h-[16px] items-center overflow-hidden border-l border-r border-sky-300/20 bg-gradient-to-r from-sky-400/10 to-sky-400/[0.03] px-1.5"
            style={{ left: x(p.start), width: `calc(${x(p.end)} - ${x(p.start)})` }}
            title={p.name}
          >
            <span className="truncate font-display text-[9px] font-semibold tracking-[0.12em] text-sky-200/80">{p.name}</span>
          </div>
        ))}
        {result.capabilities.map((c, i) =>
          Number.isFinite(c.ready) ? (
            <div key={c.id} className="absolute" style={{ left: x(c.ready), top: 12 + (i % 3) * 7 }} title={`${c.code} projected ready ${fmtT(scenario, c.ready)}`}>
              <div className="h-[6px] w-[6px] -translate-x-1/2 rotate-45" style={{ background: STATUS_COLOR[c.status], boxShadow: `0 0 8px ${STATUS_COLOR[c.status]}` }} />
            </div>
          ) : null,
        )}
        <div className="absolute top-0 h-full" style={{ left: x(scenario.mission.start) }}>
          <div className="h-full w-[2px] bg-white/70 shadow-[0_0_12px_white]" />
          <span className="absolute -top-0.5 left-1.5 whitespace-nowrap font-display text-[9px] font-bold tracking-[0.18em] text-white">MISSION</span>
        </div>
        <motion.div className="absolute top-0 h-full" animate={{ left: x(at) }} transition={{ type: 'tween', duration: 0.15 }}>
          <div className="h-full w-[2px] bg-calc shadow-[0_0_14px_#22d3ee]" />
          <div className="absolute -left-[5px] -top-[2px] h-0 w-0 border-x-[6px] border-t-[7px] border-x-transparent border-t-calc" />
          <span className="absolute left-1.5 top-[13px] whitespace-nowrap rounded-[2px] bg-calc/15 px-1 font-mono text-[9px] font-bold text-calc">NOW</span>
        </motion.div>
      </div>
    </div>
  );
}
