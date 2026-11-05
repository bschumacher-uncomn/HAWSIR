/**
 * Citations and governed factor tables. Every planning factor the engine uses
 * says where it came from and whether it is sourced, derived, or synthetic.
 */
export type CitationStatus = 'sourced' | 'derived' | 'synthetic' | 'assumption';

export interface Citation {
  title: string;
  url?: string;
  locator?: string;
  status: CitationStatus;
  note?: string;
}

export interface FactorTable<Row extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  title: string;
  units: Record<string, string>;
  rows: Row[];
  citations: Citation[];
  status: CitationStatus;
  note?: string;
}

/** Linear interpolation over a numeric key, clamped at the table ends (flagged). */
export function interpolate(points: { x: number; y: number }[], x: number): { y: number; clamped: boolean } {
  const ps = points.slice().sort((a, b) => a.x - b.x);
  if (ps.length === 0) return { y: NaN, clamped: true };
  if (x <= ps[0].x) return { y: ps[0].y, clamped: x < ps[0].x };
  const last = ps[ps.length - 1];
  if (x >= last.x) return { y: last.y, clamped: x > last.x };
  for (let i = 0; i < ps.length - 1; i++) {
    const a = ps[i];
    const b = ps[i + 1];
    if (x >= a.x && x <= b.x) return { y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x), clamped: false };
  }
  return { y: last.y, clamped: true };
}

export class TableRegistry {
  private tables = new Map<string, FactorTable>();
  register(t: FactorTable): void {
    if (this.tables.has(t.id)) throw new Error(`factor table ${t.id} already registered`);
    this.tables.set(t.id, t);
  }
  get<Row extends Record<string, unknown> = Record<string, unknown>>(id: string): FactorTable<Row> {
    const t = this.tables.get(id);
    if (!t) throw new Error(`unknown factor table ${id}`);
    return t as unknown as FactorTable<Row>;
  }
  has(id: string): boolean {
    return this.tables.has(id);
  }
  list(): FactorTable[] {
    return [...this.tables.values()];
  }
}
