import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { StreamEvent } from '@contract/contract';
import { revive } from '@contract/wire';
import { useStore } from '@/state/store';

/**
 * Live updates from mission-api (server-sent events). The stream only says
 * that something changed; the screens refetch the picture. Reports delivered
 * because this screen moved the clock are already in the picture it asked
 * for, so those do not trigger a second fetch.
 */
export function useLiveUpdates(): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const es = new EventSource('/api/stream');
    const on = (type: StreamEvent['type'], fn: (e: StreamEvent) => void) =>
      es.addEventListener(type, (m) => fn(revive<StreamEvent>(JSON.parse((m as MessageEvent).data))));
    const mine = (e: { mission?: string }) => !e.mission || e.mission === useStore.getState().scenarioId;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    on('facts', (e) => {
      if (e.type !== 'facts' || !mine(e) || e.via === 'inject') return;
      useStore.getState().bump();
      if (e.via === 'sync') toast(`${e.count} report${e.count > 1 ? 's' : ''} arrived over the data link`, { description: e.labels.slice(0, 3).join(' · ') });
    });
    on('decision', (e) => mine(e as { mission?: string }) && useStore.getState().bump());
    on('reset', (e) => mine(e as { mission?: string }) && useStore.getState().bump());
    on('link', () => useStore.getState().bump());
    on('sync', (e) => {
      if (e.type !== 'sync' || !mine(e)) return;
      if (e.ok && (e.pushed || e.pulled)) useStore.getState().bump();
      if (!e.ok && e.error) toast.warning('Sync with shore failed', { description: e.error });
      if (e.contested.length) toast.warning('Sources disagree after sync', { description: e.contested.slice(0, 3).join(', ') });
    });
    return () => es.close();
  }, []);
  return { connected };
}
