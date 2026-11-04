import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { scenarioById } from '@/data/scenarios';
import { entryHash, GENESIS } from '@/lib/audit';

export { entryHash, GENESIS, verifyChain } from '@/lib/audit';

export type LinkMode = 'SATCOM' | 'DDIL' | 'DENIED';
export type Actor = 'SYSTEM' | 'WATCHSTANDER' | 'ENGINE' | 'AI';

export interface AuditEntry {
  seq: number;
  wall: string;
  t: number;
  actor: Actor;
  action: string;
  detail: string;
  data?: unknown;
  prev: string;
  hash: string;
  shoreSynced: boolean;
}

export interface Decision {
  id: string;
  leverIds: string[];
  title: string;
  decision: 'APPROVED' | 'REJECTED' | 'REVOKED';
  by: string;
  t: number;
  wall: string;
  note?: string;
  targetCap: string;
  marginBefore: number;
  marginAfter: number;
}

interface State {
  booted: boolean;
  scenarioId: string;
  watchTime: number;
  playing: boolean;
  speed: number;
  selectedCap: string;
  selectedNode: string | null;
  focusEventId: string | null;
  shifts: Record<string, number>;
  approved: string[];
  decisions: Decision[];
  link: LinkMode;
  halted: boolean;
  haltReason: string;
  audit: AuditEntry[];
  watchOfficer: string;
  llmEnabled: boolean;

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
  decide: (d: Omit<Decision, 'id' | 'wall' | 'by'>) => void;
  revoke: (leverId: string) => void;
  setLink: (m: LinkMode) => void;
  halt: (reason: string) => void;
  resume: (reason: string) => void;
  log: (actor: Actor, action: string, detail: string, data?: unknown) => void;
  markShoreSynced: (n: number) => void;
  tamper: () => void;
  resetSession: () => void;
  setLlm: (on: boolean) => void;
}

const defaultWatch = (id: string) => {
  const s = scenarioById(id);
  const last = s.events[s.events.length - 1];
  return s.timeScale === 'hours' ? s.watchStart : last.t + 1;
};

const postAudit = (e: AuditEntry) => {
  fetch('/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(e) }).catch(() => undefined);
};

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      booted: false,
      scenarioId: 'ddg21',
      watchTime: defaultWatch('ddg21'),
      playing: false,
      speed: 6,
      selectedCap: 'c_amd',
      selectedNode: null,
      focusEventId: null,
      shifts: {},
      approved: [],
      decisions: [],
      link: 'SATCOM',
      halted: false,
      haltReason: '',
      audit: [],
      watchOfficer: 'LT J. Cole (OOD/TAO)',
      llmEnabled: true,

      setBooted: (booted) => set({ booted }),
      setScenario: (id) => {
        const s = scenarioById(id);
        const cap = s.nodes.find((n) => n.kind === 'capability' && n.code === 'AMD') ?? s.nodes.find((n) => n.kind === 'capability');
        set({ scenarioId: id, watchTime: defaultWatch(id), shifts: {}, approved: [], selectedNode: null, focusEventId: null, selectedCap: cap?.id ?? '' });
        get().log('WATCHSTANDER', 'SCENARIO_LOAD', `Loaded workflow "${s.name}"`, { id });
      },
      setWatchTime: (t) => set({ watchTime: t }),
      setPlaying: (playing) => set({ playing }),
      setSpeed: (speed) => set({ speed }),
      selectCap: (selectedCap) => set({ selectedCap }),
      selectNode: (selectedNode) => set({ selectedNode }),
      focusEvent: (focusEventId) => set({ focusEventId }),
      setShift: (id, delta) => set((st) => ({ shifts: { ...st.shifts, [id]: delta } })),
      clearShifts: () => set({ shifts: {} }),
      decide: (d) => {
        const st = get();
        const dec: Decision = { ...d, id: `DEC-${String(st.decisions.length + 1).padStart(4, '0')}`, wall: new Date().toISOString(), by: st.watchOfficer };
        set({
          decisions: [...st.decisions, dec],
          approved: d.decision === 'APPROVED' ? [...new Set([...st.approved, ...d.leverIds])] : st.approved,
        });
        get().log('WATCHSTANDER', `COA_${d.decision}`, `${d.title}${d.note ? ` | note: ${d.note}` : ''}`, {
          leverIds: d.leverIds,
          targetCap: d.targetCap,
          marginBefore: d.marginBefore,
          marginAfter: d.marginAfter,
        });
      },
      revoke: (leverId) => {
        set((st) => ({ approved: st.approved.filter((x) => x !== leverId) }));
        get().log('WATCHSTANDER', 'COA_REVOKED', `Planning assumption ${leverId} revoked`, { leverId });
      },
      setLink: (link) => {
        if (get().link === link) return;
        set({ link });
        get().log('SYSTEM', 'LINK_STATE', `Shore link now ${link}`, { link });
      },
      halt: (reason) => {
        set({ halted: true, haltReason: reason, playing: false });
        get().log('WATCHSTANDER', 'AGENT_STOP', `STOP invoked: ${reason}`);
      },
      resume: (reason) => {
        set({ halted: false, haltReason: '' });
        get().log('WATCHSTANDER', 'AGENT_RESUME', `Resumed by watchstander: ${reason}`);
      },
      log: (actor, action, detail, data) => {
        const st = get();
        const prev = st.audit.length ? st.audit[st.audit.length - 1].hash : GENESIS;
        const base = { seq: st.audit.length + 1, wall: new Date().toISOString(), t: st.watchTime, actor, action, detail, data, prev };
        const entry: AuditEntry = { ...base, hash: entryHash(base), shoreSynced: false };
        set({ audit: [...st.audit, entry] });
        postAudit(entry);
      },
      markShoreSynced: (n) =>
        set((st) => {
          let left = n;
          return { audit: st.audit.map((e) => (!e.shoreSynced && left-- > 0 ? { ...e, shoreSynced: true } : e)) };
        }),
      tamper: () =>
        set((st) => {
          if (st.audit.length < 3) return {};
          const i = Math.floor(st.audit.length / 2);
          const audit = st.audit.map((e, k) => (k === i ? { ...e, detail: e.detail + ' [edited]' } : e));
          return { audit };
        }),
      resetSession: () => set({ audit: [], decisions: [], approved: [], shifts: {}, halted: false }),
      setLlm: (llmEnabled) => set({ llmEnabled }),
    }),
    {
      name: 'navifi-session',
      partialize: (s) => ({
        scenarioId: s.scenarioId,
        approved: s.approved,
        decisions: s.decisions,
        audit: s.audit,
        watchOfficer: s.watchOfficer,
        llmEnabled: s.llmEnabled,
      }),
    },
  ),
);
