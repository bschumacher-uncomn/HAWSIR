import { api } from '@/api/client';
import { useRemote } from '@/api/useRemote';
import type { CapAnalysis, NodeAnalysis } from '@/api/types';
import { useEngine, viewTimeFor } from './engine';
import { useStore } from './store';

/**
 * The time analysis is run for: a coarser step than the picture (6 h, or 1 h
 * on an H-hour scale), and exactly at each report. Slack, options and Monte
 * Carlo take longer than a picture, so they refresh when the story moves on,
 * not on every replay frame.
 */
function useAnalysisAt(): number {
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

/** Slack and consequence curve of one input against one capability. */
export function useNodeAnalysis(nodeId: string | null | undefined, capId: string | undefined): NodeAnalysis | undefined {
  const { snapshot } = useEngine();
  const key = useAnalysisKey();
  const at = useAnalysisAt();
  const k = nodeId && capId ? `${key}|node|${nodeId}|${capId}` : null;
  const r = useRemote<NodeAnalysis>(k, () => api.get(`/m/${snapshot.mission}/nodes/${encodeURIComponent(nodeId!)}?cap=${encodeURIComponent(capId!)}&at=${at}`));
  return r.data && r.dataKey === k ? r.data : undefined;
}
