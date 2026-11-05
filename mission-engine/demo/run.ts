/**
 * CLI walkthrough of the engine on Operation STEEL TIDE (synthetic).
 *   npm run demo            naval scenario, full walkthrough
 *   npm run demo:airlift    the airlift pack on a C-17 mission
 *   npm run demo:classic    HAWSIR's classic five-input regression
 * Everything runs offline; no network, no model calls.
 */
import { consequenceCurve, findCliffs, slackTable } from '../src/core/analysis';
import { compute } from '../src/core/compute';
import { explainRequirement, fiveAnswersText, relabel } from '../src/core/explain';
import { runMonteCarlo } from '../src/core/montecarlo';
import { RoutineRegistry } from '../src/core/routines';
import { outlook, sparkline, stockSeries } from '../src/core/trend';
import { fmtDtg, fmtDur, fmtRel } from '../src/core/time';
import { FactLog } from '../src/data/store';
import { c17Session, steelTideSession } from '../scenarios';
import { H } from '../scenarios/steel-tide';

const bar = (t: string) => console.log(`\n${'═'.repeat(100)}\n${t}\n${'═'.repeat(100)}`);
const sub = (t: string) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 95 - t.length))}`);
const rel = (t: number) => fmtRel(t, H, 'H');
const o = { mark: H, markLabel: 'H' };
const watch = { id: 'LT S. Brandt', role: 'TAO, USS Kittredge' };
const cdr = { id: 'CAPT R. Okoye', role: 'CSG-X Chief of Staff (for STWC)' };

function naval() {
  const s = steelTideSession('ship');
  const epoch = Date.parse(s.model.epochUtc);

  bar('Operation STEEL TIDE (synthetic, unclassified) · mission engine 0.1.0');
  console.log(`Packs: ${Object.entries(s.registry.versions()).map(([k, v]) => `${k}@${v}`).join(', ')}`);
  const ver = s.registry.routines.verifyAll();
  console.log(`Routines: ${ver.filter((v) => v.ok).length}/${ver.length} verified (tests + declared monotonicity)`);
  console.log(`Factor tables: ${s.registry.tables.list().map((t) => `${t.id} [${t.status}]`).join(', ')}`);
  console.log(`Facts in log: ${s.log.size()} (hash chain ${s.log.verify().ok ? 'verified' : 'BROKEN'})  H-hour ${fmtDtg(H, epoch)}`);

  sub('1. Burn-down: what the engine said as each report arrived (as-of replay of the fact log)');
  const times = [48, 54, 55, 58, 58.5];
  const focus = s.compile(58.5).focus;
  const rows = s.burnDown(times, focus);
  const col = (x: string, n: number) => x.padEnd(n).slice(0, n);
  console.log(col('requirement', 50) + times.map((t) => col(rel(t), 16)).join(''));
  for (const id of focus) {
    const label = s.evaluate(58.5).graph.nodes.find((n) => n.id === id)?.label ?? id;
    console.log(col(label, 50) + rows.map((r) => {
      const x = r.requirements[id];
      return col(x ? `${x.status} ${Number.isFinite(x.margin) ? fmtDur(x.margin) : x.margin > 0 ? '∞' : '-∞'}` : '—', 16);
    }).join(''));
  }
  console.log('\nControlling constraint of the strike, by as-of time:');
  for (const r of rows) console.log(`  ${col(rel(r.asOf), 7)} ${relabel(r.requirements['strike:tide']?.controlling ?? '', o)}`);

  bar(`2. The watch at ${rel(55)} (part ETA reports in, two systems disagree)`);
  const a55 = s.advise(55, { monteCarlo: 500, slackTarget: 'met:ddgB:MOB' });
  for (const id of ['strike:tide', 'met:ddgB:MOB']) {
    const ans = a55.answers.find((x) => x.requirement === id)!;
    console.log('\n' + fiveAnswersText(ans));
    console.log('  Controlling chain:');
    for (const line of ans.chain) console.log(`     ${line}`);
  }
  sub('Monte Carlo (500 seeded futures, seed 1337)');
  for (const id of ['strike:tide', 'met:ddgB:MOB', 'grp:csg:AW']) {
    const m = a55.mc!.requirements[id];
    console.log(`  ${col(id, 18)} P(Y) ${(m.pY * 100).toFixed(0).padStart(3)}%  P(Q) ${(m.pQ * 100).toFixed(0).padStart(3)}%  P(N) ${(m.pN * 100).toFixed(0).padStart(3)}%   margin p5/p50/p95 ${[m.margin.p5, m.margin.p50, m.margin.p95].map((x) => (Number.isFinite(x) ? fmtDur(x) : '∞')).join(' / ')}`);
  }
  sub(`Upstream slack vs mission margin: Kittredge mobility (fuel) at ${rel(55)}`);
  for (const r of a55.slack!.rows.slice(0, 8)) {
    console.log(`  ${col(r.label, 56)} slips with no effect: ${col(Number.isFinite(r.noImpact) ? fmtDur(r.noImpact) : '∞', 9)} to failure: ${col(Number.isFinite(r.toFailure) ? fmtDur(r.toFailure) : '∞', 9)} (${r.method})`);
  }
  sub('Data health (what is missing, stale, contradictory, malformed)');
  for (const h of a55.health) console.log(`  [${h.flags.join(',')}] ${h.entity} ${h.attr}: ${relabel(h.note, o)}`);

  sub(`Consequence curve: SATCOM part ETA slipping vs Kittredge's strike readiness (as of ${rel(55)})`);
  const ev55 = s.evaluate(55);
  const curve = consequenceCurve(ev55.graph, ev55.ctx, 'part:satcom-modem', 'met:ddgB:STW:tide', 8, 16);
  console.log('  slip(h)  ' + curve.map((p) => String(p.delay).padStart(6)).join(''));
  console.log('  margin   ' + curve.map((p) => (Number.isFinite(p.margin) ? p.margin.toFixed(1) : '-∞').padStart(6)).join(''));
  const cliffs = findCliffs(curve);
  console.log(`  cliffs: ${cliffs.map((c) => `+${c.delay}h costs ${Number.isFinite(c.extraLoss) ? fmtDur(c.extraLoss) : 'everything'} beyond the slip`).join('; ') || 'none'}`);
  console.log('  (a part that misses the 1600 COD slot waits for the next one; the relay after EMCON then caps the loss)');

  sub('Trend over time: Kittredge fuel % (t=0…120) and strike availability');
  const fuel = stockSeries(ev55.result, 'fuel:ddgB', 0, 120, 2);
  console.log(`  ${sparkline(fuel.map((p) => p.v), 0, 100)}  min ${Math.min(...fuel.map((p) => p.v)).toFixed(1)}%`);
  console.log(`  ${'H-60'.padEnd(30)}${'H'.padEnd(30)}H+60`);
  for (const seg of outlook(ev55.graph, ev55.result, 'met:ddgB:STW:tide', 0, 120)) {
    console.log(`  ${seg.up ? 'UP  ' : 'DOWN'} ${col(rel(seg.start), 7)}→ ${col(rel(seg.end), 7)} ${seg.causeText ? relabel(seg.causeText, o) : ''}`);
  }

  bar('3. Human decisions (approve / reject / modify / override / STOP), all hash-chained');
  const d1 = s.approve('prebrief:tide:ddgB', cdr, 55.25, 'Pre-brief before EMCON; Kittredge executes on intent if no comms.');
  console.log(`  ${rel(d1.at)} APPROVE prebrief:tide:ddgB by ${d1.actor.id}  (basis facts ${d1.basis?.factsHead?.slice(0, 10)}…, graph ${d1.basis?.graphHash?.slice(0, 10)}…)`);
  s.reject('slip:tide:12', watch, 55.3, 'Tasking authority will not slip; target is time-sensitive.');
  console.log(`  ${rel(55.3)} REJECT  slip:tide:12 ("target is time-sensitive")`);
  const after = s.evaluate(55.5);
  console.log(`  ${rel(55.5)} strike now ${after.result.requirements['strike:tide'].status} (assumptions in force: ${after.assumptions.join(', ')})`);
  s.decisions.override('met:ddgB:STW:tide', 'Q', watch, 55.6, 'Pre-briefed intent is untested with this crew; I rate it Q.');
  console.log(`  ${rel(55.6)} OVERRIDE met:ddgB:STW:tide → Q by ${watch.id} (shown beside the engine verdict, never replacing it)`);
  const a585 = s.advise(58.5);
  const st = a585.answers.find((x) => x.requirement === 'strike:tide')!;
  console.log(`  ${rel(58.5)} after the hub closure: strike ${st.status}; ${st.margin}`);
  console.log(`     controls: ${st.controlling}`);
  console.log(`     options still open: ${a585.options['strike:tide']?.filter((x) => x.available).map((x) => `${x.title} (${x.statusAfter})`).join('; ') || 'none needed'}`);
  s.decisions.stop(watch, 59, 'Link picture unreliable; suspend advisory output.');
  const stopped = s.advise(59.1);
  console.log(`  ${rel(59)} STOP → advise() suspended: ${stopped.suspended} ("${stopped.stopNote}")`);
  try {
    s.approve('emcon-relay:tide', watch, 59.2);
  } catch (e) {
    console.log(`  ${rel(59.2)} approval refused while stopped: ${(e as Error).message}`);
  }
  s.decisions.resume(watch, 59.4, 'Picture restored.');
  console.log(`  ${rel(59.4)} RESUME → advise() suspended: ${s.advise(59.5).suspended}`);

  sub('Audit trail');
  console.log(`  decision log: ${s.decisions.all().length} entries, chain ${s.decisions.verify().ok ? 'verified' : 'BROKEN'}, head ${s.decisions.head().slice(0, 16)}…`);
  const edge = s.decisions.clone();
  s.decisions.unsafeTamper(0, { note: 'edited after the fact' });
  const v = s.decisions.verify();
  console.log(`  tamper entry 0 → verify: ${v.ok ? 'ok' : `BROKEN at ${v.brokenAt}`}; restore from edge copy → restored ${JSON.stringify(s.decisions.restoreFrom(edge).restored)}, verify ${s.decisions.verify().ok ? 'ok' : 'BROKEN'}`);

  bar('4. DDIL: ship and shore keep separate logs, then merge on reconnect');
  const ship = s.log;
  const shore = FactLog.fromJSONL(ship.toJSONL(), s.registry.attrs, 'shore');
  ship.append({ entity: 'ddgB', attr: 'fuel_pct', value: 27.4, observedAt: 57, recordedAt: 57, recordedBy: 'ddgB-eng', source: { system: 'FUEL-RPT', kind: 'manual' } });
  shore.append({ entity: 'cg/TLAM', attr: 'magazine', value: 18, observedAt: 56, recordedAt: 56.5, recordedBy: 'shore-n4', source: { system: 'ORD-LOADOUT', kind: 'synthetic', recordId: 'OL-91' } });
  shore.append({ entity: 'ddgB', attr: 'fuel_pct', value: 31, observedAt: 57, recordedAt: 57.2, recordedBy: 'shore-n4', source: { system: 'FLEET-FUEL', kind: 'synthetic' } });
  console.log(`  while disconnected: ship log ${ship.size()} facts, shore log ${shore.size()} facts`);
  const cgBefore = s.evaluate(57.5, { assumptions: false }).result.requirements['met:cg:STW:tide'];
  const rep = ship.merge(shore);
  console.log(`  merge: +${rep.added} new, ${rep.duplicates} already known, contested: ${rep.contested.join(', ') || 'none'}; chain ${ship.verify().ok ? 'verified' : 'BROKEN'}`);
  const evm = s.evaluate(57.5, { assumptions: false });
  const cgAfter = evm.result.requirements['met:cg:STW:tide'];
  console.log(`  Port Harmon strike readiness: ${cgBefore.status} before merge (TLAM count unknown) → ${cgAfter.status} after (shore reported 18)`);
  const fuelNow = s.log.view(57.5).get('ddgB', 'fuel_pct');
  console.log(`  Kittredge fuel after merge: ${fuelNow.value}% [${fuelNow.flags.join(',')}] ${fuelNow.note ?? ''}`);
  const reassign = evm.build.levers.find((l) => l.id === 'reassign:tide:ddgB');
  console.log(`  reassignment option now: ${reassign?.title}${reassign?.missingInfo?.length ? ` (incomplete: ${reassign.missingInfo.join('; ')})` : ' (complete)'}`);
}

function airlift() {
  bar('Airlift pack: REACH 417 (C-17A, 3 legs), AMPLIFI-style checks plus time margin');
  const s = c17Session();
  const a = s.advise(0, { monteCarlo: 300 });
  console.log(fiveAnswersText(a.answers[0]));
  const ev = s.evaluate(0);
  for (const n of ev.graph.nodes.filter((x) => x.kind === 'check')) console.log(`  check ${n.label}: ${ev.result.nodes[n.id].check?.passed ? 'PASS' : 'FAIL'}  ${ev.result.nodes[n.id].check?.detail}`);
  console.log('  slack:', slackTable(ev.graph, ev.ctx, 'delivered', ev.result).map((r) => `${r.label} ${fmtDur(r.toFailure)} to failure`).join('; '));
  s.log.append({ entity: 'reach-417', attr: 'airlift.cargo_lb', value: 165000, observedAt: 1, recordedAt: 1, recordedBy: 'planner', source: { system: 'GDSS', kind: 'synthetic' } });
  const heavy = s.evaluate(1);
  const rr = heavy.result.requirements.delivered;
  console.log(`\n  cargo revised to 165,000 lb → ${rr.status}; controls: ${rr.leaves.map((l) => l.why).join('; ')}`);
  const mc = runMonteCarlo(ev.graph, ev.ctx, ['delivered'], 500);
  console.log(`  Monte Carlo (original cargo): P(N) ${(mc.requirements.delivered.pN * 100).toFixed(1)}%`);
}

function classic() {
  bar('HAWSIR classic regression on the new engine');
  const routines = new RoutineRegistry();
  const g = (part: number, team: number) => ({
    id: 'classic', horizon: [0, 48] as [number, number], nodes: [
      { id: 'part', kind: 'event' as const, label: 'Part on board', at: part },
      { id: 'team', kind: 'event' as const, label: 'Repair team available', at: team },
      { id: 'repair', kind: 'task' as const, label: 'Radar repair', deps: ['part', 'team'], duration: 3 },
      { id: 'radar', kind: 'requirement' as const, label: 'Radar mission', deps: ['repair'], window: { start: 18, end: 20 }, qMargin: 2 },
    ],
  });
  for (const [p, t] of [[12, 14], [13.5, 14], [12, 16]]) {
    const graph = g(p, t);
    const r = compute(graph, { now: 0, routines });
    const ans = explainRequirement(graph, r, 'radar');
    console.log(`  part ${p}, team ${t}: ${ans.status} ${ans.margin} Controls: ${ans.controlling}`);
  }
}

const which = process.argv[2];
if (which === 'airlift') airlift();
else if (which === 'classic') classic();
else {
  naval();
  airlift();
  classic();
}
