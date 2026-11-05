import { feature } from 'topojson-client';
import landTopo from 'world-atlas/land-50m.json';
import type { TrackPoint } from '@/api/types';

export type LonLat = [number, number];
export type LonLatZ = [number, number, number];

type Topology = Parameters<typeof feature>[0];
const topo = landTopo as unknown as Topology;
export const LAND = feature(topo, topo.objects.land);

export const GRATICULE: LonLat[][] = [
  ...Array.from({ length: 19 }, (_, i) => -90 + i * 10).map((lat) => Array.from({ length: 73 }, (_, j) => [-180 + j * 5, lat] as LonLat)),
  ...Array.from({ length: 37 }, (_, i) => -180 + i * 10).map((lon) => Array.from({ length: 35 }, (_, j) => [lon, -85 + j * 5] as LonLat)),
];

export function positionAt(track: TrackPoint[], t: number): { pos: LonLat; heading: number; leg: number } {
  if (!track.length) return { pos: [0, 0], heading: 90, leg: 0 };
  if (t <= track[0].t) return { pos: [track[0].lon, track[0].lat], heading: headingOf(track[0], track[1] ?? track[0]), leg: 0 };
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    if (t <= b.t) {
      const f = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      const moving = a.lon !== b.lon || a.lat !== b.lat;
      return { pos: [a.lon + (b.lon - a.lon) * f, a.lat + (b.lat - a.lat) * f], heading: moving ? headingOf(a, b) : headingOf(b, track[i + 1] ?? b), leg: i - 1 };
    }
  }
  const z = track[track.length - 1];
  return { pos: [z.lon, z.lat], heading: 90, leg: track.length - 1 };
}

function headingOf(a: { lon: number; lat: number }, b: { lon: number; lat: number }) {
  const dx = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const dy = b.lat - a.lat;
  if (Math.abs(dx) + Math.abs(dy) < 1e-9) return 90;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/** Track split at time t into the sailed and planned portions. */
export function splitTrack(track: TrackPoint[], t: number): { done: LonLat[]; todo: LonLat[] } {
  const { pos, leg } = positionAt(track, t);
  const done: LonLat[] = track.slice(0, leg + 1).map((p) => [p.lon, p.lat]);
  done.push(pos);
  const todo: LonLat[] = [pos, ...track.slice(leg + 1).map((p) => [p.lon, p.lat] as LonLat)];
  return { done, todo };
}

/** Offset a point by distance (km) along bearing (deg). Equirectangular; fine at these scales. */
export function offset([lon, lat]: LonLat, km: number, bearing: number): LonLat {
  const b = (bearing * Math.PI) / 180;
  const dLat = (km * Math.cos(b)) / 111.2;
  const dLon = (km * Math.sin(b)) / (111.2 * Math.cos((lat * Math.PI) / 180));
  return [lon + dLon, lat + dLat];
}

export function wedge(center: LonLat, km: number, from: number, to: number, steps = 24): LonLat[] {
  const pts: LonLat[] = [center];
  for (let i = 0; i <= steps; i++) pts.push(offset(center, km, from + ((to - from) * i) / steps));
  pts.push(center);
  return pts;
}

export function ring(center: LonLat, km: number, steps = 72): LonLat[] {
  return Array.from({ length: steps + 1 }, (_, i) => offset(center, km, (360 * i) / steps));
}

/** Raised arc between two points, height proportional to distance, for 3D logistics legs. */
export function arc(a: LonLat, b: LonLat, steps = 48): LonLatZ[] {
  const d = Math.hypot((b[0] - a[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180), b[1] - a[1]);
  const h = Math.min(900_000, d * 9000);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const f = i / steps;
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.sin(Math.PI * f) * h];
  });
}

export function along(path: LonLatZ[], f: number): LonLatZ {
  const x = Math.max(0, Math.min(1, f)) * (path.length - 1);
  const i = Math.floor(x);
  const j = Math.min(path.length - 1, i + 1);
  const k = x - i;
  return [path[i][0] + (path[j][0] - path[i][0]) * k, path[i][1] + (path[j][1] - path[i][1]) * k, path[i][2] + (path[j][2] - path[i][2]) * k];
}

export function dms([lon, lat]: LonLat) {
  const f = (v: number, p: string, n: string) => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const m = (a - d) * 60;
    return `${String(d).padStart(2, '0')}°${m.toFixed(1).padStart(4, '0')}'${v >= 0 ? p : n}`;
  };
  return `${f(lat, 'N', 'S')} ${f(lon, 'E', 'W')}`;
}

/** Speed of advance (knots) on the track leg at time t. */
export function speedAt(track: TrackPoint[], t: number): number {
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    if (t <= b.t && b.t > a.t) {
      const nm = Math.hypot((b.lon - a.lon) * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180), b.lat - a.lat) * 60;
      return nm / (b.t - a.t);
    }
  }
  return 0;
}
