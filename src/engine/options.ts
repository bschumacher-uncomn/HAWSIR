import { applyPatches, type NodeMap } from './apply';
import { compute } from './compute';
import type { CapabilityResult, Hours, Lever, Readiness, Scenario } from './types';

export interface OptionEval {
  levers: Lever[];
  id: string;
  available: boolean;
  unavailableReason?: string;
  targetId: string;
  marginBefore: number;
  marginAfter: number;
  recovered: number;
  statusBefore: Readiness;
  statusAfter: Readiness;
  controllingAfter: CapabilityResult['controlling'];
  sideEffects: { capId: string; code: string; delta: number }[];
  effective: boolean;
  why: string;
}

function leverAvailable(l: Lever, nodes: NodeMap, at: Hours): string | undefined {
  if (l.requiresNodes?.some((id) => !nodes[id])) return 'Not applicable to current picture';
  if (l.deadline !== undefined && at > l.deadline) return 'Request deadline has passed';
  return undefined;
}

function evalCombo(s: Scenario, nodes: NodeMap, at: Hours, targetId: string, levers: Lever[], baseCaps: CapabilityResult[]): OptionEval {
  const before = baseCaps.find((c) => c.id === targetId)!;
  const after = compute(s, applyPatches(nodes, levers.flatMap((l) => l.patches)), at);
  const a = after.capabilities.find((c) => c.id === targetId) ?? before;
  const recovered = a.margin - before.margin;
  const sideEffects = after.capabilities
    .filter((c) => c.id !== targetId)
    .map((c) => ({ capId: c.id, code: c.code, delta: c.margin - (baseCaps.find((b) => b.id === c.id)?.margin ?? c.margin) }))
    .filter((x) => Math.abs(x.delta) > 1e-6);
  const effective = recovered > 1e-6 || (before.status !== a.status && a.status !== 'N' && before.status === 'N');
  const why = effective
    ? a.controlling.nodeId !== before.controlling.nodeId || a.controlling.windowId !== before.controlling.windowId
      ? `Recovers margin; control shifts to ${a.controlling.label}`
      : `Recovers margin; ${a.controlling.label} still controls`
    : `No gain: readiness is still controlled by ${a.controlling.label}`;
  return {
    levers,
    id: levers.map((l) => l.id).join('+'),
    available: true,
    targetId,
    marginBefore: before.margin,
    marginAfter: a.margin,
    recovered,
    statusBefore: before.status,
    statusAfter: a.status,
    controllingAfter: a.controlling,
    sideEffects,
    effective,
    why,
  };
}

/**
 * Bounded options: every response comes from a pre-authorized lever library.
 * The engine evaluates singles plus pairwise packages; it never invents actions.
 */
export function evaluateOptions(s: Scenario, nodes: NodeMap, at: Hours, targetId: string, approved: string[] = []) {
  const base = compute(s, nodes, at);
  const singles: OptionEval[] = [];
  for (const l of s.levers) {
    if (approved.includes(l.id)) continue;
    const why = leverAvailable(l, nodes, at);
    if (why) {
      const b = base.capabilities.find((c) => c.id === targetId)!;
      singles.push({
        levers: [l], id: l.id, available: false, unavailableReason: why, targetId,
        marginBefore: b?.margin ?? 0, marginAfter: b?.margin ?? 0, recovered: 0,
        statusBefore: b?.status ?? 'Y', statusAfter: b?.status ?? 'Y', controllingAfter: b?.controlling,
        sideEffects: [], effective: false, why,
      } as OptionEval);
      continue;
    }
    singles.push(evalCombo(s, nodes, at, targetId, [l], base.capabilities));
  }
  const avail = singles.filter((o) => o.available && o.levers[0].category !== 'accept');
  const combos: OptionEval[] = [];
  for (let i = 0; i < avail.length; i++)
    for (let j = i + 1; j < avail.length; j++) {
      const c = evalCombo(s, nodes, at, targetId, [avail[i].levers[0], avail[j].levers[0]], base.capabilities);
      const bestSingle = Math.max(avail[i].recovered, avail[j].recovered);
      if (c.recovered > bestSingle + 1e-6) combos.push(c);
    }
  const isAccept = (o: OptionEval) => Number(o.levers.some((l) => l.category === 'accept'));
  const rank = (a: OptionEval, b: OptionEval) =>
    Number(b.available) - Number(a.available) || isAccept(a) - isAccept(b) || b.recovered - a.recovered;
  singles.sort(rank);
  combos.sort(rank);
  return { singles, combos: combos.slice(0, 3) };
}
