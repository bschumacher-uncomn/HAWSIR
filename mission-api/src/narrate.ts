import brand from '../../brand.json';
import type { Config } from './config';
import type { NarrateRequest, NarrateResult } from './views/contract';

/**
 * Optional rephrasing of the deterministic brief by a language model (an
 * in-cluster OpenAI-compatible endpoint). The model only rewords: its output
 * is rejected unless every time, duration and number in it already appears in
 * the facts it was given, so a model can never introduce a value the engine
 * did not compute. With no model configured, or on any failure, the
 * deterministic template is returned unchanged.
 */
const SYSTEM = `You are the advisory narrator inside ${brand.name}, a Navy readiness decision aid.
Rewrite the provided calculated facts into a concise watch brief (3-5 sentences, plain language, no markdown).
Rules: use ONLY the facts given; never invent times, people, parts or numbers; keep every time and margin exactly as written;
never recommend issuing orders; refer to options as "bounded options for the watchstander's decision".`;

/** Tokens that carry a value: D-5 2200, H-6:00, 4d 10h, 37h, 12%, plain numbers. */
const VALUE_TOKENS = /D[-+]\d+(?:\s\d{4})?|H[-+]\d+:\d{2}|\d+(?:\.\d+)?\s?(?:d|h|m|%)\b|\d+(?:\.\d+)?/g;

export function valuesIn(text: string): Set<string> {
  return new Set((text.match(VALUE_TOKENS) ?? []).map((t) => t.replace(/\s+/g, '')));
}

/** Every value the model wrote must be one the engine wrote. */
export function faithful(output: string, sources: string[]): { ok: boolean; extra: string[] } {
  const allowed = new Set(sources.flatMap((s) => [...valuesIn(s)]));
  const extra = [...valuesIn(output)].filter((v) => !allowed.has(v));
  return { ok: extra.length === 0, extra };
}

export const narrateStats = { llm: 0, rejected: 0, failed: 0, template: 0 };

export async function narrate(cfg: Config, req: NarrateRequest): Promise<NarrateResult> {
  const t0 = Date.now();
  const facts = (Array.isArray(req.facts) ? req.facts : []).filter((x) => typeof x === 'string').slice(0, 30).map((x) => x.slice(0, 400));
  const brief = typeof req.brief === 'string' ? req.brief.slice(0, 2000) : '';
  const template = (): NarrateResult => {
    narrateStats.template++;
    return { text: brief, source: 'template', ms: Date.now() - t0 };
  };
  if (!cfg.llm || !brief) return template();
  try {
    const r = await fetch(`${cfg.llm.url}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cfg.llm.key ? { Authorization: `Bearer ${cfg.llm.key}` } : {}) },
      body: JSON.stringify({
        model: cfg.llm.model,
        temperature: 0.2,
        max_tokens: 260,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `FACTS:\n- ${facts.join('\n- ')}\n\nDETERMINISTIC DRAFT:\n${brief}` },
        ],
      }),
      signal: AbortSignal.timeout(cfg.llm.timeoutMs),
    });
    if (!r.ok) throw new Error(`llm ${r.status}`);
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const text = j.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) throw new Error('empty completion');
    const check = faithful(text, [...facts, brief]);
    if (!check.ok) {
      narrateStats.rejected++;
      console.warn(`narrative rejected: model introduced ${check.extra.join(', ')}`);
      return template();
    }
    narrateStats.llm++;
    return { text, source: 'llm', model: cfg.llm.model, ms: Date.now() - t0 };
  } catch (e) {
    narrateStats.failed++;
    console.warn(`narrative fell back to template: ${(e as Error).message}`);
    return template();
  }
}
