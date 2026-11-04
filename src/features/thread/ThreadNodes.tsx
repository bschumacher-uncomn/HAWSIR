import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Handle, Position, type Edge, type EdgeProps, type Node, type NodeProps } from '@xyflow/react';
import {
  CalendarClock,
  Check,
  Flag,
  Gavel,
  Hourglass,
  Package,
  Plane,
  Radio,
  Rocket,
  ScanSearch,
  Ship,
  Split,
  UserCog,
  Users,
  Waves,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { memo } from 'react';
import type { QualityFlag, Readiness, ThreadStep } from '@/engine/types';
import { FLAG_META, STATUS_COLOR, STATUS_WORD, cn } from '@/lib/util';
import type { LinkState, StepState, StepTime } from './model';
import { PACKET_MS, usePackets } from './store';

const LANE_ICON: Record<string, LucideIcon> = {
  co: Gavel,
  cmd: Ship,
  usv: Waves,
  net: Radio,
  pma: ScanSearch,
  air: Plane,
  logistics: Package,
  maintenance: Wrench,
  ordnance: Rocket,
  personnel: Users,
  comms: Radio,
  schedule: CalendarClock,
  capability: Gavel,
};

export interface Resource {
  id: string;
  label: string;
  ok: boolean;
  flags: QualityFlag[];
}

export interface StepData extends Record<string, unknown> {
  step: ThreadStep;
  time: StepTime;
  state: StepState;
  color: string;
  chainColor: string;
  tau: number;
  span: string;
  dur: string;
  delta: string;
  waitText?: string;
  resources: Resource[];
  outcome?: 'yes' | 'no';
  cap?: { status: Readiness; margin: string; due: string; eta: string };
  w: number;
  h: number;
}

export interface LaneData extends Record<string, unknown> {
  label: string;
  sub?: string;
  color: string;
  laneId: string;
  w: number;
  h: number;
  active: number;
}

export interface LinkData extends Record<string, unknown> {
  state: LinkState;
  color: string;
  chain: boolean;
  chainColor: string;
  float?: string;
  branch?: 'yes' | 'no';
}

export type StepNode = Node<StepData, 'step'>;
export type LaneNode = Node<LaneData, 'lane'>;
export type LinkEdge = Edge<LinkData, 'link'>;

const hidden = '!h-1.5 !w-1.5 !min-w-0 !border-0 !bg-transparent';

function Handles() {
  return (
    <>
      <Handle id="l" type="target" position={Position.Left} className={hidden} />
      <Handle id="tt" type="target" position={Position.Top} className={hidden} />
      <Handle id="bt" type="target" position={Position.Bottom} className={hidden} />
      <Handle id="r" type="source" position={Position.Right} className={hidden} />
      <Handle id="ts" type="source" position={Position.Top} className={hidden} />
      <Handle id="bs" type="source" position={Position.Bottom} className={hidden} />
    </>
  );
}

function Token({ label, color, waiting }: { label: string; color: string; waiting?: boolean }) {
  return (
    <div className="pointer-events-none absolute -right-2 -top-3 z-20 flex items-center">
      <span className="absolute inset-0 animate-pulse-ring rounded-full" style={{ border: `1px solid ${waiting ? '#fb3b5c' : color}` }} />
      <span
        className="relative flex items-center gap-1 rounded-full px-1.5 py-px font-display text-[9.5px] font-bold tracking-[0.12em] text-[#02060c]"
        style={{ background: waiting ? '#fb3b5c' : color, boxShadow: `0 0 14px ${waiting ? '#fb3b5c' : color}` }}
      >
        {waiting && <Hourglass size={9} />}
        {label}
      </span>
    </div>
  );
}

function Chips({ resources }: { resources: Resource[] }) {
  if (!resources.length) return null;
  const shown = resources.slice(0, 3);
  return (
    <div className="mt-1 flex min-w-0 flex-wrap gap-1">
      {shown.map((r) => {
        const flag = r.flags.find((f) => f !== 'no-redundancy');
        const c = flag ? FLAG_META[flag].color : r.ok ? '#34d399' : '#fb3b5c';
        return (
          <span key={r.id} className="flex max-w-[92px] items-center gap-1 rounded-[2px] border px-1 font-mono text-[8.5px] leading-[13px]" style={{ borderColor: `${c}55`, color: `${c}`, background: `${c}10` }} title={r.label}>
            <i className="h-1 w-1 shrink-0 rounded-full" style={{ background: c, boxShadow: `0 0 4px ${c}` }} />
            <span className="truncate">{flag ? FLAG_META[flag].label : r.label}</span>
          </span>
        );
      })}
      {resources.length > 3 && <span className="font-mono text-[8.5px] text-mute">+{resources.length - 3}</span>}
    </div>
  );
}

function stateStyle(d: StepData) {
  const { state, color, time, chainColor } = d;
  const chain = time.onChain && state !== 'done';
  const border =
    state === 'blocked' ? '#fb3b5c' : state === 'waiting' ? '#fb3b5c' : state === 'active' ? color : chain ? chainColor : state === 'done' ? '#34d39966' : 'rgba(125,211,252,0.16)';
  const glow =
    state === 'active' ? `0 0 26px -4px ${color}, inset 0 0 18px ${color}22` : state === 'waiting' || state === 'blocked' ? '0 0 26px -4px #fb3b5c' : chain ? `0 0 18px -6px ${chainColor}` : 'none';
  return { border, glow, dim: state === 'pending' || state === 'skipped' };
}

export const StepCard = memo(function StepCard({ data: d }: NodeProps<StepNode>) {
  const Icon = LANE_ICON[d.step.lane] ?? Flag;
  const { border, glow, dim } = stateStyle(d);
  const { step, time, state } = d;

  if (step.kind === 'start') {
    return (
      <div
        className={cn('relative flex items-center gap-2 rounded-full border-2 bg-[#04101c]/95 px-3', dim && 'opacity-60')}
        style={{ width: d.w, height: d.h, borderColor: state === 'done' ? '#34d399' : d.color, boxShadow: `0 0 22px -6px ${d.color}` }}
      >
        <Flag size={15} className="shrink-0" style={{ color: d.color }} />
        <div className="min-w-0 leading-tight">
          <div className="line-clamp-2 font-display text-[10.5px] font-bold uppercase leading-[1.15] tracking-[0.06em] text-white">{step.label}</div>
          <div className="font-mono text-[10px] text-sky-200/70">{d.span}</div>
        </div>
        <Handles />
      </div>
    );
  }

  if (step.kind === 'decision') {
    const c = d.outcome === 'no' ? '#fb3b5c' : d.outcome === 'yes' ? '#34d399' : time.onChain ? d.chainColor : '#fbbf24';
    return (
      <div className={cn('relative', dim && 'opacity-60')} style={{ width: d.w, height: d.h }}>
        <div
          className="absolute inset-0"
          style={{ background: c, clipPath: 'polygon(12% 0, 88% 0, 100% 50%, 88% 100%, 12% 100%, 0 50%)', boxShadow: `0 0 20px ${c}` }}
        />
        <div
          className="absolute inset-[2px] flex flex-col items-center justify-center bg-[#06111d] px-6 text-center"
          style={{ clipPath: 'polygon(12% 0, 88% 0, 100% 50%, 88% 100%, 12% 100%, 0 50%)', backgroundImage: `linear-gradient(135deg, ${c}22, transparent)` }}
        >
          <div className="flex items-center gap-1">
            <Split size={12} style={{ color: c }} />
            <span className="font-display text-[11.5px] font-bold leading-tight text-white">{step.label}</span>
          </div>
          {step.note && <div className="mt-0.5 font-mono text-[8.5px] leading-tight text-amber-100/60">{step.note}</div>}
          <div className="mt-0.5 font-mono text-[9.5px]" style={{ color: c }}>
            {d.outcome ? (d.outcome === 'yes' ? `YES · ${d.span}` : 'NO') : d.span}
          </div>
        </div>
        <Handles />
      </div>
    );
  }

  if (step.kind === 'branch') {
    const live = state === 'active';
    return (
      <div
        className={cn('relative flex items-center gap-2 rounded-[4px] border border-dashed px-2.5', state === 'skipped' ? 'opacity-35' : live ? '' : 'opacity-60')}
        style={{ width: d.w, height: d.h, borderColor: live ? '#fb3b5c' : 'rgba(251,191,36,0.4)', background: live ? 'rgba(251,59,92,0.12)' : 'rgba(4,16,28,0.9)' }}
      >
        <UserCog size={14} className={live ? 'text-crit' : 'text-unc/70'} />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[11.5px] font-semibold text-sky-50">{step.label}</div>
          <div className="font-mono text-[9px] text-mute">{state === 'skipped' ? 'not required · evidence complete' : 'if required evidence is missing'}</div>
        </div>
        <Handles />
      </div>
    );
  }

  if (step.kind === 'end' && d.cap) {
    const sc = STATUS_COLOR[d.cap.status];
    const reached = state === 'done';
    return (
      <div
        className="relative overflow-hidden rounded-[5px] border-2 bg-[#06111d]/95"
        style={{ width: d.w, height: d.h, borderColor: sc, boxShadow: `0 0 34px -6px ${sc}, inset 0 0 26px ${sc}1c` }}
      >
        <div className="absolute inset-y-0 left-0 w-1" style={{ background: sc }} />
        <div className="flex h-full flex-col justify-center gap-0.5 py-1.5 pl-3 pr-2">
          <div className="flex items-center gap-1.5">
            <Gavel size={13} style={{ color: sc }} />
            <span className="truncate font-display text-[11.5px] font-bold uppercase tracking-[0.08em] text-white">{step.label}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-[22px] font-bold leading-none tabular" style={{ color: sc }}>
              {d.cap.margin}
            </span>
            <span className="font-display text-[10px] font-bold tracking-[0.14em]" style={{ color: sc }}>
              {STATUS_WORD[d.cap.status]}
            </span>
          </div>
          <div className="font-mono text-[9.5px] text-sky-200/70">
            due {d.cap.due} · ETA {d.cap.eta}
          </div>
          <div className={cn('font-display text-[9px] font-bold tracking-[0.16em]', reached ? 'animate-pulse text-unc' : 'text-mute')}>
            {reached ? 'AWAITING AUTHORIZED DECISION' : 'NAVIFI PRESENTS · COMMANDER DECIDES'}
          </div>
        </div>
        <Handles />
      </div>
    );
  }

  const progress = state === 'active' && time.end > time.start ? Math.min(1, Math.max(0, (d.tau - time.start) / (time.end - time.start))) : state === 'done' ? 1 : 0;
  const waiting = state === 'waiting' || state === 'blocked';
  return (
    <div className={cn('relative transition-opacity', dim && 'opacity-[0.62]')} style={{ width: d.w, height: d.h }}>
      <div
        className={cn('relative h-full overflow-hidden rounded-[5px] border bg-[#06111d]/95', waiting && 'animate-crit')}
        style={{ borderColor: border, boxShadow: glow, borderWidth: state === 'active' || waiting ? 2 : 1 }}
      >
        <div className="absolute inset-y-0 left-0 w-1" style={{ background: d.color, opacity: state === 'pending' ? 0.45 : 1 }} />
        {state === 'active' && <div className="shimmer pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: `linear-gradient(90deg, transparent, ${d.color}33, transparent)` }} />}
        <div className="relative flex h-full flex-col justify-center py-1.5 pl-3 pr-2">
          <div className="flex items-center gap-1.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px]" style={{ background: `${d.color}22`, color: d.color }}>
              {state === 'done' ? <Check size={12} /> : <Icon size={12} />}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold leading-tight text-sky-50" title={step.label}>
              {step.label}
            </span>
            {time.onChain && state !== 'done' && (
              <span className="shrink-0 rounded-[2px] px-1 font-display text-[8px] font-bold tracking-[0.14em]" style={{ color: d.chainColor, border: `1px solid ${d.chainColor}66` }}>
                CRIT
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px]">
            <span className="text-sky-200/80 tabular">{d.span}</span>
            <span className="text-mute">{d.dur}</span>
            {d.delta && <span className="rounded-[2px] bg-unc/15 px-1 text-[9px] font-semibold text-unc">{d.delta}</span>}
          </div>
          {d.resources.length ? <Chips resources={d.resources} /> : step.note && <div className="mt-1 truncate font-mono text-[9px] text-mute">{step.note}</div>}
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/5">
          <div className="h-full" style={{ width: `${progress * 100}%`, background: state === 'done' ? '#34d39988' : d.color, boxShadow: state === 'active' ? `0 0 8px ${d.color}` : undefined }} />
        </div>
      </div>
      {(state === 'active' || waiting) && d.time.actor && <Token label={d.time.actor} color={d.color} waiting={waiting} />}
      {d.waitText && state !== 'done' && (
        <div
          className={cn('absolute left-0 right-0 top-full z-10 mt-1 truncate rounded-[2px] px-1.5 py-px font-mono text-[9px] font-semibold', waiting ? 'bg-crit text-white' : 'bg-crit/15 text-rose-200')}
          title={d.waitText}
        >
          {d.waitText}
        </div>
      )}
      <Handles />
    </div>
  );
});

export const LaneBand = memo(function LaneBand({ data: d }: NodeProps<LaneNode>) {
  const Icon = LANE_ICON[d.laneId] ?? Flag;
  return (
    <div className="pointer-events-none relative" style={{ width: d.w, height: d.h, background: `linear-gradient(90deg, ${d.color}14, ${d.color}05 30%, transparent)` }}>
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: `${d.color}30` }} />
      <div className="absolute inset-y-0 left-0 flex w-[152px] items-center gap-2 border-r pl-2.5" style={{ borderColor: `${d.color}30` }}>
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px]" style={{ background: `${d.color}18`, color: d.color, border: `1px solid ${d.color}55` }}>
          <Icon size={16} />
          {d.active > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full" style={{ background: d.color, boxShadow: `0 0 8px ${d.color}` }} />}
        </span>
        <div className="min-w-0 leading-tight">
          <div className="font-display text-[11.5px] font-bold uppercase tracking-[0.1em]" style={{ color: d.color }}>
            {d.label}
          </div>
          {d.sub && <div className="mt-0.5 font-mono text-[9px] leading-tight text-mute">{d.sub}</div>}
        </div>
      </div>
    </div>
  );
});

const MAX_PACKETS = 3;

export const LinkPath = memo(function LinkPath(p: EdgeProps<LinkEdge>) {
  const d = p.data!;
  const [path, lx, ly] = getSmoothStepPath({
    sourceX: p.sourceX,
    sourceY: p.sourceY,
    sourcePosition: p.sourcePosition,
    targetX: p.targetX,
    targetY: p.targetY,
    targetPosition: p.targetPosition,
    borderRadius: 14,
    offset: 18,
  });
  const packets = usePackets((s) => s.packets);
  const mine = packets.filter((x) => x.link === p.id).slice(-MAX_PACKETS);
  const now = performance.now();
  const lit = d.state !== 'idle';
  const color = d.branch === 'no' ? '#fbbf24' : d.color;
  return (
    <>
      {d.chain && <path d={path} fill="none" stroke={d.chainColor} strokeOpacity={0.22} strokeWidth={10} style={{ filter: 'blur(4px)' }} />}
      <BaseEdge
        id={p.id}
        path={path}
        style={{
          stroke: d.chain ? d.chainColor : color,
          strokeOpacity: lit ? 0.95 : d.chain ? 0.7 : 0.32,
          strokeWidth: d.chain ? 2.4 : lit ? 2 : 1.3,
          strokeDasharray: d.branch === 'no' ? '5 5' : undefined,
        }}
      />
      {d.state === 'carrying' && (
        <>
          <path d={path} fill="none" stroke="#fff" strokeOpacity={0.55} strokeWidth={1.2} className="flow-edge" />
          {[0, 1, 2].map((i) => (
            <circle key={i} r={2.6} fill="#f8fafc" style={{ filter: `drop-shadow(0 0 4px ${color}) drop-shadow(0 0 8px ${color})` }}>
              <animateMotion dur="1.8s" repeatCount="indefinite" path={path} begin={`${-(i * 1.8) / 3}s`} />
            </circle>
          ))}
        </>
      )}
      <EdgeLabelRenderer>
        {mine.map((pk) => (
          <div
            key={pk.id}
            className="thread-packet pointer-events-none absolute left-0 top-0 z-30 whitespace-nowrap rounded-full border px-1.5 py-px font-display text-[9px] font-bold tracking-[0.12em] text-[#02060c]"
            style={{
              offsetPath: `path('${path}')`,
              background: pk.color,
              borderColor: '#f8fafc',
              boxShadow: `0 0 16px 2px ${pk.color}`,
              animationDuration: `${PACKET_MS}ms`,
              animationDelay: `${Math.round(pk.t0 - now)}ms`,
            }}
          >
            {pk.cargo}
          </div>
        ))}
        {(d.float || d.branch) && (
          <div
            className="pointer-events-none absolute rounded-[2px] border px-1 font-mono text-[9px] font-semibold"
            style={{
              transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`,
              color: d.branch === 'no' ? '#fbbf24' : d.branch === 'yes' ? '#34d399' : '#67e8f9',
              borderColor: d.branch === 'no' ? '#fbbf2455' : d.branch === 'yes' ? '#34d39955' : '#22d3ee44',
              background: '#04101cee',
            }}
          >
            {d.branch ? d.branch.toUpperCase() : d.float}
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
});

export const nodeTypes = { step: StepCard, lane: LaneBand };
export const edgeTypes = { link: LinkPath };
