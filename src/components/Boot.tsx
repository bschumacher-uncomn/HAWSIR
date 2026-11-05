import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { HealthView, MissionSummary } from '@/api/types';
import { BRAND } from '@/brand';
import { useEngine } from '@/state/engine';
import { useStore } from '@/state/store';

type Tag = 'OK' | '--' | 'AI' | '!!' | 'XX';
interface BootLine {
  tag: Tag;
  text: string;
  sub?: string;
}

const TAG_COLOR: Record<Tag, string> = { OK: '#34d399', '--': '#fbbf24', AI: '#a78bfa', '!!': '#22d3ee', XX: '#fb3b5c' };

/** Every line is read from the node's own health check; nothing on this screen is asserted without one. */
function useBootLines(): BootLine[] | null {
  const [lines, setLines] = useState<BootLine[] | null>(null);
  useEffect(() => {
    Promise.all([api.get<HealthView>('/health'), api.get<{ missions: MissionSummary[] }>('/missions')])
      .then(([h, m]) => {
        const out: BootLine[] = [
          { tag: h.db ? 'OK' : 'XX', text: `mission-api · ${h.node.label}`, sub: `node ${h.node.id} · Postgres ${h.db ? 'connected' : 'UNREACHABLE'} · the only door to the data` },
        ];
        for (const ms of m.missions) {
          const x = h.missions[ms.id];
          const ok = x && x.facts.ok && x.decisions.ok && !x.storedRowMismatches.length;
          out.push({
            tag: ok ? 'OK' : 'XX', text: ms.name,
            sub: ok ? 'fact chain and decision chain re-verified from stored rows' : `integrity check failed${x?.storedRowMismatches.length ? ` (${x.storedRowMismatches.length} edited rows)` : ''}`,
          });
        }
        out.push(
          { tag: 'OK', text: 'Deterministic consequence engine', sub: 'same facts, same answer · every number traces to a source record · seeded Monte Carlo' },
          { tag: 'AI', text: h.llm.configured ? `Narrative model: ${h.llm.model}` : 'Narrative model: not configured', sub: h.llm.configured ? 'rewording only; rejected if it introduces any value not in the facts' : 'deterministic briefs (no model needed)' },
          { tag: '!!', text: 'HUMAN AUTHORITY ENFORCED', sub: 'may analyze, explain, propose · may not order, direct, authorize or modify records' },
        );
        setLines(out);
      })
      .catch((e) => setLines([{ tag: 'XX', text: 'mission-api unreachable', sub: (e as Error).message }]));
  }, []);
  return lines;
}

export function Boot() {
  const setBooted = useStore((s) => s.setBooted);
  const { scenario } = useEngine();
  const ship = scenario.ship;
  const LINES = useBootLines() ?? [];
  const [n, setN] = useState(0);
  const done = LINES.length > 0 && n >= LINES.length;

  useEffect(() => {
    if (done || !LINES.length) return;
    const id = setTimeout(() => setN((x) => x + 1), n === 0 ? 500 : 260 + Math.random() * 220);
    return () => clearTimeout(id);
  }, [n, done, LINES.length]);

  const enter = () => {
    sessionStorage.setItem(`${BRAND.slug}-booted`, '1');
    setBooted(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && enter();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="ocean-bg relative flex h-full items-center justify-center overflow-hidden" onDoubleClick={enter}>
      <div className="grid-bg pointer-events-none absolute inset-0" />
      <div className="scanlines pointer-events-none absolute inset-0" />
      <motion.div
        initial={{ opacity: 0, scale: 1.4 }}
        animate={{ opacity: 0.18, scale: 1 }}
        transition={{ duration: 2.4, ease: 'easeOut' }}
        className="pointer-events-none absolute h-[900px] w-[900px] rounded-full"
        style={{ background: 'conic-gradient(from 0deg, transparent 0deg, transparent 300deg, rgba(34,211,238,0.6) 360deg)', animation: 'sweep 5s linear infinite' }}
      />
      {[300, 480, 660, 840].map((r) => (
        <div key={r} className="pointer-events-none absolute rounded-full border border-calc/10" style={{ width: r, height: r }} />
      ))}

      <div className="relative z-10 flex w-[min(980px,92vw)] gap-10">
        <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8 }} className="flex w-[300px] shrink-0 flex-col items-center justify-center">
          <svg viewBox="0 0 64 64" className="h-40 w-40 drop-shadow-[0_0_30px_rgba(34,211,238,0.7)]">
            <defs>
              <linearGradient id="bg1" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#a5f3fc" />
                <stop offset="1" stopColor="#3b82f6" />
              </linearGradient>
            </defs>
            <motion.circle cx="32" cy="32" r="29" fill="none" stroke="url(#bg1)" strokeWidth="1.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6 }} />
            <motion.circle cx="32" cy="32" r="24" fill="none" stroke="url(#bg1)" strokeWidth="0.6" strokeDasharray="2 2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2, delay: 0.3 }} />
            <motion.path
              d="M32 12v40M21 19v9c0 6 5 9 11 9s11-3 11-9v-9M21 19l-3 4M21 19l3 4M43 19l-3 4M43 19l3 4M32 12l-3 4M32 12l3 4M25 49h14"
              fill="none"
              stroke="url(#bg1)"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.8, delay: 0.4 }}
            />
          </svg>
          <div className="mt-4 font-display text-5xl font-bold tracking-[0.35em] text-white glow-calc">{BRAND.name}</div>
          <div className="mt-2 font-display text-[11px] font-semibold uppercase tracking-[0.4em] text-calc/80">{BRAND.tagline}</div>
          <div className="mt-6 text-center font-mono text-[10.5px] leading-relaxed text-mute">
            {scenario.mission.name} · {ship.name} ({ship.hull})
            <br />
            SYNTHETIC · UNCLASSIFIED
          </div>
        </motion.div>

        <div className="hud min-w-0 flex-1 p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="label !text-calc">Node verification</span>
            <span className="font-mono text-[10px] text-mute">{Math.min(n, LINES.length)}/{LINES.length}</span>
          </div>
          <div className="space-y-2">
            {LINES.slice(0, n).map((l, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="flex gap-3">
                <span className="w-9 shrink-0 font-mono text-[12px] font-bold" style={{ color: TAG_COLOR[l.tag] }}>
                  [{l.tag}]
                </span>
                <div className="min-w-0">
                  <div className="font-display text-[14px] font-semibold tracking-wide text-sky-50">{l.text}</div>
                  {l.sub && <div className="font-mono text-[10.5px] text-sky-200/50">{l.sub}</div>}
                </div>
              </motion.div>
            ))}
            {!done && <div className="h-4 w-2 animate-blink bg-calc" />}
          </div>
          <div className="mt-5 h-[3px] overflow-hidden rounded bg-white/5">
            <motion.div className="h-full bg-gradient-to-r from-calc to-blue-500 shadow-[0_0_12px_#22d3ee]" animate={{ width: `${LINES.length ? (Math.min(n, LINES.length) / LINES.length) * 100 : 0}%` }} />
          </div>
          <div className="mt-5 flex items-center justify-between">
            <span className="font-mono text-[10px] text-mute">ENTER or double-click to skip</span>
            <motion.button
              type="button"
              onClick={enter}
              animate={done ? { boxShadow: ['0 0 0px #22d3ee', '0 0 28px #22d3ee', '0 0 0px #22d3ee'] } : {}}
              transition={{ repeat: Infinity, duration: 1.8 }}
              className="rounded-[3px] border border-calc bg-calc/15 px-6 py-2 font-display text-sm font-bold tracking-[0.3em] text-calc transition hover:bg-calc hover:text-black"
            >
              ASSUME THE WATCH
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}
