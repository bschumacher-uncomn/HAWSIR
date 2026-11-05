import type { GraphSpec, NodeSpec, Severity } from '../../core/graph';
import type { Lever } from '../../core/options';
import type { Citation, FactorTable } from '../../core/provenance';
import type { RoutineDef } from '../../core/routines';
import type { AttributeDef } from '../../data/store';
import type { BuildContext, BuildResult, DomainPack } from '../pack';

/**
 * Airlift pack: AMPLIFI's airlift checklist logic re-expressed as engine nodes.
 * Each leg is a timed task (block time) plus pass/fail checks (range, payload,
 * fuel, departure weight). Because the checks sit in the same graph as the
 * timeline, an airlift mission gets AMPLIFI's verdicts *and* a time margin
 * against the required delivery date with a controlling constraint.
 */
const USNI_CMV22: Citation = {
  title: 'USNI News, "Navy CMV-22B Osprey Design Completes First Flight" (Jan 2020), citing NAVAIR',
  url: 'https://news.usni.org/2020/01/21/navy-cmv-22b-osprey-design-completes-first-flight',
  status: 'sourced',
  note: 'Range 1,150 nm; up to 6,000 lb of cargo or personnel.',
};

export interface AircraftProfile {
  [k: string]: unknown;
  type: string;
  rangeNm: number;
  maxPayloadLb: number;
  cruiseKt: number;
  burnLbPerHr?: number;
  oewLb?: number;
  maxTowLb?: number;
  status: string;
}

export const AIRCRAFT: FactorTable<AircraftProfile> = {
  id: 'airlift.aircraft',
  title: 'Aircraft planning profiles',
  units: { rangeNm: 'nm', maxPayloadLb: 'lb', cruiseKt: 'kt', burnLbPerHr: 'lb/h', oewLb: 'lb', maxTowLb: 'lb' },
  rows: [
    { type: 'CMV-22B', rangeNm: 1150, maxPayloadLb: 6000, cruiseKt: 240, status: 'range and payload sourced; cruise speed synthetic' },
    {
      type: 'C-17A', rangeNm: 4400, maxPayloadLb: 170900, cruiseKt: 450, burnLbPerHr: 21000, oewLb: 282500, maxTowLb: 585000,
      status: 'synthetic: approximate public figures; replace with AFPAM 10-1403 planning factors',
    },
  ],
  citations: [
    USNI_CMV22,
    {
      title: 'AFPAM 10-1403 Air Mobility Planning Factors (24 Oct 2018)',
      status: 'assumption',
      note: 'C-17A numbers here are placeholders shaped like the AFPAM factors AMPLIFI uses; substitute the governed values.',
    },
  ],
  status: 'derived',
};

export function aircraft(type: string): AircraftProfile {
  const a = AIRCRAFT.rows.find((r) => r.type === type);
  if (!a) throw new Error(`unknown aircraft ${type}`);
  return a;
}

export const ROUTINES: RoutineDef[] = [
  {
    id: 'airlift.legWithinRange',
    title: 'Leg within aircraft range and payload',
    description: 'A leg is flyable when its distance is within the aircraft range and the load within max payload.',
    kind: 'check',
    inputs: {
      distanceNm: { type: 'number', unit: 'nm', monotone: 'decreasing' },
      rangeNm: { type: 'number', unit: 'nm', monotone: 'increasing' },
      payloadLb: { type: 'number', unit: 'lb', monotone: 'decreasing' },
      maxPayloadLb: { type: 'number', unit: 'lb', monotone: 'increasing' },
    },
    output: { unit: 'nm', description: 'range margin' },
    citations: [USNI_CMV22],
    fn: ({ distanceNm, rangeNm, payloadLb, maxPayloadLb }) => {
      const rangeOk = distanceNm <= rangeNm;
      const loadOk = payloadLb <= maxPayloadLb;
      const binding = !rangeOk ? ['distanceNm', 'rangeNm'] : !loadOk ? ['payloadLb', 'maxPayloadLb'] : ['distanceNm'];
      const detail = !rangeOk
        ? `${distanceNm.toLocaleString('en-US')} nm leg exceeds ${rangeNm.toLocaleString('en-US')} nm range`
        : !loadOk
          ? `${payloadLb.toLocaleString('en-US')} lb exceeds ${maxPayloadLb.toLocaleString('en-US')} lb max payload`
          : `${distanceNm.toLocaleString('en-US')} nm within ${rangeNm.toLocaleString('en-US')} nm range; ${payloadLb.toLocaleString('en-US')} lb within payload`;
      return { passed: rangeOk && loadOk, margin: rangeNm - distanceNm, unit: 'nm', binding, detail };
    },
    tests: [
      { name: 'CMV-22B 300 nm with 400 lb', inputs: { distanceNm: 300, rangeNm: 1150, payloadLb: 400, maxPayloadLb: 6000 }, expect: { passed: true } },
      { name: 'CMV-22B 1,700 nm', inputs: { distanceNm: 1700, rangeNm: 1150, payloadLb: 400, maxPayloadLb: 6000 }, expect: { passed: false } },
    ],
  },
  {
    id: 'airlift.blockHours',
    title: 'Block time for a leg',
    description: 'Flight time at block speed plus ground time.',
    kind: 'value',
    inputs: {
      distanceNm: { type: 'number', unit: 'nm', monotone: 'increasing' },
      speedKt: { type: 'number', unit: 'kt', monotone: 'decreasing' },
      groundHours: { type: 'number', unit: 'h', monotone: 'increasing' },
    },
    output: { unit: 'h' },
    fn: ({ distanceNm, speedKt, groundHours }) => {
      const flight = distanceNm / speedKt;
      return { value: flight + groundHours, unit: 'h', binding: ['distanceNm', 'speedKt'], detail: `${distanceNm} nm at ${speedKt} kt = ${flight.toFixed(2)} h + ${groundHours} h ground` };
    },
    tests: [{ name: '900 nm at 450 kt + 2 h', inputs: { distanceNm: 900, speedKt: 450, groundHours: 2 }, expect: { value: 4 } }],
  },
  {
    id: 'airlift.legFuelBurn',
    title: 'Leg fuel burn',
    description: 'Burn = (distance / block speed) × burn rate (AMPLIFI "Compute leg fuel burn").',
    kind: 'value',
    inputs: {
      distanceNm: { type: 'number', unit: 'nm', monotone: 'increasing' },
      speedKt: { type: 'number', unit: 'kt', monotone: 'decreasing' },
      burnLbPerHr: { type: 'number', unit: 'lb/h', monotone: 'increasing' },
    },
    output: { unit: 'lb' },
    fn: ({ distanceNm, speedKt, burnLbPerHr }) => {
      const h = distanceNm / speedKt;
      const burn = h * burnLbPerHr;
      return { value: Math.round(burn * 10) / 10, unit: 'lb', detail: `${h.toFixed(1)} h × ${burnLbPerHr.toLocaleString('en-US')} lb/h = ${Math.round(burn).toLocaleString('en-US')} lb` };
    },
    tests: [{ name: '2,250 nm C-17', inputs: { distanceNm: 2250, speedKt: 450, burnLbPerHr: 21000 }, expect: { value: 105000 } }],
  },
  {
    id: 'airlift.fuelCoversLeg',
    title: 'Available fuel covers leg burn with reserve',
    description: 'Available = max TOW − OEW − cargo; passes when burn × reserve factor ≤ available (AMPLIFI "Available fuel covers leg burn").',
    kind: 'check',
    inputs: {
      legBurnLb: { type: 'number', unit: 'lb', monotone: 'decreasing' },
      reserveFactor: { type: 'number', monotone: 'decreasing' },
      maxTowLb: { type: 'number', unit: 'lb', monotone: 'increasing' },
      oewLb: { type: 'number', unit: 'lb', monotone: 'decreasing' },
      cargoLb: { type: 'number', unit: 'lb', monotone: 'decreasing' },
    },
    output: { unit: 'lb', description: 'fuel margin' },
    fn: ({ legBurnLb, reserveFactor, maxTowLb, oewLb, cargoLb }) => {
      const available = maxTowLb - oewLb - cargoLb;
      const need = legBurnLb * reserveFactor;
      return {
        passed: need <= available, margin: available - need, unit: 'lb', binding: ['legBurnLb', 'cargoLb'],
        detail: `need ${Math.round(need).toLocaleString('en-US')} lb (burn × ${reserveFactor}) vs ${Math.round(available).toLocaleString('en-US')} lb available`,
      };
    },
    tests: [
      { name: 'light cargo', inputs: { legBurnLb: 105000, reserveFactor: 1.1, maxTowLb: 585000, oewLb: 282500, cargoLb: 100000 }, expect: { passed: true } },
      { name: 'heavy cargo long leg', inputs: { legBurnLb: 190000, reserveFactor: 1.1, maxTowLb: 585000, oewLb: 282500, cargoLb: 160000 }, expect: { passed: false } },
    ],
  },
];

export const ATTRIBUTES: AttributeDef[] = [
  { key: 'airlift.cargo_lb', type: 'number', unit: 'lb', min: 0, worse: 'higher', description: 'Cargo weight for a mission' },
  { key: 'airlift.load_ready_at', type: 'hours', worse: 'higher', description: 'Time cargo is available to load' },
  { key: 'airlift.field_status', type: 'enum', enum: ['OPEN', 'CLOSED'], worse: ['CLOSED', 'OPEN'], description: 'Airfield status' },
];

export interface AirliftLeg {
  id: string;
  from: string;
  to: string;
  nm: number;
  groundHours?: number;
}

export interface AirliftModel {
  id: string;
  name: string;
  aircraft: string;
  legs: AirliftLeg[];
  /** Planned cargo; a fact `airlift.cargo_lb` on the mission overrides it. */
  cargoLb: number;
  loadAt: number;
  requiredDeliveryAt: number;
  reserveFactor?: number;
  horizon: [number, number];
  severity?: Severity;
}

/** Reusable leg-check node (the naval pack uses this for COD legs). */
export function rangeCheckNode(id: string, label: string, aircraftType: string, distanceNm: number, payloadLb: number, owner?: string): NodeSpec {
  const a = aircraft(aircraftType);
  return {
    id, kind: 'check', label, routine: 'airlift.legWithinRange', owner, domain: 'logistics',
    inputs: { distanceNm, rangeNm: a.rangeNm, payloadLb, maxPayloadLb: a.maxPayloadLb },
    prov: { citations: AIRCRAFT.citations },
  };
}

export function buildAirlift(m: AirliftModel, ctx: BuildContext): BuildResult {
  const a = aircraft(m.aircraft);
  const nodes: NodeSpec[] = [];
  const cargoR = ctx.view.get<number>(m.id, 'airlift.cargo_lb');
  const cargo = typeof cargoR.value === 'number' ? cargoR.value : m.cargoLb;
  const loadR = ctx.view.get<number>(m.id, 'airlift.load_ready_at');
  const loadAt = typeof loadR.value === 'number' ? loadR.value : m.loadAt;
  nodes.push({ id: 'cargo', kind: 'scalar', label: 'Cargo weight', value: cargo, unit: 'lb', flags: cargoR.fact ? cargoR.flags.filter((f) => f !== 'missing') : [], prov: { facts: cargoR.fact ? [cargoR.fact.id] : [] } });
  nodes.push({
    id: 'load', kind: 'event', label: 'Cargo ready to load', at: loadAt, uncertainty: { min: -1, mode: 0, max: 4 },
    flags: loadR.fact ? loadR.flags.filter((f) => f !== 'missing') : [], prov: { facts: loadR.fact ? [loadR.fact.id] : [] },
  });
  let prev = 'load';
  const checks: string[] = [];
  m.legs.forEach((leg, i) => {
    const fieldR = ctx.view.get<string>(leg.to, 'airlift.field_status');
    const open = fieldR.value !== 'CLOSED';
    nodes.push({ id: `${leg.id}:block`, kind: 'routine', label: `${leg.from}→${leg.to} block time`, routine: 'airlift.blockHours', inputs: { distanceNm: leg.nm, speedKt: a.cruiseKt, groundHours: leg.groundHours ?? (i === 0 ? 0 : 2.25) } });
    nodes.push({ id: `${leg.id}:burn`, kind: 'routine', label: `${leg.from}→${leg.to} fuel burn`, routine: 'airlift.legFuelBurn', inputs: { distanceNm: leg.nm, speedKt: a.cruiseKt, burnLbPerHr: a.burnLbPerHr ?? 0 } });
    nodes.push(rangeCheckNode(`${leg.id}:range`, `${leg.from}→${leg.to} within range/payload`, m.aircraft, leg.nm, cargo));
    nodes.push({
      id: `${leg.id}:fuel`, kind: 'check', label: `${leg.from}→${leg.to} fuel covers burn`, routine: 'airlift.fuelCoversLeg',
      inputs: { legBurnLb: { ref: `${leg.id}:burn` }, reserveFactor: m.reserveFactor ?? 1.1, maxTowLb: a.maxTowLb ?? 0, oewLb: a.oewLb ?? 0, cargoLb: { ref: 'cargo' } },
    });
    nodes.push({ id: `${leg.id}:field`, kind: 'window', label: `${leg.to} open`, intervals: open ? [[-Infinity, Infinity]] : [], flags: fieldR.fact ? fieldR.flags.filter((f) => f !== 'missing') : [] });
    nodes.push({
      id: `${leg.id}:fly`, kind: 'task', label: `Fly ${leg.from}→${leg.to}`, deps: [prev, `${leg.id}:range`, `${leg.id}:fuel`, `${leg.id}:field`],
      duration: { ref: `${leg.id}:block` }, notBefore: ctx.now, uncertainty: { min: -0.5, mode: 0, max: 2 },
    });
    checks.push(`${leg.id}:range`, `${leg.id}:fuel`);
    prev = `${leg.id}:fly`;
  });
  nodes.push({
    id: 'delivered', kind: 'requirement', label: `${m.name}: delivered by RDD`, code: 'RDD', level: 'mission',
    deps: [prev], window: { start: m.requiredDeliveryAt, end: m.requiredDeliveryAt + 0.01 }, qMargin: 4, severity: m.severity ?? 'II', primary: true,
  });
  const graph: GraphSpec = { id: m.id, label: m.name, horizon: m.horizon, nodes, qMargin: 4, marks: { RDD: m.requiredDeliveryAt } };
  const levers: Lever[] = [
    {
      id: 'airlift.split', title: 'Recommend splitting the load (20% to a follow-on sortie)', detail: 'Moves 20% of cargo to a second aircraft.',
      category: 'logistics', authority: 'Mission planner / AMC TACC', withinUnitAuthority: false, cost: 'med', effect: 'planning-assumption',
      patches: [{ op: 'set', id: 'cargo', fields: { value: Math.round(cargo * 0.8) } }], target: 'delivered',
    },
  ];
  return { graph, levers, focus: ['delivered'], health: ctx.view.health() };
}

export const airliftPack: DomainPack<AirliftModel> = {
  id: 'airlift',
  version: '0.1.0',
  title: 'Airlift (AMPLIFI checklist logic)',
  attributes: ATTRIBUTES,
  tables: [AIRCRAFT as unknown as FactorTable],
  routines: ROUTINES,
  build: buildAirlift,
};
