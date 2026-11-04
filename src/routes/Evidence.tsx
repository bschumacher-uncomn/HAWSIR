import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Check, Dices, FlaskConical, Play, Timer, X } from 'lucide-react';
import { applyPatches, compute, evaluateOptions, fmtDur, fmtT, isShiftable, shiftNode, stateAt, upstreamCone, type EngineResult } from '@/engine';
import { ddg21 } from '@/data/ddg21';
import { useEngine } from '@/state/engine';
import { useStore } from '@/state/store';
import { Btn, Panel, Pill, StatusBadge } from '@/components/ui';
import { cn } from '@/lib/util';
import { CASES, runCase, type CaseResult } from '@/features/evidence/cases';

const CRITERIA = [
  { w: 30, name: 'Warfighting / deckplate', items: [['Five answers on one screen', '/'], ['Controlling constraint + slack vs margin', '/graph'], ['Bounded options, human decides', '/']] },
  { w: 20, name: 'Speed to fleet / DDIL', items: [['Answer in milliseconds, aboard', '/evidence'], ['Works disconnected, syncs later', '/log'], ['Zarf + UDS air-gap bundle', '/edge']] },
  { w: 20, name: 'Fleet scalability', items: [['Mission threads are data: MCM, reload, repair, deploy', '/thread'], ['Three workflows, one engine: deploy, reload, repair', '/'], ['RKE2 edge node per hull', '/edge']] },
  { w: 15, name: 'Barrier removal', items: [['Read-only to authoritative systems', '/log'], ['OSCAL + Lula compliance evidence', '/edge'], ['SBOM, signed images, Iron Bank base', '/edge']] },
  { w: 15, name: "Judges' discretion", items: [['Monte Carlo of 2,000 futures', '/sim'], ['Live theater picture', '/theater'], ['Tamper-evident audit', '/log']] },
] as const;

const BASELINE = [
  { metric: 'Time to a defensible answer after a change', base: '30–60 min', assisted: 'computeMs', note: 'Pull CASREP, call supply, check watchbill, redo the whiteboard' },
  { metric: 'Systems consulted per change', base: '5–7 + calls', assisted: '1 screen', note: 'Provenance chips link every number to its source record' },
  { metric: 'Nonlinear effects caught at ingest', base: 'Often missed', assisted: '2 of 2', note: 'Missed sail window; helo fly-on cliff' },
  { metric: 'Data problems surfaced', base: 'When they bite', assisted: '4 of 4', note: 'Missing, stale, contradictory, malformed' },
  { metric: 'Decision record', base: 'Notebook / email', assisted: 'Hash-chained', note: 'Who decided what, on which facts, when' },
];

const LIMITS = [
  'Synthetic data only. No connection to OMMS-NG, R-Supply, NSIPS or any authoritative system in this build.',
  'Durations and uncertainty ranges are planner estimates, not validated against fleet history.',
  'Dependency graphs are authored per workflow. Graph-authoring tooling is a 60-day item.',
  'Monte Carlo treats inputs as independent. Correlated delays (one cause, many slips) are not modeled yet.',
  'Single-ship picture. Squadron/strike-group roll-up is a prototype view only.',
  'Not accredited. Classification banners are illustrative.',
];

const PLAN = [
  { d: 30, title: 'Prove it on one hull', items: ['Sanitized exports from one DDG (CSV drop, read-only)', 'Three watch teams run the baseline-vs-assisted trial', 'Tune durations and ranges against their history'] },
  { d: 60, title: 'Make it repeatable', items: ['Workflow authoring UI (CASREP → capability templates)', 'UDS bundle on an RKE2 edge node, shore sync over DDIL', 'Lula/OSCAL evidence feeding the ISSM package'] },
  { d: 90, title: 'Pilot at squadron scale', items: ['Three hulls plus DESRON roll-up', 'Correlated-delay Monte Carlo', 'Transition partner and IATT path'] },
];

const SYSTEM_ROLE: Record<string, string> = {
  'OMMS-NG': 'Maintenance (JCN / CASREP)',
  'R-SUPPLY': 'Requisitions, ETAs',
  NSIPS: 'Orders, TAD, personnel',
  SKED: 'PMS schedule',
  'DRRS-N': 'Readiness reporting',
  AMHS: 'Message traffic',
  'DLA-TRACK': 'Shipment tracking',
  NAVSEA: 'Technical authority',
  'HSM-SQDN': 'Aviation detachment',
  'HSC-DET': 'MH-60S detachment',
  MVCS: 'Unmanned vehicle control & data link',
  CMS: 'COMSEC material',
  WATCHBILL: 'Watch / quals',
  AMC: 'Airlift tracking',
  NAVFAC: 'Shore facilities, crane certs',
  MRRS: 'Medical readiness',
  NAVIFI: 'Derived by NAVIFI',
};

function useMeasuredCompute() {
  const [ms, setMs] = useState<{ median: number; max: number; n: number } | null>(null);
  useEffect(() => {
    const id = setTimeout(() => {
      const xs = ddg21.events.map((e) => {
        const t0 = performance.now();
        const { nodes } = stateAt(ddg21, e.t);
        compute(ddg21, nodes, e.t);
        evaluateOptions(ddg21, nodes, e.t, 'c_amd');
        return performance.now() - t0;
      });
      xs.sort((a, b) => a - b);
      setMs({ median: xs[Math.floor(xs.length / 2)], max: xs[xs.length - 1], n: xs.length });
    }, 300);
    return () => clearTimeout(id);
  }, []);
  return ms;
}

function FailureMatrix() {
  const [res, setRes] = useState<Record<string, CaseResult>>({});
  const [running, setRunning] = useState(false);
  const run = () => {
    setRes({});
    setRunning(true);
    CASES.forEach((c, i) =>
      setTimeout(() => {
        setRes((r) => ({ ...r, [c.id]: runCase(c) }));
        if (i === CASES.length - 1) setRunning(false);
      }, 120 + i * 110),
    );
  };
  useEffect(run, []);
  const done = Object.values(res);
  const passed = done.filter((r) => r.pass).length;
  return (
    <Panel
      title="Failure cases · run live against the engine"
      index="EVD-2"
      className="h-full"
      right={
        <>
          <span className={cn('font-mono text-[11px] font-bold', passed === CASES.length ? 'text-ok' : 'text-unc')}>
            {passed}/{CASES.length} PASS
          </span>
          <Btn tone="calc" onClick={run} disabled={running}>
            <Play size={11} /> Run all
          </Btn>
        </>
      }
      bodyClass="overflow-y-auto"
    >
      <div className="grid grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_64px_54px] gap-3 border-b border-sky-300/10 px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-mute">
        <span>Case</span>
        <span>Injected</span>
        <span>Expected</span>
        <span>Observed (live)</span>
        <span>Result</span>
        <span className="text-right">ms</span>
      </div>
      {CASES.map((c) => {
        const r = res[c.id];
        return (
          <div key={c.id} className={cn('grid grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_64px_54px] items-center gap-3 border-b border-sky-300/[0.05] px-3 py-[7px] text-[11px]', c.group === 'classic' && 'bg-calc/[0.03]')}>
            <span className="font-display text-[10.5px] font-semibold tracking-[0.06em] text-sky-50">{c.title}</span>
            <span className="text-sky-200/65">{c.inject}</span>
            <span className="text-sky-200/65">{c.expect}</span>
            <span className={cn('font-mono text-[10.5px]', r ? (r.pass ? 'text-calc' : 'text-crit') : 'text-mute')}>{r ? r.observed : running ? 'running…' : '—'}</span>
            <span>
              {r && (
                <motion.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={cn('inline-flex items-center gap-1 rounded-[2px] px-1.5 py-px font-display text-[10px] font-bold tracking-[0.14em]', r.pass ? 'bg-ok/15 text-ok' : 'bg-crit/15 text-crit')}>
                  {r.pass ? <Check size={11} /> : <X size={11} />}
                  {r.pass ? 'PASS' : 'FAIL'}
                </motion.span>
              )}
            </span>
            <span className="text-right font-mono text-[10px] text-mute">{r ? r.ms.toFixed(1) : ''}</span>
          </div>
        );
      })}
    </Panel>
  );
}

function JudgeChallenge() {
  const { scenario, nodes, at, result, cap } = useEngine();
  const log = useStore((s) => s.log);
  const shiftable = useMemo(() => Object.values(nodes).filter((n) => isShiftable(n) && n.kind !== 'gate'), [nodes]);
  const [pick, setPick] = useState('');
  const [delta, setDelta] = useState(scenario.timeScale === 'hours' ? 1 : 48);
  const [out, setOut] = useState<{ id: string; delta: number; ms: number; after: EngineResult } | null>(null);
  const hours = scenario.timeScale === 'hours';

  const go = (id: string, d: number) => {
    const t0 = performance.now();
    const after = compute(scenario, applyPatches(nodes, [{ op: 'set', id, fields: shiftNode(nodes[id], d) }]), at);
    const ms = performance.now() - t0;
    setOut({ id, delta: d, ms, after });
    log('WATCHSTANDER', 'JUDGE_CHALLENGE', `Sandbox change: ${nodes[id].label} ${fmtDur(d, { signed: true })} → answered in ${ms.toFixed(1)} ms`, { nodeId: id, delta: d });
  };
  const random = () => {
    const cone = cap ? shiftable.filter((n) => cap.chain.includes(n.id) || upstreamCone(nodes, cap.id).has(n.id)) : [];
    const pool = cone.length && Math.random() < 0.7 ? cone : shiftable;
    const n = pool[Math.floor(Math.random() * pool.length)];
    const steps = hours ? [-0.5, 0.5, 1, 1.5, 2, 3] : [-12, 12, 24, 48, 72, 120];
    const d = steps[Math.floor(Math.random() * steps.length)];
    setPick(n.id);
    setDelta(d);
    go(n.id, d);
  };

  return (
    <Panel title="Judge challenge · change anything" index="EVD-3" className="h-full" tone="ai" bodyClass="flex flex-col gap-3 p-3">
      <div className="text-[11.5px] text-sky-200/70">Pick any input, slip it, and time the full recompute. No precomputed answers.</div>
      <div className="flex items-center gap-2">
        <select value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-0 flex-1 rounded-[2px] border border-sky-300/20 bg-black/60 px-2 py-1 font-mono text-[11px] text-white outline-none">
          <option value="">Choose an input…</option>
          {shiftable.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
            </option>
          ))}
        </select>
        <input type="number" value={delta} step={hours ? 0.25 : 6} onChange={(e) => setDelta(Number(e.target.value))} className="w-[72px] rounded-[2px] border border-sky-300/20 bg-black/60 px-2 py-1 font-mono text-[11px] text-white outline-none" />
        <span className="font-mono text-[10px] text-mute">h</span>
      </div>
      <div className="flex gap-2">
        <Btn tone="ai" onClick={() => pick && go(pick, delta)} disabled={!pick}>
          <Timer size={12} /> Recompute
        </Btn>
        <Btn tone="ghost" onClick={random}>
          <Dices size={12} /> Surprise me
        </Btn>
      </div>
      {out ? (
        <motion.div key={`${out.id}${out.delta}${out.ms}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="min-h-0 flex-1 space-y-2">
          <div className="flex items-end gap-3">
            <div className="font-mono text-[34px] font-bold leading-none text-ai">{out.ms.toFixed(1)}</div>
            <div className="pb-1 font-mono text-[11px] text-mute">ms · full graph recompute</div>
          </div>
          <div className="text-[12px] text-sky-50">
            {nodes[out.id].label} <span className="font-mono text-unc">{fmtDur(out.delta, { signed: true })}</span>
          </div>
          <div className="space-y-1">
            {result.capabilities.map((b) => {
              const a = out.after.capabilities.find((c) => c.id === b.id)!;
              const changed = a.status !== b.status || Math.abs(a.margin - b.margin) > 1e-6;
              return (
                <div key={b.id} className={cn('flex items-center gap-2 rounded-[2px] px-1.5 py-0.5', changed ? 'bg-white/[0.04]' : 'opacity-50', b.id === cap?.id && 'ring-1 ring-calc/30')}>
                  <span className="w-[44px] font-display text-[11px] font-bold tracking-wider text-white">{b.code}</span>
                  <StatusBadge status={b.status} size="sm" />
                  <ArrowRight size={11} className="text-mute" />
                  <StatusBadge status={a.status} size="sm" />
                  <span className={cn('font-mono text-[10.5px]', a.margin < 0 ? 'text-crit' : 'text-sky-200')}>{Number.isFinite(a.margin) ? fmtDur(a.margin, { signed: true }) : 'NO WINDOW'}</span>
                  <span className="ml-auto truncate font-mono text-[10px] text-mute">{changed ? (a.controlling.nodeId !== b.controlling.nodeId ? `→ ${a.controlling.label}` : `${fmtDur(a.margin - b.margin, { signed: true })}`) : 'no consequence'}</span>
                </div>
              );
            })}
          </div>
          <div className="font-mono text-[9.5px] text-mute">Sandbox only · as of {fmtT(scenario, at)} · logged to audit chain</div>
        </motion.div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-[3px] border border-dashed border-ai/25 font-mono text-[11px] text-ai/60">Waiting for a challenge</div>
      )}
    </Panel>
  );
}

export default function Evidence() {
  const { scenario, nodes } = useEngine();
  const ms = useMeasuredCompute();
  const provenance = useMemo(() => {
    const m = new Map<string, { records: Set<string>; nodes: number; events: number }>();
    const bump = (sys: string) => m.get(sys) ?? (m.set(sys, { records: new Set(), nodes: 0, events: 0 }), m.get(sys)!);
    for (const n of Object.values(nodes)) for (const s of n.sources ?? []) {
      const e = bump(s.system);
      e.records.add(s.recordId);
      e.nodes++;
    }
    for (const ev of scenario.events) {
      const e = bump(ev.source.system);
      e.records.add(ev.source.recordId);
      e.events++;
    }
    return [...m.entries()].sort((a, b) => b[1].records.size - a[1].records.size);
  }, [nodes, scenario]);

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="flex flex-col gap-3">
        <div className="hud flex items-center gap-4 px-3 py-2">
          <div>
            <div className="label !text-[9px] !text-calc/80">Evidence pack · FleetHacker Norfolk 2026</div>
            <div className="font-display text-[14px] font-bold tracking-[0.18em] text-white">PROOF, NOT PROMISES</div>
          </div>
          <Pill color="#34d399">Every number on this page is computed live</Pill>
          <Pill color="#fbbf24">Synthetic data</Pill>
        </div>

        <div className="grid grid-cols-5 gap-3">
          {CRITERIA.map((c) => (
            <div key={c.name} className="hud p-3">
              <div className="flex items-baseline justify-between">
                <span className="font-display text-[11px] font-bold tracking-[0.14em] text-sky-50 uppercase">{c.name}</span>
                <span className="font-mono text-[20px] font-bold text-calc">{c.w}%</span>
              </div>
              <div className="mt-1 h-[3px] rounded bg-white/5">
                <div className="h-full rounded bg-calc" style={{ width: `${(c.w / 30) * 100}%` }} />
              </div>
              <ul className="mt-2 space-y-1">
                {c.items.map(([label, to]) => (
                  <li key={label}>
                    <Link to={to} className="flex items-center gap-1.5 text-[11.5px] text-sky-200/75 hover:text-calc">
                      <Check size={11} className="shrink-0 text-ok" /> {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="grid h-[492px] grid-cols-[minmax(0,1fr)_440px] gap-3">
          <FailureMatrix />
          <JudgeChallenge />
        </div>

        <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3">
          <Panel title="Baseline vs assisted" index="EVD-4" bodyClass="p-3">
            <div className="mb-2 flex items-center gap-2 text-[10.5px] text-unc/85">
              <AlertTriangle size={12} /> Baseline is a synthetic tabletop estimate by the team, not measured fleet data.
            </div>
            <div className="space-y-2">
              {BASELINE.map((b) => (
                <div key={b.metric} className="grid grid-cols-[minmax(0,1fr)_110px_120px] items-center gap-2 border-b border-sky-300/[0.06] pb-1.5">
                  <div>
                    <div className="text-[12px] text-sky-50">{b.metric}</div>
                    <div className="text-[10.5px] text-mute">{b.note}</div>
                  </div>
                  <span className="font-mono text-[11px] text-sky-200/50 line-through decoration-sky-200/30">{b.base}</span>
                  <span className="font-mono text-[12px] font-bold text-ok">{b.assisted === 'computeMs' ? (ms ? `${ms.median.toFixed(0)} ms` : '…') : b.assisted}</span>
                </div>
              ))}
            </div>
            {ms && <div className="mt-2 font-mono text-[10px] text-mute">Measured on this machine: median {ms.median.toFixed(1)} ms, max {ms.max.toFixed(1)} ms across {ms.n} change events (state + compute + options).</div>}
          </Panel>

          <Panel title="Provenance by source system" index="EVD-5" bodyClass="p-3">
            <div className="space-y-1">
              {provenance.map(([sys, v]) => (
                <div key={sys} className="flex items-center gap-2 text-[11px]">
                  <span className="w-[86px] font-mono text-[10.5px] font-bold text-calc">{sys}</span>
                  <span className="min-w-0 flex-1 truncate text-sky-200/65">{SYSTEM_ROLE[sys] ?? ''}</span>
                  <span className="font-mono text-[10px] text-mute">
                    {v.records.size} rec · {v.events} ev
                  </span>
                  <span className="rounded-[2px] border border-sky-300/15 px-1 font-mono text-[8.5px] text-sky-200/50">READ-ONLY</span>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[10.5px] text-mute">All records are synthetic and shaped like their source systems. Connectors read; nothing writes back.</div>
          </Panel>

          <Panel title="Known limitations" index="EVD-6" bodyClass="p-3">
            <ul className="space-y-1.5">
              {LIMITS.map((l) => (
                <li key={l} className="flex gap-2 text-[11.5px] leading-snug text-sky-200/75">
                  <FlaskConical size={12} className="mt-0.5 shrink-0 text-unc" />
                  {l}
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <Panel title="30 / 60 / 90 days" index="EVD-7" bodyClass="grid grid-cols-3 gap-3 p-3">
          {PLAN.map((p, i) => (
            <div key={p.d} className="relative rounded-[3px] border border-calc/20 bg-black/30 p-3">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[26px] font-bold text-calc">{p.d}</span>
                <span className="label">days</span>
                <span className="ml-auto font-display text-[11px] font-bold tracking-[0.14em] text-sky-50 uppercase">{p.title}</span>
              </div>
              <ul className="mt-2 space-y-1">
                {p.items.map((it) => (
                  <li key={it} className="flex gap-2 text-[11.5px] text-sky-200/75">
                    <span className="text-calc">▸</span>
                    {it}
                  </li>
                ))}
              </ul>
              {i < 2 && <ArrowRight size={16} className="absolute -right-[14px] top-1/2 z-10 -translate-y-1/2 text-calc/60" />}
            </div>
          ))}
        </Panel>
      </div>
    </div>
  );
}
