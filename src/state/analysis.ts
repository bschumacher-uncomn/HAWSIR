import { useMemo } from 'react';
import {
  evaluateOptions,
  explainCapability,
  findCliffs,
  isShiftable,
  runMonteCarlo,
  slackFor,
  type Cliff,
  type Line,
  type MCResult,
  type OptionEval,
  type SlackResult,
} from '@/engine';
import { useEngine } from './engine';
import { useStore } from './store';

/** Changes only when the picture changes (new event, decision, what-if), not on every replay frame. */
export function useAnalysisKey() {
  const { scenario, applied, at } = useEngine();
  const approved = useStore((s) => s.approved);
  const shifts = useStore((s) => s.shifts);
  const bucket = scenario.timeScale === 'hours' ? Math.floor(at * 4) : Math.floor(at / 6);
  return `${scenario.id}|${applied.length}|${approved.join(',')}|${JSON.stringify(shifts)}|${bucket}`;
}

export interface CapAnalysis {
  slack: SlackResult[];
  cliffs: Cliff[];
  lines: Line[];
  options: { singles: OptionEval[]; combos: OptionEval[] };
  mc: MCResult;
}

export function useCapAnalysis(capId: string | undefined): CapAnalysis | undefined {
  const { scenario, nodes, result, at } = useEngine();
  const approved = useStore((s) => s.approved);
  const key = useAnalysisKey();
  return useMemo(() => {
    const cap = result.capabilities.find((c) => c.id === capId);
    if (!cap) return undefined;
    const shiftables = [...new Set([...cap.chain, ...cap.coCritical])].filter((id) => isShiftable(nodes[id]));
    const slack = shiftables.map((id) => slackFor(scenario, nodes, at, id, cap.id));
    const cliffs = findCliffs(scenario, nodes, at, cap.id, cap.chain);
    const lines = explainCapability(scenario, nodes, result, cap.id, { slack, cliffs });
    const options = evaluateOptions(scenario, nodes, at, cap.id, approved);
    const mc = runMonteCarlo(scenario, nodes, at, 400, 1337);
    return { slack, cliffs, lines, options, mc };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, capId]);
}
