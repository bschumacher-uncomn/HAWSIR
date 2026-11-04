import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { scenarioById } from '@/data/scenarios';
import {
  applyPatches,
  applyShifts,
  compute,
  diffResults,
  explainEvent,
  stateAt,
  toMap,
  type CapabilityResult,
  type ChangeEvent,
  type EngineResult,
  type Line,
  type NodeMap,
  type ResultDiff,
  type Scenario,
} from '@/engine';
import { useStore } from './store';

export interface EventImpact {
  event: ChangeEvent;
  diff: ResultDiff;
  lines: Line[];
  after: EngineResult;
  before: EngineResult;
  beforeNodes: NodeMap;
  afterNodes: NodeMap;
}

interface EngineCtx {
  scenario: Scenario;
  at: number;
  authNodes: NodeMap;
  nodes: NodeMap;
  result: EngineResult;
  authResult: EngineResult;
  applied: ChangeEvent[];
  impacts: Record<string, EventImpact>;
  focus?: EventImpact;
  whatIfActive: boolean;
  plannedActive: boolean;
  cap?: CapabilityResult;
  computeMs: number;
}

const Ctx = createContext<EngineCtx | null>(null);

function scenarioImpacts(s: Scenario): Record<string, EventImpact> {
  const out: Record<string, EventImpact> = {};
  let nodes = toMap(s.nodes);
  for (const e of [...s.events].sort((a, b) => a.t - b.t)) {
    const beforeNodes = nodes;
    const afterNodes = applyPatches(nodes, e.patches);
    const before = compute(s, beforeNodes, e.t);
    const after = compute(s, afterNodes, e.t);
    const diff = diffResults(before, after);
    out[e.id] = { event: e, diff, lines: explainEvent(s, beforeNodes, afterNodes, e, diff), after, before, beforeNodes, afterNodes };
    nodes = afterNodes;
  }
  return out;
}

export function EngineProvider({ children }: { children: ReactNode }) {
  const scenarioId = useStore((s) => s.scenarioId);
  const at = useStore((s) => s.watchTime);
  const shifts = useStore((s) => s.shifts);
  const approved = useStore((s) => s.approved);
  const selectedCap = useStore((s) => s.selectedCap);
  const focusEventId = useStore((s) => s.focusEventId);

  const scenario = useMemo(() => scenarioById(scenarioId), [scenarioId]);
  const impacts = useMemo(() => scenarioImpacts(scenario), [scenario]);

  const value = useMemo<EngineCtx>(() => {
    const t0 = performance.now();
    const { nodes: authNodes, applied } = stateAt(scenario, at);
    const levers = scenario.levers.filter((l) => approved.includes(l.id));
    const planned = applyPatches(authNodes, levers.flatMap((l) => l.patches));
    const nodes = applyShifts(planned, shifts);
    const result = compute(scenario, nodes, at);
    const authResult = levers.length || Object.values(shifts).some(Boolean) ? compute(scenario, authNodes, at) : result;
    const computeMs = performance.now() - t0;
    const focusId = focusEventId && applied.some((e) => e.id === focusEventId) ? focusEventId : applied[applied.length - 1]?.id;
    return {
      scenario,
      at,
      authNodes,
      nodes,
      result,
      authResult,
      applied,
      impacts,
      focus: focusId ? impacts[focusId] : undefined,
      whatIfActive: Object.values(shifts).some(Boolean),
      plannedActive: levers.length > 0,
      cap: result.capabilities.find((c) => c.id === selectedCap) ?? result.capabilities[0],
      computeMs,
    };
  }, [scenario, at, shifts, approved, selectedCap, focusEventId, impacts]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEngine() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEngine outside EngineProvider');
  return v;
}
