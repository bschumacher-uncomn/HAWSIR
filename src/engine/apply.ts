import type { ChangeEvent, Hours, NodeDef, Patch, Scenario } from './types';

export type NodeMap = Record<string, NodeDef>;

export function toMap(nodes: NodeDef[]): NodeMap {
  const m: NodeMap = {};
  for (const n of nodes) m[n.id] = n;
  return m;
}

export function applyPatches(nodes: NodeMap, patches: Patch[]): NodeMap {
  const out: NodeMap = { ...nodes };
  for (const p of patches) {
    if (p.op === 'add') out[p.node.id] = p.node;
    else if (p.op === 'remove') delete out[p.id];
    else if (!out[p.id]) continue;
    else if (p.op === 'set') out[p.id] = { ...out[p.id], ...p.fields };
    else if (p.op === 'addCrew') {
      const n = out[p.id];
      if (n.crew) out[p.id] = { ...n, crew: { ...n.crew, pool: [...new Set([...n.crew.pool, ...p.persons])] } };
    } else if (p.op === 'window') {
      const n = out[p.id];
      out[p.id] = { ...n, windows: (n.windows ?? []).map((w) => (w.id === p.windowId ? { ...w, ...p.fields } : w)) };
    }
  }
  return out;
}

/** Reconstruct the authoritative picture as it was known at scenario time `t`. */
export function stateAt(s: Scenario, t: Hours): { nodes: NodeMap; applied: ChangeEvent[] } {
  let nodes = toMap(s.nodes);
  const applied: ChangeEvent[] = [];
  for (const e of [...s.events].sort((a, b) => a.t - b.t)) {
    if (e.t > t) break;
    nodes = applyPatches(nodes, e.patches);
    applied.push(e);
  }
  return { nodes, applied };
}

/**
 * Slip a node by `delta` hours. Inputs move their time, people move their
 * return-to-availability, tasks change duration.
 */
export function shiftNode(n: NodeDef, delta: number): NodeDef {
  if (delta === 0) return n;
  switch (n.kind) {
    case 'input': {
      const out: NodeDef = { ...n };
      if (n.value === null || n.value === undefined) {
        if (n.assumed !== undefined) out.assumed = n.assumed + delta;
      } else out.value = n.value + delta;
      if (n.conflict) out.conflict = { ...n.conflict, value: n.conflict.value + delta };
      return out;
    }
    case 'person': {
      if (n.unavailable?.length) {
        const sorted = [...n.unavailable].sort((a, b) => a.end - b.end);
        const last = sorted[sorted.length - 1];
        const moved = { ...last, end: Math.max(last.start, last.end + delta) };
        return { ...n, unavailable: [...sorted.slice(0, -1), moved] };
      }
      return { ...n, value: (n.value ?? 0) + delta };
    }
    case 'task': {
      if (n.duration === null || n.duration === undefined) {
        return { ...n, assumedDuration: Math.max(0, (n.assumedDuration ?? 0) + delta) };
      }
      return { ...n, duration: Math.max(0, n.duration + delta) };
    }
    default:
      return n;
  }
}

export function applyShifts(nodes: NodeMap, shifts: Record<string, number>): NodeMap {
  const ids = Object.keys(shifts).filter((id) => shifts[id] && nodes[id]);
  if (!ids.length) return nodes;
  const out = { ...nodes };
  for (const id of ids) out[id] = shiftNode(out[id], shifts[id]);
  return out;
}

export function isShiftable(n: NodeDef | undefined): boolean {
  return !!n && (n.kind === 'input' || n.kind === 'person' || n.kind === 'task');
}
