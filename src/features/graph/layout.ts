import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import { upstreamCone, type CapabilityResult, type EngineResult, type NodeMap, type SlackResult } from '@/engine';
import type { NodeKind } from '@/engine/types';

export type Role = 'chain' | 'cocrit' | 'cone' | 'off';

export interface GNodeData extends Record<string, unknown> {
  id: string;
  role: Role;
  selected: boolean;
  slack?: SlackResult;
  capStatus?: CapabilityResult['status'];
}

export interface GEdgeData extends Record<string, unknown> {
  role: Role;
  crew: boolean;
  color: string;
}

const SIZE: Record<NodeKind, [number, number]> = {
  input: [214, 66],
  person: [214, 66],
  task: [228, 74],
  gate: [228, 74],
  all: [118, 46],
  any: [118, 46],
  kofn: [150, 54],
  capability: [236, 104],
};

export const nodeSize = (k: NodeKind) => SIZE[k] ?? [200, 64];

export function buildGraph(
  nodes: NodeMap,
  result: EngineResult,
  cap: CapabilityResult | undefined,
  mode: 'cone' | 'full',
  selectedNode: string | null,
  slackById: Record<string, SlackResult>,
  chainColor: string,
): { nodes: Node<GNodeData>[]; edges: Edge<GEdgeData>[] } {
  const cone = cap ? upstreamCone(nodes, cap.id) : new Set<string>();
  const visible = Object.values(nodes).filter((n) => (mode === 'full' ? true : cone.has(n.id)));
  const vis = new Set(visible.map((n) => n.id));
  const chain = new Set(cap?.chain ?? []);
  const cocrit = new Set(cap?.coCritical ?? []);
  const chainEdge = new Set<string>();
  for (let i = 0; i < (cap?.chain.length ?? 0) - 1; i++) chainEdge.add(`${cap!.chain[i + 1]}>${cap!.chain[i]}`);

  const role = (id: string): Role => (chain.has(id) ? 'chain' : cocrit.has(id) ? 'cocrit' : cone.has(id) ? 'cone' : 'off');

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', ranksep: 96, nodesep: 16, edgesep: 8, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of visible) {
    const [w, h] = nodeSize(n.kind);
    g.setNode(n.id, { width: w, height: h });
  }

  const edges: Edge<GEdgeData>[] = [];
  for (const n of visible) {
    const ups = [...(n.deps ?? []).map((d) => [d, false] as const), ...(n.crew?.pool ?? []).map((d) => [d, true] as const)];
    for (const [src, crew] of ups) {
      if (!vis.has(src)) continue;
      g.setEdge(src, n.id);
      const key = `${src}>${n.id}`;
      const onChain = chainEdge.has(key);
      const r: Role = onChain ? 'chain' : cocrit.has(src) && chain.has(n.id) ? 'cocrit' : cone.has(src) && cone.has(n.id) ? 'cone' : 'off';
      edges.push({
        id: key,
        source: src,
        target: n.id,
        type: 'flow',
        zIndex: onChain ? 10 : r === 'cocrit' ? 5 : 0,
        data: { role: r, crew, color: r === 'chain' ? chainColor : r === 'cocrit' ? '#fbbf24' : crew ? '#c084fc' : '#38bdf8' },
      });
    }
  }
  dagre.layout(g);

  const out: Node<GNodeData>[] = visible.map((n) => {
    const p = g.node(n.id);
    const [w, h] = nodeSize(n.kind);
    return {
      id: n.id,
      type: 'navifi',
      position: { x: p.x - w / 2, y: p.y - h / 2 },
      width: w,
      height: h,
      draggable: false,
      data: {
        id: n.id,
        role: role(n.id),
        selected: n.id === selectedNode,
        slack: slackById[n.id],
        capStatus: n.kind === 'capability' ? result.capabilities.find((c) => c.id === n.id)?.status : undefined,
      },
    };
  });
  return { nodes: out, edges };
}
