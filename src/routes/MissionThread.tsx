import '@xyflow/react/dist/style.css';
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { Pause, Play, Radio, Workflow } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMissions } from '@/api/hooks';
import type { CapabilityResult, ChangeEvent, Scenario } from '@/api/types';
import { BRAND } from '@/brand';
import { fmtDay, fmtDur, fmtMargin, fmtT, hhmm } from '@/lib/time';
import { toMap } from '@/lib/graph';
import { useAnalysisKey, useCapAnalysis } from '@/state/analysis';
import { useEngine, useSnapshotAt } from '@/state/engine';
import { useStore } from '@/state/store';
import { MarginValue, Panel, Pill, StatusBadge } from '@/components/ui';
import { OptionCard } from '@/features/watch/OptionCard';
import { autoThread } from '@/features/thread/auto';
import type { ThreadSpec } from '@/features/thread/types';
import { layoutThread } from '@/features/thread/layout';
import { decisionYes, linkFloat, linkId, linkState, stepState, threadEnd, threadTimes, type StepTime } from '@/features/thread/model';
import { StatusBoard, ThreadTimeline, verdictFor, type Verdict } from '@/features/thread/Panels';
import { clearPackets, spawnPackets, useProjection } from '@/features/thread/store';
import { edgeTypes, nodeTypes, type LaneNode, type LinkEdge, type Resource, type StepNode } from '@/features/thread/ThreadNodes';
import { cn, STATUS_COLOR } from '@/lib/util';

const EPS = 1e-6;

const chip = (label: string) => {
  const a = label.split(/[:(]/)[0].trim();
  return a.length <= 16 ? a : a.split(' ').slice(0, 2).join(' ');
};

function fmtSpan(s: Scenario, a: number, b: number) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'NEVER';
  if (s.timeScale === 'hours') return b - a < EPS ? hhmm(a) : `${hhmm(a)}–${hhmm(b)}`;
  if (b - a < EPS) return fmtT(s, a);
  return fmtDay(s, a) === fmtDay(s, b) ? `${fmtT(s, a)}–${hhmm(b)}` : `${fmtT(s, a)} → ${fmtT(s, b)}`;
}

const signed = (c: Pick<CapabilityResult, 'margin' | 'marginKind'>) => (c.marginKind !== 'exact' ? fmtMargin(c.margin, c.marginKind) : c.margin >= 0 ? `+${fmtDur(c.margin)}` : `−${fmtDur(-c.margin)}`);

interface ThreadModel {
  spec: ThreadSpec;
  cap: CapabilityResult;
  times: Record<string, StepTime>;
  base: Record<string, StepTime>;
  end: number;
}

/** The thread for the selected capability, timed now and as planned at watch start (the plan of record). */
function useThread(): ThreadModel | undefined {
  const { scenario, nodes, result, cap: selected } = useEngine();
  const capId = selected?.id;
  const spec = useMemo(() => (capId ? autoThread(nodes, capId) : undefined), [nodes, capId]);
  const plan = useSnapshotAt(scenario.id, scenario.watchStart).data;
  const baseRes = useMemo(() => (plan ? { nodes: toMap(plan.nodes), res: plan.result } : undefined), [plan]);
  const cap = result.capabilities.find((c) => c.id === capId);
  return useMemo(() => {
    if (!spec || !cap) return undefined;
    const times = threadTimes(spec, scenario, nodes, result, cap, baseRes?.res);
    const base = baseRes ? threadTimes(spec, scenario, baseRes.nodes, baseRes.res, baseRes.res.capabilities.find((c) => c.id === cap.id)) : times;
    return { spec, cap, times, base, end: threadEnd(spec, times) };
  }, [spec, cap, scenario, nodes, result, baseRes]);
}

function useProjectionRun(end: number, unit: number) {
  const [run, setRun] = useState(false);
  const setTau = useProjection((s) => s.setTau);
  const playing = useStore((s) => s.playing);
  const endRef = useRef({ end, unit });
  endRef.current = { end, unit };
  useEffect(() => {
    if (playing) setRun(false);
  }, [playing]);
  useEffect(() => {
    if (!run) return;
    const { end, unit } = endRef.current;
    const from = useStore.getState().watchTime;
    const to = Math.max(from + unit, end + 0.5 * unit);
    const dur = 11_000;
    const t0 = performance.now();
    let raf = 0;
    let hold: ReturnType<typeof setTimeout> | undefined;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      setTau(from + (to - from) * k);
      if (k < 1) raf = requestAnimationFrame(tick);
      else hold = setTimeout(() => setRun(false), 2400);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(hold);
      setTau(null);
    };
  }, [run, setTau]);
  return { run, toggle: () => setRun((r) => !r) };
}

function usePacketSpawner(m: ThreadModel | undefined, tau: number, laneColor: Record<string, string>) {
  const prev = useRef(tau);
  useEffect(() => {
    const p = prev.current;
    prev.current = tau;
    if (!m) return;
    if (tau < p - EPS) {
      clearPackets();
      return;
    }
    const yes = decisionYes(m.spec, m.times, tau);
    const list = m.spec.links
      .filter((l) => {
        const a = m.times[l.from];
        if (!a || !Number.isFinite(a.end) || a.end <= p + EPS || a.end > tau + EPS) return false;
        return l.branch !== 'no' || !yes.has(l.to);
      })
      .map((l) => {
        const from = m.spec.steps.find((s) => s.id === l.from);
        return { link: linkId(l), cargo: l.cargo ?? 'HANDOFF', color: laneColor[from?.lane ?? ''] ?? '#22d3ee' };
      });
    if (list.length) spawnPackets(list);
  }, [m, tau, laneColor]);
}

function Canvas({ m, tau }: { m: ThreadModel; tau: number }) {
  const { scenario, nodes, result, plannedActive } = useEngine();
  const rf = useReactFlow();
  const layout = useMemo(() => layoutThread(m.spec), [m.spec]);
  const laneColor = useMemo(() => Object.fromEntries(m.spec.lanes.map((l) => [l.id, l.color])), [m.spec]);
  const chainColor = STATUS_COLOR[m.cap.status];
  usePacketSpawner(m, tau, laneColor);

  const yes = decisionYes(m.spec, m.times, tau);
  const states = Object.fromEntries(m.spec.steps.map((s) => [s.id, stepState(m.times[s.id], tau, s.kind, yes.has(s.id))]));

  const rfNodes: (StepNode | LaneNode)[] = [
    ...layout.lanes.map<LaneNode>((l) => ({
      id: `lane:${l.id}`,
      type: 'lane',
      position: { x: 0, y: l.y },
      data: { label: l.label, sub: l.sub, color: l.color, laneId: l.id, w: layout.width, h: l.h, active: m.spec.steps.filter((s) => s.lane === l.id && (states[s.id] === 'active' || states[s.id] === 'waiting')).length },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: 0,
    })),
    ...m.spec.steps.map<StepNode>((step) => {
      const t = m.times[step.id];
      const p = layout.pos[step.id];
      const r = step.node ? result.nodes[step.node] : undefined;
      const binding = new Set(r?.control.type === 'crew' ? r.binding : []);
      const resources: Resource[] = (step.needs ?? [])
        .filter((id) => nodes[id])
        .map((id) => {
          const n = nodes[id];
          const rr = result.nodes[id];
          const blocked = binding.has(id) || (n.kind === 'person' && (n.unavailable ?? []).some((iv) => iv.start < t.end - EPS && iv.end > t.arrive + EPS));
          return { id, label: chip(n.label), ok: !!rr && Number.isFinite(rr.ready) && rr.ready <= t.start + EPS && !blocked, flags: rr?.flags ?? [] };
        });
      const state = states[step.id];
      return {
        id: step.id,
        type: 'step',
        position: { x: p.x, y: p.y },
        draggable: false,
        zIndex: 10,
        data: {
          step,
          time: t,
          state,
          color: laneColor[step.lane] ?? '#22d3ee',
          chainColor,
          tau,
          span: step.kind === 'task' ? fmtSpan(scenario, t.start, t.end) : Number.isFinite(t.end) ? fmtT(scenario, t.end) : 'NEVER',
          dur: step.kind === 'task' && Number.isFinite(t.end) ? fmtDur(t.end - t.start) : '',
          delta: Math.abs(t.delta) > 1 / 60 ? fmtDur(t.delta, { signed: true }) : '',
          waitText: t.wait && t.start - t.arrive > 1 / 60 ? `WAITS ${fmtSpan(scenario, t.arrive, t.start)} · ${t.wait.label}` : undefined,
          resources,
          outcome: step.kind === 'decision' && state === 'done' ? 'yes' : step.kind === 'decision' && state === 'blocked' ? 'no' : undefined,
          cap: step.kind === 'end' ? { status: m.cap.status, margin: signed(m.cap), due: fmtT(scenario, m.cap.requiredBy), eta: fmtT(scenario, m.cap.ready) } : undefined,
          w: p.w,
          h: p.h,
        },
      };
    }),
  ];

  const rfEdges: LinkEdge[] = m.spec.links
    .filter((l) => layout.pos[l.from] && layout.pos[l.to])
    .map((l) => {
      const a = layout.pos[l.from];
      const b = layout.pos[l.to];
      let sourceHandle = 'r';
      let targetHandle = 'l';
      if (b.x < a.x + a.w - 4) [sourceHandle, targetHandle] = b.y < a.y ? ['ts', 'bt'] : ['bs', 'tt'];
      const ta = m.times[l.from];
      const tb = m.times[l.to];
      const from = m.spec.steps.find((s) => s.id === l.from)!;
      const chain = ta.onChain && tb.onChain;
      const float = linkFloat(ta, tb);
      return {
        id: linkId(l),
        source: l.from,
        target: l.to,
        sourceHandle,
        targetHandle,
        type: 'link',
        zIndex: 5,
        data: {
          state: l.branch === 'no' && yes.has(l.to) ? 'idle' : linkState(ta, tb, tau),
          color: laneColor[from.lane] ?? '#22d3ee',
          chain,
          chainColor,
          float: !l.branch && !chain && float > 5 / 60 && Number.isFinite(tb.start) ? `waits ${fmtDur(float)}` : undefined,
          branch: l.branch,
        },
      };
    });

  const stage = useRef<HTMLElement>(null);
  const fitKey = `${scenario.id}|${m.cap.id}|${m.spec.steps.length}`;
  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ padding: 0.04, duration: 600 }), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  useEffect(() => {
    if (!stage.current) return;
    let t: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => rf.fitView({ padding: 0.04, duration: 250 }), 120);
    });
    ro.observe(stage.current);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [rf]);

  return (
    <section ref={stage} className="hud relative min-h-0 min-w-0 overflow-hidden">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesConnectable={false}
        nodesDraggable={false}
        elementsSelectable={false}
        minZoom={0.2}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ padding: 0.04 }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(56,189,248,0.12)" />
      </ReactFlow>
      <div className="absolute left-3 top-2 flex items-center gap-2">
        <span className="label !text-[9px]">Thread for</span>
        <CapChips capId={m.cap.id} />
      </div>
      {plannedActive && (
        <div className="pointer-events-none absolute right-3 top-2">
          <Pill color="#a78bfa">Planning assumptions applied · source records unchanged</Pill>
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 right-3 flex items-center gap-3 font-mono text-[9px] uppercase tracking-wider text-mute">
        <span className="flex items-center gap-1.5">
          <i className="h-[3px] w-6 rounded" style={{ background: chainColor, boxShadow: `0 0 8px ${chainColor}` }} /> critical chain
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full bg-white shadow-[0_0_6px_#fff]" /> handoff in flight
        </span>
        <span className="flex items-center gap-1.5">
          <i className="rounded-[2px] border border-calc/40 px-1 normal-case text-[#67e8f9]">waits 2h</i> idle at the join
        </span>
        <span className="flex items-center gap-1.5">
          <i className="rounded-[2px] bg-crit px-1 normal-case text-white">WAITS</i> held for crew / window
        </span>
      </div>
    </section>
  );
}

function ThreadPicker() {
  const scenarioId = useStore((s) => s.scenarioId);
  const setScenario = useStore((s) => s.setScenario);
  const missions = useMissions();
  return (
    <div className="flex overflow-hidden rounded-[3px] border border-sky-300/20">
      {missions.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => s.id !== scenarioId && setScenario(s.id)}
          title={s.name}
          className={cn('px-2.5 py-1.5 font-display text-[10px] font-semibold uppercase tracking-[0.12em] transition', s.id === scenarioId ? 'bg-calc/15 text-calc' : 'text-mute hover:text-sky-100')}
        >
          {s.short}
        </button>
      ))}
    </div>
  );
}

function CapChips({ capId }: { capId: string }) {
  const { result } = useEngine();
  const select = useStore((s) => s.selectCap);
  return (
    <div className="flex flex-wrap gap-1">
      {result.capabilities.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => select(c.id)}
          className={cn('flex items-center gap-1 rounded-[3px] border px-1.5 py-0.5 font-display text-[10px] font-bold tracking-[0.12em]', c.id === capId ? 'border-calc/60 bg-calc/10 text-white' : 'border-sky-300/10 text-mute hover:text-sky-100')}
        >
          <i className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[c.status] }} />
          {c.code}
        </button>
      ))}
    </div>
  );
}

function Header({ m, tau, projecting, onRun }: { m: ThreadModel; tau: number; projecting: boolean; onRun: () => void }) {
  const { scenario, at } = useEngine();
  const c = m.cap;
  const col = STATUS_COLOR[c.status];
  return (
    <div className="hud flex shrink-0 items-center gap-4 px-3 py-2">
      <div className="flex min-w-[260px] flex-1 items-center gap-2.5">
        <Workflow size={20} className="shrink-0 text-calc drop-shadow-[0_0_8px_#22d3ee]" />
        <div className="min-w-0">
          <div className="label !text-[9px] !text-calc/80">Executable mission thread · auto-laid from the engine graph</div>
          <div className="truncate font-display text-[15px] font-bold tracking-[0.16em] text-white">{`${scenario.mission.name} · ${c.code}`}</div>
          <div className="truncate text-[11px] text-sky-200/60">{m.spec.thesis}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 border-l border-sky-300/10 pl-4">
        <StatusBadge status={c.status} size="lg" pulse />
        <div className="leading-none">
          <div className="label !text-[9px]">Mission margin</div>
          <MarginValue margin={c.margin} kind={c.marginKind} className="font-display text-[26px] font-bold" />
        </div>
        <div className="font-mono text-[10.5px] leading-snug text-sky-200/70">
          <div>due {fmtT(scenario, c.requiredBy)}</div>
          <div>ETA {fmtT(scenario, c.ready)}</div>
        </div>
      </div>
      <motion.div key={c.controlling.nodeId} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="min-w-0 max-w-[340px] rounded-[3px] border bg-black/40 px-2.5 py-1" style={{ borderColor: `${col}66`, boxShadow: `0 0 20px -8px ${col}` }}>
        <div className="label !text-[8.5px]" style={{ color: col }}>
          Controlling constraint · {c.controlling.kind}
        </div>
        <div className="truncate font-mono text-[12px] font-semibold text-white">{c.controlling.label}</div>
        {c.reasons[0] && <div className="truncate font-mono text-[9.5px] text-sky-200/60">{c.reasons.join(' · ')}</div>}
      </motion.div>
      <div className="flex shrink-0 items-center gap-3">
        <ThreadPicker />
        <div className="leading-none">
          <div className="label !text-[8.5px]">{projecting ? 'Projected execution' : 'Mission clock · live'}</div>
          <div className={cn('mt-0.5 font-mono text-[20px] font-semibold tabular', projecting ? 'text-white glow-calc' : 'text-sky-100')}>{fmtT(scenario, tau)}</div>
        </div>
        <button
          type="button"
          onClick={onRun}
          title="Run the current plan forward without moving watch time"
          className={cn(
            'flex items-center gap-1.5 rounded-[3px] border px-3 py-1.5 font-display text-[11px] font-bold tracking-[0.18em] transition',
            projecting ? 'border-white bg-white/15 text-white shadow-[0_0_18px_#fff]' : 'border-calc bg-calc/10 text-calc hover:bg-calc/25',
          )}
        >
          {projecting ? <Pause size={13} /> : <Play size={13} />}
          {projecting ? 'STOP RUN' : 'RUN THREAD'}
        </button>
        {at < tau - EPS && (
          <span className="flex items-center gap-1 font-mono text-[9.5px] text-mute">
            <Radio size={11} className="text-calc" /> watch {fmtT(scenario, at)}
          </span>
        )}
      </div>
    </div>
  );
}

function useVerdicts(capId: string): Record<string, Verdict | undefined> {
  const { scenario, impacts } = useEngine();
  const key = useAnalysisKey();
  return useMemo(() => {
    const out: Record<string, Verdict | undefined> = {};
    for (const e of scenario.events) out[e.id] = verdictFor(impacts[e.id], capId, undefined);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, capId]);
}

function Options({ capId }: { capId: string }) {
  const { scenario, cap, levers } = useEngine();
  const analysis = useCapAnalysis(capId);
  const c = useEngine().result.capabilities.find((x) => x.id === capId) ?? cap;
  if (!analysis || !c) return null;
  const all = [...analysis.options.singles, ...analysis.options.combos].filter((o) => o.available && (o.effective || o.levers.some((l) => l.category === 'accept')));
  const accept = (o: (typeof all)[number]) => o.levers.some((l) => l.category === 'accept');
  all.sort((a, b) => Number(accept(a)) - Number(accept(b)) || a.levers.length - b.levers.length || b.recovered - a.recovered);
  return (
    <div className="flex h-full flex-col gap-1.5 overflow-y-auto px-3 py-2">
      {c.status === 'Y' ? (
        <div className="rounded-[3px] border border-ok/25 bg-ok/[0.05] px-2.5 py-2 text-[11.5px] leading-snug text-ok/90">
          No action needed. The thread meets {fmtT(scenario, c.requiredBy)} with {fmtMargin(c.margin, c.marginKind)} margin.
          <div className="mt-1 font-mono text-[10px] text-mute">{levers.length} pre-authorized options stay in the library until a report puts the mission at risk.</div>
        </div>
      ) : (
        all.slice(0, 4).map((o, i) => <OptionCard key={o.id} o={o} rank={i + 1} compact />)
      )}
      <div className="mt-auto rounded-[3px] border border-sky-300/10 bg-black/30 px-2 py-1.5 font-mono text-[9.5px] leading-relaxed text-mute">
        Approving records a planning assumption on the hash chain. {BRAND.name} does not reassign people, change tasking or write to source systems.
      </div>
    </div>
  );
}

function ThreadScreen() {
  const m = useThread();
  const { scenario, at } = useEngine();
  const proj = useProjection((s) => s.tau);
  const tau = proj ?? at;
  const { run, toggle } = useProjectionRun(m?.end ?? at, scenario.timeScale === 'hours' ? 1 : 24);
  const setWatchTime = useStore((s) => s.setWatchTime);
  const focusEvent = useStore((s) => s.focusEvent);
  const verdicts = useVerdicts(m?.cap.id ?? '');
  if (!m) return <div className="flex h-full items-center justify-center font-mono text-sm text-mute">No capability to thread in this scenario.</div>;

  const fmt = (t: number) => (scenario.timeScale === 'hours' ? hhmm(t) : fmtT(scenario, t));
  const finite = Object.values(m.times).flatMap((t) => [t.arrive, t.start, t.end]).filter(Number.isFinite);
  const unit = scenario.timeScale === 'hours' ? 1 : 24;
  const t0 = Math.min(at, ...finite) - 0.25 * unit;
  const t1 = Math.max(m.end, at, ...finite) + 0.5 * unit;
  const verdictTone = (): Verdict['tone'] => (m.cap.status === 'N' ? 'crit' : m.cap.status === 'Q' ? 'warn' : 'ok');
  const jump = (e: ChangeEvent) => {
    useStore.getState().setPlaying(false);
    focusEvent(e.id);
    setWatchTime(e.t);
  };

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)_272px] gap-3 p-3">
      <Header m={m} tau={tau} projecting={run} onRun={toggle} />
      <Canvas m={m} tau={tau} />
      <div className="grid min-h-0 grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.95fr)] gap-3">
        <Panel index="THR-1" title="Mission clock · plan vs reality" bodyClass="min-h-0">
          <ThreadTimeline spec={m.spec} times={m.times} base={m.base} t0={t0} t1={t1} at={at} tau={tau} due={m.cap.requiredBy} fmt={fmt} hours={scenario.timeScale === 'hours'} />
        </Panel>
        <Panel index="THR-2" title="Reports · status board vs thread" bodyClass="min-h-0">
          <StatusBoard events={scenario.events} at={at} verdicts={verdicts} fmt={(t) => fmtT(scenario, t)} onJump={jump} controller={{ label: m.cap.controlling.label, tone: verdictTone() }} />
        </Panel>
        <Panel index="THR-3" title="Bounded options · human decides" bodyClass="min-h-0">
          <Options capId={m.cap.id} />
        </Panel>
      </div>
    </div>
  );
}

export default function MissionThread() {
  return (
    <ReactFlowProvider>
      <ThreadScreen />
    </ReactFlowProvider>
  );
}

