import { contains, fallsAt, firstFrom, risesAt, NEVER, type Timeline } from './intervals';
import { isRef, type Cause, type NodeResult, type NodeSpec, type RequirementResult, type Num } from './graph';
import { fmtDur } from './time';

/**
 * Controlling-constraint attribution. Given an edge of a node's availability
 * (it came up at t, went down at t, or never comes up), walk back to the
 * upstream nodes whose own edges produced it. The leaves of that walk are the
 * controlling constraints: an input time, a person, a slot, a duration, a stock
 * burning down, a missing value.
 */
type Nodes = Record<string, NodeSpec>;
type Results = Record<string, NodeResult>;

const f1 = (t: number) => (Number.isFinite(t) ? `t=${(Math.round(t * 100) / 100).toString()}` : t > 0 ? 'never' : 'always');

function tlOf(res: Results, id: string): Timeline {
  return res[id]?.timeline ?? NEVER;
}

function valueChild(nodes: Nodes, res: Results, x: Num | null | undefined, at: number, depth: number, seen: Set<string>): Cause[] {
  if (!isRef(x)) return [];
  return [explain(nodes, res, x.ref, 'value', at, depth + 1, seen)];
}

export function explain(nodes: Nodes, res: Results, id: string, edge: Cause['edge'], at: number, depth = 0, seen = new Set<string>()): Cause {
  const n = nodes[id];
  const r = res[id];
  const base: Cause = { node: id, label: n?.label ?? id, edge, at, why: '', children: [] };
  if (!n || !r || depth > 64) return { ...base, terminal: 'unreachable', why: 'explanation depth exceeded' };
  const key = `${id}|${edge}|${at}`;
  if (seen.has(key)) return { ...base, why: `${n.label} (see above)` };
  seen.add(key);
  const kids = (ids: string[], e: Cause['edge'], t: number) => ids.map((d) => explain(nodes, res, d, e, t, depth + 1, seen));
  const missing = r.flags.includes('missing');

  switch (n.kind) {
    case 'scalar':
      return { ...base, edge: 'value', terminal: missing ? 'missing' : 'value', why: `${n.label} = ${r.value ?? 'unknown'} ${n.unit}${r.flags.includes('assumed') ? ' (assumed)' : ''}` };
    case 'routine': {
      const ins = Object.values(n.inputs).filter(isRef).map((x) => explain(nodes, res, x.ref, 'value', at, depth + 1, seen));
      return { ...base, edge: 'value', terminal: missing ? 'missing' : 'value', why: r.routineRun?.result.detail ?? `${n.label} = ${r.value}`, children: ins };
    }
    case 'event': {
      const why = edge === 'rise'
        ? `${n.label} at ${f1(at)}${r.flags.includes('assumed') ? ' (assumed, not reported)' : ''}`
        : edge === 'fall'
          ? `${n.label} ends at ${f1(at)}`
          : `${n.label}: ${missing ? 'not reported' : 'never in the horizon'}`;
      return { ...base, terminal: missing && !r.flags.includes('assumed') ? 'missing' : 'input-time', why, children: valueChild(nodes, res, n.at, at, depth, seen) };
    }
    case 'window':
      return {
        ...base, terminal: 'window',
        why: edge === 'rise' ? `${n.label} opens at ${f1(at)}` : edge === 'fall' ? `${n.label} closes at ${f1(at)}` : `${n.label} is not open after ${f1(at)}`,
      };
    case 'person': {
      const ends = (n.unavailable ?? []).find((u) => Math.abs(u.end - at) < 1e-6);
      const starts = (n.unavailable ?? []).find((u) => Math.abs(u.start - at) < 1e-6);
      const why = edge === 'rise'
        ? `${n.label} available at ${f1(at)}${ends?.reason ? ` (after ${ends.reason})` : ''}`
        : edge === 'fall'
          ? `${n.label} unavailable from ${f1(at)}${starts?.reason ? ` (${starts.reason})` : ''}`
          : `${n.label} not available`;
      return { ...base, terminal: 'person', why };
    }
    case 'all':
    case 'requirement':
    case 'kofn': {
      let binders: string[];
      if (edge === 'rise') {
        binders = n.deps.filter((d) => risesAt(tlOf(res, d), at) && contains(tlOf(res, d), at));
        if (!binders.length) binders = n.deps.filter((d) => !contains(tlOf(res, d), at - 1e-4));
      } else if (edge === 'fall') {
        binders = n.deps.filter((d) => fallsAt(tlOf(res, d), at));
        if (!binders.length) binders = n.deps.filter((d) => !contains(tlOf(res, d), at + 1e-4));
      } else binders = n.deps.filter((d) => firstFrom(tlOf(res, d), at) === Infinity);
      const verb = edge === 'rise' ? 'comes up' : edge === 'fall' ? 'goes down' : 'is not available';
      const kk = n.kind === 'kofn' ? ` (needs ${n.k} of ${n.deps.length})` : '';
      return { ...base, why: `${n.label} ${verb} at ${f1(at)}${kk}`, children: kids(binders, edge, at) };
    }
    case 'any': {
      let binders: string[];
      if (edge === 'rise') binders = n.deps.filter((d) => risesAt(tlOf(res, d), at) && contains(tlOf(res, d), at));
      else if (edge === 'fall') binders = n.deps.filter((d) => fallsAt(tlOf(res, d), at));
      else binders = n.deps.slice();
      const alternatives = n.deps.filter((d) => !binders.includes(d));
      const why = edge === 'rise'
        ? `${n.label}: first alternative up at ${f1(at)}`
        : edge === 'fall'
          ? `${n.label}: last alternative lost at ${f1(at)}`
          : `${n.label}: no alternative available`;
      return { ...base, why, children: kids(binders, edge, at), alternatives };
    }
    case 'task': {
      const dur = typeof r.finish === 'number' && typeof r.start === 'number' ? r.finish - r.start : NaN;
      if (edge === 'never' || r.start === undefined) {
        const crewShort = r.notes.some((x) => x.startsWith('fewer than'));
        const never = n.deps.filter((d) => firstFrom(tlOf(res, d), n.notBefore ?? -Infinity) === Infinity);
        return {
          ...base, edge: 'never',
          terminal: crewShort ? 'crew' : missing && !never.length ? 'missing' : undefined,
          why: crewShort ? r.notes.find((x) => x.startsWith('fewer than'))! : missing ? `${n.label}: duration not reported` : `${n.label} cannot start`,
          children: kids(never, 'never', at),
        };
      }
      const why = `${n.label}: starts ${f1(r.start)}, takes ${fmtDur(dur)}, done ${f1(r.finish!)}`;
      const dchild = valueChild(nodes, res, n.duration, at, depth, seen);
      if (r.crew?.waitedFor.length) {
        return { ...base, terminal: 'crew', why: `${why}; waits for ${r.crew.waitedFor.map((p) => nodes[p]?.label ?? p).join(', ')}`, children: [...kids(r.crew.waitedFor, 'rise', r.start), ...dchild] };
      }
      const preds = n.deps.filter((d) => risesAt(tlOf(res, d), r.start!));
      if (!preds.length) return { ...base, terminal: 'duration', why: `${why} (can start as soon as the watch allows)`, children: dchild };
      return { ...base, why, children: [...kids(preds, 'rise', r.start), ...dchild] };
    }
    case 'gate': {
      if (edge === 'never' || !r.slot) {
        return { ...base, edge: 'never', terminal: 'slot', why: `${n.label}: ${r.notes.join('; ') || 'no usable slot'}`, children: kids(n.deps.filter((d) => tlOf(res, d).length === 0), 'never', at) };
      }
      const slot = n.slots.find((s) => s.id === r.slot!.id);
      const lagChild = valueChild(nodes, res, slot?.lag, at, depth, seen);
      if (r.slot.waited) {
        return { ...base, terminal: 'slot', why: `${n.label}: waits for ${slot?.label ?? r.slot.id} (departs ${f1(r.slot.depart)}, +${fmtDur(r.slot.lag)})`, children: lagChild };
      }
      const preds = n.deps.filter((d) => risesAt(tlOf(res, d), r.slot!.depart));
      return { ...base, why: `${n.label}: departs on ${slot?.label ?? r.slot.id} at ${f1(r.slot.depart)}, +${fmtDur(r.slot.lag)}`, children: [...kids(preds, 'rise', r.slot.depart), ...lagChild] };
    }
    case 'delay': {
      const lagV = typeof n.lag === 'number' ? n.lag : (res[n.lag.ref]?.value ?? NaN);
      if (edge === 'never') return { ...base, why: `${n.label}: upstream never available`, children: kids([n.dep], 'never', at) };
      return {
        ...base, terminal: 'lag', why: `${n.label}: +${fmtDur(lagV as number)}`,
        children: [...kids([n.dep], edge, at - (lagV as number)), ...valueChild(nodes, res, n.lag, at, depth, seen)],
      };
    }
    case 'threshold': {
      const stockSpec = nodes[n.stock];
      const st = res[n.stock];
      const level = r.value;
      if (!stockSpec || stockSpec.kind !== 'stock' || !st) return { ...base, terminal: 'missing', why: 'stock unknown' };
      const unit = stockSpec.unit;
      if (edge === 'rise') {
        const x = st.applied?.find((a) => Math.abs(a.at - at) < 1e-6 && a.delivered > 0);
        if (x?.source) return { ...base, why: `${stockSpec.label} back above ${level} ${unit} at ${f1(at)} (${x.label})`, children: kids([x.source], 'rise', at) };
        return { ...base, terminal: 'consumption', why: `${stockSpec.label} reaches ${level} ${unit} at ${f1(at)}` };
      }
      if (edge === 'never') {
        return { ...base, terminal: missing ? 'missing' : 'consumption', why: `${stockSpec.label} stays below ${level} ${unit}` };
      }
      if (edge === 'low') {
        const lowV = st.series ? valueAtLow(st, at) : NaN;
        const nextIn = st.applied?.find((a) => a.at >= at - 1e-6 && a.delivered > 0);
        const kidsLow = nextIn?.source ? [{ ...explain(nodes, res, nextIn.source, 'rise', nextIn.at, depth + 1, seen), why: `${nextIn.label} at ${f1(nextIn.at)} sets the low point` } as Cause] : [];
        const active = stockSpec.burns.filter((b) => b.from < at + 1e-6 && at <= b.to + 1e-6);
        return {
          ...base, terminal: nextIn ? 'late-transfer' : 'consumption',
          why: `${stockSpec.label} bottoms at ${round1(lowV)} ${unit} at ${f1(at)}, ${round1(lowV - (level ?? 0))} ${unit} above the ${level} ${unit} line (${active.map((b) => b.label).join(' + ') || 'consumption'})`,
          children: [...kidsLow, ...active.flatMap((b) => valueChild(nodes, res, b.rate, at, depth, seen))],
        };
      }
      const out = st.applied?.find((a) => Math.abs(a.at - at) < 1e-6 && a.delivered < 0);
      if (out) {
        return { ...base, terminal: 'expenditure', why: `${stockSpec.label} drops below ${level} ${unit} at ${f1(at)} when ${out.label}`, children: out.source ? kids([out.source], 'rise', at) : [] };
      }
      const active = stockSpec.burns.filter((b) => b.from < at + 1e-6 && at <= b.to + 1e-6);
      const rateKids = active.flatMap((b) => valueChild(nodes, res, b.rate, at, depth, seen));
      const next = st.applied?.find((a) => a.at > at + 1e-6 && a.delivered > 0);
      const plannedLater = stockSpec.transfers.find((x) => typeof x.at === 'object' && (next ? x.id === next.id : false));
      const lateKids = next?.source && plannedLater
        ? [{ ...explain(nodes, res, next.source, 'rise', next.at, depth + 1, seen), why: `too late: ${next.label} at ${f1(next.at)} (${fmtDur(next.at - at)} after the breach)` } as Cause]
        : [];
      const burnTxt = active.map((b) => b.label).join(' + ') || 'consumption';
      return {
        ...base, terminal: next ? 'late-transfer' : 'consumption',
        why: `${stockSpec.label} falls below ${level} ${unit} at ${f1(at)} (${burnTxt})${next ? '' : '; no replenishment in the horizon'}`,
        children: [...lateKids, ...rateKids],
      };
    }
    case 'check':
      return { ...base, terminal: 'check', why: r.check?.detail ?? n.label };
    case 'stock':
      return { ...base, terminal: 'consumption', why: n.label };
  }
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function valueAtLow(st: NodeResult, at: number): number {
  // value just before any jump at `at`
  const pts = st.series ?? [];
  let v = NaN;
  for (const p of pts) {
    if (p.t < at - 1e-6) v = p.v;
    else if (Math.abs(p.t - at) <= 1e-6) return p.v;
  }
  if (Number.isNaN(v) && pts.length) v = pts[0].v;
  return v;
}

export function leavesOf(c: Cause | null): Cause[] {
  if (!c || c.edge === 'value') return [];
  const kids = c.children.filter((k) => k.edge !== 'value');
  if (!kids.length) return [c];
  return kids.flatMap(leavesOf);
}

export function chainOf(c: Cause | null, out = new Set<string>()): Set<string> {
  if (!c) return out;
  out.add(c.node);
  for (const k of c.children) chainOf(k, out);
  return out;
}

export function attributeRequirement(rr: RequirementResult, nodes: Nodes, res: Results): void {
  const rs = rr.window[0];
  let leadCause: Cause | null = null;
  let tailCause: Cause | null = null;
  if (rr.margin === -Infinity && !rr.cover) leadCause = explain(nodes, res, rr.id, 'never', rs);
  else if (rr.cover) {
    if (rr.lead !== Infinity && Number.isFinite(rr.cover[0])) leadCause = explain(nodes, res, rr.id, 'rise', rr.cover[0]);
    if (rr.tail !== Infinity && Number.isFinite(rr.cover[1])) tailCause = explain(nodes, res, rr.id, 'fall', rr.cover[1]);
  }
  let primary = rr.bindingEdge === 'lead' ? leadCause : rr.bindingEdge === 'tail' ? tailCause : null;
  let secondary = rr.bindingEdge === 'lead' ? tailCause : rr.bindingEdge === 'tail' ? leadCause : null;
  if (rr.bindingEdge === 'stock' && rr.stockBinding) {
    const low = explain(nodes, res, rr.stockBinding.threshold, 'low', rr.stockBinding.at);
    primary = { node: rr.id, label: nodes[rr.id]?.label ?? rr.id, edge: 'low', at: rr.stockBinding.at, why: `${nodes[rr.id]?.label ?? rr.id}: a stock sets the margin`, children: [low] };
    secondary = leadCause ?? tailCause;
  }
  rr.controlling = primary;
  rr.secondary = secondary;
  rr.leaves = leavesOf(primary);
  rr.chain = [...chainOf(primary)];
}
