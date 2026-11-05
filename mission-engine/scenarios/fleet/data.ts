/**
 * Synthetic global fleet: fictional hulls, missions and the packages (parts, people, data) feeding them.
 * Times are hours from the fleet "now". Nothing here is real force posture.
 */

export type FleetCap = 'MOB' | 'AMD' | 'SUW' | 'ASW' | 'C5I' | 'EW' | 'STRIKE' | 'AMPHIB' | 'AVN' | 'MCM' | 'LOG';
export type FleetId = '2F' | '3F' | '4F' | '5F' | '6F' | '7F';
export type Mode = 'AMC' | 'COMAIR' | 'COD' | 'VERTREP' | 'SEALIFT' | 'TRUCK' | 'COURIER' | 'DATA' | 'ORDERS';
export type PlaceKind = 'depot' | 'port' | 'data';

export interface Place {
  name: string;
  lon: number;
  lat: number;
  kind: PlaceKind;
}

export interface Win {
  label: string;
  /** Place the window is at (used for port closures); 'ship' for at-sea deliveries. */
  at: string;
  start: number;
  end: number;
  enabled?: boolean;
  authority?: string;
}

export interface Issue {
  kind: 'part' | 'person' | 'data';
  cap: FleetCap;
  item: string;
  from: string;
  /** Place id, or 'ship' for delivery to the ship's position. */
  to: string;
  /** Arrival (part, data) or rejoin (person), hours from now. */
  eta: number;
  /** Install / repair / onload hours after delivery. */
  repair?: number;
  mode: Mode;
  via?: 'suez';
  windows?: Win[];
  routine?: boolean;
}

export interface ShipSpec {
  hull: string;
  name: string;
  cls: string;
  fleet: FleetId;
  pos: [number, number];
  state: 'underway' | 'inport' | 'maint';
  mission?: string;
  /** Detailed scenario that drives this hull (engine state at the scenario's watch time). */
  detail?: 'atlas-shield';
  /** Capabilities tracked when the hull has no mission. */
  caps?: FleetCap[];
  /** Required-by for a hull with no mission (next underway / end of availability). */
  dueH?: number;
  issues: Issue[];
}

export interface MissionReq {
  cap: FleetCap;
  k: number;
  ships: string[];
}

export interface MissionSpec {
  id: string;
  name: string;
  kind: string;
  fleet: FleetId;
  area: [number, number];
  radiusKm: number;
  startH: number;
  summary: string;
  reqs: MissionReq[];
}

export const CAP_LABEL: Record<FleetCap, string> = {
  MOB: 'Mobility',
  AMD: 'Air & missile defense',
  SUW: 'Surface warfare',
  ASW: 'Anti-submarine warfare',
  C5I: 'Command, control & comms',
  EW: 'Electronic warfare',
  STRIKE: 'Strike (air wing)',
  AMPHIB: 'Amphibious lift',
  AVN: 'Aviation detachment',
  MCM: 'Mine countermeasures',
  LOG: 'Replenishment',
};

export const FLEET_NAME: Record<FleetId, { name: string; lon: number; lat: number }> = {
  '2F': { name: '2ND FLEET · ATLANTIC', lon: -48, lat: 44 },
  '3F': { name: '3RD FLEET · EASTPAC', lon: -140, lat: 30 },
  '4F': { name: '4TH FLEET · CARIBBEAN', lon: -70, lat: 7 },
  '5F': { name: '5TH FLEET · CENTCOM', lon: 60, lat: 8 },
  '6F': { name: '6TH FLEET · EUROPE', lon: 10, lat: 54 },
  '7F': { name: '7TH FLEET · WESTPAC', lon: 135, lat: 18 },
};

export const PLACES: Record<string, Place> = {
  susquehanna: { name: 'DLA Distribution Susquehanna', lon: -76.87, lat: 40.23, kind: 'depot' },
  sanjoaquin: { name: 'DLA Distribution San Joaquin', lon: -121.3, lat: 37.75, kind: 'depot' },
  crane: { name: 'NSWC Crane', lon: -86.9, lat: 38.86, kind: 'depot' },
  dahlgren: { name: 'NSWC Dahlgren', lon: -77.03, lat: 38.33, kind: 'data' },
  pcd: { name: 'NSWC Panama City', lon: -85.75, lat: 30.17, kind: 'depot' },
  jax: { name: 'FRC Southeast Jacksonville', lon: -81.68, lat: 30.23, kind: 'depot' },
  nasni: { name: 'FRC Southwest North Island', lon: -117.2, lat: 32.7, kind: 'depot' },
  norfolk: { name: 'NS Norfolk', lon: -76.33, lat: 36.95, kind: 'port' },
  yorktown: { name: 'NWS Yorktown', lon: -76.53, lat: 37.24, kind: 'depot' },
  groton: { name: 'SUBASE New London', lon: -72.09, lat: 41.39, kind: 'port' },
  mayport: { name: 'NS Mayport', lon: -81.41, lat: 30.39, kind: 'port' },
  sandiego: { name: 'NB San Diego', lon: -117.12, lat: 32.68, kind: 'port' },
  puget: { name: 'Puget Sound NSY', lon: -122.63, lat: 47.56, kind: 'port' },
  pearl: { name: 'JB Pearl Harbor-Hickam', lon: -157.95, lat: 21.35, kind: 'port' },
  guam: { name: 'Apra Harbor, Guam', lon: 144.65, lat: 13.44, kind: 'port' },
  yokosuka: { name: 'FLC Yokosuka', lon: 139.67, lat: 35.29, kind: 'port' },
  sasebo: { name: 'FLC Sasebo', lon: 129.72, lat: 33.16, kind: 'port' },
  singapore: { name: 'Sembawang, Singapore', lon: 103.83, lat: 1.46, kind: 'port' },
  diego: { name: 'NSF Diego Garcia', lon: 72.42, lat: -7.31, kind: 'depot' },
  bahrain: { name: 'NSA Bahrain', lon: 50.61, lat: 26.21, kind: 'port' },
  duqm: { name: 'Port of Duqm', lon: 57.7, lat: 19.67, kind: 'port' },
  djibouti: { name: 'Djibouti', lon: 43.15, lat: 11.55, kind: 'port' },
  souda: { name: 'NSA Souda Bay', lon: 24.12, lat: 35.49, kind: 'port' },
  sigonella: { name: 'NAS Sigonella', lon: 14.92, lat: 37.4, kind: 'depot' },
  naples: { name: 'NSA Naples', lon: 14.27, lat: 40.84, kind: 'port' },
  rota: { name: 'NAVSTA Rota', lon: -6.35, lat: 36.62, kind: 'port' },
  keflavik: { name: 'Keflavik, Iceland', lon: -22.6, lat: 63.98, kind: 'port' },
  bergen: { name: 'Haakonsvern, Norway', lon: 5.23, lat: 60.33, kind: 'port' },
};

const part = (cap: FleetCap, item: string, from: string, to: string, eta: number, repair: number, mode: Mode, extra: Partial<Issue> = {}): Issue => ({ kind: 'part', cap, item, from, to, eta, repair, mode, ...extra });
const person = (cap: FleetCap, item: string, from: string, to: string, eta: number): Issue => ({ kind: 'person', cap, item, from, to, eta, mode: 'ORDERS' });
const data = (cap: FleetCap, item: string, from: string, eta: number): Issue => ({ kind: 'data', cap, item, from, to: 'ship', eta, mode: 'DATA' });
const win = (label: string, at: string, start: number, end: number, extra: Partial<Win> = {}): Win => ({ label, at, start, end, ...extra });

export const MISSIONS: MissionSpec[] = [
  {
    id: 'atlas', name: 'ATLAS SHIELD', kind: 'BMD patrol', fleet: '6F', area: [25.5, 34.2], radiusKm: 260, startH: 330,
    summary: 'Two BMD-capable destroyers on station in the eastern Mediterranean.',
    reqs: [{ cap: 'AMD', k: 2, ships: ['DDG-170', 'DDG-173', 'DDG-174'] }, { cap: 'C5I', k: 2, ships: ['DDG-170', 'DDG-173', 'DDG-174'] }],
  },
  {
    id: 'vigil', name: 'NORTHERN VIGIL', kind: 'ASW barrier', fleet: '2F', area: [-12, 63.2], radiusKm: 420, startH: 96,
    summary: 'Hold an anti-submarine barrier across the GIUK gap.',
    reqs: [{ cap: 'ASW', k: 2, ships: ['FFG-179', 'DDG-177', 'SSN-822'] }],
  },
  {
    id: 'csg14', name: 'CSG-14 ON STATION', kind: 'Carrier strike group', fleet: '5F', area: [63, 17.4], radiusKm: 360, startH: 72,
    summary: 'Carrier strike group on station in the Arabian Sea with integrated air defense and an oiler.',
    reqs: [
      { cap: 'STRIKE', k: 1, ships: ['CVN-85'] },
      { cap: 'AMD', k: 2, ships: ['CG-183', 'DDG-171', 'DDG-172'] },
      { cap: 'LOG', k: 1, ships: ['T-AO-215'] },
    ],
  },
  {
    id: 'arg', name: 'ARG-7 / 26TH MEU', kind: 'Amphibious ready group', fleet: '5F', area: [46.5, 12.4], radiusKm: 260, startH: 120,
    summary: 'Amphibious ready group postured in the Gulf of Aden.',
    reqs: [{ cap: 'AMPHIB', k: 2, ships: ['LHA-180', 'LPD-178', 'LSD-53'] }, { cap: 'AVN', k: 1, ships: ['LHA-180'] }],
  },
  {
    id: 'guard', name: 'PROSPERITY GUARD', kind: 'Maritime security', fleet: '5F', area: [40.2, 17.8], radiusKm: 300, startH: 48,
    summary: 'Escort merchant traffic through the southern Red Sea.',
    reqs: [{ cap: 'AMD', k: 2, ships: ['DDG-175', 'DDG-181', 'FFG-182'] }, { cap: 'SUW', k: 2, ships: ['DDG-175', 'DDG-181', 'FFG-182'] }],
  },
  {
    id: 'mcm', name: 'CLEAR PASSAGE', kind: 'Mine countermeasures', fleet: '5F', area: [56.4, 26.4], radiusKm: 160, startH: 60,
    summary: 'Clear and hold a lane through the Strait of Hormuz approaches.',
    reqs: [{ cap: 'MCM', k: 1, ships: ['LCS-41'] }, { cap: 'AVN', k: 1, ships: ['ESB-9'] }],
  },
  {
    id: 'sentry', name: 'PACIFIC SENTRY', kind: 'Presence / FONOP', fleet: '7F', area: [114.5, 12.5], radiusKm: 320, startH: 36,
    summary: 'Freedom-of-navigation transit in the South China Sea.',
    reqs: [{ cap: 'SUW', k: 1, ships: ['DDG-184', 'LCS-42'] }, { cap: 'AMD', k: 1, ships: ['DDG-184'] }],
  },
  {
    id: 'keen', name: 'KEEN EDGE 27', kind: 'Combined exercise', fleet: '7F', area: [136, 22], radiusKm: 420, startH: 168,
    summary: 'Combined air-defense exercise in the Philippine Sea.',
    reqs: [{ cap: 'AMD', k: 2, ships: ['CG-186', 'DDG-185', 'DDG-187'] }, { cap: 'C5I', k: 1, ships: ['CG-186'] }],
  },
  {
    id: 'hadr', name: 'PACIFIC MERCY', kind: 'Humanitarian response', fleet: '7F', area: [125, 11.2], radiusKm: 240, startH: 54,
    summary: 'Typhoon relief in the central Philippines: lift, aviation and relief cargo.',
    reqs: [{ cap: 'AMPHIB', k: 1, ships: ['LPD-188'] }, { cap: 'AVN', k: 1, ships: ['LPD-188'] }, { cap: 'LOG', k: 1, ships: ['T-AKE-16'] }],
  },
  {
    id: 'south', name: 'SOUTHERN SHIELD', kind: 'Counter-narcotics', fleet: '4F', area: [-76, 13.5], radiusKm: 380, startH: 60,
    summary: 'Detect and monitor in the Caribbean with an embarked helicopter.',
    reqs: [{ cap: 'SUW', k: 1, ships: ['FFG-189', 'LCS-43'] }, { cap: 'AVN', k: 1, ships: ['FFG-189', 'LCS-43'] }],
  },
  {
    id: 'comptuex', name: 'COMPTUEX CSG-16', kind: 'Pre-deployment certification', fleet: '3F', area: [-119.6, 32.4], radiusKm: 260, startH: 240,
    summary: 'Strike group certification off Southern California.',
    reqs: [{ cap: 'STRIKE', k: 1, ships: ['CVN-86'] }, { cap: 'AMD', k: 2, ships: ['CG-192', 'DDG-190', 'DDG-191'] }],
  },
  {
    id: 'homeland', name: 'HOMELAND BMD', kind: 'BMD patrol', fleet: '3F', area: [-158.6, 20.6], radiusKm: 220, startH: 36,
    summary: 'Ballistic missile defense picket off Hawaii.',
    reqs: [{ cap: 'AMD', k: 1, ships: ['DDG-193'] }],
  },
];

export const SHIPS: ShipSpec[] = [
  /* ATLAS SHIELD */
  { hull: 'DDG-170', name: 'USS GRACE HOPPER', cls: 'DDG Flt III', fleet: '2F', pos: [-76.33, 36.95], state: 'inport', mission: 'atlas', detail: 'atlas-shield', issues: [] },
  {
    hull: 'DDG-173', name: 'USS MARY G. ROSS', cls: 'DDG Flt IIA', fleet: '6F', pos: [24.12, 35.49], state: 'inport', mission: 'atlas',
    issues: [
      part('AMD', 'SM-2 Blk IIIC reload (VLS)', 'yorktown', 'souda', 300, 24, 'AMC', { windows: [win('Souda weapons pier', 'souda', 320, 344)] }),
      part('AMD', 'CIWS servo amplifier', 'sigonella', 'souda', 60, 6, 'COMAIR'),
      part('C5I', 'Mission KEYMAT', 'naples', 'ship', 200, 2, 'COURIER'),
    ],
  },
  {
    hull: 'DDG-174', name: 'USS CLAUDE SHANNON', cls: 'DDG Flt III', fleet: '6F', pos: [19.6, 37.1], state: 'underway', mission: 'atlas',
    issues: [
      part('AMD', 'SPY-6 radar module assembly', 'crane', 'souda', 96, 6, 'AMC', { windows: [win('Souda port visit', 'souda', 150, 190)] }),
      person('C5I', 'IT1 K. Moss (crypto custodian)', 'naples', 'souda', 120),
    ],
  },
  { hull: 'CG-176', name: 'USS LEXINGTON GREEN', cls: 'CG', fleet: '6F', pos: [24.19, 35.5], state: 'inport', caps: ['MOB', 'AMD'], dueH: 42, issues: [] },

  /* NORTHERN VIGIL */
  {
    hull: 'FFG-179', name: 'USS VIGILANT', cls: 'FFG Constellation', fleet: '2F', pos: [-17.5, 62.2], state: 'underway', mission: 'vigil',
    issues: [part('ASW', 'MH-60R tail rotor gearbox', 'jax', 'keflavik', 30, 4, 'AMC', { windows: [win('Keflavik helo pickup', 'keflavik', 36, 60)] })],
  },
  {
    hull: 'DDG-177', name: 'USS DOROTHY VAUGHAN', cls: 'DDG Flt IIA', fleet: '6F', pos: [2.5, 65.5], state: 'underway', mission: 'vigil',
    issues: [
      part('ASW', 'TB-37 towed array module', 'susquehanna', 'bergen', 50, 18, 'COMAIR', {
        windows: [win('Haakonsvern pier', 'bergen', 60, 72), win('VERTREP from T-AO-216', 'ship', 130, 134, { enabled: false, authority: 'COMSC (off-ship)' })],
      }),
    ],
  },
  {
    hull: 'SSN-822', name: 'USS BLUEFIN', cls: 'SSN Virginia', fleet: '2F', pos: [-8.5, 59.3], state: 'underway', mission: 'vigil',
    issues: [person('MOB', 'ETN1 R. Vance (reactor operator)', 'groton', 'ship', 110)],
  },

  /* CSG-14 */
  {
    hull: 'CVN-85', name: 'USS MARGARET HAMILTON', cls: 'CVN Ford', fleet: '5F', pos: [62.6, 17.4], state: 'underway', mission: 'csg14',
    issues: [
      part('STRIKE', 'F414 engines (2) for VFA-213', 'jax', 'bahrain', 20, 6, 'AMC', {
        windows: [win('COD run 1', 'bahrain', 24, 26), win('COD run 2', 'bahrain', 48, 50), win('COD run 3', 'bahrain', 72, 74)],
      }),
      person('STRIKE', 'CVW-14 landing signal officer', 'nasni', 'ship', 30),
    ],
  },
  {
    hull: 'CG-183', name: 'USS CORAL HARBOR', cls: 'CG', fleet: '5F', pos: [61.7, 18.3], state: 'underway', mission: 'csg14',
    issues: [person('AMD', 'NSWC tech rep (SPY-1B phase shifter)', 'dahlgren', 'bahrain', 90)],
  },
  {
    hull: 'DDG-171', name: 'USS KATHERINE JOHNSON', cls: 'DDG Flt IIA', fleet: '5F', pos: [63.7, 16.5], state: 'underway', mission: 'csg14',
    issues: [data('AMD', 'Aegis BMD patch (BL9.C2)', 'dahlgren', 20)],
  },
  {
    hull: 'DDG-172', name: 'USS JOHN BARDEEN', cls: 'DDG Flt IIA', fleet: '5F', pos: [64.3, 18.3], state: 'underway', mission: 'csg14',
    issues: [part('AMD', 'SPY-1D crossed-field amplifier', 'susquehanna', 'duqm', 30, 8, 'COMAIR', { windows: [win('VERTREP from T-AO-215', 'ship', 52, 56)] })],
  },
  {
    hull: 'T-AO-215', name: 'USNS FRANCES PERKINS', cls: 'T-AO John Lewis', fleet: '5F', pos: [60.4, 16.6], state: 'underway', mission: 'csg14',
    issues: [part('LOG', 'Dry stores & aviation parts lift', 'norfolk', 'duqm', 50, 6, 'SEALIFT', { via: 'suez', windows: [win('Duqm onload', 'duqm', 48, 60)] })],
  },

  /* ARG */
  {
    hull: 'LHA-180', name: 'USS OKINAWA SHORE', cls: 'LHA America', fleet: '5F', pos: [47.6, 12.7], state: 'underway', mission: 'arg',
    issues: [
      part('AMPHIB', 'LCAC lift fan assembly', 'pcd', 'djibouti', 70, 30, 'AMC', { windows: [win('Djibouti pier', 'djibouti', 72, 96)] }),
      person('AVN', 'VMM-268 maintenance chief', 'nasni', 'ship', 60),
    ],
  },
  { hull: 'LPD-178', name: 'USS LAS CRUCES', cls: 'LPD San Antonio', fleet: '5F', pos: [46.1, 12.2], state: 'underway', mission: 'arg', issues: [data('AMPHIB', 'LCAC navigation software load', 'pcd', 40)] },
  {
    hull: 'LSD-53', name: 'USS CUMBERLAND GAP', cls: 'LSD Harpers Ferry', fleet: '5F', pos: [43.25, 11.7], state: 'inport', mission: 'arg',
    issues: [part('AMPHIB', 'Well deck ballast pump motor', 'sanjoaquin', 'djibouti', 100, 30, 'COMAIR', { windows: [win('Djibouti pier', 'djibouti', 0, 140)] })],
  },

  /* PROSPERITY GUARD */
  { hull: 'DDG-175', name: 'USS EDITH CLARKE', cls: 'DDG Flt IIA', fleet: '5F', pos: [39.7, 19.3], state: 'underway', mission: 'guard', issues: [data('AMD', 'Threat library update (one-way attack UAS)', 'dahlgren', 10)] },
  {
    hull: 'DDG-181', name: 'USS VANNEVAR BUSH', cls: 'DDG Flt III', fleet: '5F', pos: [41.3, 16.3], state: 'underway', mission: 'guard',
    issues: [part('AMD', 'SM-2 Blk IIIC reload (8 rounds)', 'souda', 'djibouti', 18, 6, 'SEALIFT', { via: 'suez', windows: [win('Djibouti ammo anchorage', 'djibouti', 18, 30)] })],
  },
  { hull: 'FFG-182', name: 'USS DAUNTLESS', cls: 'FFG Constellation', fleet: '5F', pos: [43.5, 13.3], state: 'underway', mission: 'guard', issues: [person('SUW', 'FC1 A. Okoye (Mk 110 gun)', 'norfolk', 'djibouti', 30)] },

  /* CLEAR PASSAGE */
  { hull: 'LCS-41', name: 'USS BELLINGHAM', cls: 'LCS Independence · MCM', fleet: '5F', pos: [50.75, 26.3], state: 'inport', mission: 'mcm', issues: [part('MCM', 'Knifefish UUV battery modules', 'pcd', 'bahrain', 30, 12, 'AMC')] },
  { hull: 'ESB-9', name: 'USS CALVIN GRAHAM', cls: 'ESB Puller', fleet: '5F', pos: [55.9, 26.1], state: 'underway', mission: 'mcm', issues: [person('AVN', 'HM-15 det OIC (MH-53E)', 'norfolk', 'bahrain', 20)] },

  /* PACIFIC SENTRY */
  {
    hull: 'DDG-184', name: 'USS ANNIE EASLEY', cls: 'DDG Flt III', fleet: '7F', pos: [114.6, 12.6], state: 'underway', mission: 'sentry',
    issues: [part('AMD', 'Aegis display console card', 'yokosuka', 'singapore', 6, 4, 'COMAIR', { windows: [win('Singapore logistics hub', 'singapore', 8, 30)] })],
  },
  { hull: 'LCS-42', name: 'USS PADUCAH', cls: 'LCS Freedom', fleet: '7F', pos: [104.1, 1.2], state: 'inport', mission: 'sentry', issues: [part('SUW', 'Mk 110 57mm gun barrel', 'sanjoaquin', 'singapore', 40, 6, 'COMAIR')] },

  /* KEEN EDGE */
  { hull: 'CG-186', name: 'USS SURIGAO STRAIT', cls: 'CG', fleet: '7F', pos: [133.9, 24.6], state: 'underway', mission: 'keen', issues: [part('C5I', 'Link 16 KEYMAT (DCS courier)', 'yokosuka', 'ship', 60, 2, 'COURIER')] },
  { hull: 'DDG-185', name: 'USS RICHARD FEYNMAN', cls: 'DDG Flt IIA', fleet: '7F', pos: [139.64, 35.3], state: 'inport', mission: 'keen', issues: [part('MOB', 'LM2500 fuel control unit', 'sanjoaquin', 'yokosuka', 120, 60, 'AMC')] },
  {
    hull: 'DDG-187', name: 'USS NORBERT WIENER', cls: 'DDG Flt IIA', fleet: '7F', pos: [145.6, 14.9], state: 'underway', mission: 'keen',
    issues: [part('AMD', 'SPY-1D signal processor card', 'sanjoaquin', 'guam', 60, 8, 'AMC', { windows: [win('Apra Harbor port visit', 'guam', 70, 90)] })],
  },

  /* PACIFIC MERCY */
  { hull: 'LPD-188', name: 'USS BOZEMAN', cls: 'LPD San Antonio', fleet: '7F', pos: [129.6, 33.0], state: 'inport', mission: 'hadr', issues: [person('AVN', 'HSC-25 det (MH-60S)', 'yokosuka', 'sasebo', 20)] },
  {
    hull: 'T-AKE-16', name: 'USNS ZEBULON PIKE', cls: 'T-AKE Lewis & Clark', fleet: '7F', pos: [144.75, 13.35], state: 'inport', mission: 'hadr',
    issues: [part('LOG', 'Relief cargo: water, generators', 'guam', 'ship', 24, 12, 'SEALIFT', { windows: [win('Apra onload', 'guam', 24, 48)] })],
  },

  /* SOUTHERN SHIELD */
  { hull: 'FFG-189', name: 'USS STEADFAST', cls: 'FFG Constellation', fleet: '4F', pos: [-74.6, 14.4], state: 'underway', mission: 'south', issues: [person('AVN', 'HSM-60 det aircraft commander', 'mayport', 'ship', 76)] },
  { hull: 'LCS-43', name: 'USS LAREDO', cls: 'LCS Freedom', fleet: '4F', pos: [-79.4, 10.0], state: 'underway', mission: 'south', issues: [part('SUW', '30mm gun feeder assembly', 'jax', 'ship', 10, 3, 'COMAIR')] },

  /* COMPTUEX */
  { hull: 'CVN-86', name: 'USS ROBERT GODDARD', cls: 'CVN Ford', fleet: '3F', pos: [-119.7, 32.4], state: 'underway', mission: 'comptuex', issues: [person('STRIKE', 'CVW-16 landing signal officers (2)', 'nasni', 'ship', 222)] },
  { hull: 'CG-192', name: 'USS CAPE ESPERANCE', cls: 'CG', fleet: '3F', pos: [-118.9, 31.9], state: 'underway', mission: 'comptuex', issues: [data('AMD', 'Aegis baseline patch (ACB-16)', 'dahlgren', 100)] },
  {
    hull: 'DDG-190', name: 'USS HEDY LAMARR', cls: 'DDG Flt III', fleet: '3F', pos: [-120.4, 33.1], state: 'underway', mission: 'comptuex',
    issues: [part('AMD', 'SPY-1D crossed-field amplifier', 'susquehanna', 'sandiego', 96, 8, 'COMAIR', { windows: [win('San Diego pier', 'sandiego', 0, 200)] })],
  },
  { hull: 'DDG-191', name: 'USS JOHN VON NEUMANN', cls: 'DDG Flt IIA', fleet: '3F', pos: [-117.2, 32.64], state: 'inport', mission: 'comptuex', issues: [part('MOB', 'SSGTG governor', 'sanjoaquin', 'sandiego', 48, 12, 'TRUCK')] },

  /* HOMELAND BMD */
  { hull: 'DDG-193', name: 'USS GERTRUDE ELION', cls: 'DDG Flt III', fleet: '3F', pos: [-158.3, 21.1], state: 'underway', mission: 'homeland', issues: [data('AMD', 'BMD engagement-support data', 'dahlgren', 6)] },

  /* In maintenance */
  {
    hull: 'SSN-823', name: 'USS GARFISH', cls: 'SSN Virginia', fleet: '3F', pos: [-122.62, 47.55], state: 'maint', caps: ['MOB'], dueH: 24 * 45,
    issues: [part('MOB', 'Main seawater hull valve', 'sanjoaquin', 'puget', 200, 72, 'TRUCK'), part('MOB', 'Reactor plant pump seal kit', 'crane', 'puget', 150, 48, 'COMAIR')],
  },
  {
    hull: 'DDG-194', name: 'USS ROBERT NOYCE', cls: 'DDG Flt IIA', fleet: '3F', pos: [-117.05, 32.7], state: 'maint', caps: ['MOB', 'AMD'], dueH: 24 * 30,
    issues: [part('AMD', 'SPY-1D array refurbishment (depot)', 'crane', 'sandiego', 300, 96, 'TRUCK')],
  },

  /* Combat logistics, unassigned */
  { hull: 'T-AO-216', name: 'USNS JANE ADDAMS', cls: 'T-AO John Lewis', fleet: '2F', pos: [-40.5, 36.2], state: 'underway', caps: ['MOB', 'LOG'], dueH: 96, issues: [part('LOG', 'UNREP rig wire & fittings', 'norfolk', 'ship', 30, 6, 'VERTREP')] },
  { hull: 'T-AKE-17', name: 'USNS JOHN WESLEY POWELL', cls: 'T-AKE Lewis & Clark', fleet: '6F', pos: [17.6, 34.9], state: 'underway', caps: ['MOB', 'LOG'], dueH: 120, issues: [part('LOG', 'Ammunition lift (SM-2 / ESSM)', 'yorktown', 'souda', 70, 12, 'SEALIFT')] },
];

/** Theater depots for routine resupply (chosen so the curated disruptions below never touch routine flows). */
export const ROUTINE_DEPOTS: Record<FleetId, string[]> = {
  '2F': ['norfolk', 'jax', 'crane'],
  '3F': ['sandiego', 'sanjoaquin', 'pearl'],
  '4F': ['mayport', 'jax'],
  '5F': ['bahrain', 'diego', 'djibouti'],
  '6F': ['sigonella', 'naples', 'rota'],
  '7F': ['yokosuka', 'sasebo', 'singapore'],
};

export const ROUTINE_ITEMS = [
  'PMS kit (MRC 3M)', 'Fuel filter elements', 'Hydraulic pump seal kit', 'Radar cooling pump', 'SATCOM modem card', 'Aviation consumables',
  'Medical resupply', 'Reverse-osmosis membranes', 'Firemain valve', 'UNREP rig spares', 'Server blade (CANES)', 'Small arms ammunition',
  'Sonar dome patch kit', 'Gas turbine igniter plugs', 'Chilled water pump', 'Night vision batteries', 'Galley equipment', 'IFF transponder card',
];

export interface Disruption {
  id: string;
  label: string;
  detail: string;
  match: { mode?: Mode[]; via?: 'suez'; place?: string; from?: string[]; kind?: Issue['kind'] };
  delayH?: number;
  /** Port windows at this place stay closed until `until`. */
  closePlace?: { place: string; until: number };
  /** Personnel records cannot be confirmed: flagged stale. */
  stale?: boolean;
}

export const DISRUPTIONS: Disruption[] = [
  { id: 'amc', label: 'AMC airlift stand-down', detail: 'Fleet-wide C-17 / C-5 maintenance stand-down. AMC-moved cargo slips 48h.', match: { mode: ['AMC'] }, delayH: 48 },
  { id: 'suez', label: 'Suez Canal closed', detail: 'Sealift re-routes around the Cape of Good Hope: cargo that would transit Suez slips 9 days.', match: { via: 'suez' }, delayH: 216 },
  { id: 'typhoon', label: 'Typhoon · Guam', detail: 'Apra Harbor closed 96h. Cargo to or from Guam slips 72h and port windows there stay shut until it reopens.', match: { place: 'guam' }, delayH: 72, closePlace: { place: 'guam', until: 96 } },
  { id: 'dla', label: 'DLA Susquehanna backlog', detail: 'Distribution-center backlog: material issued from Susquehanna slips 4 days.', match: { from: ['susquehanna'] }, delayH: 96 },
  { id: 'nsips', label: 'NSIPS outage', detail: 'Personnel system down: rejoin and qualification dates cannot be confirmed (flagged stale).', match: { kind: 'person' }, stale: true },
  { id: 'satcom', label: 'SATCOM degraded', detail: 'Wideband SATCOM degraded: shore data releases slip 24h.', match: { kind: 'data' }, delayH: 24 },
];

/** Packages of the detailed scenario, described the same way so fleet disruptions apply to them. */
export const DETAIL_LEGS: Record<'atlas-shield', Record<string, { node: string; kind: Issue['kind']; mode: Mode; from: string; via?: 'suez' }>> = {
  'atlas-shield': {
    leg_cfa: { node: 'in_cfa_eta', kind: 'part', mode: 'COMAIR', from: 'susquehanna' },
    leg_martinez: { node: 'p_fc1_martinez', kind: 'person', mode: 'ORDERS', from: 'damneck' },
    leg_okafor: { node: 'p_fc2_okafor', kind: 'person', mode: 'ORDERS', from: 'atlanta' },
    leg_helo: { node: 'in_helo_det', kind: 'part', mode: 'COD', from: 'chambers' },
    leg_keymat: { node: 'in_keymat', kind: 'part', mode: 'COURIER', from: 'dcs' },
    leg_ewdf: { node: 'in_ew_lib', kind: 'data', mode: 'DATA', from: 'niocn' },
  },
};
