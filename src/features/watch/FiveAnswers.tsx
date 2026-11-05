import { ArrowRight, Bot, CalendarClock, CircleCheck, Clock, Cylinder, FileText, Hourglass, ListChecks, RefreshCw, TriangleAlert, UserRound, Wrench } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Line } from '@/api/types';
import { BRAND } from '@/brand';
import { fmtDur, fmtT } from '@/lib/time';
import { useCapAnalysis, useAnalysisKey } from '@/state/analysis';
import { useEngine } from '@/state/engine';
import { useStore } from '@/state/store';
import { templateBrief, useNarrative } from '@/lib/narrator';
import { cn, STATUS_COLOR, TONE_HEX } from '@/lib/util';
import { MarginValue, SourceChip, StatusBadge } from '@/components/ui';
import { Typewriter } from '@/components/Typewriter';
import { OptionCard } from './OptionCard';

function Q({ n, title, children, accent = '#22d3ee' }: { n: string; title: string; children: ReactNode; accent?: string }) {
  return (
    <div className="relative border-b border-sky-300/[0.08] px-3.5 py-3">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-mono text-[11px] font-bold" style={{ color: accent }}>
          {n}
        </span>
        <span className="font-display text-[11.5px] font-semibold uppercase tracking-[0.2em] text-sky-100/90">{title}</span>
      </div>
      {children}
    </div>
  );
}

function LineRow({ l }: { l: Line }) {
  const c = TONE_HEX[l.tone === 'ok' ? 'ok' : l.tone === 'crit' ? 'crit' : l.tone === 'warn' ? 'warn' : 'info'];
  return (
    <div className="flex gap-2 py-0.5">
      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rotate-45" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />
      <div className="min-w-0">
        <div className="text-[12.5px] leading-snug text-sky-50/90">{l.text}</div>
        {l.refs.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {l.refs.slice(0, 2).map((r, i) => (
              <SourceChip key={i} src={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const KIND_ICON = { window: CalendarClock, person: UserRound, input: FileText, duration: Hourglass, crew: UserRound, stock: Cylinder, check: ListChecks };

export function FiveAnswers() {
  const { scenario, cap, focus, nodes, at } = useEngine();
  const analysis = useCapAnalysis(cap?.id);
  const key = useAnalysisKey();
  const nav = useNavigate();
  const selectNode = useStore((s) => s.selectNode);

  const allOptions = analysis ? [...analysis.options.combos, ...analysis.options.singles] : [];
  const best = allOptions.filter((o) => o.available && (o.effective || o.levers.some((l) => l.category === 'accept')));
  const ineffective = analysis?.options.singles.filter((o) => o.available && !o.effective && !o.levers.some((l) => l.category === 'accept')) ?? [];
  const brief = cap && analysis ? templateBrief(scenario, cap, focus, allOptions, analysis.lines) : '';
  const narrative = useNarrative(`${key}|${cap?.id}|${focus?.event.id}`, [...(focus?.lines.map((l) => l.text) ?? []), ...(analysis?.lines.map((l) => l.text) ?? [])], brief);

  if (!cap) return null;
  if (!analysis)
    return (
      <section className="hud flex h-full min-h-0 flex-col items-center justify-center gap-2">
        <RefreshCw size={18} className="animate-spin text-calc" />
        <span className="label">Computing {cap.code}: slack, options, Monte Carlo…</span>
      </section>
    );
  const changeLines = focus?.lines.filter((l) => l.kind === 'change') ?? [];
  const impactLines = focus?.lines.filter((l) => l.kind !== 'change') ?? [];
  const ctlLine = analysis.lines.find((l) => l.kind === 'control');
  const uncLines = analysis.lines.filter((l) => l.kind === 'uncertainty' || l.kind === 'cliff' || l.kind === 'redundancy');
  const mc = analysis.mc.targets[cap.id] ?? { pMeet: 0, p10: NaN, p90: NaN };
  const Icon = KIND_ICON[cap.controlling.kind] ?? Wrench;
  const color = STATUS_COLOR[cap.status];
  const isLlm = narrative.source === 'LLM';

  return (
    <section className="hud flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-sky-400/10 px-3.5 py-2">
        <span className="label !text-[11px] !text-sky-200/80">Watchstander picture</span>
        <span className="font-display text-[13px] font-bold tracking-[0.14em]" style={{ color }}>
          {cap.code}
        </span>
        <span className="ml-auto font-mono text-[9.5px] text-mute">as of {fmtT(scenario, at)}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn('relative mx-3 mt-3 overflow-hidden rounded-[3px] border p-3', isLlm ? 'border-ai/40 bg-ai/[0.06]' : 'border-calc/25 bg-calc/[0.04]')}>
          {isLlm && <div className="shimmer pointer-events-none absolute inset-0 opacity-40" />}
          <div className="relative mb-1.5 flex items-center gap-2">
            <Bot size={13} className={isLlm ? 'text-ai' : 'text-calc'} />
            <span className={cn('font-display text-[10px] font-bold uppercase tracking-[0.2em]', isLlm ? 'text-ai' : 'text-calc')}>
              {isLlm ? 'AI watch brief · advisory' : narrative.source === 'HALTED' ? 'Brief halted' : 'Auto-brief · deterministic template'}
            </span>
            <span className="ml-auto font-mono text-[9px] text-mute">{isLlm ? 'local LLM · every value checked against the facts below' : 'LLM not required'}</span>
          </div>
          <p className={cn('relative text-[12.5px] leading-relaxed', isLlm ? 'text-violet-100/90' : 'text-sky-100/85')}>
            <Typewriter text={narrative.text} />
          </p>
        </div>

        <Q n="01" title="What changed">
          {focus ? (
            <>
              <div className="mb-1 flex items-center gap-2">
                <Clock size={12} className="text-mute" />
                <span className="font-mono text-[11px] text-calc">{fmtT(scenario, focus.event.t)}</span>
                <span className="truncate text-[12.5px] font-semibold text-white">{focus.event.title}</span>
              </div>
              {changeLines.length ? changeLines.map((l, i) => <LineRow key={i} l={l} />) : <div className="text-[12px] text-sky-200/60">{focus.event.detail}</div>}
            </>
          ) : (
            <div className="text-[12px] text-mute">No changes ingested yet.</div>
          )}
        </Q>

        <Q n="02" title="What it affects">
          {impactLines.length ? impactLines.map((l, i) => <LineRow key={i} l={l} />) : <div className="text-[12px] text-mute">Baseline picture.</div>}
        </Q>

        <Q n="03" title="What controls readiness" accent={cap.upNow ? '#34d399' : '#fbbf24'}>
          {cap.upNow ? (
            <div className="flex items-center gap-2 text-[12.5px] text-ok">
              <CircleCheck size={15} /> {cap.code} is available now. No open dependency controls it.
            </div>
          ) : (
            <>
              <button type="button" onClick={() => (selectNode(cap.controlling.nodeId), nav('/graph'))} className="group flex w-full items-center gap-3 rounded-[3px] border border-unc/30 bg-unc/[0.06] p-2.5 text-left transition hover:border-unc/70">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] border border-unc/50 bg-unc/10 text-unc shadow-[0_0_16px_-4px_#fbbf24]">
                  <Icon size={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-unc/80">Controlling constraint · {cap.controlling.kind}</div>
                  <div className="truncate text-[15px] font-semibold text-white">{cap.controlling.label}</div>
                </div>
                <ArrowRight size={15} className="text-unc/60 transition group-hover:translate-x-0.5 group-hover:text-unc" />
              </button>
              {ctlLine && <div className="mt-1.5 text-[12px] leading-snug text-sky-100/80">{ctlLine.text.replace(`Controlling constraint: ${cap.controlling.label}. `, '')}</div>}
              {cap.coCritical.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="label !text-[9px] !text-orange-300/80">Also binding now</span>
                  {cap.coCritical.map((id) => (
                    <span key={id} className="rounded-[2px] border border-orange-300/30 bg-orange-300/10 px-1.5 font-mono text-[10px] text-orange-200">
                      {nodes[id]?.label ?? id}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-2 space-y-0.5">
                {analysis.slack.slice(0, 3).map((s) => (
                  <div key={s.nodeId} className="flex items-center justify-between gap-2 font-mono text-[10.5px]">
                    <span className="truncate text-sky-200/70">{nodes[s.nodeId]?.label}</span>
                    <span className="shrink-0">
                      <span className={s.noImpact < 1e-6 ? 'text-unc' : 'text-calc'}>slack {s.unbounded ? 'no limit' : fmtDur(s.noImpact)}</span>
                      <span className="text-mute"> · </span>
                      <span className={s.toFailure < 0 ? 'text-crit' : 'text-sky-100'}>to fail {s.toFailure >= 0 ? fmtDur(s.toFailure) : s.recoverable && Number.isFinite(s.toFailure) ? `need ${fmtDur(-s.toFailure)}` : 'n/a'}</span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Q>

        <Q n="04" title="Margin & certainty" accent={color}>
          <div className="flex items-center gap-4">
            <StatusBadge status={cap.status} size="xl" pulse />
            <div className="min-w-0 flex-1">
              <div className="label !text-[9px]">Mission margin</div>
              <MarginValue margin={cap.margin} kind={cap.marginKind} className="font-mono text-[30px] font-bold leading-none text-white" />
              <div className="mt-1 font-mono text-[10.5px] text-mute">
                ready {fmtT(scenario, cap.ready)} · req {fmtT(scenario, cap.requiredBy)}
              </div>
            </div>
            <div className="text-right">
              <div className="label !text-[9px]">P(meets)</div>
              <div className="font-mono text-[24px] font-bold leading-none" style={{ color: mc.pMeet > 0.9 ? '#34d399' : mc.pMeet > 0.6 ? '#fbbf24' : '#fb3b5c' }}>
                {Math.round(mc.pMeet * 100)}%
              </div>
              <div className="mt-1 font-mono text-[9.5px] text-mute">P10 {fmtDur(mc.p10)} · P90 {fmtDur(mc.p90)}</div>
            </div>
          </div>
          <div className="mt-2 space-y-0.5">
            {uncLines.length === 0 && <div className="flex items-center gap-1.5 text-[11.5px] text-ok/80"><CircleCheck size={12} /> No data-quality flags on the critical chain.</div>}
            {uncLines.map((l, i) => (
              <div key={i} className="flex gap-2 text-[11.5px] leading-snug" style={{ color: l.tone === 'crit' ? '#fda4af' : '#fde68a' }}>
                <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                {l.text}
              </div>
            ))}
          </div>
        </Q>

        <Q n="05" title="Bounded options" accent="#34d399">
          {ineffective.length > 0 && best.some((o) => o.levers.length > 1) && (
            <div className="mb-2 rounded-[3px] border border-unc/25 bg-unc/[0.05] px-2 py-1.5 text-[11px] leading-snug text-amber-100/85">
              <span className="font-semibold text-unc">{ineffective.length} single actions recover nothing</span> because the controlling constraint is not what they fix. Packages below address every binding constraint.
            </div>
          )}
          <div className="space-y-1.5">
            {best.slice(0, 4).map((o, i) => (
              <motion.div key={o.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <OptionCard o={o} rank={i + 1} />
              </motion.div>
            ))}
            {best.length === 0 && <div className="text-[12px] text-mute">No option in the authorized lever library improves {cap.code} at {fmtT(scenario, at)}.</div>}
          </div>
          <div className="mt-2.5 rounded-[3px] border border-sky-300/10 bg-black/30 px-2 py-1.5 font-mono text-[9.5px] leading-relaxed text-mute">
            {BRAND.name} may analyze, explain, alert and propose. It will not issue orders, direct personnel, authorize maintenance, alter tasking, or write to OMMS-NG, R-Supply or NSIPS.
          </div>
        </Q>
      </div>
    </section>
  );
}
