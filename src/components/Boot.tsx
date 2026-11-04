import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { scenarioById } from '@/data/scenarios';
import { useStore } from '@/state/store';

const LINES: { tag: 'OK' | '--' | 'AI' | '!!'; text: string; sub?: string }[] = [
  { tag: 'OK', text: 'Red Hat Enterprise Linux 9.4', sub: 'DISA STIG profile applied · FIPS 140-3 mode · SELinux enforcing' },
  { tag: 'OK', text: 'RKE2 v1.31 (CIS hardened)', sub: '3/3 nodes Ready · etcd encrypted at rest' },
  { tag: 'OK', text: 'UDS Core', sub: 'Istio mTLS STRICT · Keycloak SSO (CAC) · NeuVector · Loki · Prometheus · Pepr policy' },
  { tag: 'OK', text: 'Zarf package navifi:0.9.3', sub: 'cosign signature verified · SBOM attested (412 components) · 0 critical CVEs' },
  { tag: 'OK', text: 'Lula OSCAL assessment', sub: '47/48 NIST 800-53 controls satisfied (AU · AC · SC · SI · CM)' },
  { tag: 'OK', text: 'Data adapters (read-only)', sub: 'OMMS-NG · R-Supply · NSIPS · SKED · DRRS-N · AMHS · CMS · HSM' },
  { tag: 'OK', text: 'Deterministic consequence engine', sub: 'self-test 27/27 · critical chain · slack · Monte Carlo (seeded)' },
  { tag: 'AI', text: 'Local LLM (in-cluster, OpenAI-compatible API)', sub: 'advisory narrative only · never source of operational truth' },
  { tag: '--', text: 'Shore link SATCOM 2.1 Mbps', sub: 'store-and-forward armed · core workflow runs fully disconnected' },
  { tag: '!!', text: 'HUMAN AUTHORITY ENFORCED', sub: 'agent may analyze, explain, propose · may not order, direct, authorize or modify records' },
];

const TAG_COLOR = { OK: '#34d399', '--': '#fbbf24', AI: '#a78bfa', '!!': '#22d3ee' };

export function Boot() {
  const setBooted = useStore((s) => s.setBooted);
  const log = useStore((s) => s.log);
  const ship = useStore((s) => scenarioById(s.scenarioId).ship);
  const [n, setN] = useState(0);
  const done = n >= LINES.length;

  useEffect(() => {
    if (done) return;
    const id = setTimeout(() => setN((x) => x + 1), n === 0 ? 500 : 260 + Math.random() * 220);
    return () => clearTimeout(id);
  }, [n, done]);

  const enter = () => {
    sessionStorage.setItem('navifi-booted', '1');
    log('SYSTEM', 'SESSION_START', 'Edge node verified; watch session opened', { lines: LINES.length });
    setBooted(true);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && enter();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

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
          <div className="mt-4 font-display text-5xl font-bold tracking-[0.35em] text-white glow-calc">NAVIFI</div>
          <div className="mt-2 font-display text-[11px] font-semibold tracking-[0.4em] text-calc/80">MISSION CONSEQUENCE ENGINE</div>
          <div className="mt-6 text-center font-mono text-[10.5px] leading-relaxed text-mute">
            EDGE NODE · {ship.name} ({ship.hull})
            <br />
            SYNTHETIC · UNCLASSIFIED
          </div>
        </motion.div>

        <div className="hud min-w-0 flex-1 p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="label !text-calc">System verification</span>
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
            <motion.div className="h-full bg-gradient-to-r from-calc to-blue-500 shadow-[0_0_12px_#22d3ee]" animate={{ width: `${(Math.min(n, LINES.length) / LINES.length) * 100}%` }} />
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
