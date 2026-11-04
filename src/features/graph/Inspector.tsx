import { motion } from 'motion/react';
import { useMemo } from 'react';
import { MousePointerClick, RotateCcw } from 'lucide-react';
import { affectedCapabilities, consequenceCurve, isShiftable, type SlackResult } from '@/engine';
import { fmtDur, fmtT } from '@/engine/time';
import { useEngine } from '@/state/engine';
import { useStore } from '@/state/store';
import { Btn, FlagBadge, Panel, SourceChip, StatusBadge, Ticker } from '@/components/ui';
import { DOMAIN_COLOR, STATUS_COLOR } from '@/lib/util';
import { CurveChart } from './CurveChart';
import { useBaseWithout } from './hooks';

/** `slackFor` searches at most 30 days of slip. */
const SEARCH_CAP = 24 * 30;

function SlipBudget({ s, shift, code }: { s: SlackResult; shift: number; code: string }) {
  if (s.toFailure < 0) {
    return (
      <div className="rounded-[3px] border border-crit/40 bg-crit/[0.06] p-2.5 font-mono text-[11px] text-sky-100">
        {s.recoverable ? (
          <>
            {code} already misses. This input must come in <span className="font-bold text-crit">{fmtDur(-s.toFailure)} earlier</span> to recover on its own.
          </>
        ) : (
          <>
            {code} already misses, and <span className="font-bold text-crit">no improvement to this input alone recovers it</span>. Another constraint binds.
          </>
        )}
      </div>
    );
  }
  const neverFails = s.toFailure >= SEARCH_CAP - 1 / 60;
  const absorbed = Math.min(s.noImpact, s.toFailure);
  const max = neverFails ? Math.max(absorbed * 2, 72) : s.unbounded ? Math.max(48, s.toFailure * 1.2) : Math.max(s.toFailure * 1.25, absorbed * 1.1, 6);
  const missAt = neverFails ? max * 2 : s.toFailure;
  const pct = (h: number) => `${Math.max(0, Math.min(100, (h / max) * 100))}%`;
  return (
    <div>
      <div className="relative h-7 overflow-hidden rounded-[3px] border border-sky-300/15 bg-black/30">
        <motion.div className="absolute inset-y-0 left-0" style={{ background: 'linear-gradient(90deg,#22d3ee33,#22d3ee66)' }} animate={{ width: pct(absorbed) }} />
        <motion.div
          className="absolute inset-y-0"
          style={{ background: 'repeating-linear-gradient(135deg,#fbbf2433 0 6px,#fbbf2418 6px 12px)' }}
          animate={{ left: pct(absorbed), width: pct(missAt - absorbed) }}
        />
        <motion.div className="absolute inset-y-0 right-0" style={{ background: 'linear-gradient(90deg,#fb3b5c44,#fb3b5c88)' }} animate={{ left: pct(missAt) }} />
        <motion.div className="absolute inset-y-[-2px] w-[2px] bg-white shadow-[0_0_8px_#fff]" animate={{ left: pct(Math.max(0, shift)) }} />
        <div className="absolute inset-0 flex items-center justify-between px-2 font-mono text-[9.5px] font-bold">
          <span className="text-calc">ABSORBED</span>
          <span className={neverFails ? 'text-unc' : 'text-crit'}>{neverFails ? 'NO MISS · BACKFILL / ALT PATH' : 'MISS'}</span>
        </div>
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-2 font-mono text-[10px]">
        <div>
          <div className="text-calc">{s.unbounded ? '∞' : `+${fmtDur(s.noImpact)}`}</div>
          <div className="text-mute">upstream slack</div>
        </div>
        <div className="text-center">
          <div className="text-unc">{neverFails ? 'capped' : fmtDur(Math.max(0, s.toFailure - absorbed))}</div>
          <div className="text-mute">eats {code} margin</div>
        </div>
        <div className="text-right">
          <div className={neverFails ? 'text-ok' : 'text-crit'}>{neverFails ? 'never' : `+${fmtDur(s.toFailure)}`}</div>
          <div className="text-mute">mission miss</div>
        </div>
      </div>
    </div>
  );
}

export function Inspector({ nodeId, slack }: { nodeId: string | null; slack: Record<string, SlackResult> }) {
  const { scenario, nodes, result, at, cap } = useEngine();
  const shifts = useStore((s) => s.shifts);
  const setShift = useStore((s) => s.setShift);
  const clearShifts = useStore((s) => s.clearShifts);
  const log = useStore((s) => s.log);
  const selectCap = useStore((s) => s.selectCap);
  const base = useBaseWithout(nodeId);
  const n = nodeId ? nodes[nodeId] : undefined;
  const r = nodeId ? result.nodes[nodeId] : undefined;

  const targetId = useMemo(() => {
    if (!nodeId || !n) return undefined;
    const caps = affectedCapabilities(nodes, nodeId);
    return cap && caps.includes(cap.id) ? cap.id : caps[0];
  }, [nodeId, n, nodes, cap]);
  const target = result.capabilities.find((c) => c.id === targetId);
  const hours = scenario.timeScale === 'hours';
  const range: [number, number] = hours ? [-2, 6] : [-24, 24 * 7];
  const step = hours ? 0.25 : 1;
  const shift = nodeId ? (shifts[nodeId] ?? 0) : 0;
  const shiftable = isShiftable(n);

  const curve = useMemo(
    () => (nodeId && targetId && shiftable ? consequenceCurve(scenario, base, at, nodeId, targetId, range, 160) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, nodeId, targetId, shiftable, at, scenario],
  );
  const baseMargin = curve.length ? curve.reduce((b, p) => (Math.abs(p.delta) < Math.abs(b.delta) ? p : b), curve[0]).margin : undefined;
  const s = nodeId ? slack[nodeId] : undefined;

  if (!n || !r) {
    return (
      <Panel title="Node inspector" index="ENG" className="h-full" bodyClass="flex flex-col items-center justify-center gap-3 p-6 text-center">
        <MousePointerClick className="text-calc/60" size={28} />
        <div className="label !text-calc">Select any node</div>
        <p className="max-w-[280px] text-[12px] text-sky-200/60">
          Inspect its sources, how much slip it can absorb, where it starts eating mission margin, and the cliff where the mission breaks.
        </p>
      </Panel>
    );
  }

  const affected = affectedCapabilities(nodes, n.id)
    .map((id) => result.capabilities.find((c) => c.id === id)!)
    .filter(Boolean);
  const domainColor = DOMAIN_COLOR[n.domain] ?? '#38bdf8';
  const onSlide = (v: number) => setShift(n.id, v);
  const commitLog = () => {
    if (shift) log('WATCHSTANDER', 'WHAT_IF', `What-if: ${n.label} ${fmtDur(shift, { signed: true })} (sandbox only)`, { nodeId: n.id, shift });
  };

  return (
    <Panel
      title="Node inspector"
      index="ENG"
      className="h-full"
      bodyClass="overflow-y-auto"
      right={
        Object.values(shifts).some(Boolean) ? (
          <Btn tone="ai" onClick={clearShifts} className="!px-1.5 !py-0.5 !text-[9.5px]">
            <RotateCcw size={11} /> clear what-ifs
          </Btn>
        ) : undefined
      }
    >
      <div className="space-y-4 p-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: domainColor, boxShadow: `0 0 8px ${domainColor}` }} />
            <span className="label !text-[9px]" style={{ color: domainColor }}>
              {n.kind} · {n.domain}
            </span>
            <span className="ml-auto flex flex-wrap justify-end gap-1">
              {r.flags.map((f) => (
                <FlagBadge key={f} flag={f} />
              ))}
            </span>
          </div>
          <div className="mt-1 font-display text-[17px] font-semibold leading-snug tracking-[0.04em] text-white">{n.label}</div>
          {n.detail && <div className="mt-0.5 text-[11.5px] text-sky-200/60">{n.detail}</div>}
          <div className="mt-2 flex flex-wrap gap-1">
            {(n.sources ?? []).map((src) => (
              <SourceChip key={`${src.system}-${src.recordId}`} src={src} />
            ))}
            {n.conflict && <SourceChip src={n.conflict.source} />}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-[3px] border border-sky-300/10 bg-black/25 p-2.5 font-mono text-[11px]">
          <div>
            <div className="label !text-[8.5px]">{n.kind === 'person' ? 'Available' : 'Ready'}</div>
            {(() => {
              const away = n.kind === 'person' ? (n.unavailable ?? []).find((iv) => at >= iv.start && at < iv.end) : undefined;
              if (away) return <div className="text-unc">away until {fmtT(scenario, away.end)}</div>;
              return <div className={r.ready <= at ? 'text-ok' : 'text-white'}>{r.ready <= at + 1e-6 ? 'now' : fmtT(scenario, r.ready)}</div>;
            })()}
          </div>
          <div>
            <div className="label !text-[8.5px]">Controlled by</div>
            <div className="truncate text-sky-100">
              {r.control.type === 'self'
                ? n.kind === 'person'
                  ? 'availability'
                  : n.kind === 'task'
                    ? 'duration'
                    : 'source record'
                : r.control.type === 'deps'
                  ? (nodes[r.binding[0]]?.label ?? 'inputs')
                  : r.control.type === 'window'
                    ? 'delivery window'
                    : r.control.type === 'crew'
                      ? 'crew availability'
                      : 'unreachable'}
            </div>
          </div>
          {n.kind === 'input' && (
            <>
              <div>
                <div className="label !text-[8.5px]">Reported</div>
                <div className={n.value === null ? 'text-crit' : 'text-sky-100'}>{n.value === null ? 'MISSING' : n.value !== undefined ? fmtT(scenario, n.value) : '—'}</div>
              </div>
              <div>
                <div className="label !text-[8.5px]">{n.conflict ? 'Conflicting source' : 'Assumed (conservative)'}</div>
                <div className="text-unc">{n.conflict ? fmtT(scenario, n.conflict.value) : n.assumed !== undefined ? fmtT(scenario, n.assumed) : '—'}</div>
              </div>
            </>
          )}
          {n.kind === 'task' && (
            <>
              <div>
                <div className="label !text-[8.5px]">Duration</div>
                <div className="text-sky-100">{n.duration === null ? <span className="text-unc">assumed {fmtDur(n.assumedDuration ?? 0)}</span> : fmtDur(n.duration ?? 0)}</div>
              </div>
              <div>
                <div className="label !text-[8.5px]">Starts</div>
                <div className="text-sky-100">{r.start !== undefined ? fmtT(scenario, r.start) : '—'}</div>
              </div>
              {n.crew && (
                <div className="col-span-2">
                  <div className="label !text-[8.5px]">
                    Crew · {n.crew.label} ({n.crew.k} required)
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {n.crew.pool.map((pid) => (
                      <span
                        key={pid}
                        className={`rounded-[2px] border px-1 text-[10px] ${r.crew?.assigned.includes(pid) ? 'border-ok/50 text-ok' : 'border-sky-300/15 text-mute'}`}
                      >
                        {nodes[pid]?.label ?? pid}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {n.kind === 'person' && (n.unavailable ?? []).length > 0 && (
            <div className="col-span-2 space-y-0.5">
              <div className="label !text-[8.5px]">Unavailable</div>
              {n.unavailable!.map((iv) => (
                <div key={`${iv.start}`} className="text-[10.5px] text-sky-100">
                  {fmtT(scenario, iv.start)} → {fmtT(scenario, iv.end)} <span className="text-mute">{iv.reason}</span>
                </div>
              ))}
            </div>
          )}
          {n.kind === 'gate' && (
            <div className="col-span-2 space-y-1">
              <div className="label !text-[8.5px]">Delivery windows</div>
              {(n.windows ?? []).map((w) => (
                <div key={w.id} className={`flex justify-between gap-2 text-[10.5px] ${w.id === r.usedWindow ? 'text-calc' : w.enabled === false ? 'text-mute line-through' : 'text-sky-100'}`}>
                  <span className="truncate">{w.label}</span>
                  <span className="shrink-0">
                    {fmtT(scenario, w.start)}–{fmtT(scenario, w.end).split(' ').pop()}
                    {w.lag ? ` +${fmtDur(w.lag)}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {target && s && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="label !text-[9.5px] !text-sky-200/80">Slip budget → {target.code}</span>
              <span className="font-mono text-[9.5px] text-mute">upstream slack ≠ mission margin</span>
            </div>
            <SlipBudget s={s} shift={shift} code={target.code} />
          </div>
        )}

        {target && shiftable && curve.length > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="label !text-[9.5px] !text-sky-200/80">Consequence curve · {target.code} margin vs slip</span>
            </div>
            <div className="rounded-[3px] border border-sky-300/10 bg-black/25 px-1 pt-2">
              <CurveChart points={curve} current={shift} qMargin={nodes[target.id]?.qMargin ?? scenario.thresholds.qMargin} cliffThreshold={scenario.thresholds.cliff} step={(range[1] - range[0]) / 160} />
            </div>
          </div>
        )}

        {target && shiftable && (
          <div className="rounded-[3px] border border-ai/30 bg-ai/[0.05] p-3">
            <div className="flex items-center justify-between">
              <span className="label !text-[9.5px] !text-ai">What-if sandbox</span>
              <span className="font-mono text-[12px] font-bold text-white">{shift === 0 ? 'as reported' : fmtDur(shift, { signed: true })}</span>
            </div>
            <input
              type="range"
              className="slip mt-3 w-full"
              min={range[0]}
              max={range[1]}
              step={step}
              value={shift}
              onChange={(e) => onSlide(Number(e.target.value))}
              onPointerUp={commitLog}
              onKeyUp={commitLog}
            />
            <div className="mt-1 flex justify-between font-mono text-[9px] text-mute">
              <span>{fmtDur(range[0], { signed: true })} earlier</span>
              <span>{fmtDur(range[1], { signed: true })} later</span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <StatusBadge status={target.status} size="lg" pulse />
              <div className="flex-1">
                <div className="font-mono text-[10px] text-mute">{target.code} margin</div>
                <div className="font-mono text-[18px] font-bold" style={{ color: STATUS_COLOR[target.status] }}>
                  <Ticker value={target.margin} format={(v) => (v >= 0 ? fmtDur(v) : `−${fmtDur(-v)}`)} />
                </div>
              </div>
              {baseMargin !== undefined && shift !== 0 && (
                <div className="text-right font-mono text-[10.5px]">
                  <div className="text-mute">vs as-reported</div>
                  <div className={target.margin - baseMargin < -1e-6 ? 'text-crit' : target.margin - baseMargin > 1e-6 ? 'text-ok' : 'text-calc'}>
                    {Math.abs(target.margin - baseMargin) < 1e-6 ? 'no change' : fmtDur(target.margin - baseMargin, { signed: true })}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-2 text-[10.5px] text-ai/80">Sandbox only. Nothing here changes a record or the authoritative picture.</div>
          </div>
        )}

        {affected.length > 0 && (
          <div>
            <div className="label mb-1.5 !text-[9.5px] !text-sky-200/80">Feeds capabilities</div>
            <div className="grid grid-cols-3 gap-1.5">
              {affected.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectCap(c.id)}
                  className="flex items-center gap-2 rounded-[3px] border border-sky-300/10 bg-black/25 p-1.5 text-left hover:border-calc/40"
                >
                  <StatusBadge status={c.status} size="sm" />
                  <span className="font-display text-[12px] font-bold tracking-wider text-white">{c.code}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
