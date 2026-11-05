import { useMemo } from 'react';
import type { SlackResult } from '@/api/types';
import { useCapAnalysis } from '@/state/analysis';

/** Upstream slack vs mission margin for the inputs on (and binding with) the capability's controlling chain, from mission-api. */
export function useConeSlack(capId: string | undefined): Record<string, SlackResult> {
  const analysis = useCapAnalysis(capId);
  return useMemo(() => Object.fromEntries((analysis?.slack ?? []).map((s) => [s.nodeId, s])), [analysis]);
}
