import { create } from 'zustand';

export interface Flash {
  id: number;
  title: string;
  lines: string[];
  tone: 'crit' | 'warn' | 'ok';
}

export const useFlash = create<{ flash: Flash | null; show: (f: Omit<Flash, 'id'>) => void; clear: () => void }>((set) => ({
  flash: null,
  show: (f) => set({ flash: { ...f, id: Date.now() } }),
  clear: () => set({ flash: null }),
}));
