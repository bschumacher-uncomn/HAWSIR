import type { Interval, Timeline } from './intervals';
import type { SeriesPoint, AppliedTransfer, TransferKind } from './ledger';
import type { Tri } from './prng';
import type { RoutineArg, RoutineResult } from './routines';
import type { Citation } from './provenance';

/**
 * The mission graph. Every node kind has one job and a fixed meaning, so the
 * engine can explain any answer by walking the graph. Domain packs compile
 * their entities (ships, CASREPs, sorties, legs) into these kinds.
 *
 * Value families:
 *   - availability timelines (event, window, person, task, gate, delay, all, any, kofn, check, threshold, requirement)
 *   - quantity series (stock)
 *   - scalars (scalar, routine) that parameterize the others (durations, rates, lags, amounts)
 */
export type Ref = { ref: string };
export type Num = number | Ref;

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

/** Flags that mean "do not call this green". */
export const UNCERTAIN_FLAGS: QualityFlag[] = ['missing', 'assumed', 'stale', 'contradictory', 'malformed', 'routine-contract'];

export interface SourceRef {
  system: string;
  recordId?: string;
  factId?: string;
  observedAt?: number;
  kind?: string;
  note?: string;
}

export interface Provenance {
  facts?: string[];
  sources?: SourceRef[];
  citations?: Citation[];
  note?: string;
}

export interface Uncertainty extends Tri {
  /** delay: hours added to a time (event at, task duration, scalar hours). scale: multiplier on stock burn. */
  kind?: 'delay' | 'scale';
}

export type Severity = 'I' | 'II' | 'III' | 'IV';

interface BaseNode {
  id: string;
  label: string;
  domain?: string;
  /** Asset or group this node belongs to (for roll-ups and display). */
  owner?: string;
  tags?: string[];
  flags?: QualityFlag[];
  prov?: Provenance;
  uncertainty?: Uncertainty;
  detail?: string;
}

/** Becomes available at `at` and stays available (until `until`, if given). */
export interface EventNode extends BaseNode {
  kind: 'event';
  at: Num | null;
  /** Conservative value used when `at` is missing. */
  assumedAt?: number;
  until?: Num;
}

/** Explicit availability intervals (EMCON lifts, a hub that is open, a slot). */
export interface WindowNode extends BaseNode {
  kind: 'window';
  intervals: Interval[];
}

/** A person: available from `from`, except during unavailable intervals. */
export interface PersonNode extends BaseNode {
  kind: 'person';
  from?: number;
  unavailable?: { start: number; end: number; reason?: string }[];
  qual?: string;
  rate?: string;
}

/** Work that starts when its dependencies are available (and k crew can cover it) and finishes after `duration`. */
export interface TaskNode extends BaseNode {
  kind: 'task';
  deps: string[];
  duration: Num | null;
  assumedDuration?: number;
  crew?: { pool: string[]; k: number; label?: string };
  notBefore?: number;
}

export interface Slot {
  id: string;
  label: string;
  start: number;
  end: number;
  /** Time from departure to delivery. */
  lag?: Num;
  enabled?: boolean;
  /** Why the slot is disabled (shown to the user). */
  disabledReason?: string;
  authority?: string;
}

/** Delivery through scheduled slots: depart within a slot, deliver after lag (or arrive within the slot). */
export interface GateNode extends BaseNode {
  kind: 'gate';
  deps: string[];
  slots: Slot[];
  mode?: 'depart' | 'arrive';
}

/** Shift availability later by a lag (a transit). */
export interface DelayNode extends BaseNode {
  kind: 'delay';
  dep: string;
  lag: Num;
}

export interface AllNode extends BaseNode {
  kind: 'all';
  deps: string[];
}

export interface AnyNode extends BaseNode {
  kind: 'any';
  deps: string[];
}

export interface KofNNode extends BaseNode {
  kind: 'kofn';
  deps: string[];
  k: number;
}

export interface StockBurn {
  from: number;
  to: number;
  /** Units per hour. */
  rate: Num;
  label: string;
}

export interface StockTransfer {
  id: string;
  label: string;
  /** Literal time, or the first rise of a timeline node (e.g. an UNREP task). */
  at: number | { node: string };
  kind: TransferKind;
  amount?: Num;
  level?: Num;
}

/** A quantity over time: fuel, missiles, stores. */
export interface StockNode extends BaseNode {
  kind: 'stock';
  unit: string;
  t0: number;
  initial: Num | null;
  assumedInitial?: number;
  capacity?: Num;
  floor?: number;
  burns: StockBurn[];
  transfers: StockTransfer[];
}

/** Where a stock is at or above a level, as availability. */
export interface ThresholdNode extends BaseNode {
  kind: 'threshold';
  stock: string;
  level: Num;
}

export interface ScalarNode extends BaseNode {
  kind: 'scalar';
  value: number | null;
  unit: string;
  assumed?: number;
}

export type RoutineInput = RoutineArg | Ref;

/** Leaf math: a registered routine computing a scalar. */
export interface RoutineNode extends BaseNode {
  kind: 'routine';
  routine: string;
  inputs: Record<string, RoutineInput>;
}

/** A pass/fail check: available always if it passes, never if it fails. */
export interface CheckNode extends BaseNode {
  kind: 'check';
  routine: string;
  inputs: Record<string, RoutineInput>;
}

/** A capability, MET, or mission requirement needed over a window. */
export interface RequirementNode extends BaseNode {
  kind: 'requirement';
  deps: string[];
  window: { start: Num; end: Num };
  code?: string;
  /** Margin below which a met requirement is rated Q instead of Y. */
  qMargin?: number;
  severity?: Severity;
  primary?: boolean;
  /** Roll-up level, for display: asset, group, mission. */
  level?: 'asset' | 'group' | 'mission' | 'phase';
  /** Engine-reported status from an external system (e.g. DRRS-N), for mismatch checks. */
  reported?: { status: Readiness; observedAt: number; system: string; factId?: string };
}

export type NodeSpec =
  | EventNode
  | WindowNode
  | PersonNode
  | TaskNode
  | GateNode
  | DelayNode
  | AllNode
  | AnyNode
  | KofNNode
  | StockNode
  | ThresholdNode
  | ScalarNode
  | RoutineNode
  | CheckNode
  | RequirementNode;

export type NodeKind = NodeSpec['kind'];

export interface GraphSpec {
  id: string;
  label?: string;
  horizon: [number, number];
  nodes: NodeSpec[];
  /** Default Q threshold in hours when a requirement does not set one. */
  qMargin?: number;
  /** Labelled reference times (H-hour) for display. */
  marks?: Record<string, number>;
}

export type Readiness = 'Y' | 'Q' | 'N' | 'UNK';

export interface NodeResult {
  id: string;
  kind: NodeKind;
  timeline?: Timeline;
  value?: number | null;
  unit?: string;
  series?: SeriesPoint[];
  finalRate?: number;
  applied?: AppliedTransfer[];
  check?: { passed: boolean; margin?: number; detail: string };
  routineRun?: { routine: string; version: string; inputs: Record<string, RoutineArg>; result: RoutineResult };
  start?: number;
  finish?: number;
  /** For gates: which slot delivered, and whether we waited for it. */
  slot?: { id: string; waited: boolean; depart: number; lag: number };
  crew?: { need: number; assigned: string[]; waitedFor: string[] };
  flags: QualityFlag[];
  notes: string[];
}

export interface QuantityMargin {
  threshold: string;
  stock: string;
  unit: string;
  level: number;
  minInWindow: number;
  /** When the low point occurs. */
  minAt: number;
  margin: number;
  /** Quantity margin as hours of consumption at the low point (time-comparable). */
  hours?: number;
}

export type Terminal =
  | 'input-time'
  | 'missing'
  | 'window'
  | 'person'
  | 'duration'
  | 'crew'
  | 'slot'
  | 'lag'
  | 'consumption'
  | 'late-transfer'
  | 'expenditure'
  | 'check'
  | 'value'
  | 'unreachable';

/** One step of an explanation: why a node's availability changes at `at`. */
export interface Cause {
  node: string;
  label: string;
  edge: 'rise' | 'fall' | 'never' | 'value' | 'low';
  at: number;
  why: string;
  terminal?: Terminal;
  children: Cause[];
  /** For `any`: the other alternatives that were not earlier. */
  alternatives?: string[];
}

export interface RequirementResult extends NodeResult {
  kind: 'requirement';
  /** Cause tree of the edge that sets the margin (null if nothing binds in the horizon). */
  controlling: Cause | null;
  /** Cause tree of the other edge (e.g. a fuel breach after the window while the lead edge binds). */
  secondary: Cause | null;
  /** Leaf causes of `controlling`: the things that actually set the time. */
  leaves: Cause[];
  /** Every node in the controlling cause tree. */
  chain: string[];
  status: Readiness;
  window: [number, number];
  /** Hours: positive = time to spare. min(lead, tail). */
  margin: number;
  /** How late the capability could come up and still meet the window start. */
  lead: number;
  /** How early the capability could be lost and still cover the window end. */
  tail: number;
  upNow: boolean;
  cover?: Interval;
  /** Which edge sets the margin; 'stock' = a stock's low point is closer than any edge. */
  bindingEdge: 'lead' | 'tail' | 'stock' | 'none';
  stockBinding?: { threshold: string; at: number; hours: number };
  quantity: QuantityMargin[];
  chainFlags: QualityFlag[];
  reasons: string[];
}

export interface EngineResult {
  graphId: string;
  graphHash: string;
  now: number;
  horizon: [number, number];
  nodes: Record<string, NodeResult>;
  requirements: Record<string, RequirementResult>;
  order: string[];
  errors: string[];
}

export function isRef(x: unknown): x is Ref {
  return typeof x === 'object' && x !== null && 'ref' in x && typeof (x as Ref).ref === 'string';
}

/** Every upstream node id a node reads, including scalar references. */
export function depsOf(n: NodeSpec): string[] {
  const refs: string[] = [];
  const num = (x: unknown) => {
    if (isRef(x)) refs.push(x.ref);
  };
  switch (n.kind) {
    case 'event':
      num(n.at);
      num(n.until);
      break;
    case 'task':
      refs.push(...n.deps, ...(n.crew?.pool ?? []));
      num(n.duration);
      break;
    case 'gate':
      refs.push(...n.deps);
      for (const s of n.slots) num(s.lag);
      break;
    case 'delay':
      refs.push(n.dep);
      num(n.lag);
      break;
    case 'all':
    case 'any':
    case 'kofn':
      refs.push(...n.deps);
      break;
    case 'stock':
      num(n.initial);
      num(n.capacity);
      for (const b of n.burns) num(b.rate);
      for (const t of n.transfers) {
        if (typeof t.at === 'object') refs.push(t.at.node);
        num(t.amount);
        num(t.level);
      }
      break;
    case 'threshold':
      refs.push(n.stock);
      num(n.level);
      break;
    case 'routine':
    case 'check':
      for (const v of Object.values(n.inputs)) num(v);
      break;
    case 'requirement':
      refs.push(...n.deps);
      num(n.window.start);
      num(n.window.end);
      break;
    default:
      break;
  }
  return [...new Set(refs)];
}

/** Timeline-valued dependencies only (the ones attribution walks). */
export function timelineDeps(n: NodeSpec): string[] {
  switch (n.kind) {
    case 'task':
      return n.deps;
    case 'gate':
      return n.deps;
    case 'delay':
      return [n.dep];
    case 'all':
    case 'any':
    case 'kofn':
    case 'requirement':
      return n.deps;
    case 'threshold':
      return [n.stock];
    default:
      return [];
  }
}
