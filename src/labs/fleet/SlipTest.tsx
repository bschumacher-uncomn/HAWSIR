import { Dices, TimerReset } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import type { SlipChallenge } from '@/api/types';
import { Panel, StatusBadge } from '@/components/ui';
import { fmtDur, fmtMargin, fmtT } from '@/lib/time';
import { useEngine } from '@/state/engine';

/**
 * Random slip: the node picks one input upstream of a mission capability,
 * slips it, and recomputes. The answer that matters is how late the
 * capability becomes (often zero: upstream slack absorbs it; sometimes far
 * more than the slip: a missed window). Compute time is a footnote.
 */
export function SlipTest() {
  const { scenario, snapshot } = useEngine();
  const [r, setR] = useState<{ mission: string; at: number; s: SlipChallenge } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // a result belongs to one mission and one picture; switching either clears it
  useEffect(() => {
    setR(null);
    setErr(null);
  }, [scenario.id, snapshot.key]);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const seed = Math.floor(Math.random() * 1e9);
      const s = await api.get<SlipChallenge>(`/m/${scenario.id}/slip?seed=${seed}&at=${snapshot.at}`);
      setR({ mission: scenario.id, at: snapshot.at, s });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const s = r && r.mission === scenario.id ? r.s : null;
  const delayText = s ? (Number.isFinite(s.delay) ? (Math.abs(s.delay) < 1 / 60 ? 'NO DELAY' : `+${fmtDur(s.delay)}`) : 'NEVER READY') : '';
  const tone = !s ? '#22d3ee' : s.absorbed ? '#34d399' : !Number.isFinite(s.delay) || s.statusAfter === 'N' ? '#fb3b5c' : s.delay > s.slip + 1e-6 ? '#fb3b5c' : '#fbbf24';

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <Dices size={12} className="text-calc" /> Random slip
        </span>
      }
      className="h-full"
      right={
        <button type="button" onClick={() => void run()} disabled={busy} className="rounded-[3px] border border-calc/50 bg-calc/10 px-2 py-0.5 font-display text-[10px] font-bold tracking-[0.16em] text-calc hover:bg-calc/20 disabled:opacity-40">
          {busy ? 'SLIPPING…' : 'SLIP ONE INPUT'}
        </button>
      }
      bodyClass="p-2.5"
    >
      {err && <div className="font-mono text-[11px] text-crit">{err}</div>}
      {!s && !err && (
        <div className="flex h-full items-center gap-3 text-[11.5px] leading-snug text-sky-200/65">
          <TimerReset size={22} className="shrink-0 text-calc/70" />
          The node slips a random input feeding a {scenario.mission.name} capability at {fmtT(scenario, snapshot.at)} and reports how late the capability becomes. Switch missions in the header to test the other one.
        </div>
      )}
      {s && (
        <motion.div key={`${s.nodeId}|${s.slip}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex h-full flex-col">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-[30px] font-bold leading-none tabular" style={{ color: tone, textShadow: `0 0 18px ${tone}66` }}>
              {delayText}
            </span>
            <span className="font-mono text-[11px] text-sky-200/70">to {s.targetCode}</span>
            <span className="ml-auto flex items-center gap-1">
              <StatusBadge status={s.statusBefore} size="sm" />
              <span className="text-mute">→</span>
              <StatusBadge status={s.statusAfter} size="sm" pulse={s.statusAfter !== s.statusBefore} />
            </span>
          </div>
          <div className="mt-1.5 truncate text-[12px] text-sky-50" title={s.label}>
            {s.label} slips <b>{fmtDur(s.slip)}</b>
          </div>
          <div className="mt-0.5 text-[11px] leading-snug text-sky-200/65">
            {s.absorbed
              ? `Absorbed: it had ${s.noImpact === Infinity ? 'unlimited' : fmtDur(s.noImpact)} of upstream slack.`
              : !Number.isFinite(s.delay)
                ? 'No path to the capability inside the horizon after this slip.'
                : s.delay > s.slip + 1e-6
                  ? `Nonlinear: a ${fmtDur(s.slip)} slip costs ${fmtDur(s.delay)}. Now controlled by ${s.controllingAfter}.`
                  : `Margin ${fmtMargin(s.marginBefore)} → ${fmtMargin(s.marginAfter)}. Controlled by ${s.controllingAfter}.`}
          </div>
          <div className="mt-auto font-mono text-[9px] text-mute">recomputed on the node in {s.computeMs.toFixed(1)} ms · sandbox, nothing recorded</div>
        </motion.div>
      )}
    </Panel>
  );
}
