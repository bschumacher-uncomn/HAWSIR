import { scaleLinear } from 'd3-scale';
import { area, curveMonotoneX, curveStepAfter, line } from 'd3-shape';
import { motion } from 'motion/react';
import { useId, useMemo } from 'react';
import type { CapabilityResult, MCResult, Scenario, TornadoBar } from '@/engine';
import { fmtDay, fmtDur, fmtT } from '@/engine/time';
import { useSize } from '@/lib/useSize';
import { STATUS_COLOR } from '@/lib/util';

export const fmtM = (v: number) => (!Number.isFinite(v) ? 'NO WINDOW' : v >= 0 ? fmtDur(v) : `−${fmtDur(-v)}`);
export const pColor = (p: number) => (p >= 0.9 ? '#34d399' : p >= 0.6 ? '#fbbf24' : '#fb3b5c');

/* ------------------------------------------------------------------ */
/* Readiness S-curves: P(capability ready by t) across the horizon     */
/* ------------------------------------------------------------------ */

export function SCurves({ scenario, caps, mc, selected, onSelect, at }: { scenario: Scenario; caps: CapabilityResult[]; mc: MCResult; selected: string; onSelect: (id: string) => void; at: number }) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const gid = useId().replace(/:/g, '');
  const m = { l: 44, r: 92, t: 18, b: 28 };
  const hours = scenario.timeScale === 'hours';

  const series = useMemo(() => {
    return caps.map((c) => {
      const margins = mc.targets[c.id]?.margins ?? new Float64Array();
      const ready = Float64Array.from(margins, (mg) => c.requiredBy - mg).sort();
      return { cap: c, ready };
    });
  }, [caps, mc]);

  const tMax = useMemo(() => {
    let hi = Math.max(...caps.map((c) => c.requiredBy)) + (hours ? 1 : 24);
    for (const s of series) if (s.ready.length) hi = Math.max(hi, Math.min(s.ready[Math.floor(s.ready.length * 0.98)] ?? hi, hi + (hours ? 4 : 24 * 4)));
    return hi;
  }, [series, caps, hours]);
  const tMin = at;

  const x = scaleLinear().domain([tMin, tMax]).range([m.l, Math.max(m.l + 10, w - m.r)]);
  const y = scaleLinear().domain([0, 1]).range([Math.max(m.t + 10, h - m.b), m.t]);
  const grid = useMemo(() => Array.from({ length: 220 }, (_, i) => tMin + ((tMax - tMin) * i) / 219), [tMin, tMax]);
  const cdf = (arr: Float64Array, t: number) => {
    if (!arr.length) return 0;
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= t + 1e-9) lo = mid + 1;
      else hi = mid;
    }
    return lo / arr.length;
  };
  const ln = line<[number, number]>()
    .x((d) => x(d[0]))
    .y((d) => y(d[1]))
    .curve(curveMonotoneX);
  const ar = area<[number, number]>()
    .x((d) => x(d[0]))
    .y0(y(0))
    .y1((d) => y(d[1]))
    .curve(curveMonotoneX);

  const dayTicks: number[] = [];
  if (hours) for (let t = Math.ceil(tMin); t <= tMax; t += 1) dayTicks.push(t);
  else {
    const step = (tMax - tMin) / 24 > 16 ? 48 : 24;
    for (let t = Math.ceil(tMin / 24) * 24; t <= tMax; t += step) dayTicks.push(t);
  }
  const labels = series.map((s) => ({ s, yEnd: y(cdf(s.ready, tMax)), yLab: 0 })).sort((a, b) => a.yEnd - b.yEnd);
  let last = -Infinity;
  for (const l of labels) {
    l.yLab = Math.max(l.yEnd, last + 13);
    last = l.yLab;
  }

  return (
    <div ref={ref} className="relative h-full w-full">
      {w > 0 && (
        <svg width={w} height={h} className="absolute inset-0">
          <defs>
            <linearGradient id={`sel-${gid}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#22d3ee" stopOpacity="0.28" />
              <stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((p) => (
            <g key={p}>
              <line x1={m.l} x2={w - m.r} y1={y(p)} y2={y(p)} stroke="#38bdf8" strokeOpacity={p === 1 || p === 0 ? 0.18 : 0.07} />
              <text x={m.l - 6} y={y(p) + 3} textAnchor="end" className="fill-[#6b8aa3] font-mono text-[9px]">
                {Math.round(p * 100)}%
              </text>
            </g>
          ))}
          {dayTicks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={m.t} y2={h - m.b} stroke="#38bdf8" strokeOpacity={0.06} />
              <text x={x(t)} y={h - m.b + 14} textAnchor="middle" className="fill-[#6b8aa3] font-mono text-[9px]">
                {hours ? fmtT(scenario, t) : fmtDay(scenario, t)}
              </text>
            </g>
          ))}
          {scenario.phases.map((p) => (
            <g key={p.id}>
              <rect x={x(Math.max(tMin, p.start))} width={Math.max(0, x(Math.min(tMax, p.end)) - x(Math.max(tMin, p.start)))} y={m.t} height={6} fill="#22d3ee" opacity={p.start >= scenario.mission.start ? 0.25 : 0.08} />
            </g>
          ))}
          <line x1={x(scenario.mission.start)} x2={x(scenario.mission.start)} y1={m.t} y2={h - m.b} stroke="#fb3b5c" strokeOpacity={0.55} strokeDasharray="5 4" />
          <text x={x(scenario.mission.start) + 4} y={m.t + 16} className="fill-[#fb3b5c] font-display text-[9px] font-semibold tracking-widest">
            MISSION START
          </text>

          {series.map(({ cap, ready }) => {
            const pts = grid.map((t) => [t, cdf(ready, t)] as [number, number]);
            const sel = cap.id === selected;
            const col = sel ? STATUS_COLOR[cap.status] : '#7dd3fc';
            const pAt = cdf(ready, cap.requiredBy);
            return (
              <g key={cap.id} className="cursor-pointer" onClick={() => onSelect(cap.id)} opacity={sel ? 1 : 0.55}>
                {sel && <path d={ar(pts) ?? ''} fill={`url(#sel-${gid})`} />}
                {sel && <path d={ln(pts) ?? ''} fill="none" stroke={col} strokeWidth={7} strokeOpacity={0.25} style={{ filter: 'blur(4px)' }} />}
                <path d={ln(pts) ?? ''} fill="none" stroke={col} strokeWidth={sel ? 2.4 : 1.2} />
                <path d={ln(pts) ?? ''} fill="none" stroke="transparent" strokeWidth={14} />
                {cap.requiredBy <= tMax && (
                  <g>
                    <line x1={x(cap.requiredBy)} x2={x(cap.requiredBy)} y1={y(pAt)} y2={h - m.b} stroke={col} strokeOpacity={sel ? 0.7 : 0.25} strokeDasharray="2 3" />
                    <circle cx={x(cap.requiredBy)} cy={y(pAt)} r={sel ? 5 : 3} fill="#02060c" stroke={pColor(pAt)} strokeWidth={2} style={sel ? { filter: `drop-shadow(0 0 6px ${pColor(pAt)})` } : undefined} />
                    {sel && (
                      <text x={x(cap.requiredBy) - 8} y={y(pAt) - 9} textAnchor="end" className="font-mono text-[11px] font-bold" fill={pColor(pAt)}>
                        P(meet) {Math.round(pAt * 100)}%
                      </text>
                    )}
                  </g>
                )}
              </g>
            );
          })}
          {labels.map(({ s, yEnd, yLab }) => {
            const sel = s.cap.id === selected;
            return (
              <g key={s.cap.id} className="cursor-pointer" onClick={() => onSelect(s.cap.id)}>
                <line x1={w - m.r + 2} x2={w - m.r + 10} y1={yEnd} y2={yLab} stroke="#7dd3fc" strokeOpacity={0.3} />
                <text x={w - m.r + 13} y={yLab + 3.5} className="font-display text-[11px] font-bold tracking-widest" fill={sel ? STATUS_COLOR[s.cap.status] : '#7dd3fc'} opacity={sel ? 1 : 0.7}>
                  {s.cap.code}
                </text>
                <text x={w - m.r + 50} y={yLab + 3.5} className="font-mono text-[9px]" fill="#6b8aa3">
                  {Math.round(cdf(s.ready, s.cap.requiredBy) * 100)}%
                </text>
              </g>
            );
          })}
          <line x1={x(at)} x2={x(at)} y1={m.t} y2={h - m.b} stroke="#fff" strokeOpacity={0.35} />
          <text x={x(at) + 4} y={h - m.b - 6} className="fill-white/60 font-mono text-[9px]">
            NOW
          </text>
        </svg>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Margin histogram                                                    */
/* ------------------------------------------------------------------ */

export function MarginHistogram({ margins, qMargin, p10, p50, p90, hours }: { margins: Float64Array; qMargin: number; p10: number; p50: number; p90: number; hours: boolean }) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const m = { l: 34, r: 12, t: 26, b: 26 };
  const bins = 46;
  const { lo, hi, counts, max, nonFinite } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    let nonFinite = 0;
    for (const v of margins) {
      if (!Number.isFinite(v)) {
        nonFinite++;
        continue;
      }
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    if (!Number.isFinite(lo)) {
      lo = -1;
      hi = 1;
    }
    const pad = Math.max((hi - lo) * 0.08, hours ? 0.25 : 6);
    lo = Math.min(lo - pad, -pad);
    hi = Math.max(hi + pad, qMargin + pad);
    const counts = new Array(bins).fill(0);
    for (const v of margins) {
      if (!Number.isFinite(v)) {
        counts[0]++;
        continue;
      }
      counts[Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / (hi - lo)) * bins)))]++;
    }
    return { lo, hi, counts, max: Math.max(1, ...counts), nonFinite };
  }, [margins, qMargin, hours]);

  const x = scaleLinear().domain([lo, hi]).range([m.l, Math.max(m.l + 10, w - m.r)]);
  const y = scaleLinear().domain([0, max]).range([Math.max(m.t + 10, h - m.b), m.t]);
  const bw = Math.max(1, (x(hi) - x(lo)) / bins - 1.5);
  const ticks = x.ticks(6);

  return (
    <div ref={ref} className="relative h-full w-full">
      {w > 0 && (
        <svg width={w} height={h} className="absolute inset-0">
          <rect x={x(lo)} y={m.t} width={Math.max(0, x(0) - x(lo))} height={h - m.t - m.b} fill="#fb3b5c" opacity={0.05} />
          <rect x={x(0)} y={m.t} width={Math.max(0, x(Math.min(qMargin, hi)) - x(0))} height={h - m.t - m.b} fill="#fbbf24" opacity={0.04} />
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={m.t} y2={h - m.b} stroke="#38bdf8" strokeOpacity={0.06} />
              <text x={x(t)} y={h - 9} textAnchor="middle" className="fill-[#6b8aa3] font-mono text-[9px]">
                {Math.abs(t) >= 24 ? `${Math.round(t / 24)}d` : `${Math.round(t * 10) / 10}h`}
              </text>
            </g>
          ))}
          {counts.map((c, i) => {
            const mid = lo + ((i + 0.5) * (hi - lo)) / bins;
            const col = mid < 0 ? '#fb3b5c' : mid < qMargin ? '#fbbf24' : '#34d399';
            const top = y(c);
            return (
              <motion.rect
                key={i}
                x={x(lo + (i * (hi - lo)) / bins) + 0.75}
                width={bw}
                initial={false}
                animate={{ y: top, height: Math.max(0, h - m.b - top) }}
                transition={{ duration: 0.18 }}
                fill={col}
                fillOpacity={0.75}
                style={{ filter: c > 0 ? `drop-shadow(0 0 4px ${col}88)` : undefined }}
              />
            );
          })}
          <line x1={x(0)} x2={x(0)} y1={m.t - 8} y2={h - m.b} stroke="#fb3b5c" strokeWidth={1.5} />
          <text x={x(0) - 4} y={m.t - 12} textAnchor="end" className="fill-[#fb3b5c] font-display text-[9px] font-semibold tracking-widest">
            MISS ◂
          </text>
          <text x={x(0) + 4} y={m.t - 12} className="fill-[#34d399] font-display text-[9px] font-semibold tracking-widest">
            ▸ MEET
          </text>
          {(
            [
              ['P10', p10],
              ['P50', p50],
              ['P90', p90],
            ] as const
          ).map(([k, v], i) => {
            const xv = x(Number.isFinite(v) ? v : lo);
            const flip = xv > w - 100;
            return (
              <g key={k}>
                <line x1={xv} x2={xv} y1={m.t + 4 + i * 12} y2={h - m.b} stroke="#e0f2fe" strokeOpacity={k === 'P50' ? 0.8 : 0.4} strokeDasharray={k === 'P50' ? undefined : '3 3'} />
                <rect x={flip ? xv - 84 : xv + 2} y={m.t - 2 + i * 12} width={82} height={12} rx={2} fill="#02060c" fillOpacity={0.8} />
                <text x={flip ? xv - 81 : xv + 5} y={m.t + 7 + i * 12} className="font-mono text-[9px]" fill={Number.isFinite(v) ? '#fff' : '#fb3b5c'}>
                  {k} {fmtM(v)}
                </text>
              </g>
            );
          })}
          {nonFinite > 0 && (
            <g>
              <rect x={x(lo) + 2} y={h - m.b - 30} width={150} height={24} rx={2} fill="#2a0710" stroke="#fb3b5c" strokeOpacity={0.6} />
              <text x={x(lo) + 8} y={h - m.b - 19} className="fill-[#fb3b5c] font-mono text-[9px] font-bold">
                {Math.round((nonFinite / margins.length) * 100)}% NO DELIVERY WINDOW
              </text>
              <text x={x(lo) + 8} y={h - m.b - 9} className="fill-[#fb3b5c]/70 font-mono text-[8.5px]">
                repair cannot happen before tasking
              </text>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* P(meet) radial gauge                                                */
/* ------------------------------------------------------------------ */

export function Gauge({ p, size = 96, label, sub, active }: { p: number; size?: number; label: string; sub: string; active?: boolean }) {
  const r = size / 2 - 8;
  const c = size / 2;
  const start = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;
  const arc = (frac: number) => {
    const a0 = start;
    const a1 = start + sweep * Math.max(0.0001, Math.min(1, frac));
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${c + r * Math.cos(a0)} ${c + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${c + r * Math.cos(a1)} ${c + r * Math.sin(a1)}`;
  };
  const col = pColor(p);
  return (
    <div className="relative flex flex-col items-center">
      <svg width={size} height={size * 0.86}>
        <path d={arc(1)} fill="none" stroke="#38bdf8" strokeOpacity={0.12} strokeWidth={7} strokeLinecap="round" />
        {Array.from({ length: 11 }, (_, i) => {
          const a = start + (sweep * i) / 10;
          return <line key={i} x1={c + (r - 9) * Math.cos(a)} y1={c + (r - 9) * Math.sin(a)} x2={c + (r - 5) * Math.cos(a)} y2={c + (r - 5) * Math.sin(a)} stroke="#6b8aa3" strokeOpacity={0.5} />;
        })}
        <motion.path
          d={arc(1)}
          fill="none"
          stroke={col}
          strokeWidth={7}
          strokeLinecap="round"
          initial={false}
          animate={{ pathLength: Math.max(0.001, Math.min(1, p)) }}
          transition={{ duration: 0.25 }}
          style={{ filter: `drop-shadow(0 0 6px ${col})` }}
        />
        <text x={c} y={c + 2} textAnchor="middle" className="font-display text-[20px] font-bold" fill={col}>
          {Math.round(p * 100)}
          <tspan className="text-[11px]">%</tspan>
        </text>
        <text x={c} y={c + 16} textAnchor="middle" className="fill-[#6b8aa3] font-mono text-[8.5px]">
          P(MEET)
        </text>
      </svg>
      <div className={`-mt-2 font-display text-[13px] font-bold tracking-[0.16em] ${active ? 'text-white' : 'text-sky-200/70'}`}>{label}</div>
      <div className="font-mono text-[9px] text-mute">{sub}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tornado                                                             */
/* ------------------------------------------------------------------ */

export function Tornado({ bars, base, labelOf }: { bars: TornadoBar[]; base: number; labelOf: (id: string) => string }) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const top = bars.slice(0, 8);
  const m = { l: 168, r: 50, t: 8, b: 20 };
  const vals = top
    .flatMap((b) => [b.low, b.high])
    .concat(base, 0)
    .filter(Number.isFinite);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = (hi - lo) * 0.06 || 1;
  const x = scaleLinear()
    .domain([lo - pad, hi + pad])
    .range([m.l, Math.max(m.l + 10, w - m.r)]);
  const rowH = top.length ? Math.min(26, (h - m.t - m.b) / top.length) : 20;
  return (
    <div ref={ref} className="relative h-full w-full">
      {w > 0 && (
        <svg width={w} height={h} className="absolute inset-0">
          <defs>
            <pattern id="torn-broken" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#fb3b5c" />
              <rect width="3" height="6" fill="#7f1d2d" />
            </pattern>
          </defs>
          <line x1={x(0)} x2={x(0)} y1={m.t} y2={h - m.b} stroke="#fb3b5c" strokeOpacity={0.6} strokeDasharray="3 3" />
          <line x1={x(base)} x2={x(base)} y1={m.t} y2={h - m.b} stroke="#e0f2fe" strokeOpacity={0.6} />
          <text x={x(base)} y={h - 6} textAnchor="middle" className="fill-white/70 font-mono text-[9px]">
            as reported {fmtM(base)}
          </text>
          {top.map((b, i) => {
            const yy = m.t + i * rowH + 3;
            const bh = rowH - 7;
            const worstRaw = Math.min(b.low, b.high);
            const broken = !Number.isFinite(worstRaw);
            const worst = broken ? lo - pad : worstRaw;
            const best = Math.max(b.low, b.high);
            return (
              <g key={b.nodeId}>
                <text x={m.l - 8} y={yy + bh / 2 + 3} textAnchor="end" className="fill-sky-100 font-mono text-[10px]">
                  {labelOf(b.nodeId).length > 26 ? `${labelOf(b.nodeId).slice(0, 25)}…` : labelOf(b.nodeId)}
                </text>
                <motion.rect
                  initial={{ width: 0, x: x(base) }}
                  animate={{ x: x(worst), width: Math.max(1, x(base) - x(worst)) }}
                  y={yy}
                  height={bh}
                  fill={broken ? 'url(#torn-broken)' : '#fb3b5c'}
                  fillOpacity={0.75}
                  rx={1.5}
                />
                <motion.rect initial={{ width: 0 }} animate={{ width: Math.max(1, x(best) - x(base)) }} x={x(base)} y={yy} height={bh} fill="#22d3ee" fillOpacity={0.7} rx={1.5} />
                <text x={x(best) + 4} y={yy + bh / 2 + 3} className="fill-[#6b8aa3] font-mono text-[9px]">
                  {broken ? '' : `±${fmtDur(b.swing / 2)}`}
                </text>
                {broken && (
                  <text x={x(worst) + 4} y={yy + bh / 2 + 3} className="fill-white font-mono text-[8.5px] font-bold">
                    NO WINDOW
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Convergence sparkline                                               */
/* ------------------------------------------------------------------ */

export function Convergence({ history }: { history: number[] }) {
  const w = 150;
  const h = 34;
  if (history.length < 2) return <svg width={w} height={h} />;
  const x = scaleLinear().domain([0, history.length - 1]).range([2, w - 2]);
  const y = scaleLinear().domain([0, 1]).range([h - 2, 2]);
  const ln = line<number>()
    .x((_, i) => x(i))
    .y((d) => y(d))
    .curve(curveStepAfter);
  const lastP = history[history.length - 1];
  return (
    <svg width={w} height={h}>
      <path d={ln(history) ?? ''} fill="none" stroke={pColor(lastP)} strokeWidth={1.4} />
      <circle cx={x(history.length - 1)} cy={y(lastP)} r={2.5} fill={pColor(lastP)} />
    </svg>
  );
}
