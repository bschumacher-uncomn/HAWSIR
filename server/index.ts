import compression from 'compression';
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { entryHash, type ChainEntry } from '../src/lib/audit';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const line of fs.existsSync(path.join(root, '.env')) ? fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n') : []) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const PORT = Number(process.env.PORT ?? 8810);
const RUNTIME = process.env.NAVIFI_RUNTIME_DIR ?? path.join(root, 'data', 'runtime');
const AUDIT = path.join(RUNTIME, 'audit.jsonl');
/** Any OpenAI-compatible endpoint: in-cluster vLLM / Ollama on the edge node, or a shore endpoint when connected. */
const LLM_URL = (process.env.NAVIFI_LLM_URL ?? (process.env.OPENAI_API_KEY ? 'https://api.openai.com/v1' : '')).replace(/\/$/, '');
const LLM_KEY = process.env.NAVIFI_LLM_KEY ?? process.env.OPENAI_API_KEY ?? '';
const LLM_MODEL = process.env.NAVIFI_LLM_MODEL ?? 'gpt-4o-mini';

fs.mkdirSync(RUNTIME, { recursive: true });

const app = express();
app.use(compression());
app.use(express.json({ limit: '1mb' }));

const auditRows = () => (fs.existsSync(AUDIT) ? fs.readFileSync(AUDIT, 'utf8').split('\n').filter(Boolean).length : 0);
const counters = { auditAccepted: 0, auditRejected: 0, narrateOk: 0, narrateFail: 0 };

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    node: process.env.NODE_NAME ?? os.hostname(),
    uptime: process.uptime(),
    llm: { configured: !!LLM_URL, model: LLM_URL ? LLM_MODEL : null },
    audit: auditRows(),
  });
});

app.get('/api/metrics', (_req, res) => {
  res.type('text/plain; version=0.0.4').send(
    [
      '# HELP navifi_up Edge node is serving.',
      '# TYPE navifi_up gauge',
      'navifi_up 1',
      '# TYPE navifi_uptime_seconds gauge',
      `navifi_uptime_seconds ${process.uptime().toFixed(0)}`,
      '# TYPE navifi_audit_rows gauge',
      `navifi_audit_rows ${auditRows()}`,
      '# TYPE navifi_audit_entries_total counter',
      `navifi_audit_entries_total{verified="true"} ${counters.auditAccepted}`,
      `navifi_audit_entries_total{verified="false"} ${counters.auditRejected}`,
      '# TYPE navifi_narrate_requests_total counter',
      `navifi_narrate_requests_total{result="ok"} ${counters.narrateOk}`,
      `navifi_narrate_requests_total{result="fail"} ${counters.narrateFail}`,
      '# TYPE navifi_llm_configured gauge',
      `navifi_llm_configured ${LLM_URL ? 1 : 0}`,
      '',
    ].join('\n'),
  );
});

app.post('/api/audit', (req, res) => {
  const e = req.body as ChainEntry;
  const valid = typeof e?.hash === 'string' && entryHash(e) === e.hash;
  counters[valid ? 'auditAccepted' : 'auditRejected']++;
  fs.appendFileSync(AUDIT, `${JSON.stringify({ ...e, serverVerified: valid, receivedAt: new Date().toISOString() })}\n`);
  res.status(valid ? 200 : 422).json({ ok: valid });
});

app.get('/api/audit', (_req, res) => {
  const rows = fs.existsSync(AUDIT) ? fs.readFileSync(AUDIT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  res.json(rows.slice(-500));
});

const SYSTEM = `You are the advisory narrator inside NAVIFI, a Navy shipboard readiness decision aid.
Rewrite the provided calculated facts into a concise watch brief (3-5 sentences, plain language, no markdown).
Rules: use ONLY the facts given; never invent times, people, parts or numbers; keep every time and margin exactly as written;
never recommend issuing orders; refer to options as "bounded options for the watchstander's decision".`;

app.post('/api/narrate', async (req, res) => {
  if (!LLM_URL) return res.status(503).json({ error: 'no LLM configured' });
  const { facts, draft } = req.body as { facts: string[]; draft: string };
  try {
    const r = await fetch(`${LLM_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(LLM_KEY ? { Authorization: `Bearer ${LLM_KEY}` } : {}) },
      body: JSON.stringify({
        model: LLM_MODEL,
        temperature: 0.2,
        max_tokens: 260,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `FACTS:\n- ${facts.slice(0, 30).join('\n- ')}\n\nDETERMINISTIC DRAFT:\n${draft}` },
        ],
      }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) {
      counters.narrateFail++;
      return res.status(502).json({ error: `llm ${r.status}` });
    }
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    counters.narrateOk++;
    res.json({ text: j.choices?.[0]?.message?.content?.trim() ?? '', model: LLM_MODEL });
  } catch (err) {
    counters.narrateFail++;
    res.status(504).json({ error: String(err) });
  }
});

const dist = path.join(root, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { maxAge: '1h', index: false }));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`NAVIFI edge node on :${PORT} · LLM ${LLM_URL ? `${LLM_MODEL} @ ${LLM_URL}` : 'not configured (template narrative)'} · audit ${AUDIT}`);
});
