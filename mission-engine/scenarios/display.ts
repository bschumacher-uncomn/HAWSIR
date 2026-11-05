import type { FactInput } from '../src/data/store';

/**
 * Display metadata for a mission: names, the voyage, the map, and how reports
 * land on a watch floor. None of this is read by the engine; it travels with
 * the scenario so the API can describe the mission to the UI.
 */
export interface Place {
  name: string;
  lon: number;
  lat: number;
  kind?: 'port' | 'airfield' | 'hub' | 'opArea';
}

export interface TrackPoint {
  t: number;
  lon: number;
  lat: number;
  label?: string;
}

/** A physical movement (part, person, aircraft, data) whose arrival is an engine node. */
export interface Leg {
  id: string;
  label: string;
  kind: 'part' | 'person' | 'aircraft' | 'data' | 'ship';
  nodeId: string;
  /** Origin place id, or `@<attr>:<entity>` to read it from a fact as of the viewed time (e.g. `@part_at:satcom-modem`). */
  from: string;
  /** Destination place id, or 'ship' for the ship's position on arrival. */
  to: string;
  /** For gates: destination by the slot the engine chose. */
  bySlot?: Record<string, string>;
  /** Ship the movement serves (multi-ship missions). */
  ship?: string;
}

export interface Phase {
  id: string;
  name: string;
  start: number;
  end: number;
  /** Requirements needed when the phase starts. */
  requires: string[];
  location?: string;
}

export interface MissionDisplay {
  id: string;
  short: string;
  name: string;
  tagline: string;
  /** days: labels like D-12 0700; hhour: labels like H-6:00. */
  timeScale: 'days' | 'hhour';
  dDay?: number;
  hHour?: number;
  tzOffset: number;
  ownShip: { id: string; name: string; hull: string; cls: string; homeport: string };
  mission: { name: string; area: string; start: number; summary: string; tasking: string };
  watchStart: number;
  defaultFocus: string;
  phases: Phase[];
  places: Record<string, Place>;
  legs: Leg[];
  missionArea?: { name: string; lon: number; lat: number; radiusKm: number };
  mapView: { longitude: number; latitude: number; zoom: number };
  tracks: Record<string, TrackPoint[]>;
  ships: { id: string; name: string; hull: string; cls: string; group: string }[];
}

/** One report as it lands on the watch floor; it may carry several facts. */
export interface ScenarioEvent {
  id: string;
  t: number;
  kind: 'casrep' | 'supply' | 'personnel' | 'schedule' | 'quality' | 'aviation' | 'fleet' | 'fuel' | 'link';
  severity: 'info' | 'warn' | 'crit';
  title: string;
  detail: string;
  /** What a traditional status board shows for this report. */
  board?: { system: string; status: 'DEGRADED' | 'FAULT' | 'CONSTRAINT' | 'DOWN' };
  facts: FactInput[];
  /** A data-link change on the ship node (DDIL), instead of facts. */
  link?: { up: boolean; reason: string; ship: string };
}
