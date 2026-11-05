import { History, Pause, Play, Radio } from 'lucide-react';
import { fmtT } from '@/lib/time';
import { useEngine } from '@/state/engine';
import { useStore } from '@/state/store';
import { Btn } from './ui';

/** Time-travel control: drag the watch clock and the whole picture recomputes at that instant. */
export function Scrubber({ label = 'Time travel' }: { label?: string }) {
  const { scenario, at, applied } = useEngine();
  const setWatchTime = useStore((s) => s.setWatchTime);
  const playing = useStore((s) => s.playing);
  const setPlaying = useStore((s) => s.setPlaying);
  const hours = scenario.timeScale === 'hours';
  const last = scenario.events[scenario.events.length - 1].t;
  const lo = scenario.watchStart;
  const hi = Math.max(last + (hours ? 1 : 24), at);
  const live = at >= last;
  const pct = (t: number) => ((t - lo) / (hi - lo)) * 100;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <History size={14} className="shrink-0 text-calc" />
      <span className="label shrink-0 !text-[9px]">{label}</span>
      <div className="relative min-w-0 flex-1">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-0">
          {scenario.events.map((e) => (
            <span
              key={e.id}
              className="absolute top-[-7px] h-[14px] w-[2px] -translate-x-1/2 rounded"
              style={{ left: `${pct(e.t)}%`, background: e.severity === 'crit' ? '#fb3b5c' : e.severity === 'warn' ? '#fbbf24' : '#38bdf8', opacity: applied.some((a) => a.id === e.id) ? 0.9 : 0.3 }}
            />
          ))}
        </div>
        <input type="range" className="slip relative w-full" min={lo} max={hi} step={hours ? 0.25 : 1} value={Math.min(hi, at)} onChange={(e) => setWatchTime(Number(e.target.value))} />
      </div>
      <span className="shrink-0 font-mono text-[12px] font-bold text-white">{fmtT(scenario, at)}</span>
      <Btn tone="ghost" className="!px-1.5" onClick={() => setPlaying(!playing)} title="Replay the change stream">
        {playing ? <Pause size={12} /> : <Play size={12} />}
      </Btn>
      <Btn tone={live ? 'ok' : 'unc'} onClick={() => setWatchTime(last + (hours ? 0.25 : 1))} title="Jump to the latest picture">
        <Radio size={12} /> {live ? 'Live' : 'Back to live'}
      </Btn>
    </div>
  );
}
