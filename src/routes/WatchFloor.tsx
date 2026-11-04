import { Suspense, lazy, useMemo } from 'react';
import type { ShipPart } from '@/engine/types';
import { fmtT } from '@/engine/time';
import { useEngine } from '@/state/engine';
import { useStore } from '@/state/store';
import { shipParts, type PartState } from '@/features/ship/shipState';
import { CapabilityStack } from '@/features/watch/CapabilityStack';
import { ChangeFeed } from '@/features/watch/ChangeFeed';
import { FiveAnswers } from '@/features/watch/FiveAnswers';
import { MissionStrip } from '@/features/watch/MissionStrip';
import { STATUS_COLOR } from '@/lib/util';

const HoloShip = lazy(() => import('@/features/ship/HoloShip').then((m) => ({ default: m.HoloShip })));

function ShipStage() {
  const { nodes, result, at, scenario, cap } = useEngine();
  const selectCap = useStore((s) => s.selectCap);
  const parts = useMemo(() => shipParts(nodes, result, at, (t) => fmtT(scenario, t)), [nodes, result, at, scenario]);
  const focus = useMemo(() => {
    const set = new Set<ShipPart>();
    if (!cap) return set;
    for (const id of cap.chain) {
      const p = nodes[id]?.part;
      if (p) set.add(p);
    }
    return set;
  }, [cap, nodes]);
  const list = Object.values(parts) as PartState[];
  const down = list.filter((p) => !p.up);

  const onPick = (p: ShipPart) => {
    const st = parts[p];
    if (st?.capIds.length) selectCap(st.capIds[0]);
  };

  return (
    <section className="hud relative h-full min-h-0 min-w-0 overflow-hidden">
      <div className="absolute inset-0">
        <Suspense fallback={<div className="flex h-full items-center justify-center"><span className="label animate-blink !text-calc">Projecting hologram…</span></div>}>
          <HoloShip parts={parts} focus={focus} onPick={onPick} />
        </Suspense>
      </div>
      <div className="pointer-events-none absolute left-4 top-3">
        <div className="label !text-calc/80">Digital twin · material state now</div>
        <div className="mt-0.5 font-display text-[22px] font-bold tracking-[0.18em] text-white/90">{scenario.ship.name}</div>
        <div className="font-mono text-[11px] text-sky-200/50">
          {scenario.ship.hull} · {scenario.ship.cls}
        </div>
      </div>
      <div className="pointer-events-none absolute right-4 top-3 text-right">
        <div className="label">Systems</div>
        <div className="font-mono text-[22px] font-bold text-white">
          <span className="text-ok">{list.length - down.length}</span>
          <span className="text-mute">/{list.length}</span>
        </div>
        <div className="font-mono text-[10px] text-mute">up at {fmtT(scenario, at)}</div>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-4 space-y-1">
        {down.slice(0, 4).map((p) => (
          <div key={p.part} className="flex items-center gap-2 font-mono text-[11px]">
            <span className="h-2 w-2 animate-blink rounded-full" style={{ background: p.sev === 'crit' ? '#fb3b5c' : p.sev === 'warn' ? '#fbbf24' : '#38bdf8' }} />
            <span className="text-sky-50">{p.label}</span>
            <span className="text-mute">{p.partial ? 'redundancy lost' : `restore ${p.eta !== undefined ? fmtT(scenario, p.eta) : '—'}`}</span>
          </div>
        ))}
      </div>
      {cap && (
        <div className="pointer-events-none absolute bottom-3 right-4 text-right">
          <div className="label">Focus capability</div>
          <div className="font-display text-[26px] font-bold tracking-[0.14em]" style={{ color: STATUS_COLOR[cap.status], textShadow: `0 0 24px ${STATUS_COLOR[cap.status]}` }}>
            {cap.code} · {cap.status}
          </div>
          <div className="font-mono text-[10px] text-mute">click any system to focus</div>
        </div>
      )}
    </section>
  );
}

export function WatchFloor() {
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <MissionStrip />
      <div className="grid min-h-0 flex-1 grid-cols-[290px_minmax(0,1fr)_440px] gap-3">
        <CapabilityStack />
        <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_178px] gap-3">
          <ShipStage />
          <ChangeFeed />
        </div>
        <FiveAnswers />
      </div>
    </div>
  );
}
