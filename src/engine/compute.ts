import type { NodeMap } from './apply';
import { fmtDur } from './time';
import type {
  CapabilityResult,
  Control,
  ControllingConstraint,
  EngineResult,
  Hours,
  NodeDef,
  NodeResult,
  QualityFlag,
  Readiness,
  Scenario,
} from './types';

const EPS = 1e-6;

export interface ComputeOpts {
  qMargin: number;
}

/** Earliest time >= from at which a person is not inside an unavailable interval. */
export function personAvailableFrom(p: NodeDef, from = 0): Hours {
  let t = Math.max(from, p.value ?? p.assumed ?? 0);
  const ivs = p.unavailable ?? [];
  for (let guard = 0; guard < 32; guard++) {
    const hit = ivs.find((iv) => iv.start <= t + EPS && t < iv.end - EPS);
    if (!hit) return t;
    t = hit.end;
  }
  return t;
}

export function personAvailableDuring(p: NodeDef, a: Hours, b: Hours): boolean {
  if (a + EPS < (p.value ?? p.assumed ?? 0)) return false;
  return !(p.unavailable ?? []).some((iv) => iv.start < b - EPS && iv.end > a + EPS);
}

function topoOrder(nodes: NodeMap, errors: string[]): string[] {
  const ids = Object.keys(nodes);
  const indeg: Record<string, number> = {};
  const out: Record<string, string[]> = {};
  for (const id of ids) {
    indeg[id] = 0;
    out[id] = [];
  }
  for (const id of ids) {
    const n = nodes[id];
    const ups = [...(n.deps ?? []), ...(n.crew?.pool ?? [])];
    for (const d of ups) {
      if (!nodes[d]) {
        errors.push(`${id}: unknown dependency "${d}"`);
        continue;
      }
      indeg[id]++;
      out[d].push(id);
    }
  }
  const q = ids.filter((id) => indeg[id] === 0);
  const order: string[] = [];
  while (q.length) {
    const id = q.shift()!;
    order.push(id);
    for (const nx of out[id]) if (--indeg[nx] === 0) q.push(nx);
  }
  if (order.length !== ids.length) errors.push('Dependency cycle detected; affected nodes excluded');
  return order;
}

function argExtreme(deps: string[], res: Record<string, NodeResult>, pick: 'max' | 'min') {
  let best = pick === 'max' ? -Infinity : Infinity;
  for (const d of deps) {
    const r = res[d]?.ready ?? Infinity;
    if (pick === 'max' ? r > best : r < best) best = r;
  }
  const binding = deps.filter((d) => Math.abs((res[d]?.ready ?? Infinity) - best) < EPS || (res[d]?.ready === best));
  return { value: deps.length ? best : 0, binding };
}

function inputFlags(n: NodeDef, at: Hours, effective: number): QualityFlag[] {
  const f: QualityFlag[] = [];
  if (n.kind === 'input' && (n.value === null || n.value === undefined)) {
    f.push('missing');
    if (n.assumed !== undefined) f.push('assumed');
  }
  if (n.conflict) f.push('contradictory');
  if (n.malformed) f.push('malformed');
  if (n.staleAfter && n.sources?.length) {
    const asOf = Math.max(...n.sources.map((s) => s.asOf));
    if (at - asOf > n.staleAfter && effective > at) f.push('stale');
  }
  return f;
}

export function compute(s: Pick<Scenario, 'thresholds'>, nodes: NodeMap, at: Hours): EngineResult {
  const errors: string[] = [];
  const order = topoOrder(nodes, errors);
  const res: Record<string, NodeResult> = {};

  for (const id of order) {
    const n = nodes[id];
    const deps = (n.deps ?? []).filter((d) => nodes[d]);
    let r: NodeResult;

    switch (n.kind) {
      case 'input': {
        let v = n.value ?? n.assumed ?? Infinity;
        if (n.conflict) v = Math.max(v, n.conflict.value);
        r = { id, ready: v, binding: [], control: { type: 'self' }, effective: v, flags: [] };
        r.flags = inputFlags(n, at, v);
        break;
      }
      case 'person': {
        const v = personAvailableFrom(n, 0);
        r = { id, ready: v, binding: [], control: { type: 'self' }, effective: v, flags: inputFlags(n, at, v) };
        break;
      }
      case 'task': {
        const { value: predsReady, binding } = argExtreme(deps, res, 'max');
        const missing = n.duration === null || n.duration === undefined;
        const d = missing ? (n.assumedDuration ?? Infinity) : n.duration!;
        const flags: QualityFlag[] = [];
        if (missing) {
          flags.push('missing');
          if (n.assumedDuration !== undefined) flags.push('assumed');
        }
        if (!Number.isFinite(predsReady) || !Number.isFinite(d)) {
          r = { id, ready: Infinity, predsReady, binding, control: { type: 'deps' }, effective: d, flags };
          break;
        }
        if (!n.crew) {
          r = { id, ready: predsReady + d, start: predsReady, predsReady, binding, control: { type: 'deps' }, effective: d, flags };
          break;
        }
        const pool = n.crew.pool.map((p) => nodes[p]).filter(Boolean);
        const cands = new Set<number>([predsReady]);
        for (const p of pool) {
          const v = p.value ?? 0;
          if (v >= predsReady) cands.add(v);
          for (const iv of p.unavailable ?? []) if (iv.end >= predsReady) cands.add(iv.end);
        }
        let start = Infinity;
        let assigned: string[] = [];
        for (const c of [...cands].sort((a, b) => a - b)) {
          const avail = pool.filter((p) => personAvailableDuring(p, c, c + d));
          if (avail.length >= n.crew.k) {
            start = c;
            assigned = avail.slice(0, n.crew.k).map((p) => p.id);
            if (avail.length === n.crew.k && pool.length > n.crew.k) flags.push('no-redundancy');
            break;
          }
        }
        if (!Number.isFinite(start)) {
          r = {
            id, ready: Infinity, predsReady, binding: [], effective: d, flags,
            control: { type: 'unreachable', reason: `Fewer than ${n.crew.k} qualified personnel in pool` },
            crew: { need: n.crew.k, assigned: [] },
          };
          break;
        }
        if (start > predsReady + EPS) {
          const startsAt = (p: NodeDef) =>
            Math.abs((p.value ?? 0) - start) < EPS || (p.unavailable ?? []).some((iv) => Math.abs(iv.end - start) < EPS);
          const bindingPeople = assigned.filter((pid) => startsAt(nodes[pid]));
          r = {
            id, ready: start + d, start, predsReady, effective: d, flags,
            binding: bindingPeople.length ? bindingPeople : assigned.slice(-1),
            control: { type: 'crew', waitFrom: predsReady },
            crew: { need: n.crew.k, assigned },
          };
        } else {
          r = { id, ready: start + d, start, predsReady, binding, control: { type: 'deps' }, effective: d, flags, crew: { need: n.crew.k, assigned } };
        }
        break;
      }
      case 'all':
      case 'capability': {
        const { value, binding } = argExtreme(deps, res, 'max');
        r = { id, ready: value, binding, control: { type: 'deps' }, flags: n.degraded ? ['degraded'] : [] };
        break;
      }
      case 'any': {
        const { value, binding } = argExtreme(deps, res, 'min');
        r = { id, ready: value, binding, control: { type: 'deps' }, flags: [] };
        break;
      }
      case 'kofn': {
        const k = n.k ?? deps.length;
        const sorted = deps.map((d) => ({ d, r: res[d]?.ready ?? Infinity })).sort((a, b) => a.r - b.r);
        if (sorted.length < k || k <= 0) {
          r = { id, ready: Infinity, binding: [], control: { type: 'unreachable', reason: `Only ${sorted.length} of ${k} required` }, flags: [] };
        } else {
          const kth = sorted[k - 1].r;
          r = { id, ready: kth, binding: sorted.filter((x) => Math.abs(x.r - kth) < EPS || x.r === kth).map((x) => x.d).slice(0, 1), control: { type: 'deps' }, flags: [] };
        }
        break;
      }
      case 'gate': {
        const { value: predsReady, binding } = argExtreme(deps, res, 'max');
        let best = Infinity;
        let used: string | undefined;
        let waited = false;
        for (const w of n.windows ?? []) {
          if (w.enabled === false) continue;
          const arrival = predsReady + (w.lag ?? 0);
          if (!Number.isFinite(arrival) || arrival > w.end + EPS) continue;
          const c = Math.max(arrival, w.start);
          if (c < best) {
            best = c;
            used = w.id;
            waited = w.start > arrival + EPS;
          }
        }
        const control: Control = !Number.isFinite(best)
          ? { type: 'unreachable', reason: 'No open delivery window after arrival' }
          : waited
            ? { type: 'window', windowId: used!, waitFrom: predsReady }
            : { type: 'deps' };
        r = { id, ready: best, predsReady, binding: waited ? [] : binding, control, usedWindow: used, flags: [] };
        break;
      }
    }
    res[id] = r!;
  }

  // redundancy flags for k-of-n relative to the earliest capability need downstream
  const needBy = requiredByIndex(nodes);
  for (const id of order) {
    const n = nodes[id];
    if (n.kind !== 'kofn') continue;
    const need = needBy[id] ?? Infinity;
    const deps = (n.deps ?? []).filter((d) => res[d]);
    const up = deps.filter((d) => res[d].ready <= need + EPS).length;
    if (up === (n.k ?? deps.length) && deps.length > (n.k ?? deps.length)) res[id].flags.push('no-redundancy');
  }
  const capabilities = Object.values(nodes)
    .filter((n) => n.kind === 'capability' && res[n.id])
    .map((n) => analyzeCapability(n, nodes, res, at, s.thresholds.qMargin));

  return { at, nodes: res, capabilities, order, errors };
}

export function requiredByIndex(nodes: NodeMap): Record<string, Hours> {
  const need: Record<string, Hours> = {};
  for (const cap of Object.values(nodes)) {
    if (cap.kind !== 'capability' || cap.requiredBy === undefined) continue;
    for (const id of upstreamCone(nodes, cap.id)) need[id] = Math.min(need[id] ?? Infinity, cap.requiredBy);
  }
  return need;
}

export function upstreamCone(nodes: NodeMap, id: string): Set<string> {
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur) || !nodes[cur]) continue;
    seen.add(cur);
    const n = nodes[cur];
    for (const d of [...(n.deps ?? []), ...(n.crew?.pool ?? [])]) stack.push(d);
  }
  return seen;
}

export function downstreamOf(nodes: NodeMap, id: string): Set<string> {
  const out = new Set<string>();
  let frontier = [id];
  while (frontier.length) {
    const next: string[] = [];
    for (const n of Object.values(nodes)) {
      const ups = [...(n.deps ?? []), ...(n.crew?.pool ?? [])];
      if (!out.has(n.id) && ups.some((u) => frontier.includes(u))) {
        out.add(n.id);
        next.push(n.id);
      }
    }
    frontier = next;
  }
  return out;
}

export function criticalChain(nodeId: string, res: Record<string, NodeResult>): string[] {
  const chain: string[] = [];
  let cur: string | undefined = nodeId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur) && res[cur]) {
    seen.add(cur);
    chain.push(cur);
    cur = res[cur].binding[0];
  }
  return chain;
}

function controllingFor(chain: string[], nodes: NodeMap, res: Record<string, NodeResult>): ControllingConstraint {
  const rootId = chain[chain.length - 1];
  const root = nodes[rootId];
  const rr = res[rootId];
  if (rr.control.type === 'window') {
    const w = root.windows?.find((x) => x.id === (rr.control as { windowId: string }).windowId);
    return {
      nodeId: rootId,
      kind: 'window',
      windowId: w?.id,
      label: w?.label ?? 'Delivery window',
      detail: `${root.label}: upstream ready but next opening is ${w?.label ?? 'a later window'}`,
    };
  }
  if (rr.control.type === 'unreachable') {
    return { nodeId: rootId, kind: 'input', label: root.label, detail: rr.control.reason };
  }
  if (root.kind === 'person') {
    const parent = chain.length > 1 ? nodes[chain[chain.length - 2]] : undefined;
    const iv = (root.unavailable ?? []).find((x) => Math.abs(x.end - rr.ready) < EPS);
    return {
      nodeId: rootId,
      kind: 'person',
      label: root.label,
      detail: `${parent?.crew?.label ?? 'Qualified personnel'}: ${iv?.reason ?? 'available'} until crew requirement is met`,
    };
  }
  if (root.kind === 'task') return { nodeId: rootId, kind: 'duration', label: root.label, detail: `Task duration ${fmtDur(rr.effective ?? 0)}` };
  return { nodeId: rootId, kind: 'input', label: root.label, detail: root.detail ?? '' };
}

function analyzeCapability(n: NodeDef, nodes: NodeMap, res: Record<string, NodeResult>, at: Hours, qMargin: number): CapabilityResult {
  const r = res[n.id];
  const requiredBy = n.requiredBy ?? Infinity;
  const margin = requiredBy - r.ready;
  const chain = criticalChain(n.id, res);
  const controlling = controllingFor(chain, nodes, res);
  const reasons: string[] = [];
  const flagsOnChain: { nodeId: string; flag: QualityFlag }[] = [];
  const decisive: QualityFlag[] = ['missing', 'assumed', 'stale', 'contradictory', 'malformed'];
  for (const id of chain) for (const f of res[id].flags) if (decisive.includes(f)) flagsOnChain.push({ nodeId: id, flag: f });

  const cone = upstreamCone(nodes, n.id);
  const redundancy = [...cone].filter((id) => nodes[id].kind === 'kofn' && res[id]?.flags.includes('no-redundancy'));
  const threshold = n.qMargin ?? qMargin;

  const coCritical = new Set<string>();
  for (const id of chain) {
    const nr = res[id];
    for (const b of nr.binding.slice(1)) coCritical.add(b);
    const node = nodes[id];
    if (node.crew && nr.start !== undefined && nr.crew) {
      for (const pid of nr.crew.assigned) {
        const p = nodes[pid];
        if (chain.includes(pid)) continue;
        const startsAt = Math.abs((p.value ?? 0) - nr.start) < EPS || (p.unavailable ?? []).some((iv) => Math.abs(iv.end - nr.start!) < EPS);
        if (startsAt && nr.start > 0) coCritical.add(pid);
      }
    }
    if (nr.control.type === 'window' && node.deps?.length) {
      // upstream arriving exactly at the window opening is co-critical with the window
      for (const d of node.deps) {
        const w = node.windows?.find((x) => x.id === nr.usedWindow);
        if (w && Math.abs((res[d]?.ready ?? 0) + (w.lag ?? 0) - w.start) < EPS) coCritical.add(d);
      }
    }
  }

  let status: Readiness = 'Y';
  if (!Number.isFinite(r.ready) || margin < -EPS) {
    status = 'N';
    reasons.push(Number.isFinite(r.ready) ? `Projected ${fmtDur(-margin)} late` : 'Readiness cannot be computed');
  } else {
    if (margin < threshold) {
      status = 'Q';
      reasons.push(`Margin ${fmtDur(margin)} under ${fmtDur(threshold)} threshold`);
    }
    if (flagsOnChain.length) {
      status = 'Q';
      const uniq = [...new Set(flagsOnChain.map((f) => `${f.flag.toUpperCase()}: ${nodes[f.nodeId].label}`))];
      reasons.push(...uniq);
    }
    if (redundancy.length) {
      status = 'Q';
      reasons.push(...redundancy.map((id) => `No redundancy: ${nodes[id].label}`));
    }
    if (n.degraded) {
      status = 'Q';
      reasons.push(`Accepted degraded: ${n.degraded}`);
    }
  }

  return {
    id: n.id,
    code: n.code ?? n.id,
    label: n.label,
    ready: r.ready,
    requiredBy,
    margin,
    status,
    upNow: r.ready <= at + EPS,
    chain,
    coCritical: [...coCritical],
    controlling,
    reasons,
    flagsOnChain,
  };
}
