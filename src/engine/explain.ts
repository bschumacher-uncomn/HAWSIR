import type { NodeMap } from './apply';
import type { Cliff, SlackResult } from './analysis';
import type { ResultDiff } from './diff';
import { fmtDur, fmtT } from './time';
import type { ChangeEvent, EngineResult, NodeDef, Patch, Scenario, SourceRef } from './types';

export type Tone = 'ok' | 'warn' | 'crit' | 'info';

export interface Line {
  kind: 'headline' | 'now' | 'change' | 'impact' | 'control' | 'slack' | 'uncertainty' | 'cliff' | 'redundancy' | 'nochange' | 'nonlinear';
  text: string;
  refs: SourceRef[];
  nodeIds: string[];
  tone: Tone;
}

const latest = (n?: NodeDef) => (n?.sources?.length ? [...n.sources].sort((a, b) => b.asOf - a.asOf)[0] : undefined);
const refsOf = (n?: NodeDef) => (latest(n) ? [latest(n)!] : []);

export function describePatch(s: Scenario, before: NodeMap, after: NodeMap, p: Patch): Line | null {
  if (p.op === 'remove') return { kind: 'change', text: `Removed ${before[p.id]?.label ?? p.id}`, refs: [], nodeIds: [p.id], tone: 'info' };
  if (p.op === 'add') {
    const n = p.node;
    const when = n.kind === 'input' ? (n.value == null ? ' (ETA not reported)' : ` at ${fmtT(s, n.value)}`) : '';
    return { kind: 'change', text: `New ${n.domain} item: ${n.label}${when}`, refs: refsOf(n), nodeIds: [n.id], tone: 'info' };
  }
  const b = before[p.id];
  const a = after[p.id];
  if (!b || !a) return null;
  if (p.op === 'addCrew') return { kind: 'change', text: `${a.label}: crew pool adds ${p.persons.map((x) => after[x]?.label ?? x).join(', ')}`, refs: [], nodeIds: [a.id, ...p.persons], tone: 'info' };
  if (p.op === 'window') {
    const w = a.windows?.find((x) => x.id === p.windowId);
    return { kind: 'change', text: `${a.label}: ${w?.label ?? p.windowId} ${w?.enabled === false ? 'closed' : 'open'} ${w ? `${fmtT(s, w.start)} to ${fmtT(s, w.end)}` : ''}`.trim(), refs: [], nodeIds: [a.id], tone: 'info' };
  }
  const f = p.fields;
  if ('malformed' in f && f.malformed) {
    return { kind: 'change', text: `Rejected malformed ${f.malformed.source.system} record for ${a.label} ("${f.malformed.raw}"). Last good value retained and quarantined for review.`, refs: [f.malformed.source], nodeIds: [a.id], tone: 'warn' };
  }
  if ('conflict' in f && f.conflict) {
    return {
      kind: 'change',
      text: `${f.conflict.source.system} reports ${a.label} at ${fmtT(s, f.conflict.value)}, contradicting ${latest(a)?.system ?? 'record'} ${a.value != null ? fmtT(s, a.value) : 'value'}. Engine holds the later time (conservative).`,
      refs: [f.conflict.source, ...refsOf(a)],
      nodeIds: [a.id],
      tone: 'warn',
    };
  }
  if ('kind' in f && f.kind && f.kind !== b.kind) {
    return { kind: 'change', text: `${a.label} is DOWN. Restoration now depends on a repair chain.`, refs: refsOf(a), nodeIds: [a.id], tone: 'crit' };
  }
  if ('unavailable' in f && f.unavailable?.length) {
    const iv = f.unavailable[f.unavailable.length - 1];
    return { kind: 'change', text: `${a.label} unavailable ${fmtT(s, iv.start)} to ${fmtT(s, iv.end)} (${iv.reason ?? 'unavailable'})`, refs: refsOf(a), nodeIds: [a.id], tone: 'warn' };
  }
  if ('duration' in f) {
    if (f.duration == null)
      return { kind: 'change', text: `${a.label}: duration estimate withdrawn. Engine assumes ${fmtDur(a.assumedDuration ?? 0)} (flagged ASSUMED).`, refs: refsOf(a), nodeIds: [a.id], tone: 'warn' };
    return { kind: 'change', text: `${a.label}: duration ${fmtDur(b.duration ?? 0)} → ${fmtDur(f.duration)}`, refs: refsOf(a), nodeIds: [a.id], tone: 'info' };
  }
  if ('value' in f) {
    if (f.value == null) return { kind: 'change', text: `${a.label}: value now MISSING`, refs: refsOf(a), nodeIds: [a.id], tone: 'warn' };
    const old = b.value ?? b.assumed;
    const d = old != null ? f.value - old : 0;
    const from = old != null ? `${fmtT(s, old)} → ` : '';
    return {
      kind: 'change',
      text: `${a.label}: ${from}${fmtT(s, f.value)}${old != null ? ` (${fmtDur(d, { signed: true })})` : ''}`,
      refs: refsOf(a),
      nodeIds: [a.id],
      tone: d > 0 ? 'warn' : 'info',
    };
  }
  return null;
}

/** "What changed" and "What does it affect" for one incoming event. */
export function explainEvent(s: Scenario, before: NodeMap, after: NodeMap, ev: ChangeEvent, diff: ResultDiff): Line[] {
  const lines: Line[] = [];
  for (const p of ev.patches) {
    const l = describePatch(s, before, after, p);
    if (l && !lines.some((x) => x.text === l.text)) lines.push({ ...l, refs: l.refs.length ? l.refs : [ev.source] });
  }
  const moved = diff.caps.filter((c) => Math.abs(c.marginDelta) > 1e-6 || c.statusChanged || c.controlChanged);
  if (!moved.length) {
    lines.push({
      kind: 'nochange',
      text: 'No mission consequence. The change is absorbed by upstream slack; no capability readiness, margin, or controlling constraint moved.',
      refs: [ev.source],
      nodeIds: [],
      tone: 'ok',
    });
    return lines;
  }
  for (const c of moved) {
    const a = c.after;
    const b = c.before;
    if (!b) continue;
    const tone = a.status === 'N' ? 'crit' : a.status === 'Q' ? 'warn' : 'info';
    if (Math.abs(c.marginDelta) > 1e-6) {
      lines.push({
        kind: 'impact',
        text: `${a.code}: readiness ${fmtT(s, b.ready)} → ${fmtT(s, a.ready)}; mission margin ${fmtDur(b.margin)} → ${fmtDur(a.margin)} (${fmtDur(c.marginDelta, { signed: true })}). Status ${b.status} → ${a.status}.`,
        refs: [ev.source],
        nodeIds: [a.id],
        tone,
      });
    } else if (c.statusChanged) {
      lines.push({ kind: 'impact', text: `${a.code}: status ${b.status} → ${a.status} (${a.reasons[0] ?? 'data quality'}). Margin unchanged.`, refs: [ev.source], nodeIds: [a.id], tone });
    }
    if (c.controlChanged) {
      lines.push({ kind: 'control', text: `${a.code}: controlling constraint shifts from ${b.controlling.label} to ${a.controlling.label}.`, refs: [ev.source], nodeIds: [a.controlling.nodeId], tone: 'warn' });
    }
    const inputSlip = ev.patches.reduce((m, p) => {
      if (p.op !== 'set' || !('value' in p.fields) || p.fields.value == null) return m;
      const old = before[p.id]?.value;
      return old != null ? Math.max(m, Math.abs(p.fields.value - old)) : m;
    }, 0);
    if (inputSlip > 0 && Math.abs(c.marginDelta) > inputSlip * 2) {
      lines.push({
        kind: 'nonlinear',
        text: `Nonlinear consequence: a ${fmtDur(inputSlip)} slip cost ${fmtDur(Math.abs(c.marginDelta))} of ${a.code} margin.`,
        refs: [ev.source],
        nodeIds: [a.id],
        tone: 'crit',
      });
    }
  }
  return lines;
}

/** Plain-language picture for one capability: current state, future risk, control, margin, uncertainty. */
export function explainCapability(
  s: Scenario,
  nodes: NodeMap,
  r: EngineResult,
  capId: string,
  opts: { slack?: SlackResult[]; cliffs?: Cliff[] } = {},
): Line[] {
  const c = r.capabilities.find((x) => x.id === capId);
  if (!c) return [];
  const lines: Line[] = [];
  const tone = c.status === 'N' ? 'crit' : c.status === 'Q' ? 'warn' : 'ok';
  const marginTxt = c.margin >= 0 ? `${fmtDur(c.margin)} margin` : `misses by ${fmtDur(-c.margin)}`;
  lines.push({
    kind: 'headline',
    text: `${c.code} rated ${c.status}. Projected ready ${fmtT(s, c.ready)} vs required ${fmtT(s, c.requiredBy)}: ${marginTxt}.`,
    refs: [],
    nodeIds: [c.id],
    tone,
  });
  lines.push({
    kind: 'now',
    text: c.upNow
      ? `Current state: AVAILABLE now. Future risk comes only from changes that have not happened yet.`
      : `Current state: NOT AVAILABLE now (${fmtT(s, r.at)}). Future readiness is a projection from the dependency chain below.`,
    refs: [],
    nodeIds: [c.id],
    tone: c.upNow ? 'ok' : 'warn',
  });

  const ctl = c.controlling;
  const root = nodes[ctl.nodeId];
  const rr = r.nodes[ctl.nodeId];
  if (ctl.kind === 'window' && root && rr?.control.type === 'window') {
    const w = root.windows?.find((x) => x.id === ctl.windowId);
    const waitFrom = rr.control.waitFrom;
    const missed = (root.windows ?? []).filter((x) => x.enabled !== false && waitFrom + (x.lag ?? 0) > x.end && x.end < (w?.start ?? Infinity));
    const missedTxt = missed.length
      ? ` It missed ${missed.map((m) => `${m.label} (closed ${fmtT(s, m.end)}) by ${fmtDur(waitFrom + (m.lag ?? 0) - m.end)}`).join('; ')}.`
      : '';
    const upstream = r.nodes[root.deps?.[0] ?? '']?.ready;
    lines.push({
      kind: 'control',
      text: `Controlling constraint: ${w?.label ?? 'delivery window'}. Upstream ready ${fmtT(s, upstream ?? waitFrom)}, but ${root.label.toLowerCase()} cannot happen before ${fmtT(s, w?.start ?? rr.ready)}.${missedTxt}`,
      refs: refsOf(nodes[root.deps?.[0] ?? '']),
      nodeIds: [root.id, ...(root.deps ?? [])],
      tone: 'warn',
    });
  } else if (ctl.kind === 'person' && root) {
    const iv = (root.unavailable ?? []).find((x) => Math.abs(x.end - (rr?.ready ?? 0)) < 1e-6);
    const task = c.chain.map((id) => nodes[id]).find((n) => n?.crew?.pool.includes(root.id));
    lines.push({
      kind: 'control',
      text: `Controlling constraint: ${task?.crew?.label ?? 'qualified crew'} (need ${task?.crew?.k ?? '?'}). ${root.label} is ${iv?.reason?.toLowerCase() ?? 'not available'} until ${fmtT(s, rr?.ready ?? 0)}, so ${task?.label.toLowerCase() ?? 'the task'} cannot start earlier.`,
      refs: refsOf(root),
      nodeIds: [root.id, task?.id ?? ''],
      tone: 'warn',
    });
  } else if (root) {
    lines.push({
      kind: 'control',
      text: `Controlling constraint: ${root.label}${rr && Number.isFinite(rr.ready) ? ` at ${fmtT(s, rr.ready)}` : ''}. ${ctl.detail}`.trim(),
      refs: refsOf(root),
      nodeIds: [root.id],
      tone: c.status === 'Y' ? 'info' : 'warn',
    });
  }

  for (const sl of (opts.slack ?? []).slice(0, 3)) {
    const n = nodes[sl.nodeId];
    if (!n) continue;
    const fail = sl.toFailure >= 0 ? `can slip ${fmtDur(sl.toFailure)} before ${c.code} misses its requirement` : sl.recoverable ? `must recover ${fmtDur(-sl.toFailure)} to meet the requirement` : `cannot recover the requirement on its own`;
    lines.push({
      kind: 'slack',
      text: `${n.label}: ${sl.unbounded ? 'effectively unlimited' : fmtDur(sl.noImpact)} upstream slack (no effect); ${fail}.`,
      refs: refsOf(n),
      nodeIds: [n.id],
      tone: sl.noImpact < 1e-6 ? 'warn' : 'info',
    });
  }

  const seen = new Set<string>();
  for (const f of c.flagsOnChain) {
    const n = nodes[f.nodeId];
    const key = `${f.nodeId}:${f.flag}`;
    if (!n || seen.has(key) || f.flag === 'assumed') continue;
    seen.add(key);
    const src = latest(n);
    const txt =
      f.flag === 'stale'
        ? `${n.label} is STALE: ${src?.system ?? 'source'} last updated ${fmtDur(r.at - (src?.asOf ?? r.at))} ago. Treat the projection as lower confidence.`
        : f.flag === 'contradictory'
          ? `${n.label} is CONTRADICTORY: ${n.conflict?.source.system} says ${fmtT(s, n.conflict?.value ?? 0)}, ${src?.system} says ${n.value != null ? fmtT(s, n.value) : 'unknown'}. Using the later time.`
          : f.flag === 'missing'
            ? `${n.label} is MISSING from source data. Engine assumes ${n.kind === 'task' ? fmtDur(n.assumedDuration ?? 0) : fmtT(s, n.assumed ?? 0)}; verify before acting.`
            : f.flag === 'malformed'
              ? `${n.label}: a malformed update was rejected ("${n.malformed?.raw}"). Last good value in use.`
              : `${n.label}: ${f.flag}`;
    lines.push({ kind: 'uncertainty', text: txt, refs: n.conflict ? [n.conflict.source, ...refsOf(n)] : n.malformed ? [n.malformed.source] : refsOf(n), nodeIds: [n.id], tone: 'warn' });
  }

  for (const cl of opts.cliffs ?? []) {
    const n = nodes[cl.nodeId];
    lines.push({
      kind: 'cliff',
      text: `Hidden cliff: ${n?.label} has ${fmtDur(cl.slack)} of slack, but slipping past it costs ${fmtDur(cl.drop)} of readiness.`,
      refs: refsOf(n),
      nodeIds: [cl.nodeId],
      tone: 'crit',
    });
  }

  for (const reason of c.reasons.filter((x) => x.startsWith('No redundancy'))) {
    lines.push({ kind: 'redundancy', text: `${reason}. One more casualty in this group becomes a mission consequence.`, refs: [], nodeIds: [], tone: 'warn' });
  }
  return lines;
}
