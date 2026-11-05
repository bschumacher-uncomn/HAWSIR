import type { GraphSpec, NodeSpec, Provenance, QualityFlag } from '../../core/graph';
import { complement, normalize, type Interval } from '../../core/intervals';
import type { Lever } from '../../core/options';
import { DEFAULT_AUTHORITY, type AuthorityTable } from '../../core/risk';
import type { AttributeDef, Fact, Resolved } from '../../data/store';
import type { BuildContext, BuildResult, DomainPack } from '../pack';

/**
 * Authored mission threads. Some missions are best written down directly as a
 * graph (a destroyer's 21-day work-up, a repair job) rather than compiled from
 * a domain model. The author writes the graph once; every value that changes
 * during the watch is *bound* to a fact, so the graph still reads the governed
 * data plane: reports arrive as facts, quality flags come from the store, and
 * reading "as of" a time replays what was known then.
 *
 * Bindings (the fact's entity defaults to the node id):
 *   event   ready_at     when it becomes available (null = reported unknown)
 *   person  ready_at     available from;  person_unavailable  periods away
 *   task    duration_h   how long it takes (null = estimate withdrawn)
 *   window  outage       periods the system is down
 *   any     uncertainty  optional triangular spread for Monte Carlo
 * A node with `when` exists only once a fact for that entity/attribute is known
 * (e.g. a repair chain appears when the casualty is reported).
 */
export type BoundAttr = 'ready_at' | 'duration_h' | 'outage' | 'person_unavailable';

export interface Binding {
  attr: BoundAttr;
  entity?: string;
  /** Flag the value stale when the latest report is older than this (hours) and the time is still ahead. */
  staleAfterH?: number;
}

export type AuthoredNode = NodeSpec & {
  bind?: Binding[];
  when?: { entity: string; attr: string };
};

export interface AuthoredModel {
  id: string;
  name: string;
  epochUtc: string;
  horizon: [number, number];
  marks?: Record<string, number>;
  /** Default Q threshold (hours). */
  qMarginH?: number;
  nodes: AuthoredNode[];
  /** Requirements the watch team tracks, most important first. */
  focus: string[];
  /** Bounded options, built against the compiled graph (so they can extend crew pools and slots as they stand). */
  levers?: (g: GraphSpec, now: number) => Lever[];
  authority?: AuthorityTable;
}

export const AUTHORED_ATTRIBUTES: AttributeDef[] = [
  { key: 'ready_at', type: 'hours', worse: 'higher', conflictWindowH: 96, nullable: true, description: 'When an input becomes available (scenario hours); null = reported as not known' },
  { key: 'duration_h', type: 'hours', min: 0, worse: 'higher', nullable: true, description: 'Task duration in hours; null = estimate withdrawn' },
  { key: 'outage', type: 'intervals', absentMeansNone: true, description: 'Periods a system is down (CASREP), [[start, end], ...]' },
  { key: 'person_unavailable', type: 'intervals', absentMeansNone: true, description: 'Periods a person is unavailable (reason in the fact reason)' },
  { key: 'uncertainty', type: 'json', absentMeansNone: true, description: 'Triangular spread {min, mode, max} in hours for Monte Carlo' },
];

const DATA_FLAGS: QualityFlag[] = ['stale', 'contradictory', 'malformed'];

function provOf(rs: Resolved[], note?: string): Provenance | undefined {
  const facts = rs.flatMap((r) => [...(r.fact ? [r.fact] : []), ...r.alternatives, ...r.quarantined]) as Fact[];
  if (!facts.length) return note ? { note } : undefined;
  return {
    facts: [...new Set(facts.map((f) => f.id))],
    sources: facts.map((f) => ({ system: f.source.system, recordId: f.source.recordId, factId: f.id, observedAt: f.observedAt, kind: f.source.kind, note: f.reason })),
    note,
  };
}

function compile(m: AuthoredModel, ctx: BuildContext): BuildResult {
  const { view, now } = ctx;
  const present = (w?: AuthoredNode['when']) => !w || view.facts(w.entity, w.attr).some((f) => !f.quarantine);
  const kept = m.nodes.filter((n) => present(n.when));
  const ids = new Set(kept.map((n) => n.id));
  const nodes: NodeSpec[] = kept.map((src) => {
    const { bind, when: _w, ...rest } = src;
    const n = structuredClone(rest) as NodeSpec;
    const flags = new Set<QualityFlag>(n.flags ?? []);
    const used: Resolved[] = [];
    const notes: string[] = [];
    for (const b of bind ?? []) {
      const entity = b.entity ?? src.id;
      const r = view.get<unknown>(entity, b.attr, { scopes: ctx.scopes });
      used.push(r);
      for (const f of r.flags) if (DATA_FLAGS.includes(f)) flags.add(f);
      if (r.note) notes.push(r.note);
      const reportedUnknown = r.fact !== undefined && r.value === null;
      if (reportedUnknown) notes.push(`${r.fact!.source.system} reports this as not known`);
      switch (b.attr) {
        case 'ready_at': {
          const t = typeof r.value === 'number' ? r.value : null;
          if (n.kind === 'event') n.at = t;
          else if (n.kind === 'person' && t !== null) n.from = t;
          if (t !== null && b.staleAfterH !== undefined && (r.ageH ?? 0) > b.staleAfterH && t > now) flags.add('stale');
          break;
        }
        case 'duration_h':
          if (n.kind === 'task') n.duration = typeof r.value === 'number' ? r.value : null;
          break;
        case 'outage':
          if (n.kind === 'window' && Array.isArray(r.value)) n.intervals = complement(normalize((r.value as number[][]).map(([a, z]) => [a, z] as Interval))) as Interval[];
          break;
        case 'person_unavailable':
          if (n.kind === 'person' && Array.isArray(r.value)) n.unavailable = (r.value as number[][]).map(([start, end]) => ({ start, end, reason: r.fact?.reason }));
          break;
      }
    }
    const u = view.get<{ min: number; mode: number; max: number }>(src.id, 'uncertainty');
    if (u.value && typeof u.value === 'object') n.uncertainty = { ...n.uncertainty, ...u.value };
    if ('deps' in n && Array.isArray(n.deps)) n.deps = n.deps.filter((d) => ids.has(d));
    if (n.kind === 'task' && n.crew) n.crew = { ...n.crew, pool: n.crew.pool.filter((p) => ids.has(p)) };
    n.flags = [...flags];
    const prov = provOf(used, notes.join('; ') || undefined);
    if (prov) n.prov = { ...n.prov, ...prov, citations: n.prov?.citations };
    return n;
  });
  const graph: GraphSpec = { id: m.id, label: m.name, horizon: m.horizon, nodes, qMargin: m.qMarginH, marks: m.marks };
  const levers = m.levers ? m.levers(graph, now) : [];
  return {
    graph,
    levers,
    focus: m.focus.filter((id) => ids.has(id)),
    health: view.health(),
    authority: m.authority ?? DEFAULT_AUTHORITY,
    epochUtcMs: Date.parse(m.epochUtc),
  };
}

export const authoredPack: DomainPack<AuthoredModel> = {
  id: 'authored',
  version: '0.1.0',
  title: 'Authored mission threads (graph written directly, values bound to facts)',
  attributes: AUTHORED_ATTRIBUTES,
  tables: [],
  routines: [],
  build: compile,
};
