import { explainRequirement, type EngineResult, type FactInput, type FactView, type GraphSpec } from '../engine';
import type { CapabilityView, CapBrief, CapDelta, Cliff, EngineView, EventView, Line, ResultDiff, SlackResult, SourceRef, ViewNode } from './contract';
import { fmtDelta, fmtDur, fmtMargin, fmtT, type TimeFrame } from './format';

/**
 * Plain-language lines, built only from computed results. The same text is
 * shown whether or not a language model is configured; a model may rephrase
 * it in the narrative box, never change it.
 */
const lc = (t: string) => (/^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);
const latest = (n?: ViewNode): SourceRef[] => (n?.sources.length ? [[...n.sources].sort((a, b) => b.asOf - a.asOf)[0]] : []);

/** Replace the engine's raw `t=12.5` tokens with mission time labels. */
export function timeText(s: string, frame: TimeFrame): string {
  return s.replace(/t=(-?\d+(?:\.\d+)?)/g, (_, x) => fmtT(frame, Number(x)));
}

const same = (a: number, b: number) => a === b || Math.abs(a - b) < 1e-6;

export function brief(c: CapabilityView): CapBrief {
  return {
    id: c.id, code: c.code, label: c.label, status: c.status, ready: c.ready, requiredBy: c.requiredBy, margin: c.margin, marginKind: c.marginKind,
    controlling: { nodeId: c.controlling.nodeId, label: c.controlling.label }, reasons: c.reasons,
  };
}

export function diffCaps(before: EngineView | undefined, after: EngineView, changedNodes: string[] = []): ResultDiff {
  const caps: CapDelta[] = after.capabilities.map((ac) => {
    const a = brief(ac);
    const bc = before?.capabilities.find((c) => c.id === a.id);
    const b = bc ? brief(bc) : undefined;
    const readyDelta = b ? (Number.isFinite(a.ready) && Number.isFinite(b.ready) ? a.ready - b.ready : same(a.ready, b.ready) ? 0 : a.ready > b.ready ? Infinity : -Infinity) : 0;
    // a margin with nothing limiting it carries a finite floor, so a change from it is still a number
    const marginDelta = b
      ? Number.isFinite(a.margin) && Number.isFinite(b.margin)
        ? a.margin - b.margin
        : same(a.margin, b.margin)
          ? 0
          : a.margin === -Infinity ? -Infinity : Infinity
      : 0;
    return {
      id: a.id, code: a.code, before: b, after: a, readyDelta, marginDelta,
      statusChanged: !!b && b.status !== a.status,
      controlChanged: !!b && b.controlling.nodeId !== a.controlling.nodeId,
    };
  });
  const consequential = caps.some((c) => Math.abs(c.marginDelta) > 1e-6 || c.statusChanged || c.controlChanged);
  return { caps, changedNodes, consequential };
}

export interface FactChange {
  fact: FactInput;
  label: string;
  attrLabel: string;
  before?: string;
  after: string;
  /** For time-valued facts: how far the time moved (hours). */
  slip?: number;
  quarantined?: boolean;
}

/** What changed and what it affects, for one report. */
export function eventLines(ev: EventView, changes: FactChange[], diff: ResultDiff, frame: TimeFrame, linkNote?: string): Line[] {
  const lines: Line[] = [];
  const src: SourceRef[] = [ev.source];
  for (const c of changes) {
    const ref: SourceRef = { system: c.fact.source.system, recordId: c.fact.source.recordId ?? '', asOf: c.fact.observedAt };
    const text = c.quarantined
      ? `${c.label}: ${c.attrLabel} update rejected as malformed ("${c.after}"); last good value stands`
      : `${c.label}: ${c.attrLabel} ${c.before !== undefined ? `${c.before} → ` : ''}${c.after}${c.slip !== undefined && Math.abs(c.slip) > 1e-6 ? ` (${fmtDur(c.slip, { signed: true })})` : ''}`;
    if (!lines.some((l) => l.text === text)) lines.push({ kind: 'change', text, refs: [ref], nodeIds: [], tone: c.quarantined ? 'warn' : (c.slip ?? 0) > 0 ? 'warn' : 'info' });
  }
  if (linkNote) lines.push({ kind: 'change', text: linkNote, refs: src, nodeIds: [], tone: 'crit' });
  const moved = diff.caps.filter((c) => Math.abs(c.marginDelta) > 1e-6 || c.statusChanged || c.controlChanged);
  if (!moved.length) {
    lines.push({
      kind: 'nochange',
      text: 'No mission consequence. The change is absorbed by upstream slack; no capability readiness, margin, or controlling constraint moved.',
      refs: src, nodeIds: [], tone: 'ok',
    });
    return lines;
  }
  const slip = Math.max(0, ...changes.map((c) => Math.abs(c.slip ?? 0)));
  for (const c of moved) {
    const a = c.after;
    const b = c.before;
    if (!b) continue;
    const tone = a.status === 'N' ? 'crit' : a.status === 'Q' || a.status === 'UNK' ? 'warn' : 'info';
    if (Math.abs(c.marginDelta) > 1e-6) {
      lines.push({
        kind: 'impact',
        text: `${a.code}: readiness ${fmtT(frame, b.ready)} → ${fmtT(frame, a.ready)}; mission margin ${fmtMargin(b.margin, b.marginKind)} → ${fmtMargin(a.margin, a.marginKind)} (${fmtDelta(c.marginDelta)}). Status ${b.status} → ${a.status}.`,
        refs: src, nodeIds: [a.id], tone,
      });
    } else if (c.statusChanged) {
      lines.push({ kind: 'impact', text: `${a.code}: status ${b.status} → ${a.status} (${a.reasons[0] ?? 'data quality'}). Margin unchanged.`, refs: src, nodeIds: [a.id], tone });
    }
    if (c.controlChanged) {
      lines.push({ kind: 'control', text: `${a.code}: controlling constraint shifts from ${b.controlling.label} to ${a.controlling.label}.`, refs: src, nodeIds: [a.controlling.nodeId], tone: 'warn' });
    }
    if (slip > 0 && Number.isFinite(c.marginDelta) && Math.abs(c.marginDelta) > slip * 2) {
      lines.push({
        kind: 'nonlinear',
        text: `Nonlinear consequence: a ${fmtDur(slip)} slip cost ${fmtDur(Math.abs(c.marginDelta))} of ${a.code} margin.`,
        refs: src, nodeIds: [a.id], tone: 'crit',
      });
    }
  }
  return lines;
}

export interface CapLineCtx {
  graph: GraphSpec;
  result: EngineResult;
  view: EngineView;
  nodes: Record<string, ViewNode>;
  frame: TimeFrame;
  facts: FactView;
  slack: SlackResult[];
  cliffs: Cliff[];
}

/** The picture for one capability: current state, future risk, control, slack, uncertainty, cliffs. */
export function capabilityLines(cap: CapabilityView, x: CapLineCtx): Line[] {
  const { nodes, frame } = x;
  const lines: Line[] = [];
  const tone = cap.status === 'N' ? 'crit' : cap.status === 'Q' || cap.status === 'UNK' ? 'warn' : 'ok';
  const marginTxt =
    cap.marginKind === 'never' ? 'no path inside the planning horizon'
      : cap.marginKind === 'atLeast' ? `at least ${fmtDur(cap.margin)} of margin (nothing in the horizon limits it)`
        : cap.margin >= 0 ? `${fmtDur(cap.margin)} margin` : `misses by ${fmtDur(-cap.margin)}`;
  lines.push({
    kind: 'headline',
    text: cap.status === 'UNK'
      ? `${cap.code} cannot be rated: required information is missing.`
      : `${cap.code} rated ${cap.status}. Projected ready ${fmtT(frame, cap.ready)} vs required ${fmtT(frame, cap.requiredBy)}: ${marginTxt}.`,
    refs: [], nodeIds: [cap.id], tone,
  });
  lines.push({
    kind: 'now',
    text: cap.upNow
      ? 'Current state: AVAILABLE now. Future risk comes only from changes that have not happened yet.'
      : `Current state: NOT AVAILABLE now (${fmtT(frame, x.view.at)}). Future readiness is a projection from the dependency chain below.`,
    refs: [], nodeIds: [cap.id], tone: cap.upNow ? 'ok' : 'warn',
  });

  const fa = explainRequirement(x.graph, x.result, cap.id);
  const ctl = cap.controlling;
  const root = nodes[ctl.nodeId];
  if (ctl.nodeId !== cap.id) {
    const extra = cap.coCritical.length ? ` Co-critical: ${cap.coCritical.map((id) => nodes[id]?.label ?? id).join(', ')} (fixing one alone will not help).` : '';
    const alt = fa.alternatives.length ? ` Other paths: ${fa.alternatives.map((a) => timeText(a, frame)).join('; ')}.` : '';
    lines.push({
      kind: 'control',
      text: `Controlling constraint: ${ctl.label}. ${ctl.detail.replace(/\.$/, '')}.${extra}${alt}`,
      refs: latest(root), nodeIds: [ctl.nodeId, ...cap.coCritical], tone: cap.status === 'Y' ? 'info' : 'warn',
    });
  } else {
    lines.push({ kind: 'control', text: `${ctl.label}. ${ctl.detail}.`, refs: [], nodeIds: [cap.id], tone: 'ok' });
  }
  for (const q of fa.quantity) lines.push({ kind: 'control', text: timeText(q, frame), refs: [], nodeIds: [], tone: 'info' });

  for (const sl of x.slack.slice(0, 3)) {
    const n = nodes[sl.nodeId];
    if (!n) continue;
    const fail = sl.toFailure >= 0
      ? sl.toFailure === Infinity ? `never costs ${cap.code} its requirement within the horizon` : `can slip ${fmtDur(sl.toFailure)} before ${cap.code} misses its requirement`
      : sl.recoverable ? `must recover ${fmtDur(-sl.toFailure)} to meet the requirement` : 'cannot recover the requirement on its own';
    lines.push({
      kind: 'slack',
      text: `${n.label}: ${sl.unbounded ? 'effectively unlimited' : fmtDur(sl.noImpact)} upstream slack (no effect); ${fail}.`,
      refs: latest(n), nodeIds: [n.id], tone: sl.noImpact < 1e-6 ? 'warn' : 'info',
    });
  }

  const seen = new Set<string>();
  for (const f of cap.flagsOnChain) {
    const n = nodes[f.nodeId];
    const key = `${f.nodeId}:${f.flag}`;
    if (!n || seen.has(key) || f.flag === 'assumed') continue;
    seen.add(key);
    const src = latest(n)[0];
    const systems = [...new Set(n.sources.map((s) => s.system))];
    let text: string;
    switch (f.flag) {
      case 'stale':
        text = `${n.label} is STALE: ${src?.system ?? 'source'} last updated ${fmtDur(x.view.at - (src?.asOf ?? x.view.at))} ago. Treat the projection as lower confidence.`;
        break;
      case 'contradictory':
        text = `${n.label} is CONTRADICTORY: ${systems.length > 1 ? systems.join(' and ') : 'sources'} disagree. The engine plans on the more conservative value.`;
        break;
      case 'missing': {
        const assumed = n.kind === 'task' ? `${fmtDur(n.assumedDuration ?? 0)} duration` : n.assumed !== undefined ? fmtT(frame, n.assumed) : 'a conservative value';
        text = `${n.label} is MISSING from source data. The engine assumes ${assumed}; verify before acting.`;
        break;
      }
      case 'malformed': {
        const bad = n.sources.find((s) => /malformed|invalid|rejected/i.test(s.note ?? '')) ?? src;
        text = `${n.label}: a malformed update${bad ? ` from ${bad.system}${bad.recordId ? ` ${bad.recordId}` : ''}` : ''} was quarantined. Last good value in use.`;
        break;
      }
      case 'no-redundancy':
        text = `${n.label} has no redundancy left. One more casualty here becomes a mission consequence.`;
        break;
      default:
        text = `${n.label}: ${f.flag}`;
    }
    lines.push({ kind: f.flag === 'no-redundancy' ? 'redundancy' : 'uncertainty', text, refs: n.sources.slice(-3), nodeIds: [n.id], tone: 'warn' });
  }
  for (const u of fa.uncertainty.filter((s) => / days old| reports /.test(s))) lines.push({ kind: 'uncertainty', text: timeText(u, frame), refs: [], nodeIds: [cap.id], tone: 'warn' });

  for (const cl of x.cliffs) {
    const n = nodes[cl.nodeId];
    lines.push({
      kind: 'cliff',
      text: `Hidden cliff: ${n ? lc(n.label) : cl.nodeId} has ${fmtDur(cl.slack)} of slack, but slipping past it costs ${Number.isFinite(cl.drop) ? fmtDur(cl.drop) : 'the whole capability'} of readiness.`,
      refs: latest(n), nodeIds: [cl.nodeId], tone: 'crit',
    });
  }
  if (fa.secondary) lines.push({ kind: 'uncertainty', text: timeText(fa.secondary, frame), refs: [], nodeIds: [cap.id], tone: 'info' });
  return lines;
}
