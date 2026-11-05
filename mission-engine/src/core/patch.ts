import type { GraphSpec, NodeSpec, Slot, StockTransfer } from './graph';

/**
 * Patches are the only way anything changes a graph: what-if perturbations,
 * Monte Carlo samples, and the options a human approves. A patch never touches
 * the facts; it overlays the compiled graph, so the authoritative record is
 * never modified.
 */
export type Patch =
  | { op: 'add'; node: NodeSpec }
  | { op: 'set'; id: string; fields: Record<string, unknown> }
  | { op: 'remove'; id: string }
  | { op: 'addDep'; id: string; dep: string }
  | { op: 'removeDep'; id: string; dep: string }
  | { op: 'replaceDep'; id: string; from: string; to: string }
  /** Make it later/longer by `hours` (event time, task duration, hour-valued scalar, person return, requirement window). */
  | { op: 'shift'; id: string; hours: number }
  /** Multiply a stock's burn rates (literal rates only). */
  | { op: 'scale'; id: string; factor: number }
  | { op: 'slot'; id: string; slotId: string; fields: Partial<Slot> }
  | { op: 'addSlot'; id: string; slot: Slot }
  | { op: 'addTransfer'; id: string; transfer: StockTransfer };

function clone<T>(x: T): T {
  return structuredClone(x);
}

export function shiftable(n: NodeSpec, now = -Infinity): boolean {
  switch (n.kind) {
    case 'event':
      return typeof n.at === 'number' ? Number.isFinite(n.at) : n.at === null && n.assumedAt !== undefined;
    case 'task':
      return typeof n.duration === 'number' || (n.duration === null && n.assumedDuration !== undefined);
    case 'scalar':
      return n.unit === 'h' && (n.value !== null || n.assumed !== undefined);
    case 'person':
      return (n.unavailable ?? []).some((u) => Number.isFinite(u.end) && u.end > now);
    default:
      return false;
  }
}

function applyOne(nodes: NodeSpec[], p: Patch): NodeSpec[] {
  const idx = (id: string) => nodes.findIndex((n) => n.id === id);
  switch (p.op) {
    case 'add': {
      const i = idx(p.node.id);
      if (i >= 0) nodes[i] = clone(p.node);
      else nodes.push(clone(p.node));
      return nodes;
    }
    case 'remove': {
      const out = nodes.filter((n) => n.id !== p.id);
      for (const n of out) if ('deps' in n && Array.isArray(n.deps)) n.deps = n.deps.filter((d) => d !== p.id);
      return out;
    }
    default:
      break;
  }
  const i = idx(p.id);
  if (i < 0) return nodes;
  const n = clone(nodes[i]) as NodeSpec & Record<string, any>;
  switch (p.op) {
    case 'set':
      Object.assign(n, clone(p.fields));
      break;
    case 'addDep':
      if ('deps' in n && !n.deps.includes(p.dep)) n.deps = [...n.deps, p.dep];
      break;
    case 'removeDep':
      if ('deps' in n) n.deps = n.deps.filter((d: string) => d !== p.dep);
      break;
    case 'replaceDep':
      if ('deps' in n) n.deps = n.deps.map((d: string) => (d === p.from ? p.to : d));
      if (n.kind === 'delay' && n.dep === p.from) n.dep = p.to;
      break;
    case 'shift':
      if (n.kind === 'event') {
        if (typeof n.at === 'number') n.at += p.hours;
        else if (n.at === null && n.assumedAt !== undefined) n.assumedAt += p.hours;
      } else if (n.kind === 'task') {
        if (typeof n.duration === 'number') n.duration = Math.max(0, n.duration + p.hours);
        else if (n.duration === null && n.assumedDuration !== undefined) n.assumedDuration = Math.max(0, n.assumedDuration + p.hours);
      } else if (n.kind === 'scalar') {
        if (typeof n.value === 'number') n.value += p.hours;
        else if (n.assumed !== undefined) n.assumed += p.hours;
      } else if (n.kind === 'person') {
        const us = (n.unavailable ?? []).filter((u) => Number.isFinite(u.end));
        if (us.length) {
          const last = us.reduce((a, b) => (b.end > a.end ? b : a));
          last.end += p.hours;
        }
      } else if (n.kind === 'requirement') {
        const sh = (x: unknown) => (typeof x === 'number' ? x + p.hours : x);
        n.window = { start: sh(n.window.start) as number, end: sh(n.window.end) as number };
      } else if (n.kind === 'window') {
        n.intervals = n.intervals.map(([s, e]) => [s + p.hours, e + p.hours] as const);
      }
      break;
    case 'scale':
      if (n.kind === 'stock') n.burns = n.burns.map((b) => (typeof b.rate === 'number' ? { ...b, rate: b.rate * p.factor } : b));
      break;
    case 'slot':
      if (n.kind === 'gate') n.slots = n.slots.map((s) => (s.id === p.slotId ? { ...s, ...p.fields } : s));
      break;
    case 'addSlot':
      if (n.kind === 'gate') n.slots = [...n.slots.filter((s) => s.id !== p.slot.id), p.slot];
      break;
    case 'addTransfer':
      if (n.kind === 'stock') n.transfers = [...n.transfers.filter((t) => t.id !== p.transfer.id), p.transfer];
      break;
  }
  nodes[i] = n;
  return nodes;
}

export function applyPatches(g: GraphSpec, patches: Patch[]): GraphSpec {
  if (!patches.length) return g;
  let nodes = g.nodes.slice();
  for (const p of patches) nodes = applyOne(nodes, p);
  return { ...g, nodes };
}
