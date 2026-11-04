import { BaseEdge, getBezierPath, Handle, Position, type Edge, type EdgeProps, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { CalendarClock, Crosshair, Database, GitMerge, Layers, User, Wrench, type LucideIcon } from 'lucide-react';
import type { NodeKind } from '@/engine/types';
import { fmtDur, fmtT } from '@/engine/time';
import { useEngine } from '@/state/engine';
import { cn, DOMAIN_COLOR, FLAG_META, STATUS_COLOR } from '@/lib/util';
import type { GEdgeData, GNodeData } from './layout';

const ICON: Record<NodeKind, LucideIcon> = {
  input: Database,
  person: User,
  task: Wrench,
  gate: CalendarClock,
  all: GitMerge,
  any: GitMerge,
  kofn: Layers,
  capability: Crosshair,
};

const KIND_LABEL: Record<NodeKind, string> = {
  input: 'INPUT',
  person: 'PERSON',
  task: 'TASK',
  gate: 'WINDOW GATE',
  all: 'ALL OF',
  any: 'ANY OF',
  kofn: 'K OF N',
  capability: 'CAPABILITY',
};

const hidden = '!h-1 !w-1 !min-w-0 !border-0 !bg-transparent';

function SlackChip({ d, chainColor }: { d: GNodeData; chainColor: string }) {
  const s = d.slack;
  if (!s) return null;
  if (d.role === 'chain' && s.noImpact < 1 / 60)
    return (
      <span className="rounded-[2px] px-1 font-mono text-[9px] font-bold" style={{ color: chainColor, background: `${chainColor}22`, border: `1px solid ${chainColor}66` }}>
        0 SLACK
      </span>
    );
  return (
    <span className="rounded-[2px] border border-calc/30 bg-calc/10 px-1 font-mono text-[9px] text-calc" title="Upstream slack: slip absorbed with zero effect on the capability">
      {s.unbounded ? '∞' : `+${fmtDur(s.noImpact)}`} slack
    </span>
  );
}

function NavNodeImpl({ data: d }: NodeProps<Node<GNodeData>>) {
  const { nodes, result, scenario, at, cap } = useEngine();
  const n = nodes[d.id];
  const r = result.nodes[d.id];
  if (!n || !r) return null;
  const Icon = ICON[n.kind];
  const chainColor = cap ? STATUS_COLOR[cap.status] : '#22d3ee';
  const accent = d.role === 'chain' ? chainColor : d.role === 'cocrit' ? '#fbbf24' : DOMAIN_COLOR[n.domain] ?? '#38bdf8';
  const away = n.kind === 'person' ? (n.unavailable ?? []).find((iv) => at >= iv.start && at < iv.end) : undefined;
  const ready = away ? `AWAY → ${fmtT(scenario, away.end)}` : r.ready <= at + 1e-6 ? 'READY' : fmtT(scenario, r.ready);
  const flags = r.flags.filter((f) => f !== 'no-redundancy' || n.kind === 'kofn');
  const dim = d.role === 'off';

  const shell = cn(
    'relative h-full w-full overflow-hidden rounded-[4px] border bg-[#06121f]/95 transition-all duration-300',
    dim && 'opacity-30',
    d.selected && 'ring-2 ring-calc ring-offset-2 ring-offset-[#02060c]',
  );
  const glow = d.role === 'chain' ? `0 0 22px -4px ${chainColor}, inset 0 0 18px -8px ${chainColor}` : d.role === 'cocrit' ? '0 0 16px -6px #fbbf24' : 'none';
  const borderColor = d.role === 'chain' ? `${chainColor}cc` : d.role === 'cocrit' ? '#fbbf24aa' : 'rgba(56,189,248,0.22)';

  if (n.kind === 'capability') {
    const c = result.capabilities.find((x) => x.id === n.id);
    const sc = c ? STATUS_COLOR[c.status] : '#22d3ee';
    return (
      <div className={shell} style={{ borderColor: `${sc}cc`, boxShadow: `0 0 34px -6px ${sc}, inset 0 0 30px -12px ${sc}` }}>
        <Handle type="target" position={Position.Left} className={hidden} />
        <div className="absolute inset-y-0 left-0 w-1" style={{ background: sc, boxShadow: `0 0 14px ${sc}` }} />
        <div className="flex h-full items-center gap-3 px-4">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[3px] font-display text-3xl font-bold"
            style={{ color: sc, border: `1px solid ${sc}`, background: `${sc}1a`, textShadow: `0 0 18px ${sc}` }}
          >
            {c?.status}
          </div>
          <div className="min-w-0">
            <div className="label !text-[8.5px]" style={{ color: `${sc}cc` }}>
              Capability
            </div>
            <div className="font-display text-[20px] font-bold leading-tight tracking-[0.14em] text-white">{c?.code}</div>
            <div className="truncate text-[10.5px] text-sky-200/60">{n.label}</div>
            {c && (
              <div className="mt-0.5 font-mono text-[10px]" style={{ color: sc }}>
                margin {c.margin >= 0 ? fmtDur(c.margin) : `−${fmtDur(-c.margin)}`}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (n.kind === 'all' || n.kind === 'any' || n.kind === 'kofn') {
    const label = n.kind === 'kofn' ? `${n.k} OF ${n.deps?.length ?? 0}` : n.kind === 'all' ? 'ALL' : 'ANY';
    return (
      <div className={cn(shell, 'flex items-center gap-2 px-2.5')} style={{ borderColor, boxShadow: glow }}>
        <Handle type="target" position={Position.Left} className={hidden} />
        <Icon size={14} style={{ color: accent }} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[11px] font-bold tracking-[0.16em]" style={{ color: accent }}>
            {label}
          </div>
          <div className="truncate font-mono text-[9px] text-sky-200/55" title={n.label}>
            {n.label}
          </div>
        </div>
        {flags.includes('no-redundancy') && <span className="h-2 w-2 animate-blink rounded-full bg-unc" title="No redundancy" />}
        <Handle type="source" position={Position.Right} className={hidden} />
      </div>
    );
  }

  const src = n.sources?.[0];
  const sub =
    n.kind === 'task'
      ? `${fmtDur(r.effective ?? n.duration ?? n.assumedDuration ?? 0)}${n.crew ? ` · ${n.crew.label} ${r.crew?.assigned.length ?? 0}/${n.crew.k}` : ''}`
      : n.kind === 'gate'
        ? (n.windows?.find((w) => w.id === r.usedWindow)?.label ?? 'no window reachable')
        : n.kind === 'person'
          ? `${n.rate ?? ''} · ${n.qual ?? ''}`
          : src
            ? `${src.system} · ${src.recordId}`
            : n.domain;

  return (
    <div className={shell} style={{ borderColor, boxShadow: glow }}>
      <Handle type="target" position={Position.Left} className={hidden} />
      <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: accent, boxShadow: d.role === 'chain' ? `0 0 10px ${accent}` : undefined }} />
      <div className="flex h-full flex-col justify-between py-1.5 pl-3 pr-2">
        <div className="flex items-center gap-1.5">
          <Icon size={12} className="shrink-0" style={{ color: accent }} />
          <span className="font-mono text-[8.5px] tracking-wider text-mute">{KIND_LABEL[n.kind]}</span>
          <span className="ml-auto flex gap-1">
            {flags.slice(0, 2).map((f) => (
              <span key={f} className="rounded-[2px] px-0.5 font-mono text-[8px] font-bold" style={{ color: FLAG_META[f].color, border: `1px solid ${FLAG_META[f].color}66` }}>
                {FLAG_META[f].label}
              </span>
            ))}
          </span>
        </div>
        <div className="truncate text-[11.5px] font-medium leading-tight text-sky-50" title={n.label}>
          {n.label}
        </div>
        <div className="truncate font-mono text-[9px] text-sky-200/45">{sub}</div>
        <div className="flex items-center justify-between gap-1">
          <span className={cn('truncate font-mono text-[10px]', away ? 'text-unc' : r.ready <= at + 1e-6 ? 'text-ok/80' : 'text-sky-100')} title={away?.reason}>
            {ready}
          </span>
          <SlackChip d={d} chainColor={chainColor} />
        </div>
      </div>
      <Handle type="source" position={Position.Right} className={hidden} />
    </div>
  );
}

export const NavNode = memo(NavNodeImpl);

export function FlowEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<GEdgeData>>) {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 });
  const role = data?.role ?? 'cone';
  const color = data?.color ?? '#38bdf8';
  if (role === 'chain') {
    return (
      <>
        <path d={path} fill="none" stroke={color} strokeOpacity={0.22} strokeWidth={9} style={{ filter: `blur(4px)` }} />
        <BaseEdge id={id} path={path} style={{ stroke: color, strokeWidth: 2.2 }} />
        <path d={path} fill="none" stroke="#fff" strokeOpacity={0.7} strokeWidth={1.2} className="flow-edge" />
        {[0, 0.5].map((b) => (
          <circle key={b} r={3.2} fill="#fff" style={{ filter: `drop-shadow(0 0 4px ${color}) drop-shadow(0 0 8px ${color})` }}>
            <animateMotion dur="1.6s" begin={`${b * 1.6}s`} repeatCount="indefinite" path={path} />
          </circle>
        ))}
      </>
    );
  }
  return (
    <BaseEdge
      id={id}
      path={path}
      style={{
        stroke: color,
        strokeOpacity: role === 'off' ? 0.08 : role === 'cocrit' ? 0.8 : data?.crew ? 0.45 : 0.28,
        strokeWidth: role === 'cocrit' ? 1.8 : 1.2,
        strokeDasharray: data?.crew || role === 'cocrit' ? '5 5' : undefined,
      }}
    />
  );
}
