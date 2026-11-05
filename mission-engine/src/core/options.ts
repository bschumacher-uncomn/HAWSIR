import { compute, type ComputeContext } from './compute';
import type { EngineResult, GraphSpec, Readiness, Severity } from './graph';
import { applyPatches, type Patch } from './patch';
import { assess, maxLevel, type AuthorityTable, type Probability, type RiskAssessment, type RiskLevel, DEFAULT_AUTHORITY } from './risk';

/**
 * Bounded options. A lever is a named set of patches with an approval
 * authority, an act-by deadline, a cost, and a declared risk. The engine
 * evaluates each lever and each pair against a target requirement, with the
 * side effects on every other requirement. A lever is always a *planning
 * assumption* for a human to approve; the engine never issues it.
 */
export type LeverCategory =
  | 'expedite'
  | 'crew'
  | 'logistics'
  | 'c2'
  | 'emcon'
  | 'reassign'
  | 'schedule'
  | 'speed'
  | 'resequence'
  | 'accept';

/** Things the system must never do on its own (challenge requirement 6). */
export const PROHIBITED_CATEGORIES = ['issue-order', 'direct-personnel', 'authorize-maintenance', 'alter-tasking', 'modify-record'] as const;

export interface Lever {
  id: string;
  title: string;
  detail: string;
  category: LeverCategory;
  /** Who must approve it. */
  authority: string;
  /** True when the unit's own CO can approve. */
  withinUnitAuthority: boolean;
  /** Latest scenario time it can still be requested (act-by). */
  deadline?: number;
  cost: 'low' | 'med' | 'high';
  /** Declared operational risk of taking the lever itself. */
  risk?: { severity: Severity; probability: Probability; note: string };
  /** Missing information that makes the evaluation incomplete. */
  missingInfo?: string[];
  requiresNodes?: string[];
  patches: Patch[];
  effect: 'planning-assumption';
  target?: string;
  source?: string;
  /** Levers sharing a group are alternatives (e.g. slip 6 h vs 12 h) and are never paired. */
  exclusive?: string;
  /** Set by the pack when the lever cannot work as things stand (shown, never evaluated). */
  infeasible?: string;
}

export function assertLever(l: Lever): void {
  if (l.effect !== 'planning-assumption') throw new Error(`lever ${l.id}: effect must be planning-assumption`);
  if ((PROHIBITED_CATEGORIES as readonly string[]).includes(l.category as string)) throw new Error(`lever ${l.id}: category ${l.category} is prohibited`);
  if (!l.authority) throw new Error(`lever ${l.id}: an approval authority is required`);
}

export interface SideEffect {
  requirement: string;
  label: string;
  delta: number;
  before: Readiness;
  after: Readiness;
}

export interface OptionEval {
  id: string;
  levers: string[];
  title: string;
  target: string;
  available: boolean;
  unavailableReason?: string;
  incomplete: string[];
  marginBefore: number;
  marginAfter: number;
  recovered: number;
  statusBefore: Readiness;
  statusAfter: Readiness;
  controllingAfter: string[];
  sideEffects: SideEffect[];
  effective: boolean;
  why: string;
  authority: string;
  deadline?: number;
  cost: Lever['cost'];
  risk?: RiskAssessment;
}

function availability(l: Lever, g: GraphSpec, now: number): string | undefined {
  const ids = new Set(g.nodes.map((n) => n.id));
  if (l.requiresNodes?.some((id) => !ids.has(id))) return 'not applicable to the current picture';
  if (l.deadline !== undefined && now > l.deadline + 1e-9) return 'act-by time has passed';
  if (l.infeasible) return l.infeasible;
  return undefined;
}

const COST_ORDER = { low: 0, med: 1, high: 2 } as const;
// UNK is not an improvement over N: an option that leaves the answer unknown has not recovered anything.
const STATUS_RANK: Record<Readiness, number> = { Y: 3, Q: 2, UNK: 0, N: 0 };

function finite(x: number): number {
  return Number.isFinite(x) ? x : x > 0 ? 1e6 : -1e6;
}

function evalCombo(g: GraphSpec, ctx: ComputeContext, base: EngineResult, target: string, levers: Lever[], authority: AuthorityTable): OptionEval {
  const before = base.requirements[target];
  const after = compute(applyPatches(g, levers.flatMap((l) => l.patches)), { ...ctx, hash: false });
  const a = after.requirements[target] ?? before;
  const recovered = finite(a.margin) - finite(before.margin);
  const sideEffects: SideEffect[] = Object.values(after.requirements)
    .filter((r) => r.id !== target && base.requirements[r.id])
    .map((r) => {
      const b = base.requirements[r.id];
      const nodeLabel = g.nodes.find((n) => n.id === r.id)?.label ?? r.id;
      return { requirement: r.id, label: nodeLabel, delta: finite(r.margin) - finite(b.margin), before: b.status, after: r.status };
    })
    .filter((x) => Math.abs(x.delta) > 1e-6 || x.before !== x.after);
  const effective = (recovered > 1e-6 && STATUS_RANK[a.status] >= STATUS_RANK[before.status]) || STATUS_RANK[a.status] > STATUS_RANK[before.status];
  const ctrlAfter = a.leaves.map((c) => c.label);
  const ctrlBefore = before.leaves.map((c) => c.label);
  const why = effective
    ? ctrlAfter.join() !== ctrlBefore.join()
      ? `recovers ${fmtH(recovered)}; control shifts to ${ctrlAfter.join(', ') || 'nothing in the horizon'}`
      : `recovers ${fmtH(recovered)}; ${ctrlAfter.join(', ')} still controls`
    : `no gain: still controlled by ${ctrlBefore.join(', ') || 'nothing'}`;
  let risk: RiskAssessment | undefined;
  let level: RiskLevel | undefined;
  for (const l of levers) {
    if (!l.risk) continue;
    const r = assess(l.risk.severity, l.risk.probability, authority, 'declared');
    level = level ? maxLevel(level, r.level) : r.level;
    risk = !risk || r.level === level ? { ...r, text: `${r.text}. ${l.risk.note}` } : risk;
  }
  const authorities = [...new Set(levers.map((l) => l.authority))];
  const riskAuthority = risk ? authority[risk.level] : undefined;
  return {
    id: levers.map((l) => l.id).join('+'),
    levers: levers.map((l) => l.id),
    title: levers.map((l) => l.title).join(' + '),
    target,
    available: true,
    incomplete: levers.flatMap((l) => l.missingInfo ?? []),
    marginBefore: before.margin,
    marginAfter: a.margin,
    recovered,
    statusBefore: before.status,
    statusAfter: a.status,
    controllingAfter: ctrlAfter,
    sideEffects,
    effective,
    why,
    authority: [...authorities, ...(riskAuthority && !authorities.includes(riskAuthority) ? [`risk acceptance: ${riskAuthority}`] : [])].join('; '),
    deadline: levers.reduce<number | undefined>((m, l) => (l.deadline === undefined ? m : m === undefined ? l.deadline : Math.min(m, l.deadline)), undefined),
    cost: levers.reduce<Lever['cost']>((m, l) => (COST_ORDER[l.cost] > COST_ORDER[m] ? l.cost : m), 'low'),
    risk,
  };
}

function fmtH(h: number): string {
  if (!Number.isFinite(h) || Math.abs(h) >= 1e5) return h > 0 ? 'all of it' : 'nothing';
  const m = Math.round(h * 60);
  const hh = Math.floor(Math.abs(m) / 60);
  const mm = Math.abs(m) % 60;
  return `${m < 0 ? '-' : ''}${hh ? `${hh}h ` : ''}${mm}m`;
}

export interface OptionOpts {
  pairs?: boolean;
  authority?: AuthorityTable;
}

export function evaluateOptions(g: GraphSpec, ctx: ComputeContext, base: EngineResult, target: string, levers: Lever[], opts: OptionOpts = {}): OptionEval[] {
  const authority = opts.authority ?? DEFAULT_AUTHORITY;
  levers.forEach(assertLever);
  const out: OptionEval[] = [];
  const usable: Lever[] = [];
  for (const l of levers) {
    const why = availability(l, g, ctx.now);
    if (why) {
      out.push({
        id: l.id, levers: [l.id], title: l.title, target, available: false, unavailableReason: why, incomplete: l.missingInfo ?? [],
        marginBefore: base.requirements[target]?.margin ?? NaN, marginAfter: NaN, recovered: 0,
        statusBefore: base.requirements[target]?.status ?? 'UNK', statusAfter: base.requirements[target]?.status ?? 'UNK',
        controllingAfter: [], sideEffects: [], effective: false, why, authority: l.authority, deadline: l.deadline, cost: l.cost,
      });
      continue;
    }
    usable.push(l);
    out.push(evalCombo(g, ctx, base, target, [l], authority));
  }
  if (opts.pairs !== false) {
    for (let i = 0; i < usable.length; i++) {
      for (let j = i + 1; j < usable.length; j++) {
        if (usable[i].exclusive && usable[i].exclusive === usable[j].exclusive) continue;
        if (usable[i].patches.length === 0 || usable[j].patches.length === 0) continue;
        const pair = evalCombo(g, ctx, base, target, [usable[i], usable[j]], authority);
        const best = Math.max(
          out.find((o) => o.id === usable[i].id)?.recovered ?? 0,
          out.find((o) => o.id === usable[j].id)?.recovered ?? 0,
        );
        // keep pairs only when they beat both singles (synergy, e.g. expedite + fly-away team)
        if (pair.recovered > best + 1e-6 || STATUS_RANK[pair.statusAfter] > Math.max(...[usable[i], usable[j]].map((l) => STATUS_RANK[out.find((o) => o.id === l.id)!.statusAfter]))) out.push(pair);
      }
    }
  }
  return out.sort((a, b) =>
    Number(b.available) - Number(a.available) ||
    Number(b.effective) - Number(a.effective) ||
    STATUS_RANK[b.statusAfter] - STATUS_RANK[a.statusAfter] ||
    b.recovered - a.recovered ||
    a.levers.length - b.levers.length ||
    COST_ORDER[a.cost] - COST_ORDER[b.cost],
  );
}
