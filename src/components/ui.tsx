import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import type { QualityFlag, Readiness, SourceRef } from '@/engine/types';
import { dtg } from '@/engine/time';
import { useEngine } from '@/state/engine';
import { cn, FLAG_META, STATUS_COLOR, STATUS_WORD } from '@/lib/util';

export function Panel({
  title,
  index,
  right,
  children,
  className,
  bodyClass,
  tone,
}: {
  title?: ReactNode;
  index?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
  tone?: 'crit' | 'ai';
}) {
  return (
    <section className={cn('hud flex min-h-0 min-w-0 flex-col', tone === 'crit' && 'hud-crit', tone === 'ai' && 'hud-ai', className)}>
      {(title || right) && (
        <header className="flex shrink-0 items-center gap-2 border-b border-sky-400/10 px-3 py-2">
          {index && <span className="font-mono text-[10px] text-calc/70">{index}</span>}
          {title && <h2 className="label !text-[11px] !text-sky-200/80">{title}</h2>}
          <div className="ml-auto flex items-center gap-2">{right}</div>
        </header>
      )}
      <div className={cn('min-h-0 flex-1', bodyClass)}>{children}</div>
    </section>
  );
}

export function StatusBadge({ status, size = 'md', pulse }: { status: Readiness; size?: 'sm' | 'md' | 'lg' | 'xl'; pulse?: boolean }) {
  const c = STATUS_COLOR[status];
  const dims = { sm: 'h-5 w-5 text-[11px]', md: 'h-7 w-7 text-sm', lg: 'h-10 w-10 text-lg', xl: 'h-16 w-16 text-3xl' }[size];
  return (
    <span className="relative inline-flex shrink-0">
      {pulse && status !== 'Y' && <span className="animate-pulse-ring absolute inset-0 rounded-sm" style={{ border: `1px solid ${c}` }} />}
      <span
        className={cn('relative inline-flex items-center justify-center rounded-sm font-display font-bold', dims)}
        style={{ color: c, background: `${c}1a`, border: `1px solid ${c}88`, boxShadow: `0 0 16px ${c}44, inset 0 0 10px ${c}22` }}
        title={STATUS_WORD[status]}
      >
        {status}
      </span>
    </span>
  );
}

export function FlagBadge({ flag }: { flag: QualityFlag }) {
  const m = FLAG_META[flag];
  return (
    <span
      className="inline-flex items-center rounded-[2px] px-1 py-px font-mono text-[9px] font-semibold tracking-wider"
      style={{ color: m.color, background: `${m.color}18`, border: `1px solid ${m.color}55` }}
    >
      {m.label}
    </span>
  );
}

export function SourceChip({ src, onClick }: { src: SourceRef; onClick?: () => void }) {
  const { scenario } = useEngine();
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${src.system} ${src.recordId}\nas of ${dtg(scenario, src.asOf)}${src.value ? `\nvalue: ${src.value}` : ''}${src.note ? `\n${src.note}` : ''}`}
      className="inline-flex max-w-full items-center gap-1 truncate rounded-[2px] border border-sky-300/20 bg-sky-300/5 px-1.5 py-px font-mono text-[9.5px] text-sky-200/80 transition hover:border-calc/60 hover:text-calc"
    >
      <span className="text-calc/80">{src.system}</span>
      <span className="truncate opacity-70">{src.recordId}</span>
    </button>
  );
}

export function Ticker({ value, format, className }: { value: number; format: (v: number) => string; className?: string }) {
  const mv = useMotionValue(Number.isFinite(value) ? value : 0);
  const text = useTransform(mv, (v) => format(v));
  useEffect(() => {
    if (!Number.isFinite(value)) {
      mv.set(value);
      return;
    }
    const ctl = animate(mv, value, { duration: 0.9, ease: [0.2, 0.8, 0.2, 1] });
    return () => ctl.stop();
  }, [value, mv]);
  return <motion.span className={cn('tabular', className)}>{text}</motion.span>;
}

export function Kv({ k, v, className }: { k: ReactNode; v: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 text-[12px]', className)}>
      <span className="label !text-[9.5px]">{k}</span>
      <span className="text-right font-mono text-sky-100">{v}</span>
    </div>
  );
}

export function Pill({ children, color = '#22d3ee', className }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-[2px] px-1.5 py-0.5 font-display text-[10px] font-semibold uppercase tracking-[0.14em]', className)}
      style={{ color, background: `${color}14`, border: `1px solid ${color}44` }}
    >
      {children}
    </span>
  );
}

export function Legend() {
  return (
    <div className="flex items-center gap-3 font-mono text-[9.5px] uppercase tracking-wider text-mute">
      <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-calc shadow-[0_0_8px_#22d3ee]" />Calculated</span>
      <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-ai shadow-[0_0_8px_#a78bfa]" />AI advisory</span>
      <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-unc shadow-[0_0_8px_#fbbf24]" />Uncertain</span>
      <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-crit shadow-[0_0_8px_#fb3b5c]" />Mission risk</span>
    </div>
  );
}

export function RadarSweep({ size = 28, color = '#22d3ee' }: { size?: number; color?: string }) {
  return (
    <span className="relative inline-block shrink-0 overflow-hidden rounded-full" style={{ width: size, height: size, border: `1px solid ${color}66` }}>
      <span className="absolute inset-[30%] rounded-full" style={{ border: `1px solid ${color}44` }} />
      <span
        className="animate-sweep absolute inset-0"
        style={{ background: `conic-gradient(from 0deg, transparent 0deg, transparent 280deg, ${color}aa 360deg)` }}
      />
      <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: color }} />
    </span>
  );
}

export function Btn({
  children,
  onClick,
  tone = 'calc',
  className,
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: 'calc' | 'ok' | 'crit' | 'ghost' | 'ai' | 'unc';
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const tones = {
    calc: 'border-calc/50 text-calc hover:bg-calc/15 hover:shadow-[0_0_20px_-4px_#22d3ee]',
    ok: 'border-ok/50 text-ok hover:bg-ok/15 hover:shadow-[0_0_20px_-4px_#34d399]',
    crit: 'border-crit/60 text-crit hover:bg-crit/15 hover:shadow-[0_0_20px_-4px_#fb3b5c]',
    unc: 'border-unc/50 text-unc hover:bg-unc/15',
    ai: 'border-ai/50 text-ai hover:bg-ai/15 hover:shadow-[0_0_20px_-4px_#a78bfa]',
    ghost: 'border-sky-300/15 text-sky-200/70 hover:border-sky-300/40 hover:text-sky-100',
  }[tone];
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-[3px] border bg-black/20 px-2.5 py-1 font-display text-[11px] font-semibold uppercase tracking-[0.14em] transition disabled:cursor-not-allowed disabled:opacity-35',
        tones,
        className,
      )}
    >
      {children}
    </button>
  );
}
