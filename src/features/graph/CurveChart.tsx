import { scaleLinear } from 'd3-scale';
import { area, curveLinear, line } from 'd3-shape';
import { useId, useMemo } from 'react';
import type { CurvePoint } from '@/engine';
import { fmtDur } from '@/engine/time';

interface Props {
  points: CurvePoint[];
  current: number;
  qMargin: number;
  cliffThreshold: number;
  step: number;
  width?: number;
  height?: number;
}

const fmtAxis = (h: number) => (Math.abs(h) >= 24 ? `${Math.round(h / 24)}d` : `${Math.round(h)}h`);

export function CurveChart({ points, current, qMargin, cliffThreshold, step, width = 392, height = 168 }: Props) {
  const gid = useId().replace(/:/g, '');
  const m = { l: 40, r: 10, t: 12, b: 22 };
  const finite = points.filter((p) => Number.isFinite(p.margin));
  const x = scaleLinear()
    .domain([points[0]?.delta ?? 0, points[points.length - 1]?.delta ?? 1])
    .range([m.l, width - m.r]);
  const ys = finite.map((p) => p.margin);
  const lo = Math.min(-qMargin, ...ys);
  const hi = Math.max(qMargin, ...ys);
  const y = scaleLinear()
    .domain([lo - (hi - lo) * 0.08, hi + (hi - lo) * 0.08])
    .range([height - m.b, m.t]);

  const cliffs = useMemo(() => {
    const out: { delta: number; drop: number; margin: number }[] = [];
    for (let i = 1; i < points.length; i++) {
      const d = points[i - 1].margin - points[i].margin;
      const dx = points[i].delta - points[i - 1].delta;
      if (d > dx + cliffThreshold || (!Number.isFinite(points[i].margin) && Number.isFinite(points[i - 1].margin)))
        out.push({ delta: points[i].delta, drop: d, margin: points[i - 1].margin });
    }
    return out;
  }, [points, cliffThreshold]);

  const ln = line<CurvePoint>()
    .defined((p) => Number.isFinite(p.margin))
    .x((p) => x(p.delta))
    .y((p) => y(p.margin))
    .curve(curveLinear);
  const ar = area<CurvePoint>()
    .defined((p) => Number.isFinite(p.margin))
    .x((p) => x(p.delta))
    .y0(y(0))
    .y1((p) => y(p.margin));

  const curIdx = points.reduce((best, p, i) => (Math.abs(p.delta - current) < Math.abs(points[best].delta - current) ? i : best), 0);
  const cur = points[curIdx];
  const xTicks = x.ticks(6);
  const yTicks = y.ticks(4);
  const zeroY = y(0);

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={`g-${gid}`} x1="0" x2="0" y1={m.t} y2={height - m.b} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#22d3ee" stopOpacity="0.35" />
          <stop offset={Math.max(0, Math.min(1, (zeroY - m.t) / (height - m.b - m.t)))} stopColor="#22d3ee" stopOpacity="0.04" />
          <stop offset={Math.max(0, Math.min(1, (zeroY - m.t) / (height - m.b - m.t)))} stopColor="#fb3b5c" stopOpacity="0.08" />
          <stop offset="1" stopColor="#fb3b5c" stopOpacity="0.45" />
        </linearGradient>
        <clipPath id={`c-${gid}`}>
          <rect x={m.l} y={m.t} width={width - m.l - m.r} height={height - m.t - m.b} />
        </clipPath>
      </defs>
      <rect x={m.l} y={zeroY} width={width - m.l - m.r} height={Math.max(0, height - m.b - zeroY)} fill="#fb3b5c" opacity={0.05} />
      <rect x={m.l} y={y(qMargin)} width={width - m.l - m.r} height={Math.max(0, zeroY - y(qMargin))} fill="#fbbf24" opacity={0.05} />
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} stroke="#38bdf8" strokeOpacity={0.07} />
          <text x={m.l - 5} y={y(t) + 3} textAnchor="end" className="fill-[#6b8aa3] font-mono text-[8.5px]">
            {fmtAxis(t)}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <g key={`x${t}`}>
          <line x1={x(t)} x2={x(t)} y1={m.t} y2={height - m.b} stroke="#38bdf8" strokeOpacity={t === 0 ? 0.25 : 0.06} />
          <text x={x(t)} y={height - 8} textAnchor="middle" className="fill-[#6b8aa3] font-mono text-[8.5px]">
            {t > 0 ? '+' : ''}
            {fmtAxis(t)}
          </text>
        </g>
      ))}
      <line x1={m.l} x2={width - m.r} y1={zeroY} y2={zeroY} stroke="#fb3b5c" strokeOpacity={0.7} strokeDasharray="4 3" />
      <text x={width - m.r} y={zeroY - 4} textAnchor="end" className="fill-[#fb3b5c] font-display text-[8.5px] font-semibold tracking-widest">
        REQUIRED BY
      </text>
      <g clipPath={`url(#c-${gid})`}>
        <path d={ar(points) ?? ''} fill={`url(#g-${gid})`} />
        <path d={ln(points) ?? ''} fill="none" stroke="#22d3ee" strokeWidth={4} strokeOpacity={0.2} style={{ filter: 'blur(3px)' }} />
        <path d={ln(points) ?? ''} fill="none" stroke="#67e8f9" strokeWidth={1.6} />
      </g>
      {cliffs.slice(0, 3).map((c) => (
        <g key={c.delta}>
          <line x1={x(c.delta)} x2={x(c.delta)} y1={m.t} y2={height - m.b} stroke="#fb3b5c" strokeOpacity={0.6} strokeDasharray="2 2" />
          <rect x={x(c.delta) + 3} y={m.t} width={86} height={14} rx={2} fill="#2a0710" stroke="#fb3b5c" strokeOpacity={0.6} />
          <text x={x(c.delta) + 7} y={m.t + 10} className="fill-[#fb3b5c] font-mono text-[8.5px] font-bold">
            CLIFF {Number.isFinite(c.drop) ? `−${fmtDur(c.drop - step)}` : '∞'}
          </text>
        </g>
      ))}
      {cur && Number.isFinite(cur.margin) && (
        <g>
          <line x1={x(cur.delta)} x2={x(cur.delta)} y1={m.t} y2={height - m.b} stroke="#fff" strokeOpacity={0.5} />
          <circle cx={x(cur.delta)} cy={y(cur.margin)} r={8} fill="none" stroke={cur.margin < 0 ? '#fb3b5c' : '#22d3ee'} strokeOpacity={0.5} className="animate-pulse" />
          <circle cx={x(cur.delta)} cy={y(cur.margin)} r={3.5} fill="#fff" style={{ filter: `drop-shadow(0 0 6px ${cur.margin < 0 ? '#fb3b5c' : '#22d3ee'})` }} />
        </g>
      )}
    </svg>
  );
}
