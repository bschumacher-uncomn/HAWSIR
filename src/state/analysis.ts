import { api } from '@/api/client';
import { useRemote } from '@/api/useRemote';
import type { CapAnalysis, NodeAnalysis, SensitivityBar } from '@/api/types';
import { useEngine, viewTimeFor } from './engine';
import { useStore } from './store';

/**
 * The time analysis is run for: a coarser step than the picture (6 h, or 1 h
 * on an H-hour scale), and exactly at each report. Slack, options and Monte
 * Carlo take longer than a picture, so they refresh when the story moves on,
 * not on every replay frame.
 */
export function useAnalysisAt(): number {
  const { scenario, snapshot } = useEngine();
  return Math.min(snapshot.at, viewTimeFor(scenario, snapshot.at, true));
}

/** Changes only when the analysis would (a new report, a decision, a new coarse step). */
export function useAnalysisKey() {
  const { snapshot } = useEngine();
  const version = useStore((s) => s.version);
  const at = useAnalysisAt();
  return `${snapshot.mission}|${at}|${snapshot.key.split('|')[1]}|${version}`;
}

/** Slack, cliffs, explanation, bounded options and Monte Carlo for one capability, computed by mission-api. */
export function useCapAnalysis(capId: string | undefined): CapAnalysis | undefined {
  const { snapshot } = useEngine();
  const key = useAnalysisKey();
  const at = useAnalysisAt();
  const r = useRemote<CapAnalysis>(capId ? `${key}|cap|${capId}` : null, () => api.get(`/m/${snapshot.mission}/analysis/${encodeURIComponent(capId!)}?at=${at}`));
  return r.data && r.dataKey?.endsWith(`|cap|${capId}`) ? r.data : undefined;
}

/** Margin of one capability with each uncertain input at the ends of its range (what-ifs applied). */
export function useSensitivity(capId: string | undefined): SensitivityBar[] | undefined {
  const { snapshot, whatIfActive } = useEngine();
  const shifts = useStore((s) => s.shifts);
  const key = useAnalysisKey();
  const at = useAnalysisAt();
  const sh = whatIfActive ? Object.fromEntries(Object.entries(shifts).filter(([, v]) => v)) : {};
  const k = capId ? `${key}|sens|${capId}|${JSON.stringify(Object.entries(sh).sort())}` : null;
  const r = useRemote<SensitivityBar[]>(k, () => api.post(`/m/${snapshot.mission}/sensitivity`, { at, target: capId, shifts: sh }));
  return r.data && r.dataKey === k ? r.data : undefined;
}

/** Slack and consequence curve of one input against one capability. */
export function useNodeAnalysis(nodeId: string | null | undefined, capId: string | undefined): NodeAnalysis | undefined {
  const { snapshot } = useEngine();
  const key = useAnalysisKey();
  const at = useAnalysisAt();
  const k = nodeId && capId ? `${key}|node|${nodeId}|${capId}` : null;
  const r = useRemote<NodeAnalysis>(k, () => api.get(`/m/${snapshot.mission}/nodes/${encodeURIComponent(nodeId!)}?cap=${encodeURIComponent(capId!)}&at=${at}`));
  return r.data && r.dataKey === k ? r.data : undefined;
}
