import { scaleLinear } from 'd3-scale';
import { area, curveStepAfter, line } from 'd3-shape';
import { useMemo } from 'react';
import { fmtDur, fmtT } from '@/engine/time';
import { useEngine } from '@/state/engine';
import { useStore } from '@/state/store';
import { useSize } from '@/lib/useSize';
import { STATUS_COLOR } from '@/lib/util';

interface Pt {
  t: number;
  m: number;
  ev?: string;
}

/** Authoritative margin per capability as each change landed: how fast the mission is being eaten. */
export function BurnDown() {
  const { scenario, at, applied, impacts, result, authResult } = useEngine();
  const selected = useStore((s) => s.selectedCap);
  const select = useStore((s) => s.selectCap);
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const hours = scenario.timeScale === 'hours';
  const unit = hours ? 1 : 24;

  const series = useMemo(() => {
    const out: Record<string, Pt[]> = {};
    for (const e of applied) {
      const imp = impacts[e.id];
      if (!imp) continue;
      for (const c of imp.after.capabilities) (out[c.id] ??= []).push({ t: e.t, m: c.margin, ev: e.id });
    }
    for (const c of authResult.capabilities) (out[c.id] ??= []).push({ t: at, m: c.margin });
    return out;
  }, [applied, impacts, authResult, at]);

  const m = { l: 40, r: 70, t: 14, b: 22 };
  const t0 = scenario.watchStart;
  const t1 = Math.max(at, ...applied.map((e) => e.t)) + (hours ? 0.5 : 12);
  const finite = Object.values(series)
    .flat()
    .map((p) => p.m)
    .filter(Number.isFinite);
  const yMax = Math.min(Math.max(...finite, unit), unit * 16);
  const yMin = Math.min(-unit * 0.5, ...finite);
  const x = scaleLinear().domain([t0, t1]).range([m.l, Math.max(m.l + 10, w - m.r)]);
  const y = scaleLinear()
    .domain([yMin, yMax])
    .range([Math.max(m.t + 10, h - m.b), m.t])
    .clamp(true);
  const ln = line<Pt>()
    .x((p) => x(p.t))
    .y((p) => y(Number.isFinite(p.m) ? p.m : yMin))
    .curve(curveStepAfter);
  const ar = area<Pt>()
    .x((p) => x(p.t))
    .y0(y(0))
    .y1((p) => y(Number.isFinite(p.m) ? p.m : yMin))
    .curve(curveStepAfter);

  const sel = result.capabilities.find((c) => c.id === selected);
  const selPts = series[selected] ?? [];
  const drops = selPts
    .map((p, i) => ({ p, d: i > 0 ? p.m - selPts[i - 1].m : 0 }))
    .filter((d) => d.d < -(hours ? 0.1 : 6) && d.p.ev)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  const q = scenario.nodes.find((n) => n.id === selected)?.qMargin ?? scenario.thresholds.qMargin;
  const yTicks = y.ticks(5);
  const xTicks = x.ticks(hours ? 6 : 8);

  return (
    <div ref={ref} className="relative h-full w-full">
      {w > 0 && (
        <svg width={w} height={h} className="absolute inset-0">
          <rect x={m.l} y={y(0)} width={w - m.l - m.r} height={Math.max(0, h - m.b - y(0))} fill="#fb3b5c" opacity={0.06} />
          <rect x={m.l} y={y(q)} width={w - m.l - m.r} height={Math.max(0, y(0) - y(q))} fill="#fbbf24" opacity={0.05} />
          <text x={m.l + 4} y={y(q) - 3} className="fill-[#fbbf24]/70 font-mono text-[8.5px]">
            Q THRESHOLD {fmtDur(q)}
          </text>
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} stroke="#38bdf8" strokeOpacity={t === 0 ? 0.4 : 0.06} />
              <text x={m.l - 5} y={y(t) + 3} textAnchor="end" className="fill-[#6b8aa3] font-mono text-[8.5px]">
                {hours ? `${t}h` : `${Math.round(t / 24)}d`}
              </text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={t} x={x(t)} y={h - 7} textAnchor="middle" className="fill-[#6b8aa3] font-mono text-[8.5px]">
              {fmtT(scenario, t)}
            </text>
          ))}
          {applied.map((e) => (
            <line key={e.id} x1={x(e.t)} x2={x(e.t)} y1={m.t} y2={h - m.b} stroke="#38bdf8" strokeOpacity={0.07} />
          ))}
          {result.capabilities.map((c) => {
            const pts = series[c.id] ?? [];
            const on = c.id === selected;
            if (on) return null;
            return (
              <g key={c.id} className="cursor-pointer" onClick={() => select(c.id)}>
                <path d={ln(pts) ?? ''} fill="none" stroke="#7dd3fc" strokeOpacity={0.35} strokeWidth={1.1} />
                <path d={ln(pts) ?? ''} fill="none" stroke="transparent" strokeWidth={10} />
                <text x={w - m.r + 6} y={y(Number.isFinite(pts[pts.length - 1]?.m) ? pts[pts.length - 1].m : yMin) + 3} className="fill-[#7dd3fc]/60 font-display text-[9px] font-bold tracking-widest">
                  {c.code}
                </text>
              </g>
            );
          })}
          {sel && (
            <g>
              <path d={ar(selPts) ?? ''} fill={STATUS_COLOR[sel.status]} fillOpacity={0.1} />
              <path d={ln(selPts) ?? ''} fill="none" stroke={STATUS_COLOR[sel.status]} strokeWidth={6} strokeOpacity={0.25} style={{ filter: 'blur(3px)' }} />
              <path d={ln(selPts) ?? ''} fill="none" stroke={STATUS_COLOR[sel.status]} strokeWidth={2.2} />
              <text x={w - m.r + 6} y={y(Number.isFinite(selPts[selPts.length - 1]?.m) ? selPts[selPts.length - 1].m : yMin) + 4} className="font-display text-[11px] font-bold tracking-widest" fill={STATUS_COLOR[sel.status]}>
                {sel.code}
              </text>
              {drops.map(({ p, d }) => (
                <g key={p.ev}>
                  <circle cx={x(p.t)} cy={y(Number.isFinite(p.m) ? p.m : yMin)} r={4} fill="#02060c" stroke="#fb3b5c" strokeWidth={1.5} />
                  <rect x={x(p.t) + 6} y={y(Number.isFinite(p.m) ? p.m : yMin) - 16} width={86} height={13} rx={2} fill="#2a0710" stroke="#fb3b5c" strokeOpacity={0.5} />
                  <text x={x(p.t) + 10} y={y(Number.isFinite(p.m) ? p.m : yMin) - 6.5} className="fill-[#fb3b5c] font-mono text-[8.5px] font-bold">
                    {p.ev} {Number.isFinite(d) ? fmtDur(d, { signed: true }) : 'NO WINDOW'}
                  </text>
                </g>
              ))}
            </g>
          )}
          <line x1={x(at)} x2={x(at)} y1={m.t} y2={h - m.b} stroke="#22d3ee" strokeOpacity={0.7} />
        </svg>
      )}
    </div>
  );
}
