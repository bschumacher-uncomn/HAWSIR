import { Building2, Check, Ship, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { OptionEval } from '@/api/types';
import { BRAND } from '@/brand';
import { fmtDur, fmtMargin, fmtT } from '@/lib/time';
import { actions } from '@/state/actions';
import { useEngine } from '@/state/engine';
import { cn } from '@/lib/util';
import { Btn, StatusBadge } from '@/components/ui';

export function OptionCard({ o, rank, compact }: { o: OptionEval; rank?: number; compact?: boolean }) {
  const { snapshot, halted: stop, scenario } = useEngine();
  const halted = stop.stopped;
  // the analysis may be a step behind the picture: re-check act-by times against the time on screen
  const deadline = Math.min(...o.levers.map((l) => l.deadline ?? Infinity));
  const expired = Number.isFinite(deadline) && snapshot.at > deadline + 1e-9;
  const available = o.available && !expired;
  const reason = expired ? `act-by ${fmtT(scenario, deadline)} has passed` : o.unavailableReason;
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'idle' | 'approve' | 'reject'>('idle');
  const [note, setNote] = useState('');
  const accept = o.levers.some((l) => l.category === 'accept');
  const offShip = o.levers.some((l) => !l.withinShipAuthority);
  const good = o.effective && !accept;
  const color = !available ? '#475569' : accept ? '#fbbf24' : good ? '#34d399' : '#64748b';
  const title = o.levers.map((l) => l.title).join('  +  ');

  const commit = async (decision: 'APPROVED' | 'REJECTED') => {
    const text = note.trim();
    if (decision === 'REJECTED' && !text) return;
    setBusy(true);
    let ok = true;
    for (const l of o.levers) {
      const d = decision === 'APPROVED' ? await actions.approve(snapshot.mission, snapshot.at, l.id, text || undefined) : await actions.reject(snapshot.mission, snapshot.at, l.id, text);
      if (!d) {
        ok = false;
        break;
      }
    }
    setBusy(false);
    if (!ok) return;
    toast(decision === 'APPROVED' ? 'Decision recorded · planning assumption applied' : 'Rejection recorded', {
      description: decision === 'APPROVED' ? 'Not an order. Source systems unchanged. Hash-chained on the node.' : 'Hash-chained on the node with your reason.',
    });
    setMode('idle');
    setNote('');
  };

  return (
    <div className={cn('relative rounded-[3px] border bg-black/25 p-2.5', o.levers.length > 1 && good && 'bg-ok/[0.04]')} style={{ borderColor: `${color}44` }}>
      <div className="flex items-start gap-2">
        {rank !== undefined && <span className="mt-0.5 font-mono text-[10px] text-mute">{String(rank).padStart(2, '0')}</span>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {o.levers.length > 1 && <span className="rounded-[2px] bg-ok/15 px-1 font-display text-[9px] font-bold tracking-[0.14em] text-ok">PACKAGE</span>}
            {accept && <span className="rounded-[2px] bg-unc/15 px-1 font-display text-[9px] font-bold tracking-[0.14em] text-unc">ACCEPT RISK</span>}
            <span className="text-[12.5px] font-semibold leading-snug text-sky-50">{title}</span>
          </div>
          {!compact && <div className="mt-0.5 text-[11px] leading-snug text-sky-200/55">{o.levers.length === 1 ? o.levers[0].detail : o.why}</div>}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px]">
            <span style={{ color }} className="font-semibold">
              {available ? (o.recovered > 1e-6 ? `${fmtDur(o.recovered, { signed: true })} margin` : 'no margin gain') : reason}
            </span>
            {available && (
              <span className="flex items-center gap-1 text-mute">
                → <StatusBadge status={o.statusAfter} size="sm" /> {fmtMargin(o.marginAfter)}
              </span>
            )}
            <span className={cn('flex items-center gap-1', offShip ? 'text-orange-300/80' : 'text-sky-300/70')}>
              {offShip ? <Building2 size={11} /> : <Ship size={11} />}
              {offShip ? 'OFF-SHIP APPROVAL' : 'SHIP AUTHORITY'}
            </span>
          </div>
          {!compact && available && (
            <div className="mt-1 font-mono text-[10px] text-sky-300/50">
              {o.levers.map((l) => l.authority).join(' · ')}
              {Number.isFinite(deadline) && <span className="text-unc/80"> · act by {fmtT(scenario, deadline)}</span>}
            </div>
          )}
        </div>
        {available && mode === 'idle' && (
          <div className="flex shrink-0 flex-col gap-1">
            <Btn tone="ok" disabled={halted} onClick={() => setMode('approve')} className="!px-2 !py-0.5">
              <Check size={12} /> Approve
            </Btn>
            <Btn tone="ghost" disabled={halted} onClick={() => setMode('reject')} className="!px-2 !py-0.5">
              <X size={12} /> Reject
            </Btn>
          </div>
        )}
      </div>
      <AnimatePresence>
        {mode !== 'idle' && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-2 rounded-[3px] border border-sky-300/15 bg-black/40 p-2">
              <div className="text-[10.5px] leading-snug text-sky-200/70">
                {mode === 'approve'
                  ? `Records your decision and applies this as a planning assumption in ${BRAND.name}. It does not issue orders, request parts, or change OMMS-NG / R-Supply / NSIPS.`
                  : 'Records that you rejected this option. Add why, so the next watch understands.'}
              </div>
              <input
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={mode === 'approve' ? 'Note (optional)' : 'Reason (required)'}
                className="mt-1.5 w-full rounded-[2px] border border-sky-300/20 bg-black/50 px-2 py-1 font-mono text-[11px] text-white outline-none focus:border-calc"
              />
              <div className="mt-1.5 flex justify-end gap-1.5">
                <Btn tone="ghost" onClick={() => setMode('idle')}>
                  Cancel
                </Btn>
                <Btn tone={mode === 'approve' ? 'ok' : 'crit'} disabled={busy || (mode === 'reject' && !note.trim())} onClick={() => void commit(mode === 'approve' ? 'APPROVED' : 'REJECTED')}>
                  Confirm {mode === 'approve' ? 'approval' : 'rejection'}
                </Btn>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <span className="pointer-events-none absolute right-0 top-0 h-full w-[2px]" style={{ background: color, opacity: 0.6 }} />
    </div>
  );
}
