import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Ban, Check, CloudOff, Download, Fingerprint, RotateCcw, Server, ShieldAlert, ShieldCheck, Undo2, Upload, X } from 'lucide-react';
import { fmtDur, fmtT } from '@/engine/time';
import { useEngine } from '@/state/engine';
import { useStore, type AuditEntry } from '@/state/store';
import { Btn, Panel, Pill } from '@/components/ui';
import { cn } from '@/lib/util';
import { ACTOR_COLOR, ChainStrip } from '@/features/log/ChainStrip';
import { useChainStatus, useEdgeCopy, useVerifyScan } from '@/features/log/useChain';

const ACTORS = ['ALL', 'WATCHSTANDER', 'ENGINE', 'AI', 'SYSTEM'] as const;
const PROHIBITED = ['Issue orders', 'Direct personnel', 'Authorize maintenance', 'Alter tasking', 'Write to authoritative records'];
const zulu = (iso: string) => `${iso.slice(11, 19)}Z`;

function Verdict({ n, scan, done, brokenAt, head }: { n: number; scan: number | null; done: boolean; brokenAt?: number; head?: string }) {
  if (scan === null)
    return (
      <div className="text-center">
        <Fingerprint size={30} className="mx-auto text-calc/60" />
        <div className="mt-1 font-mono text-[10px] text-mute">Press VERIFY to recompute every hash</div>
      </div>
    );
  if (!done)
    return (
      <div className="text-center">
        <div className="font-display text-[13px] font-bold tracking-[0.2em] text-calc">VERIFYING</div>
        <div className="font-mono text-[22px] font-bold text-white">
          {scan}/{n}
        </div>
      </div>
    );
  if (brokenAt !== undefined)
    return (
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center">
        <ShieldAlert size={30} className="mx-auto text-crit" />
        <div className="font-display text-[14px] font-bold tracking-[0.18em] text-crit">CHAIN BROKEN</div>
        <div className="font-mono text-[10.5px] text-crit/80">entry #{brokenAt} modified after signing</div>
      </motion.div>
    );
  return (
    <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center">
      <ShieldCheck size={30} className="mx-auto text-ok" />
      <div className="font-display text-[14px] font-bold tracking-[0.18em] text-ok">CHAIN INTACT</div>
      <div className="font-mono text-[10.5px] text-ok/80">
        {n}/{n} verified · head {head?.slice(0, 10)}…
      </div>
    </motion.div>
  );
}

export default function DecisionLog() {
  const { scenario } = useEngine();
  const audit = useStore((s) => s.audit);
  const decisions = useStore((s) => s.decisions);
  const approved = useStore((s) => s.approved);
  const link = useStore((s) => s.link);
  const { revoke, tamper, restoreEntry, log } = useStore.getState();
  const { states, brokenAt } = useChainStatus(audit);
  const { scan, done, start } = useVerifyScan(audit.length ? audit[audit.length - 1].seq : 0);
  const edge = useEdgeCopy();
  const [actor, setActor] = useState<(typeof ACTORS)[number]>('ALL');

  const rows = useMemo(() => audit.map((e, i) => ({ e, st: states[i] })).filter((r) => actor === 'ALL' || r.e.actor === actor).reverse(), [audit, states, actor]);
  const synced = audit.filter((e) => e.shoreSynced).length;
  const mirrored = audit.filter((e) => edge.byHash.has(e.hash)).length;
  const bad = brokenAt !== undefined ? audit.find((e) => e.seq === brokenAt) : undefined;
  const original = bad ? edge.byHash.get(bad.hash) : undefined;
  const capCode = (id: string) => scenario.nodes.find((n) => n.id === id)?.code ?? id;

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), ship: scenario.ship, scenario: scenario.id, chainHead: audit.at(-1)?.hash, entries: audit, decisions }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `navifi-audit-${scenario.ship.hull}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    log('WATCHSTANDER', 'AUDIT_EXPORT', `Exported ${audit.length} entries for review`, { head: audit.at(-1)?.hash });
  };

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_440px] grid-rows-[auto_auto_168px_minmax(0,1fr)] gap-3 p-3">
      <div className="hud col-span-2 flex items-center gap-4 px-3 py-2">
        <div>
          <div className="label !text-[9px] !text-calc/80">Decision log · {scenario.ship.name}</div>
          <div className="font-display text-[14px] font-bold tracking-[0.18em] text-white">TAMPER-EVIDENT AUDIT TRAIL</div>
        </div>
        <Pill color="#22d3ee">SHA-256 hash chain</Pill>
        <Pill color="#34d399">Edge copy · append-only</Pill>
        <div className="ml-4 flex gap-5 font-mono text-[11px]">
          <span>
            <span className="text-mute">ENTRIES </span>
            <span className="font-bold text-white">{audit.length}</span>
          </span>
          <span>
            <span className="text-mute">DECISIONS </span>
            <span className="font-bold text-white">{decisions.length}</span>
          </span>
          <span>
            <span className="text-mute">HEAD </span>
            <span className="text-calc">{audit.at(-1)?.hash.slice(0, 16) ?? '—'}…</span>
          </span>
        </div>
        <div className="ml-auto flex gap-2">
          <Btn tone="calc" onClick={start} disabled={!audit.length}>
            <ShieldCheck size={12} /> Verify chain
          </Btn>
          <Btn tone="crit" onClick={() => (tamper(), start())} disabled={audit.length < 3 || brokenAt !== undefined} title="Demo: silently edit one stored entry, as an insider might">
            <Fingerprint size={12} /> Simulate tamper
          </Btn>
          <Btn tone="ghost" onClick={exportJson} disabled={!audit.length}>
            <Download size={12} /> Export
          </Btn>
        </div>
      </div>

      <div className="col-span-2 flex items-center gap-3 rounded-[3px] border border-crit/30 bg-crit/[0.05] px-3 py-1.5">
        <Ban size={14} className="text-crit" />
        <span className="font-display text-[10.5px] font-bold tracking-[0.18em] text-crit">THIS SYSTEM CANNOT</span>
        {PROHIBITED.map((p) => (
          <span key={p} className="rounded-[2px] border border-crit/25 px-1.5 py-px font-mono text-[10px] text-crit/85 line-through decoration-crit/50">
            {p}
          </span>
        ))}
        <span className="ml-auto text-[11px] text-sky-200/60">Approved options are recorded as planning assumptions. A human decides and acts through the chain of command.</span>
      </div>

      <Panel title="Hash chain" index="LOG-1" className="col-span-2" bodyClass="flex gap-4 px-3 py-2">
        <div className="min-w-0 flex-1">{audit.length ? <ChainStrip audit={audit} states={states} scan={scan} focusSeq={brokenAt} /> : <div className="flex h-full items-center font-mono text-[11px] text-mute">No entries yet. Every watchstander action lands here.</div>}</div>
        <div className="flex w-[230px] shrink-0 items-center justify-center border-l border-sky-300/10">
          <Verdict n={audit.length} scan={scan} done={done} brokenAt={brokenAt} head={audit.at(-1)?.hash} />
        </div>
      </Panel>

      <Panel
        title="Audit trail"
        index="LOG-2"
        right={
          <div className="flex gap-1">
            {ACTORS.map((a) => (
              <button key={a} type="button" onClick={() => setActor(a)} className={cn('rounded-[2px] border px-1.5 py-px font-mono text-[9.5px]', actor === a ? 'border-calc/60 bg-calc/15 text-calc' : 'border-sky-300/10 text-mute hover:text-sky-200')}>
                {a}
              </button>
            ))}
          </div>
        }
        bodyClass="flex flex-col"
      >
        <div className="grid shrink-0 grid-cols-[56px_76px_104px_112px_150px_minmax(0,1fr)_118px_64px_58px] gap-2 border-b border-sky-300/10 px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-mute">
          <span>Seq</span>
          <span>Wall</span>
          <span>Watch time</span>
          <span>Actor</span>
          <span>Action</span>
          <span>Detail</span>
          <span>Hash</span>
          <span>Shore</span>
          <span>Edge</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.map(({ e, st }) => (
            <AuditRow key={`${e.seq}-${e.hash}`} e={e} st={st} scanned={scan !== null && e.seq <= scan} onEdge={edge.byHash.has(e.hash)} at={fmtT(scenario, e.t)} />
          ))}
        </div>
      </Panel>

      <div className="flex min-h-0 flex-col gap-3">
        <Panel title="Watchstander decisions" index="LOG-3" className="min-h-0 flex-1" bodyClass="space-y-1.5 overflow-y-auto p-2">
          {!decisions.length && <div className="p-2 font-mono text-[11px] text-mute">No decisions yet. Approve, modify or reject a bounded option on the Watch Floor.</div>}
          {[...decisions].reverse().map((d) => {
            const live = d.decision === 'APPROVED' && d.leverIds.some((id) => approved.includes(id));
            const status = d.decision === 'APPROVED' && !live ? 'REVOKED' : d.decision;
            const col = status === 'APPROVED' ? '#34d399' : status === 'REJECTED' ? '#fb3b5c' : '#94a3b8';
            return (
              <div key={d.id} className="rounded-[3px] border bg-black/40 p-2" style={{ borderColor: `${col}40` }}>
                <div className="flex items-center gap-2">
                  {status === 'APPROVED' ? <Check size={13} style={{ color: col }} /> : status === 'REJECTED' ? <X size={13} style={{ color: col }} /> : <Undo2 size={13} style={{ color: col }} />}
                  <span className="font-display text-[10px] font-bold tracking-[0.16em]" style={{ color: col }}>
                    {status === 'APPROVED' ? 'PLANNING ASSUMPTION' : status}
                  </span>
                  <span className="font-mono text-[9.5px] text-mute">{d.id}</span>
                  <span className="ml-auto font-mono text-[9.5px] text-mute">{fmtT(scenario, d.t)}</span>
                </div>
                <div className="mt-1 text-[12px] leading-snug text-sky-50">{d.title}</div>
                <div className="mt-1 flex items-center gap-2 font-mono text-[10px]">
                  <span className="text-mute">{capCode(d.targetCap)} margin</span>
                  <span className={d.marginBefore < 0 ? 'text-crit' : 'text-sky-200'}>{fmtDur(d.marginBefore, { signed: true })}</span>
                  <span className="text-mute">→</span>
                  <span className={d.marginAfter < 0 ? 'text-crit' : 'text-ok'}>{fmtDur(d.marginAfter, { signed: true })}</span>
                  <span className="ml-auto truncate text-mute">{d.by}</span>
                </div>
                {d.note && <div className="mt-1 border-l-2 border-sky-300/20 pl-2 text-[11px] italic text-sky-200/70">{d.note}</div>}
                {live && (
                  <div className="mt-1.5 flex justify-end">
                    <Btn tone="ghost" className="!py-0.5 !text-[9.5px]" onClick={() => d.leverIds.forEach((id) => revoke(id))}>
                      <RotateCcw size={10} /> Revoke
                    </Btn>
                  </div>
                )}
              </div>
            );
          })}
        </Panel>

        <Panel title={bad ? 'Tamper forensics' : 'Edge node copy'} index="LOG-4" tone={bad ? 'crit' : undefined} className="shrink-0" bodyClass="p-3">
          {bad ? (
            <div className="space-y-2 text-[11.5px]">
              <div className="text-crit/90">
                Entry <b>#{bad.seq}</b> ({bad.action}) no longer matches its hash. Every later entry is unverifiable until it is resolved.
              </div>
              <div className="rounded-[3px] border border-crit/30 bg-crit/[0.06] p-2 font-mono text-[10.5px]">
                <div className="text-mute">LOCAL (altered)</div>
                <div className="break-words text-crit">{bad.detail}</div>
              </div>
              {original ? (
                <>
                  <div className="rounded-[3px] border border-ok/30 bg-ok/[0.05] p-2 font-mono text-[10.5px]">
                    <div className="text-mute">EDGE COPY (hash {original.hash.slice(0, 10)}… matches original)</div>
                    <div className="break-words text-ok">{original.detail}</div>
                  </div>
                  <Btn tone="ok" onClick={() => (restoreEntry(bad.seq, { detail: original.detail, data: original.data }), setTimeout(start, 50))}>
                    <Upload size={12} /> Restore from edge copy
                  </Btn>
                </>
              ) : (
                <div className="font-mono text-[10.5px] text-unc">Edge copy {edge.err ? 'unreachable (DDIL)' : 'has no record of this hash'}; preserve and escalate.</div>
              )}
            </div>
          ) : edge.err ? (
            <div className="flex items-start gap-3">
              <CloudOff size={22} className="shrink-0 text-unc" />
              <div className="text-[11.5px] text-sky-200/75">Edge server unreachable. The local chain stays authoritative and verifiable; entries replay to the edge node on reconnect.</div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Server size={22} className="shrink-0 text-ok" />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[18px] font-bold text-white">
                  {mirrored}
                  <span className="text-[12px] text-mute">/{audit.length} mirrored</span>
                </div>
                <div className="text-[11px] text-sky-200/65">Server re-hashes every entry on receipt · {(edge.rows ?? []).filter((r) => r.serverVerified).length} verified rows on disk</div>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Store & forward to shore" index="LOG-5" className="shrink-0" bodyClass="p-3">
          <div className="flex items-center gap-3">
            <span className={cn('font-display text-[13px] font-bold tracking-[0.16em]', link === 'SATCOM' ? 'text-ok' : link === 'DDIL' ? 'text-unc' : 'text-crit')}>{link}</span>
            <div className="h-2 flex-1 overflow-hidden rounded bg-white/5">
              <motion.div className="h-full bg-ok/80" animate={{ width: `${audit.length ? (synced / audit.length) * 100 : 0}%` }} />
            </div>
            <span className="font-mono text-[11px] text-white">
              {synced}/{audit.length}
            </span>
          </div>
          <div className="mt-1.5 text-[11px] text-sky-200/65">
            {link === 'SATCOM' && 'Link up: entries forward to the shore reach-back cell within seconds.'}
            {link === 'DDIL' && `Degraded link: trickling 1 entry per 3.5 s. ${audit.length - synced} queued; nothing is dropped.`}
            {link === 'DENIED' && `EMCON / denied: ${audit.length - synced} entries held aboard, hash-chained, and replayed in order when the link returns.`}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function AuditRow({ e, st, scanned, onEdge, at }: { e: AuditEntry; st: 'ok' | 'bad' | 'after'; scanned: boolean; onEdge: boolean; at: string }) {
  const col = st === 'bad' ? '#fb3b5c' : st === 'after' ? '#fbbf24' : '#22d3ee';
  return (
    <div
      className={cn('grid grid-cols-[56px_76px_104px_112px_150px_minmax(0,1fr)_118px_64px_58px] items-center gap-2 border-b border-sky-300/[0.05] px-3 py-1 text-[11px] transition-colors hover:bg-white/[0.03]', st === 'bad' && 'bg-crit/[0.08]', scanned && st === 'ok' && 'bg-ok/[0.025]')}
      title={e.data ? JSON.stringify(e.data) : undefined}
    >
      <span className="font-mono font-bold text-white">#{String(e.seq).padStart(4, '0')}</span>
      <span className="font-mono text-[10px] text-mute">{zulu(e.wall)}</span>
      <span className="font-mono text-[10px] text-sky-200/80">{at}</span>
      <span className="truncate font-mono text-[10px]" style={{ color: ACTOR_COLOR[e.actor] }}>
        {e.actor}
      </span>
      <span className="truncate font-display text-[10.5px] font-semibold tracking-[0.06em] text-sky-100">{e.action}</span>
      <span className={cn('truncate', st === 'bad' ? 'text-crit' : 'text-sky-200/75')}>{e.detail}</span>
      <span className="flex items-center gap-1 font-mono text-[10px]" style={{ color: `${col}cc` }}>
        {scanned && (st === 'ok' ? <Check size={10} className="text-ok" /> : <X size={10} className={st === 'bad' ? 'text-crit' : 'text-unc'} />)}
        {e.hash.slice(0, 12)}
      </span>
      <span className={cn('font-mono text-[9.5px]', e.shoreSynced ? 'text-ok/80' : 'text-unc')}>{e.shoreSynced ? 'SENT' : 'QUEUED'}</span>
      <span className={cn('font-mono text-[9.5px]', onEdge ? 'text-ok/80' : 'text-mute')}>{onEdge ? 'COPY ✓' : 'LOCAL'}</span>
    </div>
  );
}
