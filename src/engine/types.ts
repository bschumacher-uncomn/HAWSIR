/** Scenario time is expressed in hours since the scenario epoch. */
export type Hours = number;

export type SourceSystem =
  | 'OMMS-NG'
  | 'R-SUPPLY'
  | 'NSIPS'
  | 'SKED'
  | 'DRRS-N'
  | 'AMHS'
  | 'DLA-TRACK'
  | 'NAVSEA'
  | 'HSM-SQDN'
  | 'CMS'
  | 'WATCHBILL'
  | 'AMC'
  | 'NAVFAC'
  | 'MRRS'
  | 'NAVIFI';

export interface SourceRef {
  system: SourceSystem;
  recordId: string;
  asOf: Hours;
  value?: string;
  note?: string;
}

export type Domain =
  | 'maintenance'
  | 'logistics'
  | 'personnel'
  | 'schedule'
  | 'capability'
  | 'ordnance'
  | 'comms';

export type NodeKind = 'input' | 'person' | 'task' | 'all' | 'any' | 'kofn' | 'gate' | 'capability';

export interface Interval {
  start: Hours;
  end: Hours;
  reason?: string;
}

export interface DeliveryWindow {
  id: string;
  label: string;
  start: Hours;
  end: Hours;
  /** Transit time from the upstream hub to this delivery point. */
  lag?: number;
  enabled?: boolean;
  authority?: string;
}

/** Triangular distribution of offsets (hours) relative to the node's current value or duration. */
export interface Tri {
  min: number;
  mode: number;
  max: number;
}

export type ShipPart =
  | 'spy_a'
  | 'spy_b'
  | 'spy_c'
  | 'spy_d'
  | 'aegis'
  | 'vls'
  | 'gun'
  | 'ciws'
  | 'ssm'
  | 'sonar'
  | 'helo'
  | 'gtm'
  | 'ssgtg'
  | 'steering'
  | 'nav'
  | 'link16'
  | 'satcom'
  | 'ew'
  | 'spq9'
  | 'svtt'
  | 'crew';

export interface NodeDef {
  id: string;
  kind: NodeKind;
  label: string;
  domain: Domain;
  deps?: string[];
  part?: ShipPart;
  detail?: string;

  /** input / person: time this becomes available. null = missing. */
  value?: Hours | null;
  /** Conservative value used by the engine when `value` is missing. */
  assumed?: Hours;

  /** person */
  rate?: string;
  qual?: string;
  unavailable?: Interval[];

  /** task */
  duration?: number | null;
  assumedDuration?: number;
  crew?: { pool: string[]; k: number; label: string };

  /** kofn */
  k?: number;

  /** gate */
  windows?: DeliveryWindow[];

  /** capability */
  code?: string;
  requiredBy?: Hours;
  degraded?: string;
  /** Margin below which a capability is rated Q instead of Y. */
  qMargin?: number;

  /** data quality */
  sources?: SourceRef[];
  staleAfter?: number;
  uncertainty?: Tri;
  conflict?: { source: SourceRef; value: Hours };
  malformed?: { source: SourceRef; raw: string };
}

export type Patch =
  | { op: 'add'; node: NodeDef }
  | { op: 'set'; id: string; fields: Partial<NodeDef> }
  | { op: 'remove'; id: string }
  | { op: 'addCrew'; id: string; persons: string[] }
  | { op: 'window'; id: string; windowId: string; fields: Partial<DeliveryWindow> };

export type EventKind = 'baseline' | 'casrep' | 'supply' | 'personnel' | 'schedule' | 'quality' | 'aviation';

export interface ChangeEvent {
  id: string;
  t: Hours;
  kind: EventKind;
  severity: 'info' | 'warn' | 'crit';
  title: string;
  detail: string;
  source: SourceRef;
  patches: Patch[];
}

export interface Lever {
  id: string;
  title: string;
  detail: string;
  category: 'expedite' | 'crew' | 'logistics' | 'accept' | 'schedule' | 'resequence';
  authority: string;
  withinShipAuthority: boolean;
  /** Latest scenario time at which this option can still be requested. */
  deadline?: Hours;
  cost: 'low' | 'med' | 'high';
  risk: string;
  requiresNodes?: string[];
  patches: Patch[];
}

export interface MissionPhase {
  id: string;
  name: string;
  start: Hours;
  end: Hours;
  requires: string[];
  location?: string;
}

export interface Scenario {
  id: string;
  name: string;
  tagline: string;
  timeScale: 'days' | 'hours';
  /** Calendar day index (from epoch) that is labeled D-0. */
  dDay: number;
  /** Real-world UTC epoch (ms) for DTG rendering. */
  epochUtc: number;
  /** Local offset from UTC in hours (for ship's time). */
  tzOffset: number;
  ship: { name: string; hull: string; cls: string; homeport: string };
  mission: { name: string; area: string; start: Hours; summary: string; tasking: string };
  watchStart: Hours;
  horizon: [Hours, Hours];
  phases: MissionPhase[];
  nodes: NodeDef[];
  events: ChangeEvent[];
  levers: Lever[];
  thresholds: { qMargin: number; cliff: number };
  track?: TrackPoint[];
  ports?: { id: string; name: string; lon: number; lat: number }[];
  places?: Record<string, { name: string; lon: number; lat: number }>;
  legs?: GeoLeg[];
  missionArea?: { name: string; lon: number; lat: number; radiusKm: number };
  /** Theater camera; defaults to the Atlantic crossing view. */
  mapView?: { longitude: number; latitude: number; zoom: number };
}

/** A physical movement (part, person, aircraft, data) whose arrival is an engine node. */
export interface GeoLeg {
  id: string;
  label: string;
  kind: 'part' | 'person' | 'aircraft' | 'data';
  /** Node whose readiness is the arrival time. */
  nodeId: string;
  from: string;
  /** Destination place id, or 'ship' for the ship's position at arrival. */
  to: string;
  /** Destination depends on which window the gate used. */
  gateId?: string;
  byWindow?: Record<string, string>;
}

export interface TrackPoint {
  t: Hours;
  lon: number;
  lat: number;
  label?: string;
}

/* ------------------------------------------------------------------ */
/* Results                                                            */
/* ------------------------------------------------------------------ */

export type QualityFlag =
  | 'missing'
  | 'assumed'
  | 'stale'
  | 'contradictory'
  | 'malformed'
  | 'no-redundancy'
  | 'degraded';

export type Control =
  | { type: 'self' }
  | { type: 'deps' }
  | { type: 'window'; windowId: string; waitFrom: Hours }
  | { type: 'crew'; waitFrom: Hours }
  | { type: 'unreachable'; reason: string };

export interface NodeResult {
  id: string;
  ready: Hours;
  start?: Hours;
  predsReady?: Hours;
  binding: string[];
  control: Control;
  usedWindow?: string;
  crew?: { need: number; assigned: string[] };
  effective?: number;
  flags: QualityFlag[];
}

export type Readiness = 'Y' | 'Q' | 'N';

export interface ControllingConstraint {
  nodeId: string;
  kind: 'input' | 'person' | 'window' | 'duration' | 'crew';
  label: string;
  detail: string;
  windowId?: string;
}

export interface CapabilityResult {
  id: string;
  code: string;
  label: string;
  ready: Hours;
  requiredBy: Hours;
  margin: Hours;
  status: Readiness;
  upNow: boolean;
  chain: string[];
  /** Other constraints binding at the same instant: fixing the controller alone will not help. */
  coCritical: string[];
  controlling: ControllingConstraint;
  reasons: string[];
  flagsOnChain: { nodeId: string; flag: QualityFlag }[];
}

export interface EngineResult {
  at: Hours;
  nodes: Record<string, NodeResult>;
  capabilities: CapabilityResult[];
  order: string[];
  errors: string[];
}
