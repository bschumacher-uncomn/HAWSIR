import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { RefreshCw, ServerCrash } from 'lucide-react';
import { api } from '@/api/client';
import { ensureAt } from '@/api/clock';
import { useRemote } from '@/api/useRemote';
import type {
  CapabilityResult, ChangeEvent, EngineResult, EventImpact, LeverView, LinkState, MissionView, NodeMap, Scenario, Snapshot, WhatIfResult,
} from '@/api/types';
import { toMap } from '@/lib/graph';
import { BRAND } from '@/brand';
import { useStore } from './store';

export type { EventImpact } from '@/api/types';

/**
 * The picture on screen, as mission-api computed it. The watch time animates
 * locally; pictures are fetched at a coarser step (an hour, or 15 minutes on
 * an H-hour scale, and exactly at each report) and the last good picture stays
 * up while the next one loads.
 */
interface EngineCtx {
  scenario: Scenario;
  /** The live watch time (animates). */
  at: number;
  /** The time the picture on screen was computed for. */
  viewAt: number;
  snapshot: Snapshot;
  authNodes: NodeMap;
  nodes: NodeMap;
  result: EngineResult;
  authResult: EngineResult;
  applied: ChangeEvent[];
  impacts: Record<string, EventImpact>;
  focus?: EventImpact;
  whatIfActive: boolean;
  plannedActive: boolean;
  approved: string[];
  levers: LeverView[];
  halted: Snapshot['halted'];
  link: LinkState;
  cap?: CapabilityResult;
  computeMs: number;
  loading: boolean;
}

const Ctx = createContext<EngineCtx | null>(null);

/** The time a picture is fetched for: the step below `t`, or the latest report at or before `t` if that is later. */
export function viewTimeFor(s: Scenario, t: number, coarse = false): number {
  const step = s.timeScale === 'hours' ? (coarse ? 1 : 0.25) : coarse ? 6 : 1;
  const q = Math.floor(t / step + 1e-9) * step;
  const last = s.events.reduce((m, e) => (e.t <= t + 1e-9 && e.t > m ? e.t : m), -Infinity);
  return Math.min(s.horizon[1], Math.max(s.horizon[0], q, last));
}

export function useMissionView(id: string) {
  return useRemote<MissionView>(id ? `${id}|mission` : null, () => api.get(`/m/${id}`));
}

/** A picture at an arbitrary time (e.g. the plan at watch start), cached like the live one. */
export function useSnapshotAt(mission: string, t: number | undefined) {
  const version = useStore((s) => s.version);
  const key = t !== undefined && Number.isFinite(t) ? `${mission}|snap|${t}|${version}` : null;
  return useRemote<Snapshot>(key, async () => {
    await ensureAt(mission, t!);
    return api.get(`/m/${mission}/snapshot?at=${t}`);
  });
}

function Connecting({ error, retry }: { error?: Error; retry: () => void }) {
  return (
    <div className="ocean-bg flex h-full items-center justify-center">
      <div className="hud w-[460px] p-6 text-center">
        {error ? <ServerCrash size={34} className="mx-auto text-crit" /> : <RefreshCw size={30} className="mx-auto animate-spin text-calc" />}
        <div className="mt-3 font-display text-[15px] font-bold tracking-[0.22em] text-white">{error ? 'MISSION API UNREACHABLE' : `${BRAND.name} · CONNECTING`}</div>
        <p className="mt-2 font-mono text-[11px] text-mute">
          {error ? error.message : 'Loading the mission picture from mission-api…'}
        </p>
        {error && (
          <button type="button" onClick={retry} className="mt-4 rounded-[3px] border border-calc/50 px-4 py-1.5 font-display text-[11px] font-semibold tracking-[0.2em] text-calc hover:bg-calc/10">
            RETRY
          </button>
        )}
      </div>
    </div>
  );
}

export function EngineProvider({ children }: { children: ReactNode }) {
  const scenarioId = useStore((s) => s.scenarioId);
  const watchTime = useStore((s) => s.watchTime);
  const shifts = useStore((s) => s.shifts);
  const selectedCap = useStore((s) => s.selectedCap);
  const focusEventId = useStore((s) => s.focusEventId);
  const version = useStore((s) => s.version);
  const bump = useStore((s) => s.bump);

  const mv = useMissionView(scenarioId);
  const scenario = mv.dataKey === `${scenarioId}|mission` ? mv.data : undefined;

  // first load of a mission: start at the end of the scripted watch (the full story), unless a time was asked for
  useEffect(() => {
    if (!scenario) return;
    const st = useStore.getState();
    if (!Number.isFinite(st.watchTime)) st.setWatchTime(scenario.watchEnd);
    if (!st.selectedCap) st.selectCap(scenario.defaultFocus);
  }, [scenario]);

  // NaN means "not chosen yet": show the end of the scripted watch until the default lands
  const at = scenario ? Math.min(scenario.horizon[1], Math.max(scenario.horizon[0], Number.isNaN(watchTime) ? scenario.watchEnd : watchTime)) : NaN;
  const viewAt = scenario && Number.isFinite(at) ? viewTimeFor(scenario, at) : undefined;
  const snap = useSnapshotAt(scenarioId, viewAt);
  const snapshot = snap.data?.mission === scenarioId ? snap.data : undefined;

  const shiftList = Object.entries(shifts).filter(([, v]) => v);
  const whatIfKey = snapshot && shiftList.length ? `${scenarioId}|whatif|${snapshot.at}|${version}|${JSON.stringify(shiftList.sort())}` : null;
  const wi = useRemote<WhatIfResult>(whatIfKey, () => api.post(`/m/${scenarioId}/whatif`, { at: snapshot!.at, shifts: Object.fromEntries(shiftList) }));
  const whatIf = whatIfKey && wi.data && wi.data.at === snapshot?.at ? wi.data : undefined;

  const value = useMemo<EngineCtx | null>(() => {
    if (!scenario || !snapshot || viewAt === undefined) return null;
    const authNodes = toMap(snapshot.nodes);
    const nodes = whatIf ? toMap(whatIf.nodes) : authNodes;
    const result = whatIf ? whatIf.result : snapshot.result;
    const applied = scenario.events.filter((e) => snapshot.applied.includes(e.id));
    const focusId = focusEventId && snapshot.impacts[focusEventId] ? focusEventId : applied[applied.length - 1]?.id;
    return {
      scenario,
      at,
      viewAt: snapshot.at,
      snapshot,
      authNodes,
      nodes,
      result,
      authResult: snapshot.authResult,
      applied,
      impacts: snapshot.impacts,
      focus: focusId ? snapshot.impacts[focusId] : undefined,
      whatIfActive: !!whatIf,
      plannedActive: snapshot.approved.length > 0,
      approved: snapshot.approved,
      levers: snapshot.levers,
      halted: snapshot.halted,
      link: snapshot.link,
      cap: result.capabilities.find((c) => c.id === selectedCap) ?? result.capabilities[0],
      computeMs: whatIf?.computeMs ?? snapshot.computeMs,
      loading: snap.loading || wi.loading,
    };
  }, [scenario, snapshot, whatIf, viewAt, at, selectedCap, focusEventId, snap.loading, wi.loading]);

  if (!value) {
    const error = mv.error ?? snap.error;
    return <Connecting error={error} retry={() => (mv.error ? location.reload() : bump())} />;
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEngine() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useEngine outside EngineProvider');
  return v;
}
