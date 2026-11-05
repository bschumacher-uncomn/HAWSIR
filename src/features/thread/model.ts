import type { CapabilityResult, EngineResult, NodeMap, QualityFlag, Scenario } from '@/api/types';
import type { ThreadLink, ThreadSpec, ThreadStep } from './types';

export interface StepTime {
  id: string;
  /** Every input to the step is in hand. */
  arrive: number;
  start: number;
  end: number;
  wait?: { kind: 'crew' | 'window'; label: string };
  onChain: boolean;
  flags: QualityFlag[];
  actor?: string;
  requiredBy?: number;
  /** Shift vs the plan as first ingested. */
  delta: number;
}

export type StepState = 'pending' | 'waiting' | 'active' | 'done' | 'blocked' | 'skipped';

const INF = Infinity;

function short(label: string) {
  const m = label.match(/^([A-Z0-9]{2,5}) [A-Z]\. (\S+)/);
  return m ? `${m[1]} ${m[2]}` : label.split(' (')[0];
}

function timeOf(step: ThreadStep, res: EngineResult, s: Pick<Scenario, 'watchStart'>) {
  const r = step.node ? res.nodes[step.node] : undefined;
  if (step.kind === 'start') {
    const t = r?.ready ?? s.watchStart;
    return { arrive: t, start: t, end: t };
  }
  if (!r) return { arrive: INF, start: INF, end: INF };
  if (step.kind === 'task') {
    const arrive = r.predsReady ?? r.start ?? r.ready;
    return { arrive, start: r.start ?? arrive, end: r.ready };
  }
  if (step.kind === 'gate') return { arrive: r.predsReady ?? r.ready, start: r.ready, end: r.ready };
  return { arrive: r.ready, start: r.ready, end: r.ready };
}

export function threadTimes(
  spec: ThreadSpec,
  s: Pick<Scenario, 'watchStart'>,
  nodes: NodeMap,
  res: EngineResult,
  cap: CapabilityResult | undefined,
  base?: EngineResult,
): Record<string, StepTime> {
  const chain = new Set([...(cap?.chain ?? []), ...(cap?.coCritical ?? [])]);
  const out: Record<string, StepTime> = {};
  for (const step of spec.steps) {
    const t = timeOf(step, res, s);
    const r = step.node ? res.nodes[step.node] : undefined;
    const n = step.node ? nodes[step.node] : undefined;
    let wait: StepTime['wait'];
    if (r?.control.type === 'crew') {
      const p = nodes[r.binding[0]];
      const iv = p?.unavailable?.find((x) => Math.abs(x.end - t.start) < 1e-6);
      wait = { kind: 'crew', label: `${n?.crew?.label ?? 'Qualified crew'}: ${p ? short(p.label) : 'unassigned'}${iv?.reason ? ` · ${iv.reason}` : ''}` };
    } else if (r?.control.type === 'window') {
      const w = n?.windows?.find((x) => x.id === r.usedWindow);
      wait = { kind: 'window', label: w?.label ?? 'Next window' };
    }
    const crewActor = r?.crew?.assigned.length ? r.crew.assigned.map((id) => short(nodes[id]?.label ?? id)).join(' + ') : undefined;
    const flags = [...(r?.flags ?? [])];
    for (const id of step.needs ?? []) for (const f of res.nodes[id]?.flags ?? []) if (!flags.includes(f)) flags.push(f);
    const baseT = base ? timeOf(step, base, s) : t;
    out[step.id] = {
      id: step.id,
      ...t,
      wait,
      onChain: !!step.node && chain.has(step.node),
      flags,
      actor: crewActor ?? step.actor,
      requiredBy: step.kind === 'end' ? n?.requiredBy : undefined,
      delta: Number.isFinite(t.end) && Number.isFinite(baseT.end) ? t.end - baseT.end : 0,
    };
  }
  for (const l of spec.links.filter((x) => x.branch === 'no')) {
    const d = out[l.from];
    const b = out[l.to];
    if (!d || !b) continue;
    const known = spec.links.filter((x) => x.to === l.from).map((x) => out[x.from]?.end ?? INF).filter(Number.isFinite);
    b.arrive = b.start = b.end = !Number.isFinite(d.end) && known.length ? Math.max(...known) : INF;
  }
  return out;
}

export function stepState(t: StepTime, tau: number, kind: ThreadStep['kind'], decidedYes?: boolean): StepState {
  if (kind === 'branch') return decidedYes ? 'skipped' : Number.isFinite(t.end) && tau >= t.end ? 'active' : 'pending';
  if (!Number.isFinite(t.end)) return Number.isFinite(t.arrive) && tau >= t.arrive ? 'blocked' : 'pending';
  if (tau >= t.end) return 'done';
  if (tau >= t.start) return 'active';
  if (tau >= t.arrive) return 'waiting';
  return 'pending';
}

export type LinkState = 'idle' | 'carrying' | 'done';

export function linkState(a: StepTime, b: StepTime, tau: number): LinkState {
  if (!Number.isFinite(a.end) || tau < a.end) return 'idle';
  return tau >= b.start ? 'done' : 'carrying';
}

/** Time the downstream step spends waiting on everything else after this handoff arrives. */
export function linkFloat(a: StepTime, b: StepTime) {
  if (!Number.isFinite(a.end) || !Number.isFinite(b.start)) return 0;
  return Math.max(0, b.start - a.end);
}

/** Last instant worth playing: the end step, or the deadline if that is later. */
export function threadEnd(spec: ThreadSpec, times: Record<string, StepTime>) {
  let end = -INF;
  for (const st of spec.steps) {
    const t = times[st.id];
    if (Number.isFinite(t.end)) end = Math.max(end, t.end);
    if (t.requiredBy !== undefined && Number.isFinite(t.requiredBy)) end = Math.max(end, t.requiredBy);
  }
  return end;
}

export function decisionYes(spec: ThreadSpec, times: Record<string, StepTime>, tau: number) {
  const out = new Set<string>();
  for (const l of spec.links) {
    if (l.branch !== 'no') continue;
    const d = times[l.from];
    if (d && Number.isFinite(d.end) && tau >= d.end) out.add(l.to);
  }
  return out;
}

export const linkId = (l: ThreadLink) => `${l.from}->${l.to}`;
