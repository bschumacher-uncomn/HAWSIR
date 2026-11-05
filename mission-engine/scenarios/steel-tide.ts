/**
 * Operation STEEL TIDE (synthetic, unclassified).
 *
 * A carrier strike group with a CLF oiler and a T-AKE is tasked with a TLAM
 * strike at H-hour (t=60). Facts arrive over the watch:
 *   H-6  (t=54) Kittredge's SATCOM modem fails (C-3 CASREP); the part is at the
 *               forward airfield; two supply systems disagree on its ETA; one of
 *               the two qualified ETs is sick in quarters.
 *   H-2  (t=58) The forward site (Port Alpha and its airfield) is closed after
 *               an attack (the NSA Bahrain analog); supply re-routes the part to
 *               Atoll Bravo, 2,000 nm away (beyond CMV-22B range).
 * Strike EMCON runs H-4 to H+16, which blocks the Link-16 relay of launch
 * authority through the cruiser.
 *
 * Every hull, name and number here is fictional. Planning factors come from the
 * cited tables in the naval pack; scenario values are synthetic.
 */
import type { NavalModel, PersonSpec, ShipSpec, SystemSpec } from '../src/packs/naval/model';
import type { FactInput } from '../src/data/store';

export const H = 60;

const sys = (ship: string, kind: SystemSpec['kind'], label: string, n = 1): SystemSpec[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${ship}-${kind}${n > 1 ? `-${i + 1}` : ''}`, kind, label: n > 1 ? `${label} ${i + 1}` : label }));

const combatantSystems = (ship: string): SystemSpec[] => [
  ...sys(ship, 'gtm', 'GTM (LM2500)', 4),
  ...sys(ship, 'ssgtg', 'SSGTG', 3),
  ...sys(ship, 'steering', 'Steering gear'),
  ...sys(ship, 'spy', 'SPY-1D radar'),
  ...sys(ship, 'aegis', 'Aegis weapon system'),
  ...sys(ship, 'vls', 'Mk 41 VLS'),
  ...sys(ship, 'ttwcs', 'Tactical Tomahawk WCS'),
  ...sys(ship, 'satcom', 'SATCOM terminal'),
  ...sys(ship, 'link16', 'Link-16 terminal'),
];

const team = (ship: string, names: [string, string[]][]): PersonSpec[] =>
  names.map(([label, quals], i) => ({ id: `${ship}-p${i + 1}`, label, quals }));

const dash = (cruise: number, sprint: number) => [
  { from: -Infinity, to: 40, kt: cruise, label: 'on station' },
  { from: 40, to: 60, kt: sprint, label: 'dash to launch basket' },
  { from: 60, to: Infinity, kt: cruise, label: 'post-strike station' },
];

const ships: ShipSpec[] = [
  {
    id: 'cvn', name: 'Resolute', hull: 'CVN-90', cls: 'CVN', group: 'csg',
    systems: [...sys('cvn', 'satcom', 'SATCOM terminal'), ...sys('cvn', 'link16', 'Link-16 terminal'), ...sys('cvn', 'flightdeck', 'Flight deck'), ...sys('cvn', 'cmv22', 'CMV-22B', 2)],
    mets: ['CCC', 'COD'],
  },
  {
    id: 'cg', name: 'Port Harmon', hull: 'CG-91', cls: 'CG-47', group: 'csg', systems: combatantSystems('cg'), fuel: true,
    magazines: [{ weapon: 'TLAM', capacity: 40 }, { weapon: 'SM', capacity: 80 }], speedPlan: dash(18, 26),
    people: team('cg', [['LCDR R. Vance', ['AMD']], ['LT D. Osei', ['AMD']], ['LTJG P. Lund', ['AMD']], ['FC1 J. Mora', ['STRIKE']], ['FC2 A. Quinn', ['STRIKE']], ['FC2 L. Ruiz', ['STRIKE']]]),
  },
  {
    id: 'ddgB', name: 'Kittredge', hull: 'DDG-181', cls: 'DDG-51', group: 'csg', systems: combatantSystems('ddgB'), fuel: true,
    magazines: [{ weapon: 'TLAM', capacity: 30 }, { weapon: 'SM', capacity: 50 }], speedPlan: dash(18, 26),
    people: team('ddgB', [['LCDR K. Ames', ['AMD']], ['LT S. Brandt', ['AMD']], ['LT J. Cole', ['AMD']], ['FC1 T. Martinez', ['STRIKE']], ['FC2 B. Hale', ['STRIKE']], ['FC3 M. Diaz', ['STRIKE']], ['ET1 A. Reyes', ['ET']], ['ET2 C. Park', ['ET']]]),
  },
  {
    id: 'ddgC', name: 'Marlowe', hull: 'DDG-182', cls: 'DDG-51', group: 'csg', systems: combatantSystems('ddgC'), fuel: true,
    magazines: [{ weapon: 'TLAM', capacity: 24 }, { weapon: 'SM', capacity: 50 }], speedPlan: dash(18, 26),
    people: team('ddgC', [['LT N. Ford', ['AMD']], ['LT E. Shah', ['AMD']], ['LTJG W. Kim', ['AMD']], ['FC1 G. Ortiz', ['STRIKE']], ['FC2 H. Lowe', ['STRIKE']], ['FC2 R. Baptiste', ['STRIKE']]]),
  },
  {
    id: 'ddgD', name: 'Okafor', hull: 'DDG-183', cls: 'DDG-51', group: 'csg', systems: combatantSystems('ddgD'), fuel: true,
    magazines: [{ weapon: 'TLAM', capacity: 24 }, { weapon: 'SM', capacity: 50 }], speedPlan: dash(18, 26),
    people: team('ddgD', [['LT A. Nwosu', ['AMD']], ['LT F. Grant', ['AMD']], ['LTJG T. Webb', ['AMD']], ['FC1 Y. Ito', ['STRIKE', 'FC']], ['FC2 D. Burke', ['STRIKE', 'FC']], ['FC3 K. Silva', ['STRIKE']]]),
  },
  { id: 'oiler', name: 'Ada Brooks', hull: 'T-AO-221', cls: 'T-AO', group: 'clf', systems: [] },
  { id: 'take', name: 'Iris Calder', hull: 'T-AKE-21', cls: 'T-AKE', group: 'clf', systems: [] },
];

const codSlots = Array.from({ length: 14 }, (_, i) => {
  const day = Math.floor(i / 2);
  const hour = i % 2 === 0 ? 8 : 16;
  return { id: `cod-d${day}-${hour}`, label: `COD day ${day} ${String(hour).padStart(2, '0')}00`, depart: day * 24 + hour };
});

export const steelTideModel: NavalModel = {
  id: 'steel-tide',
  name: 'Operation STEEL TIDE',
  epochUtc: '2026-11-10T00:00:00Z',
  horizon: [0, 168],
  marks: { H },
  groups: [
    {
      id: 'csg', name: 'CSG-X', kind: 'CSG', commander: 'CSG-X Commander (CWC)', members: ['cvn', 'cg', 'ddgB', 'ddgC', 'ddgD'],
      rollups: [{ code: 'AW', label: 'air & missile defense screen (3 of 4 escorts)', k: 3, window: [56, 120], severity: 'II' }],
    },
    { id: 'clf', name: 'CLF-X', kind: 'CLF', commander: 'CTF Logistics', members: ['oiler', 'take'] },
  ],
  ships,
  network: {
    nodes: [
      { id: 'alpha-port', name: 'Port Alpha', kind: 'hub', site: 'alpha' },
      { id: 'alpha-field', name: 'Alpha Airfield', kind: 'airfield', site: 'alpha' },
      { id: 'bravo', name: 'Atoll Bravo', kind: 'hub' },
      { id: 'delta', name: 'Station Delta', kind: 'opArea' },
    ],
    arcs: [
      { from: 'alpha-port', to: 'delta', nm: 600 },
      { from: 'alpha-field', to: 'delta', nm: 300 },
      { from: 'bravo', to: 'delta', nm: 2000 },
    ],
  },
  cod: {
    aircraft: 'CMV-22B', carrier: 'cvn', opArea: 'delta', airfields: ['alpha-field', 'bravo'],
    slots: codSlots, slotHours: 1, payloadLb: 400, crossDeckHours: 1.5, leadTimeHours: 4,
  },
  shuttle: { ship: 'take', cls: 'T-AKE', hubs: ['bravo', 'alpha-port'], opArea: 'delta', loadHours: 6, transferHours: 1 },
  strikes: [
    {
      id: 'tide', name: 'STEEL TIDE', hHour: H, windowHours: 2, weapon: 'TLAM', group: 'csg', severity: 'I',
      shooters: [{ ship: 'ddgB', rounds: 16 }, { ship: 'ddgC', rounds: 8 }],
      launchAuthority: 'CSG-X Commander (STWC)', taskingAuthority: 'JFMCC', relayVia: 'cg',
    },
  ],
  unreps: [
    {
      id: 'consol1', label: 'CONSOL 1 (Ada Brooks)', provider: 'oiler', providerCls: 'T-AO', receivers: ['cg', 'ddgB', 'ddgC', 'ddgD'], rendezvous: 'delta',
      departFrom: [{ hub: 'alpha-port', readyAt: 36 }, { hub: 'bravo', readyAt: 40 }], oneHose: ['ddgB'],
    },
  ],
  windows: { mob: [0, 120], aw: [56, 120], ccc: [0, 120] },
  qMarginH: 6,
};

const base = (x: Partial<FactInput> & Pick<FactInput, 'entity' | 'attr' | 'value' | 'source'>): FactInput => ({
  observedAt: 0, recordedAt: 0, recordedBy: 'synthetic-feed', ...x,
});
const feed = (system: string, recordId?: string) => ({ system, recordId, kind: 'synthetic' as const });

/** Facts known before the watch starts (t ≤ 0). */
export function baselineFacts(): FactInput[] {
  const fuel = (ship: string, v: number, t: number, system = 'FUEL-RPT') =>
    base({ entity: ship, attr: 'fuel_pct', value: v, observedAt: t, recordedAt: t, source: feed(system, `${ship.toUpperCase()}-F-${t}`) });
  return [
    // fuel reports (consistent with the GAO burn table and each ship's speed plan)
    fuel('cg', 70, 0), fuel('ddgB', 57, 0), fuel('ddgC', 62, 0), fuel('ddgD', 66, 0),
    // magazines (CG TLAM count deliberately not reported)
    base({ entity: 'ddgB/TLAM', attr: 'magazine', value: 20, source: feed('ORD-LOADOUT', 'OL-181') }),
    base({ entity: 'ddgB/SM', attr: 'magazine', value: 36, source: feed('ORD-LOADOUT', 'OL-181') }),
    base({ entity: 'ddgC/TLAM', attr: 'magazine', value: 12, source: feed('ORD-LOADOUT', 'OL-182') }),
    base({ entity: 'ddgC/SM', attr: 'magazine', value: 30, source: feed('ORD-LOADOUT', 'OL-182') }),
    base({ entity: 'ddgD/TLAM', attr: 'magazine', value: 10, source: feed('ORD-LOADOUT', 'OL-183') }),
    base({ entity: 'ddgD/SM', attr: 'magazine', value: 40, source: feed('ORD-LOADOUT', 'OL-183') }),
    base({ entity: 'cg/SM', attr: 'magazine', value: 60, source: feed('ORD-LOADOUT', 'OL-91') }),
    // DRRS-N reported assessments (Kittredge's STW report is 31+ days old)
    base({ entity: 'ddgB/STW', attr: 'met_assessment', value: 'Y', observedAt: -760, recordedAt: -760, source: feed('DRRS-N', 'DDG181-STW') }),
    base({ entity: 'ddgB/AW', attr: 'met_assessment', value: 'Y', observedAt: -100, recordedAt: -100, source: feed('DRRS-N', 'DDG181-AW') }),
    base({ entity: 'ddgC/STW', attr: 'met_assessment', value: 'Y', observedAt: -100, recordedAt: -100, source: feed('DRRS-N', 'DDG182-STW') }),
    base({ entity: 'ddgD/AW', attr: 'met_assessment', value: 'Y', observedAt: -200, recordedAt: -200, source: feed('DRRS-N', 'DDG183-AW') }),
    // an older casualty: Okafor's SPY radar, part far out
    base({
      entity: 'ddgD-spy', attr: 'casrep', validFrom: -12, observedAt: -12, recordedAt: -12, source: feed('OMMS-NG', 'CASREP-183-0117'),
      value: { category: 'C-3', part: 'spy-trm', partLabel: 'SPY T/R module', repairHours: 10, crewQual: 'FC', crewK: 2, fad: 'II', und: 'B', narrative: 'Transmitter/receiver group fault; reduced search volume' },
    }),
    base({ entity: 'spy-trm', attr: 'part_eta', value: 140, observedAt: -10, recordedAt: -10, source: feed('R-SUPPLY', 'REQ-183-0117') }),
    base({ entity: 'spy-trm', attr: 'part_at', value: 'alpha-field', observedAt: -10, recordedAt: -10, source: feed('R-SUPPLY', 'REQ-183-0117') }),
    // plans and reference facts
    base({ entity: 'csg', attr: 'emcon', value: [[56, 76]], source: feed('CSG-OPTASK-EMCON', 'EMCON-PLAN-A') }),
    base({ entity: 'ddgB~cg', attr: 'in_relay_range', value: true, source: feed('LINK-MGMT', 'L16-NET-3') }),
    base({ entity: 'consol1/alpha-port', attr: 'unrep_ready_at', value: 36, source: feed('CLF-SKED', 'CONSOL1') }),
  ];
}

/** Facts that arrive during the watch, each with its recordedAt. */
export function watchFacts(): FactInput[] {
  const fuel = (ship: string, v: number | string, t: number) =>
    base({ entity: ship, attr: 'fuel_pct', value: v, observedAt: t, recordedAt: t, source: feed('FUEL-RPT', `${ship.toUpperCase()}-F-${t}`) });
  return [
    // routine fuel reports; Marlowe's t=48 report arrives malformed
    fuel('cg', 63, 24), fuel('ddgB', 47, 24), fuel('ddgC', 52, 24), fuel('ddgD', 56, 24),
    fuel('cg', 53.7, 48), fuel('ddgB', 34.3, 48), fuel('ddgC', 142, 48), fuel('ddgD', 43.3, 48),
    // H-6: Kittredge SATCOM casualty
    base({
      entity: 'ddgB-satcom', attr: 'casrep', validFrom: 54, observedAt: 54, recordedAt: 54, source: feed('OMMS-NG', 'CASREP-181-0221'),
      value: { category: 'C-3', part: 'satcom-modem', partLabel: 'SATCOM modem LRU', repairHours: 3, crewQual: 'ET', crewK: 2, fad: 'II', und: 'A', narrative: 'Modem LRU failure; no SATCOM transmit or receive' },
    }),
    base({ entity: 'ddgB-p8', attr: 'person_unavailable', value: [[54, 66]], observedAt: 54, recordedAt: 54, reason: 'sick in quarters', source: feed('NSIPS', 'SIQ-181-0221') }),
    base({ entity: 'satcom-modem', attr: 'part_eta', value: 58, observedAt: 54.5, recordedAt: 54.5, source: feed('R-SUPPLY', 'REQ-181-0221') }),
    base({ entity: 'satcom-modem', attr: 'part_at', value: 'alpha-field', observedAt: 54.5, recordedAt: 54.5, source: feed('R-SUPPLY', 'REQ-181-0221') }),
    base({ entity: 'satcom-modem', attr: 'part_eta', value: 63, observedAt: 55, recordedAt: 55, source: feed('DLA-TRACK', 'TCN-881-2207') }),
    // H-2: forward site closed; supply re-routes the part to Atoll Bravo
    base({ entity: 'alpha-port', attr: 'node_status', value: 'CLOSED', validFrom: 58, observedAt: 58, recordedAt: 58, source: feed('FLEET-SITREP', 'SITREP-058') }),
    base({ entity: 'alpha-field', attr: 'node_status', value: 'CLOSED', validFrom: 58, observedAt: 58, recordedAt: 58, source: feed('FLEET-SITREP', 'SITREP-058') }),
    base({ entity: 'satcom-modem', attr: 'part_at', value: 'bravo', observedAt: 58.5, recordedAt: 58.5, source: feed('R-SUPPLY', 'REQ-181-0221') }),
    base({ entity: 'satcom-modem', attr: 'part_eta', value: 70, observedAt: 58.5, recordedAt: 58.5, source: feed('R-SUPPLY', 'REQ-181-0221') }),
  ];
}

export function steelTideFacts(): FactInput[] {
  return [...baselineFacts(), ...watchFacts()];
}
