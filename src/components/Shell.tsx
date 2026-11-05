import {
  Activity,
  Cpu,
  FastForward,
  Globe,
  Network,
  OctagonX,
  Pause,
  Play,
  Radar,
  Rewind,
  Satellite,
  ScrollText,
  Server,
  ShieldCheck,
  SkipForward,
  TestTube,
  WifiOff,
  Workflow,
} from 'lucide-react';
import { Component, type ErrorInfo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { useLiveUpdates } from '@/api/stream';
import { useRemote } from '@/api/useRemote';
import { useMissions } from '@/api/hooks';
import type { HealthView } from '@/api/types';
import { BRAND } from '@/brand';
import { dtg, fmtDelta, fmtDur, fmtT } from '@/lib/time';
import { actions } from '@/state/actions';
import { useEngine, type EventImpact } from '@/state/engine';
import { useFlash } from '@/state/flash';
import { useStore, type LinkMode } from '@/state/store';
import { cn } from '@/lib/util';
import { Tour } from './Tour';
import { RadarSweep } from './ui';

const NAV = [
  { to: '/', icon: Radar, label: 'Watch Floor', hint: 'Five answers' },
  { to: '/thread', icon: Workflow, label: 'Mission Thread', hint: 'Executable thread' },
  { to: '/graph', icon: Network, label: 'Consequence Graph', hint: 'What controls' },
  { to: '/theater', icon: Globe, label: 'Theater', hint: 'Every movement on the map' },
  { to: '/lab', icon: TestTube, label: 'Fleet Lab', hint: 'Whole fleet · disruptions · slips' },
  { to: '/log', icon: ScrollText, label: 'Decision Log', hint: 'Hash-chained record' },
  { to: '/edge', icon: Server, label: 'Edge Platform', hint: 'How it deploys' },
];

export function ClassBanner() {
  return (
    <div className="relative z-30 flex h-[18px] shrink-0 items-center justify-center bg-[#007a33] font-display text-[10.5px] font-bold tracking-[0.3em] text-white">
      UNCLASSIFIED // SYNTHETIC DATA · FLEETHACKER NORFOLK 2026 · NOT AN AUTHORITATIVE RECORD
    </div>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5 pr-2">
      <div className="relative h-9 w-9">
        <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full drop-shadow-[0_0_10px_rgba(34,211,238,0.6)]">
          <defs>
            <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#67e8f9" />
              <stop offset="1" stopColor="#3b82f6" />
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r="29" fill="none" stroke="url(#lg)" strokeWidth="2" strokeDasharray="4 3" className="origin-center animate-[sweep_20s_linear_infinite]" />
          <path d="M32 12v40M21 19v9c0 6 5 9 11 9s11-3 11-9v-9M21 19l-3 4M21 19l3 4M43 19l-3 4M43 19l3 4M32 12l-3 4M32 12l3 4M25 49h14" fill="none" stroke="url(#lg)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="leading-none">
        <div className="font-display text-[19px] font-bold tracking-[0.28em] text-white glow-calc">{BRAND.name}</div>
        <div className="mt-0.5 whitespace-nowrap font-display text-[8.5px] font-semibold uppercase tracking-[0.24em] text-calc/70">{BRAND.tagline}</div>
      </div>
    </div>
  );
}

/** The data link is the node's (mission-api); EMCON and DDIL both cut it, the label says why. */
function LinkControl() {
  const { link, scenario } = useEngine();
  const mode: LinkMode = link.up ? 'SATCOM' : /emcon/i.test(link.reason ?? '') ? 'DENIED' : 'DDIL';
  const modes: { m: LinkMode; label: string; bars: number; color: string }[] = [
    { m: 'SATCOM', label: 'SATCOM', bars: 4, color: '#34d399' },
    { m: 'DDIL', label: 'DDIL', bars: 2, color: '#fbbf24' },
    { m: 'DENIED', label: 'EMCON', bars: 0, color: '#fb3b5c' },
  ];
  const set = (m: LinkMode) => {
    if (m === mode) return;
    void actions.setLink(m === 'SATCOM', m === 'SATCOM' ? 'Data link restored by watchstander' : m === 'DENIED' ? 'EMCON set by watchstander: no ship-to-shore data path' : 'Link degraded (DDIL) set by watchstander');
  };
  return (
    <div className="flex items-center gap-2">
      <div className="flex overflow-hidden rounded-[3px] border border-sky-300/15">
        {modes.map((x) => (
          <button
            key={x.m}
            type="button"
            onClick={() => set(x.m)}
            className={cn('flex items-center gap-1.5 px-2 py-1 font-display text-[10px] font-semibold tracking-[0.14em] transition', mode === x.m ? 'bg-white/5' : 'opacity-45 hover:opacity-80')}
            style={{ color: mode === x.m ? x.color : undefined }}
            title={link.reason ?? (x.m === 'DENIED' ? 'Emissions control / no shore link' : x.m === 'DDIL' ? 'Denied, degraded, intermittent, limited' : 'Shore link nominal')}
          >
            {x.m === 'DENIED' ? (
              <WifiOff size={12} />
            ) : (
              <span className="flex items-end gap-[2px]">
                {[1, 2, 3, 4].map((b) => (
                  <i key={b} className="w-[3px] rounded-[1px]" style={{ height: 3 + b * 2, background: b <= x.bars ? x.color : '#334155' }} />
                ))}
              </span>
            )}
            {x.label}
          </button>
        ))}
      </div>
      <div className="hidden flex-col leading-tight xl:flex" title={link.peer ? `Records not yet synced to ${link.peer}` : 'Standalone node: no shore peer configured'}>
        <span className="label whitespace-nowrap !text-[8.5px]">{link.peer ? 'Shore queue' : 'Shore peer'}</span>
        <span className={cn('whitespace-nowrap font-mono text-[11px]', link.pendingPush > 0 && !link.up ? 'text-unc' : 'text-sky-200/80')}>
          {link.peer ? `${link.pendingPush} rec` : 'none'}
          {link.lastSync && <span className="text-mute"> · {fmtT(scenario, link.lastSync.t)}</span>}
        </span>
      </div>
    </div>
  );
}

export function restartWatch() {
  const st = useStore.getState();
  st.focusEvent(null);
  st.setWatchTime(Number.NaN);
}

function Clock() {
  const { scenario, at, applied } = useEngine();
  const playing = useStore((s) => s.playing);
  const setPlaying = useStore((s) => s.setPlaying);
  const setWatchTime = useStore((s) => s.setWatchTime);
  const speed = useStore((s) => s.speed);
  const setSpeed = useStore((s) => s.setSpeed);
  const scenarioId = useStore((s) => s.scenarioId);
  const setScenario = useStore((s) => s.setScenario);
  const focusEvent = useStore((s) => s.focusEvent);
  const missions = useMissions();
  const toMission = scenario.mission.start - at;

  const restart = () => {
    focusEvent(null);
    setWatchTime(scenario.watchStart - (scenario.timeScale === 'hours' ? 0.25 : 1));
    setPlaying(true);
  };
  const next = () => {
    const e = scenario.events.find((x) => x.t > at + 1e-9);
    focusEvent(null);
    setWatchTime(e ? e.t : scenario.watchEnd);
  };

  return (
    <div className="flex items-center gap-3">
      <select
        value={scenarioId}
        onChange={(e) => setScenario(e.target.value)}
        className="max-w-[190px] rounded-[3px] border border-sky-300/15 bg-black/40 px-1.5 py-1 font-display text-[10.5px] uppercase tracking-wider text-sky-200 outline-none"
      >
        {(missions.length ? missions : [{ id: scenario.id, short: scenario.short, name: scenario.name, tagline: '' }]).map((s) => (
          <option key={s.id} value={s.id} title={s.name}>
            {s.short}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-1">
        <button type="button" onClick={restart} title="Replay the change stream from watch start" className="rounded p-1 text-sky-300/70 hover:bg-white/5 hover:text-calc">
          <Rewind size={15} />
        </button>
        <button
          type="button"
          onClick={() => setPlaying(!playing)}
          title="Play / pause the change stream (space)"
          className={cn('flex h-7 w-7 items-center justify-center rounded-full border transition', playing ? 'border-calc bg-calc/20 text-calc shadow-[0_0_14px_#22d3ee]' : 'border-sky-300/30 text-sky-200 hover:border-calc hover:text-calc')}
        >
          {playing ? <Pause size={13} /> : <Play size={13} className="translate-x-px" />}
        </button>
        <button type="button" onClick={next} title="Jump to the next incoming report" className="rounded p-1 text-sky-300/70 hover:bg-white/5 hover:text-calc">
          <SkipForward size={15} />
        </button>
        <button
          type="button"
          onClick={() => setSpeed(speed >= 24 ? 3 : speed * 2)}
          className="flex items-center gap-0.5 rounded px-1 py-0.5 font-mono text-[10px] text-sky-300/70 hover:text-calc"
          title="Replay speed"
        >
          <FastForward size={11} />
          {speed}×
        </button>
      </div>
      <div className="leading-none">
        <div className="flex items-baseline gap-2 whitespace-nowrap">
          <span className="font-mono text-[22px] font-semibold tracking-tight text-white glow-calc tabular">{fmtT(scenario, at)}</span>
          <span className="font-mono text-[10px] text-calc/70">{dtg(scenario, at)}</span>
        </div>
        <div className="mt-1 flex items-center gap-2 whitespace-nowrap font-mono text-[9.5px] text-mute">
          <span>WATCH TIME</span>
          <span className="text-sky-300/50">·</span>
          <span>{applied.length}/{scenario.events.length} reports received</span>
        </div>
      </div>
      <div className="ml-1 border-l border-sky-300/10 pl-3 leading-none">
        <div className="label whitespace-nowrap !text-[8.5px]">{scenario.timeScale === 'hours' ? 'H-hour in' : 'Mission start in'}</div>
        <div className={cn('mt-1 font-mono text-[15px] font-semibold tabular', toMission < 0 ? 'text-crit' : 'text-sky-100')}>
          {toMission >= 0 ? fmtDur(toMission) : `+${fmtDur(-toMission)}`}
        </div>
      </div>
    </div>
  );
}

function StopButton() {
  const { halted: stop, snapshot } = useEngine();
  const halted = stop.stopped;
  return (
    <button
      type="button"
      onClick={() => {
        if (halted) return;
        useStore.getState().setPlaying(false);
        void actions.stop(snapshot.mission, snapshot.at, 'Watchstander STOP from the command bar');
      }}
      className={cn(
        'group relative flex items-center gap-2 overflow-hidden rounded-[3px] border-2 px-3 py-1.5 font-display text-[13px] font-bold tracking-[0.25em] transition',
        halted ? 'border-crit bg-crit text-white' : 'border-crit/80 bg-crit/10 text-crit hover:bg-crit hover:text-white hover:shadow-[0_0_30px_#fb3b5c]',
      )}
      title="STOP: halt all automated analysis and recommendations immediately"
    >
      <OctagonX size={17} />
      STOP
    </button>
  );
}

function NodeChip() {
  const version = useStore((s) => s.version);
  const h = useRemote<HealthView>(`health|${Math.floor(version / 5)}`, () => api.get('/health')).data;
  const ok = h?.ok ?? false;
  const color = !h ? '#64748b' : ok ? '#34d399' : '#fb3b5c';
  return (
    <div
      className="hidden items-center gap-2 rounded-[3px] border px-2 py-1 lg:flex"
      style={{ borderColor: `${color}40`, background: `${color}0d` }}
      title={h ? `${h.node.label}\nPostgres ${h.db ? 'connected' : 'down'}\nchains ${ok ? 're-verified' : 'FAILED verification'}` : 'checking node health'}
    >
      <RadarSweep size={18} color={color} />
      <div className="leading-none">
        <div className="whitespace-nowrap font-display text-[9.5px] font-semibold uppercase tracking-[0.16em]" style={{ color }}>{h?.node.kind === 'shore' ? 'SHORE NODE' : h?.node.id === 'solo' ? 'EDGE NODE' : 'SHIP NODE'}</div>
        <div className="mt-0.5 whitespace-nowrap font-mono text-[9px]" style={{ color: `${color}b0` }}>{h ? `${h.node.id} · ${ok ? 'CHAINS OK' : 'CHECK'}` : '…'}</div>
      </div>
    </div>
  );
}

export function TopBar() {
  const { scenario } = useEngine();
  return (
    <header className="relative z-20 flex h-[60px] shrink-0 items-center gap-4 border-b border-sky-400/15 bg-[#030a14]/90 px-4 backdrop-blur">
      <Logo />
      <div className="hidden border-l border-sky-300/10 pl-4 leading-tight 2xl:block">
        <div className="font-display text-[13px] font-semibold tracking-[0.12em] text-sky-100">
          {scenario.ship.name} <span className="text-calc/80">{scenario.ship.hull}</span>
        </div>
        <div className="font-mono text-[10px] text-mute">
          {scenario.mission.name} · {scenario.mission.area}
        </div>
      </div>
      <div className="mx-auto">
        <Clock />
      </div>
      <LinkControl />
      <NodeChip />
      <StopButton />
    </header>
  );
}

export function NavRail() {
  const decisions = useEngine().snapshot.counts.decisions;
  return (
    <nav className="relative z-10 flex w-[68px] shrink-0 flex-col items-center gap-1 border-r border-sky-400/10 bg-[#030a14]/70 py-3 backdrop-blur">
      {NAV.map(({ to, icon: Icon, label, hint }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            cn(
              'group relative flex w-[58px] flex-col items-center gap-1 rounded-[4px] px-1 py-2 transition',
              isActive ? 'bg-calc/10 text-calc' : 'text-sky-300/50 hover:bg-white/[0.03] hover:text-sky-100',
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <motion.span layoutId="nav-active" className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r bg-calc shadow-[0_0_12px_#22d3ee]" />}
              <Icon size={19} strokeWidth={1.6} className={cn(isActive && 'drop-shadow-[0_0_8px_rgba(34,211,238,0.9)]')} />
              <span className="text-center font-display text-[8.5px] font-semibold uppercase leading-tight tracking-[0.08em]">{label.split(' ')[0]}</span>
              {to === '/log' && decisions > 0 && (
                <span className="absolute right-1 top-1 rounded-full bg-ai px-1 font-mono text-[8px] font-bold text-black">{decisions}</span>
              )}
              <span className="pointer-events-none absolute left-[64px] top-1/2 z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-[3px] border border-calc/30 bg-[#04101c] px-2 py-1 group-hover:block">
                <span className="block font-display text-[11px] font-semibold tracking-wider text-sky-100">{label}</span>
                <span className="block font-mono text-[9.5px] text-mute">{hint}</span>
              </span>
            </>
          )}
        </NavLink>
      ))}
      <div className="mt-auto flex flex-col items-center gap-1 pb-1" title="Unclassified, synthetic data only">
        <ShieldCheck size={16} className="text-ok/70" />
        <span className="font-mono text-[8px] text-ok/60">UNCLAS</span>
      </div>
    </nav>
  );
}

export function StatusFooter() {
  const { result, computeMs, scenario, whatIfActive, plannedActive, snapshot, link, halted } = useEngine();
  const llm = useStore((s) => s.llmEnabled);
  const items = [
    `ENGINE deterministic · ${Object.keys(result.nodes).length} nodes · ${result.capabilities.length} requirements · ${computeMs.toFixed(1)} ms on the node`,
    `RECORD ${snapshot.counts.facts} reports (${snapshot.counts.quarantined} quarantined) · ${snapshot.counts.decisions} decisions · hash-chained`,
    `SOURCES synthetic feeds styled on OMMS-NG · R-SUPPLY · NSIPS · DLA · SKED · DRRS-N (read-only)`,
    `AUTHORITY human-in-the-loop · cannot issue orders or modify records`,
    `NARRATIVE ${halted.stopped ? 'HALTED' : !llm ? 'deterministic template' : 'template, optionally reworded by a local model (values checked)'}`,
    `MISSION ${scenario.mission.name} · ${scenario.ship.name} ${scenario.ship.hull}`,
  ];
  return (
    <footer className="relative z-20 flex h-[24px] shrink-0 items-center gap-3 overflow-hidden border-t border-sky-400/10 bg-[#030a14]/90 px-3 font-mono text-[10px] text-mute">
      <span className="flex shrink-0 items-center gap-1.5 text-ok">
        <Activity size={11} /> LIVE
      </span>
      {(whatIfActive || plannedActive) && (
        <span className="shrink-0 rounded-[2px] border border-ai/40 bg-ai/10 px-1.5 text-ai">
          {whatIfActive ? 'WHAT-IF ACTIVE' : ''}
          {whatIfActive && plannedActive ? ' · ' : ''}
          {plannedActive ? 'PLANNING ASSUMPTIONS APPLIED' : ''}
        </span>
      )}
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div className="animate-marquee flex w-max gap-10 whitespace-nowrap">
          {[...items, ...items].map((x, i) => (
            <span key={i}>{x}</span>
          ))}
        </div>
      </div>
      <span className="flex shrink-0 items-center gap-1">
        <Cpu size={11} /> {BRAND.name} mission-api
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <Satellite size={11} /> {link.up ? 'LINK UP' : 'LINK DOWN'}
      </span>
    </footer>
  );
}

export function HaltOverlay() {
  const { halted: stop, snapshot } = useEngine();
  const halted = stop.stopped;
  const reason = stop.note ?? '';
  const officer = stop.by ?? useStore.getState().watchOfficer;
  const resume = (note: string) => void actions.resume(snapshot.mission, snapshot.at, note);
  const [note, setNote] = useState('');
  return (
    <AnimatePresence>
      {halted && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center bg-[#1a0006]/80 backdrop-blur-md">
          <div className="pointer-events-none absolute inset-0" style={{ background: 'repeating-linear-gradient(-45deg, rgba(251,59,92,0.07) 0 18px, transparent 18px 36px)' }} />
          <motion.div initial={{ scale: 0.92, y: 10 }} animate={{ scale: 1, y: 0 }} className="hud hud-crit relative w-[560px] p-7 text-center">
            <OctagonX size={64} className="mx-auto text-crit drop-shadow-[0_0_24px_#fb3b5c]" />
            <h1 className="mt-3 font-display text-3xl font-bold tracking-[0.3em] text-crit glow-crit">AGENT HALTED</h1>
            <p className="mt-3 text-sm text-rose-100/80">
              All automated analysis, recommendations and AI narrative are suspended. Source records, the last computed picture and the audit log remain available read-only.
            </p>
            <div className="mt-4 rounded-[3px] border border-crit/30 bg-black/40 p-3 text-left font-mono text-[11px] text-rose-200/80">
              <div>REASON: {reason}</div>
              <div>BY: {officer}</div>
              <div>LOGGED: hash-chained decision on the node</div>
            </div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Reason for resuming (required)"
              className="mt-4 w-full rounded-[3px] border border-crit/40 bg-black/50 px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-rose-200/30 focus:border-crit"
            />
            <button
              type="button"
              disabled={note.trim().length < 3}
              onClick={() => {
                resume(note.trim());
                setNote('');
              }}
              className="mt-3 w-full rounded-[3px] border border-crit bg-crit/20 py-2 font-display text-sm font-bold tracking-[0.25em] text-white transition hover:bg-crit disabled:opacity-30"
            >
              RESUME UNDER HUMAN AUTHORITY
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function impactSummary(imp: EventImpact, fmt: (t: number) => string): { tone: 'crit' | 'warn' | 'ok'; lines: string[] } {
  const moved = imp.diff.caps.filter((c) => Math.abs(c.marginDelta) > 1e-6 || c.statusChanged || c.controlChanged);
  if (!moved.length) return { tone: 'ok', lines: ['No mission consequence: absorbed by upstream slack'] };
  const lines = moved.map((c) => {
    const parts = [`${c.code} ${c.before?.status}→${c.after.status}`];
    if (Math.abs(c.marginDelta) > 1e-6) parts.push(`margin ${fmtDelta(c.marginDelta)}`);
    if (c.controlChanged) parts.push(`control → ${c.after.controlling.label}`);
    else parts.push(`ready ${fmt(c.after.ready)}`);
    return parts.join(' · ');
  });
  const tone = moved.some((c) => c.after.status === 'N' || c.marginDelta < -24) ? 'crit' : 'warn';
  return { tone, lines };
}

/**
 * Advances watch time when playing and holds on each incoming report until
 * the node has computed its consequence, then shows it. Pressing play at the
 * end of the watch replays it from the start.
 */
export function usePlayer() {
  const playing = useStore((s) => s.playing);
  const { impacts, scenario } = useEngine();
  const ref = useRef({ impacts, scenario });
  ref.current = { impacts, scenario };
  const show = useFlash((s) => s.show);
  const waiting = useRef<{ id: string; since: number } | null>(null);

  // the report we are holding on: flash it as soon as its consequence arrives
  useEffect(() => {
    const w = waiting.current;
    if (!w) return;
    const imp = impacts[w.id];
    if (!imp) return;
    waiting.current = null;
    const sum = impactSummary(imp, (x) => fmtT(scenario, x));
    show({ title: imp.event.title, lines: sum.lines, tone: imp.event.kind === 'baseline' ? 'ok' : sum.tone });
  }, [impacts, scenario, show]);

  useEffect(() => {
    if (!playing) return;
    const s0 = ref.current.scenario;
    const st0 = useStore.getState();
    if (!(st0.watchTime < s0.watchEnd - 1e-9)) st0.setWatchTime(s0.watchStart - (s0.timeScale === 'hours' ? 0.25 : 1));
    let raf = 0;
    let last = performance.now();
    let holdUntil = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const st = useStore.getState();
      const s = ref.current.scenario;
      const w = waiting.current;
      const waitingTooLong = w && now - w.since > 8000;
      if (now >= holdUntil && (!w || waitingTooLong)) {
        if (waitingTooLong) waiting.current = null;
        const t = st.watchTime;
        const rate = s.timeScale === 'hours' ? st.speed / 8 : st.speed;
        let next = t + dt * rate;
        const ev = s.events.find((e) => e.t > t + 1e-9 && e.t <= next + 1e-9);
        if (ev) {
          next = ev.t;
          holdUntil = now + 2600;
          waiting.current = { id: ev.id, since: now };
        }
        if (next >= s.watchEnd) {
          next = s.watchEnd;
          st.setPlaying(false);
        }
        st.setWatchTime(next);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

export function EventFlash() {
  const flash = useFlash((s) => s.flash);
  const clear = useFlash((s) => s.clear);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(clear, 2500);
    return () => clearTimeout(id);
  }, [flash, clear]);
  const color = flash?.tone === 'crit' ? '#fb3b5c' : flash?.tone === 'warn' ? '#fbbf24' : '#34d399';
  return (
    <AnimatePresence>
      {flash && (
        <motion.div
          key={flash.id}
          initial={{ opacity: 0, y: -24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          className="pointer-events-none fixed left-1/2 top-[92px] z-[90] w-[min(760px,90vw)] -translate-x-1/2"
        >
          <div className="hud overflow-hidden px-5 py-3" style={{ borderColor: `${color}88`, boxShadow: `0 0 60px -10px ${color}, inset 0 0 40px ${color}15` }}>
            <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 2.5, ease: 'linear' }} className="absolute bottom-0 left-0 h-[2px] w-full origin-left" style={{ background: color }} />
            <div className="flex items-center gap-3">
              <span className="label !tracking-[0.25em]" style={{ color }}>
                {flash.tone === 'ok' ? 'CHANGE INGESTED' : 'MISSION CONSEQUENCE'}
              </span>
              <span className="font-display text-[15px] font-semibold text-white">{flash.title}</span>
            </div>
            <div className="mt-1.5 space-y-0.5">
              {flash.lines.map((l) => (
                <div key={l} className="font-mono text-[12.5px]" style={{ color }}>
                  ▸ {l}
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function useHotkeys() {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return;
      const i = Number(e.key) - 1;
      if (Number.isInteger(i) && i >= 0 && i < NAV.length) {
        navigate(NAV[i].to + location.search);
        return;
      }
      if (e.key === 'R' && e.shiftKey) {
        const id = useStore.getState().scenarioId;
        if (window.confirm(`Reset ${id} on this node? Facts and decisions are re-seeded from the baseline.`)) void actions.reset(id);
        return;
      }
      // space always means play/pause, even when a button has focus (otherwise it would press that button)
      if (e.key === ' ') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        const st = useStore.getState();
        st.setPlaying(!st.playing);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
}

/** A failing screen shows what failed and offers a way back, instead of a black page. */
export class ScreenBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(p: { resetKey: string }, s: { error: Error | null; key: string }) {
    return p.resetKey !== s.key ? { error: null, key: p.resetKey } : null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('screen failed', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="hud hud-crit max-w-[520px] p-5">
          <div className="font-display text-[13px] font-bold tracking-[0.2em] text-crit">THIS VIEW FAILED TO DRAW</div>
          <p className="mt-2 font-mono text-[11px] text-rose-100/70">{this.state.error.message}</p>
          <p className="mt-2 text-[12px] text-sky-200/60">The mission record is unaffected. Switch view or mission, or retry.</p>
          <button type="button" onClick={() => this.setState({ error: null })} className="mt-3 rounded-[3px] border border-crit/50 px-3 py-1 font-display text-[11px] tracking-[0.2em] text-crit hover:bg-crit/10">
            RETRY
          </button>
        </div>
      </div>
    );
  }
}

export function Layout({ children }: { children: ReactNode }) {
  usePlayer();
  useHotkeys();
  useLiveUpdates();
  return (
    <div className="ocean-bg relative flex h-full flex-col">
      <div className="grid-bg pointer-events-none absolute inset-0" />
      <ClassBanner />
      <TopBar />
      <div className="relative flex min-h-0 flex-1">
        <NavRail />
        <main className="relative min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
      <StatusFooter />
      <div className="scanlines pointer-events-none fixed inset-0 z-[60]" />
      <div className="noise pointer-events-none fixed inset-0 z-[61]" />
      <HaltOverlay />
      <EventFlash />
      <Tour />
    </div>
  );
}
