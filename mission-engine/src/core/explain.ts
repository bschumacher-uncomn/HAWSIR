import { leavesOf } from './attribution';
import type { Cause, EngineResult, GraphSpec, QualityFlag, RequirementResult } from './graph';
import { UNCERTAIN_FLAGS } from './graph';
import { firstFrom } from './intervals';
import type { OptionEval } from './options';
import type { RiskAssessment } from './risk';
import { fmtDur, fmtRel } from './time';

/**
 * Plain-language explanation built only from calculated facts. It is the same
 * text whether or not a language model is available; a model may rephrase it,
 * never change it.
 */
export interface FiveAnswers {
  requirement: string;
  label: string;
  code?: string;
  status: RequirementResult['status'];
  /** 1. Is it up now? */
  upNow: string;
  /** 2. Will it be up when needed? */
  whenNeeded: string;
  /** 3. What controls that? */
  controlling: string;
  controllingLeaves: { node: string; label: string; why: string; terminal?: string }[];
  /** Other paths that were not earlier (from `any` nodes on the controlling chain). */
  alternatives: string[];
  /** The controlling chain, one line per step. */
  chain: string[];
  /** 4. How much margin is left (time, and quantity alongside)? */
  margin: string;
  marginHours: number;
  quantity: string[];
  /** 5. What are the bounded options? */
  options: string[];
  /** What is missing, uncertain, or assumed. */
  uncertainty: string[];
  /** The other edge: e.g. fuel slack after the window. */
  secondary?: string;
  risk?: string;
  reasons: string[];
}

export interface ExplainOpts {
  /** Reference mark for relative times (e.g. H-hour). */
  markLabel?: string;
  mark?: number;
  options?: OptionEval[];
  risk?: RiskAssessment;
  maxOptions?: number;
}

function when(t: number, o: ExplainOpts): string {
  if (!Number.isFinite(t)) return t > 0 ? 'never in the horizon' : 'already';
  if (o.mark !== undefined) return fmtRel(t, o.mark, o.markLabel ?? 'H');
  return `t=${Math.round(t * 100) / 100}`;
}

/** Replace raw `t=12.5` tokens from attribution with H-relative labels. */
export function relabel(text: string, o: ExplainOpts): string {
  return text.replace(/t=(-?\d+(?:\.\d+)?)/g, (_, x) => when(Number(x), o));
}

export function chainText(c: Cause | null, o: ExplainOpts = {}, depth = 0, maxDepth = 12): string[] {
  if (!c || depth > maxDepth) return [];
  const pad = '  '.repeat(depth);
  const lines = [`${pad}${depth ? '└ ' : ''}${relabel(c.why, o)}`];
  for (const k of c.children) lines.push(...chainText(k, o, depth + 1, maxDepth));
  return lines;
}

function fmtDelta(d: number): string {
  if (!Number.isFinite(d) || Math.abs(d) >= 1e5) return d > 0 ? 'no longer limited' : 'unbounded loss';
  return `${d >= 0 ? '+' : ''}${fmtDur(d)}`;
}

export function flagText(f: QualityFlag): string {
  const m: Partial<Record<QualityFlag, string>> = {
    missing: 'not reported',
    assumed: 'conservative assumption in use',
    stale: 'stale report',
    contradictory: 'sources disagree (worse value used)',
    malformed: 'malformed record quarantined',
    extrapolated: 'outside the factor table (clamped)',
    'no-redundancy': 'no spare: one more loss breaks it',
    degraded: 'degraded equipment',
    'non-monotone': 'response is non-monotone (scan used, not bisection)',
    'unverified-routine': 'calculation routine not verified',
    'routine-contract': 'calculation routine broke its contract',
    'transfer-skipped': 'a planned transfer does not happen in the horizon',
    'reported-mismatch': 'reported readiness disagrees with the computed picture',
    'unreported-change': 'significant change not yet reported',
    'planning-assumption': 'includes an approved planning assumption',
    synthetic: 'synthetic data',
  };
  return m[f] ?? f;
}

export function explainRequirement(g: GraphSpec, r: EngineResult, id: string, o: ExplainOpts = {}): FiveAnswers {
  const rr = r.requirements[id];
  const spec = g.nodes.find((n) => n.id === id);
  const label = spec?.label ?? id;
  const [ws, we] = rr.window;
  const upNow = rr.upNow ? `Yes, ${label} is available now.` : `No, ${label} is not available now.`;
  const winTxt = `${when(ws, o)} to ${when(we, o)}`;
  let whenNeeded: string;
  if (rr.status === 'UNK') whenNeeded = `Cannot be determined for ${winTxt}: required information is missing.`;
  else if (rr.status === 'N') {
    whenNeeded = rr.margin === -Infinity
      ? `No. It is not available at any time after ${when(ws, o)}.`
      : rr.bindingEdge === 'lead'
        ? `No. It comes up at ${when(rr.cover![0], o)}, ${fmtDur(-rr.lead)} after the need at ${when(ws, o)}.`
        : `No. It is lost at ${when(rr.cover![1], o)}, ${fmtDur(-rr.tail)} before the window ends at ${when(we, o)}.`;
  } else {
    const q = rr.status === 'Q' ? ' (qualified)' : '';
    whenNeeded = `Yes${q}, for ${winTxt}.`;
  }
  const leaves = leavesOf(rr.controlling);
  const controlling = leaves.length
    ? `${leaves.map((l) => relabel(l.why, o)).join('; ')}${leaves.length > 1 ? ' (co-critical)' : ''}`
    : 'Nothing inside the horizon limits it.';
  const alternatives: string[] = [];
  const walkAlt = (c: Cause | null) => {
    if (!c) return;
    for (const alt of c.alternatives ?? []) {
      const t = firstFrom(r.nodes[alt]?.timeline ?? [], ws);
      const lbl = g.nodes.find((n) => n.id === alt)?.label ?? alt;
      alternatives.push(`${lbl}: ${Number.isFinite(t) ? `available ${when(t, o)}` : 'not available in the horizon'}`);
    }
    c.children.forEach(walkAlt);
  };
  walkAlt(rr.controlling);
  const margin = rr.margin === Infinity
    ? 'No time limit inside the horizon.'
    : rr.margin === -Infinity
      ? 'No margin: it never becomes available.'
      : rr.margin < 0
        ? `Short by ${fmtDur(-rr.margin)}.`
        : `${fmtDur(rr.margin)} of margin (${rr.bindingEdge === 'lead' ? 'before the need' : rr.bindingEdge === 'stock' ? 'hours of burn above the line at the low point' : 'before it is lost'}).`;
  const quantity = rr.quantity.map((q) => `${g.nodes.find((n) => n.id === q.stock)?.label ?? q.stock}: lowest ${round(q.minInWindow)} ${q.unit} at ${when(q.minAt, o)} vs ${round(q.level)} ${q.unit} line (${q.margin >= 0 ? '+' : ''}${round(q.margin)} ${q.unit}${q.hours !== undefined ? ` ≈ ${fmtDur(q.hours)} of burn` : ''})`);
  const secondary = rr.secondary
    ? `Next limit: ${relabel(leavesOf(rr.secondary).map((l) => l.why).join('; ') || rr.secondary.why, o)}${rr.bindingEdge !== 'tail' && Number.isFinite(rr.tail) ? ` (${fmtDur(rr.tail)} after the window)` : rr.bindingEdge === 'tail' && Number.isFinite(rr.lead) ? ` (lead margin ${fmtDur(rr.lead)})` : ''}`
    : undefined;
  const opts = (o.options ?? []).filter((x) => x.target === id);
  const options = opts.length
    ? opts.slice(0, o.maxOptions ?? 6).map((x) => {
      if (!x.available) return `${x.title}: unavailable (${x.unavailableReason}).`;
      const dl = x.deadline !== undefined ? `, act by ${when(x.deadline, o)}` : '';
      const inc = x.incomplete.length ? ` Incomplete: ${x.incomplete.join('; ')}.` : '';
      const se = x.sideEffects.filter((s) => s.delta < -1e-6 || s.after !== s.before).map((s) => `${s.label} ${s.before}→${s.after} (${fmtDelta(s.delta)})`);
      return `${x.title}: ${x.statusBefore}→${x.statusAfter}, ${relabel(x.why, o)}. Approval: ${x.authority}${dl}.${se.length ? ` Effects: ${se.join(', ')}.` : ''}${inc}`;
    })
    : [rr.status === 'Y' ? 'None needed.' : 'No option targets this requirement directly (see the mission-level options).'];
  const uncertainFlags = rr.chainFlags.filter((f) => UNCERTAIN_FLAGS.includes(f) || f === 'no-redundancy' || f === 'degraded' || f === 'non-monotone');
  const uncertainty = [
    ...uncertainFlags.map((f) => {
      const who = rr.chain.filter((c) => r.nodes[c]?.flags.includes(f)).map((c) => g.nodes.find((n) => n.id === c)?.label ?? c);
      return `${flagText(f)}${who.length ? `: ${who.join(', ')}` : ''}`;
    }),
    ...rr.reasons.filter((x) => x.includes(' reports ')).map((x) => relabel(x, o)),
    ...rr.flags.filter((f) => f === 'unreported-change').map(flagText),
  ];
  if (spec?.kind === 'requirement' && spec.reported) {
    const age = r.now - spec.reported.observedAt;
    if (age > 720) uncertainty.push(`${spec.reported.system} assessment is ${Math.floor(age / 24)} days old (reporting limit 30 days)`);
  }
  return {
    requirement: id, label, code: spec?.kind === 'requirement' ? spec.code : undefined, status: rr.status,
    upNow, whenNeeded, controlling, controllingLeaves: leaves.map((l) => ({ node: l.node, label: l.label, why: relabel(l.why, o), terminal: l.terminal })),
    alternatives, chain: chainText(rr.controlling, o),
    margin, marginHours: rr.margin, quantity, options, uncertainty, secondary, risk: o.risk?.text, reasons: rr.reasons,
  };
}

function round(x: number): number {
  return Math.round(x * 10) / 10;
}

export function fiveAnswersText(a: FiveAnswers): string {
  const lines = [
    `${a.code ? `[${a.code}] ` : ''}${a.label}: ${a.status}`,
    `  1 Up now?        ${a.upNow}`,
    `  2 When needed?   ${a.whenNeeded}`,
    `  3 Controls it:   ${a.controlling}`,
    ...a.alternatives.map((x) => `                   alternative: ${x}`),
    `  4 Margin:        ${a.margin}`,
    ...a.quantity.map((q) => `                   ${q}`),
    ...(a.secondary ? [`                   ${a.secondary}`] : []),
    `  5 Options:`,
    ...a.options.map((o) => `     - ${o}`),
  ];
  if (a.uncertainty.length) lines.push('  Uncertain:', ...a.uncertainty.map((u) => `     - ${u}`));
  if (a.risk) lines.push(`  Risk: ${a.risk}`);
  return lines.join('\n');
}
