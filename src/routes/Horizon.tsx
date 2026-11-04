import { fmtDur } from '@/engine/time';
import { useCapAnalysis } from '@/state/analysis';
import { useEngine } from '@/state/engine';
import { Panel, Pill } from '@/components/ui';
import { Scrubber } from '@/components/Scrubber';
import { cn } from '@/lib/util';
import { BurnDown } from '@/features/horizon/BurnDown';
import { DataHealth } from '@/features/horizon/DataHealth';
import { Deadlines } from '@/features/horizon/Deadlines';
import { Timeline } from '@/features/horizon/Timeline';

export default function Horizon() {
  const { scenario, at, result, cap } = useEngine();
  const analysis = useCapAnalysis(cap?.id);
  const toMission = scenario.mission.start - at;
  const counts = { Y: 0, Q: 0, N: 0 };
  for (const c of result.capabilities) counts[c.status]++;

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="hud flex shrink-0 items-center gap-4 px-3 py-2">
        <div>
          <div className="label !text-[9px] !text-calc/80">Know before it breaks the mission</div>
          <div className="font-display text-[14px] font-bold tracking-[0.18em] text-white">READINESS HORIZON</div>
        </div>
        <div className="flex items-center gap-2">
          <Pill color="#e0f2fe">T−{fmtDur(Math.max(0, toMission))} to tasking</Pill>
          <span className="font-mono text-[11px]">
            <span className="text-ok">{counts.Y}Y</span> <span className="text-unc">{counts.Q}Q</span> <span className={cn(counts.N ? 'text-crit' : 'text-mute')}>{counts.N}N</span>
          </span>
        </div>
        <Scrubber />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_400px] grid-rows-[minmax(0,1fr)_236px] gap-3">
        <Panel
          title="Capability readiness vs mission phases"
          index="HZN-1"
          right={
            <span className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-wider text-mute">
              <span className="flex items-center gap-1">
                <i className="h-2 w-2 rotate-45 bg-unc" />
                projected ready
              </span>
              <span className="flex items-center gap-1">
                <i className="h-2 w-2 rotate-45 border border-unc/60" />
                earlier predictions
              </span>
              <span className="flex items-center gap-1">
                <i className="h-2.5 w-4 rounded-[2px] border border-dashed border-unc/60 bg-unc/10" />
                P10–P90
              </span>
              <span className="flex items-center gap-1">
                <i className="h-2.5 w-4 rounded-[2px] bg-teal-300/30" />
                delivery window
              </span>
            </span>
          }
        >
          <Timeline mc={analysis?.mc} />
        </Panel>
        <Panel title="Act-by list" index="HZN-2" right={<span className="font-mono text-[9px] text-mute">soonest first</span>} className="row-span-2" bodyClass="overflow-y-auto">
          <Deadlines />
        </Panel>
        <div className="grid min-h-0 grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-3">
          <Panel title={`Margin burn-down · authoritative · ${cap?.code ?? ''}`} index="HZN-3" bodyClass="p-1">
            <BurnDown />
          </Panel>
          <Panel title="Data health" index="HZN-4">
            <DataHealth />
          </Panel>
        </div>
      </div>
    </div>
  );
}
