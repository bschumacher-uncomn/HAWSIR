import { attributeRequirement } from './attribution';
import { hashOf } from './hash';
import {
  ALWAYS,
  NEVER,
  between,
  complement,
  contains,
  covering,
  coveringWindow,
  firstFrom,
  from,
  intersect,
  intersectAll,
  kOfN,
  measure,
  nextAfter,
  normalize,
  shift,
  union,
  type Timeline,
} from './intervals';
import { simulateLedger, thresholdTimeline, valueAt, type BurnSegment, type LedgerTransfer, type SeriesPoint } from './ledger';
import type { RoutineArg, RoutineRegistry } from './routines';
import {
  UNCERTAIN_FLAGS,
  depsOf,
  isRef,
  timelineDeps,
  type EngineResult,
  type GraphSpec,
  type Num,
  type NodeResult,
  type NodeSpec,
  type QualityFlag,
  type QuantityMargin,
  type Readiness,
  type RequirementNode,
  type RequirementResult,
  type RoutineInput,
} from './graph';
import { EPS } from './time';

export interface ComputeContext {
  now: number;
  routines: RoutineRegistry;
  /** Routine ids whose tests and monotonicity checks passed. Others are flagged unverified. */
  verified?: ReadonlySet<string>;
  /** Skip hashing (used by inner analysis loops). */
  hash?: boolean;
}

export type NodeMap = Record<string, NodeSpec>;

export function toMap(g: GraphSpec): NodeMap {
  const m: NodeMap = {};
  for (const n of g.nodes) m[n.id] = n;
  return m;
}

export function topoOrder(nodes: NodeMap, errors: string[]): string[] {
  const ids = Object.keys(nodes);
  const indeg: Record<string, number> = {};
  const out: Record<string, string[]> = {};
  for (const id of ids) {
    indeg[id] = 0;
    out[id] = [];
  }
  for (const id of ids) {
    for (const d of depsOf(nodes[id])) {
      if (!nodes[d]) {
        errors.push(`${id}: unknown dependency "${d}"`);
        continue;
      }
      indeg[id]++;
      out[d].push(id);
    }
  }
  const q = ids.filter((id) => indeg[id] === 0).sort();
  const order: string[] = [];
  while (q.length) {
    const id = q.shift()!;
    order.push(id);
    for (const nx of out[id]) if (--indeg[nx] === 0) q.push(nx);
  }
  if (order.length !== ids.length) {
    const stuck = ids.filter((id) => !order.includes(id));
    errors.push(`dependency cycle: ${stuck.join(', ')} excluded`);
  }
  return order;
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

export function compute(graph: GraphSpec, ctx: ComputeContext): EngineResult {
  const nodes = toMap(graph);
  const errors: string[] = [];
  const order = topoOrder(nodes, errors);
  const res: Record<string, NodeResult> = {};
  const now = ctx.now;
  const horizonEnd = graph.horizon[1];

  const num = (x: Num | null | undefined, flags: QualityFlag[]): number | null => {
    if (x === null || x === undefined) return null;
    if (typeof x === 'number') return x;
    const r = res[x.ref];
    if (!r) return null;
    for (const f of r.flags) if (UNCERTAIN_FLAGS.includes(f) && !flags.includes(f)) flags.push(f);
    return typeof r.value === 'number' ? r.value : null;
  };
  const tl = (id: string): Timeline => res[id]?.timeline ?? NEVER;
  const argOf = (inputs: Record<string, RoutineInput>, flags: QualityFlag[]) => {
    const out: Record<string, RoutineArg> = {};
    let missing = false;
    for (const [k, v] of Object.entries(inputs)) {
      if (isRef(v)) {
        const x = num(v, flags);
        if (x === null) missing = true;
        out[k] = x;
      } else out[k] = v as RoutineArg;
    }
    return { args: out, missing };
  };

  for (const id of order) {
    const n = nodes[id];
    const flags: QualityFlag[] = [...(n.flags ?? [])];
    const notes: string[] = [];
    let r: NodeResult;
    switch (n.kind) {
      case 'event': {
        let at = num(n.at, flags);
        if (at === null) {
          if (n.assumedAt !== undefined) {
            at = n.assumedAt;
            if (!flags.includes('missing')) flags.push('missing');
            if (!flags.includes('assumed')) flags.push('assumed');
            notes.push(`time not reported; using conservative assumption ${n.assumedAt}`);
          } else {
            if (!flags.includes('missing')) flags.push('missing');
            notes.push('time not reported and no conservative assumption is defined');
          }
        }
        const until = num(n.until ?? Infinity, flags) ?? Infinity;
        r = { id, kind: n.kind, timeline: at === null ? NEVER : between(at, until), flags, notes };
        break;
      }
      case 'window':
        r = { id, kind: n.kind, timeline: normalize(n.intervals), flags, notes };
        break;
      case 'person': {
        const base = from(n.from ?? -Infinity);
        const unavail = normalize((n.unavailable ?? []).map((u) => [u.start, u.end] as const));
        r = { id, kind: n.kind, timeline: intersect(base, complement(unavail)), flags, notes };
        break;
      }
      case 'all':
        r = { id, kind: n.kind, timeline: intersectAll(n.deps.map(tl)), flags, notes };
        break;
      case 'any':
        r = { id, kind: n.kind, timeline: union(...n.deps.map(tl)), flags, notes };
        break;
      case 'kofn': {
        const tls = n.deps.map(tl);
        const t = kOfN(tls, n.k);
        if (n.deps.length > n.k) {
          const exact = intersect(t, complement(kOfN(tls, n.k + 1)));
          if (measure(exact, now, horizonEnd) > EPS) {
            flags.push('no-redundancy');
            notes.push(`exactly ${n.k} of ${n.deps.length} available at times in the horizon: no spare`);
          }
        }
        r = { id, kind: n.kind, timeline: t, flags, notes };
        break;
      }
      case 'task': {
        const P = intersectAll(n.deps.map(tl));
        let d = num(n.duration, flags);
        if (d === null) {
          if (n.assumedDuration !== undefined) {
            d = n.assumedDuration;
            flags.push('missing', 'assumed');
            notes.push(`duration not reported; assuming ${n.assumedDuration} h`);
          } else {
            flags.push('missing');
            notes.push('duration not reported and no assumption defined');
            r = { id, kind: n.kind, timeline: NEVER, flags, notes };
            break;
          }
        }
        const notBefore = n.notBefore ?? -Infinity;
        const earliest = firstFrom(P, notBefore);
        if (!Number.isFinite(earliest) && earliest > 0) {
          r = { id, kind: n.kind, timeline: NEVER, flags, notes: [...notes, 'predecessors never available'] };
          break;
        }
        if (!n.crew) {
          const fin = earliest + d;
          r = { id, kind: n.kind, timeline: from(fin), start: earliest, finish: fin, flags, notes };
          break;
        }
        const pool = n.crew.pool.filter((p) => res[p]);
        const cands = new Set<number>([earliest]);
        for (const [s] of P) if (s > earliest) cands.add(s);
        for (const p of pool) for (const [s] of tl(p)) if (s > earliest) cands.add(s);
        let start = Infinity;
        let assigned: string[] = [];
        let availCount = 0;
        for (const c of [...cands].sort((a, b) => a - b)) {
          if (!contains(P, c)) continue;
          const avail = pool.filter((p) => coveringWindow(tl(p), c, c + d!));
          if (avail.length >= n.crew.k) {
            start = c;
            assigned = avail.slice(0, n.crew.k);
            availCount = avail.length;
            break;
          }
        }
        if (!Number.isFinite(start)) {
          r = {
            id, kind: n.kind, timeline: NEVER, flags,
            notes: [...notes, `fewer than ${n.crew.k} qualified (${n.crew.label ?? 'crew'}) available for ${d} h`],
            crew: { need: n.crew.k, assigned: [], waitedFor: [] },
          };
          break;
        }
        const waitedFor = start > earliest + EPS ? assigned.filter((p) => !coveringWindow(tl(p), earliest, earliest + d!)) : [];
        if (availCount === n.crew.k && pool.length > n.crew.k) {
          flags.push('no-redundancy');
          notes.push(`exactly ${n.crew.k} qualified available: no spare`);
        }
        const fin = start + d;
        r = { id, kind: n.kind, timeline: from(fin), start, finish: fin, flags, notes, crew: { need: n.crew.k, assigned, waitedFor } };
        break;
      }
      case 'gate': {
        const P = intersectAll(n.deps.map(tl));
        const ready = P.length ? P[0][0] : Infinity;
        let best = Infinity;
        let chosen: NodeResult['slot'];
        for (const s of n.slots) {
          if (s.enabled === false) {
            notes.push(`slot ${s.label} unavailable${s.disabledReason ? `: ${s.disabledReason}` : ''}`);
            continue;
          }
          const lag = num(s.lag ?? 0, flags);
          if (lag === null) {
            notes.push(`slot ${s.label}: transit time unknown`);
            continue;
          }
          if ((n.mode ?? 'depart') === 'depart') {
            const dep = firstFrom(P, Math.max(ready, s.start));
            if (!Number.isFinite(dep) || dep > s.end + EPS) continue;
            const del = dep + lag;
            if (del < best) {
              best = del;
              chosen = { id: s.id, waited: s.start > ready + EPS, depart: dep, lag };
            }
          } else {
            const arr = ready + lag;
            if (!Number.isFinite(arr) || arr > s.end + EPS) continue;
            const del = Math.max(arr, s.start);
            if (del < best) {
              best = del;
              chosen = { id: s.id, waited: s.start > arr + EPS, depart: del - lag, lag };
            }
          }
        }
        if (!Number.isFinite(best)) notes.push('no usable slot after the item is ready');
        r = { id, kind: n.kind, timeline: Number.isFinite(best) ? from(best) : NEVER, flags, notes, slot: chosen };
        break;
      }
      case 'delay': {
        const lag = num(n.lag, flags);
        if (lag === null) {
          flags.push('missing');
          r = { id, kind: n.kind, timeline: NEVER, flags, notes: ['transit time unknown'] };
        } else r = { id, kind: n.kind, timeline: shift(tl(n.dep), lag), flags, notes };
        break;
      }
      case 'stock': {
        let v0 = num(n.initial, flags);
        if (v0 === null) {
          if (n.assumedInitial !== undefined) {
            v0 = n.assumedInitial;
            flags.push('missing', 'assumed');
            notes.push(`level not reported; assuming ${n.assumedInitial} ${n.unit}`);
          } else {
            flags.push('missing');
            r = { id, kind: n.kind, unit: n.unit, series: [], finalRate: 0, flags, notes: ['level not reported'] };
            break;
          }
        }
        const segs: BurnSegment[] = n.burns.map((b) => {
          const rate = num(b.rate, flags);
          if (rate === null) notes.push(`${b.label}: rate unknown, treated as 0`);
          return { from: b.from, to: b.to, rate: rate ?? 0, label: b.label, source: isRef(b.rate) ? b.rate.ref : undefined };
        });
        const xfers: LedgerTransfer[] = [];
        for (const x of n.transfers) {
          let at: number;
          let source: string | undefined;
          if (typeof x.at === 'number') at = x.at;
          else {
            source = x.at.node;
            const t = tl(x.at.node);
            at = t.length ? t[0][0] : Infinity;
          }
          if (!Number.isFinite(at)) {
            if (at === Infinity) {
              flags.push('transfer-skipped');
              notes.push(`${x.label}: does not happen in the horizon`);
            }
            continue;
          }
          xfers.push({ id: x.id, at, kind: x.kind, amount: num(x.amount ?? 0, flags) ?? 0, level: num(x.level ?? null, flags) ?? undefined, label: x.label, source });
        }
        const cap = num(n.capacity ?? null, flags);
        const led = simulateLedger({ t0: n.t0, v0, capacity: cap ?? undefined, floor: n.floor, segments: segs, transfers: xfers, end: horizonEnd });
        if (n.transfers.some((x) => x.kind === 'topoff' || x.kind === 'toLevel') || led.clipped) {
          if (!flags.includes('non-monotone')) flags.push('non-monotone');
        }
        if (led.short) notes.push('an expenditure exceeded the quantity on hand');
        if (led.emptyAt !== undefined) notes.push(`reaches ${n.floor ?? 0} ${n.unit} at ${led.emptyAt.toFixed(1)}`);
        r = { id, kind: n.kind, unit: n.unit, series: led.points, finalRate: led.finalRate, applied: led.applied, flags, notes };
        break;
      }
      case 'threshold': {
        const s = res[n.stock];
        const level = num(n.level, flags);
        for (const f of s?.flags ?? []) if (!flags.includes(f) && (UNCERTAIN_FLAGS.includes(f) || f === 'non-monotone')) flags.push(f);
        if (!s?.series?.length || level === null) {
          r = { id, kind: n.kind, timeline: NEVER, flags, notes: ['stock or level unknown'] };
          break;
        }
        r = { id, kind: n.kind, timeline: thresholdTimeline(s.series, level, s.finalRate ?? 0), value: level, unit: s.unit, flags, notes };
        break;
      }
      case 'scalar': {
        let v = n.value;
        if (v === null || v === undefined) {
          if (n.assumed !== undefined) {
            v = n.assumed;
            flags.push('missing', 'assumed');
          } else flags.push('missing');
        }
        r = { id, kind: n.kind, value: v ?? null, unit: n.unit, flags, notes };
        break;
      }
      case 'routine':
      case 'check': {
        const { args, missing } = argOf(n.inputs, flags);
        if (missing) {
          if (!flags.includes('missing')) flags.push('missing');
          r = n.kind === 'check'
            ? { id, kind: n.kind, timeline: NEVER, check: { passed: false, detail: 'an input is missing' }, flags, notes: ['an input is missing'] }
            : { id, kind: n.kind, value: null, flags, notes: ['an input is missing'] };
          break;
        }
        const run = ctx.routines.run(n.routine, args);
        if (run.contractErrors.length) {
          flags.push('routine-contract');
          notes.push(...run.contractErrors);
        }
        if (ctx.verified && !ctx.verified.has(n.routine)) flags.push('unverified-routine');
        if (run.result.extrapolated) flags.push('extrapolated');
        const routineRun = { routine: run.routine, version: run.version, inputs: run.inputs, result: run.result };
        if (n.kind === 'check') {
          const passed = run.result.passed === true;
          r = {
            id, kind: n.kind, timeline: passed ? ALWAYS : NEVER, flags, notes,
            check: { passed, margin: run.result.margin, detail: run.result.detail }, routineRun,
          };
        } else {
          const v = run.result.value;
          r = { id, kind: n.kind, value: typeof v === 'number' ? v : null, unit: ctx.routines.get(n.routine).output.unit, flags, notes, routineRun };
        }
        break;
      }
      case 'requirement': {
        r = evalRequirement(n, nodes, res, now, graph.qMargin ?? 12, num, flags, notes);
        break;
      }
    }
    res[id] = r!;
  }

  const requirements: Record<string, RequirementResult> = {};
  for (const id of order) {
    const n = nodes[id];
    if (n.kind !== 'requirement') continue;
    const rr = res[id] as RequirementResult;
    attributeRequirement(rr, nodes, res);
    finishStatus(rr, n, nodes, res);
    requirements[id] = rr;
  }

  return {
    graphId: graph.id,
    graphHash: ctx.hash === false ? '' : hashOf(graph),
    now,
    horizon: graph.horizon,
    nodes: res,
    requirements,
    order,
    errors,
  };
}

function evalRequirement(
  n: RequirementNode,
  nodes: NodeMap,
  res: Record<string, NodeResult>,
  now: number,
  defaultQ: number,
  num: (x: Num | null | undefined, flags: QualityFlag[]) => number | null,
  flags: QualityFlag[],
  notes: string[],
): RequirementResult {
  const P = intersectAll(n.deps.map((d) => res[d]?.timeline ?? NEVER));
  const rs = num(n.window.start, flags) ?? now;
  let re = num(n.window.end, flags) ?? rs;
  if (re <= rs) re = rs + 1e-6;
  const I = covering(P, rs);
  let lead: number;
  let tail: number;
  let cover = I;
  if (I) {
    lead = I[0] <= now + EPS ? Infinity : rs - I[0];
    tail = I[1] === Infinity ? Infinity : I[1] - re;
  } else {
    const J = nextAfter(P, rs);
    cover = J;
    if (J) {
      lead = rs - J[0];
      tail = J[1] === Infinity ? Infinity : J[1] - re;
    } else {
      lead = -Infinity;
      tail = -Infinity;
    }
  }
  const margin = Math.min(lead, tail);
  const bindingEdge: RequirementResult['bindingEdge'] = margin === Infinity ? 'none' : lead <= tail ? 'lead' : 'tail';
  const q = n.qMargin ?? defaultQ;
  let status: Readiness = margin < -EPS ? 'N' : margin < q ? 'Q' : 'Y';
  const reasons: string[] = [];
  if (status === 'N') reasons.push(margin === -Infinity ? 'not available at any time after the need' : 'misses the window');
  if (status === 'Q' && margin >= 0) reasons.push(`margin below the ${q} h threshold`);

  const quantity: QuantityMargin[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const s = nodes[id];
    if (!s) return;
    if (s.kind === 'threshold') {
      const st = res[s.stock];
      const lvl = res[id]?.value;
      if (st?.series?.length && typeof lvl === 'number') {
        const low = lowPoint(st.series, rs, re, st.finalRate ?? 0);
        const qm: QuantityMargin = { threshold: id, stock: s.stock, unit: st.unit ?? '', level: lvl, minInWindow: low.v, minAt: low.t, margin: low.v - lvl };
        if (qm.margin >= 0 && low.rate > 1e-9) qm.hours = qm.margin / low.rate;
        quantity.push(qm);
      }
    }
    if (s.kind === 'requirement' && id !== n.id) return; // sub-requirements report their own
    for (const d of timelineDeps(s)) walk(d);
  };
  walk(n.id);

  let finalMargin = margin;
  let edge: RequirementResult['bindingEdge'] = bindingEdge;
  let stockBinding: RequirementResult['stockBinding'];
  for (const q of quantity) {
    if (q.hours !== undefined && q.hours < finalMargin - EPS) {
      finalMargin = q.hours;
      edge = 'stock';
      stockBinding = { threshold: q.threshold, at: q.minAt, hours: q.hours };
    }
  }
  if (edge === 'stock') {
    status = finalMargin < q ? 'Q' : 'Y';
    if (status === 'Q') reasons.push(`a stock comes within ${finalMargin.toFixed(1)} h of its limit`);
  }
  return {
    id: n.id, kind: 'requirement', timeline: P, flags, notes,
    status, window: [rs, re], margin: finalMargin, lead, tail, upNow: contains(P, now), cover, bindingEdge: edge, stockBinding,
    quantity, chainFlags: [], reasons, controlling: null, secondary: null, leaves: [], chain: [],
  };
}

/** Lowest value of a series over [a, b) and the consumption rate just before it. */
function lowPoint(points: SeriesPoint[], a: number, b: number, finalRate: number): { t: number; v: number; rate: number } {
  const cands: { t: number; v: number }[] = [
    { t: a, v: valueAt(points, a, finalRate) },
    { t: b - 1e-6, v: valueAt(points, b - 1e-6, finalRate) },
  ];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.t <= a || p.t >= b) continue;
    // left limit at a jump: the value just before the transfer
    cands.push({ t: p.t, v: p.v });
  }
  let low = cands[0];
  for (const c of cands) if (c.v < low.v - 1e-9) low = c;
  const dt = 0.25;
  const before = valueAt(points, Math.max(a, low.t - dt), finalRate);
  const span = low.t - Math.max(a, low.t - dt);
  const rate = span > 1e-9 ? (before - low.v) / span : 0;
  return { t: low.t, v: low.v, rate };
}

/**
 * Nodes the requirement actually relies on over its window: every dependency of
 * all/kofn/task/gate/delay/threshold, but at an `any` only the alternatives that
 * are available during the window (an unused fallback does not taint the answer).
 */
function supportOf(id: string, nodes: NodeMap, res: Record<string, NodeResult>, a: number, b: number, out = new Set<string>()): Set<string> {
  if (out.has(id)) return out;
  const n = nodes[id];
  if (!n) return out;
  out.add(id);
  let deps = timelineDeps(n);
  if (n.kind === 'any') {
    const used = deps.filter((d) => coveringWindow(res[d]?.timeline ?? NEVER, a, b));
    deps = used.length ? used.slice(0, 1) : deps;
  }
  if (n.kind === 'task' && n.crew) deps = [...deps, ...(res[id]?.crew?.assigned ?? [])];
  for (const d of deps) supportOf(d, nodes, res, a, b, out);
  return out;
}

function finishStatus(rr: RequirementResult, n: RequirementNode, nodes: NodeMap, res: Record<string, NodeResult>) {
  const chainIds = new Set([...rr.chain, ...supportOf(n.id, nodes, res, rr.window[0], rr.window[1])]);
  // scalar inputs used on the chain carry their own flags
  for (const id of [...chainIds]) {
    const spec = nodes[id];
    if (!spec) continue;
    for (const d of depsOf(spec)) if (nodes[d]?.kind === 'scalar' || nodes[d]?.kind === 'routine') chainIds.add(d);
  }
  const cf = uniq([...chainIds].flatMap((id) => res[id]?.flags ?? []));
  rr.chainFlags = cf;
  const uncertain = cf.filter((f) => UNCERTAIN_FLAGS.includes(f));
  if (rr.status === 'N' && rr.margin === -Infinity && cf.includes('missing') && !cf.includes('assumed')) {
    rr.status = 'UNK';
    rr.reasons.push('cannot be determined: required information is missing with no conservative assumption');
  }
  if (rr.status === 'Y' && uncertain.length) {
    rr.status = 'Q';
    rr.reasons.push(`depends on ${uncertain.join(', ')} information`);
  }
  if (rr.status === 'Y' && cf.includes('degraded')) {
    rr.status = 'Q';
    rr.reasons.push('depends on degraded equipment');
  }
  if (n.reported) {
    const rep = n.reported.status;
    if (rep !== rr.status && !(rep === 'Q' && rr.status === 'Y')) {
      rr.flags.push('reported-mismatch');
      rr.reasons.push(`${n.reported.system} reports ${rep} (as of t=${n.reported.observedAt}); engine computes ${rr.status}`);
    }
  }
}
