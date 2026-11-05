import { create } from 'zustand';

/** Fleet lab UI state. Disruptions are a sandbox: they change the picture on screen, never a record. */
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
  toggle: (id) => set({ active: get().active.includes(id) ? get().active.filter((x) => x !== id) : [...get().active, id] }),
  clearDisruptions: () => set({ active: [] }),
  selectMission: (mission) => set({ mission, ship: null }),
  selectShip: (ship) => set({ ship }),
}));
