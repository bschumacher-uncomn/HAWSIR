import { api } from './client';
import type { MissionSummary } from './types';
import { useRemote } from './useRemote';

/** Missions this node serves. */
export function useMissions(): MissionSummary[] {
  return useRemote<{ missions: MissionSummary[] }>('missions', () => api.get('/missions')).data?.missions ?? [];
}
