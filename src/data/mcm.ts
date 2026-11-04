import type { NodeDef, Scenario, SourceRef } from '@/engine/types';

const src = (system: SourceRef['system'], recordId: string, asOf: number, value?: string, note?: string): SourceRef => ({ system, recordId, asOf, value, note });

/** Clock time to scenario hours: H('1645') = 16.75. Epoch is 0000 local on mission day. */
const H = (hhmm: string) => Number(hhmm.slice(0, 2)) + Number(hhmm.slice(2)) / 60;

const DUE = H('1800');
const TRANSIT = H('2000');

const nodes: NodeDef[] = [
  {
    id: 'in_tasking', kind: 'input', label: 'Tasking: assess approach lanes 1–4', domain: 'schedule', value: H('0600'),
    sources: [src('AMHS', 'MSG 051100Z NOV26 CTG 20.4 OPEN PASSAGE', H('0600'), 'Received 0600')],
  },
  { id: 't_readiness', kind: 'task', label: 'Check mission readiness', domain: 'schedule', deps: ['in_tasking'], duration: 0.5, sources: [src('SKED', 'MCM-RDY-0501', H('0600'), '30m')] },

  /* ---------------- Surface: USV + sonar ---------------- */
  {
    id: 'sys_usv', kind: 'input', label: 'MCM USV-1: propulsion & launch/recovery', domain: 'maintenance', part: 'sonar', value: H('0700'),
    uncertainty: { min: 0, mode: 0, max: 0.75 }, sources: [src('OMMS-NG', 'JCN LCS42-USV1-0611', H('0600'), 'Ready 0700', 'Pre-launch checks')],
  },
  { id: 'sys_sonar', kind: 'input', label: 'AN/AQS-20C minehunting sonar', domain: 'maintenance', part: 'sonar', value: H('0600'), sources: [src('DRRS-N', 'MP-AQS20C-1', H('0600'), 'UP')] },
  { id: 'in_usv_team', kind: 'input', label: 'USV operators & L&R team (watch section 2)', domain: 'personnel', part: 'crew', value: H('0600'), sources: [src('WATCHBILL', 'WB-MCM-USV-S2', H('0600'), 'On watch 0600')] },
  { id: 'sys_mvcs', kind: 'input', label: 'MVCS: USV control & data link', domain: 'comms', part: 'satcom', value: H('0600'), sources: [src('MVCS', 'MVCS-LINK-USV1', H('0600'), 'UP')] },
  {
    id: 't_usv_launch', kind: 'task', label: 'Launch USV-1', domain: 'schedule', part: 'sonar', deps: ['t_readiness', 'sys_usv', 'sys_sonar', 'in_usv_team'], duration: 0.5,
    sources: [src('SKED', 'MCM-LR-0502', H('0600'), '30m')],
  },
  {
    id: 't_usv_survey', kind: 'task', label: 'USV sonar survey: lanes 1–4', domain: 'schedule', part: 'sonar', deps: ['t_usv_launch', 'sys_mvcs'], duration: 5,
    uncertainty: { min: -0.5, mode: 0, max: 1.5 }, sources: [src('SKED', 'MCM-SVY-0503', H('0600'), '5h at 6 kt, 4 lanes')],
  },
  {
    id: 't_usv_recover', kind: 'task', label: 'Recover USV-1 & download sonar data', domain: 'schedule', part: 'sonar', deps: ['t_usv_survey'], duration: 0.75,
    uncertainty: { min: -0.25, mode: 0, max: 0.5 }, sources: [src('SKED', 'MCM-LR-0504', H('0600'), '45m')],
  },
  { id: 'sys_mpce', kind: 'input', label: 'MPCE mission package computing', domain: 'comms', value: H('0600'), sources: [src('DRRS-N', 'MP-MPCE-1', H('0600'), 'UP')] },
  {
    id: 't_usv_transfer', kind: 'task', label: 'Transfer survey results to MPCE', domain: 'comms', deps: ['t_usv_recover', 'sys_mpce'], duration: 0.25,
    uncertainty: { min: 0, mode: 0, max: 0.5 }, sources: [src('SKED', 'MCM-DATA-0505', H('0600'), '15m, 1.2 GB')],
  },

  /* ---------------- Air: MH-60S + ALMDS ---------------- */
  {
    id: 'sys_mh60', kind: 'input', label: 'MH-60S aircraft 61: post-maintenance turn', domain: 'maintenance', part: 'helo', value: H('0730'),
    uncertainty: { min: -0.25, mode: 0, max: 1 }, sources: [src('HSC-DET', 'HSC-DET1-A61', H('0600'), 'Ready 0730')],
  },
  { id: 'in_aircrew', kind: 'input', label: 'Det 1 aircrew: crew rest complete', domain: 'personnel', part: 'crew', value: H('0700'), sources: [src('WATCHBILL', 'WB-HSC-DET1-REST', H('0600'), 'Crew rest ends 0700')] },
  {
    id: 'g_flight', kind: 'gate', label: 'MH-60S launch in flight window', domain: 'schedule', part: 'helo', deps: ['t_readiness', 'sys_mh60', 'in_aircrew'],
    detail: 'Ceiling, visibility and the flight-deck cycle open two launch windows.',
    windows: [
      { id: 'w_am', label: 'Morning flight window 0730–1030', start: H('0730'), end: H('1030') },
      { id: 'w_pm', label: 'Afternoon flight window 1400–1630', start: H('1400'), end: H('1630') },
    ],
  },
  {
    id: 't_air_sortie', kind: 'task', label: 'Airborne mine assessment (ALMDS)', domain: 'schedule', part: 'helo', deps: ['g_flight'], duration: 2.5,
    uncertainty: { min: -0.25, mode: 0, max: 0.75 }, sources: [src('SKED', 'HSC-SORTIE-0506', H('0600'), '2h 30m')],
  },
  {
    id: 't_air_collect', kind: 'task', label: 'Collect airborne observations', domain: 'schedule', part: 'helo', deps: ['t_air_sortie', 'sys_mpce'], duration: 0.5,
    sources: [src('SKED', 'HSC-DATA-0507', H('0600'), '30m')],
  },

  /* ---------------- Analysis + assessment ---------------- */
  { id: 'sys_mpas', kind: 'input', label: 'MPAS post-mission analysis software', domain: 'comms', value: H('0600'), sources: [src('DRRS-N', 'MP-MPAS-4.2', H('0600'), 'UP')] },
  {
    id: 'p_pma_vega', kind: 'person', label: 'OS1 R. Vega', rate: 'OS1', qual: 'Post-mission analysis reviewer (qualified)', domain: 'personnel', part: 'crew', value: H('0600'),
    sources: [src('NSIPS', 'NSIPS-OS-1104', H('0600'), 'ONBOARD')],
  },
  {
    id: 't_pma', kind: 'task', label: 'Integrate & review evidence', domain: 'schedule', deps: ['t_usv_transfer', 't_air_collect', 'sys_mpas'], duration: 2,
    uncertainty: { min: -0.25, mode: 0, max: 1 }, crew: { pool: ['p_pma_vega'], k: 1, label: 'Qualified PMA reviewer' },
    sources: [src('SKED', 'MCM-PMA-0508', H('0600'), '2h')],
  },
  {
    id: 'd_evidence', kind: 'all', label: 'Required evidence: sonar AND airborne', domain: 'schedule', deps: ['t_pma', 't_usv_transfer', 't_air_collect'],
    detail: 'Towed sonar covers volume and bottom mines; the airborne laser covers near-surface mines. Neither substitutes for the other.',
  },
  { id: 't_present', kind: 'task', label: 'Present mission assessment', domain: 'schedule', deps: ['d_evidence'], duration: 0.5, sources: [src('SKED', 'MCM-BRIEF-0509', H('0600'), '30m')] },
  {
    id: 'c_assess', kind: 'capability', code: 'MCM', label: 'Approach assessment to mission commander', domain: 'capability', part: 'sonar', qMargin: 1,
    deps: ['t_present'], requiredBy: DUE,
  },
];

export const mcm: Scenario = {
  id: 'mcm',
  name: 'Operation Open Passage: MCM Approach Assessment',
  short: 'MCM thread · 12h',
  tagline: 'Five systems report status. One controls the mission.',
  timeScale: 'hours',
  dDay: 0,
  epochUtc: Date.UTC(2026, 10, 5, 5, 0, 0),
  tzOffset: -5,
  ship: { name: 'USS CAPE CHARLES', hull: 'LCS-42', cls: 'Independence variant · MCM mission package (synthetic)', homeport: 'Norfolk, VA' },
  mission: {
    name: 'OPERATION OPEN PASSAGE',
    area: 'Thimble Shoal approach',
    start: TRANSIT,
    summary: 'Assess approach lanes 1–4 with USV sonar and MH-60S before the task group transits at 2000.',
    tasking: 'Mission assessment to the mission commander by 1800 for the 2000 task group transit',
  },
  watchStart: H('0600'),
  horizon: [H('0530'), H('2200')],
  thresholds: { qMargin: 1, cliff: 0.5 },
  phases: [
    { id: 'ph_assess', name: 'ASSESS APPROACH', start: H('0600'), end: DUE, requires: [], location: 'Lanes 1–4' },
    { id: 'ph_decide', name: 'COMMANDER DECISION', start: DUE, end: TRANSIT, requires: ['c_assess'], location: 'LCS-42' },
    { id: 'ph_transit', name: 'TASK GROUP TRANSIT', start: TRANSIT, end: H('2200'), requires: ['c_assess'], location: 'Thimble Shoal' },
  ],
  nodes,
  events: [
    {
      id: 'M00', t: H('0600'), kind: 'baseline', severity: 'info',
      title: 'Mission thread ingested',
      detail: 'CTG 20.4 tasking: assess approach lanes 1–4 before the 2000 task group transit. USV, sonar, MH-60S, MVCS, MPCE, MPAS and reviewer status reconciled: 16 records, 0 rejected.',
      source: src('NAVIFI', 'INGEST-M001', H('0600')), patches: [],
    },
    {
      id: 'M01', t: H('0615'), kind: 'casrep', severity: 'warn',
      title: 'USV-1 propulsion maintenance adds 30 min',
      detail: 'Waterjet impeller inspection after the pre-launch check. USV-1 ready 0730 instead of 0700.',
      source: src('OMMS-NG', 'JCN LCS42-USV1-0611', H('0615')),
      board: { system: 'MCM USV-1', status: 'DEGRADED' },
      patches: [{ op: 'set', id: 'sys_usv', fields: { value: H('0730'), sources: [src('OMMS-NG', 'JCN LCS42-USV1-0611', H('0615'), 'Ready 0730', 'Impeller inspection')] } }],
    },
    {
      id: 'M02', t: H('0700'), kind: 'aviation', severity: 'warn',
      title: 'MH-60S launch delayed 45 min',
      detail: 'Aircraft 61 post-maintenance turn runs long. Ready 0815, inside the 0730–1030 flight window.',
      source: src('HSC-DET', 'HSC-DET1-A61', H('0700')),
      board: { system: 'MH-60S 61', status: 'DEGRADED' },
      patches: [{ op: 'set', id: 'sys_mh60', fields: { value: H('0815'), sources: [src('HSC-DET', 'HSC-DET1-A61', H('0700'), 'Ready 0815')] } }],
    },
    {
      id: 'M03', t: H('0815'), kind: 'quality', severity: 'warn',
      title: 'USV comms intermittent: survey progress unconfirmed',
      detail: 'MVCS link dropping. Last good USV-1 progress report 0745 (38% surveyed). Survey completion can no longer be confirmed from the ship.',
      source: src('MVCS', 'MVCS-LINK-USV1', H('0815')),
      board: { system: 'MVCS link', status: 'FAULT' },
      patches: [
        { op: 'set', id: 't_usv_survey', fields: { staleAfter: 0.25, sources: [src('MVCS', 'USV1-PROGRESS', H('0745'), '38% at 0745', 'Link intermittent')] } },
        { op: 'set', id: 'sys_mvcs', fields: { sources: [src('MVCS', 'MVCS-LINK-USV1', H('0815'), 'INTERMITTENT')] } },
      ],
    },
    {
      id: 'M04', t: H('1000'), kind: 'personnel', severity: 'crit',
      title: 'Qualified reviewer unavailable 1300–1645',
      detail: 'Watchbill change: OS1 Vega relieves the CIC watch 1300–1645. Vega is the only PMA-qualified reviewer aboard.',
      source: src('WATCHBILL', 'WB-CIC-0510', H('1000')),
      board: { system: 'PMA reviewer', status: 'CONSTRAINT' },
      patches: [
        {
          op: 'set', id: 'p_pma_vega', fields: {
            unavailable: [{ start: H('1300'), end: H('1645'), reason: 'Relieving the CIC watch' }],
            sources: [src('WATCHBILL', 'WB-CIC-0510', H('1000'), 'CIC 1300–1645')],
          },
        },
      ],
    },
  ],
  levers: [
    {
      id: 'M_REVIEWER', category: 'crew', title: 'Reassign qualified reviewer: OS2 M. Kim',
      detail: 'OS2 Kim (MCM detachment, PMA qualified) comes off the USV console after recovery and takes the evidence review from 1400.',
      authority: 'MCM Det OIC, mission commander approves', withinShipAuthority: true, deadline: H('1400'), cost: 'low',
      risk: 'One fewer USV operator during recovery', requiresNodes: ['t_pma'],
      patches: [
        { op: 'add', node: { id: 'p_pma_kim', kind: 'person', label: 'OS2 M. Kim', rate: 'OS2', qual: 'Post-mission analysis reviewer (qualified)', domain: 'personnel', part: 'crew', value: H('1400'), sources: [src('NAVIFI', 'PROPOSED-REVIEWER', 0, 'proposed')] } },
        { op: 'addCrew', id: 't_pma', persons: ['p_pma_kim'] },
      ],
    },
    {
      id: 'M_REACHBACK', category: 'expedite', title: 'Shore reachback review over SATCOM',
      detail: 'Send survey results and airborne observations to the shore PMA cell; they review from 1445 after a 45-minute bulk transfer.',
      authority: 'Mine warfare reachback cell (off-ship)', withinShipAuthority: false, deadline: H('1330'), cost: 'med',
      risk: 'Needs a SATCOM bulk window; not available under EMCON', requiresNodes: ['t_pma'],
      patches: [
        { op: 'add', node: { id: 'p_pma_shore', kind: 'person', label: 'Shore PMA cell (reachback)', rate: 'CIV', qual: 'Post-mission analysis reviewer (qualified)', domain: 'personnel', part: 'crew', value: H('1445'), sources: [src('NAVIFI', 'PROPOSED-REACHBACK', 0, 'proposed')] } },
        { op: 'addCrew', id: 't_pma', persons: ['p_pma_shore'] },
      ],
    },
    {
      id: 'M_SHIFT', category: 'schedule', title: 'Request task group transit shift +90 min',
      detail: 'Ask CTG 20.4 to move the transit to 2130; the assessment is then due 1930.',
      authority: 'CTG 20.4 (off-ship)', withinShipAuthority: false, deadline: H('1600'), cost: 'high',
      risk: 'Task group sortie slips; tide window narrows', requiresNodes: ['c_assess'],
      patches: [{ op: 'set', id: 'c_assess', fields: { requiredBy: DUE + 1.5 } }],
    },
    {
      id: 'M_AIRONLY', category: 'accept', title: 'Present an airborne-only assessment',
      detail: 'Review the airborne observations without the sonar survey. The commander accepts that bottom and volume mines are unassessed.',
      authority: 'Mission commander', withinShipAuthority: true, cost: 'low',
      risk: 'Airborne laser does not substitute for sonar on bottom mines', requiresNodes: ['t_pma'],
      patches: [
        { op: 'set', id: 't_pma', fields: { deps: ['t_air_collect', 'sys_mpas'] } },
        { op: 'set', id: 'd_evidence', fields: { deps: ['t_pma', 't_air_collect'] } },
        { op: 'set', id: 'c_assess', fields: { degraded: 'Airborne only: bottom and volume mines unassessed' } },
      ],
    },
  ],
  partLabels: { sonar: 'USV-1 · AQS-20C Sonar', helo: 'MH-60S Det 1 · ALMDS', satcom: 'MVCS Control Link' },
  ports: [{ id: 'norfolk', name: 'NS Norfolk', lon: -76.33, lat: 36.95 }],
  places: {
    norfolk: { name: 'NS Norfolk', lon: -76.33, lat: 36.95 },
    chambers: { name: 'NAS Norfolk (Chambers)', lon: -76.29, lat: 36.94 },
    capehenry: { name: 'Cape Henry', lon: -76.01, lat: 36.93 },
    lanes: { name: 'Approach lanes 1–4', lon: -75.93, lat: 36.95 },
  },
  legs: [
    { id: 'leg_helo', label: 'SEAHAWK 61 sortie', kind: 'aircraft', nodeId: 'g_flight', from: 'chambers', to: 'lanes', gateId: 'g_flight', byWindow: { w_am: 'lanes', w_pm: 'lanes' } },
    { id: 'leg_sonar', label: 'USV-1 sonar data', kind: 'data', nodeId: 't_usv_transfer', from: 'lanes', to: 'ship' },
    { id: 'leg_airobs', label: 'Airborne observations', kind: 'data', nodeId: 't_air_collect', from: 'lanes', to: 'ship' },
  ],
  missionArea: { name: 'APPROACH LANES 1–4', lon: -75.93, lat: 36.95, radiusKm: 8 },
  mapView: { longitude: -76.1, latitude: 36.96, zoom: 9.2 },
  track: [
    { t: H('0530'), lon: -76.1, lat: 37.0, label: 'Stand-off station' },
    { t: H('1300'), lon: -76.08, lat: 37.01 },
    { t: H('1800'), lon: -76.06, lat: 37.0, label: 'Assessment' },
    { t: H('2200'), lon: -76.0, lat: 36.97, label: 'Transit' },
  ],
  thread: {
    name: 'MCM approach assessment',
    thesis: 'Five systems report status. Only the executable thread shows which one controls the mission.',
    lanes: [
      { id: 'co', label: 'Mission commander', sub: 'Approval authority', color: '#fbbf24' },
      { id: 'cmd', label: 'LCS mission command', sub: 'USS CAPE CHARLES (LCS-42)', color: '#22d3ee' },
      { id: 'usv', label: 'MCM USV-1', sub: 'AN/AQS-20C sonar · L&R', color: '#60a5fa' },
      { id: 'net', label: 'MVCS · MPCE', sub: 'Control link · mission computing', color: '#818cf8' },
      { id: 'pma', label: 'Post-mission analysis', sub: 'MPAS · qualified reviewer', color: '#c084fc' },
      { id: 'air', label: 'MH-60S Det 1', sub: 'Aircraft 61 · ALMDS', color: '#2dd4bf' },
    ],
    steps: [
      { id: 's_start', kind: 'start', label: 'Mission assigned', lane: 'cmd', col: 0, node: 'in_tasking', actor: 'CTG 20.4' },
      { id: 's_ready', kind: 'task', label: 'Check mission readiness', lane: 'cmd', col: 1, node: 't_readiness', actor: 'TAO' },
      { id: 's_launch', kind: 'task', label: 'Launch USV-1', lane: 'usv', col: 2, node: 't_usv_launch', actor: 'USV-1', needs: ['sys_usv', 'sys_sonar', 'in_usv_team'] },
      { id: 's_survey', kind: 'task', label: 'Sonar survey · lanes 1–4', lane: 'usv', col: 3, node: 't_usv_survey', actor: 'USV-1', needs: ['sys_mvcs'] },
      { id: 's_recover', kind: 'task', label: 'Recover USV · download', lane: 'usv', col: 4, node: 't_usv_recover', actor: 'USV-1' },
      { id: 's_transfer', kind: 'task', label: 'Transfer survey results', lane: 'net', col: 5, node: 't_usv_transfer', actor: 'MPCE', needs: ['sys_mpce'] },
      { id: 's_flight', kind: 'gate', label: 'Launch MH-60S', lane: 'air', col: 2, node: 'g_flight', actor: 'SEAHAWK 61', needs: ['sys_mh60', 'in_aircrew'] },
      { id: 's_sortie', kind: 'task', label: 'Airborne assessment', lane: 'air', col: 3, node: 't_air_sortie', actor: 'SEAHAWK 61', note: 'ALMDS laser · near-surface' },
      { id: 's_collect', kind: 'task', label: 'Collect airborne observations', lane: 'air', col: 4, node: 't_air_collect', actor: 'SEAHAWK 61' },
      { id: 's_pma', kind: 'task', label: 'Integrate & review evidence', lane: 'pma', col: 6, node: 't_pma', needs: ['sys_mpas', 'p_pma_vega'] },
      { id: 's_check', kind: 'decision', label: 'Required evidence available?', lane: 'pma', col: 7, node: 'd_evidence', note: 'Sonar AND airborne: not interchangeable' },
      { id: 's_follow', kind: 'branch', label: 'Human-directed follow-up', lane: 'co', col: 7 },
      { id: 's_present', kind: 'task', label: 'Present mission assessment', lane: 'cmd', col: 8, node: 't_present', actor: 'DET OIC' },
      { id: 's_end', kind: 'end', label: 'Authorized human decision', lane: 'co', col: 9, node: 'c_assess', actor: 'COMMANDER' },
    ],
    links: [
      { from: 's_start', to: 's_ready', cargo: 'TASKING' },
      { from: 's_ready', to: 's_launch', cargo: 'GO' },
      { from: 's_ready', to: 's_flight', cargo: 'GO' },
      { from: 's_launch', to: 's_survey', cargo: 'USV-1' },
      { from: 's_survey', to: 's_recover', cargo: 'CONTACTS' },
      { from: 's_recover', to: 's_transfer', cargo: 'SONAR DATA' },
      { from: 's_transfer', to: 's_pma', cargo: 'SURVEY' },
      { from: 's_flight', to: 's_sortie', cargo: 'SEAHAWK 61' },
      { from: 's_sortie', to: 's_collect', cargo: 'IMAGERY' },
      { from: 's_collect', to: 's_pma', cargo: 'AIR OBS' },
      { from: 's_pma', to: 's_check', cargo: 'EVIDENCE' },
      { from: 's_check', to: 's_present', branch: 'yes', cargo: 'ASSESSMENT' },
      { from: 's_check', to: 's_follow', branch: 'no' },
      { from: 's_present', to: 's_end', cargo: 'BRIEF' },
    ],
  },
};
