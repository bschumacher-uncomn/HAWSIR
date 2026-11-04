import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Box,
  CheckCircle2,
  ClipboardCheck,
  CloudOff,
  FileSignature,
  FlaskConical,
  GitCommitHorizontal,
  Loader2,
  Play,
  Radio,
  Satellite,
  Ship,
  ShieldCheck,
  Sparkles,
  UserCheck,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { useStore, type LinkMode } from '@/state/store';
import { Btn, Panel, Pill } from '@/components/ui';
import { cn } from '@/lib/util';
import { CONTROLS, HULLS, PIPELINE, STACK, type StageKind } from '@/data/platform';

interface Health {
  ok: boolean;
  node: string;
  uptime: number;
  llm: { configured: boolean; model: string | null };
  audit: number;
}

function useHealth() {
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    const pull = () =>
      fetch('/api/health', { signal: AbortSignal.timeout(2500) })
        .then((r) => r.json())
        .then((j: Health) => alive && (setH(j), setErr(false)))
        .catch(() => alive && setErr(true));
    pull();
    const id = setInterval(pull, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return { h, err };
}

const up = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`);

const STAGE_ICON: Record<StageKind, LucideIcon> = {
  source: GitCommitHorizontal,
  ai: Sparkles,
  human: UserCheck,
  test: FlaskConical,
  security: ShieldCheck,
  build: Box,
  supply: FileSignature,
  compliance: ClipboardCheck,
  deploy: Ship,
};

function Conduit({ color, delay }: { color: string; delay: number }) {
  return (
    <div className="relative h-full w-[2px]" style={{ background: `${color}22` }}>
      {[0, 0.5].map((o) => (
        <motion.span
          key={o}
          className="absolute left-1/2 h-[6px] w-[6px] -translate-x-1/2 rounded-full"
          style={{ background: color, boxShadow: `0 0 8px ${color}` }}
          animate={{ top: ['100%', '-10%'], opacity: [0, 1, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, delay: delay + o * 1.4, ease: 'linear' }}
        />
      ))}
    </div>
  );
}

function Stack() {
  const { h, err } = useHealth();
  const llmEnabled = useStore((s) => s.llmEnabled);
  const live: Record<string, string> = {
    'navifi-edge': err ? 'unreachable' : h ? `up ${up(h.uptime)}` : '…',
    'audit-pvc': h ? `${h.audit} rows` : '…',
    'vllm-narrator': !llmEnabled ? 'disabled by watch' : h?.llm.configured ? (h.llm.model ?? 'ready') : 'template mode',
    'navifi-web': 'serving',
  };
  return (
    <Panel
      title="Shipboard stack · one rack, no internet"
      index="EDG-1"
      className="h-full"
      right={
        <span className={cn('flex items-center gap-1.5 font-mono text-[10px]', err ? 'text-crit' : 'text-ok')}>
          <span className={cn('h-1.5 w-1.5 rounded-full', err ? 'bg-crit' : 'animate-blink bg-ok')} />
          {err ? 'EDGE API DOWN' : h ? `LIVE · ${h.node}` : 'connecting'}
        </span>
      }
      bodyClass="flex flex-col p-3"
    >
      {STACK.map((l, i) => (
        <div key={l.id} className="flex min-h-0 flex-1 flex-col">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: (STACK.length - i) * 0.12 }}
            className="relative flex min-h-0 flex-1 items-stretch gap-3 rounded-[4px] border px-3 py-2"
            style={{ borderColor: `${l.color}55`, background: `linear-gradient(90deg, ${l.color}14, transparent 70%)`, boxShadow: `0 7px 0 -2px ${l.color}22, inset 0 1px 0 ${l.color}33` }}
          >
            <div className="flex w-[190px] shrink-0 flex-col justify-center">
              <div className="font-display text-[17px] font-bold tracking-[0.2em]" style={{ color: l.color }}>
                {l.name}
              </div>
              <div className="text-[10.5px] leading-tight text-sky-200/60">{l.sub}</div>
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap content-center gap-1.5">
              {l.chips.map((c) => (
                <div key={c.label} className="flex items-center gap-1.5 rounded-[3px] border bg-black/40 px-2 py-1" style={{ borderColor: `${l.color}30` }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: live[c.label] === 'unreachable' ? '#fb3b5c' : '#34d399', boxShadow: '0 0 6px #34d399' }} />
                  <span className="font-mono text-[11px] font-semibold text-sky-50">{c.label}</span>
                  <span className="font-mono text-[9.5px] text-mute">{live[c.label] ?? c.note}</span>
                </div>
              ))}
            </div>
          </motion.div>
          {i < STACK.length - 1 && (
            <div className="flex h-[18px] shrink-0 justify-around px-24">
              {[0, 1, 2, 3, 4].map((k) => (
                <Conduit key={k} color={STACK[i + 1].color} delay={k * 0.27 + i * 0.1} />
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="mt-2 flex shrink-0 items-center justify-between font-mono text-[9.5px] text-mute">
        <span>Ship hardware · CANES-class rack (notional)</span>
        <span>Images from the Zarf-seeded local registry · egress default-deny</span>
      </div>
    </Panel>
  );
}

function Pipeline() {
  const [step, setStep] = useState(-1);
  const [runId, setRunId] = useState(0);
  useEffect(() => {
    setStep(0);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setStep(i);
      if (i >= PIPELINE.length) clearInterval(id);
    }, 520);
    return () => clearInterval(id);
  }, [runId]);
  const done = step >= PIPELINE.length;
  const total = PIPELINE.reduce((a, s) => a + s.secs, 0);
  return (
    <Panel
      title="AI-assisted CI/CD · commit to hull"
      index="EDG-2"
      className="h-full"
      right={
        <>
          <span className={cn('font-mono text-[10.5px] font-bold', done ? 'text-ok' : 'text-calc')}>{done ? `PASSED · ${Math.floor(total / 60)}m ${total % 60}s` : `STAGE ${Math.min(step + 1, PIPELINE.length)}/${PIPELINE.length}`}</span>
          <Btn tone="calc" onClick={() => setRunId((r) => r + 1)} disabled={!done}>
            <Play size={11} /> Run
          </Btn>
        </>
      }
      bodyClass="relative overflow-y-auto px-3 py-2"
    >
      <div className="absolute bottom-4 left-[29px] top-4 w-[2px] bg-sky-300/10" />
      <motion.div className="absolute left-[29px] top-4 w-[2px] bg-gradient-to-b from-calc to-ok" animate={{ height: `calc(${(Math.min(step, PIPELINE.length) / PIPELINE.length) * 100}% - 16px)` }} transition={{ duration: 0.4 }} />
      {PIPELINE.map((s, i) => {
        const Icon = STAGE_ICON[s.kind];
        const state = i < step ? 'done' : i === step ? 'run' : 'wait';
        const col = s.kind === 'ai' ? '#a78bfa' : s.kind === 'human' ? '#fbbf24' : state === 'done' ? '#34d399' : '#22d3ee';
        return (
          <div key={s.id} className={cn('relative flex items-center gap-3 py-[5px]', state === 'wait' && 'opacity-40')}>
            <div className="relative z-10 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border bg-abyss" style={{ borderColor: col, boxShadow: state !== 'wait' ? `0 0 12px -2px ${col}` : undefined }}>
              {state === 'run' ? <Loader2 size={13} className="animate-spin" style={{ color: col }} /> : <Icon size={13} style={{ color: col }} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-sky-50">{s.name}</span>
                {s.kind === 'ai' && <span className="rounded-[2px] bg-ai/15 px-1 font-display text-[8.5px] font-bold tracking-[0.14em] text-ai">ADVISORY</span>}
                {s.kind === 'human' && <span className="rounded-[2px] bg-unc/15 px-1 font-display text-[8.5px] font-bold tracking-[0.14em] text-unc">GATE</span>}
              </div>
              <div className="truncate font-mono text-[9.5px] text-mute">{s.tool}</div>
            </div>
            <span className={cn('shrink-0 text-right font-mono text-[10.5px]', state === 'done' ? (s.kind === 'ai' ? 'text-ai' : 'text-ok') : 'text-mute')}>{state === 'done' ? s.result : state === 'run' ? (s.kind === 'human' ? 'awaiting reviewer…' : 'running…') : ''}</span>
            <span className="w-[34px] shrink-0 text-right font-mono text-[9.5px] text-mute">{state === 'done' && s.secs ? `${s.secs}s` : ''}</span>
          </div>
        );
      })}
      <div className="mt-1 border-t border-sky-300/10 pt-1.5 font-mono text-[9.5px] text-mute">AI review is advisory; merge requires a human. Pipeline: .github/workflows/ci.yml · .gitlab-ci.yml · zarf.yaml (in repo)</div>
    </Panel>
  );
}

const LINKS: { id: LinkMode; label: string; icon: LucideIcon; color: string; note: string }[] = [
  { id: 'SATCOM', label: 'SATCOM', icon: Satellite, color: '#34d399', note: 'Audit forwards in seconds; shore LLM allowed' },
  { id: 'DDIL', label: 'DDIL', icon: Radio, color: '#fbbf24', note: 'Trickle sync; local LLM or template' },
  { id: 'DENIED', label: 'EMCON', icon: WifiOff, color: '#fb3b5c', note: 'Nothing leaves the ship; everything still works' },
];

function Ddil() {
  const link = useStore((s) => s.link);
  const setLink = useStore((s) => s.setLink);
  const llm = useStore((s) => s.llmEnabled);
  const setLlm = useStore((s) => s.setLlm);
  const queued = useStore((s) => s.audit.filter((e) => !e.shoreSynced).length);
  const caps = [
    ['Consequence engine', true],
    ['Options + slack analysis', true],
    ['Monte Carlo', true],
    ['Theater map (offline tiles)', true],
    ['Audit chain', true],
    ['Narrative', link === 'DENIED' ? 'template' : llm],
    ['Shore reach-back', link === 'SATCOM'],
  ] as const;
  return (
    <Panel title="Disconnected operations" index="EDG-3" className="h-full" bodyClass="flex flex-col gap-2 p-3">
      <div className="grid grid-cols-3 gap-1.5">
        {LINKS.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setLink(l.id)}
            className={cn('flex flex-col items-center gap-0.5 rounded-[3px] border py-1.5 transition', link === l.id ? 'bg-white/[0.06]' : 'border-sky-300/10 opacity-60 hover:opacity-100')}
            style={link === l.id ? { borderColor: l.color, boxShadow: `0 0 16px -6px ${l.color}` } : undefined}
          >
            <l.icon size={15} style={{ color: l.color }} />
            <span className="font-display text-[10px] font-bold tracking-[0.16em]" style={{ color: l.color }}>
              {l.label}
            </span>
          </button>
        ))}
      </div>
      <div className="text-[11px] text-sky-200/70">{LINKS.find((l) => l.id === link)?.note}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {caps.map(([k, v]) => (
          <div key={k} className="flex items-center gap-1.5 text-[11px]">
            {v === true ? <CheckCircle2 size={11} className="text-ok" /> : v === 'template' ? <Sparkles size={11} className="text-unc" /> : <CloudOff size={11} className="text-mute" />}
            <span className={v ? 'text-sky-100/85' : 'text-mute line-through'}>{k}</span>
            {v === 'template' && <span className="font-mono text-[9px] text-unc">template</span>}
          </div>
        ))}
      </div>
      <div className="mt-auto flex items-center gap-3 border-t border-sky-300/10 pt-2">
        <span className="font-mono text-[10.5px] text-mute">AUDIT QUEUED</span>
        <span className={cn('font-mono text-[14px] font-bold', queued ? 'text-unc' : 'text-ok')}>{queued}</span>
        <label className="ml-auto flex cursor-pointer items-center gap-2 font-mono text-[10.5px] text-sky-200/80">
          LLM narrative
          <button type="button" onClick={() => setLlm(!llm)} className={cn('relative h-[16px] w-[30px] rounded-full border transition', llm ? 'border-ai/60 bg-ai/30' : 'border-sky-300/20 bg-black/40')}>
            <span className={cn('absolute top-[1px] h-[12px] w-[12px] rounded-full transition-all', llm ? 'left-[15px] bg-ai' : 'left-[1px] bg-sky-300/40')} />
          </button>
        </label>
      </div>
    </Panel>
  );
}

function Compliance() {
  const ok = CONTROLS.filter((c) => c.satisfied).length;
  const fams = useMemo(() => {
    const m = new Map<string, { ok: number; n: number }>();
    for (const c of CONTROLS) {
      const f = m.get(c.family) ?? { ok: 0, n: 0 };
      f.n++;
      if (c.satisfied) f.ok++;
      m.set(c.family, f);
    }
    return [...m.entries()];
  }, []);
  const open = CONTROLS.filter((c) => !c.satisfied);
  const r = 34;
  const C = 2 * Math.PI * r;
  return (
    <Panel title="Compliance as code · NIST 800-53" index="EDG-4" className="h-full" right={<Pill color="#2dd4bf">Lula → OSCAL</Pill>} bodyClass="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-4">
        <svg width={88} height={88} viewBox="-44 -44 88 88" className="shrink-0">
          <circle r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={7} />
          <motion.circle r={r} fill="none" stroke="#2dd4bf" strokeWidth={7} strokeLinecap="round" transform="rotate(-90)" strokeDasharray={C} initial={{ strokeDashoffset: C }} animate={{ strokeDashoffset: C * (1 - ok / CONTROLS.length) }} transition={{ duration: 1.4 }} />
          <text textAnchor="middle" y={4} className="fill-white font-mono text-[17px] font-bold">
            {ok}/{CONTROLS.length}
          </text>
          <text textAnchor="middle" y={18} className="fill-[#6b8aa3] font-mono text-[8px]">
            CONTROLS
          </text>
        </svg>
        <div className="grid min-w-0 flex-1 grid-cols-4 gap-x-2 gap-y-1">
          {fams.map(([f, v]) => (
            <div key={f} className="flex items-center gap-1">
              <span className="w-[22px] font-mono text-[10px] font-bold text-sky-100">{f}</span>
              <div className="flex gap-[2px]">
                {Array.from({ length: v.n }, (_, i) => (
                  <span key={i} className="h-[9px] w-[4px] rounded-[1px]" style={{ background: i < v.ok ? '#2dd4bf' : '#fbbf24' }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      {open.map((c) => (
        <div key={c.id} className="rounded-[3px] border border-unc/30 bg-unc/[0.05] px-2 py-1.5 text-[11px]">
          <span className="font-mono font-bold text-unc">{c.id}</span> <span className="text-sky-100">{c.title}</span>
          <div className="text-[10.5px] text-sky-200/60">{c.by}</div>
        </div>
      ))}
      <div className="mt-auto font-mono text-[9.5px] text-mute">compliance/oscal-component.yaml · validated in CI on every commit</div>
    </Panel>
  );
}

const HULL_COLOR = { live: '#34d399', syncing: '#fbbf24', staged: '#60a5fa', pending: '#475569' } as const;

function Fleet() {
  const counts = HULLS.reduce<Record<string, number>>((m, h) => ((m[h.state] = (m[h.state] ?? 0) + 1), m), {});
  return (
    <Panel title="Fleet rollout · same package, every hull" index="EDG-5" className="h-full" bodyClass="flex flex-col gap-2 p-3">
      <div className="grid grid-cols-4 gap-1.5">
        {HULLS.map((h, i) => {
          const col = HULL_COLOR[h.state];
          return (
            <motion.div key={h.hull} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.04 }} className="relative overflow-hidden rounded-[3px] border bg-black/40 px-2 py-1.5" style={{ borderColor: `${col}50` }}>
              <div className="flex items-center gap-1.5">
                <span className={cn('h-1.5 w-1.5 rounded-full', h.state === 'live' && 'animate-blink')} style={{ background: col, boxShadow: `0 0 6px ${col}` }} />
                <span className="font-mono text-[11px] font-bold text-white">{h.hull}</span>
              </div>
              <div className="truncate font-mono text-[9px]" style={{ color: h.state === 'pending' ? '#6b8aa3' : col }}>
                {h.version ?? 'not installed'}
              </div>
              {h.state === 'syncing' && <motion.div className="absolute bottom-0 left-0 h-[2px] bg-unc" animate={{ width: ['0%', '100%'] }} transition={{ duration: 3.2, repeat: Infinity }} />}
            </motion.div>
          );
        })}
      </div>
      <div className="flex gap-3 font-mono text-[10px]">
        {(['live', 'syncing', 'staged', 'pending'] as const).map((s) => (
          <span key={s} style={{ color: HULL_COLOR[s] === '#475569' ? '#6b8aa3' : HULL_COLOR[s] }}>
            {counts[s] ?? 0} {s.toUpperCase()}
          </span>
        ))}
      </div>
      <div className="mt-auto text-[10.5px] text-sky-200/60">Workflows ship as data inside the bundle. Updates ride the next sync window or a port visit. Synthetic fleet shown.</div>
    </Panel>
  );
}

export default function EdgePlatform() {
  return (
    <div className="grid h-full grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_272px] gap-3 p-3">
      <div className="hud col-span-2 flex items-center gap-3 px-3 py-2">
        <div>
          <div className="label !text-[9px] !text-calc/80">Edge platform · speed to fleet</div>
          <div className="font-display text-[14px] font-bold tracking-[0.18em] text-white">FROM COMMIT TO HULL, AIR-GAPPED</div>
        </div>
        <Pill color="#f87171">RHEL 9 STIG</Pill>
        <Pill color="#60a5fa">RKE2 CIS</Pill>
        <Pill color="#2dd4bf">UDS Core</Pill>
        <Pill color="#2dd4bf">Zarf air-gap</Pill>
        <Pill color="#a78bfa">AI-assisted, human-approved</Pill>
        <span className="ml-auto font-mono text-[10px] text-mute">Built for Defense Unicorns UDS · deploy/, zarf.yaml, uds-bundle.yaml in repo</span>
      </div>
      <Stack />
      <Pipeline />
      <div className="col-span-2 grid min-h-0 grid-cols-3 gap-3">
        <Ddil />
        <Compliance />
        <Fleet />
      </div>
    </div>
  );
}
