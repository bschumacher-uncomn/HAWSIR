import { useMemo } from 'react';
import { applyPatches, applyShifts, isShiftable, slackFor, upstreamCone, type NodeMap, type SlackResult } from '@/engine';
import { useAnalysisKey } from '@/state/analysis';
import { useEngine } from '@/state/engine';
import { useStore } from '@/state/store';

/** Upstream slack vs mission margin for every shiftable node feeding the capability. */
export function useConeSlack(capId: string | undefined): Record<string, SlackResult> {
  const { scenario, nodes, at } = useEngine();
  const key = useAnalysisKey();
  return useMemo(() => {
    if (!capId || !nodes[capId]) return {};
    const out: Record<string, SlackResult> = {};
    for (const id of upstreamCone(nodes, capId)) {
      if (id !== capId && isShiftable(nodes[id])) out[id] = slackFor(scenario, nodes, at, id, capId);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, capId]);
}

/** The planning picture with every what-if except the one on `nodeId`, so its curve stays put while the slider moves. */
export function useBaseWithout(nodeId: string | null): NodeMap {
  const { scenario, authNodes } = useEngine();
  const approved = useStore((s) => s.approved);
  const shifts = useStore((s) => s.shifts);
  const others = useMemo(() => {
    const o = { ...shifts };
    if (nodeId) delete o[nodeId];
    return JSON.stringify(o);
  }, [shifts, nodeId]);
  return useMemo(() => {
    const levers = scenario.levers.filter((l) => approved.includes(l.id));
    return applyShifts(
      applyPatches(
        authNodes,
        levers.flatMap((l) => l.patches),
      ),
      JSON.parse(others) as Record<string, number>,
    );
  }, [scenario, authNodes, approved, others]);
}
