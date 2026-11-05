import type { GraphSpec } from '../core/graph';
import type { Lever } from '../core/options';
import { assertLever } from '../core/options';
import { TableRegistry, type FactorTable } from '../core/provenance';
import { RoutineRegistry, type RoutineDef } from '../core/routines';
import type { AuthorityTable } from '../core/risk';
import { AttributeRegistry, type AttributeDef, type FactView, type HealthItem } from '../data/store';

/**
 * Domain packs. The core engine knows timelines, stocks, gates, k-of-n,
 * margins and attribution. A pack knows a domain: which facts exist
 * (attributes), which planning factors apply (cited tables), which leaf math
 * computes them (routines), how domain entities compile into graph nodes
 * (build), which bounded options exist (levers), and which data-quality rules
 * matter. Packs version independently and may depend on other packs (the
 * naval pack uses the airlift pack to check a COD leg).
 */
export interface BuildContext {
  view: FactView;
  now: number;
  routines: RoutineRegistry;
  tables: TableRegistry;
  /** Scope precedence for policy values, most specific first. */
  scopes: string[];
}

export interface BuildResult {
  graph: GraphSpec;
  levers: Lever[];
  /** Requirements the watch team cares about most, in priority order. */
  focus: string[];
  /** Pack-level data-health findings (e.g. unreported significant change). */
  health: HealthItem[];
  authority?: AuthorityTable;
  epochUtcMs?: number;
}

export interface DomainPack<Model = any> {
  id: string;
  version: string;
  title: string;
  dependsOn?: string[];
  attributes: AttributeDef[];
  tables: FactorTable[];
  routines: RoutineDef[];
  build?: (model: Model, ctx: BuildContext) => BuildResult;
}

export class PackRegistry {
  readonly attrs = new AttributeRegistry();
  readonly routines = new RoutineRegistry();
  readonly tables = new TableRegistry();
  private packs = new Map<string, DomainPack>();

  register(p: DomainPack): this {
    if (this.packs.has(p.id)) return this;
    for (const d of p.dependsOn ?? []) if (!this.packs.has(d)) throw new Error(`pack ${p.id} depends on ${d}; register it first`);
    for (const a of p.attributes) if (!this.attrs.get(a.key)) this.attrs.register(a);
    for (const t of p.tables) this.tables.register(t);
    for (const r of p.routines) this.routines.register(r, p.id);
    this.packs.set(p.id, p);
    return this;
  }

  get(id: string): DomainPack {
    const p = this.packs.get(id);
    if (!p) throw new Error(`unknown pack ${id}`);
    return p;
  }

  list(): DomainPack[] {
    return [...this.packs.values()];
  }

  versions(): Record<string, string> {
    return Object.fromEntries(this.list().map((p) => [p.id, p.version]));
  }

  /** Routine ids whose tests and declared monotonicity pass. */
  verifiedRoutines(): Set<string> {
    return new Set(this.routines.verifyAll().filter((v) => v.ok).map((v) => v.routine));
  }

  checkLevers(levers: Lever[]): void {
    levers.forEach(assertLever);
  }
}
