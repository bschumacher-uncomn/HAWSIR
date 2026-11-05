import { CircleCheck, FastForward, TriangleAlert, Zap } from 'lucide-react';
import { motion } from 'motion/react';
import type { EventImpact } from '@/state/engine';
import type { ChangeEvent } from '@/api/types';
import type { ThreadSpec } from './types';
import { fmtDelta, fmtDur, fmtMargin } from '@/lib/time';
import { cn } from '@/lib/util';
import type { StepTime } from './model';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function ThreadTimeline({
  spec,
  times,
  base,
  t0,
  t1,
  at,
  tau,
  due,
  fmt,
  hours,
}: {
  spec: ThreadSpec;
  times: Record<string, StepTime>;
  base?: Record<string, StepTime>;
  t0: number;
  t1: number;
  at: number;
  tau: number;
  due?: number;
  fmt: (t: number) => string;
  hours: boolean;
}) {
  const span = Math.max(1e-6, t1 - t0);
  const pct = (t: number) => `${((clamp(t, t0, t1) - t0) / span) * 100}%`;
  const w = (a: number, b: number) => `${(Math.max(0, clamp(b, t0, t1) - clamp(a, t0, t1)) / span) * 100}%`;
  const step = hours ? (span > 14 ? 2 : 1) : span > 24 * 14 ? 48 : 24;
  const ticks: number[] = [];
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) ticks.push(t);
  const rows = spec.lanes.map((l) => ({ lane: l, steps: spec.steps.filter((s) => s.lane === l.id && (s.kind === 'task' || s.kind === 'gate')) })).filter((r) => r.steps.length);

  return (
    <div className="flex h-full flex-col px-3 pb-2 pt-1">
      <div className="relative ml-[118px] h-4 shrink-0">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2 font-mono text-[9px] text-mute" style={{ left: pct(t) }}>
            {fmt(t)}
          </span>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="space-y-[5px]">
          {rows.map(({ lane, steps }) => (
            <div key={lane.id} className="flex items-center gap-2">
              <span className="w-[110px] shrink-0 truncate font-display text-[9.5px] font-semibold uppercase tracking-[0.1em]" style={{ color: lane.color }}>
                {lane.label}
              </span>
              <div className="relative h-[17px] flex-1 rounded-[2px] bg-white/[0.025]">
                {steps.map((s) => {
                  const t = times[s.id];
                  const b = base?.[s.id];
                  if (!t || !Number.isFinite(t.end)) return null;
                  const instant = t.end - t.start < 1e-6;
                  const live = tau >= t.start && tau < t.end;
                  return (
                    <div key={s.id}>
                      {b && Number.isFinite(b.end) && Math.abs(t.delta) > 1e-6 && (
                        <div className="absolute inset-y-0 rounded-[2px] border border-dashed border-sky-200/30" style={{ left: pct(b.start), width: w(b.start, b.end) }} />
                      )}
                      {t.start - t.arrive > 1e-6 && <div className="hatch-crit absolute inset-y-[3px] rounded-[1px]" style={{ left: pct(t.arrive), width: w(t.arrive, t.start) }} title={t.wait?.label} />}
                      {instant ? (
                        <div className="absolute inset-y-0 w-[3px] -translate-x-1/2 rounded" style={{ left: pct(t.end), background: lane.color, boxShadow: `0 0 6px ${lane.color}` }} title={s.label} />
                      ) : (
                        <div
                          className={cn('absolute inset-y-[1px] overflow-hidden rounded-[2px] px-1 font-mono text-[8.5px] leading-[15px] text-[#02060c]', t.onChain && 'ring-1 ring-white/60')}
                          style={{ left: pct(t.start), width: w(t.start, t.end), background: lane.color, opacity: tau >= t.end ? 0.6 : 1, boxShadow: live ? `0 0 10px ${lane.color}` : undefined }}
                          title={`${s.label} ${fmt(t.start)}–${fmt(t.end)}`}
                        >
                          <span className="truncate font-semibold">{s.label}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-[118px] right-0">
          {due !== undefined && Number.isFinite(due) && (
            <div className="absolute inset-y-0 border-l-2 border-dashed border-crit/80" style={{ left: pct(due) }}>
              <span className="absolute -top-0.5 left-1 rounded-[2px] bg-crit px-1 font-display text-[8.5px] font-bold tracking-[0.12em] text-white">DUE {fmt(due)}</span>
            </div>
          )}
          <div className="absolute inset-y-0 w-px bg-calc shadow-[0_0_8px_#22d3ee]" style={{ left: pct(at) }}>
            <span className="absolute bottom-0 left-1 font-mono text-[8.5px] text-calc">WATCH {fmt(at)}</span>
          </div>
          {Math.abs(tau - at) > 1e-6 && (
            <div className="absolute inset-y-0 w-[2px] bg-white shadow-[0_0_10px_#fff]" style={{ left: pct(tau) }}>
              <span className="absolute -top-0.5 left-1 rounded-[2px] bg-white px-1 font-mono text-[8.5px] font-bold text-black">{fmt(tau)}</span>
            </div>
          )}
        </div>
      </div>
      <div className="mt-1 flex shrink-0 items-center gap-3 font-mono text-[9px] uppercase tracking-wider text-mute">
        <span className="flex items-center gap-1">
          <i className="hatch-crit h-2 w-5 rounded-[1px]" /> waiting on crew / window
        </span>
        <span className="flex items-center gap-1">
          <i className="h-2 w-5 rounded-[1px] border border-dashed border-sky-200/40" /> plan as ingested
        </span>
        <span className="flex items-center gap-1">
          <i className="h-2 w-5 rounded-[1px] bg-sky-300 ring-1 ring-white/60" /> critical chain
        </span>
      </div>
    </div>
  );
}

const BOARD_COLOR = { DEGRADED: '#fbbf24', FAULT: '#f97316', CONSTRAINT: '#c084fc', DOWN: '#fb3b5c' } as const;

export interface Verdict {
  tone: 'ok' | 'warn' | 'crit';
  head: string;
  text: string;
}

export function verdictFor(imp: EventImpact | undefined, capId: string, slackLeft: number | undefined): Verdict | undefined {
  if (!imp) return undefined;
  const c = imp.diff.caps.find((x) => x.id === capId);
  const left = slackLeft !== undefined && slackLeft > 1 / 60 ? ` · ${fmtDur(slackLeft)} slack left` : '';
  if (!c || (Math.abs(c.marginDelta) < 1e-6 && !c.statusChanged && !c.controlChanged)) return { tone: 'ok', head: 'ABSORBED', text: `No mission impact${left}` };
  const m = c.after.margin;
  const margin = c.after.marginKind !== 'exact' ? fmtMargin(m, c.after.marginKind) : m >= 0 ? fmtDur(m) : `−${fmtDur(-m)}`;
  if (c.after.status === 'N' && c.before?.status !== 'N') return { tone: 'crit', head: 'CONTROLS OUTCOME', text: `${c.after.controlling.label} · margin ${margin}` };
  if (c.statusChanged && Math.abs(c.marginDelta) < 1e-6) {
    return { tone: 'warn', head: `CERTAINTY ${c.before?.status}→${c.after.status}`, text: c.after.reasons[0] ?? 'data quality on the critical chain' };
  }
  if (c.marginDelta < 0) return { tone: c.after.status === 'Y' ? 'ok' : 'warn', head: 'EATS MARGIN', text: `${fmtDelta(c.marginDelta)} · still ${c.after.status} at ${margin}` };
  return { tone: 'ok', head: 'IMPROVES', text: `${fmtDelta(c.marginDelta)} · ${c.after.status} at ${margin}` };
}

const TONE = { ok: '#34d399', warn: '#fbbf24', crit: '#fb3b5c' };

export function StatusBoard({
  events,
  at,
  verdicts,
  fmt,
  onJump,
  controller,
}: {
  events: ChangeEvent[];
  at: number;
  verdicts: Record<string, Verdict | undefined>;
  fmt: (t: number) => string;
  onJump: (e: ChangeEvent) => void;
  controller?: { label: string; tone: Verdict['tone'] };
}) {
  const board = events.filter((e) => e.kind !== 'baseline');
  const reported = board.filter((e) => e.t <= at + 1e-9);
  const counts = reported.reduce<Record<string, number>>((m, e) => ((m[e.board?.status ?? 'REPORT'] = (m[e.board?.status ?? 'REPORT'] ?? 0) + 1), m), {});
  return (
    <div className="flex h-full flex-col gap-1 overflow-y-auto px-3 py-1.5">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-2 px-1 font-display text-[9px] font-semibold uppercase tracking-[0.16em] text-mute">
        <span>Status board says</span>
        <span>Executable thread says</span>
      </div>
      {board.map((e) => {
        const v = verdicts[e.id];
        const done = e.t <= at + 1e-9;
        const bc = e.board ? BOARD_COLOR[e.board.status] : '#7dd3fc';
        return (
          <motion.div
            key={e.id}
            layout
            className={cn('grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-2 rounded-[3px] border px-1.5 py-1', done ? 'border-sky-300/15 bg-black/25' : 'border-dashed border-sky-300/10 bg-black/10')}
            style={done && v?.tone === 'crit' ? { borderColor: '#fb3b5c88', boxShadow: '0 0 18px -6px #fb3b5c' } : undefined}
          >
            <div className={cn('min-w-0', !done && 'opacity-55')}>
              <div className="flex items-center gap-1.5">
                <span className="rounded-[2px] px-1 font-display text-[9px] font-bold tracking-[0.12em]" style={{ color: bc, background: `${bc}18`, border: `1px solid ${bc}55` }}>
                  {e.board?.status ?? e.kind.toUpperCase()}
                </span>
                <span className="truncate font-mono text-[10px] text-sky-200/80">{e.board?.system}</span>
                <span className="ml-auto shrink-0 font-mono text-[9px] text-mute">{fmt(e.t)}</span>
              </div>
              <div className="mt-0.5 truncate text-[11px] font-semibold leading-snug text-sky-50" title={`${e.title}\n${e.detail}`}>
                {e.title}
              </div>
            </div>
            <div className="min-w-0">
              {done && v ? (
                <>
                  <div className="flex items-center gap-1 font-display text-[10px] font-bold tracking-[0.14em]" style={{ color: TONE[v.tone] }}>
                    {v.tone === 'crit' ? <Zap size={11} /> : v.tone === 'warn' ? <TriangleAlert size={11} /> : <CircleCheck size={11} />}
                    {v.head}
                  </div>
                  <div className="mt-0.5 truncate text-[10.5px] leading-snug text-sky-100/80" title={v.text}>
                    {v.text}
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => onJump(e)}
                  title="Advance watch time to this report"
                  className="mt-0.5 flex items-center gap-1 rounded-[3px] border border-calc/40 bg-calc/10 px-2 py-0.5 font-display text-[10px] font-semibold tracking-[0.14em] text-calc transition hover:bg-calc/25"
                >
                  <FastForward size={11} /> INJECT · {fmt(e.t)}
                </button>
              )}
            </div>
          </motion.div>
        );
      })}
      <div className="mt-auto truncate rounded-[3px] border border-sky-300/10 bg-black/30 px-2 py-1 text-[10.5px] leading-snug text-sky-100/75">
        <span className="text-mute">Board: </span>
        {Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(' · ') || 'all green'}
        <span className="text-mute"> → Thread: </span>
        {controller ? (
          <span className="font-semibold" style={{ color: TONE[controller.tone] }}>
            {controller.label} controls
          </span>
        ) : (
          <span className="text-mute">waiting for reports</span>
        )}
      </div>
    </div>
  );
}
