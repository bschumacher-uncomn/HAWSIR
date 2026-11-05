/**
 * The HAWSIR web contract: every shape the browser receives from mission-api.
 * Types only (no runtime imports), so the web build can import this file
 * without pulling in the server or the engine.
 *
 * Numbers that can be unbounded (a margin with nothing limiting it, a time that
 * never comes) travel as the strings "Infinity" / "-Infinity" and are revived
 * on the client, so meaning is never lost to JSON's null.
 */

export type Hours = number;
export type Readiness = 'Y' | 'Q' | 'N' | 'UNK';

export type QualityFlag =
  | 'missing'
  | 'assumed'
  | 'stale'
  | 'contradictory'
  | 'malformed'
  | 'extrapolated'
  | 'synthetic'
  | 'no-redundancy'
  | 'degraded'
  | 'non-monotone'
  | 'routine-contract'
  | 'unverified-routine'
  | 'transfer-skipped'
  | 'reported-mismatch'
  | 'unreported-change'
  | 'planning-assumption';

export interface SourceRef {
  system: string;
  recordId: string;
  /** Scenario time the source observed the value. */
  asOf: Hours;
  factId?: string;
  value?: string;
  note?: string;
}

export type Domain = 'maintenance' | 'logistics' | 'personnel' | 'schedule' | 'capability' | 'ordnance' | 'comms';

/** Display class of a node (how the UI draws it). `engineKind` carries the engine's own kind. */
export type NodeKind = 'input' | 'person' | 'task' | 'all' | 'any' | 'kofn' | 'gate' | 'capability';
export type EngineKind =
  | 'event' | 'window' | 'person' | 'task' | 'gate' | 'delay' | 'all' | 'any' | 'kofn'
  | 'stock' | 'threshold' | 'scalar' | 'routine' | 'check' | 'requirement';

export type ShipPart =
  | 'spy_a' | 'spy_b' | 'spy_c' | 'spy_d' | 'aegis' | 'vls' | 'gun' | 'ciws' | 'ssm' | 'sonar' | 'helo'
  | 'gtm' | 'ssgtg' | 'steering' | 'nav' | 'link16' | 'satcom' | 'ew' | 'spq9' | 'svtt' | 'crew';

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
  lag?: number;
  enabled?: boolean;
  disabledReason?: string;
  authority?: string;
}

export interface Tri {
  min: number;
  mode: number;
  max: number;
}

export interface ViewNode {
  id: string;
  kind: NodeKind;
  engineKind: EngineKind;
  label: string;
  domain: Domain;
  deps: string[];
  owner?: string;
  part?: ShipPart;
  detail?: string;
  /** event / person: when it becomes available; null = reported as not known. */
  value?: Hours | null;
  assumed?: Hours;
  rate?: string;
  qual?: string;
  unavailable?: Interval[];
  duration?: number | null;
  assumedDuration?: number;
  crew?: { pool: string[]; k: number; label: string };
  k?: number;
  windows?: DeliveryWindow[];
  /** requirement */
  code?: string;
  requiredBy?: Hours;
  qMargin?: number;
  level?: 'asset' | 'group' | 'mission' | 'phase';
  unit?: string;
  sources: SourceRef[];
  uncertainty?: Tri;
  /** Data-quality flags carried by the node itself (from its facts). */
  flags: QualityFlag[];
  /** Can be slipped in a what-if (has a time or duration to move). */
  shiftable: boolean;
}

export type Control =
  | { type: 'self' }
  | { type: 'deps' }
  | { type: 'window'; windowId: string; waitFrom: Hours }
  | { type: 'crew'; waitFrom: Hours }
  | { type: 'unreachable'; reason: string };

export interface NodeState {
  id: string;
  /** When it is (or next becomes) available, clamped to the horizon start; Infinity = not in the horizon. */
  ready: Hours;
  upNow: boolean;
  start?: Hours;
  /** When the dependencies that set `ready` were all in hand (before any wait for a window or crew). */
  predsReady?: Hours;
  /** Dependencies that set `ready`. */
  binding: string[];
  control: Control;
  usedWindow?: string;
  crew?: { need: number; assigned: string[] };
  /** Scalar or stock value (latest known), with its unit. */
  value?: number | null;
  unit?: string;
  flags: QualityFlag[];
  notes: string[];
}

export interface ControllingConstraint {
  nodeId: string;
  kind: 'input' | 'person' | 'window' | 'duration' | 'crew' | 'stock' | 'check';
  label: string;
  detail: string;
  windowId?: string;
}

/**
 * How to read `margin`:
 *   exact    a real number of hours
 *   atLeast  nothing in the horizon limits it; `margin` is the remaining horizon after the need (a floor, not a measurement)
 *   never    no path to the capability inside the horizon; `margin` is -Infinity
 *   unknown  required information is missing (status UNK); `margin` is not meaningful
 */
export type MarginKind = 'exact' | 'atLeast' | 'never' | 'unknown';

export interface CapabilityView {
  id: string;
  code: string;
  label: string;
  owner?: string;
  level?: 'asset' | 'group' | 'mission' | 'phase';
  ready: Hours;
  requiredBy: Hours;
  window: [Hours, Hours];
  margin: Hours;
  marginKind: MarginKind;
  status: Readiness;
  upNow: boolean;
  chain: string[];
  coCritical: string[];
  controlling: ControllingConstraint;
  leaves: { node: string; label: string; why: string; terminal?: string }[];
  bindingEdge: 'lead' | 'tail' | 'stock' | 'none';
  quantity: { stock: string; unit: string; level: number; minInWindow: number; minAt: Hours; margin: number; hours?: number }[];
  reasons: string[];
  flagsOnChain: { nodeId: string; flag: QualityFlag }[];
}

export interface EngineView {
  at: Hours;
  graphHash: string;
  nodes: Record<string, NodeState>;
  capabilities: CapabilityView[];
  order: string[];
  errors: string[];
}

export type Tone = 'crit' | 'warn' | 'ok' | 'info' | 'ai';

export interface Line {
  kind: 'headline' | 'now' | 'change' | 'impact' | 'control' | 'slack' | 'uncertainty' | 'cliff' | 'redundancy' | 'nochange' | 'nonlinear';
  text: string;
  refs: SourceRef[];
  nodeIds: string[];
  tone: Tone;
}

/** The parts of a capability a change summary needs. */
export interface CapBrief {
  id: string;
  code: string;
  label: string;
  status: Readiness;
  ready: Hours;
  requiredBy: Hours;
  margin: Hours;
  marginKind: MarginKind;
  controlling: { nodeId: string; label: string };
  reasons: string[];
}

export interface CapDelta {
  id: string;
  code: string;
  before?: CapBrief;
  after: CapBrief;
  readyDelta: number;
  marginDelta: number;
  statusChanged: boolean;
  controlChanged: boolean;
}

export interface ResultDiff {
  caps: CapDelta[];
  changedNodes: string[];
  consequential: boolean;
}

export type EventKind = 'baseline' | 'casrep' | 'supply' | 'personnel' | 'schedule' | 'quality' | 'aviation' | 'fleet' | 'fuel' | 'link';

export interface EventView {
  id: string;
  t: Hours;
  kind: EventKind;
  severity: 'info' | 'warn' | 'crit';
  title: string;
  detail: string;
  source: SourceRef;
  board?: { system: string; status: 'DEGRADED' | 'FAULT' | 'CONSTRAINT' | 'DOWN' };
  /** Facts the report carries (0 for a data-link change). */
  facts: number;
  /** Where the report lands when ship and shore run as separate nodes. */
  arrives: 'ship' | 'shore' | 'both';
}

export interface EventImpact {
  event: EventView;
  diff: ResultDiff;
  lines: Line[];
}

export interface LeverView {
  id: string;
  title: string;
  detail: string;
  category: string;
  authority: string;
  withinShipAuthority: boolean;
  deadline?: Hours;
  cost: 'low' | 'med' | 'high';
  risk: string;
  target?: string;
  requiresNodes?: string[];
  exclusive?: string;
  infeasible?: string;
  missingInfo?: string[];
}

export interface OptionEval {
  id: string;
  levers: LeverView[];
  available: boolean;
  unavailableReason?: string;
  targetId: string;
  marginBefore: number;
  marginAfter: number;
  recovered: number;
  statusBefore: Readiness;
  statusAfter: Readiness;
  controllingAfter: ControllingConstraint;
  sideEffects: { capId: string; code: string; delta: number; before: Readiness; after: Readiness }[];
  effective: boolean;
  why: string;
  authority: string;
  incomplete: string[];
}

export interface SlackResult {
  nodeId: string;
  targetId: string;
  noImpact: number;
  toFailure: number;
  recoverable: boolean;
  unbounded: boolean;
}

export interface CurvePoint {
  delta: number;
  margin: number;
}

export interface Cliff {
  nodeId: string;
  targetId: string;
  slack: number;
  drop: number;
}

export interface McTarget {
  pMeet: number;
  pY: number;
  pQ: number;
  pN: number;
  pUNK: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface McView {
  n: number;
  seed: number;
  targets: Record<string, McTarget>;
  /** Per target: share of runs in which each leaf controlled the outcome. */
  criticality: Record<string, Record<string, number>>;
  uncertain: string[];
}

export interface McChunkRequest {
  at?: Hours;
  seed: number;
  /** First run of this chunk; chunks of one seed concatenate into one reproducible run. */
  start: number;
  count: number;
  /** What-if shifts (hours) applied before sampling, as in WhatIfRequest. */
  shifts?: Record<string, number>;
}

export interface McChunkTarget {
  /** Finite margins only, one per run; the runs that had none are counted below. */
  margins: number[];
  /** Runs with no reachable delivery window (margin −∞). */
  never: number;
  /** Runs with no binding constraint in the horizon (margin +∞). */
  unbounded: number;
  unknown: number;
  status: Record<Readiness, number>;
  /** Runs in which each node sat on this capability's critical chain. */
  chain: Record<string, number>;
  /** Runs in which each leaf constraint controlled this capability. */
  controlling: Record<string, number>;
}

export interface McChunk {
  at: Hours;
  seed: number;
  start: number;
  count: number;
  targets: Record<string, McChunkTarget>;
  uncertain: string[];
  computeMs: number;
}

export interface SensitivityRequest {
  at?: Hours;
  target: string;
  shifts?: Record<string, number>;
}

/** Capability margin with one uncertain input held at each end of its range; null = no finite margin. */
export interface SensitivityBar {
  nodeId: string;
  label: string;
  low: number | null;
  high: number | null;
  swing: number;
}

export interface CapAnalysis {
  slack: SlackResult[];
  cliffs: Cliff[];
  lines: Line[];
  options: { singles: OptionEval[]; combos: OptionEval[] };
  mc: McView;
}

export interface NodeAnalysis {
  nodeId: string;
  targetId: string;
  slack?: SlackResult;
  curve: CurvePoint[];
  /** Capabilities downstream of the node. */
  affected: string[];
}

export interface Phase {
  id: string;
  name: string;
  start: Hours;
  end: Hours;
  requires: string[];
  location?: string;
}

export interface TrackPoint {
  t: Hours;
  lon: number;
  lat: number;
  label?: string;
}

export interface GeoLeg {
  id: string;
  label: string;
  kind: 'part' | 'person' | 'aircraft' | 'data' | 'ship';
  nodeId: string;
  /** Origin place id (resolved for the viewed time). */
  from: string;
  to: string;
  gateId?: string;
  byWindow?: Record<string, string>;
  ship?: string;
}

export interface MissionSummary {
  id: string;
  short: string;
  name: string;
  tagline: string;
}

/** Static description of a mission: everything the UI needs that does not change with time. */
export interface MissionView {
  id: string;
  name: string;
  short: string;
  tagline: string;
  /** days: labels like D-12 0700. hours: labels like H-6:00. */
  timeScale: 'days' | 'hours';
  dDay: number;
  hHour?: number;
  epochUtc: number;
  tzOffset: number;
  ship: { id: string; name: string; hull: string; cls: string; homeport: string };
  ships: { id: string; name: string; hull: string; cls: string; group: string }[];
  mission: { name: string; area: string; start: Hours; summary: string; tasking: string };
  watchStart: Hours;
  horizon: [Hours, Hours];
  /** Where the replay stops. */
  watchEnd: Hours;
  phases: Phase[];
  events: EventView[];
  thresholds: { qMargin: number; cliff: number };
  track: TrackPoint[];
  tracks: Record<string, TrackPoint[]>;
  places: Record<string, { name: string; lon: number; lat: number; kind?: string }>;
  legs: GeoLeg[];
  missionArea?: { name: string; lon: number; lat: number; radiusKm: number };
  mapView: { longitude: number; latitude: number; zoom: number };
  defaultFocus: string;
  partLabels?: Partial<Record<ShipPart, string>>;
  splitDelivery: boolean;
}

export interface LinkState {
  up: boolean;
  since: Hours;
  reason?: string;
  /** The peer this node syncs with, if any. */
  peer?: string;
  pendingPush: number;
  lastSync?: { t: Hours; wall: string };
}

export interface NodeInfo {
  id: string;
  kind: 'ship' | 'shore';
  ship?: string;
  label: string;
}

export interface Snapshot {
  mission: string;
  at: Hours;
  /** Changes when anything the picture depends on changes (facts known, decisions). */
  key: string;
  nodes: ViewNode[];
  result: EngineView;
  /** The picture without approved planning assumptions (equal to result when none are active). */
  authResult: EngineView;
  /** Reports this node had received by `at`. */
  applied: string[];
  impacts: Record<string, EventImpact>;
  levers: LeverView[];
  /** Levers approved as planning assumptions and active at `at`. */
  approved: string[];
  focus: string[];
  halted: { stopped: boolean; note?: string; by?: string };
  link: LinkState;
  /** Distinct reports and decisions behind this picture. */
  counts: { facts: number; quarantined: number; decisions: number };
  /** Where each movement starts as of `at`, for legs whose origin comes from a report (e.g. the part's current location). */
  legFrom: Record<string, string>;
  computeMs: number;
}

export interface WhatIfRequest {
  at?: Hours;
  shifts: Record<string, number>;
}

export interface WhatIfResult {
  at: Hours;
  nodes: ViewNode[];
  result: EngineView;
  computeMs: number;
}

export interface Actor {
  id: string;
  role: string;
}

export interface DecisionRequest {
  kind: 'approve' | 'reject' | 'withdraw' | 'stop' | 'resume' | 'note' | 'monitor' | 'override';
  lever?: string;
  requirement?: string;
  note?: string;
  status?: Readiness;
}

/** A decision log entry exactly as hashed (the browser re-verifies the chain). */
export interface DecisionEntry {
  seq: number;
  kind: string;
  at: Hours;
  actor: Actor;
  lever?: string;
  requirement?: string;
  note?: string;
  status?: Readiness;
  patches?: unknown[];
  basis?: { factsHead?: string; graphHash?: string; resultHash?: string };
  wallClock?: string;
  prevHash: string;
  hash: string;
}

/** A fact log entry exactly as hashed. */
export interface FactEntry {
  id: string;
  seq: number;
  entity: string;
  attr: string;
  value: unknown;
  unit?: string;
  scope?: string;
  source: { system: string; recordId?: string; kind?: string };
  observedAt: Hours;
  validFrom?: Hours;
  validTo?: Hours;
  recordedAt: Hours;
  recordedBy: string;
  reason?: string;
  origin?: string;
  quarantine?: string;
  receivedAt?: Hours;
  prevHash: string;
  hash: string;
}

export interface AuditView {
  mission: string;
  node: NodeInfo;
  facts: FactEntry[];
  decisions: DecisionEntry[];
  heads: { facts: string; decisions: string };
  /** What the server found when it re-verified both chains on load and now. */
  serverVerify: { facts: { ok: boolean; brokenAt?: number }; decisions: { ok: boolean; brokenAt?: number }; storedRowMismatches: number[] };
  peers: PeerState[];
  /** Facts not yet pushed ashore (ship nodes). */
  pendingPush: number;
}

export interface PeerState {
  node: string;
  label: string;
  lastContact?: { t: Hours; wall: string };
  factsReceived: number;
  decisions: number;
  chainOk: boolean;
}

export interface ClockState {
  mission: string;
  t: Hours;
  playing: boolean;
  speed: number;
  horizon: [Hours, Hours];
}

export type StreamEvent =
  | { type: 'hello'; node: NodeInfo; missions: string[] }
  | { type: 'facts'; mission: string; count: number; via: 'inject' | 'sync' | 'manual'; labels: string[] }
  | { type: 'decision'; mission: string; seq: number; kind: string; by: string }
  | { type: 'clock'; mission: string; clock: ClockState }
  | { type: 'link'; link: LinkState }
  | { type: 'sync'; mission: string; pushed: number; pulled: number; withheld: number; contested: string[]; ok: boolean; error?: string }
  | { type: 'reset'; mission: string };

export interface HealthView {
  ok: boolean;
  node: NodeInfo;
  db: boolean;
  missions: Record<string, { facts: { ok: boolean }; decisions: { ok: boolean }; storedRowMismatches: number[] }>;
  llm: { configured: boolean; model?: string };
}

export interface NarrateRequest {
  mission: string;
  key: string;
  facts: string[];
  brief: string;
}

export interface NarrateResult {
  text: string;
  source: 'llm' | 'template';
  model?: string;
  ms: number;
}

/* ------------------------------------------------------------------ */
/* Fleet lab                                                          */
/* ------------------------------------------------------------------ */

export interface FleetShip {
  hull: string;
  name: string;
  cls: string;
  group: string;
  lon: number;
  lat: number;
  heading: number;
  status: Readiness;
  margin: number;
  marginKind: MarginKind;
  mission: string;
  controlling: string;
  /** Capability codes not ready. */
  down: string[];
  sources: string[];
}

export interface FleetDisruption {
  id: string;
  label: string;
  detail: string;
  kind: 'weather' | 'satcom' | 'nsips' | 'supply' | 'port' | 'casualty';
  /** Hours the disruption slips each affected input. */
  hours: number;
}

export interface FleetView {
  at: Hours;
  ships: FleetShip[];
  rollup: { Y: number; Q: number; N: number; UNK: number };
  disruptions: FleetDisruption[];
  active: string[];
  computeMs: number;
  evaluated: number;
}

export interface SlipChallenge {
  /** The input that was slipped, and by how much. */
  nodeId: string;
  label: string;
  slip: number;
  targetId: string;
  targetCode: string;
  /** The answer that matters: how late the capability becomes. */
  delay: number;
  marginBefore: number;
  marginAfter: number;
  statusBefore: Readiness;
  statusAfter: Readiness;
  /** Upstream slack the input had before the slip touched the mission. */
  noImpact: number;
  absorbed: boolean;
  controllingAfter: string;
  computeMs: number;
}
