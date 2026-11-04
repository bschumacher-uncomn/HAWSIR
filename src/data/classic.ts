import type { Scenario, SourceRef } from '@/engine/types';

const src = (system: SourceRef['system'], recordId: string, asOf: number, value?: string): SourceRef => ({ system, recordId, asOf, value });

/** The five-input illustration: which dependency actually controls the outcome? */
export const classic: Scenario = {
  id: 'classic',
  name: 'Radar Repair Before Tasking',
  short: 'Radar repair · 10h',
  tagline: 'What actually controls the outcome?',
  timeScale: 'hours',
  dDay: 0,
  epochUtc: Date.UTC(2026, 10, 3, 5, 0, 0),
  tzOffset: -5,
  ship: { name: 'USS GRACE HOPPER', hull: 'DDG-170', cls: 'Arleigh Burke Flt III (synthetic)', homeport: 'Norfolk, VA' },
  mission: {
    name: 'SURGE TASKING 1800',
    area: 'VACAPES OPAREA',
    start: 18,
    summary: 'Air search radar must be up by 1800 for tasking.',
    tasking: 'Air defense picket, 1800 local',
  },
  watchStart: 8,
  horizon: [6, 22],
  thresholds: { qMargin: 0.75, cliff: 1 },
  phases: [
    { id: 'p_prep', name: 'REPAIR WINDOW', start: 6, end: 18, requires: [] },
    { id: 'p_task', name: 'TASKING', start: 18, end: 22, requires: ['c_radar'] },
  ],
  nodes: [
    {
      id: 'in_part', kind: 'input', label: 'Replacement part arrives', domain: 'logistics', part: 'spy_b', value: 12,
      uncertainty: { min: -0.5, mode: 0, max: 2 }, sources: [src('R-SUPPLY', 'DOC N21706-6308-0101', 8, 'ETA 1200')],
    },
    {
      id: 'in_team', kind: 'input', label: 'Qualified repair team available', domain: 'personnel', part: 'crew', value: 14,
      uncertainty: { min: -0.5, mode: 0, max: 1.5 }, sources: [src('WATCHBILL', 'WB-FC-REPAIR', 8, 'Avail 1400')],
    },
    {
      id: 't_repair', kind: 'task', label: 'Repair & required testing', domain: 'maintenance', part: 'spy_b', deps: ['in_part', 'in_team'], duration: 3,
      uncertainty: { min: -0.5, mode: 0, max: 1.5 }, sources: [src('OMMS-NG', 'JCN 21706-S-0101', 8, '3h est.')],
    },
    { id: 'c_radar', kind: 'capability', code: 'RADAR', label: 'Air search radar (tasking)', domain: 'capability', part: 'spy_b', deps: ['t_repair'], requiredBy: 18 },
  ],
  events: [
    { id: 'C00', t: 8, kind: 'baseline', severity: 'info', title: 'Baseline', detail: 'Part 1200, team 1400, 3h repair and test, required 1800.', source: src('NAVIFI', 'INGEST', 8), patches: [] },
    {
      id: 'C01', t: 9.5, kind: 'supply', severity: 'warn', title: 'Part slips to 1330', detail: 'Courier delay reported by R-Supply.',
      source: src('R-SUPPLY', 'DOC N21706-6308-0101', 9.5),
      patches: [{ op: 'set', id: 'in_part', fields: { value: 13.5, sources: [src('R-SUPPLY', 'DOC N21706-6308-0101', 9.5, 'ETA 1330')] } }],
    },
    {
      id: 'C02', t: 11, kind: 'personnel', severity: 'crit', title: 'Repair team slips to 1600', detail: 'Team held on a higher-priority casualty.',
      source: src('WATCHBILL', 'WB-FC-REPAIR', 11),
      patches: [{ op: 'set', id: 'in_team', fields: { value: 16, sources: [src('WATCHBILL', 'WB-FC-REPAIR', 11, 'Avail 1600')] } }],
    },
  ],
  levers: [
    {
      id: 'K_XDECK', category: 'crew', title: 'Cross-deck qualified tech (team at 1500)', detail: 'Borrow a qualified technician from the pier-mate.',
      authority: 'DESRON (off-ship)', withinShipAuthority: false, cost: 'low', risk: 'Degrades lending ship',
      patches: [{ op: 'set', id: 'in_team', fields: { value: 15 } }],
    },
    {
      id: 'K_CONC', category: 'resequence', title: 'Concurrent testing (2h 15m total)', detail: 'Run alignment checks during reassembly with ISEA concurrence.',
      authority: 'CHENG + ISEA concurrence', withinShipAuthority: true, cost: 'low', risk: 'Higher retest probability',
      patches: [{ op: 'set', id: 't_repair', fields: { duration: 2.25 } }],
    },
    {
      id: 'K_SHIFT', category: 'schedule', title: 'Request tasking shift to 1930', detail: 'Ask the tasking authority for a 90-minute shift.',
      authority: 'Tasking authority (off-ship)', withinShipAuthority: false, cost: 'med', risk: 'May be denied',
      patches: [{ op: 'set', id: 'c_radar', fields: { requiredBy: 19.5 } }],
    },
  ],
};
