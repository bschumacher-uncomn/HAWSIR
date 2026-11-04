import DeckGL from '@deck.gl/react';
import { _GlobeView as GlobeView, _GlobeViewport as GlobeViewport, LinearInterpolator, type PickingInfo } from '@deck.gl/core';
import { GeoJsonLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers';
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Box, CloudLightning, Crosshair, FlaskConical, Plane, Radio, Satellite, Ship, User, Users, Warehouse, X, type LucideIcon } from 'lucide-react';
import { fmtDur } from '@/engine/time';
import type { Readiness } from '@/engine/types';
import { useStore } from '@/state/store';
import { Panel, StatusBadge, Ticker } from '@/components/ui';
import { cn, STATUS_COLOR, STATUS_WORD } from '@/lib/util';
import { CAP_LABEL, DISRUPTIONS, FLEET_NAME, MISSIONS, PLACES, SHIPS, type FleetId, type Issue, type MissionSpec } from './data';
import { buildFleet, FLEET_Q, type FleetMission, type FleetPackage, type FleetPicture, type FleetShip, type PkgTone, type ShipStatus } from './model';
import { useFleet } from './store';
import { alongPath, gcArc, gcKm, landDots, OCEAN, type LonLatZ } from './globe';
import { GRATICULE, LAND, offset, ring, type LonLat } from '@/features/theater/geo';

type RGBA = [number, number, number, number];
const rgb = (hex: string, a = 255): RGBA => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), a];
const TONE_HEX: Record<PkgTone, string> = { crit: '#fb3b5c', risk: '#fbbf24', ok: '#22d3ee' };
const SHIP_HEX: Record<ShipStatus, string> = { ...STATUS_COLOR, M: '#64748b' };
const KIND_ICON: Record<Issue['kind'], LucideIcon> = { part: Box, person: User, data: Radio };
const DISRUPT_ICON: Record<string, LucideIcon> = { amc: Plane, suez: Ship, typhoon: CloudLightning, dla: Warehouse, nsips: Users, satcom: Satellite };
const RANK: Record<Readiness, number> = { Y: 0, Q: 1, N: 2 };
const DETAIL_SCENARIO: Record<string, string> = { 'DDG-170': 'ddg21', 'DDG-173': 'reload72' };

const near = (from: number, to: number) => to + 360 * Math.round((from - to) / 360);
const unit = ([lon, lat]: LonLat): [number, number, number] => {
  const r = Math.PI / 180;
  return [Math.cos(lat * r) * Math.cos(lon * r), Math.cos(lat * r) * Math.sin(lon * r), Math.sin(lat * r)];
};
const cosLat = (lat: number) => Math.cos((Math.min(Math.abs(lat), 85) * Math.PI) / 180);
/** GlobeViewport: globe radius is 256 common units scaled by 2^zoom / (π cos lat); camera sits 1.5 viewport-heights out. */
const zoomFor = (h: number, lat: number, fill: number) => Math.log2((1.5 * Math.sin(Math.atan(fill / 1.5)) * Math.PI * cosLat(lat) * h) / 256);
function globePx(zoom: number, lat: number, h: number) {
  const r = (256 * 2 ** zoom) / (Math.PI * cosLat(lat) * h);
  return r >= 1.5 ? Infinity : 1.5 * h * Math.tan(Math.asin(r / 1.5));
}

const slackText = (p: FleetPackage) => (!p.recoverable ? 'BLOCKED' : p.slack >= 24 * 30 ? '> 30d' : fmtDur(p.slack, { signed: true }));

const STARS = (() => {
  let a = 7;
  const r = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: 160 }, () => `${Math.round(r() * 2400)}px ${Math.round(r() * 1400)}px 0 ${r() < 0.1 ? 1 : 0}px rgba(186,230,253,${(0.15 + r() * 0.55).toFixed(2)})`).join(',');
})();

const TIP_STYLE = {
  background: 'rgba(2,8,16,0.95)',
  border: '1px solid rgba(56,189,248,0.35)',
  color: '#e0f2fe',
  fontFamily: 'JetBrains Mono Variable, monospace',
  fontSize: '11px',
  lineHeight: '1.45',
  padding: '8px 10px',
  borderRadius: '3px',
  maxWidth: '340px',
};

type VS = { longitude: number; latitude: number; zoom: number; [k: string]: unknown };
type Label = { id: string; x: number; y: number; o: number; w: number; h: number; fit: 'move' | 'drop' | 'fade'; node: ReactNode; click?: () => void };

/** Greedy placement in priority order: nudge vertically, otherwise drop or fade. Labels anchor bottom-center. */
function declutter(labels: Label[]) {
  const boxes: [number, number, number, number][] = [];
  const hits = (x: number, y: number, w: number, h: number) => boxes.some(([x0, y0, x1, y1]) => x - w / 2 < x1 && x + w / 2 > x0 && y - h < y1 && y > y0);
  for (const l of labels) {
    let y = l.y;
    if (l.fit === 'move') {
      const tries = [0, l.h, -l.h, 2 * l.h, -2 * l.h, 3 * l.h];
      const dy = tries.find((d) => !hits(l.x, l.y + d, l.w, l.h));
      if (dy === undefined) l.o *= 0.25;
      else y = l.y + dy;
    } else if (hits(l.x, y, l.w, l.h)) {
      l.o = l.fit === 'drop' ? 0 : l.o * 0.2;
    }
    l.y = y;
    if (l.o > 0.3) boxes.push([l.x - l.w / 2, y - l.h, l.x + l.w / 2, y]);
  }
}
type Arc = { p: FleetPackage; path: LonLatZ[]; speed: number; phase: number };

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

const FleetGlobe = memo(function FleetGlobe({
  pic,
  mission,
  ship,
  onShip,
  onMission,
}: {
  pic: FleetPicture;
  mission: string | null;
  ship: string | null;
  onShip: (hull: string) => void;
  onMission: (id: string) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1600, h: 900 });
  const h = size.h;
  const [vs, setVs] = useState<VS>({ longitude: 24, latitude: 22, zoom: 1.9 });
  const [t, setT] = useState(0);
  const lastTouch = useRef(0);
  const focused = useRef(false);
  const flying = useRef(false);
  const picRef = useRef(pic);
  picRef.current = pic;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth || 1600, h: el.clientHeight || 900 });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      if (dt > 0.033) {
        last = now;
        setT(now / 1000);
        if (!focused.current && !flying.current && now - lastTouch.current > 5000) setVs((v) => ({ ...v, longitude: ((v.longitude + Math.min(dt, 0.1) * 2.4 + 540) % 360) - 180 }));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    let target: { lon: number; lat: number; fill: number } | null = null;
    const s = ship ? picRef.current.ships.find((x) => x.spec.hull === ship) : undefined;
    const m = mission ? MISSIONS.find((x) => x.id === mission) : undefined;
    if (s) target = { lon: s.pos[0], lat: s.pos[1], fill: 1.5 };
    else if (m) target = { lon: m.area[0], lat: m.area[1], fill: 0.95 };
    focused.current = !!target;
    flying.current = true;
    if (!target) lastTouch.current = performance.now() - 3500;
    setVs((v) => {
      const lat = target ? target.lat : 22;
      return {
        longitude: target ? near(v.longitude, target.lon) : v.longitude,
        latitude: lat,
        zoom: zoomFor(h, lat, target ? target.fill : 0.44),
        transitionDuration: 1600,
        transitionInterpolator: new LinearInterpolator(['longitude', 'latitude', 'zoom']),
        transitionEasing: ease,
        onTransitionEnd: () => (flying.current = false),
        onTransitionInterrupt: () => (flying.current = false),
      };
    });
  }, [ship, mission, h]);

  const dots = useMemo(() => landDots(), []);
  const focus = useMemo(() => {
    if (ship) return new Set([ship]);
    if (mission) return new Set(MISSIONS.find((m) => m.id === mission)?.reqs.flatMap((r) => r.ships) ?? []);
    return null;
  }, [ship, mission]);
  const fkey = `${mission}|${ship}`;

  const arcs: Arc[] = useMemo(
    () =>
      pic.packages.map((p, i) => {
        const km = gcKm(p.from, p.to);
        return { p, path: gcArc(p.from, p.to, Math.round(Math.min(64, Math.max(10, km / 140)))), speed: Math.min(0.5, 0.08 + 260 / Math.max(km, 300) / 6), phase: (i * 0.618) % 1 };
      }),
    [pic],
  );

  const staticLayers = useMemo(
    () => [
      new SolidPolygonLayer({ id: 'ocean', data: OCEAN, getPolygon: (d) => d, getFillColor: [3, 14, 27, 255] }),
      new GeoJsonLayer({ id: 'land', data: LAND, filled: true, stroked: true, getFillColor: [6, 26, 44, 255], getLineColor: [56, 189, 248, 70], getLineWidth: 0.8, lineWidthUnits: 'pixels' }),
      new ScatterplotLayer({ id: 'land-dots', data: dots, getPosition: (d) => d, getRadius: 17000, getFillColor: [56, 189, 248, 120] }),
      new PathLayer({ id: 'grat', data: GRATICULE, getPath: (d) => d, getColor: [34, 211, 238, 20], getWidth: 1, widthUnits: 'pixels' }),
      new ScatterplotLayer({
        id: 'depots',
        data: Object.values(PLACES),
        getPosition: (d) => [d.lon, d.lat, 1500],
        getRadius: 2.6,
        radiusUnits: 'pixels',
        billboard: true,
        getFillColor: [2, 6, 12, 255],
        stroked: true,
        getLineColor: [224, 242, 254, 200],
        getLineWidth: 1.2,
        lineWidthUnits: 'pixels',
        pickable: true,
      }),
    ],
    [dots],
  );

  const ph = (t % 2) / 2;
  const dim = (hull: string) => (focus ? focus.has(hull) : true);
  const missionStatus = new Map(pic.missions.map((m) => [m.spec.id, m]));

  const layers = [
    ...staticLayers,
    new SolidPolygonLayer({
      id: 'mission-fill',
      data: MISSIONS,
      getPolygon: (m) => ring(m.area, m.radiusKm, 48),
      getFillColor: (m) => rgb(STATUS_COLOR[missionStatus.get(m.id)!.status], m.id === mission ? 60 : 26),
      pickable: true,
      onClick: ({ object }) => object && onMission(object.id),
      updateTriggers: { getFillColor: [pic, mission] },
    }),
    new PathLayer<{ m: MissionSpec; st: Readiness; path: LonLat[]; a: number }>({
      id: 'mission-ring',
      data: MISSIONS.flatMap((m) => {
        const st = missionStatus.get(m.id)!.status;
        const base = { m, st, path: ring(m.area, m.radiusKm, 72), a: 210 };
        return st === 'Y' && m.id !== mission ? [base] : [base, { m, st, path: ring(m.area, m.radiusKm * (1 + ph * 0.6), 72), a: Math.round(170 * (1 - ph)) }];
      }),
      getPath: (d) => d.path,
      getColor: (d) => rgb(STATUS_COLOR[d.st], d.a),
      getWidth: (d) => (d.m.id === mission ? 2.4 : 1.4),
      widthUnits: 'pixels',
      updateTriggers: { getColor: [ph, pic], getWidth: mission },
    }),
    new PathLayer<Arc>({
      id: 'arc-glow',
      data: arcs.filter((a) => a.p.tone !== 'ok' || a.p.onChain),
      getPath: (a) => a.path,
      getColor: (a) => rgb(TONE_HEX[a.p.tone], dim(a.p.hull) ? (a.p.hits.length ? Math.round(40 + 50 * Math.sin(t * 4) ** 2) : 40) : 8),
      getWidth: (a) => (a.p.tone === 'crit' ? 9 : 7),
      widthUnits: 'pixels',
      updateTriggers: { getColor: [fkey, Math.round(t * 10)] },
    }),
    new PathLayer<Arc>({
      id: 'arc',
      data: arcs,
      getPath: (a) => a.path,
      getColor: (a) => rgb(TONE_HEX[a.p.tone], (a.p.routine ? 95 : 220) * (dim(a.p.hull) ? 1 : 0.18)),
      getWidth: (a) => (a.p.routine ? 1 : a.p.tone === 'ok' ? 1.6 : 2.4),
      widthUnits: 'pixels',
      pickable: true,
      onClick: ({ object }) => object && onShip(object.p.hull),
      updateTriggers: { getColor: fkey },
    }),
    new ScatterplotLayer<{ a: Arc; pos: LonLatZ }>({
      id: 'packets',
      data: arcs.flatMap((a) => (a.p.routine ? [0] : [0, 0.5]).map((o) => ({ a, pos: alongPath(a.path, (t * a.speed + a.phase + o) % 1) }))),
      getPosition: (d) => d.pos,
      getRadius: (d) => (d.a.p.routine ? 1.6 : 2.6),
      radiusUnits: 'pixels',
      billboard: true,
      getFillColor: (d) => (d.a.p.tone === 'ok' ? [224, 250, 255, dim(d.a.p.hull) ? 230 : 40] : rgb(TONE_HEX[d.a.p.tone], dim(d.a.p.hull) ? 255 : 40)),
      updateTriggers: { getPosition: t, getFillColor: fkey },
    }),
    new ScatterplotLayer<FleetShip>({
      id: 'ship-pulse',
      data: pic.ships.filter((s) => s.status === 'N' || s.spec.hull === ship),
      getPosition: (s) => [s.pos[0], s.pos[1], 3000],
      getRadius: (s) => (s.spec.hull === ship ? 12 : 6 + ph * 16),
      radiusUnits: 'pixels',
      billboard: true,
      filled: false,
      stroked: true,
      getLineColor: (s) => (s.spec.hull === ship ? [255, 255, 255, 230] : rgb(SHIP_HEX[s.status], Math.round(230 * (1 - ph)))),
      getLineWidth: 1.6,
      lineWidthUnits: 'pixels',
      updateTriggers: { getRadius: [ph, ship], getLineColor: [ph, ship] },
    }),
    new ScatterplotLayer<FleetShip>({
      id: 'ships',
      data: pic.ships,
      getPosition: (s) => [s.pos[0], s.pos[1], 3000],
      getRadius: (s) => (/^(CVN|LHA)/.test(s.spec.hull) ? 6.5 : 4.4),
      radiusUnits: 'pixels',
      billboard: true,
      getFillColor: (s) => rgb(SHIP_HEX[s.status], dim(s.spec.hull) ? 255 : 90),
      stroked: true,
      getLineColor: [2, 6, 12, 255],
      getLineWidth: 1.4,
      lineWidthUnits: 'pixels',
      pickable: true,
      onClick: ({ object }) => object && onShip(object.spec.hull),
      updateTriggers: { getFillColor: [pic, fkey] },
    }),
  ];

  // deck's TextLayer does not draw under GlobeView here, so labels are DOM nodes projected through the same viewport.
  const vp = new GlobeViewport({ width: size.w, height: size.h, longitude: vs.longitude, latitude: vs.latitude, zoom: vs.zoom });
  const cosLimb = Math.min(1, (256 * 2 ** vs.zoom) / (Math.PI * cosLat(vs.latitude) * size.h) / 1.5);
  const center = unit([vs.longitude, vs.latitude]);
  const place = (ll: LonLat, z = 0) => {
    const v = unit(ll);
    const d = v[0] * center[0] + v[1] * center[1] + v[2] * center[2] - cosLimb;
    if (d < 0.03) return null;
    const [x, y] = vp.project([ll[0], ll[1], z]);
    return { x, y, o: Math.min(1, (d - 0.03) / 0.12) };
  };
  const labels: Label[] = [];
  for (const m of pic.missions) {
    const p = place(offset(m.spec.area, m.spec.radiusKm + 40, 0), 20000);
    if (!p) continue;
    const sel = m.spec.id === mission;
    labels.push({
      id: m.spec.id,
      ...p,
      o: p.o * (!focus || sel ? 1 : 0.5),
      w: m.spec.name.length * (sel ? 9.4 : 7.6) + 62,
      h: sel ? 22 : 19,
      fit: 'move',
      click: () => onMission(m.spec.id),
      node: (
        <span className={cn('flex items-center gap-1.5 whitespace-nowrap rounded-[2px] border bg-black/60 px-1.5 py-0.5 backdrop-blur-[2px]', sel ? 'border-white/50' : 'border-transparent')} style={{ boxShadow: m.status === 'N' ? '0 0 14px -4px #fb3b5c' : undefined }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[m.status] }} />
          <span className={cn('font-display font-bold tracking-[0.12em]', sel ? 'text-[13px]' : 'text-[10.5px]')} style={{ color: STATUS_COLOR[m.status] }}>
            {m.spec.name}
          </span>
          <span className="font-mono text-[9.5px] text-sky-100/70">{Number.isFinite(m.margin) ? fmtDur(m.margin, { signed: true }) : '—'}</span>
        </span>
      ),
    });
  }
  for (const s of pic.ships) {
    if (focus ? !focus.has(s.spec.hull) : s.status !== 'N') continue;
    const p = place(s.pos, 3000);
    if (!p) continue;
    labels.push({
      id: s.spec.hull,
      ...p,
      y: p.y + 22,
      w: s.spec.hull.length * 6.6 + 4,
      h: 13,
      fit: 'move',
      click: () => onShip(s.spec.hull),
      node: (
        <span className="whitespace-nowrap font-mono text-[10px] font-bold" style={{ color: SHIP_HEX[s.status], textShadow: '0 0 4px #02060c, 0 0 2px #02060c' }}>
          {s.spec.hull}
        </span>
      ),
    });
  }
  if (focus)
    for (const pl of Object.values(PLACES)) {
      const p = place([pl.lon, pl.lat]);
      if (p && vs.zoom > 3.2)
        labels.push({ id: pl.name, ...p, y: p.y + 16, o: p.o * 0.8, w: pl.name.length * 5.6, h: 12, fit: 'drop', node: <span className="whitespace-nowrap font-mono text-[9px] text-sky-100/70" style={{ textShadow: '0 0 4px #02060c' }}>{pl.name}</span> });
    }
  for (const f of Object.values(FLEET_NAME)) {
    const p = place([f.lon, f.lat]);
    if (p) labels.push({ id: f.name, ...p, o: p.o * (focus ? 0.35 : 1), w: f.name.length * 12.5, h: 16, fit: 'fade', node: <span className="whitespace-nowrap font-display text-[12px] font-bold tracking-[0.42em] text-sky-300/40">{f.name}</span> });
  }
  declutter(labels);

  const tip = ({ object, layer }: PickingInfo) => {
    if (!object || !layer) return null;
    if (layer.id === 'arc') {
      const p = (object as Arc).p;
      return {
        html: `<b>${p.item}</b><br/>${p.fromName} → ${p.toName}<br/>${p.mode} · ${p.hull} ${p.cap} · arrives +${fmtDur(p.eta)}<br/><span style="color:${TONE_HEX[p.tone]}">slack ${slackText(p)}</span>${p.routine ? ' · routine' : ''}${p.hits.length ? `<br/><span style="color:#c4b5fd">what-if: ${p.hits.join(', ')}</span>` : ''}`,
        style: TIP_STYLE,
      };
    }
    if (layer.id === 'ships') {
      const s = object as FleetShip;
      return {
        html: `<b>${s.spec.hull} ${s.spec.name}</b><br/>${s.spec.cls} · ${s.spec.fleet}${s.spec.state === 'maint' ? ' · in maintenance' : ''}<br/><span style="color:${SHIP_HEX[s.status]}">${s.status === 'M' ? 'MAINTENANCE' : STATUS_WORD[s.status]}</span>${s.worst ? ` · ${s.worst.cap} ${fmtDur(s.worst.margin, { signed: true })}<br/>${s.worst.controlling}` : ''}`,
        style: TIP_STYLE,
      };
    }
    if (layer.id === 'mission-fill') {
      const m = missionStatus.get((object as { id: string }).id)!;
      return { html: `<b>${m.spec.name}</b> · ${m.spec.kind}<br/><span style="color:${STATUS_COLOR[m.status]}">${STATUS_WORD[m.status]} ${fmtDur(m.margin, { signed: true })}</span>`, style: TIP_STYLE };
    }
    if (layer.id === 'depots') return { html: (object as { name: string }).name, style: TIP_STYLE };
    return null;
  };

  const rpx = globePx(vs.zoom, vs.latitude, h);
  return (
    <div ref={wrap} className="absolute inset-0">
      {Number.isFinite(rpx) && (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 rounded-full"
          style={{
            width: rpx * 2,
            height: rpx * 2,
            transform: 'translate(-50%, -50%)',
            boxShadow: '0 0 60px 14px rgba(34,211,238,0.16), 0 0 160px 40px rgba(14,116,144,0.18), inset 0 0 40px 6px rgba(34,211,238,0.12)',
          }}
        />
      )}
      <DeckGL
        views={new GlobeView({ id: 'globe', resolution: 5 })}
        viewState={vs}
        onViewStateChange={({ viewState, interactionState }) => {
          if (interactionState?.isDragging || interactionState?.isZooming || interactionState?.isPanning) {
            lastTouch.current = performance.now();
            flying.current = false;
          }
          setVs(viewState as VS);
        }}
        controller={{ inertia: 300 }}
        layers={layers}
        getTooltip={tip}
        getCursor={({ isHovering, isDragging }) => (isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab')}
      />
      {Number.isFinite(rpx) && (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 rounded-full"
          style={{ width: rpx * 2, height: rpx * 2, transform: 'translate(-50%, -50%)', background: 'radial-gradient(circle, transparent 62%, rgba(34,211,238,0.07) 88%, rgba(125,211,252,0.22) 99%, transparent 100%)' }}
        />
      )}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {labels.map((l) => (
          <div
            key={l.id}
            className={cn('absolute left-0 top-0', l.click && 'pointer-events-auto cursor-pointer')}
            style={{ transform: `translate(${l.x}px, ${l.y}px) translate(-50%, -100%)`, opacity: l.o }}
            onClick={l.click}
          >
            {l.node}
          </div>
        ))}
      </div>
    </div>
  );
});

function Margin({ status, margin, className }: { status: Readiness; margin: number; className?: string }) {
  return (
    <span className={cn('font-mono font-bold tabular', className)} style={{ color: STATUS_COLOR[status] }}>
      {Number.isFinite(margin) ? fmtDur(margin, { signed: true }) : 'NO WINDOW'}
    </span>
  );
}

function Tally({ label, parts }: { label: string; parts: { v: number; cls: string; k: string }[] }) {
  return (
    <div className="min-w-0">
      <div className="label !text-[8.5px]">{label}</div>
      <div className="flex items-baseline gap-2 font-mono text-[16px] font-bold">
        {parts.map((p) => (
          <span key={p.k} className="flex items-baseline gap-0.5">
            <Ticker value={p.v} format={(v) => v.toFixed(0)} className={p.cls} />
            <span className="text-[8.5px] font-normal text-mute">{p.k}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ShipDot({ status }: { status: ShipStatus }) {
  return <span className="inline-block h-2 w-2 rounded-full" style={{ background: SHIP_HEX[status], boxShadow: `0 0 6px ${SHIP_HEX[status]}` }} />;
}

function PackageRow({ p, onClick, showHull }: { p: FleetPackage; onClick?: () => void; showHull?: boolean }) {
  const Icon = KIND_ICON[p.kind];
  const col = TONE_HEX[p.tone];
  return (
    <button type="button" onClick={onClick} className={cn('w-full rounded-[3px] border bg-black/40 px-2 py-1.5 text-left transition hover:bg-black/60', p.onChain && p.tone !== 'ok' ? 'border-unc/40' : 'border-sky-300/10')}>
      <div className="flex items-center gap-1.5">
        <Icon size={12} style={{ color: col }} />
        <span className="truncate text-[11.5px] font-medium text-sky-50">{p.item}</span>
        <span className="ml-auto shrink-0 font-mono text-[11px] font-bold" style={{ color: col }} title="How long this can slip before its capability misses the mission (negative: it must arrive this much earlier)">
          {slackText(p)}
        </span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[9.5px] text-mute">
        {showHull && <span className="text-sky-200/80">{p.hull}</span>}
        <span className="truncate">
          {p.fromName} → {p.toName}
        </span>
        <span className="ml-auto shrink-0">
          {p.mode} · {p.cap}
        </span>
      </div>
      {(p.onChain || p.hits.length > 0) && (
        <div className="mt-1 flex flex-wrap gap-1">
          {p.onChain && <span className="rounded-[2px] border border-unc/50 px-1 font-mono text-[8.5px] text-unc">{p.noImpact < 1 / 60 ? 'CRITICAL CHAIN · 0 SLACK' : 'CRITICAL CHAIN'}</span>}
          {p.hits.map((h) => (
            <span key={h} className="rounded-[2px] border border-ai/50 px-1 font-mono text-[8.5px] uppercase text-ai">
              what-if · {DISRUPTIONS.find((d) => d.id === h)?.label}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function MissionDetail({ m, pic, onShip }: { m: FleetMission; pic: FleetPicture; onShip: (h: string) => void }) {
  const hulls = new Set(m.spec.reqs.flatMap((r) => r.ships));
  const pkgs = pic.packages.filter((p) => hulls.has(p.hull) && !p.routine).sort((a, b) => a.slack - b.slack);
  const ctl = m.controlling;
  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center gap-2">
          <StatusBadge status={m.status} size="lg" pulse={m.status === 'N'} />
          <div className="min-w-0">
            <div className="truncate font-display text-[16px] font-bold tracking-[0.14em] text-white">{m.spec.name}</div>
            <div className="font-mono text-[10px] text-mute">
              {m.spec.kind} · {m.spec.fleet} · starts in {fmtDur(m.spec.startH)}
            </div>
          </div>
          <Margin status={m.status} margin={m.margin} className="ml-auto text-[18px]" />
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-sky-100/75">{m.spec.summary}</p>
      </div>
      {ctl && (
        <div className="rounded-[3px] border border-calc/30 bg-calc/[0.06] px-2.5 py-2">
          <div className="label !text-[9px] !text-calc">Controlling constraint · deterministic</div>
          <div className="mt-1 text-[12.5px] leading-snug text-white">
            <button type="button" className="font-mono font-bold text-calc hover:underline" onClick={() => onShip(ctl.hull)}>
              {ctl.hull}
            </button>{' '}
            {CAP_LABEL[ctl.cap].toLowerCase()}: {ctl.reason}
          </div>
        </div>
      )}
      {m.reqs.map((r) => (
        <div key={r.cap}>
          <div className="mb-1 flex items-center gap-2">
            <span className="font-display text-[11px] font-bold tracking-[0.14em] text-sky-100">{r.cap}</span>
            <span className="font-mono text-[10px] text-mute">
              need {r.k} of {r.n} · {CAP_LABEL[r.cap]}
            </span>
            <Margin status={r.status} margin={r.margin} className="ml-auto text-[11px]" />
          </div>
          <div className="space-y-1">
            {[...r.contributions]
              .sort((a, b) => RANK[a.status] - RANK[b.status] || b.margin - a.margin)
              .map((c) => {
                const counted = r.selected.includes(c);
                const absorbed = r.absorbed.includes(c);
                return (
                  <button
                    key={c.hull}
                    type="button"
                    onClick={() => onShip(c.hull)}
                    className={cn('flex w-full items-center gap-2 rounded-[3px] border px-2 py-1 text-left transition hover:bg-black/60', counted ? 'border-sky-300/20 bg-black/40' : 'border-transparent bg-black/20 opacity-70')}
                  >
                    <StatusBadge status={c.status} size="sm" />
                    <span className="w-[62px] shrink-0 font-mono text-[11px] font-bold text-white">{c.hull}</span>
                    <span className="min-w-0 flex-1 truncate text-[10.5px] text-sky-100/70">{c.reason}</span>
                    {absorbed ? (
                      <span className="shrink-0 rounded-[2px] border border-ok/40 px-1 font-mono text-[8.5px] text-ok">ABSORBED</span>
                    ) : (
                      <Margin status={c.status} margin={c.margin} className="shrink-0 text-[10.5px]" />
                    )}
                  </button>
                );
              })}
          </div>
        </div>
      ))}
      {pkgs.length > 0 && (
        <div>
          <div className="label mb-1 !text-[9px]">Packages feeding this mission · slack before they break it</div>
          <div className="space-y-1">
            {pkgs.map((p) => (
              <PackageRow key={p.id} p={p} showHull onClick={() => onShip(p.hull)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ShipDetail({ s, onBack, backLabel }: { s: FleetShip; onBack: () => void; backLabel: string }) {
  const navigate = useNavigate();
  const setScenario = useStore((x) => x.setScenario);
  const scen = DETAIL_SCENARIO[s.spec.hull];
  const pkgs = [...s.packages].sort((a, b) => (a.routine === b.routine ? a.slack - b.slack : a.routine ? 1 : -1));
  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className="flex items-center gap-1 font-mono text-[10px] text-mute hover:text-sky-100">
        <ArrowLeft size={11} /> {backLabel}
      </button>
      <div className="flex items-center gap-2">
        {s.status === 'M' ? <span className="rounded-[2px] border border-slate-500/60 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-300">MAINT</span> : <StatusBadge status={s.status} size="lg" pulse={s.status === 'N'} />}
        <div className="min-w-0">
          <div className="truncate font-display text-[15px] font-bold tracking-[0.12em] text-white">
            {s.spec.hull} {s.spec.name.replace(/^USNS? /, '')}
          </div>
          <div className="font-mono text-[10px] text-mute">
            {s.spec.cls} · {s.spec.fleet} · {s.spec.state === 'maint' ? 'in maintenance' : s.spec.state}
            {s.spec.mission && ` · ${MISSIONS.find((m) => m.id === s.spec.mission)?.name}`}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {s.caps.map((c) => (
          <span key={c.cap} className="flex items-center gap-1 rounded-[2px] border px-1.5 py-0.5" style={{ borderColor: `${STATUS_COLOR[c.status]}55` }} title={c.controlling}>
            <StatusBadge status={c.status} size="sm" />
            <span className="font-display text-[10px] font-bold tracking-wider text-white">{c.cap}</span>
            <Margin status={c.status} margin={c.margin} className="text-[10px]" />
          </span>
        ))}
      </div>
      {s.worst && s.status !== 'Y' && (
        <div className="rounded-[3px] border border-calc/30 bg-calc/[0.06] px-2.5 py-2 text-[12px] leading-snug text-white">
          <div className="label !text-[9px] !text-calc">Controlling · {s.worst.label}</div>
          <div className="mt-1">{s.worst.controlling}</div>
        </div>
      )}
      {scen && (
        <button
          type="button"
          onClick={() => {
            setScenario(scen);
            navigate('/');
          }}
          className="flex w-full items-center gap-2 rounded-[3px] border border-calc/50 bg-calc/10 px-3 py-2 text-left font-display text-[12px] font-bold tracking-[0.12em] text-calc transition hover:bg-calc/20 hover:shadow-[0_0_20px_-4px_#22d3ee]"
        >
          <Crosshair size={14} /> OPEN {s.spec.hull} WATCH FLOOR <ArrowRight size={14} className="ml-auto" />
        </button>
      )}
      <div>
        <div className="label mb-1 !text-[9px]">Inbound packages · {s.packages.length}</div>
        <div className="space-y-1">
          {pkgs.map((p) => (
            <PackageRow key={p.id} p={p} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FleetSummary({ pic, onShip }: { pic: FleetPicture; onShip: (h: string) => void }) {
  const fleets = Object.keys(FLEET_NAME) as FleetId[];
  const atRisk = pic.packages.filter((p) => !p.routine && p.tone !== 'ok').sort((a, b) => a.slack - b.slack);
  return (
    <div className="space-y-3">
      <div>
        <div className="label mb-1.5 !text-[9px]">Readiness by numbered fleet</div>
        <div className="space-y-1">
          {fleets.map((f) => {
            const ships = pic.ships.filter((s) => s.spec.fleet === f);
            const count = (k: ShipStatus) => ships.filter((s) => s.status === k).length;
            return (
              <div key={f} className="flex items-center gap-2 rounded-[3px] border border-sky-300/10 bg-black/40 px-2 py-1.5">
                <span className="w-[150px] truncate font-display text-[10.5px] font-bold tracking-[0.1em] text-sky-100">{FLEET_NAME[f].name}</span>
                <div className="flex flex-1 gap-0.5">
                  {ships.map((s) => (
                    <button key={s.spec.hull} type="button" title={`${s.spec.hull} ${s.spec.name}`} onClick={() => onShip(s.spec.hull)} className="h-3 flex-1 rounded-[1px] transition hover:brightness-150" style={{ background: SHIP_HEX[s.status], opacity: 0.85 }} />
                  ))}
                </div>
                <span className="w-[54px] text-right font-mono text-[10px] text-mute">
                  <span className="text-crit">{count('N')}</span>/<span className="text-unc">{count('Q')}</span>/<span className="text-ok">{count('Y')}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <div className="label mb-1 !text-[9px]">Packages at risk · smallest slack first</div>
        <div className="space-y-1">
          {atRisk.map((p) => (
            <PackageRow key={p.id} p={p} showHull onClick={() => onShip(p.hull)} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Fleet() {
  const { active, mission, ship, toggle, clearDisruptions, selectMission, selectShip } = useFleet();
  const base = useMemo(() => buildFleet([]), []);
  const pic = useMemo(() => (active.length ? buildFleet(active) : base), [active, base]);
  const baseStatus = useMemo(() => new Map(base.missions.map((m) => [m.spec.id, m.status])), [base]);
  const sorted = useMemo(() => [...pic.missions].sort((a, b) => RANK[b.status] - RANK[a.status] || a.margin - b.margin), [pic]);
  const selMission = mission ? pic.missions.find((m) => m.spec.id === mission) : undefined;
  const selShip = ship ? pic.ships.find((s) => s.spec.hull === ship) : undefined;
  const flips = pic.missions.filter((m) => baseStatus.get(m.spec.id) !== m.status);
  const held = pic.missions
    .map((m, i) => {
      const b = base.missions[i];
      const hulls = m.reqs.flatMap((r, j) => r.absorbed.filter((c) => !b.reqs[j].absorbed.some((x) => x.hull === c.hull)).map((c) => c.hull));
      return { m, hulls: [...new Set(hulls)] };
    })
    .filter(({ m, hulls }) => hulls.length > 0 && baseStatus.get(m.spec.id) === m.status);

  const shipCount = (k: ShipStatus) => pic.ships.filter((s) => s.status === k).length;
  const missionCount = (k: Readiness) => pic.missions.filter((m) => m.status === k).length;
  const toneCount = (k: PkgTone) => pic.packages.filter((p) => p.tone === k).length;
  const onShip = (h: string) => {
    if (!mission) {
      const m = SHIPS.find((s) => s.hull === h)?.mission;
      if (m) useFleet.setState({ mission: m });
    }
    selectShip(h);
  };

  return (
    <div className="relative h-full overflow-hidden" style={{ background: 'radial-gradient(1400px 900px at 50% 45%, #061a2e 0%, #030a14 55%, #010409 100%)' }}>
      <div className="pointer-events-none absolute left-0 top-0 h-px w-px" style={{ boxShadow: STARS }} />
      <FleetGlobe pic={pic} mission={mission} ship={ship} onShip={onShip} onMission={selectMission} />

      <div className="pointer-events-none absolute left-3 top-3 w-[360px]">
        <div className="hud pointer-events-auto px-3 py-2">
          <div className="label !text-[9px] !text-calc/80">
            <span className="mr-1.5 rounded-[2px] border border-dashed border-ai/60 px-1 text-ai">LABS</span>Global fleet picture · synthetic data
          </div>
          <div className="font-display text-[15px] font-bold tracking-[0.18em] text-white">FLEET MISSION CONSEQUENCES</div>
          <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10px] text-sky-200/70">
            <span>
              <b className="text-white">{pic.ships.length}</b> HULLS
            </span>
            <span>
              <b className="text-white">{pic.missions.length}</b> MISSIONS
            </span>
            <span>
              <b className="text-white">{pic.packages.length}</b> PACKAGES
            </span>
            <span className="text-calc">
              ENGINE {pic.ms.toFixed(0)} ms · {pic.packages.length} slack searches
            </span>
          </div>
        </div>
      </div>

      <div className="absolute bottom-3 left-3 top-[92px] w-[360px]">
        <Panel title="Missions · worst first" index="FLT-1" className="h-full" bodyClass="space-y-1 overflow-y-auto p-2" right={mission && <button type="button" onClick={() => selectMission(null)} className="flex items-center gap-1 font-mono text-[10px] text-mute hover:text-sky-100"><X size={11} /> GLOBE</button>}>
          {sorted.map((m) => {
            const was = baseStatus.get(m.spec.id)!;
            return (
              <button
                key={m.spec.id}
                type="button"
                onClick={() => selectMission(m.spec.id === mission ? null : m.spec.id)}
                className={cn('w-full rounded-[3px] border bg-black/45 px-2 py-1.5 text-left transition hover:bg-black/70', m.spec.id === mission ? 'border-calc/60 bg-calc/[0.07]' : m.status === 'N' ? 'border-crit/40' : 'border-sky-300/10')}
                style={m.status === 'N' ? { boxShadow: '0 0 18px -10px #fb3b5c' } : undefined}
              >
                <div className="flex items-center gap-2">
                  <StatusBadge status={m.status} size="sm" pulse={m.status === 'N'} />
                  <span className="truncate font-display text-[12px] font-bold tracking-[0.1em] text-white">{m.spec.name}</span>
                  {was !== m.status && <span className="shrink-0 rounded-[2px] border border-ai/60 px-1 font-mono text-[8.5px] font-bold text-ai">{was}→{m.status}</span>}
                  <Margin status={m.status} margin={m.margin} className="ml-auto shrink-0 text-[11px]" />
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[9.5px] text-mute">
                  <span className="truncate">
                    {m.spec.kind} · {m.spec.fleet}
                  </span>
                  <span className="ml-auto shrink-0">T-{fmtDur(m.spec.startH)}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  {m.reqs.map((r) => (
                    <span key={r.cap} className="flex items-center gap-1">
                      <span className="font-display text-[9.5px] font-bold tracking-wider text-sky-200/80">
                        {r.cap} {r.k}/{r.n}
                      </span>
                      {r.contributions.map((c) => (
                        <ShipDot key={c.hull} status={c.status} />
                      ))}
                    </span>
                  ))}
                </div>
                {m.status !== 'Y' && m.controlling && (
                  <div className="mt-1 truncate font-mono text-[9.5px] text-sky-100/60">
                    <span className="text-calc">{m.controlling.hull}</span> · {m.controlling.reason}
                  </div>
                )}
              </button>
            );
          })}
        </Panel>
      </div>

      <div className="absolute bottom-3 right-3 top-3 flex w-[390px] flex-col gap-3">
        <Panel
          className="shrink-0"
          title={
            <span className="flex items-center gap-1.5">
              <FlaskConical size={12} className="text-ai" /> What-if · fleet disruptions
            </span>
          }
          index="FLT-2"
          tone={active.length ? 'ai' : undefined}
          right={active.length > 0 && <button type="button" onClick={clearDisruptions} className="font-mono text-[10px] text-mute hover:text-sky-100">CLEAR</button>}
          bodyClass="p-2"
        >
          <div className="grid grid-cols-2 gap-1">
            {DISRUPTIONS.map((d) => {
              const on = active.includes(d.id);
              const Icon = DISRUPT_ICON[d.id] ?? FlaskConical;
              return (
                <button
                  key={d.id}
                  type="button"
                  title={d.detail}
                  onClick={() => toggle(d.id)}
                  className={cn('flex items-center gap-1.5 rounded-[3px] border px-2 py-1.5 text-left transition', on ? 'border-ai/70 bg-ai/15 text-white shadow-[0_0_16px_-6px_#a78bfa]' : 'border-sky-300/10 bg-black/40 text-sky-200/70 hover:border-ai/40 hover:text-sky-50')}
                >
                  <Icon size={13} className={on ? 'text-ai' : 'text-mute'} />
                  <span className="truncate text-[11px] font-medium">{d.label}</span>
                </button>
              );
            })}
          </div>
          {active.length > 0 && (
            <div className="mt-2 space-y-1 border-t border-ai/20 pt-2">
              {flips.length === 0 && <div className="text-[11.5px] text-ok">No mission changes status. Redundancy and slack absorb it.</div>}
              {flips.map((m) => (
                <button key={m.spec.id} type="button" onClick={() => selectMission(m.spec.id)} className="flex w-full items-center gap-2 text-left hover:brightness-125">
                  <StatusBadge status={baseStatus.get(m.spec.id)!} size="sm" />
                  <ArrowRight size={11} className="text-mute" />
                  <StatusBadge status={m.status} size="sm" pulse={m.status === 'N'} />
                  <span className="truncate font-display text-[11.5px] font-bold tracking-[0.08em] text-white">{m.spec.name}</span>
                  <span className="ml-auto shrink-0 truncate font-mono text-[9.5px] text-mute">{m.controlling?.hull}</span>
                </button>
              ))}
              {held.map(({ m, hulls }) => (
                <div key={m.spec.id} className="flex items-center gap-2 text-[11px] text-ok/90">
                  <StatusBadge status={m.status} size="sm" />
                  <span className="shrink-0 font-display font-bold tracking-[0.08em]">{m.spec.name}</span>
                  <span className="truncate text-sky-100/60">holds: redundancy absorbs {hulls.join(', ')}</span>
                </div>
              ))}
              <div className="pt-1 font-mono text-[9.5px] leading-snug text-ai/80">
                Sandbox only. {pic.packages.filter((p) => p.hits.length).length} packages re-timed through the same engine; no authoritative record changes. Logged to the decision log.
              </div>
            </div>
          )}
        </Panel>

        <Panel
          title={selShip ? 'Hull detail' : selMission ? 'Mission detail' : 'Fleet summary'}
          index="FLT-3"
          tone={(selShip?.status ?? selMission?.status) === 'N' ? 'crit' : undefined}
          className="min-h-[200px] flex-1"
          bodyClass="overflow-y-auto p-2.5"
        >
          {selShip ? (
            <ShipDetail s={selShip} onBack={() => selectShip(null)} backLabel={selMission ? `BACK TO ${selMission.spec.name}` : 'BACK TO FLEET'} />
          ) : selMission ? (
            <MissionDetail m={selMission} pic={pic} onShip={onShip} />
          ) : (
            <FleetSummary pic={pic} onShip={onShip} />
          )}
        </Panel>

        <div className="hud flex shrink-0 justify-between gap-2 px-3 py-2">
          <Tally label="Hulls" parts={[{ v: shipCount('N'), cls: 'text-crit', k: 'N' }, { v: shipCount('Q'), cls: 'text-unc', k: 'Q' }, { v: shipCount('Y'), cls: 'text-ok', k: 'Y' }, { v: shipCount('M'), cls: 'text-slate-400', k: 'M' }]} />
          <Tally label="Missions" parts={[{ v: missionCount('N'), cls: 'text-crit', k: 'N' }, { v: missionCount('Q'), cls: 'text-unc', k: 'Q' }, { v: missionCount('Y'), cls: 'text-ok', k: 'Y' }]} />
          <Tally label="Packages" parts={[{ v: toneCount('crit'), cls: 'text-crit', k: 'late' }, { v: toneCount('risk'), cls: 'text-unc', k: `<${FLEET_Q}h` }, { v: toneCount('ok'), cls: 'text-calc', k: 'ok' }]} />
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-4 rounded-[3px] bg-black/50 px-3 py-1.5 font-mono text-[9.5px] text-sky-200/70 backdrop-blur-sm">
        <span className="flex items-center gap-1.5"><ShipDot status="Y" /> READY</span>
        <span className="flex items-center gap-1.5"><ShipDot status="Q" /> QUALIFIED</span>
        <span className="flex items-center gap-1.5"><ShipDot status="N" /> NOT READY</span>
        <span className="flex items-center gap-1.5"><ShipDot status="M" /> MAINT</span>
        <span className="flex items-center gap-1.5"><span className="h-px w-4 bg-calc" /> package</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-unc" /> slack &lt; {FLEET_Q}h</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-crit" /> breaks mission</span>
        <span>drag to spin · click a mission or hull</span>
      </div>
    </div>
  );
}
