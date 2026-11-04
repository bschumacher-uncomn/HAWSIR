import type { NodeDef, Scenario, SourceRef } from '@/engine/types';

/** D(-12, '0700') -> scenario hours. Epoch is D-21 0000 ship's time. */
const DDAY = 21;
export const D = (d: number, hhmm: string) => (DDAY + d) * 24 + Number(hhmm.slice(0, 2)) + Number(hhmm.slice(2)) / 60;

const src = (system: SourceRef['system'], recordId: string, asOf: number, value?: string, note?: string): SourceRef => ({ system, recordId, asOf, value, note });

const sys = (id: string, label: string, part: NodeDef['part'], domain: NodeDef['domain'], recordId: string, detail?: string): NodeDef => ({
  id, kind: 'input', label, part, domain, value: 0, detail,
  sources: [src('DRRS-N', recordId, 0, 'UP')],
});

const person = (id: string, label: string, rate: string, qual: string, recordId: string, extra: Partial<NodeDef> = {}): NodeDef => ({
  id, kind: 'person', label, rate, qual, domain: 'personnel', part: 'crew', value: 0,
  sources: [src('NSIPS', recordId, 0, 'ONBOARD')], ...extra,
});

const NORFOLK_CLOSE = D(-12, '0600');
const ROTA_OPEN = D(-5, '0800');
const ROTA_CLOSE = D(-4, '1200');
const FAR = 24 * 60;

const nodes: NodeDef[] = [
  /* ---------------- MOB ---------------- */
  sys('sys_gtm_1', 'GTM 1A (LM2500)', 'gtm', 'maintenance', 'MOB-GTM-1A'),
  sys('sys_gtm_2', 'GTM 1B (LM2500)', 'gtm', 'maintenance', 'MOB-GTM-1B'),
  sys('sys_gtm_3', 'GTM 2A (LM2500)', 'gtm', 'maintenance', 'MOB-GTM-2A'),
  sys('sys_gtm_4', 'GTM 2B (LM2500)', 'gtm', 'maintenance', 'MOB-GTM-2B'),
  { id: 'k_gtm', kind: 'kofn', k: 3, label: 'Main propulsion (3 of 4 GTMs)', domain: 'maintenance', part: 'gtm', deps: ['sys_gtm_1', 'sys_gtm_2', 'sys_gtm_3', 'sys_gtm_4'] },
  sys('sys_ssgtg_1', 'SSGTG #1', 'ssgtg', 'maintenance', 'MOB-SSGTG-1'),
  sys('sys_ssgtg_2', 'SSGTG #2', 'ssgtg', 'maintenance', 'MOB-SSGTG-2'),
  sys('sys_ssgtg_3', 'SSGTG #3', 'ssgtg', 'maintenance', 'MOB-SSGTG-3'),
  { id: 'k_ssgtg', kind: 'kofn', k: 2, label: 'Electrical plant (2 of 3 SSGTGs)', domain: 'maintenance', part: 'ssgtg', deps: ['sys_ssgtg_1', 'sys_ssgtg_2', 'sys_ssgtg_3'] },
  sys('sys_steering', 'Steering gear', 'steering', 'maintenance', 'MOB-STR-1'),
  sys('sys_navradar', 'Navigation radar (SPS-73)', 'nav', 'maintenance', 'MOB-NAV-1'),
  {
    id: 'in_seaanchor', kind: 'input', label: 'Sea & Anchor detail qualified', domain: 'personnel', part: 'crew', value: D(-14, '1200'),
    uncertainty: { min: -6, mode: 0, max: 18 }, sources: [src('WATCHBILL', 'WB-SEA-ANCHOR-26', 8, 'D-14 1200')],
  },
  {
    id: 'c_mob', kind: 'capability', code: 'MOB', label: 'Mobility', domain: 'capability', part: 'gtm', qMargin: 24,
    deps: ['k_gtm', 'k_ssgtg', 'sys_steering', 'sys_navradar', 'in_seaanchor'], requiredBy: D(-12, '0700'),
  },

  /* ---------------- AMD ---------------- */
  sys('sys_spy_a', 'SPY-1D Array A (FWD/STBD)', 'spy_a', 'maintenance', 'AMD-SPY-A'),
  sys('sys_spy_b', 'SPY-1D Array B (AFT/STBD)', 'spy_b', 'maintenance', 'AMD-SPY-B'),
  sys('sys_spy_c', 'SPY-1D Array C (AFT/PORT)', 'spy_c', 'maintenance', 'AMD-SPY-C'),
  sys('sys_spy_d', 'SPY-1D Array D (FWD/PORT)', 'spy_d', 'maintenance', 'AMD-SPY-D'),
  sys('sys_aegis', 'Aegis Weapon System (ORTS)', 'aegis', 'maintenance', 'AMD-AWS-BL9'),
  sys('sys_vls', 'Mk 41 VLS', 'vls', 'maintenance', 'AMD-VLS-41'),
  {
    id: 'in_ordnance', kind: 'input', label: 'SM-2 / SM-6 load-out verified', domain: 'ordnance', part: 'vls', value: 0,
    sources: [src('SKED', 'ORD-LOADOUT-1142', 0, 'Verified (NWS Yorktown)')],
  },
  person('p_tao_ames', 'LCDR K. Ames (TAO)', 'O-4', 'TAO / BMD', 'NSIPS-Q-TAO-01'),
  person('p_tao_brandt', 'LT S. Brandt (TAO)', 'O-3', 'TAO / BMD', 'NSIPS-Q-TAO-02'),
  person('p_tao_cole', 'LT J. Cole (TAO)', 'O-3', 'TAO / BMD', 'NSIPS-Q-TAO-03'),
  person('p_tao_diaz', 'LTJG M. Diaz (TAO u/i)', 'O-2', 'TAO / BMD (board pending)', 'NSIPS-Q-TAO-04', { value: D(-15, '0900') }),
  { id: 'k_amd_watch', kind: 'kofn', k: 3, label: 'BMD watch team (3 qualified TAOs)', domain: 'personnel', part: 'crew', deps: ['p_tao_ames', 'p_tao_brandt', 'p_tao_cole', 'p_tao_diaz'] },
  person('p_fc1_martinez', 'FC1 R. Martinez', 'FC1', 'SPY transmitter (XMTR) qualified', 'NSIPS-FC-0117'),
  person('p_fc2_okafor', 'FC2 D. Okafor', 'FC2', 'SPY transmitter (XMTR) qualified', 'NSIPS-FC-0233'),
  person('p_fc2_lindqvist', 'FC2 A. Lindqvist', 'FC2', 'SPY transmitter (XMTR) qualified', 'NSIPS-FC-0251'),
  {
    id: 'c_amd', kind: 'capability', code: 'AMD', label: 'Air & Missile Defense (BMD)', domain: 'capability', part: 'aegis',
    deps: ['sys_spy_a', 'sys_spy_b', 'sys_spy_c', 'sys_spy_d', 'sys_aegis', 'sys_vls', 'in_ordnance', 'k_amd_watch'], requiredBy: D(0, '0800'),
  },

  /* ---------------- SUW ---------------- */
  sys('sys_ciws', 'CIWS Mk 15 (x2)', 'ciws', 'maintenance', 'SUW-CIWS'),
  sys('sys_ssm', 'Surface strike missiles', 'ssm', 'maintenance', 'SUW-SSM'),
  sys('sys_spq9', 'SPQ-9B horizon radar', 'spq9', 'maintenance', 'SUW-SPQ9'),
  {
    id: 'in_gun_part', kind: 'input', label: '5"/62 gun: train drive amplifier (R-Supply)', domain: 'logistics', part: 'gun', value: D(-16, '1000'),
    uncertainty: { min: -12, mode: 0, max: 36 }, staleAfter: 96,
    sources: [src('R-SUPPLY', 'DOC N21706-6301-0077', 8, 'ETA D-16 1000', 'Status BA')],
  },
  person('p_gm1_reyes', 'GM1 T. Reyes', 'GM1', 'Mk 45 gun maintainer', 'NSIPS-GM-0102'),
  person('p_gm2_chen', 'GM2 L. Chen', 'GM2', 'Mk 45 gun maintainer', 'NSIPS-GM-0188'),
  {
    id: 't_gun_repair', kind: 'task', label: 'Gun mount repair + PMS checks', domain: 'maintenance', part: 'gun', deps: ['in_gun_part'], duration: 8,
    uncertainty: { min: -2, mode: 0, max: 6 }, crew: { pool: ['p_gm1_reyes', 'p_gm2_chen'], k: 1, label: 'Mk 45 qualified GM' },
    sources: [src('OMMS-NG', 'JCN 21706-K-0412', 8, '2-KILO OPEN')],
  },
  {
    id: 'c_suw', kind: 'capability', code: 'SUW', label: 'Surface Warfare', domain: 'capability', part: 'gun',
    deps: ['t_gun_repair', 'sys_ciws', 'sys_ssm', 'sys_spq9'], requiredBy: D(-4, '1200'),
  },

  /* ---------------- ASW ---------------- */
  sys('sys_sqq89', 'SQQ-89 sonar suite', 'sonar', 'maintenance', 'ASW-SQQ89'),
  sys('sys_svtt', 'SVTT torpedo tubes', 'svtt', 'maintenance', 'ASW-SVTT'),
  {
    id: 'in_helo_det', kind: 'input', label: 'MH-60R det ready to fly on (HSM)', domain: 'schedule', part: 'helo', value: D(-11, '1000'),
    uncertainty: { min: -2, mode: 0, max: 8 }, sources: [src('HSM-SQDN', 'HSM-DET2-READY', 8, 'D-11 1000')],
  },
  {
    id: 'in_crash_salvage', kind: 'input', label: 'Crash & salvage team qualified', domain: 'personnel', part: 'helo', value: D(-13, '1600'),
    uncertainty: { min: -4, mode: 0, max: 12 }, sources: [src('WATCHBILL', 'WB-CRASH-SALV', 8, 'D-13 1600')],
  },
  {
    id: 't_flightdeck_cert', kind: 'task', label: 'Flight deck certification', domain: 'schedule', part: 'helo', deps: ['in_crash_salvage'], duration: 6,
    uncertainty: { min: -1, mode: 0, max: 4 }, sources: [src('SKED', 'AVCERT-26-11', 8)],
  },
  {
    id: 'g_helo', kind: 'gate', label: 'Helo detachment embarks', domain: 'schedule', part: 'helo', deps: ['in_helo_det', 't_flightdeck_cert'],
    windows: [
      { id: 'flyon', label: 'VACAPES fly-on window (D-11)', start: D(-11, '0900'), end: D(-11, '1700'), lag: 0 },
      { id: 'flyon2', label: 'Alternate fly-on (D-10)', start: D(-10, '0900'), end: D(-10, '1700'), lag: 0, enabled: false, authority: 'CO + DESRON' },
      { id: 'rota', label: 'Rota rejoin via airlift', start: ROTA_OPEN, end: ROTA_CLOSE, lag: 72 },
    ],
  },
  {
    id: 'c_asw', kind: 'capability', code: 'ASW', label: 'Anti-Submarine Warfare', domain: 'capability', part: 'sonar',
    deps: ['sys_sqq89', 'sys_svtt', 'g_helo'], requiredBy: D(-4, '1200'),
  },

  /* ---------------- C5I ---------------- */
  sys('sys_link16', 'Link 16 terminal', 'link16', 'comms', 'C5I-L16'),
  sys('sys_satcom', 'SATCOM (CBSP / MUOS)', 'satcom', 'comms', 'C5I-SAT'),
  {
    id: 'in_keymat', kind: 'input', label: 'Mission KEYMAT (DCS courier)', domain: 'comms', part: 'satcom', value: D(-13, '1000'),
    uncertainty: { min: -6, mode: 0, max: 36 }, sources: [src('CMS', 'CMS-DCS-4471', 8, 'ETA D-13 1000')],
  },
  {
    id: 'g_keymat', kind: 'gate', label: 'KEYMAT received aboard', domain: 'comms', part: 'satcom', deps: ['in_keymat'],
    windows: [
      { id: 'norfolk', label: 'Norfolk pier (before sail)', start: 0, end: NORFOLK_CLOSE, lag: 0 },
      { id: 'rota', label: 'Rota port visit', start: ROTA_OPEN, end: ROTA_CLOSE, lag: 48 },
    ],
  },
  { id: 't_keymat_load', kind: 'task', label: 'Load & verify crypto', domain: 'comms', part: 'link16', deps: ['g_keymat'], duration: 2 },
  {
    id: 'c_c5i', kind: 'capability', code: 'C5I', label: 'Command, Control & Comms', domain: 'capability', part: 'satcom',
    deps: ['sys_link16', 'sys_satcom', 't_keymat_load'], requiredBy: D(0, '0800'),
  },

  /* ---------------- EW ---------------- */
  sys('sys_slq32', 'SLQ-32(V)6 SEWIP', 'ew', 'maintenance', 'EW-SLQ32'),
  {
    id: 'in_ew_lib', kind: 'input', label: 'EW mission data file (shore release)', domain: 'comms', part: 'ew', value: D(-6, '1200'),
    uncertainty: { min: -24, mode: 12, max: 168 }, sources: [src('AMHS', 'MSG 031200Z NOV26 EWDF', 8, 'Release D-6 1200')],
  },
  {
    id: 'c_ew', kind: 'capability', code: 'EW', label: 'Electronic Warfare', domain: 'capability', part: 'ew',
    deps: ['sys_slq32', 'in_ew_lib'], requiredBy: D(0, '0800'),
  },
];

const cfaWindows = [
  { id: 'norfolk', label: 'Norfolk pier (before sail)', start: 0, end: NORFOLK_CLOSE, lag: 2 },
  { id: 'vertrep', label: 'VERTREP from CLF ship (D-7)', start: D(-7, '1000'), end: D(-7, '1400'), lag: 72, enabled: false, authority: 'CTF-63 CLF scheduling' },
  { id: 'rota', label: 'Rota port visit', start: ROTA_OPEN, end: ROTA_CLOSE, lag: 48 },
];

export const ddg21: Scenario = {
  id: 'ddg21',
  name: 'DDG Readiness, 21 Days to Tasking',
  tagline: 'Know before it breaks the mission',
  timeScale: 'days',
  dDay: DDAY,
  epochUtc: Date.UTC(2026, 10, 3, 5, 0, 0),
  tzOffset: -5,
  ship: { name: 'USS GRACE HOPPER', hull: 'DDG-170', cls: 'Arleigh Burke Flt III (synthetic)', homeport: 'Norfolk, VA' },
  mission: {
    name: 'OPERATION ATLAS SHIELD',
    area: 'Eastern Mediterranean',
    start: D(0, '0800'),
    summary: 'BMD patrol station EASTMED, then high-value-unit escort.',
    tasking: 'CTF-64 BMD patrol (Phase I) then HVU escort (Phase II)',
  },
  watchStart: D(-21, '0800'),
  horizon: [0, D(8, '0000')],
  thresholds: { qMargin: 120, cliff: 24 },
  phases: [
    { id: 'ph_inport', name: 'IN PORT · MAINT & ONLOAD', start: 0, end: D(-12, '0700'), requires: [], location: 'Norfolk' },
    { id: 'ph_lant', name: 'TRANSIT LANT', start: D(-12, '0700'), end: ROTA_OPEN, requires: ['c_mob'], location: 'Atlantic' },
    { id: 'ph_rota', name: 'ROTA LOG STOP', start: ROTA_OPEN, end: ROTA_CLOSE, requires: ['c_mob'], location: 'Rota' },
    { id: 'ph_med', name: 'GIBRALTAR · TRANSIT MED', start: ROTA_CLOSE, end: D(0, '0800'), requires: ['c_mob', 'c_asw', 'c_suw'], location: 'Med' },
    { id: 'ph_bmd', name: 'PHASE I · BMD PATROL', start: D(0, '0800'), end: D(6, '0800'), requires: ['c_amd', 'c_c5i', 'c_ew', 'c_suw'], location: 'EASTMED' },
    { id: 'ph_esc', name: 'PHASE II · HVU ESCORT', start: D(6, '0800'), end: D(8, '0000'), requires: ['c_amd', 'c_asw', 'c_suw'], location: 'EASTMED' },
  ],
  nodes,
  events: [
    {
      id: 'E00', t: D(-21, '0800'), kind: 'baseline', severity: 'info',
      title: 'Watch baseline ingested',
      detail: 'OMMS-NG, R-Supply, NSIPS, SKED, DRRS-N, CMS and HSM feeds reconciled into one picture. 61 records, 0 rejected.',
      source: src('NAVIFI', 'INGEST-0001', D(-21, '0800')), patches: [],
    },
    {
      id: 'E01', t: D(-20, '1030'), kind: 'casrep', severity: 'crit',
      title: 'CASREP CAT 3: SPY-1D Array B transmitter',
      detail: 'Crossed-field amplifier (CFA) failure in the Array B transmitter group. Array B radiating at reduced power; BMD search volume degraded. Part on order, ETA not yet reported.',
      source: src('AMHS', 'CASREP 26-0412 INITIAL', D(-20, '1030')),
      patches: [
        {
          op: 'add', node: {
            id: 'in_cfa_eta', kind: 'input', label: 'CFA replacement: ETA Norfolk', domain: 'logistics', part: 'spy_b', value: null, assumed: D(-14, '0000'),
            staleAfter: 60, uncertainty: { min: -12, mode: 0, max: 36 },
            sources: [src('OMMS-NG', 'CASREP 26-0412', D(-20, '1030'), 'ETA TBD')],
          },
        },
        { op: 'add', node: { id: 'g_cfa', kind: 'gate', label: 'CFA delivered aboard', domain: 'logistics', part: 'spy_b', deps: ['in_cfa_eta'], windows: cfaWindows } },
        {
          op: 'add', node: {
            id: 't_spy_repair', kind: 'task', label: 'Replace CFA & align XMTR group', domain: 'maintenance', part: 'spy_b', deps: ['g_cfa'], duration: 6,
            uncertainty: { min: -2, mode: 0, max: 4 },
            crew: { pool: ['p_fc1_martinez', 'p_fc2_okafor', 'p_fc2_lindqvist'], k: 2, label: 'SPY XMTR-qualified FCs' },
            sources: [src('OMMS-NG', 'JCN 21706-S-0412', D(-20, '1030'), '6h est.')],
          },
        },
        {
          op: 'add', node: {
            id: 't_spy_dsot', kind: 'task', label: 'DSOT & ORTS verification', domain: 'maintenance', part: 'spy_b', deps: ['t_spy_repair'], duration: 4,
            uncertainty: { min: -1, mode: 0, max: 8 }, sources: [src('OMMS-NG', 'MRC SPY-D-07', D(-20, '1030'), '4h')],
          },
        },
        { op: 'set', id: 'sys_spy_b', fields: { kind: 'all', deps: ['t_spy_dsot'], value: undefined, sources: [src('DRRS-N', 'AMD-SPY-B', D(-20, '1030'), 'DOWN')] } },
      ],
    },
    {
      id: 'E02', t: D(-20, '1400'), kind: 'supply', severity: 'info',
      title: 'R-Supply: CFA requisition status BA',
      detail: 'Document N21706-6312-0418 status BA (supply action taken). ETA Norfolk D-15 1200.',
      source: src('R-SUPPLY', 'DOC N21706-6312-0418', D(-20, '1400')),
      patches: [{ op: 'set', id: 'in_cfa_eta', fields: { value: D(-15, '1200'), sources: [src('R-SUPPLY', 'DOC N21706-6312-0418', D(-20, '1400'), 'ETA D-15 1200', 'Status BA')] } }],
    },
    {
      id: 'E03', t: D(-19, '0900'), kind: 'personnel', severity: 'warn',
      title: 'NSIPS: FC1 Martinez TAD orders',
      detail: 'FC1 Martinez to Aegis advanced school (Dam Neck) D-16 0800. Rejoins ship at Rota. One of three SPY XMTR-qualified technicians.',
      source: src('NSIPS', 'TAD-26-1187', D(-19, '0900')),
      patches: [
        {
          op: 'set', id: 'p_fc1_martinez', fields: {
            unavailable: [{ start: D(-16, '0800'), end: D(-5, '1200'), reason: 'TAD (Aegis school), rejoins at Rota' }],
            uncertainty: { min: -12, mode: 0, max: 36 },
            sources: [src('NSIPS', 'TAD-26-1187', D(-19, '0900'), 'TAD D-16 to Rota')],
          },
        },
      ],
    },
    {
      id: 'E04', t: D(-18, '1100'), kind: 'casrep', severity: 'warn',
      title: 'CASREP CAT 2: SSGTG #2 high vibration',
      detail: 'Ship service gas turbine generator #2 secured for high vibration. Ship\'s force repair, ETR D-10 1800. Electrical plant now 2 of 3.',
      source: src('AMHS', 'CASREP 26-0419 INITIAL', D(-18, '1100')),
      patches: [{ op: 'set', id: 'sys_ssgtg_2', fields: { value: D(-10, '1800'), uncertainty: { min: -12, mode: 0, max: 48 }, sources: [src('OMMS-NG', 'CASREP 26-0419', D(-18, '1100'), 'ETR D-10 1800')] } }],
    },
    {
      id: 'E05', t: D(-17, '1600'), kind: 'supply', severity: 'crit',
      title: 'R-Supply: CFA ETA slips 2d 3h',
      detail: 'Vendor backorder. Document N21706-6312-0418 ETA Norfolk now D-12 1500, eight hours after the ship sails.',
      source: src('R-SUPPLY', 'DOC N21706-6312-0418', D(-17, '1600')),
      patches: [
        {
          op: 'set', id: 'in_cfa_eta', fields: {
            value: D(-12, '1500'),
            // backorder ETAs are heavy-tailed: a further slip of ~6 days misses Rota and leaves no delivery window
            uncertainty: { min: -12, mode: 6, max: 200 },
            sources: [src('R-SUPPLY', 'DOC N21706-6312-0418', D(-17, '1600'), 'ETA D-12 1500', 'Status BB backorder')],
          },
        },
      ],
    },
    {
      id: 'E06', t: D(-16, '0800'), kind: 'personnel', severity: 'warn',
      title: 'AMCROSS: FC2 Okafor emergency leave',
      detail: 'Emergency leave approved via American Red Cross message. Estimated rejoin at Rota D-4 0800.',
      source: src('AMHS', 'AMCROSS 26-55120', D(-16, '0800')),
      patches: [
        {
          op: 'set', id: 'p_fc2_okafor', fields: {
            unavailable: [{ start: D(-16, '0800'), end: D(-4, '0800'), reason: 'Emergency leave (AMCROSS)' }],
            uncertainty: { min: -48, mode: 0, max: 120 },
            sources: [src('NSIPS', 'LV-26-0933', D(-16, '0800'), 'EMLV to D-4')],
          },
        },
      ],
    },
    {
      id: 'E07', t: D(-15, '1100'), kind: 'quality', severity: 'warn',
      title: 'DLA tracking contradicts R-Supply ETA',
      detail: 'Transportation control number tracking shows CFA arriving D-12 0900, six hours earlier than R-Supply. Sources disagree.',
      source: src('DLA-TRACK', 'TCN SW3211-6312-0418', D(-15, '1100')),
      patches: [{ op: 'set', id: 'in_cfa_eta', fields: { conflict: { source: src('DLA-TRACK', 'TCN SW3211-6312-0418', D(-15, '1100'), 'ETA D-12 0900'), value: D(-12, '0900') } } }],
    },
    {
      id: 'E08', t: D(-15, '1500'), kind: 'aviation', severity: 'warn',
      title: 'HSM: Det aircraft phase maintenance overrun',
      detail: 'MH-60R detachment ready D-11 1500 (was 1000). Fly-on window closes D-11 1700.',
      source: src('HSM-SQDN', 'HSM-DET2-READY', D(-15, '1500')),
      patches: [{ op: 'set', id: 'in_helo_det', fields: { value: D(-11, '1500'), sources: [src('HSM-SQDN', 'HSM-DET2-READY', D(-15, '1500'), 'D-11 1500')] } }],
    },
    {
      id: 'E09', t: D(-14, '0900'), kind: 'quality', severity: 'warn',
      title: 'NAVSEA withdraws CFA repair estimate',
      detail: 'Tech rep: repair duration TBD pending fault isolation on the waveguide. No estimate in OMMS-NG.',
      source: src('NAVSEA', 'TA-26-3381', D(-14, '0900')),
      patches: [{ op: 'set', id: 't_spy_repair', fields: { duration: null, assumedDuration: 6, uncertainty: { min: -2, mode: 2, max: 30 }, sources: [src('NAVSEA', 'TA-26-3381', D(-14, '0900'), 'TBD')] } }],
    },
    {
      id: 'E10', t: D(-14, '1300'), kind: 'quality', severity: 'info',
      title: 'NSIPS record rejected: malformed date',
      detail: 'Qualification update for LTJG Diaz carried an invalid timestamp. Record quarantined; last good value retained.',
      source: src('NSIPS', 'Q-TAO-04-UPD', D(-14, '1300')),
      patches: [{ op: 'set', id: 'p_tao_diaz', fields: { malformed: { source: src('NSIPS', 'Q-TAO-04-UPD', D(-14, '1300'), '2026-11-31T25:00Z'), raw: '2026-11-31T25:00Z' } } }],
    },
  ],
  levers: [
    {
      id: 'L_EXPEDITE', category: 'expedite', title: 'Expedite CFA (NMCS, commercial air)',
      detail: 'Upgrade requisition to not-mission-capable-supply priority. Vendor ships by commercial air; ETA Norfolk D-13 1800.',
      authority: 'Supply Officer request, CO approval', withinShipAuthority: true, deadline: D(-13, '1200'), cost: 'med',
      risk: 'Vendor confidence MEDIUM', requiresNodes: ['in_cfa_eta'],
      patches: [{ op: 'set', id: 'in_cfa_eta', fields: { value: D(-13, '1800'), conflict: undefined, sources: [src('NAVIFI', 'PROPOSED-NMCS', 0, 'ETA D-13 1800 (proposed)')] } }],
    },
    {
      id: 'L_VERTREP', category: 'logistics', title: 'VERTREP CFA from CLF ship at D-7',
      detail: 'Route the part to the CLF shuttle and deliver by helicopter at the D-7 rendezvous.',
      authority: 'CTF-63 (off-ship)', withinShipAuthority: false, deadline: D(-10, '1000'), cost: 'med',
      risk: 'Weather and deck-cycle dependent', requiresNodes: ['g_cfa'],
      patches: [{ op: 'window', id: 'g_cfa', windowId: 'vertrep', fields: { enabled: true } }],
    },
    {
      id: 'L_FAT', category: 'crew', title: 'Request MARMC fly-away tech assist (2 techs)',
      detail: 'Two SPY XMTR technicians embark D-13 0800 and ride to Rota.',
      authority: 'ISIC / MARMC (off-ship)', withinShipAuthority: false, deadline: D(-12, '0000'), cost: 'high',
      risk: 'Team availability unconfirmed', requiresNodes: ['t_spy_repair'],
      patches: [
        { op: 'add', node: { id: 'p_fat_1', kind: 'person', label: 'MARMC tech J. Alvarez', rate: 'CIV', qual: 'SPY XMTR', domain: 'personnel', part: 'crew', value: D(-13, '0800'), sources: [src('NAVIFI', 'PROPOSED-FAT', 0, 'proposed')] } },
        { op: 'add', node: { id: 'p_fat_2', kind: 'person', label: 'MARMC tech M. Park', rate: 'CIV', qual: 'SPY XMTR', domain: 'personnel', part: 'crew', value: D(-13, '0800'), sources: [src('NAVIFI', 'PROPOSED-FAT', 0, 'proposed')] } },
        { op: 'addCrew', id: 't_spy_repair', persons: ['p_fat_1', 'p_fat_2'] },
      ],
    },
    {
      id: 'L_XDECK', category: 'crew', title: 'Cross-deck FC from pier-mate DDG',
      detail: 'One SPY XMTR-qualified FC2 assigned TAD from D-14 0800 until sail.',
      authority: 'DESRON (off-ship)', withinShipAuthority: false, deadline: D(-13, '0000'), cost: 'low',
      risk: 'Degrades lending ship', requiresNodes: ['t_spy_repair'],
      patches: [
        { op: 'add', node: { id: 'p_xdeck', kind: 'person', label: 'FC2 B. Hale (cross-deck)', rate: 'FC2', qual: 'SPY XMTR', domain: 'personnel', part: 'crew', value: D(-14, '0800'), unavailable: [{ start: D(-12, '0700'), end: FAR, reason: 'Returns to parent ship at sail' }], sources: [src('NAVIFI', 'PROPOSED-XDECK', 0, 'proposed')] } },
        { op: 'addCrew', id: 't_spy_repair', persons: ['p_xdeck'] },
      ],
    },
    {
      id: 'L_DELAY', category: 'schedule', title: 'Request 12h sail delay',
      detail: 'Hold the Norfolk pier window open 12h. Transit speed increases to hold Rota arrival.',
      authority: 'Fleet / ISIC (off-ship)', withinShipAuthority: false, deadline: D(-12, '0000'), cost: 'high',
      risk: 'Fuel burn, schedule ripple', requiresNodes: ['g_cfa'],
      patches: [
        { op: 'window', id: 'g_cfa', windowId: 'norfolk', fields: { end: NORFOLK_CLOSE + 12 } },
        { op: 'window', id: 'g_keymat', windowId: 'norfolk', fields: { end: NORFOLK_CLOSE + 12 } },
        { op: 'set', id: 'c_mob', fields: { requiredBy: D(-12, '1900') } },
      ],
    },
    {
      id: 'L_HELO2', category: 'schedule', title: 'Hold alternate fly-on window D-10',
      detail: 'Remain in the VACAPES operating area an extra day to give the detachment a second fly-on window.',
      authority: 'CO + DESRON', withinShipAuthority: false, deadline: D(-12, '0000'), cost: 'med',
      risk: 'Adds transit pressure', requiresNodes: ['g_helo'],
      patches: [{ op: 'window', id: 'g_helo', windowId: 'flyon2', fields: { enabled: true } }],
    },
    {
      id: 'L_ACCEPT', category: 'accept', title: 'Accept degraded AMD (3 of 4 arrays)',
      detail: 'Proceed with Array B down. Reduced BMD search volume; report Q in DRRS-N.',
      authority: 'Commanding Officer (report to ISIC)', withinShipAuthority: true, cost: 'low',
      risk: 'Reduced BMD sector coverage', requiresNodes: ['t_spy_dsot'],
      patches: [{ op: 'set', id: 'c_amd', fields: { deps: ['sys_spy_a', 'sys_spy_c', 'sys_spy_d', 'sys_aegis', 'sys_vls', 'in_ordnance', 'k_amd_watch'], degraded: 'Array B out, reduced BMD search volume' } }],
    },
  ],
  ports: [
    { id: 'norfolk', name: 'NS Norfolk', lon: -76.33, lat: 36.95 },
    { id: 'yorktown', name: 'NWS Yorktown', lon: -76.53, lat: 37.24 },
    { id: 'rota', name: 'NAVSTA Rota', lon: -6.35, lat: 36.62 },
    { id: 'souda', name: 'NSA Souda Bay', lon: 24.12, lat: 35.49 },
    { id: 'sigonella', name: 'NAS Sigonella', lon: 14.92, lat: 37.4 },
  ],
  track: [
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
};
