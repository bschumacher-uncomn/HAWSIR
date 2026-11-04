import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Dices, Play, Shuffle } from 'lucide-react';
import { tornado } from '@/engine';
import { fmtDur } from '@/engine/time';
import { useAnalysisKey } from '@/state/analysis';
import { useEngine } from '@/state/engine';
import { useStore } from '@/state/store';
import { Btn, Panel, Pill } from '@/components/ui';
import { cn, STATUS_COLOR } from '@/lib/util';
import { Convergence, fmtM, Gauge, MarginHistogram, pColor, SCurves, Tornado } from '@/features/sim/charts';
import { useMCStream } from '@/features/sim/useMCStream';
const CTRL_COLORS = ['#22d3ee', '#fbbf24', '#a3e635', '#f472b6', '#60a5fa', '#fb923c'];

export default function Simulate() {
  const { scenario, result, nodes, at, cap, plannedActive, whatIfActive } = useEngine();
  const select = useStore((s) => s.selectCap);
  const log = useStore((s) => s.log);
  const [n, setN] = useState(2000);
  const [seed, setSeed] = useState(1337);
  const mc = useMCStream(n, seed);
  const key = useAnalysisKey();
  const capId = cap?.id ?? '';
  const torn = useMemo(
    () => (capId ? tornado(scenario, nodes, at, capId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, capId],
  );

  const hist = useRef<number[]>([]);
  const lastN = useRef(0);
  const snap = mc.snap;
  const tgt = snap?.targets[capId];
  useEffect(() => {
    if (!snap || !tgt) return;
    if (snap.n < lastN.current) hist.current = [];
    lastN.current = snap.n;
    hist.current = [...hist.current.slice(-80), tgt.pMeet];
  }, [snap, tgt]);
  useEffect(() => {
    hist.current = [];
  }, [capId]);

  const label = (id: string) => nodes[id]?.label ?? id;
  const crit = useMemo(() => {
    if (!snap) return [];
    return Object.entries(snap.criticality[capId] ?? {})
      .filter(([id]) => id !== capId && nodes[id] && ['input', 'person', 'task', 'gate'].includes(nodes[id].kind))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7);
  }, [snap, capId, nodes]);
  const ctrl = useMemo(() => {
    if (!snap) return [];
    return Object.entries(snap.controlling[capId] ?? {})
      .map(([k, v]) => {
        const [nid, wid] = k.split('#');
        const w = wid ? nodes[nid]?.windows?.find((x) => x.id === wid) : undefined;
        return { k, v, label: w ? w.label : label(nid), kind: w ? 'window' : (nodes[nid]?.kind ?? '') };
      })
      .sort((a, b) => b.v - a.v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, capId, nodes]);

  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const reading =
    cap && tgt && snap
      ? [
          `${cap.code} meets its required time in ${pct(tgt.pMeet)} of ${snap.n.toLocaleString()} simulated futures (P50 margin ${fmtM(tgt.p50)}, P10 ${fmtM(tgt.p10)}).`,
          ctrl[0] ? `${ctrl[0].label} controls readiness in ${pct(ctrl[0].v)} of futures${ctrl[1] ? `; ${ctrl[1].label} in ${pct(ctrl[1].v)}` : ''}.` : '',
          torn[0]
            ? Number.isFinite(torn[0].swing)
              ? `Largest single driver of spread: ${label(torn[0].nodeId)} (±${fmtDur(torn[0].swing / 2)}).`
              : `Largest driver: ${label(torn[0].nodeId)}. At the slow end of its range no delivery window remains before tasking.`
            : '',
        ]
          .filter(Boolean)
          .join(' ')
      : '';

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="hud flex shrink-0 items-center gap-4 px-3 py-2">
        <div className="flex items-center gap-2">
          <Dices size={18} className="text-calc" />
          <div>
            <div className="label !text-[9px] !text-calc/80">Mission simulation</div>
            <div className="font-display text-[14px] font-bold tracking-[0.18em] text-white">MONTE CARLO FUTURES</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="label !text-[9px]">Futures</span>
          <div className="flex overflow-hidden rounded-[3px] border border-sky-300/20">
            {[500, 2000, 5000].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setN(v)}
                className={cn('px-2.5 py-1 font-mono text-[11px] transition', n === v ? 'bg-calc/15 text-calc' : 'text-mute hover:text-sky-100')}
              >
                {v.toLocaleString()}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="label !text-[9px]">Seed</span>
          <input
            value={seed}
            onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
            className="w-[72px] rounded-[3px] border border-sky-300/20 bg-black/40 px-2 py-1 font-mono text-[11px] text-sky-100 outline-none focus:border-calc/60"
          />
          <Btn tone="ghost" className="!px-1.5" title="New random seed" onClick={() => setSeed(Math.floor(Math.random() * 99999))}>
            <Shuffle size={12} />
          </Btn>
        </div>
        <Btn
          tone="calc"
          onClick={() => {
            mc.rerun();
            log('WATCHSTANDER', 'SIM_RUN', `Monte Carlo ${n} futures, seed ${seed}`, { n, seed, capId });
          }}
        >
          <Play size={12} /> Run
        </Btn>
        <div className="flex min-w-[320px] flex-1 items-center gap-3">
          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
            <motion.div className="absolute inset-y-0 left-0 rounded-full bg-calc shadow-[0_0_12px_#22d3ee]" animate={{ width: `${mc.progress * 100}%` }} transition={{ duration: 0.1 }} />
          </div>
          <div className="font-mono text-[11px] tabular text-sky-100">
            {(snap?.n ?? 0).toLocaleString()}
            <span className="text-mute">/{n.toLocaleString()} futures</span>
          </div>
          <div className="font-mono text-[11px] tabular text-calc">{Math.round(mc.rate).toLocaleString()}/s</div>
          <div className="font-mono text-[10px] text-mute">{snap?.uncertain.length ?? 0} uncertain inputs</div>
        </div>
        <Pill color={plannedActive || whatIfActive ? '#a78bfa' : '#22d3ee'}>{plannedActive || whatIfActive ? 'Planning picture' : 'Authoritative picture'}</Pill>
        <Pill color="#34d399">Seeded · reproducible</Pill>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_500px] gap-3">
        <div className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1.15fr)_minmax(0,1fr)] gap-3">
          <Panel
            title="Readiness S-curves · probability each capability is ready by time t"
            index="SIM-1"
            right={<span className="font-mono text-[9.5px] text-mute">dot = P(meet) at required-by · click a curve</span>}
            bodyClass="p-2"
          >
            {snap && <SCurves scenario={scenario} caps={result.capabilities} mc={snap} selected={capId} onSelect={select} at={at} />}
          </Panel>
          <div className="grid min-h-0 grid-cols-2 gap-3">
            <Panel
              title={`Margin distribution · ${cap?.code ?? ''}`}
              index="SIM-2"
              right={
                tgt && (
                  <span className="font-mono text-[11px] font-bold" style={{ color: pColor(tgt.pMeet) }}>
                    P(meet) {pct(tgt.pMeet)}
                  </span>
                )
              }
              bodyClass="p-1"
            >
              {tgt && <MarginHistogram margins={tgt.margins} qMargin={nodes[capId]?.qMargin ?? scenario.thresholds.qMargin} p10={tgt.p10} p50={tgt.p50} p90={tgt.p90} hours={scenario.timeScale === 'hours'} />}
            </Panel>
            <Panel title={`Sensitivity tornado · ${cap?.code ?? ''}`} index="SIM-3" right={<span className="font-mono text-[9.5px] text-mute">each input at its range ends</span>} bodyClass="p-2">
              {cap && torn.length > 0 ? (
                <Tornado bars={torn} base={cap.margin} labelOf={label} />
              ) : (
                <div className="flex h-full items-center justify-center font-mono text-[11px] text-mute">No uncertain input moves {cap?.code} margin.</div>
              )}
            </Panel>
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <Panel title="P(meet) by capability" index="SIM-4" bodyClass="grid grid-cols-3 gap-y-1 p-2" className="shrink-0">
            {result.capabilities.map((c) => {
              const t = snap?.targets[c.id];
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => select(c.id)}
                  className={cn('rounded-[3px] border py-1 transition', c.id === capId ? 'border-calc/40 bg-calc/[0.06]' : 'border-transparent hover:border-sky-300/20')}
                >
                  <Gauge p={t?.pMeet ?? 0} size={98} label={c.code} sub={t ? `P50 ${fmtM(t.p50)}` : '—'} active={c.id === capId} />
                </button>
              );
            })}
          </Panel>

          <Panel title={`Criticality index · ${cap?.code ?? ''}`} index="SIM-5" right={<span className="font-mono text-[9.5px] text-mute">% of futures on critical chain</span>} bodyClass="space-y-1.5 p-3" className="shrink-0">
            {crit.map(([id, v]) => {
              const onChain = cap?.chain.includes(id);
              const col = onChain && cap ? STATUS_COLOR[cap.status] : '#38bdf8';
              return (
                <div key={id} className="grid grid-cols-[minmax(0,1fr)_150px_38px] items-center gap-2">
                  <span className="truncate font-mono text-[10.5px] text-sky-100" title={label(id)}>
                    {label(id)}
                  </span>
                  <div className="relative h-2 rounded-full bg-white/[0.05]">
                    <motion.div className="absolute inset-y-0 left-0 rounded-full" style={{ background: col, boxShadow: onChain ? `0 0 8px ${col}` : undefined }} animate={{ width: `${v * 100}%` }} transition={{ duration: 0.2 }} />
                  </div>
                  <span className="text-right font-mono text-[10.5px] tabular" style={{ color: col }}>
                    {pct(v)}
                  </span>
                </div>
              );
            })}
            {!crit.length && <div className="font-mono text-[11px] text-mute">Running…</div>}
          </Panel>

          <Panel title="What controls readiness across futures" index="SIM-6" bodyClass="flex flex-col gap-2.5 overflow-y-auto p-3">
            <div className="flex h-3 overflow-hidden rounded-[2px]">
              {ctrl.map((c, i) => (
                <motion.div key={c.k} animate={{ width: `${c.v * 100}%` }} transition={{ duration: 0.2 }} style={{ background: CTRL_COLORS[i % CTRL_COLORS.length], boxShadow: `0 0 10px ${CTRL_COLORS[i % CTRL_COLORS.length]}66` }} />
              ))}
            </div>
            <div className="space-y-1">
              {ctrl.slice(0, 5).map((c, i) => (
                <div key={c.k} className="flex items-center gap-2 font-mono text-[10.5px]">
                  <i className="h-2 w-2 shrink-0 rounded-[1px]" style={{ background: CTRL_COLORS[i % CTRL_COLORS.length] }} />
                  <span className="truncate text-sky-100">{c.label}</span>
                  <span className="text-[9px] uppercase text-mute">{c.kind}</span>
                  <span className="ml-auto tabular text-white">{pct(c.v)}</span>
                </div>
              ))}
            </div>
            <div className="mt-auto rounded-[3px] border border-calc/20 bg-calc/[0.04] p-2.5">
              <div className="mb-1 flex items-center justify-between">
                <span className="label !text-[9px] !text-calc">Reading · deterministic</span>
                <Convergence history={hist.current} />
              </div>
              <p className="text-[11.5px] leading-relaxed text-sky-100/90">{reading}</p>
              <p className="mt-1.5 text-[10px] text-mute">Ranges are planning assumptions widened for stale, missing, and contradictory data. They are not calibrated failure distributions.</p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
