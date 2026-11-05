import type { NodeMap } from '@/api/types';

/**
 * Graph walks for drawing (which nodes sit upstream of a capability, which
 * capabilities a node feeds). Presentation only: every number on screen comes
 * from mission-api.
 */
export function upstreamCone(nodes: NodeMap, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const x = stack.pop()!;
    if (out.has(x) || !nodes[x]) continue;
    out.add(x);
    const n = nodes[x];
    for (const d of n.deps) stack.push(d);
    for (const p of n.crew?.pool ?? []) stack.push(p);
  }
  return out;
}

export function downstreamOf(nodes: NodeMap, id: string): Set<string> {
  const users: Record<string, string[]> = {};
  for (const n of Object.values(nodes)) for (const d of [...n.deps, ...(n.crew?.pool ?? [])]) (users[d] ??= []).push(n.id);
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const x = stack.pop()!;
    if (out.has(x)) continue;
    out.add(x);
    for (const u of users[x] ?? []) stack.push(u);
  }
  return out;
}

/** Capabilities a node feeds (ids). */
export function affectedCapabilities(nodes: NodeMap, id: string): string[] {
  return [...downstreamOf(nodes, id)].filter((x) => nodes[x]?.kind === 'capability');
}

export function toMap<T extends { id: string }>(list: T[]): Record<string, T> {
  return Object.fromEntries(list.map((n) => [n.id, n]));
}
