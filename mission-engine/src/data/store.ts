import { canonical, sha256 } from '../core/hash';
import type { QualityFlag } from '../core/graph';
import type { Citation } from '../core/provenance';

/**
 * The data plane: AMPLIFI's governed value model, rebuilt for the edge.
 *
 *   - Append-only. A fact is never edited or deleted; a newer fact supersedes it.
 *   - Bitemporal. `observedAt` is when the observation was true, `validFrom/To`
 *     is when a state or plan applies, and `recordedAt` is when we learned it.
 *     Reading "as of" a time replays exactly what was known then.
 *   - Scoped. A mission- or group-scoped value overrides the global default
 *     (AMPLIFI DEC-015/019, generalized).
 *   - Provenance on every fact: source system, record id, who, why.
 *   - Quality on every read: missing (with conservative default), stale,
 *     contradictory (sources disagree → worse value wins), malformed
 *     (quarantined, raw kept).
 *   - Hash-chained, content-addressed, mergeable: a ship's log and a shore log
 *     can be merged after a disconnect without losing or overwriting anything.
 */
export type SourceKind = 'feed' | 'manual' | 'document' | 'calc' | 'assumption' | 'synthetic';

export interface FactSource {
  system: string;
  recordId?: string;
  kind: SourceKind;
  citation?: Citation;
}

export interface FactInput {
  entity: string;
  attr: string;
  value: unknown;
  unit?: string;
  scope?: string;
  source: FactSource;
  observedAt: number;
  validFrom?: number;
  validTo?: number;
  recordedAt: number;
  recordedBy: string;
  reason?: string;
  origin?: string;
}

export interface Fact extends FactInput {
  id: string;
  seq: number;
  prevHash: string;
  hash: string;
  /** Why the fact failed validation; it is kept but never used as a value. */
  quarantine?: string;
}

export type AttrType = 'number' | 'hours' | 'boolean' | 'string' | 'enum' | 'json' | 'intervals';

export interface AttributeDef {
  key: string;
  type: AttrType;
  unit?: string;
  enum?: string[];
  min?: number;
  max?: number;
  /** Which value is worse when sources disagree: 'higher' (e.g. an ETA), 'lower' (e.g. fuel), or an enum order worst-first. */
  worse?: 'higher' | 'lower' | string[];
  /** Reports older than this (hours) are stale. */
  maxAgeH?: number;
  /** Sources disagreeing within this many hours of each other count as contradictory. */
  conflictWindowH?: number;
  tolerance?: number;
  /** Conservative value used when nothing valid is reported. */
  assumed?: unknown;
  /** No fact simply means "nothing to report" (no casualty, no unavailability): not flagged missing. */
  absentMeansNone?: boolean;
  description: string;
  citation?: Citation;
}

export class AttributeRegistry {
  private defs = new Map<string, AttributeDef>();
  register(d: AttributeDef): void {
    if (this.defs.has(d.key)) throw new Error(`attribute ${d.key} already registered`);
    this.defs.set(d.key, d);
  }
  get(key: string): AttributeDef | undefined {
    return this.defs.get(key);
  }
  list(): AttributeDef[] {
    return [...this.defs.values()];
  }
}

export function validate(def: AttributeDef | undefined, v: unknown): string | undefined {
  if (!def) return undefined;
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  switch (def.type) {
    case 'number':
    case 'hours':
      if (!num(v)) return `expected a number, got ${JSON.stringify(v)}`;
      if (def.min !== undefined && (v as number) < def.min) return `${v} is below the minimum ${def.min}`;
      if (def.max !== undefined && (v as number) > def.max) return `${v} is above the maximum ${def.max}`;
      return undefined;
    case 'boolean':
      return typeof v === 'boolean' ? undefined : `expected true/false, got ${JSON.stringify(v)}`;
    case 'string':
      return typeof v === 'string' && v.length ? undefined : 'expected a non-empty string';
    case 'enum':
      return typeof v === 'string' && def.enum?.includes(v) ? undefined : `expected one of ${def.enum?.join('/')}, got ${JSON.stringify(v)}`;
    case 'intervals':
      return Array.isArray(v) && v.every((x) => Array.isArray(x) && x.length === 2 && x.every((y) => typeof y === 'number') && x[1] >= x[0])
        ? undefined
        : 'expected [[start, end], ...]';
    case 'json':
      return v === undefined ? 'missing value' : undefined;
  }
}

export interface Resolved<T = unknown> {
  value: T | undefined;
  fact?: Fact;
  flags: QualityFlag[];
  alternatives: Fact[];
  quarantined: Fact[];
  ageH?: number;
  note?: string;
}

export interface HealthItem {
  entity: string;
  attr: string;
  flags: QualityFlag[];
  note: string;
  facts: string[];
}

function contentId(f: FactInput): string {
  return sha256(canonical({
    entity: f.entity, attr: f.attr, value: f.value, unit: f.unit, scope: f.scope ?? 'global', source: f.source,
    observedAt: f.observedAt, validFrom: f.validFrom, validTo: f.validTo, recordedAt: f.recordedAt,
    recordedBy: f.recordedBy, reason: f.reason, origin: f.origin,
  })).slice(0, 24);
}

const GENESIS = '0'.repeat(64);

export interface MergeReport {
  added: number;
  duplicates: number;
  /** (entity/attr) keys that now resolve as contradictory because both sides reported. */
  contested: string[];
}

export class FactLog {
  private facts: Fact[] = [];
  private ids = new Set<string>();

  constructor(readonly attrs: AttributeRegistry, readonly origin = 'local') {}

  append(input: FactInput): Fact {
    const withOrigin: FactInput = { ...input, origin: input.origin ?? this.origin, scope: input.scope ?? 'global' };
    const id = contentId(withOrigin);
    const existing = this.facts.find((f) => f.id === id);
    if (existing) return existing;
    const prevHash = this.facts.length ? this.facts[this.facts.length - 1].hash : GENESIS;
    const quarantine = validate(this.attrs.get(input.attr), input.value);
    const fact: Fact = { ...withOrigin, id, seq: this.facts.length, prevHash, hash: sha256(prevHash + id), ...(quarantine ? { quarantine } : {}) };
    this.facts.push(fact);
    this.ids.add(id);
    return fact;
  }

  appendMany(inputs: FactInput[]): Fact[] {
    return inputs.map((i) => this.append(i));
  }

  all(): readonly Fact[] {
    return this.facts;
  }

  size(): number {
    return this.facts.length;
  }

  head(): string {
    return this.facts.length ? this.facts[this.facts.length - 1].hash : GENESIS;
  }

  verify(): { ok: boolean; brokenAt?: number } {
    let prev = GENESIS;
    for (let i = 0; i < this.facts.length; i++) {
      const f = this.facts[i];
      const { id: _id, seq: _seq, prevHash: _p, hash: _h, quarantine: _q, ...content } = f;
      if (f.prevHash !== prev || contentId(content) !== f.id || sha256(prev + f.id) !== f.hash) return { ok: false, brokenAt: i };
      prev = f.hash;
    }
    return { ok: true };
  }

  view(asOf: number): FactView {
    return new FactView(this, asOf);
  }

  /** Union with another log (e.g. ship ⇄ shore after a disconnect). Nothing is overwritten. */
  merge(other: FactLog): MergeReport {
    let added = 0;
    let duplicates = 0;
    const keys = new Set<string>();
    const incoming = other.all().slice().sort((a, b) => a.recordedAt - b.recordedAt || a.seq - b.seq);
    for (const f of incoming) {
      if (this.ids.has(f.id)) {
        duplicates++;
        continue;
      }
      const { id: _i, seq: _s, prevHash: _p, hash: _h, quarantine: _q, ...content } = f;
      this.append(content);
      keys.add(`${f.entity}/${f.attr}`);
      added++;
    }
    const latest = Math.max(...this.facts.map((f) => f.recordedAt));
    const v = this.view(latest);
    const contested = [...keys].filter((k) => {
      const [entity, attr] = k.split('/');
      return v.get(entity, attr).flags.includes('contradictory');
    });
    return { added, duplicates, contested };
  }

  toJSONL(): string {
    return this.facts.map((f) => canonical(f)).join('\n');
  }

  static fromJSONL(text: string, attrs: AttributeRegistry, origin = 'local'): FactLog {
    const log = new FactLog(attrs, origin);
    const revive = (x: unknown): unknown => {
      if (x === 'Infinity') return Infinity;
      if (x === '-Infinity') return -Infinity;
      if (Array.isArray(x)) return x.map(revive);
      if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, revive(v)]));
      return x;
    };
    for (const line of text.split('\n').filter(Boolean)) {
      const f = revive(JSON.parse(line)) as Fact;
      const { id: _i, seq: _s, prevHash: _p, hash: _h, quarantine: _q, ...content } = f;
      log.append(content);
    }
    return log;
  }
}

function newer(a: Fact, b: Fact): boolean {
  return a.observedAt > b.observedAt || (a.observedAt === b.observedAt && (a.recordedAt > b.recordedAt || (a.recordedAt === b.recordedAt && a.seq > b.seq)));
}

function differs(a: unknown, b: unknown, tol = 1e-6): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) > tol;
  return canonical(a) !== canonical(b);
}

export interface GetOpts {
  /** Scope precedence, most specific first. Default ['global']. */
  scopes?: string[];
  /** Valid time to read at (for states and plans with validFrom/validTo). */
  at?: number;
}

/** Everything known as of a moment. Every read is logged so data health covers exactly what was used. */
export class FactView {
  private touched = new Map<string, HealthItem>();

  constructor(private readonly log: FactLog, readonly asOf: number) {}

  private known(): Fact[] {
    return this.log.all().filter((f) => f.recordedAt <= this.asOf + 1e-9);
  }

  facts(entity: string, attr: string): Fact[] {
    return this.known().filter((f) => f.entity === entity && f.attr === attr);
  }

  get<T = unknown>(entity: string, attr: string, opts: GetOpts = {}): Resolved<T> {
    const def = this.log.attrs.get(attr);
    const all = this.facts(entity, attr).filter((f) => opts.at === undefined || ((f.validFrom ?? -Infinity) <= opts.at && opts.at < (f.validTo ?? Infinity)));
    const quarantined = all.filter((f) => f.quarantine);
    const valid = all.filter((f) => !f.quarantine);
    const scopes = opts.scopes ?? ['global'];
    let pool: Fact[] = [];
    for (const s of scopes) {
      pool = valid.filter((f) => (f.scope ?? 'global') === s);
      if (pool.length) break;
    }
    const flags: QualityFlag[] = [];
    const note: string[] = [];
    let out: Resolved<T>;
    if (!pool.length && def?.absentMeansNone && !quarantined.length) {
      return { value: undefined, flags: [], alternatives: [], quarantined: [] };
    }
    if (!pool.length) {
      flags.push('missing');
      if (def?.assumed !== undefined) {
        flags.push('assumed');
        note.push(`not reported; conservative default ${JSON.stringify(def.assumed)}`);
        out = { value: def.assumed as T, flags, alternatives: [], quarantined };
      } else {
        note.push('not reported');
        out = { value: undefined, flags, alternatives: [], quarantined };
      }
    } else {
      const bySystem = new Map<string, Fact>();
      for (const f of pool) {
        const cur = bySystem.get(f.source.system);
        if (!cur || newer(f, cur)) bySystem.set(f.source.system, f);
      }
      const heads = [...bySystem.values()];
      const primary = heads.reduce((a, b) => (newer(b, a) ? b : a));
      const window = def?.conflictWindowH ?? def?.maxAgeH ?? 24;
      const disagree = heads.filter((f) => f !== primary && differs(f.value, primary.value, def?.tolerance) && f.observedAt >= primary.observedAt - window);
      let chosen = primary;
      if (disagree.length) {
        flags.push('contradictory');
        const cands = [primary, ...disagree];
        const w = def?.worse;
        if (w === 'higher') chosen = cands.reduce((a, b) => ((b.value as number) > (a.value as number) ? b : a));
        else if (w === 'lower') chosen = cands.reduce((a, b) => ((b.value as number) < (a.value as number) ? b : a));
        else if (Array.isArray(w)) chosen = cands.reduce((a, b) => (w.indexOf(String(b.value)) >= 0 && w.indexOf(String(b.value)) < w.indexOf(String(a.value)) ? b : a));
        note.push(`${cands.map((c) => `${c.source.system}=${JSON.stringify(c.value)}`).join(' vs ')}; using ${chosen.source.system}${w ? ' (worse value)' : ' (newest)'}`);
      }
      const ageH = this.asOf - chosen.observedAt;
      if (def?.maxAgeH !== undefined && ageH > def.maxAgeH) {
        flags.push('stale');
        note.push(`last report ${ageH.toFixed(1)} h old (limit ${def.maxAgeH} h)`);
      }
      const alternatives = disagree.length ? [primary, ...disagree].filter((f) => f !== chosen) : [];
      out = { value: chosen.value as T, fact: chosen, flags, alternatives, quarantined, ageH };
    }
    const newestQ = quarantined.reduce<Fact | undefined>((a, b) => (!a || newer(b, a) ? b : a), undefined);
    if (newestQ && (!out.fact || newer(newestQ, out.fact))) {
      flags.push('malformed');
      note.push(`newest record quarantined (${newestQ.source.system}: ${newestQ.quarantine})`);
    }
    out.flags = [...new Set(flags)];
    out.note = note.join('; ') || undefined;
    if (out.flags.length) {
      this.touched.set(`${entity}/${attr}`, {
        entity, attr, flags: out.flags, note: out.note ?? '',
        facts: [...(out.fact ? [out.fact.id] : []), ...out.alternatives.map((a) => a.id), ...quarantined.map((q) => q.id)],
      });
    }
    return out;
  }

  /** Valid facts in valid-time order, one per (time, source) with corrections applied. */
  history(entity: string, attr: string): Fact[] {
    const valid = this.facts(entity, attr).filter((f) => !f.quarantine);
    const byKey = new Map<string, Fact>();
    for (const f of valid) {
      const k = `${f.validFrom ?? f.observedAt}|${f.source.system}`;
      const cur = byKey.get(k);
      if (!cur || f.recordedAt > cur.recordedAt || (f.recordedAt === cur.recordedAt && f.seq > cur.seq)) byKey.set(k, f);
    }
    return [...byKey.values()].sort((a, b) => (a.validFrom ?? a.observedAt) - (b.validFrom ?? b.observedAt) || a.recordedAt - b.recordedAt);
  }

  entities(attr: string): string[] {
    return [...new Set(this.known().filter((f) => f.attr === attr).map((f) => f.entity))];
  }

  /** Data-health items for every read that came back with a quality flag. */
  health(): HealthItem[] {
    return [...this.touched.values()];
  }

  /** Add a derived health item (e.g. a pack quality rule). */
  flag(item: HealthItem): void {
    this.touched.set(`${item.entity}/${item.attr}`, item);
  }
}
