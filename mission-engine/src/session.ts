import { slackTable, type SlackResult } from './core/analysis';
import { compute, type ComputeContext } from './core/compute';
import { explainRequirement, type FiveAnswers } from './core/explain';
import type { EngineResult, GraphSpec } from './core/graph';
import { hashOf } from './core/hash';
import { runMonteCarlo, type McResult } from './core/montecarlo';
import { evaluateOptions, type Lever, type OptionEval } from './core/options';
import { applyPatches, type Patch } from './core/patch';
import { assessRequirement, DEFAULT_AUTHORITY, type AuthorityTable, type RiskAssessment } from './core/risk';
import { burnDown, type BurnDownRow } from './core/trend';
import { DecisionLog, type Actor, type Decision } from './data/decisions';
import { FactLog, type HealthItem } from './data/store';
import { PackRegistry, type BuildResult, type DomainPack } from './packs/pack';

/**
 * A mission session: packs + mission model + fact log + decision log.
 *
 *   facts (as of t) ──compile(pack)──▶ graph ──overlay(approved levers)──▶ graph'
 *        ──compute──▶ result ──analyse──▶ advisory (five answers, slack, options, risk, health)
 *
 * Everything runs locally with no I/O, so the full answer is available with the
 * link down; only fresh facts stop arriving.
 */
export interface SessionOpts<M> {
  packs: DomainPack[];
  main: string;
  model: M;
  log: FactLog;
  decisions?: DecisionLog;
  scopes?: string[];
}

export interface Evaluation {
  asOf: number;
  build: BuildResult;
  graph: GraphSpec;
  result: EngineResult;
  /** Levers applied as approved planning assumptions. */
  assumptions: string[];
  ctx: ComputeContext;
}

export interface Advisory {
  asOf: number;
  suspended: boolean;
  stopNote?: string;
  focus: string[];
  answers: FiveAnswers[];
  options: Record<string, OptionEval[]>;
  risk: Record<string, RiskAssessment>;
  slack?: { target: string; rows: SlackResult[] };
  mc?: McResult;
  health: HealthItem[];
  overrides: Decision[];
  assumptions: string[];
  trace: {
    factsHead: string;
    decisionsHead: string;
    graphHash: string;
    resultHash: string;
    packs: Record<string, string>;
    routines: Record<string, string>;
    unverifiedRoutines: string[];
  };
}

export interface AdviseOpts {
  monteCarlo?: number;
  seed?: number;
  slackTarget?: string | false;
  pairs?: boolean;
}

export class MissionSession<M = unknown> {
  readonly registry = new PackRegistry();
  readonly decisions: DecisionLog;
  readonly log: FactLog;
  readonly model: M;
  private readonly main: DomainPack<M>;
  private readonly verified: Set<string>;
  private readonly scopes: string[];

  constructor(o: SessionOpts<M>) {
    for (const p of o.packs) this.registry.register(p);
    this.main = this.registry.get(o.main) as DomainPack<M>;
    if (!this.main.build) throw new Error(`pack ${o.main} has no builder`);
    this.model = o.model;
    this.log = o.log;
    this.decisions = o.decisions ?? new DecisionLog();
    this.verified = this.registry.verifiedRoutines();
    const id = (o.model as { id?: string }).id;
    this.scopes = o.scopes ?? (id ? [`mission:${id}`, 'global'] : ['global']);
  }

  ctx(now: number): ComputeContext {
    return { now, routines: this.registry.routines, verified: this.verified };
  }

  compile(asOf: number): BuildResult {
    const view = this.log.view(asOf);
    const b = this.main.build!(this.model, { view, now: asOf, routines: this.registry.routines, tables: this.registry.tables, scopes: this.scopes });
    this.registry.checkLevers(b.levers);
    return b;
  }

  /** Graph with approved levers overlaid as planning assumptions (never written back to facts). */
  evaluate(asOf: number, opts: { assumptions?: boolean } = {}): Evaluation {
    const build = this.compile(asOf);
    let graph = build.graph;
    const applied: string[] = [];
    if (opts.assumptions !== false) {
      const active = this.decisions.activeLevers(asOf);
      const patches: Patch[] = [];
      for (const [leverId, d] of active) {
        const ps = d.patches?.length ? d.patches : build.levers.find((l) => l.id === leverId)?.patches;
        if (!ps) continue;
        patches.push(...ps);
        applied.push(leverId);
      }
      graph = applyPatches(graph, patches);
      if (applied.length) graph = { ...graph, nodes: graph.nodes.map((n) => (touches(patches, n.id) ? { ...n, flags: [...new Set([...(n.flags ?? []), 'planning-assumption' as const])] } : n)) };
    }
    const ctx = this.ctx(asOf);
    const result = compute(graph, ctx);
    return { asOf, build, graph, result, assumptions: applied, ctx };
  }

  advise(asOf: number, o: AdviseOpts = {}): Advisory {
    const ev = this.evaluate(asOf);
    const { build, graph, result, ctx } = ev;
    const authority: AuthorityTable = build.authority ?? DEFAULT_AUTHORITY;
    const trace = {
      factsHead: this.log.head(),
      decisionsHead: this.decisions.head(),
      graphHash: result.graphHash,
      resultHash: hashOf(Object.values(result.requirements).map((r) => [r.id, r.status, r.margin])),
      packs: this.registry.versions(),
      routines: Object.fromEntries(this.registry.routines.list().map((r) => [r.id, r.version])),
      unverifiedRoutines: this.registry.routines.list().filter((r) => !this.verified.has(r.id)).map((r) => r.id),
    };
    if (this.decisions.isStopped(asOf)) {
      const stop = [...this.decisions.all()].reverse().find((d) => d.kind === 'stop' && d.at <= asOf);
      return {
        asOf, suspended: true, stopNote: stop?.note, focus: build.focus, answers: [], options: {}, risk: {}, health: [],
        overrides: [...this.decisions.overrides(asOf).values()], assumptions: ev.assumptions, trace,
      };
    }
    const unapplied = build.levers.filter((l) => !ev.assumptions.includes(l.id));
    const options: Record<string, OptionEval[]> = {};
    for (const target of build.focus) {
      const rr = result.requirements[target];
      if (!rr) continue;
      const ls = unapplied.filter((l) => l.target === target);
      if (!ls.length) continue;
      if (rr.status === 'Y' && rr.margin > 24) continue;
      options[target] = evaluateOptions(graph, ctx, result, target, ls, { pairs: o.pairs, authority });
    }
    const mc = o.monteCarlo ? runMonteCarlo(graph, ctx, build.focus, o.monteCarlo, o.seed ?? 1337) : undefined;
    const risk: Record<string, RiskAssessment> = {};
    for (const id of build.focus) {
      const rr = result.requirements[id];
      const spec = graph.nodes.find((n) => n.id === id);
      if (!rr || spec?.kind !== 'requirement') continue;
      risk[id] = assessRequirement(rr, spec.severity ?? 'III', authority, mc ? mc.requirements[id]?.pN + (mc.requirements[id]?.pUNK ?? 0) : undefined);
    }
    const markLabel = graph.marks?.H !== undefined ? 'H' : Object.keys(graph.marks ?? {})[0];
    const mark = markLabel ? graph.marks![markLabel] : undefined;
    const answers = build.focus.filter((id) => result.requirements[id]).map((id) =>
      explainRequirement(graph, result, id, { mark, markLabel, options: options[id], risk: risk[id] }),
    );
    const slackTarget = o.slackTarget === false ? undefined : o.slackTarget ?? build.focus[0];
    const slack = slackTarget && result.requirements[slackTarget] ? { target: slackTarget, rows: slackTable(graph, ctx, slackTarget, result) } : undefined;
    return {
      asOf, suspended: false, focus: build.focus, answers, options, risk, slack, mc, health: build.health,
      overrides: [...this.decisions.overrides(asOf).values()], assumptions: ev.assumptions, trace,
    };
  }

  burnDown(times: number[], ids?: string[]): BurnDownRow[] {
    const focus = ids ?? this.compile(times[times.length - 1]).focus;
    return burnDown((t) => this.evaluate(t).result, focus, times);
  }

  /** Approve a lever: the exact patches are stored with the decision so the assumption is reproducible. */
  approve(leverId: string, actor: Actor, at: number, note?: string): Decision {
    if (this.decisions.isStopped(at)) throw new Error('advisory output is stopped; resume before approving');
    const ev = this.evaluate(at);
    const lever = ev.build.levers.find((l) => l.id === leverId);
    if (!lever) throw new Error(`no lever ${leverId} available at ${at}`);
    if (lever.deadline !== undefined && at > lever.deadline) throw new Error(`lever ${leverId} act-by time ${lever.deadline} has passed`);
    return this.decisions.record({
      kind: 'approve', lever: leverId, actor, at, note, patches: lever.patches,
      basis: { factsHead: this.log.head(), graphHash: ev.result.graphHash, resultHash: hashOf(Object.values(ev.result.requirements).map((r) => [r.id, r.status, r.margin])) },
    });
  }

  reject(leverId: string, actor: Actor, at: number, note: string): Decision {
    return this.decisions.reject(leverId, actor, at, note, { factsHead: this.log.head() });
  }

  modify(leverId: string, patches: Patch[], actor: Actor, at: number, note: string): Decision {
    return this.decisions.modify(leverId, patches, actor, at, note, { factsHead: this.log.head() });
  }

  levers(asOf: number): Lever[] {
    return this.compile(asOf).levers;
  }
}

function touches(patches: Patch[], id: string): boolean {
  return patches.some((p) => (p.op === 'add' ? p.node.id === id : 'id' in p && p.id === id));
}
