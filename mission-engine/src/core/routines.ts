import { sha256 } from './hash';
import type { Citation } from './provenance';

/**
 * Routines are the leaf math of the engine (fuel burn, transit time, a range
 * check). Combining logic lives in declarative graph nodes; routines only turn
 * numbers into numbers. Each routine:
 *   - is plain, auditable source code (its text is stored and shown to users),
 *   - is versioned by a hash of that source and its declaration,
 *   - must return the contract below (value or pass/fail, units, what bound it),
 *   - declares how its output moves with each input (monotonicity), and
 *   - carries test cases the registry runs before the routine is trusted.
 */
export type RoutineArg = number | string | boolean | null | readonly number[] | { readonly [k: string]: unknown };

export type Monotone = 'increasing' | 'decreasing' | 'none';

export interface RoutineInputDecl {
  type: 'number' | 'string' | 'boolean' | 'number[]' | 'json';
  unit?: string;
  /** How the output (value, or margin for checks) moves when this input increases. */
  monotone?: Monotone;
  description?: string;
}

export interface RoutineResult {
  /** Value routines: the computed number (null when it cannot be computed). */
  value?: number | null;
  /** Check routines: pass or fail. */
  passed?: boolean;
  /** Quantity margin in the output unit (how far from the limit). */
  margin?: number;
  unit?: string;
  /** Names of the inputs that determined the result. */
  binding?: string[];
  /** Plain-language explanation of the calculation with the numbers used. */
  detail: string;
  /** Raised when an input was outside the factor table and was clamped. */
  extrapolated?: boolean;
}

export interface RoutineTest {
  name: string;
  inputs: Record<string, RoutineArg>;
  expect: { value?: number; passed?: boolean; tolerance?: number };
}

export interface RoutineDef {
  id: string;
  title: string;
  description: string;
  kind: 'value' | 'check';
  inputs: Record<string, RoutineInputDecl>;
  output: { unit: string; description?: string };
  tables?: string[];
  citations?: Citation[];
  fn: (inputs: Record<string, any>) => RoutineResult;
  tests: RoutineTest[];
}

export interface RegisteredRoutine extends RoutineDef {
  pack: string;
  version: string;
  source: string;
}

export interface RoutineRun {
  routine: string;
  version: string;
  inputs: Record<string, RoutineArg>;
  result: RoutineResult;
  contractErrors: string[];
}

export interface RoutineVerification {
  routine: string;
  version: string;
  tests: { name: string; ok: boolean; got?: RoutineResult; error?: string }[];
  monotonicity: { input: string; declared: Monotone; ok: boolean; note?: string }[];
  ok: boolean;
}

export function contractErrors(def: RoutineDef, r: RoutineResult): string[] {
  const errs: string[] = [];
  if (!r || typeof r !== 'object') return ['routine did not return an object'];
  if (typeof r.detail !== 'string' || r.detail.length === 0) errs.push('missing detail string');
  if (def.kind === 'value' && !(typeof r.value === 'number' || r.value === null)) errs.push('value routine must return value: number | null');
  if (def.kind === 'check' && typeof r.passed !== 'boolean') errs.push('check routine must return passed: boolean');
  if (r.unit !== undefined && r.unit !== def.output.unit) errs.push(`unit ${r.unit} does not match declared ${def.output.unit}`);
  if (r.margin !== undefined && typeof r.margin !== 'number') errs.push('margin must be a number');
  if (typeof r.value === 'number' && !Number.isFinite(r.value)) errs.push('value must be finite');
  if (r.binding) for (const b of r.binding) if (!(b in def.inputs)) errs.push(`binding names unknown input ${b}`);
  return errs;
}

function scoreOf(def: RoutineDef, r: RoutineResult): number {
  if (def.kind === 'value') return typeof r.value === 'number' ? r.value : NaN;
  if (typeof r.margin === 'number') return r.margin;
  return r.passed ? 1 : 0;
}

export class RoutineRegistry {
  private defs = new Map<string, RegisteredRoutine>();

  register(def: RoutineDef, pack: string): RegisteredRoutine {
    if (this.defs.has(def.id)) throw new Error(`routine ${def.id} already registered`);
    const source = def.fn.toString();
    const version = sha256(JSON.stringify({ id: def.id, source, inputs: def.inputs, output: def.output, kind: def.kind })).slice(0, 16);
    const reg: RegisteredRoutine = { ...def, pack, version, source };
    this.defs.set(def.id, reg);
    return reg;
  }

  get(id: string): RegisteredRoutine {
    const d = this.defs.get(id);
    if (!d) throw new Error(`unknown routine ${id}`);
    return d;
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }

  list(): RegisteredRoutine[] {
    return [...this.defs.values()];
  }

  run(id: string, inputs: Record<string, RoutineArg>): RoutineRun {
    const def = this.get(id);
    let result: RoutineResult;
    try {
      result = def.fn(inputs);
    } catch (e) {
      result = { value: null, passed: false, detail: `routine threw: ${(e as Error).message}` };
      return { routine: id, version: def.version, inputs, result, contractErrors: ['routine threw'] };
    }
    return { routine: id, version: def.version, inputs, result, contractErrors: contractErrors(def, result) };
  }

  /** Run declared tests and property-check declared monotonicity around each test point. */
  verify(id: string): RoutineVerification {
    const def = this.get(id);
    const tests = def.tests.map((t) => {
      const run = this.run(id, t.inputs);
      if (run.contractErrors.length) return { name: t.name, ok: false, got: run.result, error: run.contractErrors.join('; ') };
      const tol = t.expect.tolerance ?? 1e-6;
      let ok = true;
      if (t.expect.value !== undefined) ok = ok && typeof run.result.value === 'number' && Math.abs(run.result.value - t.expect.value) <= tol;
      if (t.expect.passed !== undefined) ok = ok && run.result.passed === t.expect.passed;
      return { name: t.name, ok, got: run.result };
    });
    const monotonicity: RoutineVerification['monotonicity'] = [];
    for (const [name, decl] of Object.entries(def.inputs)) {
      if (decl.type !== 'number' || !decl.monotone || decl.monotone === 'none') continue;
      let ok = true;
      let note: string | undefined;
      for (const t of def.tests) {
        const base = t.inputs[name];
        if (typeof base !== 'number') continue;
        let prev = scoreOf(def, this.run(id, t.inputs).result);
        for (const step of [0.01, 0.1, 1, 10]) {
          const bumped = { ...t.inputs, [name]: base + Math.max(step, Math.abs(base) * step) };
          const cur = scoreOf(def, this.run(id, bumped).result);
          if (Number.isNaN(cur) || Number.isNaN(prev)) continue;
          const bad = decl.monotone === 'increasing' ? cur < prev - 1e-9 : cur > prev + 1e-9;
          if (bad) {
            ok = false;
            note = `test "${t.name}": ${name}=${bumped[name]} moved output the wrong way`;
            break;
          }
          prev = cur;
        }
        if (!ok) break;
      }
      monotonicity.push({ input: name, declared: decl.monotone, ok, note });
    }
    return {
      routine: id,
      version: def.version,
      tests,
      monotonicity,
      ok: tests.length > 0 && tests.every((t) => t.ok) && monotonicity.every((m) => m.ok),
    };
  }

  verifyAll(): RoutineVerification[] {
    return this.list().map((d) => this.verify(d.id));
  }
}
