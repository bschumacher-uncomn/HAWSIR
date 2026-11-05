import { toast } from 'sonner';
import { api } from '@/api/client';
import { forgetClock, setClock } from '@/api/clock';
import type { DecisionEntry, DecisionRequest, LinkState } from '@/api/types';
import { useStore } from './store';

/**
 * Everything that changes the record goes to mission-api: decisions (approve,
 * reject, withdraw, STOP, resume), the simulated data link, and the demo
 * reset. Each is recorded at the time on screen, attributed to the caller,
 * and hash-chained on the server.
 */
async function decide(mission: string, at: number, req: DecisionRequest): Promise<DecisionEntry | undefined> {
  try {
    await setClock(mission, at);
    const d = await api.post<DecisionEntry>(`/m/${mission}/decisions`, req);
    useStore.getState().bump();
    return d;
  } catch (e) {
    toast.error('Not recorded', { description: (e as Error).message });
    useStore.getState().bump();
    return undefined;
  }
}

export const actions = {
  approve: (mission: string, at: number, lever: string, note?: string) => decide(mission, at, { kind: 'approve', lever, note }),
  reject: (mission: string, at: number, lever: string, note: string) => decide(mission, at, { kind: 'reject', lever, note }),
  withdraw: (mission: string, at: number, lever: string, note: string) => decide(mission, at, { kind: 'withdraw', lever, note }),
  stop: (mission: string, at: number, note: string) => decide(mission, at, { kind: 'stop', note }),
  resume: (mission: string, at: number, note: string) => decide(mission, at, { kind: 'resume', note }),
  note: (mission: string, at: number, note: string) => decide(mission, at, { kind: 'note', note }),

  async setLink(up: boolean, reason: string): Promise<LinkState | undefined> {
    try {
      const r = await api.post<{ link: LinkState }>('/link', { up, reason });
      useStore.getState().bump();
      return r.link;
    } catch (e) {
      toast.error('Link change refused', { description: (e as Error).message });
      return undefined;
    }
  },

  async reset(mission: string): Promise<void> {
    try {
      await api.post(`/m/${mission}/reset`, {});
      forgetClock(mission);
      const st = useStore.getState();
      st.setScenario(mission);
      st.bump();
      toast('Mission reset', { description: 'Logs re-seeded from the baseline on this node. The previous chain is gone; export it first if it matters.' });
    } catch (e) {
      toast.error('Reset refused', { description: (e as Error).message });
    }
  },
};
