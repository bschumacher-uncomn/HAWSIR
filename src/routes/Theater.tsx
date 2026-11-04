import DeckGL from '@deck.gl/react';
import { MapView } from '@deck.gl/core';
import { GeoJsonLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from '@deck.gl/layers';
import { useMemo } from 'react';
import { usePulse } from '@/lib/usePulse';
import { Anchor, Box, Plane, Radio, User, type LucideIcon } from 'lucide-react';
import { fmtT } from '@/engine/time';
import { useEngine } from '@/state/engine';
import { useStore } from '@/state/store';
import { Panel, Pill, StatusBadge } from '@/components/ui';
import { Scrubber } from '@/components/Scrubber';
import { cn, STATUS_COLOR } from '@/lib/util';
import { along, arc, dms, GRATICULE, LAND, offset, positionAt, ring, speedAt, splitTrack, wedge, type LonLat } from '@/features/theater/geo';
import { resolveLegs, type ResolvedLeg } from '@/features/theater/legs';

type RGBA = [number, number, number, number];
const rgb = (hex: string, a = 255): RGBA => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), a];
const LEG_COLOR: Record<ResolvedLeg['status'], string> = { done: '#475569', ok: '#22d3ee', risk: '#fbbf24', crit: '#fb3b5c' };
const LEG_ICON: Record<ResolvedLeg['leg']['kind'], LucideIcon> = { part: Box, person: User, aircraft: Plane, data: Radio };
const ARRAYS = [
  { id: 'sys_spy_a', label: 'A', bearing: 45 },
  { id: 'sys_spy_b', label: 'B', bearing: 135 },
  { id: 'sys_spy_c', label: 'C', bearing: 225 },
  { id: 'sys_spy_d', label: 'D', bearing: 315 },
];
const RADAR_KM = 400;
const ATLANTIC_VIEW = { longitude: -36.5, latitude: 31, zoom: 3.12 };

export default function Theater() {
  const { scenario, at, nodes, result, cap } = useEngine();
  const selectNode = useStore((s) => s.selectNode);
  const pulse = usePulse();
  const track = scenario.track ?? [];
  const hasGeo = track.length > 0;
  const ship = positionAt(track, at);
  const split = useMemo(() => splitTrack(track, at), [track, at]);
  const legs = useMemo(() => resolveLegs(scenario, nodes, result, at, cap), [scenario, nodes, result, at, cap]);
  const phase = scenario.phases.find((p) => at >= p.start && at < p.end);
  const area = scenario.missionArea;
  const view = scenario.mapView ?? ATLANTIC_VIEW;
  // constant on-screen radar size regardless of the scenario's zoom
  const radarKm = RADAR_KM * 2 ** (ATLANTIC_VIEW.zoom - view.zoom);

  const arrays = ARRAYS.filter((a) => hasGeo && nodes[a.id]).map((a) => {
    const up = (result.nodes[a.id]?.ready ?? Infinity) <= at + 1e-6;
    const center = ship.pos;
    const b = ship.heading + a.bearing;
    return { ...a, up, poly: wedge(center, radarKm, b - 44, b + 44), labelPos: offset(center, radarKm * 0.62, b), eta: result.nodes[a.id]?.ready };
  });
  const blind = arrays.filter((a) => !a.up);
  const alts = legs.filter((l) => !l.done && (l.onChain || l.status !== 'ok')).flatMap((l) => l.alts.filter((a) => !a.past).map((a) => ({ ...a, from: l.from, leg: l })));

  const ph = (pulse % 2) / 2;
  const layers = [
    new PathLayer({ id: 'grat', data: GRATICULE, getPath: (d) => d, getColor: [34, 211, 238, 16], getWidth: 1, widthUnits: 'pixels' }),
    new GeoJsonLayer({ id: 'land-glow', data: LAND, stroked: true, filled: false, getLineColor: [34, 211, 238, 30], getLineWidth: 5, lineWidthUnits: 'pixels' }),
    new GeoJsonLayer({ id: 'land', data: LAND, stroked: true, filled: true, getFillColor: [9, 24, 40, 245], getLineColor: [56, 189, 248, 120], getLineWidth: 1, lineWidthUnits: 'pixels' }),
    area &&
      new SolidPolygonLayer({ id: 'area', data: [ring([area.lon, area.lat], area.radiusKm)], getPolygon: (d) => d, getFillColor: [251, 59, 92, 28] }),
    area &&
      new PathLayer({
        id: 'area-ring',
        data: [ring([area.lon, area.lat], area.radiusKm), ring([area.lon, area.lat], area.radiusKm * (1 + ph * 0.8))],
        getPath: (d) => d,
        getColor: (_d, { index }) => (index === 0 ? [251, 59, 92, 200] : [251, 59, 92, Math.round(160 * (1 - ph))]),
        getWidth: 1.5,
        widthUnits: 'pixels',
        updateTriggers: { getColor: ph, getPath: ph },
      }),
    new PathLayer({ id: 'track-todo', data: [split.todo], getPath: (d) => d, getColor: [125, 211, 252, 70], getWidth: 2, widthUnits: 'pixels' }),
    new PathLayer({ id: 'track-done-glow', data: [split.done], getPath: (d) => d, getColor: [34, 211, 238, 50], getWidth: 9, widthUnits: 'pixels' }),
    new PathLayer({ id: 'track-done', data: [split.done], getPath: (d) => d, getColor: [103, 232, 249, 240], getWidth: 2.5, widthUnits: 'pixels' }),
    new ScatterplotLayer({
      id: 'waypoints',
      data: track.filter((p) => p.label),
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 3,
      radiusUnits: 'pixels',
      getFillColor: (d) => (d.t <= at ? [103, 232, 249, 220] : [125, 211, 252, 90]),
      updateTriggers: { getFillColor: at },
    }),
    new SolidPolygonLayer({
      id: 'radar',
      data: arrays,
      getPolygon: (d) => d.poly,
      getFillColor: (d) => (d.up ? [34, 211, 238, 46] : [251, 59, 92, Math.round(50 + 50 * Math.sin(pulse * 4) ** 2)]),
      updateTriggers: { getFillColor: pulse },
    }),
    new PathLayer({
      id: 'radar-edge',
      data: arrays,
      getPath: (d) => d.poly,
      getColor: (d) => (d.up ? [34, 211, 238, 110] : [251, 59, 92, 220]),
      getWidth: (d) => (d.up ? 1 : 2),
      widthUnits: 'pixels',
    }),
    new PathLayer({ id: 'radar-sweep', data: [[ship.pos, offset(ship.pos, radarKm, (pulse * 90) % 360)]], getPath: (d) => d, getColor: [167, 243, 255, 160], getWidth: 1.5, widthUnits: 'pixels', updateTriggers: { getPath: pulse } }),
    ...legs.flatMap((l) => {
      const col = LEG_COLOR[l.status];
      const base = [
        new PathLayer({ id: `leg-glow-${l.leg.id}`, data: [l.path], getPath: (d) => d, getColor: rgb(col, l.done ? 0 : 45), getWidth: l.onChain ? 10 : 6, widthUnits: 'pixels' }),
        new PathLayer({ id: `leg-${l.leg.id}`, data: [l.path], getPath: (d) => d, getColor: rgb(col, l.done ? 90 : 230), getWidth: l.onChain ? 2.8 : 1.6, widthUnits: 'pixels', pickable: true, onClick: () => selectNode(l.leg.nodeId) }),
      ];
      if (l.done) return base;
      const packets = [0, 0.33, 0.66].map((o) => along(l.path, (pulse * 0.35 + o) % 1));
      return [
        ...base,
        new ScatterplotLayer({ id: `pk-${l.leg.id}`, data: packets, getPosition: (d) => d, getRadius: l.onChain ? 4 : 3, radiusUnits: 'pixels', getFillColor: [255, 255, 255, 240], updateTriggers: { getPosition: pulse } }),
        new ScatterplotLayer({ id: `pkg-${l.leg.id}`, data: packets, getPosition: (d) => d, getRadius: l.onChain ? 10 : 7, radiusUnits: 'pixels', getFillColor: rgb(col, 70), updateTriggers: { getPosition: pulse } }),
      ];
    }),
    new ScatterplotLayer({
      id: 'alt-dots',
      data: alts.flatMap((a) => Array.from({ length: 28 }, (_, i) => ({ p: along(arc(a.from, a.pos), i / 27), enabled: a.enabled }))),
      getPosition: (d) => d.p,
      getRadius: 1.4,
      radiusUnits: 'pixels',
      getFillColor: (d) => (d.enabled ? [148, 163, 184, 150] : [167, 139, 250, 190]),
    }),
    new ScatterplotLayer({
      id: 'alt-ends',
      data: alts,
      getPosition: (d) => d.pos,
      getRadius: 7 + ph * 4,
      radiusUnits: 'pixels',
      filled: false,
      stroked: true,
      getLineColor: (d) => (d.enabled ? [148, 163, 184, 200] : [167, 139, 250, 230]),
      getLineWidth: 1.5,
      lineWidthUnits: 'pixels',
      updateTriggers: { getRadius: ph },
    }),
    new ScatterplotLayer({
      id: 'leg-ends',
      data: legs,
      getPosition: (d: ResolvedLeg) => d.to,
      getRadius: 4,
      radiusUnits: 'pixels',
      getFillColor: (d: ResolvedLeg) => rgb(LEG_COLOR[d.status], 255),
      stroked: true,
      getLineColor: [2, 6, 12, 255],
      lineWidthUnits: 'pixels',
      getLineWidth: 1.5,
    }),
    new ScatterplotLayer({
      id: 'ports',
      data: scenario.ports ?? [],
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 5,
      radiusUnits: 'pixels',
      getFillColor: [2, 6, 12, 255],
      stroked: true,
      getLineColor: [224, 242, 254, 220],
      getLineWidth: 1.5,
      lineWidthUnits: 'pixels',
    }),
    new ScatterplotLayer({
      id: 'ship-pulse',
      data: [ship.pos],
      getPosition: (d) => d,
      getRadius: 8 + ph * 34,
      radiusUnits: 'pixels',
      filled: false,
      stroked: true,
      getLineColor: [34, 211, 238, Math.round(220 * (1 - ph))],
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      updateTriggers: { getRadius: ph, getLineColor: ph },
    }),
    new SolidPolygonLayer({
      id: 'ship',
      data: [[offset(ship.pos, 55, ship.heading), offset(ship.pos, 30, ship.heading + 140), ship.pos, offset(ship.pos, 30, ship.heading - 140)] as LonLat[]],
      getPolygon: (d) => d,
      getFillColor: [255, 255, 255, 255],
    }),
    new TextLayer({
      id: 'labels',
      data: [
        ...(scenario.ports ?? [])
          .filter((p) => Math.hypot(p.lon - ship.pos[0], p.lat - ship.pos[1]) > 1.5)
          .map((p) => ({ pos: [p.lon, p.lat], text: p.name.toUpperCase(), color: [224, 242, 254, 200], size: 11, off: [10, 0] })),
        ...legs
          .filter((l) => !l.done && (l.onChain || l.status !== 'ok'))
          .map((l) => ({ pos: along(l.path, 0.5), text: `${l.leg.label.toUpperCase()} · ${Number.isFinite(l.eta) ? fmtT(scenario, l.eta) : 'NO WINDOW'}`, color: rgb(LEG_COLOR[l.status], 255), size: l.onChain ? 13 : 11, off: [0, -12] })),
        ...alts.map((a) => ({ pos: a.pos, text: a.label.toUpperCase(), color: a.enabled ? [148, 163, 184, 230] : [196, 181, 253, 255], size: 10, off: [0, 20] })),
        ...(area ? [{ pos: offset([area.lon, area.lat], area.radiusKm + 75 * 2 ** (ATLANTIC_VIEW.zoom - view.zoom), 180), text: area.name, color: [251, 113, 133, 255], size: 13, off: [0, 0] }] : []),
        { pos: ship.pos, text: `${scenario.ship.name} ${scenario.ship.hull}`, color: [255, 255, 255, 255], size: 12, off: [16, 22] },
        ...blind.map((a) => ({ pos: a.labelPos, text: `ARRAY ${a.label} DOWN`, color: [251, 59, 92, 255], size: 10, off: [0, 0] })),
      ],
      getPosition: (d: { pos: number[] }) => d.pos as [number, number, number],
      getText: (d: { text: string }) => d.text,
      getColor: (d: { color: number[] }) => d.color as RGBA,
      getSize: (d: { size: number }) => d.size,
      getPixelOffset: (d: { off: number[] }) => d.off as [number, number],
      getTextAnchor: (d: { off: number[] }) => (d.off[0] > 0 ? 'start' : 'middle'),
      getAlignmentBaseline: 'center',
      fontFamily: 'JetBrains Mono Variable, monospace',
      fontWeight: 600,
      characterSet: 'auto',
      outlineWidth: 3,
      outlineColor: [2, 6, 12, 255],
      fontSettings: { sdf: true },
    }),
  ]
    .filter(Boolean)
    .slice(0, hasGeo ? undefined : 3);

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="hud flex shrink-0 items-center gap-4 px-3 py-2">
        <div>
          <div className="label !text-[9px] !text-calc/80">Theater · {scenario.mission.name}</div>
          <div className="font-display text-[14px] font-bold tracking-[0.18em] text-white">MOVEMENT & LOGISTICS PICTURE</div>
        </div>
        <Pill color="#2dd4bf">Offline vector basemap · no tile server</Pill>
        <Scrubber />
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[4px] border border-sky-400/15" style={{ background: 'radial-gradient(1200px 700px at 60% 40%, #06213a 0%, #030c17 60%, #02060c 100%)' }}>
        <DeckGL
          key={scenario.id}
          views={new MapView({ repeat: false })}
          initialViewState={{ ...view, pitch: 36, bearing: -3 }}
          controller={{ dragRotate: true }}
          layers={layers}
          getCursor={({ isHovering }) => (isHovering ? 'pointer' : 'grab')}
        />

        {!hasGeo && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="hud max-w-[440px] px-6 py-5 text-center">
              <div className="label !text-unc">No movement picture for this workflow</div>
              <div className="mt-2 text-[13px] leading-relaxed text-sky-100/80">
                “{scenario.name}” has no voyage track or movement legs, so there is nothing to place on the map. The engine, graph, horizon and simulation views still run on it.
              </div>
            </div>
          </div>
        )}

        <div className={cn('pointer-events-none absolute left-4 top-3 space-y-1', !hasGeo && 'hidden')}>
          <div className="label !text-calc/80">Own ship · {fmtT(scenario, at)}</div>
          <div className="font-mono text-[18px] font-bold text-white">{dms(ship.pos)}</div>
          <div className="flex gap-3 font-mono text-[11px] text-sky-200/70">
            <span>HDG {String(Math.round(ship.heading)).padStart(3, '0')}°</span>
            <span>SOA {speedAt(track, at).toFixed(1)} kts</span>
            <span className="text-calc">{phase?.name ?? '—'}</span>
          </div>
        </div>

        <div className={cn('absolute bottom-3 left-3 top-[86px] w-[330px]', !hasGeo && 'hidden')}>
          <Panel title="Movements feeding readiness" index="THR-1" className="h-full" bodyClass="space-y-1.5 overflow-y-auto p-2">
            {legs.map((l) => {
              const Icon = LEG_ICON[l.leg.kind];
              const col = LEG_COLOR[l.status];
              return (
                <button
                  key={l.leg.id}
                  type="button"
                  onClick={() => selectNode(l.leg.nodeId)}
                  className={cn('w-full rounded-[3px] border bg-black/40 p-2 text-left transition hover:bg-black/60', l.onChain ? 'border-unc/50' : 'border-sky-300/10')}
                  style={l.onChain ? { boxShadow: `0 0 18px -8px ${col}` } : undefined}
                >
                  <div className="flex items-center gap-2">
                    <Icon size={13} style={{ color: col }} />
                    <span className="truncate text-[12px] font-medium text-sky-50">{l.leg.label}</span>
                    {l.onChain && <span className="rounded-[2px] border border-unc/50 px-1 font-mono text-[8.5px] text-unc">CRITICAL CHAIN</span>}
                    <span className="ml-auto font-mono text-[11px] font-bold" style={{ color: col }}>
                      {l.done ? 'ARRIVED' : Number.isFinite(l.eta) ? fmtT(scenario, l.eta) : 'NO WINDOW'}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[9.5px] text-mute">
                    {l.fromName} → {l.toName}
                  </div>
                  {l.note && <div className="mt-0.5 font-mono text-[9.5px] font-semibold uppercase text-unc">{l.note}</div>}
                </button>
              );
            })}
          </Panel>
        </div>

        <div className={cn('absolute right-3 top-3 w-[300px]', !arrays.length && 'hidden')}>
          <Panel title="SPY-1D coverage · notional" index="THR-2" tone={blind.length ? 'crit' : undefined} bodyClass="p-3">
            <div className="flex items-center gap-3">
              <svg width={84} height={84} viewBox="-42 -42 84 84">
                {arrays.map((a) => {
                  const r0 = ((a.bearing - 44 - 90) * Math.PI) / 180;
                  const r1 = ((a.bearing + 44 - 90) * Math.PI) / 180;
                  return (
                    <path
                      key={a.id}
                      d={`M0 0 L${38 * Math.cos(r0)} ${38 * Math.sin(r0)} A38 38 0 0 1 ${38 * Math.cos(r1)} ${38 * Math.sin(r1)} Z`}
                      fill={a.up ? '#22d3ee33' : '#fb3b5c44'}
                      stroke={a.up ? '#22d3ee' : '#fb3b5c'}
                      strokeWidth={a.up ? 1 : 1.6}
                      className={a.up ? undefined : 'animate-blink'}
                    />
                  );
                })}
                <path d="M0 -9 L5 6 L0 3 L-5 6 Z" fill="#fff" />
              </svg>
              <div className="space-y-1 font-mono text-[11px]">
                {arrays.map((a) => (
                  <div key={a.id} className="flex gap-2">
                    <span className="text-mute">ARRAY {a.label}</span>
                    <span className={a.up ? 'text-ok' : 'font-bold text-crit'}>{a.up ? 'UP' : `DOWN → ${a.eta !== undefined && Number.isFinite(a.eta) ? fmtT(scenario, a.eta) : 'NO WINDOW'}`}</span>
                  </div>
                ))}
              </div>
            </div>
            {blind.length > 0 && <div className="mt-2 text-[11px] text-crit/90">Blind sector aft/starboard. BMD search volume reduced until Array {blind.map((b) => b.label).join(', ')} is restored.</div>}
          </Panel>
        </div>

        <div className={cn('absolute bottom-3 right-3', hasGeo ? 'left-[354px]' : 'left-3')}>
          <Panel title="Voyage phases · capability needed at each phase start" index="THR-3" bodyClass="flex gap-1.5 p-2">
            {scenario.phases.map((p) => {
              const past = p.end <= at;
              return (
                <div key={p.id} className={cn('min-w-0 flex-1 rounded-[3px] border px-2 py-1.5', p === phase ? 'border-calc/50 bg-calc/[0.07]' : 'border-sky-300/10 bg-black/50', past && 'opacity-40')}>
                  <div className="flex items-center gap-1.5">
                    <Anchor size={11} className={p === phase ? 'text-calc' : 'text-mute'} />
                    <span className="truncate font-display text-[10px] font-semibold tracking-[0.1em] text-sky-50">{p.name}</span>
                  </div>
                  <div className="mt-0.5 font-mono text-[9.5px] text-mute">
                    {fmtT(scenario, p.start)} · {p.location}
                  </div>
                  {p === phase && <div className="mt-1 h-[3px] overflow-hidden rounded bg-white/10"><div className="h-full bg-calc" style={{ width: `${((at - p.start) / (p.end - p.start)) * 100}%` }} /></div>}
                  {p.requires.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.requires.map((id) => {
                        const c = result.capabilities.find((x) => x.id === id);
                        if (!c) return null;
                        const ready = c.ready <= p.start;
                        return (
                          <span key={id} className="flex items-center gap-1 rounded-[2px] border px-1 py-px" style={{ borderColor: `${STATUS_COLOR[ready ? c.status : 'N']}55` }}>
                            <StatusBadge status={ready ? c.status : 'N'} size="sm" />
                            <span className="font-display text-[10px] font-bold tracking-wider text-white">{c.code}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </Panel>
        </div>
      </div>
    </div>
  );
}
