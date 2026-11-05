import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { CapabilityResult, Line, NarrateResult, OptionEval, Scenario } from '@/api/types';
import { fmtDelta, fmtDur, fmtMargin, fmtT } from '@/lib/time';
import { useEngine, type EventImpact } from '@/state/engine';
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
        moved ? `${cap.code} margin moved ${fmtDelta(d!.marginDelta)}.` : `No change to ${cap.code}.`
      }`,
    );
  }
  const m = cap.marginKind === 'never' ? 'no path inside the planning horizon' : cap.marginKind === 'atLeast' ? `${fmtMargin(cap.margin, cap.marginKind)} of margin (nothing in the horizon limits it)` : cap.margin >= 0 ? `${fmtDur(cap.margin)} of margin` : `a ${fmtDur(-cap.margin)} shortfall`;
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

const cache = new Map<string, NarrateResult>();
let llmConfigured: Promise<boolean> | null = null;
const probeLlm = () =>
  (llmConfigured ??= api
    .get<{ llm?: { configured?: boolean } }>('/health')
    .then((j) => !!j.llm?.configured)
    .catch(() => false));

/**
 * The brief on screen. The deterministic template is always shown first; when
 * the node has a language model configured, mission-api may return a reworded
 * version, and only after checking that every value in it came from the facts.
 */
export function useNarrative(key: string, facts: string[], fallback: string): { text: string; source: NarrativeSource } {
  const { snapshot, halted, link } = useEngine();
  const llm = useStore((s) => s.llmEnabled);
  const [state, setState] = useState<{ text: string; source: NarrativeSource }>({ text: fallback, source: 'TEMPLATE' });

  useEffect(() => {
    if (halted.stopped) {
      setState({ text: 'Narrative suspended by STOP. Calculated picture remains visible.', source: 'HALTED' });
      return;
    }
    setState({ text: fallback, source: 'TEMPLATE' });
    if (!llm || !fallback) return;
    const hit = cache.get(key);
    if (hit) {
      setState({ text: hit.text, source: hit.source === 'llm' ? 'LLM' : 'TEMPLATE' });
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), link.up ? 9000 : 4000);
    probeLlm()
      .then((ok) => (ok ? api.post<NarrateResult>('/narrate', { mission: snapshot.mission, key, facts, brief: fallback }, ctl.signal) : Promise.reject(new Error('no llm'))))
      .then((r) => {
        cache.set(key, r);
        if (r.source === 'llm' && r.text) setState({ text: r.text, source: 'LLM' });
      })
      .catch(() => undefined)
      .finally(() => clearTimeout(t));
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, llm, halted.stopped]);

  return state;
}
