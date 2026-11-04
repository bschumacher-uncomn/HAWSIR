#!/usr/bin/env node
// Advisory AI code review for merge requests.
// Sends the diff to an OpenAI-compatible endpoint (an in-cluster model inside the software factory;
// never a public API for controlled code). Writes findings to ai-review.md. It never approves or merges:
// a human reviewer of record is still required by branch protection.
//
// env:
//   AI_REVIEW_URL       base URL, e.g. http://vllm.factory.svc:8000   (unset = skip, exit 0)
//   AI_REVIEW_MODEL     model name (default: served model)
//   AI_REVIEW_KEY       bearer token, optional
//   BASE_REF            diff base (default origin/main)
//   AI_REVIEW_BLOCKING  "1" to fail the job on severity "block"
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const OUT = 'ai-review.md';
const write = (md) => {
  fs.writeFileSync(OUT, md);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  console.log(md);
};

const url = process.env.AI_REVIEW_URL?.replace(/\/$/, '');
if (!url) {
  write('### AI review\n_Skipped: no review endpoint configured (AI_REVIEW_URL)._');
  process.exit(0);
}

const base = process.env.BASE_REF ?? 'origin/main';
let diff;
try {
  diff = execFileSync('git', ['diff', '--unified=3', `${base}...HEAD`, '--', '.', ':(exclude)pnpm-lock.yaml', ':(exclude)compliance/*'], { encoding: 'utf8', maxBuffer: 32 << 20 });
} catch (e) {
  write(`### AI review\n_Skipped: could not compute diff against ${base} (${e.message.split('\n')[0]})._`);
  process.exit(0);
}
if (!diff.trim()) {
  write('### AI review\n_No changes to review._');
  process.exit(0);
}
const MAX = 60_000;
const truncated = diff.length > MAX;
if (truncated) diff = diff.slice(0, MAX);

const SYSTEM = `You review code for NAVIFI, a Navy shipboard readiness decision aid.
Focus, in priority order:
1. Any path where model output could change a calculated value, issue an order, or write to an authoritative record (must never happen).
2. Correctness of the deterministic engine (times, margins, monotonicity, off-by-one in windows).
3. Audit integrity (hash chain, append-only, no silent edits).
4. Security: injection, secrets, unsafe eval, SSRF, missing input validation.
5. Disconnected operation regressions (new hard network dependencies).
Reply with JSON only: {"summary": string, "findings": [{"file": string, "line": number, "severity": "block"|"warn"|"note", "message": string}]}.
Be specific and brief. Do not praise. Return an empty findings array if nothing matters.`;

let res;
try {
  const r = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.AI_REVIEW_KEY ? { Authorization: `Bearer ${process.env.AI_REVIEW_KEY}` } : {}) },
    body: JSON.stringify({
      model: process.env.AI_REVIEW_MODEL ?? 'default',
      temperature: 0.1,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Diff${truncated ? ' (truncated)' : ''}:\n\n${diff}` },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const text = j.choices?.[0]?.message?.content ?? '{}';
  res = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
} catch (e) {
  write(`### AI review\n_Reviewer unavailable (${e.message}). Human review proceeds as normal._`);
  process.exit(0);
}

const findings = Array.isArray(res.findings) ? res.findings : [];
const icon = { block: '⛔', warn: '⚠️', note: '💬' };
const rows = findings.map((f) => `| ${icon[f.severity] ?? '💬'} ${f.severity} | \`${f.file}${f.line ? `:${f.line}` : ''}\` | ${String(f.message).replace(/\|/g, '\\|')} |`);
write(
  [
    '### AI review (advisory)',
    res.summary ? `> ${res.summary}` : '',
    findings.length ? '| Severity | Where | Finding |\n|---|---|---|\n' + rows.join('\n') : '_No findings._',
    truncated ? '\n_Diff truncated to 60k characters._' : '',
    '\n_Advisory only. Merge requires approval from a human reviewer of record._',
  ].join('\n'),
);

const blocking = findings.filter((f) => f.severity === 'block').length;
process.exit(process.env.AI_REVIEW_BLOCKING === '1' && blocking ? 1 : 0);
