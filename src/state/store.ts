import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BRAND } from '@/brand';

/**
 * UI state only. Everything authoritative (facts, decisions, STOP, the data
 * link, the audit chain) lives in mission-api; this store holds what the
 * screen is looking at and what the user is exploring.
 */
export type LinkMode = 'SATCOM' | 'DDIL' | 'DENIED';

interface State {
  booted: boolean;
  scenarioId: string;
  /** Watch time being viewed (scenario hours); NaN until the mission's default is known. */
  watchTime: number;
  playing: boolean;
  speed: number;
  selectedCap: string;
  selectedNode: string | null;
  focusEventId: string | null;
  /** What-if slips (hours) by node id. Never written anywhere. */
  shifts: Record<string, number>;
  watchOfficer: string;
  llmEnabled: boolean;
  /** Bumped whenever the API reports a change, so views refetch. */
  version: number;

  setBooted: (b: boolean) => void;
  setScenario: (id: string) => void;
  setWatchTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  selectCap: (id: string) => void;
  selectNode: (id: string | null) => void;
  focusEvent: (id: string | null) => void;
  setShift: (id: string, delta: number) => void;
  clearShifts: () => void;
  setLlm: (on: boolean) => void;
  bump: () => void;
}

export const useStore = create<State>()(
  persist(
    (set) => ({
      booted: false,
      scenarioId: 'atlas-shield',
      watchTime: NaN,
      playing: false,
      speed: 6,
      selectedCap: '',
      selectedNode: null,
      focusEventId: null,
      shifts: {},
      watchOfficer: 'LT J. Cole (OOD/TAO)',
      llmEnabled: true,
      version: 0,

      setBooted: (booted) => set({ booted }),
      setScenario: (id) => set({ scenarioId: id, watchTime: NaN, playing: false, shifts: {}, selectedNode: null, focusEventId: null, selectedCap: '' }),
      setWatchTime: (t) => set({ watchTime: t }),
      setPlaying: (playing) => set({ playing }),
      setSpeed: (speed) => set({ speed }),
      selectCap: (selectedCap) => set({ selectedCap }),
      selectNode: (selectedNode) => set({ selectedNode }),
      focusEvent: (focusEventId) => set({ focusEventId }),
      setShift: (id, delta) => set((st) => ({ shifts: { ...st.shifts, [id]: delta } })),
      clearShifts: () => set({ shifts: {} }),
      setLlm: (llmEnabled) => set({ llmEnabled }),
      bump: () => set((st) => ({ version: st.version + 1 })),
    }),
    {
      name: `${BRAND.slug}-ui`,
      partialize: (s) => ({ scenarioId: s.scenarioId, watchOfficer: s.watchOfficer, llmEnabled: s.llmEnabled, speed: s.speed }),
    },
  ),
);

if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as Record<string, unknown>)[`__${BRAND.slug}`] = useStore;
