import { useEffect, useState } from 'react';
import type { CapabilityResult, Line, OptionEval, Scenario } from '@/engine';
import { fmtDur, fmtT } from '@/engine/time';
import type { EventImpact } from '@/state/engine';
import { useStore } from '@/state/store';

export type NarrativeSource = 'LLM' | 'TEMPLATE' | 'HALTED';

/** Deterministic brief composed only from calculated facts. Always available offline. */
export function templateBrief(s: Scenario, cap: CapabilityResult, focus: EventImpact | undefined, options: OptionEval[], lines: Line[]): string {
  const parts: string[] = [];
  if (focus && focus.event.kind !== 'baseline') {
    const d = focus.diff.caps.find((c) => c.id === cap.id);
    const moved = d && (Math.abs(d.marginDelta) > 1e-6 || d.statusChanged);
    parts.push(
      `Latest change: ${focus.event.title.replace(/\.$/, '')} (${focus.event.source.system}, ${fmtT(s, focus.event.t)}). ${
        moved ? `${cap.code} margin moved ${fmtDur(d!.marginDelta, { signed: true })}.` : `No change to ${cap.code}.`
      }`,
    );
  }
  const m = cap.margin >= 0 ? `${fmtDur(cap.margin)} of margin` : `a ${fmtDur(-cap.margin)} shortfall`;
  parts.push(`${cap.code} is ${cap.status}: ready ${fmtT(s, cap.ready)} against a ${fmtT(s, cap.requiredBy)} requirement, ${m}.`);
  if (!cap.upNow) {
    const ctl = lines.find((l) => l.kind === 'control');
    if (ctl) parts.push(ctl.text.replace(/^Controlling constraint: /, 'Readiness is controlled by '));
    if (cap.coCritical.length) parts.push(`Other constraints bind at the same moment, so fixing only one will not help.`);
  }
  const ineffective = options.filter((o) => o.available && !o.effective && o.levers[0].category !== 'accept');
  const best = options.find((o) => o.available && o.effective && o.levers.every((l) => l.category !== 'accept'));
  if (ineffective.length && best && best.levers.length > 1) {
    parts.push(`No single action recovers margin. The best bounded package is ${best.levers.map((l) => l.title).join(' + ')} (${fmtDur(best.recovered, { signed: true })}), which needs ${best.levers.some((l) => !l.withinShipAuthority) ? 'off-ship' : 'CO'} approval.`);
  } else if (best) {
    parts.push(`Best bounded option: ${best.levers.map((l) => l.title).join(' + ')} (${fmtDur(best.recovered, { signed: true })}, ${best.levers[0].authority}).`);
  }
  const unc = lines.filter((l) => l.kind === 'uncertainty').length;
  if (unc) parts.push(`${unc} data-quality flag${unc > 1 ? 's' : ''} sit on the critical chain; verify before acting.`);
  const cliff = lines.find((l) => l.kind === 'cliff');
  if (cliff) parts.push(cliff.text);
  return parts.join(' ');
}

const cache = new Map<string, string>();
let llmConfigured: Promise<boolean> | null = null;
const probeLlm = () =>
  (llmConfigured ??= fetch('/api/health', { signal: AbortSignal.timeout(3000) })
    .then((r) => r.json())
    .then((j: { llm?: { configured?: boolean } }) => !!j.llm?.configured)
    .catch(() => false));

export function useNarrative(key: string, facts: string[], fallback: string): { text: string; source: NarrativeSource } {
  const link = useStore((s) => s.link);
  const llm = useStore((s) => s.llmEnabled);
  const halted = useStore((s) => s.halted);
  const [state, setState] = useState<{ text: string; source: NarrativeSource }>({ text: fallback, source: 'TEMPLATE' });

  useEffect(() => {
    if (halted) {
      setState({ text: 'Narrative suspended by STOP. Calculated picture remains visible.', source: 'HALTED' });
      return;
    }
    setState({ text: fallback, source: 'TEMPLATE' });
    if (!llm) return;
    const k = `${key}|${link}`;
    if (cache.has(k)) {
      setState({ text: cache.get(k)!, source: 'LLM' });
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), link === 'DDIL' ? 4000 : 9000);
    probeLlm()
      .then((ok) => (ok ? fetch('/api/narrate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facts, draft: fallback }), signal: ctl.signal }) : Promise.reject('no llm')))
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j: { text?: string; model?: string }) => {
        if (j.text) {
          cache.set(k, j.text);
          setState({ text: j.text, source: 'LLM' });
          useStore.getState().log('AI', 'NARRATIVE', `Explanation drafted by ${j.model ?? 'LLM'} from ${facts.length} calculated facts; calculations unchanged`, { facts: facts.length, model: j.model });
        }
      })
      .catch(() => undefined)
      .finally(() => clearTimeout(t));
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, link, llm, halted]);

  return state;
}
