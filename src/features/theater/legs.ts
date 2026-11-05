import type { CapabilityResult, EngineResult, GeoLeg, NodeMap, Scenario } from '@/api/types';
import { arc, positionAt, type LonLat, type LonLatZ } from './geo';

export interface ResolvedLeg {
  leg: GeoLeg;
  from: LonLat;
  to: LonLat;
  fromName: string;
  toName: string;
  eta: number;
  done: boolean;
  status: 'done' | 'ok' | 'risk' | 'crit';
  onChain: boolean;
  note?: string;
  path: LonLatZ[];
  /** Other delivery points this leg could use (other windows on its gate). */
  alts: { pos: LonLat; label: string; enabled: boolean; past: boolean }[];
}

/** Movements on the map; `legFrom` is each leg's origin as reported at the viewed time. */
export function resolveLegs(s: Scenario, nodes: NodeMap, result: EngineResult, at: number, legFrom: Record<string, string>, cap?: CapabilityResult): ResolvedLeg[] {
  const places = s.places ?? {};
  const out: ResolvedLeg[] = [];
  for (const leg of s.legs ?? []) {
    const n = nodes[leg.nodeId];
    const from = places[legFrom[leg.id] ?? leg.from];
    if (!n || !from) continue;
    let eta = result.nodes[leg.nodeId]?.ready ?? Infinity;
    if (n.kind === 'person') eta = Math.max(n.value ?? -Infinity, ...(n.unavailable ?? []).map((iv) => iv.end).filter((t) => t > at));
    let toId = leg.to;
    let note: string | undefined;
    const alts: ResolvedLeg['alts'] = [];
    if (leg.gateId) {
      const g = nodes[leg.gateId];
      const used = result.nodes[leg.gateId]?.usedWindow;
      const first = g?.windows?.find((w) => w.enabled !== false);
      if (used && leg.byWindow?.[used]) toId = leg.byWindow[used];
      if (!Number.isFinite(eta)) note = 'NO DELIVERY WINDOW';
      else if (used && first && used !== first.id) note = `missed ${first.label.split(' (')[0]}`;
      for (const w of g?.windows ?? []) {
        const pid = leg.byWindow?.[w.id];
        if (w.id === used || !pid || pid === toId || !places[pid]) continue;
        const name = w.label.split(' (')[0].split(' from ')[0];
        alts.push({ pos: [places[pid].lon, places[pid].lat], label: w.enabled === false ? `${name} option${w.authority ? ` · needs ${w.authority.split(' ')[0]}` : ''}` : `alt · ${name}`, enabled: w.enabled !== false, past: w.end <= at });
      }
    }
    const track = leg.ship ? (s.tracks[leg.ship] ?? s.track) : s.track;
    const shipName = leg.ship ? (s.ships.find((x) => x.id === leg.ship)?.name ?? s.ship.name) : s.ship.name;
    const to: LonLat = toId === 'ship' ? positionAt(track ?? [], Number.isFinite(eta) ? eta : at).pos : [places[toId]?.lon ?? from.lon, places[toId]?.lat ?? from.lat];
    const onChain = !!cap && (cap.chain.includes(leg.nodeId) || cap.coCritical.includes(leg.nodeId) || (!!leg.gateId && cap.chain.includes(leg.gateId)));
    const done = Number.isFinite(eta) && eta <= at;
    const status = done ? 'done' : !Number.isFinite(eta) ? 'crit' : onChain && cap?.status === 'N' ? 'crit' : note || onChain ? 'risk' : 'ok';
    out.push({
      leg,
      from: [from.lon, from.lat],
      to,
      fromName: from.name,
      toName: toId === 'ship' ? shipName : (places[toId]?.name ?? toId),
      eta,
      done,
      status,
      onChain,
      note,
      path: arc([from.lon, from.lat], to),
      alts,
    });
  }
  return out;
}
