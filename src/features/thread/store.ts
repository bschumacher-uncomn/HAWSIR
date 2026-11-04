import { create } from 'zustand';

export const PACKET_MS = 1500;

export interface Packet {
  id: number;
  link: string;
  cargo: string;
  color: string;
  t0: number;
}

let seq = 0;
let sweep: ReturnType<typeof setTimeout> | undefined;

/** Handoffs in flight; kept apart from the engine so packets don't re-render the page. */
export const usePackets = create<{ packets: Packet[] }>(() => ({ packets: [] }));

export function spawnPackets(list: Omit<Packet, 'id' | 't0'>[]) {
  const now = performance.now();
  const keep = usePackets.getState().packets.filter((p) => now - p.t0 < PACKET_MS);
  const fresh = list.slice(-24).map((p, i) => ({ ...p, id: ++seq, t0: now + i * 110 }));
  usePackets.setState({ packets: [...keep, ...fresh].slice(-60) });
  clearTimeout(sweep);
  sweep = setTimeout(() => spawnPackets([]), PACKET_MS + 400);
}

export function clearPackets() {
  usePackets.setState({ packets: [] });
}

/** Projection playhead: runs the current plan forward without moving watch time. */
export const useProjection = create<{ tau: number | null; setTau: (t: number | null) => void }>((set) => ({
  tau: null,
  setTau: (tau) => set({ tau }),
}));
