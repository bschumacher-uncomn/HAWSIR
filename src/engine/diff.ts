import type { CapabilityResult, EngineResult } from './types';

export interface CapDelta {
  id: string;
  code: string;
  before?: CapabilityResult;
  after: CapabilityResult;
  readyDelta: number;
  marginDelta: number;
  statusChanged: boolean;
  controlChanged: boolean;
}

export interface ResultDiff {
  caps: CapDelta[];
  changedNodes: string[];
  consequential: boolean;
}

const same = (a: number, b: number) => (a === b) || Math.abs(a - b) < 1e-6;

export function diffResults(before: EngineResult | undefined, after: EngineResult): ResultDiff {
  const caps: CapDelta[] = after.capabilities.map((a) => {
    const b = before?.capabilities.find((c) => c.id === a.id);
    const readyDelta = b ? (Number.isFinite(a.ready) && Number.isFinite(b.ready) ? a.ready - b.ready : same(a.ready, b.ready) ? 0 : Infinity) : 0;
    const marginDelta = b ? (Number.isFinite(a.margin) && Number.isFinite(b.margin) ? a.margin - b.margin : same(a.margin, b.margin) ? 0 : -Infinity) : 0;
    return {
      id: a.id,
      code: a.code,
      before: b,
      after: a,
      readyDelta,
      marginDelta,
      statusChanged: !!b && b.status !== a.status,
      controlChanged: !!b && (b.controlling.nodeId !== a.controlling.nodeId || b.controlling.windowId !== a.controlling.windowId),
    };
  });
  const changedNodes = Object.keys(after.nodes).filter((id) => {
    const b = before?.nodes[id];
    return !b || !same(b.ready, after.nodes[id].ready);
  });
  return {
    caps,
    changedNodes,
    consequential: caps.some((c) => !same(c.marginDelta, 0) || c.statusChanged),
  };
}
