import { motion } from 'motion/react';
import { useMemo } from 'react';
import type { CapabilityResult, MCResult } from '@/engine';
import { fmtDay, fmtDur, fmtT } from '@/engine/time';
import { useEngine } from '@/state/engine';
import { useStore } from '@/state/store';
import { StatusBadge } from '@/components/ui';
import { cn, STATUS_COLOR } from '@/lib/util';

const LABEL_W = 150;
const SEV = { info: '#38bdf8', warn: '#fbbf24', crit: '#fb3b5c' } as const;

function quantile(sorted: Float64Array, p: number) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))] : NaN;
}

export function Timeline({ mc }: { mc?: MCResult }) {
  const { scenario, at, result, nodes, impacts, applied, focus } = useEngine();
  const selectCap = useStore((s) => s.selectCap);
  const selectedCap = useStore((s) => s.selectedCap);
  const focusEvent = useStore((s) => s.focusEvent);
  const [h0, h1] = [scenario.timeScale === 'days' ? 0 : scenario.horizon[0], scenario.horizon[1]];
  const pct = (t: number) => ((Math.min(h1, Math.max(h0, t)) - h0) / (h1 - h0)) * 100;
  const x = (t: number) => `${pct(t)}%`;
  const span = (a: number, b: number) => ({ left: x(a), width: `${Math.max(0, pct(b) - pct(a))}%` });
  const days = scenario.timeScale === 'days' ? Array.from({ length: Math.floor((h1 - h0) / 24) + 1 }, (_, i) => h0 + i * 24) : Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i);

  const history = useMemo(() => {
    const out: Record<string, { t: number; ready: number; id: string }[]> = {};
    for (const e of applied) {
      const imp = impacts[e.id];
      if (!imp) continue;
      for (const c of imp.after.capabilities) (out[c.id] ??= []).push({ t: e.t, ready: c.ready, id: e.id });
    }
    return out;
  }, [applied, impacts]);

  const gates = Object.values(nodes).filter((n) => n.kind === 'gate' && n.windows?.length);

  const lane = (c: CapabilityResult) => {
    const col = STATUS_COLOR[c.status];
    const sel = c.id === selectedCap;
    const needed = scenario.phases.filter((p) => p.requires.includes(c.id));
    const sorted = mc?.targets[c.id] ? Float64Array.from(mc.targets[c.id].margins).sort() : undefined;
    const p90r = sorted ? c.requiredBy - quantile(sorted, 0.1) : NaN;
    const p10r = sorted ? c.requiredBy - quantile(sorted, 0.9) : NaN;
    const pMeet = mc?.targets[c.id]?.pMeet;
    const hist = (history[c.id] ?? []).filter((h) => Number.isFinite(h.ready));
    const from = Math.max(at, h0);
    return (
      <div
        key={c.id}
        onClick={() => selectCap(c.id)}
        className={cn('group relative flex h-[54px] cursor-pointer items-stretch border-b border-sky-300/[0.06] transition', sel ? 'bg-calc/[0.05]' : 'hover:bg-white/[0.02]')}
      >
        <div className="flex shrink-0 items-center gap-2 border-r border-sky-300/10 px-2" style={{ width: LABEL_W }}>
          <StatusBadge status={c.status} size="md" pulse={sel && c.status !== 'Y'} />
          <div className="min-w-0">
            <div className="font-display text-[13px] font-bold tracking-[0.14em] text-white">{c.code}</div>
            <div className="font-mono text-[10px]" style={{ color: col }}>
              {c.margin >= 0 ? fmtDur(c.margin) : `−${fmtDur(-c.margin)}`}
            </div>
          </div>
          {pMeet !== undefined && (
            <div className="ml-auto text-right font-mono text-[9px] text-mute">
              P(meet)
              <div className={cn('text-[11px] font-bold', pMeet >= 0.9 ? 'text-ok' : pMeet >= 0.6 ? 'text-unc' : 'text-crit')}>{Math.round(pMeet * 100)}%</div>
            </div>
          )}
        </div>
        <div className="relative flex-1">
          {needed.map((p) => (
            <div key={p.id} className="absolute inset-y-1 border-x border-sky-300/10 bg-sky-300/[0.035]" style={span(p.start, p.end)} title={`${p.name} requires ${c.code}`} />
          ))}
          {needed.map((p) =>
            c.ready > p.start ? (
              <div
                key={`gap-${p.id}`}
                className="animate-crit absolute inset-y-1 rounded-[2px] border border-crit/70"
                style={{ ...span(p.start, Math.min(p.end, c.ready)), background: 'repeating-linear-gradient(135deg,#fb3b5c44 0 5px,#fb3b5c14 5px 10px)' }}
                title={`${c.code} not ready for ${p.name}`}
              >
                <span className="absolute left-1 top-0.5 font-mono text-[8.5px] font-bold text-crit">GAP · {p.name}</span>
              </div>
            ) : null,
          )}
          {c.ready > from && (
            <motion.div
              className="absolute top-[19px] h-[16px] rounded-[2px]"
              initial={false}
              animate={span(from, Math.min(h1, c.ready))}
              transition={{ duration: 0.4 }}
              style={{ background: `repeating-linear-gradient(135deg, ${col}55 0 6px, ${col}22 6px 12px)`, border: `1px solid ${col}88` }}
            >
              <span className="absolute left-1.5 top-[1px] whitespace-nowrap font-mono text-[9.5px] font-semibold text-white/90">DOWN · {c.controlling.label}</span>
            </motion.div>
          )}
          {Number.isFinite(c.ready) && (
            <motion.div className="absolute top-[26px] h-[2px] rounded" initial={false} animate={span(Math.max(from, c.ready), h1)} style={{ background: '#34d399', boxShadow: '0 0 8px #34d39988', opacity: 0.6 }} />
          )}
          {Number.isFinite(p10r) && (
            <div
              className="absolute top-[12px] h-[30px] rounded-[3px]"
              style={{ ...span(Math.max(from, p10r), Number.isFinite(p90r) ? p90r : h1), background: Number.isFinite(p90r) ? `${col}1a` : 'linear-gradient(90deg,#fb3b5c22,#fb3b5c44)', border: `1px dashed ${Number.isFinite(p90r) ? `${col}66` : '#fb3b5c88'}` }}
              title={`P10–P90 ready window from ${mc?.n} simulated futures`}
            >
              {!Number.isFinite(p90r) && <span className="absolute right-1 top-[1px] font-mono text-[8.5px] font-bold text-crit">P90: NO WINDOW</span>}
            </div>
          )}
          {hist.map((h, i) => (
            <div
              key={h.id}
              className="absolute top-[23px] h-[8px] w-[8px] -translate-x-1/2 rotate-45 border"
              style={{ left: x(h.ready), borderColor: `${col}`, opacity: 0.15 + (0.5 * (i + 1)) / hist.length }}
              title={`${h.id}: predicted ready ${fmtT(scenario, h.ready)}`}
            />
          ))}
          {Number.isFinite(c.ready) && (
            <motion.div className="absolute top-[20px] z-10" initial={false} animate={{ left: x(c.ready) }} transition={{ duration: 0.4 }}>
              <div className="h-[14px] w-[14px] -translate-x-1/2 rotate-45" style={{ background: col, boxShadow: `0 0 14px ${col}` }} />
            </motion.div>
          )}
          <div className="absolute inset-y-1" style={{ left: x(c.requiredBy) }}>
            <div className="h-full w-[2px] bg-white/80" />
            <span className="absolute -top-0.5 left-1 whitespace-nowrap rounded-[2px] bg-black/60 px-0.5 font-mono text-[8.5px] font-bold text-white">REQ {fmtT(scenario, c.requiredBy)}</span>
          </div>
          {Number.isFinite(c.ready) && c.ready < c.requiredBy && (
            <div className="absolute bottom-[4px] h-[8px] border-x border-b" style={{ ...span(Math.max(from, c.ready), c.requiredBy), borderColor: `${col}88` }}>
              <span className="absolute -bottom-[1px] left-1/2 -translate-x-1/2 translate-y-full whitespace-nowrap font-mono text-[8px]" style={{ color: col }} />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex h-[22px] shrink-0 border-b border-sky-300/10">
        <div style={{ width: LABEL_W }} className="shrink-0 border-r border-sky-300/10 px-2 pt-1 font-mono text-[9px] text-mute">
          {scenario.timeScale === 'days' ? 'DAY' : 'TIME'}
        </div>
        <div className="relative flex-1">
          {days.map((d) => (
            <span key={d} className="absolute top-1 -translate-x-1/2 font-mono text-[9px] text-sky-300/50" style={{ left: x(d + (scenario.timeScale === 'days' ? 12 : 0)) }}>
              {scenario.timeScale === 'days' ? fmtDay(scenario, d) : fmtT(scenario, d)}
            </span>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: LABEL_W }}>
          {days.map((d) => (
            <div key={d} className="absolute inset-y-0 border-l border-sky-300/[0.06]" style={{ left: x(d) }} />
          ))}
        </div>

        <div className="relative flex h-[26px] border-b border-sky-300/[0.08]">
          <div style={{ width: LABEL_W }} className="label flex shrink-0 items-center border-r border-sky-300/10 px-2 !text-[9px]">
            Mission phases
          </div>
          <div className="relative flex-1">
            {scenario.phases.map((p) => (
              <div
                key={p.id}
                className={cn('absolute inset-y-1 flex items-center overflow-hidden rounded-[2px] border px-1.5', p.start >= scenario.mission.start ? 'border-crit/30 bg-crit/[0.08]' : 'border-sky-300/20 bg-sky-400/[0.07]')}
                style={span(p.start, p.end)}
                title={`${p.name} · ${fmtT(scenario, p.start)} – ${fmtT(scenario, p.end)}`}
              >
                <span className="truncate font-display text-[9px] font-semibold tracking-[0.12em] text-sky-100/80">{p.name}</span>
              </div>
            ))}
          </div>
        </div>

        {gates.map((g) => (
          <div key={g.id} className="relative flex h-[22px] border-b border-sky-300/[0.05]">
            <div style={{ width: LABEL_W }} className="flex shrink-0 items-center truncate border-r border-sky-300/10 px-2 font-mono text-[9.5px] text-teal-200/70" title={g.label}>
              {g.label}
            </div>
            <div className="relative flex-1">
              {g.windows!.map((w) => {
                const used = result.nodes[g.id]?.usedWindow === w.id;
                const off = w.enabled === false;
                return (
                  <div
                    key={w.id}
                    className={cn('absolute inset-y-[3px] flex items-center overflow-hidden rounded-[2px] border px-1', used ? 'border-teal-300 bg-teal-300/25 shadow-[0_0_12px_#2dd4bf66]' : off ? 'border-dashed border-sky-300/25' : 'border-teal-300/30 bg-teal-300/[0.07]')}
                    style={{ ...span(w.start, w.end), minWidth: 3 }}
                    title={`${w.label}${off ? ` (needs ${w.authority ?? 'approval'})` : ''}: ${fmtT(scenario, w.start)} – ${fmtT(scenario, w.end)}${w.lag ? `, +${fmtDur(w.lag)} lead time` : ''}`}
                  >
                    <span className={cn('truncate whitespace-nowrap font-mono text-[8.5px]', used ? 'text-white' : 'text-teal-100/60')}>{w.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div className="relative flex h-[24px] border-b border-sky-300/[0.08]">
          <div style={{ width: LABEL_W }} className="label flex shrink-0 items-center border-r border-sky-300/10 px-2 !text-[9px]">
            Change stream
          </div>
          <div className="relative flex-1">
            {scenario.events.map((e) => {
              const on = applied.some((a) => a.id === e.id);
              const isFocus = focus?.event.id === e.id;
              const consequential = impacts[e.id]?.diff.consequential;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={(ev) => {
                    ev.stopPropagation();
                    focusEvent(e.id);
                  }}
                  className="absolute top-[4px] -translate-x-1/2"
                  style={{ left: x(e.t) }}
                  title={`${fmtT(scenario, e.t)} · ${e.title}`}
                >
                  <span
                    className={cn('block h-[14px] w-[4px] rounded-[1px]', isFocus && 'ring-2 ring-white')}
                    style={{ background: on ? SEV[e.severity] : '#334155', boxShadow: on && consequential ? `0 0 10px ${SEV[e.severity]}` : undefined, opacity: on ? 1 : 0.5 }}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {result.capabilities.map(lane)}

        <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: LABEL_W }}>
          <div className="absolute inset-y-0" style={{ left: x(scenario.mission.start) }}>
            <div className="h-full w-[2px] bg-crit/70 shadow-[0_0_12px_#fb3b5c]" />
          </div>
          <motion.div className="absolute inset-y-0" initial={false} animate={{ left: x(at) }} transition={{ type: 'tween', duration: 0.15 }}>
            <div className="h-full w-[2px] bg-calc shadow-[0_0_14px_#22d3ee]" />
          </motion.div>
          <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-black/40 to-black/10" style={{ width: x(at) }} />
        </div>
      </div>
    </div>
  );
}
