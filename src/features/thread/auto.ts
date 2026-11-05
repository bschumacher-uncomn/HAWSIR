import type { NodeMap } from '@/api/types';
import { upstreamCone } from '@/lib/graph';
import { BRAND } from '@/brand';
import type { Domain, NodeKind } from '@/api/types';
import type { ThreadLane, ThreadLink, ThreadSpec, ThreadStep } from './types';

const LANES: Record<Domain, Omit<ThreadLane, 'id'>> = {
  logistics: { label: 'Logistics', sub: 'Parts · airlift · pier', color: '#60a5fa' },
  maintenance: { label: 'Maintenance', sub: 'Repair · test', color: '#22d3ee' },
  ordnance: { label: 'Weapons department', sub: 'Ordnance handling', color: '#f472b6' },
  personnel: { label: 'Personnel', sub: 'Quals · watchbill', color: '#c084fc' },
  comms: { label: 'Comms', sub: 'Crypto · data', color: '#818cf8' },
  schedule: { label: 'Operations', sub: 'Schedule · flight deck', color: '#2dd4bf' },
  capability: { label: 'Commanding officer', sub: 'Readiness decision', color: '#fbbf24' },
};

const isStep = (k: NodeKind) => k === 'task' || k === 'gate' || k === 'capability';

/** Lay a capability's upstream cone out as a mission thread: steps by domain lane, columns by dependency depth. */
export function autoThread(nodes: NodeMap, capId: string): ThreadSpec | undefined {
  const capNode = nodes[capId];
  if (!capNode) return undefined;
  const cone = upstreamCone(nodes, capId);
  const ids = [...cone].filter((id) => isStep(nodes[id].kind));
  const preds: Record<string, string[]> = {};
  const needs: Record<string, string[]> = {};
  for (const id of ids) {
    const p = new Set<string>();
    const r = new Set<string>();
    const seen = new Set<string>();
    const stack = [...(nodes[id].deps ?? []), ...(nodes[id].crew?.pool ?? [])];
    while (stack.length) {
      const d = stack.pop()!;
      if (seen.has(d) || !nodes[d]) continue;
      seen.add(d);
      const dn = nodes[d];
      if (isStep(dn.kind)) p.add(d);
      else if (dn.kind === 'input' || dn.kind === 'person') r.add(d);
      else stack.push(...(dn.deps ?? []), ...(dn.crew?.pool ?? []));
    }
    preds[id] = [...p];
    needs[id] = [...r];
  }

  const col: Record<string, number> = {};
  const colOf = (id: string, depth = 0): number => {
    if (col[id] !== undefined) return col[id];
    if (depth > 64) return 1;
    const c = preds[id].length ? 1 + Math.max(...preds[id].map((p) => colOf(p, depth + 1))) : 1;
    col[id] = c;
    return c;
  };
  ids.forEach((id) => colOf(id));
  const last = Math.max(1, ...ids.filter((id) => id !== capId).map((id) => col[id] + 1));
  col[capId] = Math.max(col[capId], last);

  const laneOf = (id: string): Domain => (nodes[id].kind === 'capability' ? 'capability' : nodes[id].domain);
  const order = [...new Set(ids.filter((id) => id !== capId).sort((a, b) => col[a] - col[b]).map(laneOf))];
  if (!order.length) order.push('schedule');
  const lanes: ThreadLane[] = [...new Set<Domain>([...order, 'capability'])].map((d) => ({ id: d, ...LANES[d] }));

  const steps: ThreadStep[] = [{ id: 's__start', kind: 'start', label: 'Plan of record', lane: order[0], col: 0, actor: BRAND.name }];
  const links: ThreadLink[] = [];
  for (const id of ids.sort((a, b) => col[a] - col[b])) {
    const n = nodes[id];
    steps.push({
      id,
      kind: n.kind === 'capability' ? 'end' : n.kind === 'gate' ? 'gate' : 'task',
      label: n.kind === 'capability' ? `${n.code ?? ''} readiness decision`.trim() : n.label,
      lane: laneOf(id),
      col: col[id],
      node: id,
      actor: n.kind === 'capability' ? 'CO' : n.sources?.[0]?.system,
      needs: needs[id],
      note: n.kind === 'capability' ? n.label : undefined,
    });
    if (!preds[id].length) links.push({ from: 's__start', to: id });
    for (const p of preds[id]) links.push({ from: p, to: id, cargo: nodes[p].kind === 'gate' ? 'DELIVERED' : 'DONE' });
  }
  return {
    name: capNode.label,
    thesis: `Auto-laid from the ${capNode.code ?? capNode.label} dependency graph: same engine, no hand layout.`,
    lanes,
    steps,
    links,
  };
}
