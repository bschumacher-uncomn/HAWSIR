import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Ban, Check, CloudOff, Download, Fingerprint, RotateCcw, Server, ShieldAlert, ShieldCheck, Undo2, Upload, X } from 'lucide-react';
import { verifyDecisionChain } from '@engine/data/decisions';
import { verifyFactChain } from '@engine/data/store';
import { api } from '@/api/client';
import { useRemote } from '@/api/useRemote';
import type { AuditView, DecisionEntry, FactEntry } from '@/api/types';
import { BRAND } from '@/brand';
import { fmtT } from '@/lib/time';
import { actions } from '@/state/actions';
import { useEngine } from '@/state/engine';
import { useStore } from '@/state/store';
import { Btn, Panel, Pill } from '@/components/ui';
import { cn } from '@/lib/util';
import { ACTOR_COLOR, ChainStrip } from '@/features/log/ChainStrip';
import { chainStates, useVerifyScan, type ChainRow, type LinkState } from '@/features/log/useChain';

/**
 * The record, as the node holds it: two hash chains (decisions; reports
 * ingested), fetched from mission-api and re-verified here in the browser
 * with the engine's own hashing. "Simulate tamper" edits this browser's copy
 * only, to show a break being caught; "restore" fetches the node's copy again.
 */
type ChainKind = 'decisions' | 'facts';
const PROHIBITED = ['Issue orders', 'Direct personnel', 'Authorize maintenance', 'Alter tasking', 'Write to authoritative records'];
const zulu = (iso: string) => (iso ? `${iso.slice(11, 19)}Z` : '—');

function Verdict({ n, scan, done, brokenAt, head }: { n: number; scan: number | null; done: boolean; brokenAt?: number; head?: string }) {
  if (scan === null)
    return (
      <div className="text-center">
        <Fingerprint size={30} className="mx-auto text-calc/60" />
        <div className="mt-1 font-mono text-[10px] text-mute">Press VERIFY to recompute every hash here</div>
      </div>
    );
  if (!done)
    return (
      <div className="text-center">
        <div className="font-display text-[13px] font-bold tracking-[0.2em] text-calc">VERIFYING</div>
        <div className="font-mono text-[22px] font-bold text-white">
          {Math.max(0, scan + 1)}/{n}
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
        {n}/{n} re-hashed in this browser · head {head?.slice(0, 10)}…
      </div>
    </motion.div>
  );
}

function decisionRow(d: DecisionEntry): ChainRow {
  const what = [d.lever, d.requirement, d.status].filter(Boolean).join(' · ');
  return {
    seq: d.seq, wall: d.wallClock ?? '', t: d.at, actor: 'WATCHSTANDER', action: d.kind.toUpperCase(),
    detail: `${what}${what && d.note ? ' | ' : ''}${d.note ?? ''} — ${d.actor.id}`, prev: d.prevHash, hash: d.hash,
  };
}

function factRow(f: FactEntry, origin: string): ChainRow {
  const value = typeof f.value === 'object' ? JSON.stringify(f.value) : String(f.value);
  return {
    seq: f.seq, wall: '', t: f.receivedAt ?? f.recordedAt,
    actor: f.source.kind === 'manual' ? 'WATCHSTANDER' : f.origin && f.origin !== origin && f.receivedAt !== undefined ? 'PEER' : 'SOURCE',
    action: `${f.source.system}${f.quarantine ? ' · QUARANTINED' : ''}`,
    detail: `${f.reason ?? `${f.entity} ${f.attr}`} = ${value.length > 60 ? `${value.slice(0, 57)}…` : value}${f.source.recordId ? ` (${f.source.recordId})` : ''}`,
    prev: f.prevHash, hash: f.hash, flagged: !!f.quarantine,
  };
}

export default function DecisionLog() {
  const { scenario, snapshot, approved, link } = useEngine();
  const version = useStore((s) => s.version);
  const [reload, setReload] = useState(0);
  const remote = useRemote<AuditView>(`${scenario.id}|audit|${version}|${reload}`, () => api.get(`/m/${scenario.id}/audit`));
  const [picked, setChain] = useState<ChainKind | null>(null);
  const [local, setLocal] = useState<{ key: string; view: AuditView } | null>(null);
  const audit = local && local.key === remote.dataKey ? local.view : remote.data;
  // with no decisions yet, show the report chain so there is something to verify
  const chain: ChainKind = picked ?? (audit && !audit.decisions.length ? 'facts' : 'decisions');
  const [actor, setActor] = useState<'ALL' | 'WATCHSTANDER' | 'SOURCE' | 'PEER'>('ALL');

  const verified = useMemo(() => {
    if (!audit) return undefined;
    return { decisions: verifyDecisionChain(audit.decisions as never), facts: verifyFactChain(audit.facts as never) };
  }, [audit]);
  const rows = useMemo<ChainRow[]>(() => {
    if (!audit) return [];
    return chain === 'decisions' ? audit.decisions.map(decisionRow) : audit.facts.map((f) => factRow(f, audit.node.id));
  }, [audit, chain]);
  const result = verified?.[chain];
  const states: LinkState[] = chainStates(rows.length, result?.brokenAt);
  const { scan, done, start, reset } = useVerifyScan(rows.length);
  const tampered = !!local && local.key === remote.dataKey;

  const tamper = () => {
    if (!audit || rows.length < 2) return;
    const i = Math.floor(rows.length / 2);
    const copy: AuditView = structuredClone(audit);
    if (chain === 'decisions') copy.decisions[i] = { ...copy.decisions[i], note: `${copy.decisions[i].note ?? ''} [edited]` };
    else copy.facts[i] = { ...copy.facts[i], value: typeof copy.facts[i].value === 'number' ? (copy.facts[i].value as number) + 1 : `${String(copy.facts[i].value)} [edited]` };
    setLocal({ key: remote.dataKey!, view: copy });
    setTimeout(start, 30);
  };
  const restore = () => {
    setLocal(null);
    setReload((x) => x + 1);
    setTimeout(start, 120);
  };

  const decisions = audit?.decisions ?? [];
  const shown = rows.map((e, i) => ({ e, st: states[i] })).filter((r) => actor === 'ALL' || r.e.actor === actor).reverse();
  const bad = result?.brokenAt !== undefined ? rows[result.brokenAt] : undefined;
  const capCode = (id?: string) => (id ? (snapshot.result.capabilities.find((c) => c.id === id)?.code ?? id) : '');
  const leverTitle = (id?: string) => snapshot.levers.find((l) => l.id === id)?.title ?? id ?? '';

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_440px] grid-rows-[auto_auto_168px_minmax(0,1fr)] gap-3 p-3">
      <div className="hud col-span-2 flex items-center gap-4 px-3 py-2">
        <div>
          <div className="label !text-[9px] !text-calc/80">Decision log · {audit?.node.label ?? scenario.ship.name}</div>
          <div className="font-display text-[14px] font-bold tracking-[0.18em] text-white">TAMPER-EVIDENT RECORD</div>
        </div>
        <div className="flex overflow-hidden rounded-[3px] border border-sky-300/20">
          {(['decisions', 'facts'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => (setChain(c), reset())}
              className={cn('px-2.5 py-1 font-display text-[10px] font-semibold uppercase tracking-[0.14em]', chain === c ? 'bg-calc/15 text-calc' : 'text-mute hover:text-sky-100')}
            >
              {c === 'decisions' ? `Decisions (${audit?.decisions.length ?? 0})` : `Reports (${audit?.facts.length ?? 0})`}
            </button>
          ))}
        </div>
        <Pill color="#22d3ee">SHA-256 chain · re-verified in browser</Pill>
        <div className="ml-2 flex gap-5 font-mono text-[11px]">
          <span>
            <span className="text-mute">HEAD </span>
            <span className="text-calc">{(chain === 'decisions' ? audit?.heads.decisions : audit?.heads.facts)?.slice(0, 16) ?? '—'}…</span>
          </span>
          <span>
            <span className="text-mute">NODE CHECK </span>
            <span className={audit?.serverVerify[chain].ok ? 'text-ok' : 'text-crit'}>{audit ? (audit.serverVerify[chain].ok && !audit.serverVerify.storedRowMismatches.length ? 'OK' : 'FAILED') : '…'}</span>
          </span>
        </div>
        <div className="ml-auto flex gap-2">
          <Btn tone="calc" onClick={start} disabled={!rows.length}>
            <ShieldCheck size={12} /> Verify chain
          </Btn>
          <Btn tone="crit" onClick={tamper} disabled={rows.length < 2 || tampered} title="Demo: edit one entry in this browser's copy, as an insider might, and watch verification catch it">
            <Fingerprint size={12} /> Simulate tamper
          </Btn>
          <a href={`/api/m/${scenario.id}/audit/export`} download className="inline-flex">
            <Btn tone="ghost">
              <Download size={12} /> Export
            </Btn>
          </a>
        </div>
      </div>

      <div className="col-span-2 flex items-center gap-3 rounded-[3px] border border-crit/30 bg-crit/[0.05] px-3 py-1.5">
        <Ban size={14} className="text-crit" />
        <span className="font-display text-[10.5px] font-bold tracking-[0.18em] text-crit">{BRAND.name} CANNOT</span>
        {PROHIBITED.map((p) => (
          <span key={p} className="rounded-[2px] border border-crit/25 px-1.5 py-px font-mono text-[10px] text-crit/85 line-through decoration-crit/50">
            {p}
          </span>
        ))}
        <span className="ml-auto text-[11px] text-sky-200/60">Approved options are planning assumptions. A human decides and acts through the chain of command.</span>
      </div>

      <Panel title={chain === 'decisions' ? 'Decision chain' : 'Report chain'} index="LOG-1" className="col-span-2" bodyClass="flex gap-4 px-3 py-2">
        <div className="min-w-0 flex-1">
          {rows.length ? (
            <ChainStrip audit={rows} states={states} scan={scan} focusSeq={result?.brokenAt} />
          ) : (
            <div className="flex h-full items-center font-mono text-[11px] text-mute">{remote.loading ? 'Loading the record from the node…' : 'No entries yet. Every decision lands here.'}</div>
          )}
        </div>
        <div className="flex w-[230px] shrink-0 items-center justify-center border-l border-sky-300/10">
          <Verdict n={rows.length} scan={scan} done={done} brokenAt={result?.brokenAt} head={rows.at(-1)?.hash} />
        </div>
      </Panel>

      <Panel
        title="Record"
        index="LOG-2"
        right={
          <div className="flex gap-1">
            {(['ALL', 'WATCHSTANDER', 'SOURCE', 'PEER'] as const).map((a) => (
              <button key={a} type="button" onClick={() => setActor(a)} className={cn('rounded-[2px] border px-1.5 py-px font-mono text-[9.5px]', actor === a ? 'border-calc/60 bg-calc/15 text-calc' : 'border-sky-300/10 text-mute hover:text-sky-200')}>
                {a}
              </button>
            ))}
          </div>
        }
        bodyClass="flex flex-col"
      >
        <div className="grid shrink-0 grid-cols-[56px_76px_104px_112px_170px_minmax(0,1fr)_118px] gap-2 border-b border-sky-300/10 px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-mute">
          <span>Seq</span>
          <span>Wall</span>
          <span>Watch time</span>
          <span>Actor</span>
          <span>Action</span>
          <span>Detail</span>
          <span>Hash</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {shown.map(({ e, st }) => (
            <AuditRow key={`${e.seq}-${e.hash}`} e={e} st={st} scanned={scan !== null && e.seq <= scan} at={fmtT(scenario, e.t)} />
          ))}
        </div>
      </Panel>

      <div className="flex min-h-0 flex-col gap-3">
        <Panel title="Watchstander decisions" index="LOG-3" className="min-h-0 flex-1" bodyClass="space-y-1.5 overflow-y-auto p-2">
          {!decisions.length && <div className="p-2 font-mono text-[11px] text-mute">No decisions yet. Approve or reject a bounded option on the Watch Floor.</div>}
          {[...decisions].reverse().map((d) => {
            const live = d.kind === 'approve' && !!d.lever && approved.includes(d.lever);
            const status = d.kind === 'approve' ? (live ? 'PLANNING ASSUMPTION' : 'NOT ACTIVE NOW') : d.kind.toUpperCase();
            const col = d.kind === 'approve' ? (live ? '#34d399' : '#94a3b8') : d.kind === 'reject' || d.kind === 'stop' ? '#fb3b5c' : '#94a3b8';
            return (
              <div key={d.hash} className="rounded-[3px] border bg-black/40 p-2" style={{ borderColor: `${col}40` }}>
                <div className="flex items-center gap-2">
                  {d.kind === 'approve' ? <Check size={13} style={{ color: col }} /> : d.kind === 'reject' ? <X size={13} style={{ color: col }} /> : <Undo2 size={13} style={{ color: col }} />}
                  <span className="font-display text-[10px] font-bold tracking-[0.16em]" style={{ color: col }}>
                    {status}
                  </span>
                  <span className="font-mono text-[9.5px] text-mute">#{d.seq}</span>
                  <span className="ml-auto font-mono text-[9.5px] text-mute">{fmtT(scenario, d.at)}</span>
                </div>
                {(d.lever || d.requirement) && <div className="mt-1 text-[12px] leading-snug text-sky-50">{d.lever ? leverTitle(d.lever) : capCode(d.requirement)}</div>}
                <div className="mt-1 flex items-center gap-2 font-mono text-[10px]">
                  <span className="truncate text-mute">{d.actor.id} · {d.actor.role}</span>
                  {d.basis?.resultHash && <span className="ml-auto truncate text-sky-300/40" title="Hash of the computed picture the decision was made on">basis {d.basis.resultHash.slice(0, 8)}</span>}
                </div>
                {d.note && <div className="mt-1 border-l-2 border-sky-300/20 pl-2 text-[11px] italic text-sky-200/70">{d.note}</div>}
                {live && (
                  <div className="mt-1.5 flex justify-end">
                    <Btn tone="ghost" className="!py-0.5 !text-[9.5px]" onClick={() => void actions.withdraw(snapshot.mission, snapshot.at, d.lever!, 'Withdrawn from the decision log')}>
                      <RotateCcw size={10} /> Withdraw
                    </Btn>
                  </div>
                )}
              </div>
            );
          })}
        </Panel>

        <Panel title={bad ? 'Tamper forensics' : 'Node copy'} index="LOG-4" tone={bad ? 'crit' : undefined} className="shrink-0" bodyClass="p-3">
          {bad ? (
            <div className="space-y-2 text-[11.5px]">
              <div className="text-crit/90">
                Entry <b>#{bad.seq}</b> ({bad.action}) no longer matches its hash. Every later entry is unverifiable until it is resolved.
              </div>
              <div className="rounded-[3px] border border-crit/30 bg-crit/[0.06] p-2 font-mono text-[10.5px]">
                <div className="text-mute">THIS BROWSER (altered)</div>
                <div className="break-words text-crit">{bad.detail}</div>
              </div>
              <Btn tone="ok" onClick={restore}>
                <Upload size={12} /> Restore from the node's copy
              </Btn>
            </div>
          ) : remote.error ? (
            <div className="flex items-start gap-3">
              <CloudOff size={22} className="shrink-0 text-unc" />
              <div className="text-[11.5px] text-sky-200/75">Node unreachable: {remote.error.message}</div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Server size={22} className={cn('shrink-0', audit?.serverVerify.storedRowMismatches.length ? 'text-crit' : 'text-ok')} />
              <div className="min-w-0 flex-1 text-[11px] text-sky-200/70">
                <div className="font-mono text-[13px] font-bold text-white">
                  {audit?.facts.length ?? 0} reports · {audit?.decisions.length ?? 0} decisions
                </div>
                Postgres rows re-hashed on load: {audit?.serverVerify.storedRowMismatches.length ? <span className="text-crit">{audit.serverVerify.storedRowMismatches.length} edited rows found</span> : 'no edits found'}.
                {audit && audit.peers.length > 0 && (
                  <div className="mt-1">
                    {audit.peers.map((p) => (
                      <div key={p.node} className="font-mono text-[10px]">
                        {p.label}: {p.decisions} decisions {p.chainOk ? <span className="text-ok">chain OK</span> : <span className="text-crit">chain BROKEN</span>}
                        {p.lastContact && <span className="text-mute"> · last {fmtT(scenario, p.lastContact.t)}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Store & forward to shore" index="LOG-5" className="shrink-0" bodyClass="p-3">
          <div className="flex items-center gap-3">
            <span className={cn('font-display text-[13px] font-bold tracking-[0.16em]', link.up ? 'text-ok' : 'text-crit')}>{link.up ? 'LINK UP' : 'LINK DOWN'}</span>
            <span className="font-mono text-[11px] text-white">{link.peer ? `${link.pendingPush} queued` : 'standalone node'}</span>
            {link.lastSync && <span className="ml-auto font-mono text-[10px] text-mute">last sync {fmtT(scenario, link.lastSync.t)}</span>}
          </div>
          <div className="mt-1.5 text-[11px] text-sky-200/65">
            {!link.peer && 'No shore peer configured on this node. In the ship + shore stack, records push ashore over the data link.'}
            {link.peer && link.up && 'Link up: new reports and decisions push to the shore node on the next exchange; shore reports pull back.'}
            {link.peer && !link.up && `${link.reason ?? 'Link down'}. ${link.pendingPush} records held aboard, hash-chained, and sent in order when the link returns. The ship keeps computing on what it holds.`}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function AuditRow({ e, st, scanned, at }: { e: ChainRow; st: LinkState; scanned: boolean; at: string }) {
  const col = st === 'bad' ? '#fb3b5c' : st === 'after' ? '#fbbf24' : '#22d3ee';
  return (
    <div
      className={cn('grid grid-cols-[56px_76px_104px_112px_170px_minmax(0,1fr)_118px] items-center gap-2 border-b border-sky-300/[0.05] px-3 py-1 text-[11px] transition-colors hover:bg-white/[0.03]', st === 'bad' && 'bg-crit/[0.08]', scanned && st === 'ok' && 'bg-ok/[0.025]')}
      title={e.detail}
    >
      <span className="font-mono font-bold text-white">#{String(e.seq).padStart(4, '0')}</span>
      <span className="font-mono text-[10px] text-mute">{zulu(e.wall)}</span>
      <span className="font-mono text-[10px] text-sky-200/80">{at}</span>
      <span className="truncate font-mono text-[10px]" style={{ color: ACTOR_COLOR[e.actor] }}>
        {e.actor}
      </span>
      <span className={cn('truncate font-display text-[10.5px] font-semibold tracking-[0.06em]', e.flagged ? 'text-unc' : 'text-sky-100')}>{e.action}</span>
      <span className={cn('truncate', st === 'bad' ? 'text-crit' : 'text-sky-200/75')}>{e.detail}</span>
      <span className="flex items-center gap-1 font-mono text-[10px]" style={{ color: `${col}cc` }}>
        {scanned && (st === 'ok' ? <Check size={10} className="text-ok" /> : <X size={10} className={st === 'bad' ? 'text-crit' : 'text-unc'} />)}
        {e.hash.slice(0, 12)}
      </span>
    </div>
  );
}
