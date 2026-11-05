import type { Severity } from '../../core/graph';
import type { AuthorityTable } from '../../core/risk';
import type { AttributeDef } from '../../data/store';
import { C } from './factors';

/**
 * The naval mission model: structure that changes rarely (who is in the group,
 * which systems each ship has, the tasking, the logistics network). Everything
 * that changes during the watch (fuel, system status, CASREPs, ETAs,
 * inventories, hub status, EMCON) arrives as facts in the data plane.
 *
 * Groups come first. A single ship is a group of one.
 */
export type ShipClass = 'CVN' | 'CG-47' | 'DDG-51' | 'T-AO' | 'T-AKE';
export type SystemKind = 'gtm' | 'ssgtg' | 'steering' | 'spy' | 'aegis' | 'vls' | 'ttwcs' | 'satcom' | 'link16' | 'flightdeck' | 'cmv22';

export interface SystemSpec {
  id: string;
  kind: SystemKind;
  label: string;
}

export interface PersonSpec {
  id: string;
  label: string;
  quals: string[];
}

export interface SpeedLeg {
  from: number;
  to: number;
  kt: number;
  label: string;
}

export interface ShipSpec {
  id: string;
  name: string;
  hull: string;
  cls: ShipClass;
  group: string;
  systems: SystemSpec[];
  people?: PersonSpec[];
  /** Fuel is tracked as % of capacity so GAO's %-of-load factors apply directly. */
  fuel?: boolean;
  magazines?: { weapon: 'TLAM' | 'SM'; capacity: number }[];
  speedPlan?: SpeedLeg[];
  mets?: string[];
}

export interface RollupSpec {
  code: string;
  label: string;
  k: number;
  window: [number, number];
  severity: Severity;
}

export interface GroupSpec {
  id: string;
  name: string;
  kind: 'CSG' | 'ARG' | 'SAG' | 'CLF';
  members: string[];
  commander: string;
  rollups?: RollupSpec[];
}

export interface NetNode {
  id: string;
  name: string;
  kind: 'hub' | 'airfield' | 'opArea';
  /** Hub-and-airfield pairs that fall together (e.g. a base and its airfield). */
  site?: string;
}

export interface Arc {
  from: string;
  to: string;
  nm: number;
}

export interface CodSpec {
  aircraft: string;
  carrier: string;
  opArea: string;
  airfields: string[];
  slots: { id: string; label: string; depart: number }[];
  /** Window after a slot opens in which the aircraft can still launch. */
  slotHours: number;
  payloadLb: number;
  /** Helicopter cross-deck from the carrier to an escort. */
  crossDeckHours: number;
  leadTimeHours: number;
}

export interface StrikeTasking {
  id: string;
  name: string;
  hHour: number;
  windowHours: number;
  weapon: 'TLAM';
  shooters: { ship: string; rounds: number }[];
  launchAuthority: string;
  taskingAuthority: string;
  /** Escort that can relay launch authority over Link-16 when a shooter loses SATCOM. */
  relayVia?: string;
  group: string;
  severity: Severity;
}

export interface UnrepPlan {
  id: string;
  label: string;
  provider: string;
  providerCls: 'T-AO' | 'T-AKE';
  receivers: string[];
  rendezvous: string;
  /** Departure options in preference order; the first open hub is used. */
  departFrom: { hub: string; readyAt: number }[];
  oneHose?: string[];
}

export interface ShuttleSpec {
  ship: string;
  cls: 'T-AKE';
  hubs: string[];
  opArea: string;
  loadHours: number;
  transferHours: number;
}

/** Illustrative positions for map display: network nodes and ship tracks (lon, lat). Not used in calculations. */
export interface GeoSpec {
  nodes: Record<string, [number, number]>;
  tracks: Record<string, { t: number; lon: number; lat: number }[]>;
  note?: string;
}

/** Linear interpolation along a track; clamps at the ends. */
export function positionAt(track: { t: number; lon: number; lat: number }[] | undefined, t: number): [number, number] | undefined {
  if (!track?.length) return undefined;
  const pts = track.slice().sort((a, b) => a.t - b.t);
  if (t <= pts[0].t) return [pts[0].lon, pts[0].lat];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return [a.lon + (b.lon - a.lon) * f, a.lat + (b.lat - a.lat) * f];
    }
  }
  const last = pts[pts.length - 1];
  return [last.lon, last.lat];
}

export interface NavalModel {
  id: string;
  name: string;
  epochUtc: string;
  horizon: [number, number];
  marks: Record<string, number>;
  groups: GroupSpec[];
  ships: ShipSpec[];
  network: { nodes: NetNode[]; arcs: Arc[] };
  cod?: CodSpec;
  shuttle?: ShuttleSpec;
  strikes: StrikeTasking[];
  unreps: UnrepPlan[];
  windows: { mob: [number, number]; aw: [number, number]; ccc: [number, number] };
  authority?: AuthorityTable;
  qMarginH?: number;
  geo?: GeoSpec;
}

export const NAVAL_ATTRIBUTES: AttributeDef[] = [
  { key: 'fuel_pct', type: 'number', unit: '%', min: 0, max: 100, worse: 'lower', maxAgeH: 12, description: 'Fuel on board, % of capacity' },
  { key: 'system_status', type: 'enum', enum: ['UP', 'DEGRADED', 'DOWN'], worse: ['DOWN', 'DEGRADED', 'UP'], absentMeansNone: true, description: 'Equipment status change (validFrom = when it changed)' },
  { key: 'casrep', type: 'json', absentMeansNone: true, description: 'Casualty report: { category, part?, repairHours, crewQual, crewK, fad, und } (validFrom = casualty time)', citation: C.CASREP },
  { key: 'part_eta', type: 'hours', worse: 'higher', conflictWindowH: 72, description: 'When a repair part reaches the node named by part_at' },
  { key: 'part_at', type: 'string', description: 'Network node (hub or airfield) where the part will be' },
  { key: 'magazine', type: 'number', unit: 'rounds', min: 0, worse: 'lower', maxAgeH: 168, description: 'Missiles on board by weapon (entity ship/weapon)' },
  { key: 'met_assessment', type: 'enum', enum: ['Y', 'Q', 'N'], worse: ['N', 'Q', 'Y'], maxAgeH: 720, absentMeansNone: true, description: 'Reported DRRS-N MET assessment (entity ship/code)', citation: C.DODIG },
  { key: 'node_status', type: 'enum', enum: ['OPEN', 'CLOSED'], worse: ['CLOSED', 'OPEN'], absentMeansNone: true, description: 'Hub or airfield status (validFrom = change time)', citation: C.BAHRAIN },
  { key: 'emcon', type: 'intervals', absentMeansNone: true, description: 'EMCON periods for a group (Link-16 transmit restricted; SATCOM broadcast receive unaffected)', citation: C.EMCON },
  { key: 'person_unavailable', type: 'intervals', absentMeansNone: true, description: 'Periods a person is unavailable (reason in the fact reason)' },
  { key: 'in_relay_range', type: 'boolean', description: 'Two ships within Link-16 relay range (entity a~b)' },
  { key: 'unrep_ready_at', type: 'hours', worse: 'higher', conflictWindowH: 72, absentMeansNone: true, description: 'Provider ready to depart its hub (entity unrep/hub)' },
  { key: 'replenish_trigger_pct', type: 'number', unit: '%', description: 'Replenish trigger (pack default 30%, GAO-98-1)', citation: C.GAO98 },
  { key: 'extremis_fuel_pct', type: 'number', unit: '%', description: 'Fuel floor below which tasking cannot be sustained (pack default 15%, synthetic)', citation: C.SYNTH },
  { key: 'sm_reserve_rounds', type: 'number', unit: 'rounds', description: 'Self-defense SM reserve per escort (pack default 8, synthetic)', citation: C.SYNTH },
];
