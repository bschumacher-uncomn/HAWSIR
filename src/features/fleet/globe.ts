import { LAND, type LonLat } from '@/features/theater/geo';

export type LonLatZ = [number, number, number];

const R_KM = 6371;
const rad = Math.PI / 180;

function vec([lon, lat]: LonLat): [number, number, number] {
  const cl = Math.cos(lat * rad);
  return [cl * Math.cos(lon * rad), cl * Math.sin(lon * rad), Math.sin(lat * rad)];
}

/** Great-circle path lifted into an arc whose height grows with distance (meters). */
export function gcArc(a: LonLat, b: LonLat, n = 48): LonLatZ[] {
  const va = vec(a);
  const vb = vec(b);
  const d = Math.acos(Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
  if (d < 1e-4) return [[a[0], a[1], 0], [b[0], b[1], 0]];
  const h = Math.min(1600, Math.max(70, d * R_KM * 0.13)) * 1000;
  const out: LonLatZ[] = [];
  let prev = a[0];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const s = Math.sin((1 - f) * d) / Math.sin(d);
    const t = Math.sin(f * d) / Math.sin(d);
    const x = s * va[0] + t * vb[0];
    const y = s * va[1] + t * vb[1];
    const z = s * va[2] + t * vb[2];
    let lon = Math.atan2(y, x) / rad;
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    prev = lon;
    out.push([lon, Math.asin(z) / rad, Math.sin(Math.PI * f) * h]);
  }
  return out;
}

export function alongPath(p: LonLatZ[], f: number): LonLatZ {
  const x = Math.min(0.9999, Math.max(0, f)) * (p.length - 1);
  const i = Math.floor(x);
  const t = x - i;
  const a = p[i];
  const b = p[i + 1] ?? a;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function gcKm(a: LonLat, b: LonLat) {
  const va = vec(a);
  const vb = vec(b);
  return Math.acos(Math.min(1, Math.max(-1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]))) * R_KM;
}

/** Opaque ocean shell so the far side of the globe is occluded. */
export const OCEAN: LonLat[][] = (() => {
  const out: LonLat[][] = [];
  for (let lat = -90; lat < 90; lat += 10)
    for (let lon = -180; lon < 180; lon += 10)
      out.push([[lon, lat], [lon + 10, lat], [lon + 10, lat + 10], [lon, lat + 10]]);
  return out;
})();

let dots: LonLat[] | null = null;

/** Land as an even dot matrix: rasterize the coastline once, then sample on a near-equal-area grid. */
export function landDots(step = 1.25): LonLat[] {
  if (dots) return dots;
  const W = 1440;
  const H = 720;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return (dots = []);
  ctx.fillStyle = '#fff';
  const px = ([lon, lat]: number[]) => [((lon + 180) / 360) * W, ((90 - lat) / 180) * H] as const;
  ctx.beginPath();
  for (const f of (LAND as unknown as { features: { geometry: { type: string; coordinates: unknown } }[] }).features) {
    const g = f.geometry;
    const polys = (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) as number[][][][];
    for (const poly of polys)
      for (const ringPts of poly) {
        ringPts.forEach((p, i) => {
          const [x, y] = px(p);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
  }
  ctx.fill('evenodd');
  const img = ctx.getImageData(0, 0, W, H).data;
  const out: LonLat[] = [];
  let row = 0;
  for (let lat = -82; lat <= 84; lat += step, row++) {
    const lonStep = Math.min(30, step / Math.max(0.05, Math.cos(lat * rad)));
    for (let lon = -180 + (row % 2) * lonStep * 0.5; lon < 180; lon += lonStep) {
      const [x, y] = px([lon, lat]);
      if (img[(Math.floor(y) * W + Math.floor(x)) * 4 + 3] > 0) out.push([lon, lat]);
    }
  }
  return (dots = out);
}
