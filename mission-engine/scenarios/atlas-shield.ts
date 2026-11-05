/**
 * Operation ATLAS SHIELD (synthetic, unclassified).
 *
 * USS GRACE HOPPER (DDG-170) has 21 days from Norfolk to a BMD patrol station
 * in the Eastern Mediterranean. Six mission-essential capabilities are needed at
 * different points of the voyage. Over the work-up the reports land:
 *   D-20  SPY-1D Array B transmitter casualty (CASREP C-3); the replacement
 *         crossed-field amplifier (CFA) has no ETA yet.
 *   D-19  FC1 Martinez, one of three SPY transmitter-qualified techs, goes TAD
 *         to Aegis school and rejoins at Rota.
 *   D-17  The CFA ETA slips 2 days 3 hours, eight hours after the ship sails:
 *         it misses the Norfolk pier and the next delivery window is Rota.
 *   D-16  FC2 Okafor goes on emergency leave.
 *   D-15  DLA tracking contradicts R-Supply's ETA; the helo detachment's
 *         readiness slips toward the end of the fly-on window.
 *   D-14  NAVSEA withdraws the repair estimate; an NSIPS record arrives with
 *         an invalid date and is quarantined.
 *
 * The mission is authored directly as a graph; every value that changes during
 * the watch is bound to a fact (see the authored pack). Hulls, names and record
 * numbers are fictional; timings are synthetic.
 */
import type { FactInput } from '../src/data/store';
import type { GraphSpec, Slot } from '../src/core/graph';
import type { Lever } from '../src/core/options';
import type { AuthoredModel, AuthoredNode } from '../src/packs/authored';
import type { MissionDisplay, ScenarioEvent } from './display';

/** D(-12, '0700') → scenario hours. The epoch is D-21 0000 ship's time. */
const DDAY = 21;
export const D = (d: number, hhmm: string) => (DDAY + d) * 24 + Number(hhmm.slice(0, 2)) + Number(hhmm.slice(2)) / 60;

const SHIP = 'ddg170';
const NORFOLK_CLOSE = D(-12, '0600');
const ROTA_OPEN = D(-5, '0800');
const ROTA_CLOSE = D(-4, '1200');
const WATCH_START = D(-21, '0800');

const part = (p: string) => [`part:${p}`];

/** A system that is up unless a CASREP reports an outage. */
const sys = (id: string, label: string, p: string, domain = 'maintenance'): AuthoredNode => ({
  id, kind: 'window', label, domain, owner: SHIP, tags: part(p), intervals: [[-Infinity, Infinity]], bind: [{ attr: 'outage' }],
});

/** An input whose time is reported by a source system. */
const input = (id: string, label: string, p: string, domain: string, extra: Partial<AuthoredNode> = {}): AuthoredNode => ({
  id, kind: 'event', label, domain, owner: SHIP, tags: part(p), at: null, bind: [{ attr: 'ready_at' }], ...extra,
} as AuthoredNode);

const person = (id: string, label: string, rate: string, qual: string): AuthoredNode => ({
  id, kind: 'person', label, domain: 'personnel', owner: SHIP, tags: part('crew'), rate, qual, from: undefined,
  bind: [{ attr: 'ready_at' }, { attr: 'person_unavailable' }],
});

const cap = (id: string, code: string, label: string, p: string, deps: string[], requiredBy: number, extra: Partial<AuthoredNode> = {}): AuthoredNode => ({
  id, kind: 'requirement', code, label, domain: 'readiness', owner: SHIP, tags: part(p), deps, window: { start: requiredBy, end: requiredBy }, level: 'asset', ...extra,
} as AuthoredNode);

const cfaSlots: Slot[] = [
  { id: 'norfolk', label: 'Norfolk pier (before sail)', start: 0, end: NORFOLK_CLOSE, lag: 2 },
  { id: 'vertrep', label: 'VERTREP from CLF ship (D-7)', start: D(-7, '1000'), end: D(-7, '1400'), lag: 72, enabled: false, disabledReason: 'not scheduled', authority: 'CTF-63 CLF scheduling' },
  { id: 'rota', label: 'Rota port visit', start: ROTA_OPEN, end: ROTA_CLOSE, lag: 48 },
];

const casrepB = { when: { entity: 'sys_spy_b', attr: 'outage' } };

const nodes: AuthoredNode[] = [
  /* MOB */
  sys('sys_gtm_1', 'GTM 1A (LM2500)', 'gtm'),
  sys('sys_gtm_2', 'GTM 1B (LM2500)', 'gtm'),
  sys('sys_gtm_3', 'GTM 2A (LM2500)', 'gtm'),
  sys('sys_gtm_4', 'GTM 2B (LM2500)', 'gtm'),
  { id: 'k_gtm', kind: 'kofn', k: 3, label: 'Main propulsion (3 of 4 GTMs)', domain: 'maintenance', owner: SHIP, tags: part('gtm'), deps: ['sys_gtm_1', 'sys_gtm_2', 'sys_gtm_3', 'sys_gtm_4'] },
  sys('sys_ssgtg_1', 'SSGTG #1', 'ssgtg'),
  sys('sys_ssgtg_2', 'SSGTG #2', 'ssgtg'),
  sys('sys_ssgtg_3', 'SSGTG #3', 'ssgtg'),
  { id: 'k_ssgtg', kind: 'kofn', k: 2, label: 'Electrical plant (2 of 3 SSGTGs)', domain: 'maintenance', owner: SHIP, tags: part('ssgtg'), deps: ['sys_ssgtg_1', 'sys_ssgtg_2', 'sys_ssgtg_3'] },
  sys('sys_steering', 'Steering gear', 'steering'),
  sys('sys_navradar', 'Navigation radar (SPS-73)', 'nav'),
  input('in_seaanchor', 'Sea & Anchor detail qualified', 'crew', 'personnel', { uncertainty: { min: -6, mode: 0, max: 18 } }),
  cap('c_mob', 'MOB', 'Mobility', 'gtm', ['k_gtm', 'k_ssgtg', 'sys_steering', 'sys_navradar', 'in_seaanchor'], D(-12, '0700'), { qMargin: 24, severity: 'II' } as Partial<AuthoredNode>),

  /* AMD */
  sys('sys_spy_a', 'SPY-1D Array A (FWD/STBD)', 'spy_a'),
  { ...sys('sys_spy_b:hist', 'SPY-1D Array B up before casualty', 'spy_b'), bind: [{ attr: 'outage', entity: 'sys_spy_b' }] },
  { id: 'sys_spy_b', kind: 'any', label: 'SPY-1D Array B (AFT/STBD)', domain: 'maintenance', owner: SHIP, tags: part('spy_b'), deps: ['sys_spy_b:hist', 't_spy_dsot'] },
  sys('sys_spy_c', 'SPY-1D Array C (AFT/PORT)', 'spy_c'),
  sys('sys_spy_d', 'SPY-1D Array D (FWD/PORT)', 'spy_d'),
  sys('sys_aegis', 'Aegis Weapon System (ORTS)', 'aegis'),
  sys('sys_vls', 'Mk 41 VLS', 'vls'),
  input('in_ordnance', 'SM-2 / SM-6 load-out verified', 'vls', 'ordnance'),
  person('p_tao_ames', 'LCDR K. Ames (TAO)', 'O-4', 'TAO / BMD'),
  person('p_tao_brandt', 'LT S. Brandt (TAO)', 'O-3', 'TAO / BMD'),
  person('p_tao_cole', 'LT J. Cole (TAO)', 'O-3', 'TAO / BMD'),
  person('p_tao_diaz', 'LTJG M. Diaz (TAO u/i)', 'O-2', 'TAO / BMD (board pending)'),
  { id: 'k_amd_watch', kind: 'kofn', k: 3, label: 'BMD watch team (3 qualified TAOs)', domain: 'personnel', owner: SHIP, tags: part('crew'), deps: ['p_tao_ames', 'p_tao_brandt', 'p_tao_cole', 'p_tao_diaz'] },
  person('p_fc1_martinez', 'FC1 R. Martinez', 'FC1', 'SPY transmitter (XMTR) qualified'),
  person('p_fc2_okafor', 'FC2 D. Okafor', 'FC2', 'SPY transmitter (XMTR) qualified'),
  person('p_fc2_lindqvist', 'FC2 A. Lindqvist', 'FC2', 'SPY transmitter (XMTR) qualified'),
  {
    ...input('in_cfa_eta', 'CFA replacement: ETA Norfolk', 'spy_b', 'logistics', { assumedAt: D(-14, '0000'), uncertainty: { min: -12, mode: 0, max: 36 } }),
    bind: [{ attr: 'ready_at', staleAfterH: 60 }], ...casrepB,
  } as AuthoredNode,
  { id: 'g_cfa', kind: 'gate', label: 'CFA delivered aboard', domain: 'logistics', owner: SHIP, tags: part('spy_b'), deps: ['in_cfa_eta'], slots: cfaSlots, mode: 'arrive', ...casrepB },
  {
    id: 't_spy_repair', kind: 'task', label: 'Replace CFA & align XMTR group', domain: 'maintenance', owner: SHIP, tags: part('spy_b'), deps: ['g_cfa'],
    duration: 6, assumedDuration: 6, uncertainty: { min: -2, mode: 0, max: 4 },
    crew: { pool: ['p_fc1_martinez', 'p_fc2_okafor', 'p_fc2_lindqvist'], k: 2, label: 'SPY XMTR-qualified FCs' },
    bind: [{ attr: 'duration_h' }], ...casrepB,
  },
  { id: 't_spy_dsot', kind: 'task', label: 'DSOT & ORTS verification', domain: 'maintenance', owner: SHIP, tags: part('spy_b'), deps: ['t_spy_repair'], duration: 4, uncertainty: { min: -1, mode: 0, max: 8 }, ...casrepB },
  cap('c_amd', 'AMD', 'Air & Missile Defense (BMD)', 'aegis', ['sys_spy_a', 'sys_spy_b', 'sys_spy_c', 'sys_spy_d', 'sys_aegis', 'sys_vls', 'in_ordnance', 'k_amd_watch'], D(0, '0800'), { severity: 'I' } as Partial<AuthoredNode>),

  /* SUW */
  sys('sys_ciws', 'CIWS Mk 15 (x2)', 'ciws'),
  sys('sys_ssm', 'Surface strike missiles', 'ssm'),
  sys('sys_spq9', 'SPQ-9B horizon radar', 'spq9'),
  { ...input('in_gun_part', '5"/62 gun: train drive amplifier (R-Supply)', 'gun', 'logistics', { uncertainty: { min: -12, mode: 0, max: 36 } }), bind: [{ attr: 'ready_at', staleAfterH: 96 }] } as AuthoredNode,
  person('p_gm1_reyes', 'GM1 T. Reyes', 'GM1', 'Mk 45 gun maintainer'),
  person('p_gm2_chen', 'GM2 L. Chen', 'GM2', 'Mk 45 gun maintainer'),
  {
    id: 't_gun_repair', kind: 'task', label: 'Gun mount repair + PMS checks', domain: 'maintenance', owner: SHIP, tags: part('gun'), deps: ['in_gun_part'], duration: 8,
    uncertainty: { min: -2, mode: 0, max: 6 }, crew: { pool: ['p_gm1_reyes', 'p_gm2_chen'], k: 1, label: 'Mk 45 qualified GM' },
  },
  cap('c_suw', 'SUW', 'Surface Warfare', 'gun', ['t_gun_repair', 'sys_ciws', 'sys_ssm', 'sys_spq9'], D(-4, '1200'), { severity: 'II' } as Partial<AuthoredNode>),

  /* ASW */
  sys('sys_sqq89', 'SQQ-89 sonar suite', 'sonar'),
  sys('sys_svtt', 'SVTT torpedo tubes', 'svtt'),
  input('in_helo_det', 'MH-60R det ready to fly on (HSM)', 'helo', 'schedule', { uncertainty: { min: -2, mode: 0, max: 8 } }),
  input('in_crash_salvage', 'Crash & salvage team qualified', 'helo', 'personnel', { uncertainty: { min: -4, mode: 0, max: 12 } }),
  { id: 't_flightdeck_cert', kind: 'task', label: 'Flight deck certification', domain: 'schedule', owner: SHIP, tags: part('helo'), deps: ['in_crash_salvage'], duration: 6, uncertainty: { min: -1, mode: 0, max: 4 } },
  {
    id: 'g_helo', kind: 'gate', label: 'Helo detachment embarks', domain: 'schedule', owner: SHIP, tags: part('helo'), deps: ['in_helo_det', 't_flightdeck_cert'], mode: 'arrive',
    slots: [
      { id: 'flyon', label: 'VACAPES fly-on window (D-11)', start: D(-11, '0900'), end: D(-11, '1700'), lag: 0 },
      { id: 'flyon2', label: 'Alternate fly-on (D-10)', start: D(-10, '0900'), end: D(-10, '1700'), lag: 0, enabled: false, disabledReason: 'not scheduled', authority: 'CO + DESRON' },
      { id: 'rota', label: 'Rota rejoin via airlift', start: ROTA_OPEN, end: ROTA_CLOSE, lag: 72 },
    ],
  },
  cap('c_asw', 'ASW', 'Anti-Submarine Warfare', 'sonar', ['sys_sqq89', 'sys_svtt', 'g_helo'], D(-4, '1200'), { severity: 'II' } as Partial<AuthoredNode>),

  /* C5I */
  sys('sys_link16', 'Link 16 terminal', 'link16', 'comms'),
  sys('sys_satcom', 'SATCOM (CBSP / MUOS)', 'satcom', 'comms'),
  input('in_keymat', 'Mission KEYMAT (DCS courier)', 'satcom', 'comms', { uncertainty: { min: -6, mode: 0, max: 36 } }),
  {
    id: 'g_keymat', kind: 'gate', label: 'KEYMAT received aboard', domain: 'comms', owner: SHIP, tags: part('satcom'), deps: ['in_keymat'], mode: 'arrive',
    slots: [
      { id: 'norfolk', label: 'Norfolk pier (before sail)', start: 0, end: NORFOLK_CLOSE, lag: 0 },
      { id: 'rota', label: 'Rota port visit', start: ROTA_OPEN, end: ROTA_CLOSE, lag: 48 },
    ],
  },
  { id: 't_keymat_load', kind: 'task', label: 'Load & verify crypto', domain: 'comms', owner: SHIP, tags: part('link16'), deps: ['g_keymat'], duration: 2 },
  cap('c_c5i', 'C5I', 'Command, Control & Comms', 'satcom', ['sys_link16', 'sys_satcom', 't_keymat_load'], D(0, '0800'), { severity: 'II' } as Partial<AuthoredNode>),

  /* EW */
  sys('sys_slq32', 'SLQ-32(V)6 SEWIP', 'ew'),
  input('in_ew_lib', 'EW mission data file (shore release)', 'ew', 'comms', { uncertainty: { min: -24, mode: 12, max: 168 } }),
  cap('c_ew', 'EW', 'Electronic Warfare', 'ew', ['sys_slq32', 'in_ew_lib'], D(0, '0800'), { severity: 'III' } as Partial<AuthoredNode>),
];

function levers(g: GraphSpec): Lever[] {
  const repair = g.nodes.find((n) => n.id === 't_spy_repair');
  const addCrew = (persons: string[]) =>
    repair?.kind === 'task' && repair.crew ? [{ op: 'set' as const, id: 't_spy_repair', fields: { crew: { ...repair.crew, pool: [...repair.crew.pool, ...persons] } } }] : [];
  const base = { effect: 'planning-assumption' as const, source: 'atlas-shield' };
  const tech = (id: string, label: string, from: number, unavailable?: { start: number; end: number; reason: string }[]) => ({
    op: 'add' as const,
    node: { id, kind: 'person' as const, label, domain: 'personnel', owner: SHIP, tags: part('crew'), qual: 'SPY XMTR', from, unavailable, flags: ['planning-assumption' as const] },
  });
  return [
    {
      ...base, id: 'L_EXPEDITE', category: 'expedite', title: 'Expedite CFA (NMCS, commercial air)',
      detail: 'Upgrade the requisition to not-mission-capable-supply priority. Vendor ships by commercial air; ETA Norfolk D-13 1800.',
      authority: 'Supply Officer request, CO approval', withinUnitAuthority: true, deadline: D(-13, '1200'), cost: 'med',
      risk: { severity: 'III', probability: 'C', note: 'Vendor confidence medium.' }, requiresNodes: ['in_cfa_eta'], target: 'c_amd',
      patches: [{ op: 'set', id: 'in_cfa_eta', fields: { at: D(-13, '1800'), flags: [] } }],
    },
    {
      ...base, id: 'L_VERTREP', category: 'logistics', title: 'VERTREP CFA from CLF ship at D-7',
      detail: 'Route the part to the CLF shuttle and deliver by helicopter at the D-7 rendezvous.',
      authority: 'CTF-63 (off-ship)', withinUnitAuthority: false, deadline: D(-10, '1000'), cost: 'med',
      risk: { severity: 'III', probability: 'C', note: 'Weather and deck-cycle dependent.' }, requiresNodes: ['g_cfa'], target: 'c_amd',
      patches: [{ op: 'slot', id: 'g_cfa', slotId: 'vertrep', fields: { enabled: true } }],
    },
    {
      ...base, id: 'L_FAT', category: 'crew', title: 'Request MARMC fly-away tech assist (2 techs)',
      detail: 'Two SPY XMTR technicians embark D-13 0800 and ride to Rota.',
      authority: 'ISIC / MARMC (off-ship)', withinUnitAuthority: false, deadline: D(-12, '0000'), cost: 'high',
      risk: { severity: 'IV', probability: 'C', note: 'Team availability unconfirmed.' }, requiresNodes: ['t_spy_repair'], target: 'c_amd',
      patches: [tech('p_fat_1', 'MARMC tech J. Alvarez', D(-13, '0800')), tech('p_fat_2', 'MARMC tech M. Park', D(-13, '0800')), ...addCrew(['p_fat_1', 'p_fat_2'])],
    },
    {
      ...base, id: 'L_XDECK', category: 'crew', title: 'Cross-deck FC from pier-mate DDG',
      detail: 'One SPY XMTR-qualified FC2 assigned TAD from D-14 0800 until sail.',
      authority: 'DESRON (off-ship)', withinUnitAuthority: false, deadline: D(-13, '0000'), cost: 'low',
      risk: { severity: 'IV', probability: 'B', note: 'Degrades the lending ship.' }, requiresNodes: ['t_spy_repair'], target: 'c_amd',
      patches: [tech('p_xdeck', 'FC2 B. Hale (cross-deck)', D(-14, '0800'), [{ start: D(-12, '0700'), end: Infinity, reason: 'Returns to parent ship at sail' }]), ...addCrew(['p_xdeck'])],
    },
    {
      ...base, id: 'L_DELAY', category: 'schedule', title: 'Request 12 h sail delay',
      detail: 'Hold the Norfolk pier window open 12 h. Transit speed increases to hold the Rota arrival.',
      authority: 'Fleet / ISIC (off-ship)', withinUnitAuthority: false, deadline: D(-12, '0000'), cost: 'high',
      risk: { severity: 'III', probability: 'B', note: 'Fuel burn and schedule ripple.' }, requiresNodes: ['g_cfa'], target: 'c_amd',
      patches: [
        { op: 'slot', id: 'g_cfa', slotId: 'norfolk', fields: { end: NORFOLK_CLOSE + 12 } },
        { op: 'slot', id: 'g_keymat', slotId: 'norfolk', fields: { end: NORFOLK_CLOSE + 12 } },
        { op: 'set', id: 'c_mob', fields: { window: { start: D(-12, '1900'), end: D(-12, '1900') } } },
      ],
    },
    {
      ...base, id: 'L_HELO2', category: 'schedule', title: 'Hold alternate fly-on window D-10',
      detail: 'Remain in the VACAPES operating area an extra day to give the detachment a second fly-on window.',
      authority: 'CO + DESRON', withinUnitAuthority: false, deadline: D(-12, '0000'), cost: 'med',
      risk: { severity: 'IV', probability: 'C', note: 'Adds transit pressure.' }, requiresNodes: ['g_helo'], target: 'c_asw',
      patches: [{ op: 'slot', id: 'g_helo', slotId: 'flyon2', fields: { enabled: true } }],
    },
    {
      ...base, id: 'L_ACCEPT', category: 'accept', title: 'Accept degraded AMD (3 of 4 arrays)',
      detail: 'Proceed with Array B down. Reduced BMD search volume; reported Q in DRRS-N. Never better than Q while accepted.',
      authority: 'Commanding Officer (report to ISIC)', withinUnitAuthority: true, cost: 'low',
      risk: { severity: 'II', probability: 'D', note: 'Reduced BMD sector coverage.' }, requiresNodes: ['t_spy_dsot'], target: 'c_amd',
      patches: [{ op: 'set', id: 'c_amd', fields: { deps: ['sys_spy_a', 'sys_spy_c', 'sys_spy_d', 'sys_aegis', 'sys_vls', 'in_ordnance', 'k_amd_watch'], qMargin: Infinity, detail: 'Accepted degraded: Array B out, reduced BMD search volume' } }],
    },
  ];
}

export const atlasShieldModel: AuthoredModel = {
  id: 'atlas-shield',
  name: 'Operation ATLAS SHIELD',
  epochUtc: '2026-11-03T05:00:00Z',
  horizon: [0, D(8, '0000')],
  marks: { 'D-0': D(0, '0800') },
  qMarginH: 120,
  nodes,
  focus: ['c_amd', 'c_mob', 'c_asw', 'c_suw', 'c_c5i', 'c_ew'],
  levers,
};

/* ------------------------------------------------------------------ facts */

const fact = (entity: string, attr: string, value: unknown, t: number, system: string, recordId: string, reason?: string, observedAt = t): FactInput => ({
  entity, attr, value, observedAt, recordedAt: t, recordedBy: 'synthetic-feed', reason,
  source: { system, recordId, kind: 'synthetic' }, origin: t > WATCH_START ? `feed:${system}` : 'seed',
});

/** What the feeds report when the watch starts (D-21 0800). */
export function atlasShieldBaseline(): FactInput[] {
  const t = WATCH_START;
  const onboard = (id: string, rec: string) => fact(id, 'ready_at', 0, t, 'NSIPS', rec, 'onboard', 0);
  return [
    fact('in_seaanchor', 'ready_at', D(-14, '1200'), t, 'WATCHBILL', 'WB-SEA-ANCHOR-26', 'Sea & Anchor detail qualification scheduled'),
    fact('in_ordnance', 'ready_at', 0, t, 'SKED', 'ORD-LOADOUT-1142', 'Load-out verified (NWS Yorktown)', 0),
    onboard('p_tao_ames', 'NSIPS-Q-TAO-01'), onboard('p_tao_brandt', 'NSIPS-Q-TAO-02'), onboard('p_tao_cole', 'NSIPS-Q-TAO-03'),
    fact('p_tao_diaz', 'ready_at', D(-15, '0900'), t, 'NSIPS', 'NSIPS-Q-TAO-04', 'TAO qualification board D-15 0900'),
    onboard('p_fc1_martinez', 'NSIPS-FC-0117'), onboard('p_fc2_okafor', 'NSIPS-FC-0233'), onboard('p_fc2_lindqvist', 'NSIPS-FC-0251'),
    fact('in_gun_part', 'ready_at', D(-16, '1000'), t, 'R-SUPPLY', 'DOC N21706-6301-0077', 'Gun train drive amplifier: status BA, ETA D-16 1000'),
    onboard('p_gm1_reyes', 'NSIPS-GM-0102'), onboard('p_gm2_chen', 'NSIPS-GM-0188'),
    fact('in_helo_det', 'ready_at', D(-11, '1000'), t, 'HSM-SQDN', 'HSM-DET2-READY', 'Detachment ready to fly on D-11 1000'),
    fact('in_crash_salvage', 'ready_at', D(-13, '1600'), t, 'WATCHBILL', 'WB-CRASH-SALV', 'Crash & salvage team qualification'),
    fact('in_keymat', 'ready_at', D(-13, '1000'), t, 'CMS', 'CMS-DCS-4471', 'KEYMAT by DCS courier, ETA D-13 1000'),
    fact('in_ew_lib', 'ready_at', D(-6, '1200'), t, 'AMHS', 'MSG 031200Z NOV26 EWDF', 'EW mission data file release D-6 1200'),
  ];
}

/** The reports that arrive during the watch, grouped as they would land on a watch floor. */
export function atlasShieldEvents(): ScenarioEvent[] {
  return [
    {
      id: 'E01', t: D(-20, '1030'), kind: 'casrep', severity: 'crit', title: 'CASREP CAT 3: SPY-1D Array B transmitter',
      detail: 'Crossed-field amplifier (CFA) failure in the Array B transmitter group. Array B radiating at reduced power; BMD search volume degraded. Part on order, ETA not yet reported.',
      board: { system: 'SPY-1D ARRAY B', status: 'DOWN' },
      facts: [
        fact('sys_spy_b', 'outage', [[D(-20, '1030'), Infinity]], D(-20, '1030'), 'AMHS', 'CASREP 26-0412 INITIAL', 'CASREP CAT 3: SPY-1D Array B transmitter (CFA)'),
        fact('t_spy_repair', 'duration_h', 6, D(-20, '1030'), 'OMMS-NG', 'JCN 21706-S-0412', 'Repair estimate 6 h'),
        fact('in_cfa_eta', 'ready_at', null, D(-20, '1030'), 'OMMS-NG', 'CASREP 26-0412', 'CFA on order, ETA TBD'),
      ],
    },
    {
      id: 'E02', t: D(-20, '1400'), kind: 'supply', severity: 'info', title: 'R-Supply: CFA requisition status BA',
      detail: 'Document N21706-6312-0418 status BA (supply action taken). ETA Norfolk D-15 1200.',
      board: { system: 'CFA REQUISITION', status: 'CONSTRAINT' },
      facts: [fact('in_cfa_eta', 'ready_at', D(-15, '1200'), D(-20, '1400'), 'R-SUPPLY', 'DOC N21706-6312-0418', 'Status BA, ETA D-15 1200')],
    },
    {
      id: 'E03', t: D(-19, '0900'), kind: 'personnel', severity: 'warn', title: 'NSIPS: FC1 Martinez TAD orders',
      detail: 'FC1 Martinez to Aegis advanced school (Dam Neck) D-16 0800. Rejoins the ship at Rota. One of three SPY XMTR-qualified technicians.',
      board: { system: 'FC1 MARTINEZ', status: 'CONSTRAINT' },
      facts: [
        fact('p_fc1_martinez', 'person_unavailable', [[D(-16, '0800'), D(-5, '1200')]], D(-19, '0900'), 'NSIPS', 'TAD-26-1187', 'TAD (Aegis school), rejoins at Rota'),
        fact('p_fc1_martinez', 'uncertainty', { min: -12, mode: 0, max: 36 }, D(-19, '0900'), 'NSIPS', 'TAD-26-1187', 'rejoin date uncertainty'),
      ],
    },
    {
      id: 'E04', t: D(-18, '1100'), kind: 'casrep', severity: 'warn', title: 'CASREP CAT 2: SSGTG #2 high vibration',
      detail: "Ship service gas turbine generator #2 secured for high vibration. Ship's force repair, ETR D-10 1800. Electrical plant now 2 of 3.",
      board: { system: 'SSGTG #2', status: 'FAULT' },
      facts: [fact('sys_ssgtg_2', 'outage', [[D(-18, '1100'), D(-10, '1800')]], D(-18, '1100'), 'AMHS', 'CASREP 26-0419 INITIAL', 'CASREP CAT 2: SSGTG #2 high vibration, ETR D-10 1800')],
    },
    {
      id: 'E05', t: D(-17, '1600'), kind: 'supply', severity: 'crit', title: 'R-Supply: CFA ETA slips 2d 3h',
      detail: 'Vendor backorder. Document N21706-6312-0418 ETA Norfolk now D-12 1500, eight hours after the ship sails.',
      board: { system: 'CFA REQUISITION', status: 'CONSTRAINT' },
      facts: [
        fact('in_cfa_eta', 'ready_at', D(-12, '1500'), D(-17, '1600'), 'R-SUPPLY', 'DOC N21706-6312-0418', 'Status BB backorder, ETA D-12 1500'),
        // backorder ETAs are heavy-tailed: a further ~6-day slip misses Rota and leaves no delivery window
        fact('in_cfa_eta', 'uncertainty', { min: -12, mode: 6, max: 200 }, D(-17, '1600'), 'R-SUPPLY', 'DOC N21706-6312-0418', 'backorder ETA spread'),
      ],
    },
    {
      id: 'E06', t: D(-16, '0800'), kind: 'personnel', severity: 'warn', title: 'AMCROSS: FC2 Okafor emergency leave',
      detail: 'Emergency leave approved via American Red Cross message. Estimated rejoin at Rota D-4 0800.',
      board: { system: 'FC2 OKAFOR', status: 'CONSTRAINT' },
      facts: [
        fact('p_fc2_okafor', 'person_unavailable', [[D(-16, '0800'), D(-4, '0800')]], D(-16, '0800'), 'NSIPS', 'LV-26-0933', 'Emergency leave (AMCROSS 26-55120)'),
        fact('p_fc2_okafor', 'uncertainty', { min: -48, mode: 0, max: 120 }, D(-16, '0800'), 'NSIPS', 'LV-26-0933', 'rejoin date uncertainty'),
      ],
    },
    {
      id: 'E07', t: D(-15, '1100'), kind: 'quality', severity: 'warn', title: 'DLA tracking contradicts R-Supply ETA',
      detail: 'Transportation control number tracking shows the CFA arriving D-12 0900, six hours earlier than R-Supply. Sources disagree.',
      board: { system: 'CFA REQUISITION', status: 'DEGRADED' },
      facts: [fact('in_cfa_eta', 'ready_at', D(-12, '0900'), D(-15, '1100'), 'DLA-TRACK', 'TCN SW3211-6312-0418', 'DLA tracking ETA D-12 0900')],
    },
    {
      id: 'E08', t: D(-15, '1500'), kind: 'aviation', severity: 'warn', title: 'HSM: Det aircraft phase maintenance overrun',
      detail: 'MH-60R detachment ready D-11 1500 (was 1000). The fly-on window closes D-11 1700.',
      board: { system: 'MH-60R DET', status: 'DEGRADED' },
      facts: [fact('in_helo_det', 'ready_at', D(-11, '1500'), D(-15, '1500'), 'HSM-SQDN', 'HSM-DET2-READY', 'Detachment ready D-11 1500 (phase maintenance overrun)')],
    },
    {
      id: 'E09', t: D(-14, '0900'), kind: 'quality', severity: 'warn', title: 'NAVSEA withdraws CFA repair estimate',
      detail: 'Tech rep: repair duration TBD pending fault isolation on the waveguide. No estimate in OMMS-NG.',
      board: { system: 'SPY-1D ARRAY B', status: 'DOWN' },
      facts: [
        fact('t_spy_repair', 'duration_h', null, D(-14, '0900'), 'NAVSEA', 'TA-26-3381', 'Repair estimate withdrawn (TBD)'),
        fact('t_spy_repair', 'uncertainty', { min: -2, mode: 2, max: 30 }, D(-14, '0900'), 'NAVSEA', 'TA-26-3381', 'repair duration spread'),
      ],
    },
    {
      id: 'E10', t: D(-14, '1300'), kind: 'quality', severity: 'info', title: 'NSIPS record rejected: malformed date',
      detail: 'Qualification update for LTJG Diaz carried an invalid timestamp. Record quarantined; last good value retained.',
      board: { system: 'LTJG DIAZ', status: 'DEGRADED' },
      facts: [fact('p_tao_diaz', 'ready_at', '2026-11-31T25:00Z', D(-14, '1300'), 'NSIPS', 'Q-TAO-04-UPD', 'Qualification update (invalid timestamp)')],
    },
  ];
}

/* ---------------------------------------------------------------- display */

export const atlasShieldDisplay: MissionDisplay = {
  id: 'atlas-shield',
  short: 'DDG readiness · 21d',
  name: 'DDG Readiness, 21 Days to Tasking',
  tagline: 'Know before it breaks the mission',
  timeScale: 'days',
  dDay: DDAY,
  tzOffset: -5,
  ownShip: { id: SHIP, name: 'USS GRACE HOPPER', hull: 'DDG-170', cls: 'Arleigh Burke Flt III (synthetic)', homeport: 'Norfolk, VA' },
  mission: {
    name: 'OPERATION ATLAS SHIELD', area: 'Eastern Mediterranean', start: D(0, '0800'),
    summary: 'BMD patrol station EASTMED, then high-value-unit escort.', tasking: 'CTF-64 BMD patrol (Phase I) then HVU escort (Phase II)',
  },
  watchStart: WATCH_START,
  defaultFocus: 'c_amd',
  phases: [
    { id: 'ph_inport', name: 'IN PORT · MAINT & ONLOAD', start: 0, end: D(-12, '0700'), requires: [], location: 'Norfolk' },
    { id: 'ph_lant', name: 'TRANSIT LANT', start: D(-12, '0700'), end: ROTA_OPEN, requires: ['c_mob'], location: 'Atlantic' },
    { id: 'ph_rota', name: 'ROTA LOG STOP', start: ROTA_OPEN, end: ROTA_CLOSE, requires: ['c_mob'], location: 'Rota' },
    { id: 'ph_med', name: 'GIBRALTAR · TRANSIT MED', start: ROTA_CLOSE, end: D(0, '0800'), requires: ['c_mob', 'c_asw', 'c_suw'], location: 'Med' },
    { id: 'ph_bmd', name: 'PHASE I · BMD PATROL', start: D(0, '0800'), end: D(6, '0800'), requires: ['c_amd', 'c_c5i', 'c_ew', 'c_suw'], location: 'EASTMED' },
    { id: 'ph_esc', name: 'PHASE II · HVU ESCORT', start: D(6, '0800'), end: D(8, '0000'), requires: ['c_amd', 'c_asw', 'c_suw'], location: 'EASTMED' },
  ],
  places: {
    norfolk: { name: 'NS Norfolk', lon: -76.33, lat: 36.95, kind: 'port' },
    yorktown: { name: 'NWS Yorktown', lon: -76.53, lat: 37.24, kind: 'port' },
    rota: { name: 'NAVSTA Rota', lon: -6.35, lat: 36.62, kind: 'port' },
    souda: { name: 'NSA Souda Bay', lon: 24.12, lat: 35.49, kind: 'port' },
    sigonella: { name: 'NAS Sigonella', lon: 14.92, lat: 37.4, kind: 'port' },
    susquehanna: { name: 'DLA Distribution Susquehanna', lon: -76.87, lat: 40.23 },
    damneck: { name: 'Dam Neck (Aegis school)', lon: -75.97, lat: 36.8 },
    atlanta: { name: 'Home of record (synthetic)', lon: -84.39, lat: 33.75 },
    chambers: { name: 'NAS Norfolk (HSM det)', lon: -76.29, lat: 36.94 },
    vacapes: { name: 'VACAPES fly-on point', lon: -73.6, lat: 36.7 },
    clf: { name: 'CLF rendezvous (VERTREP)', lon: -43.0, lat: 38.3 },
    dcs: { name: 'DCS Norfolk courier', lon: -76.2, lat: 36.88 },
    niocn: { name: 'NIOC Norfolk (EW data)', lon: -76.15, lat: 36.92 },
  },
  legs: [
    { id: 'leg_cfa', label: 'CFA replacement', kind: 'part', nodeId: 'g_cfa', from: 'susquehanna', to: 'norfolk', bySlot: { norfolk: 'norfolk', rota: 'rota', vertrep: 'clf' } },
    { id: 'leg_martinez', label: 'FC1 Martinez rejoin', kind: 'person', nodeId: 'p_fc1_martinez', from: 'damneck', to: 'rota' },
    { id: 'leg_okafor', label: 'FC2 Okafor rejoin', kind: 'person', nodeId: 'p_fc2_okafor', from: 'atlanta', to: 'rota' },
    { id: 'leg_helo', label: 'MH-60R detachment', kind: 'aircraft', nodeId: 'g_helo', from: 'chambers', to: 'vacapes', bySlot: { flyon: 'vacapes', flyon2: 'vacapes', rota: 'rota' } },
    { id: 'leg_keymat', label: 'Mission KEYMAT', kind: 'part', nodeId: 'g_keymat', from: 'dcs', to: 'norfolk', bySlot: { norfolk: 'norfolk', rota: 'rota' } },
    { id: 'leg_ewdf', label: 'EW mission data file', kind: 'data', nodeId: 'in_ew_lib', from: 'niocn', to: 'ship' },
  ],
  missionArea: { name: 'BMD STATION · EASTMED', lon: 25.5, lat: 34.2, radiusKm: 160 },
  mapView: { longitude: -28, latitude: 36, zoom: 2.6 },
  tracks: {
    [SHIP]: [
      { t: 0, lon: -76.33, lat: 36.95, label: 'NS Norfolk' },
      { t: D(-12, '0700'), lon: -76.33, lat: 36.95, label: 'Underway' },
      { t: D(-12, '1000'), lon: -75.95, lat: 36.92 },
      { t: D(-11, '1200'), lon: -73.6, lat: 36.7, label: 'VACAPES fly-on' },
      { t: D(-10, '0000'), lon: -70.2, lat: 36.9 },
      { t: D(-9, '0000'), lon: -62.5, lat: 37.4 },
      { t: D(-8, '0000'), lon: -54.5, lat: 38.0 },
      { t: D(-7, '1200'), lon: -43.0, lat: 38.3, label: 'CLF rendezvous' },
      { t: D(-6, '1200'), lon: -30.0, lat: 37.9, label: 'Azores' },
      { t: D(-5, '0000'), lon: -16.0, lat: 37.0 },
      { t: ROTA_OPEN, lon: -6.35, lat: 36.62, label: 'NAVSTA Rota' },
      { t: ROTA_CLOSE, lon: -6.35, lat: 36.62 },
      { t: D(-4, '1800'), lon: -5.45, lat: 35.95, label: 'Strait of Gibraltar' },
      { t: D(-3, '1200'), lon: 1.5, lat: 37.0 },
      { t: D(-2, '0600'), lon: 9.5, lat: 37.9 },
      { t: D(-1, '0600'), lon: 15.5, lat: 35.8 },
      { t: D(0, '0800'), lon: 25.5, lat: 34.2, label: 'BMD station' },
      { t: D(8, '0000'), lon: 27.5, lat: 33.6 },
    ],
  },
  ships: [{ id: SHIP, name: 'USS GRACE HOPPER', hull: 'DDG-170', cls: 'DDG-51', group: 'CTF-64' }],
};
