import { AnimatePresence, motion } from 'motion/react';
import { Check, Link2, Unlink, X } from 'lucide-react';
import type { AuditEntry } from '@/state/store';
import { useSize } from '@/lib/useSize';
import { cn } from '@/lib/util';
import type { LinkState } from './useChain';

const BW = 152;
const GAP = 26;
export const ACTOR_COLOR: Record<string, string> = { WATCHSTANDER: '#e0f2fe', ENGINE: '#22d3ee', AI: '#a78bfa', SYSTEM: '#94a3b8' };

export function ChainStrip({ audit, states, scan, focusSeq }: { audit: AuditEntry[]; states: LinkState[]; scan: number | null; focusSeq?: number }) {
  const [ref, { w }] = useSize<HTMLDivElement>();
  const count = Math.max(3, Math.floor((w + GAP) / (BW + GAP)));
  const focusIdx = focusSeq !== undefined ? audit.findIndex((e) => e.seq === focusSeq) : -1;
  const end = focusIdx >= 0 ? Math.min(audit.length, focusIdx + Math.ceil(count / 2)) : audit.length;
  const start = Math.max(0, end - count);
  const view = audit.slice(start, end);

  return (
    <div ref={ref} className="relative flex h-full items-center">
      {start > 0 && <div className="absolute -left-1 top-1/2 -translate-y-1/2 font-mono text-[10px] text-mute">⋯ {start}</div>}
      <div className="flex items-center" style={{ gap: 0, paddingLeft: start > 0 ? 22 : 0 }}>
        <AnimatePresence initial={false}>
          {view.map((e, k) => {
            const i = start + k;
            const st = states[i];
            const scanned = scan !== null && e.seq <= scan;
            const head = scan !== null && e.seq === scan;
            const col = st === 'bad' ? '#fb3b5c' : st === 'after' ? '#fbbf24' : '#22d3ee';
            return (
              <motion.div key={e.hash + e.seq} layout initial={{ opacity: 0, x: 40, scale: 0.9 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: -40 }} className="flex items-center">
                {k > 0 && (
                  <div className="relative flex items-center justify-center" style={{ width: GAP }}>
                    <div className="h-[2px] w-full" style={{ background: st === 'bad' ? 'repeating-linear-gradient(90deg,#fb3b5c 0 4px,transparent 4px 7px)' : `${col}${scanned ? 'cc' : '55'}` }} />
                    <span className="absolute rounded-full bg-abyss p-[2px]">{st === 'bad' ? <Unlink size={11} className="text-crit" /> : <Link2 size={11} style={{ color: col }} />}</span>
                  </div>
                )}
                <div
                  className={cn('relative overflow-hidden rounded-[3px] border bg-black/50 px-2 py-1.5 transition-shadow', head && 'ring-1 ring-white/70')}
                  style={{ width: BW, borderColor: `${col}${st === 'ok' ? '44' : 'aa'}`, boxShadow: st === 'bad' ? '0 0 26px -6px #fb3b5c' : scanned ? `0 0 18px -8px ${col}` : undefined }}
                >
                  {head && <motion.div className="pointer-events-none absolute inset-0" initial={{ x: '-100%' }} animate={{ x: '100%' }} transition={{ duration: 0.25 }} style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)' }} />}
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-[10px] font-bold text-white">#{String(e.seq).padStart(4, '0')}</span>
                    <span className="truncate font-mono text-[8.5px] uppercase" style={{ color: ACTOR_COLOR[e.actor] }}>
                      {e.actor}
                    </span>
                    <span className="ml-auto">
                      {scanned && (st === 'ok' ? <Check size={12} className="text-ok" /> : st === 'bad' ? <X size={12} className="text-crit" /> : <span className="font-mono text-[8px] text-unc">?</span>)}
                    </span>
                  </div>
                  <div className="truncate font-display text-[10.5px] font-semibold tracking-[0.08em] text-sky-100">{e.action}</div>
                  <div className="mt-0.5 font-mono text-[8.5px] leading-tight">
                    <div style={{ color: `${col}cc` }}>H {e.hash.slice(0, 14)}…</div>
                    <div className="text-mute">↳ {e.prev === '0'.repeat(64) ? 'GENESIS' : `${e.prev.slice(0, 14)}…`}</div>
                  </div>
                  {st === 'bad' && <div className="absolute inset-x-0 bottom-0 bg-crit/90 text-center font-display text-[8.5px] font-bold tracking-[0.2em] text-black">CONTENT ≠ HASH</div>}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
