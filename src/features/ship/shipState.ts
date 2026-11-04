import { affectedCapabilities, type EngineResult, type NodeMap, type ShipPart } from '@/engine';

export const PART_LABEL: Record<ShipPart, string> = {
  spy_a: 'SPY-1D Array A',
  spy_b: 'SPY-1D Array B',
  spy_c: 'SPY-1D Array C',
  spy_d: 'SPY-1D Array D',
  aegis: 'Aegis Weapon System',
  vls: 'Mk 41 VLS',
  gun: '5"/62 Mk 45 Gun',
  ciws: 'CIWS Mk 15',
  ssm: 'Surface strike missiles',
  sonar: 'SQQ-89 Sonar',
  helo: 'MH-60R Detachment',
  gtm: 'Main propulsion (GTMs)',
  ssgtg: 'Electrical plant (SSGTGs)',
  steering: 'Steering gear',
  nav: 'Navigation radar',
  link16: 'Link 16',
  satcom: 'SATCOM / KEYMAT',
  ew: 'SLQ-32(V)6 SEWIP',
  spq9: 'SPQ-9B radar',
  svtt: 'SVTT torpedo tubes',
  crew: 'Crew',
};

export interface PartState {
  part: ShipPart;
  up: boolean;
  sev: 'ok' | 'info' | 'warn' | 'crit';
  label: string;
  eta?: number;
  capIds: string[];
  nodeIds: string[];
  flagged: boolean;
  partial: boolean;
  etaLabel?: string;
}

const SYSTEM_KINDS = new Set(['input', 'all', 'kofn', 'gate']);

export function shipParts(nodes: NodeMap, r: EngineResult, at: number, fmt?: (t: number) => string): Partial<Record<ShipPart, PartState>> {
  const groups: Partial<Record<ShipPart, string[]>> = {};
  for (const n of Object.values(nodes)) {
    if (!n.part || n.part === 'crew' || !SYSTEM_KINDS.has(n.kind)) continue;
    // material state only: deliveries and data releases are not equipment casualties
    if (n.kind === 'gate' && n.part !== 'helo') continue;
    if (n.kind === 'input' && n.domain !== 'maintenance') continue;
    (groups[n.part] ??= []).push(n.id);
  }
  // a part with no system record of its own is down until its maintenance tasks complete
  const recorded = new Set(Object.keys(groups));
  for (const n of Object.values(nodes)) {
    if (n.kind === 'task' && n.domain === 'maintenance' && n.part && n.part !== 'crew' && !recorded.has(n.part)) (groups[n.part] ??= []).push(n.id);
  }
  const out: Partial<Record<ShipPart, PartState>> = {};
  for (const [part, ids] of Object.entries(groups) as [ShipPart, string[]][]) {
    const down = ids.filter((id) => (r.nodes[id]?.ready ?? Infinity) > at + 1e-6);
    const capIds = [...new Set(ids.flatMap((id) => affectedCapabilities(nodes, id)))];
    const caps = r.capabilities.filter((c) => capIds.includes(c.id));
    const worst = caps.some((c) => c.status === 'N') ? 'crit' : caps.some((c) => c.status === 'Q') ? 'warn' : 'info';
    const flagged = ids.some((id) => (r.nodes[id]?.flags.length ?? 0) > 0);
    const kofnOk = ids.some((id) => nodes[id].kind === 'kofn' && (r.nodes[id]?.ready ?? Infinity) <= at);
    const eta = down.length ? Math.max(...down.map((id) => r.nodes[id].ready)) : undefined;
    out[part] = {
      etaLabel: eta !== undefined && fmt ? `ETR ${fmt(eta)}` : undefined,
      part,
      up: down.length === 0,
      partial: down.length > 0 && kofnOk,
      sev: down.length === 0 ? (flagged ? 'warn' : 'ok') : kofnOk ? 'warn' : worst,
      label: PART_LABEL[part],
      eta: down.length ? Math.max(...down.map((id) => r.nodes[id].ready)) : undefined,
      capIds,
      nodeIds: ids,
      flagged,
    };
  }
  return out;
}
