/**
 * JSON with ±Infinity and NaN spelled out as strings, shared by server and
 * browser. JSON has no infinity; sending null would erase the difference
 * between "nothing limits this" and "this never happens".
 */
export function encode(v: unknown): string {
  return JSON.stringify(v, wireReplacer);
}

export function revive<T = unknown>(x: unknown): T {
  if (x === 'Infinity') return Infinity as T;
  if (x === '-Infinity') return -Infinity as T;
  if (x === 'NaN') return NaN as T;
  if (Array.isArray(x)) return x.map((y) => revive(y)) as T;
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, revive(v)])) as T;
  return x as T;
}

/** JSON.stringify replacer: unbounded numbers travel as "Infinity" / "-Infinity", never as null. */
export function wireReplacer(_k: string, x: unknown): unknown {
  return typeof x === 'number' && !Number.isFinite(x) ? (Number.isNaN(x) ? 'NaN' : x > 0 ? 'Infinity' : '-Infinity') : x;
}
