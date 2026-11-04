import { create } from 'zustand';
import { DISRUPTIONS } from './data';
import { useStore } from '@/state/store';

interface FleetUi {
  active: string[];
  mission: string | null;
  ship: string | null;
  toggle: (id: string) => void;
  clearDisruptions: () => void;
  selectMission: (id: string | null) => void;
  selectShip: (hull: string | null) => void;
}

export const useFleet = create<FleetUi>((set, get) => ({
  active: [],
  mission: null,
  ship: null,
  toggle: (id) => {
    const on = !get().active.includes(id);
    const active = on ? [...get().active, id] : get().active.filter((x) => x !== id);
    set({ active });
    const d = DISRUPTIONS.find((x) => x.id === id);
    useStore.getState().log('WATCHSTANDER', 'FLEET_WHATIF', `Sandbox ${on ? 'applied' : 'removed'}: ${d?.label ?? id} (no authoritative record changed)`, { id, active });
  },
  clearDisruptions: () => {
    if (!get().active.length) return;
    set({ active: [] });
    useStore.getState().log('WATCHSTANDER', 'FLEET_WHATIF', 'Sandbox cleared: fleet picture back to reported data', { active: [] });
  },
  selectMission: (mission) => set({ mission, ship: null }),
  selectShip: (ship) => set({ ship }),
}));
