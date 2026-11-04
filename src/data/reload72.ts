import type { NodeDef, Scenario, SourceRef } from '@/engine/types';

/** D(-2, '0800') -> scenario hours. Epoch is D-3 0000 ship's time (EET). */
const DDAY = 3;
export const R = (d: number, hhmm: string) => (DDAY + d) * 24 + Number(hhmm.slice(0, 2)) + Number(hhmm.slice(2)) / 60;

const src = (system: SourceRef['system'], recordId: string, asOf: number, value?: string, note?: string): SourceRef => ({ system, recordId, asOf, value, note });

const sys = (id: string, label: string, part: NodeDef['part'], domain: NodeDef['domain'], recordId: string): NodeDef => ({
  id, kind: 'input', label, part, domain, value: 0, sources: [src('DRRS-N', recordId, 0, 'UP')],
});

const person = (id: string, label: string, rate: string, qual: string, recordId: string, extra: Partial<NodeDef> = {}): NodeDef => ({
  id, kind: 'person', label, rate, qual, domain: 'personnel', part: 'crew', value: 0,
  sources: [src('NSIPS', recordId, 0, 'ONBOARD')], ...extra,
});

const SAIL = R(-1, '2200');
const ON_STATION = R(0, '0600');
const FAR = 24 * 30;

const nodes: NodeDef[] = [
  /* ---------------- MOB ---------------- */
  sys('sys_gtm_1', 'GTM 1A (LM2500)', 'gtm', 'maintenance', 'MOB-GTM-1A'),
  sys('sys_gtm_2', 'GTM 1B (LM2500)', 'gtm', 'maintenance', 'MOB-GTM-1B'),
  sys('sys_gtm_3', 'GTM 2A (LM2500)', 'gtm', 'maintenance', 'MOB-GTM-2A'),
  sys('sys_gtm_4', 'GTM 2B (LM2500)', 'gtm', 'maintenance', 'MOB-GTM-2B'),
  { id: 'k_gtm', kind: 'kofn', k: 3, label: 'Main propulsion (3 of 4 GTMs)', domain: 'maintenance', part: 'gtm', deps: ['sys_gtm_1', 'sys_gtm_2', 'sys_gtm_3', 'sys_gtm_4'] },
  sys('sys_steering', 'Steering gear', 'steering', 'maintenance', 'MOB-STR-1'),
  sys('sys_navradar', 'Navigation radar (SPS-73)', 'nav', 'maintenance', 'MOB-NAV-1'),
  {
    id: 'in_fuel_barge', kind: 'input', label: 'F-76 fuel barge alongside (NSA Souda)', domain: 'logistics', part: 'gtm', value: R(-2, '0600'),
    uncertainty: { min: -2, mode: 0, max: 10 }, sources: [src('NAVFAC', 'SOUDA-POL-1103', 6, 'Alongside D-2 0600')],
  },
  {
    id: 't_bunker', kind: 'task', label: 'Refuel to 95%', domain: 'logistics', part: 'gtm', deps: ['in_fuel_barge'], duration: 6,
    uncertainty: { min: -1, mode: 0, max: 3 }, sources: [src('SKED', 'FUEL-26-1103', 6, '6h')],
  },
  {
    id: 'c_mob', kind: 'capability', code: 'MOB', label: 'Mobility', domain: 'capability', part: 'gtm', qMargin: 12,
    deps: ['k_gtm', 'sys_steering', 'sys_navradar', 't_bunker'], requiredBy: SAIL,
  },

  /* ---------------- AMD ---------------- */
  sys('sys_spy_a', 'SPY-1D Array A (FWD/STBD)', 'spy_a', 'maintenance', 'AMD-SPY-A'),
  sys('sys_spy_b', 'SPY-1D Array B (AFT/STBD)', 'spy_b', 'maintenance', 'AMD-SPY-B'),
  sys('sys_spy_c', 'SPY-1D Array C (AFT/PORT)', 'spy_c', 'maintenance', 'AMD-SPY-C'),
  sys('sys_spy_d', 'SPY-1D Array D (FWD/PORT)', 'spy_d', 'maintenance', 'AMD-SPY-D'),
  sys('sys_aegis', 'Aegis Weapon System (ORTS)', 'aegis', 'maintenance', 'AMD-AWS-BL9'),
  {
    id: 'in_ord_c17', kind: 'input', label: 'SM-6 / SM-2 canisters: C-17 lands Souda AB', domain: 'logistics', part: 'vls', value: R(-2, '1000'),
    uncertainty: { min: -2, mode: 0, max: 20 }, sources: [src('AMC', 'MSN JALIS 6E1103', 6, 'Land D-2 1000')],
  },
  {
    id: 'g_ammo_pier', kind: 'gate', label: 'Ordnance alongside at Marathi ammo pier', domain: 'logistics', part: 'vls', deps: ['in_ord_c17'],
    windows: [
      { id: 'slotA', label: 'Marathi berth slot A', start: R(-2, '0600'), end: R(-2, '2000'), lag: 3 },
      { id: 'slotB', label: 'Marathi berth slot B', start: R(-1, '0600'), end: R(-1, '1400'), lag: 3 },
      { id: 'conrep', label: 'CONREP from T-AKE (D-1 2300)', start: R(-1, '2300'), end: R(0, '0300'), lag: 30, enabled: false, authority: 'CTF-63 CLF scheduling' },
    ],
  },
  {
    id: 'in_crane_cert', kind: 'input', label: 'Pier crane load-test certificate', domain: 'logistics', part: 'vls', value: R(-2, '0900'),
    uncertainty: { min: -1, mode: 0, max: 6 }, sources: [src('NAVFAC', 'CRANE-MAR-07', 6, 'Retest D-2 0900')],
  },
  person('p_gm2_baker', 'GM2 T. Baker', 'GM2', 'Mk 41 strikedown handler', 'NSIPS-GM-0311'),
  person('p_gm2_nakamura', 'GM2 R. Nakamura', 'GM2', 'Mk 41 strikedown handler', 'NSIPS-GM-0342'),
  person('p_gm3_ellis', 'GM3 J. Ellis', 'GM3', 'Mk 41 strikedown handler', 'NSIPS-GM-0407'),
  person('p_gm3_frost', 'GM3 K. Frost', 'GM3', 'Mk 41 strikedown handler', 'NSIPS-GM-0419'),
  person('p_gmsn_young', 'GMSN A. Young', 'GMSN', 'Mk 41 strikedown handler', 'NSIPS-GM-0502'),
  { id: 'k_handlers', kind: 'kofn', k: 4, label: 'Strikedown team (4 handlers)', domain: 'personnel', part: 'crew', deps: ['p_gm2_baker', 'p_gm2_nakamura', 'p_gm3_ellis', 'p_gm3_frost', 'p_gmsn_young'] },
  person('p_gmc_horvat', 'GMC P. Horvat', 'GMC', 'Ordnance handling supervisor (certified)', 'NSIPS-GM-0101'),
  person('p_gm1_ortiz', 'GM1 L. Ortiz (OHS u/i)', 'GM1', 'Ordnance handling supervisor (board D-1 1600)', 'NSIPS-GM-0177', { value: R(-1, '1600') }),
  {
    id: 't_strikedown', kind: 'task', label: 'VLS strikedown: 10 canisters', domain: 'ordnance', part: 'vls', deps: ['g_ammo_pier', 'in_crane_cert', 'k_handlers'], duration: 10,
    uncertainty: { min: -2, mode: 0, max: 6 }, crew: { pool: ['p_gmc_horvat', 'p_gm1_ortiz'], k: 1, label: 'Certified ordnance handling supervisor' },
    sources: [src('SKED', 'ORD-ONLOAD-6E', 6, '10h (1h per canister)')],
  },
  {
    id: 't_wsat', kind: 'task', label: 'Load verification & WSAT', domain: 'maintenance', part: 'vls', deps: ['t_strikedown'], duration: 4,
    uncertainty: { min: -1, mode: 0, max: 4 }, sources: [src('OMMS-NG', 'MRC VLS-41-R03', 6, '4h')],
  },
  {
    id: 'sys_vls', kind: 'all', label: 'Mk 41 VLS (10 cells empty)', domain: 'maintenance', part: 'vls', deps: ['t_wsat'],
    sources: [src('DRRS-N', 'AMD-VLS-41', 6, '10 cells expended')],
  },
  {
    id: 'c_amd', kind: 'capability', code: 'AMD', label: 'Air & Missile Defense (BMD)', domain: 'capability', part: 'aegis', qMargin: 12,
    deps: ['sys_spy_a', 'sys_spy_b', 'sys_spy_c', 'sys_spy_d', 'sys_aegis', 'sys_vls'], requiredBy: SAIL,
  },

  /* ---------------- SUW ---------------- */
  sys('sys_gun', '5"/54 Mk 45 gun', 'gun', 'maintenance', 'SUW-GUN'),
  sys('sys_spq9', 'SPQ-9B horizon radar', 'spq9', 'maintenance', 'SUW-SPQ9'),
  sys('sys_ciws_1', 'CIWS mount 1', 'ciws', 'maintenance', 'SUW-CIWS-1'),
  {
    id: 'in_ciws_part', kind: 'input', label: 'CIWS mount 2: servo amplifier (R-Supply)', domain: 'logistics', part: 'ciws', value: R(-2, '1800'),
    uncertainty: { min: -4, mode: 0, max: 24 }, sources: [src('R-SUPPLY', 'DOC N21717-6307-0021', 6, 'ETA D-2 1800')],
  },
  {
    id: 't_ciws_repair', kind: 'task', label: 'CIWS mount 2 repair + PACFIRE', domain: 'maintenance', part: 'ciws', deps: ['in_ciws_part'], duration: 8,
    uncertainty: { min: -2, mode: 0, max: 6 }, sources: [src('OMMS-NG', 'JCN 21717-C-0221', 6, '8h')],
  },
  { id: 'sys_ciws_2', kind: 'all', label: 'CIWS mount 2', domain: 'maintenance', part: 'ciws', deps: ['t_ciws_repair'] },
  { id: 'k_ciws', kind: 'kofn', k: 1, label: 'Close-in defense (1 of 2 CIWS)', domain: 'maintenance', part: 'ciws', deps: ['sys_ciws_1', 'sys_ciws_2'] },
  {
    id: 'c_suw', kind: 'capability', code: 'SUW', label: 'Surface Warfare', domain: 'capability', part: 'gun',
    deps: ['sys_gun', 'sys_spq9', 'k_ciws'], requiredBy: ON_STATION,
  },

  /* ---------------- C5I ---------------- */
  sys('sys_link16', 'Link 16 terminal', 'link16', 'comms', 'C5I-L16'),
  sys('sys_satcom', 'SATCOM (CBSP / MUOS)', 'satcom', 'comms', 'C5I-SAT'),
  {
    id: 'in_keymat', kind: 'input', label: 'Link 16 rekey KEYMAT (DCS Naples)', domain: 'comms', part: 'satcom', value: R(-2, '1200'),
    uncertainty: { min: -4, mode: 0, max: 18 }, sources: [src('CMS', 'CMS-DCS-NAP-0907', 6, 'ETA D-2 1200')],
  },
  { id: 't_rekey', kind: 'task', label: 'Rekey & verify Link 16', domain: 'comms', part: 'link16', deps: ['in_keymat'], duration: 2 },
  {
    id: 'in_esd', kind: 'input', label: 'BMD engagement-support data (C6F release)', domain: 'comms', part: 'aegis', value: R(-1, '1200'),
    uncertainty: { min: -6, mode: 2, max: 30 }, sources: [src('AMHS', 'MSG 031000Z NOV26 C6F ESD', 6, 'Release D-1 1200')],
  },
  {
    id: 'c_c5i', kind: 'capability', code: 'C5I', label: 'Command, Control & Comms', domain: 'capability', part: 'satcom', qMargin: 12,
    deps: ['sys_link16', 'sys_satcom', 't_rekey', 'in_esd'], requiredBy: ON_STATION,
  },
];

export const reload72: Scenario = {
  id: 'reload72',
  name: 'VLS Reload, 72 Hours to Station',
  tagline: 'Same engine, different workflow',
  timeScale: 'days',
  dDay: DDAY,
  epochUtc: Date.UTC(2026, 10, 2, 22, 0, 0),
  tzOffset: 2,
  ship: { name: 'USS MARY G. ROSS', hull: 'DDG-173', cls: 'Arleigh Burke Flt IIA (synthetic)', homeport: 'Rota, Spain' },
  mission: {
    name: 'OPERATION ATLAS SHIELD',
    area: 'Eastern Mediterranean',
    start: ON_STATION,
    summary: 'Ten VLS cells expended on station. Reload at Souda Bay and be back on BMD station D-0 0600.',
    tasking: 'Reload at NSA Souda, sail D-1 2200, resume CTF-64 BMD station D-0 0600',
  },
  watchStart: R(-3, '0600'),
  horizon: [0, R(2, '0000')],
  thresholds: { qMargin: 12, cliff: 6 },
  phases: [
    { id: 'ph_rtb', name: 'RELIEVED · TRANSIT TO SOUDA', start: 0, end: R(-3, '1800'), requires: [], location: 'EASTMED' },
    { id: 'ph_pier', name: 'SOUDA · ORDNANCE & FUEL', start: R(-3, '1800'), end: SAIL, requires: [], location: 'NSA Souda' },
    { id: 'ph_transit', name: 'TRANSIT TO STATION', start: SAIL, end: ON_STATION, requires: ['c_mob', 'c_amd'], location: 'Crete' },
    { id: 'ph_station', name: 'BMD STATION · RESUMED', start: ON_STATION, end: R(2, '0000'), requires: ['c_amd', 'c_c5i', 'c_suw'], location: 'EASTMED' },
  ],
  nodes,
  events: [
    {
      id: 'R00', t: R(-3, '0600'), kind: 'baseline', severity: 'info',
      title: 'Reload plan ingested',
      detail: 'Ten cells expended on station (6 SM-6, 4 SM-2). AMC airlift, Marathi berth slots, NAVFAC crane, NSIPS and SKED reconciled. 44 records, 0 rejected.',
      source: src('NAVIFI', 'INGEST-R001', R(-3, '0600')), patches: [],
    },
    {
      id: 'R01', t: R(-3, '1100'), kind: 'supply', severity: 'crit',
      title: 'AMC: C-17 delayed 12h at Ramstein',
      detail: 'Aircraft maintenance hold. Canisters now land Souda AB D-2 2200, after Marathi berth slot A closes. Next slot opens D-1 0600.',
      source: src('AMC', 'MSN JALIS 6E1103', R(-3, '1100')),
      patches: [{ op: 'set', id: 'in_ord_c17', fields: { value: R(-2, '2200'), sources: [src('AMC', 'MSN JALIS 6E1103', R(-3, '1100'), 'Land D-2 2200', 'MX hold Ramstein')] } }],
    },
    {
      id: 'R02', t: R(-3, '1500'), kind: 'personnel', severity: 'crit',
      title: 'MRRS: GMC Horvat on light duty',
      detail: 'Medical light duty until D-1 1000. GMC Horvat is the only certified ordnance handling supervisor aboard; GM1 Ortiz boards D-1 1600.',
      source: src('MRRS', 'MRRS-26-4410', R(-3, '1500')),
      patches: [
        {
          op: 'set', id: 'p_gmc_horvat', fields: {
            unavailable: [{ start: R(-3, '1500'), end: R(-1, '1000'), reason: 'Medical light duty' }],
            uncertainty: { min: -6, mode: 0, max: 18 },
            sources: [src('MRRS', 'MRRS-26-4410', R(-3, '1500'), 'Light duty to D-1 1000')],
          },
        },
      ],
    },
    {
      id: 'R03', t: R(-3, '1900'), kind: 'quality', severity: 'warn',
      title: 'DLA tracking contradicts AMC landing time',
      detail: 'DLA tracking shows the canisters landing D-2 2300, an hour later than AMC. Sources disagree; engine uses the later time.',
      source: src('DLA-TRACK', 'TCN FB4417-6E-1103', R(-3, '1900')),
      patches: [{ op: 'set', id: 'in_ord_c17', fields: { conflict: { source: src('DLA-TRACK', 'TCN FB4417-6E-1103', R(-3, '1900'), 'Land D-2 2300'), value: R(-2, '2300') } } }],
    },
    {
      id: 'R04', t: R(-3, '2100'), kind: 'quality', severity: 'warn',
      title: 'Fuel barge schedule withdrawn',
      detail: 'NSA Souda port ops pulled the barge schedule pending a pier reassignment. No time in the record.',
      source: src('NAVFAC', 'SOUDA-POL-1103', R(-3, '2100')),
      patches: [{ op: 'set', id: 'in_fuel_barge', fields: { value: null, assumed: R(-2, '1800'), sources: [src('NAVFAC', 'SOUDA-POL-1103', R(-3, '2100'), 'TBD')] } }],
    },
  ],
  levers: [
    {
      id: 'X_XDECK', category: 'crew', title: 'Cross-deck certified OHS from CG-176',
      detail: 'CG-176, also at Souda, lends its certified ordnance handling supervisor until it sails D-1 1600.',
      authority: 'CTF-64 / DESRON (off-ship)', withinShipAuthority: false, deadline: R(-2, '1800'), cost: 'low',
      risk: 'Lending ship must finish its own onload first', requiresNodes: ['t_strikedown'],
      patches: [
        { op: 'add', node: { id: 'p_xdeck_ohs', kind: 'person', label: 'GMC D. Ruiz (CG-176)', rate: 'GMC', qual: 'Ordnance handling supervisor', domain: 'personnel', part: 'crew', value: R(-2, '0600'), unavailable: [{ start: R(-1, '1600'), end: FAR, reason: 'CG-176 sails' }], sources: [src('NAVIFI', 'PROPOSED-XDECK-OHS', 0, 'proposed')] } },
        { op: 'addCrew', id: 't_strikedown', persons: ['p_xdeck_ohs'] },
      ],
    },
    {
      id: 'X_CHANIA', category: 'expedite', title: 'Divert ordnance to commercial charter via Chania',
      detail: 'Book a charter for the canisters; lands Souda AB D-2 1600, inside berth slot A.',
      authority: 'Supply Officer request, CO approval', withinShipAuthority: true, deadline: R(-3, '2300'), cost: 'high',
      risk: 'Hazmat charter approval MEDIUM', requiresNodes: ['in_ord_c17'],
      patches: [{ op: 'set', id: 'in_ord_c17', fields: { value: R(-2, '1600'), conflict: undefined, sources: [src('NAVIFI', 'PROPOSED-CHARTER', 0, 'Land D-2 1600 (proposed)')] } }],
    },
    {
      id: 'X_WSAT', category: 'resequence', title: 'Verify cells as they load (WSAT 1h 30m after last)',
      detail: 'Run load verification per canister during strikedown with ISEA concurrence.',
      authority: 'Weapons Officer + ISEA concurrence', withinShipAuthority: true, deadline: R(-1, '1200'), cost: 'low',
      risk: 'Higher retest probability', requiresNodes: ['t_wsat'],
      patches: [{ op: 'set', id: 't_wsat', fields: { duration: 1.5 } }],
    },
    {
      id: 'X_CONREP', category: 'logistics', title: 'Book CONREP from T-AKE as fallback',
      detail: 'Hold a D-1 2300 CONREP slot so a further airlift slip still has a delivery path.',
      authority: 'CTF-63 (off-ship)', withinShipAuthority: false, deadline: R(-2, '1200'), cost: 'med',
      risk: 'Sea state dependent; arrives after sail', requiresNodes: ['g_ammo_pier'],
      patches: [{ op: 'window', id: 'g_ammo_pier', windowId: 'conrep', fields: { enabled: true } }],
    },
    {
      id: 'X_DELAY', category: 'schedule', title: 'Request 6h sail delay',
      detail: 'Sail D-0 0400 and make up two hours on transit; on station D-0 1000.',
      authority: 'CTF-64 (off-ship)', withinShipAuthority: false, deadline: R(-1, '1200'), cost: 'high',
      risk: 'Four-hour BMD station gap', requiresNodes: ['c_amd'],
      patches: [
        { op: 'set', id: 'c_amd', fields: { requiredBy: SAIL + 6 } },
        { op: 'set', id: 'c_mob', fields: { requiredBy: SAIL + 6 } },
      ],
    },
    {
      id: 'X_PARTIAL', category: 'accept', title: 'Sail with 6 SM-6 loaded, SM-2 cells empty',
      detail: 'Strike down the six SM-6 only (6h). Report reduced magazine depth.',
      authority: 'Commanding Officer (report to CTF-64)', withinShipAuthority: true, cost: 'low',
      risk: 'Reduced magazine depth', requiresNodes: ['t_strikedown'],
      patches: [
        { op: 'set', id: 't_strikedown', fields: { duration: 6, label: 'VLS strikedown: 6 SM-6' } },
        { op: 'set', id: 'c_amd', fields: { degraded: 'SM-2 cells empty, reduced magazine depth' } },
      ],
    },
  ],
  ports: [
    { id: 'souda', name: 'NSA Souda Bay', lon: 24.12, lat: 35.49 },
    { id: 'sigonella', name: 'NAS Sigonella', lon: 14.92, lat: 37.4 },
    { id: 'naples', name: 'NSA Naples', lon: 14.27, lat: 40.84 },
    { id: 'rota', name: 'NAVSTA Rota', lon: -6.35, lat: 36.62 },
  ],
  places: {
    souda: { name: 'NSA Souda Bay', lon: 24.12, lat: 35.49 },
    marathi: { name: 'Marathi NATO ammo pier', lon: 24.19, lat: 35.5 },
    soudaab: { name: 'Souda AB (Chania)', lon: 24.15, lat: 35.53 },
    ramstein: { name: 'Ramstein AB', lon: 7.6, lat: 49.44 },
    sigonella: { name: 'NAS Sigonella', lon: 14.92, lat: 37.4 },
    naples: { name: 'DCS Naples', lon: 14.27, lat: 40.84 },
    c6f: { name: 'C6F Naples (ESD release)', lon: 14.3, lat: 40.86 },
    take: { name: 'T-AKE CONREP point', lon: 25.1, lat: 34.9 },
  },
  legs: [
    { id: 'leg_ord', label: 'SM-6 / SM-2 canisters', kind: 'aircraft', nodeId: 'g_ammo_pier', from: 'ramstein', to: 'marathi', gateId: 'g_ammo_pier', byWindow: { slotA: 'marathi', slotB: 'marathi', conrep: 'take' } },
    { id: 'leg_ciws', label: 'CIWS servo amplifier', kind: 'part', nodeId: 'in_ciws_part', from: 'sigonella', to: 'souda' },
    { id: 'leg_keymat', label: 'Link 16 KEYMAT', kind: 'part', nodeId: 'in_keymat', from: 'naples', to: 'souda' },
    { id: 'leg_esd', label: 'BMD engagement-support data', kind: 'data', nodeId: 'in_esd', from: 'c6f', to: 'ship' },
  ],
  missionArea: { name: 'BMD STATION · EASTMED', lon: 25.5, lat: 34.2, radiusKm: 160 },
  mapView: { longitude: 16.2, latitude: 38.6, zoom: 4.45 },
  track: [
    { t: 0, lon: 25.6, lat: 34.1, label: 'BMD station' },
    { t: R(-3, '1100'), lon: 25.4, lat: 34.25, label: 'Relieved' },
    { t: R(-3, '1600'), lon: 24.5, lat: 35.55 },
    { t: R(-3, '1800'), lon: 24.12, lat: 35.49, label: 'NSA Souda Bay' },
    { t: SAIL, lon: 24.12, lat: 35.49 },
    { t: SAIL + 1, lon: 24.4, lat: 35.6, label: 'Underway' },
    { t: SAIL + 4, lon: 25.2, lat: 35.3 },
    { t: ON_STATION, lon: 25.5, lat: 34.2, label: 'BMD station' },
    { t: R(2, '0000'), lon: 25.7, lat: 34.0 },
  ],
};
