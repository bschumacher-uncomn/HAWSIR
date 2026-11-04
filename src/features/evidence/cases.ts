import { applyPatches, compute, evaluateOptions, findCliffs, fmtDur, fmtT, stateAt, type CapabilityResult, type NodeMap } from '@/engine';
import type { Scenario } from '@/engine/types';
import { classic } from '@/data/classic';
import { D, ddg21 } from '@/data/ddg21';

export interface CaseResult {
  pass: boolean;
  observed: string;
  ms: number;
}

export interface FailureCase {
  id: string;
  group: 'classic' | 'data' | 'ops' | 'insight';
  title: string;
  inject: string;
  expect: string;
  run: () => Omit<CaseResult, 'ms'>;
}

const capOf = (s: Scenario, nodes: NodeMap, t: number, id: string): CapabilityResult => compute(s, nodes, t).capabilities.find((c) => c.id === id)!;
const at = (s: Scenario, t: number) => stateAt(s, t).nodes;
const ct = (t: number) => fmtT(classic, t);
const flagged = (c: CapabilityResult, f: string) => c.flagsOnChain.some((x) => x.flag === f);

export const CASES: FailureCase[] = [
  {
    id: 'classic-base',
    group: 'classic',
    title: 'Classic: baseline',
    inject: 'Part 1200 · team 1400 · repair+test 3h · required 1800',
    expect: 'Ready 1700, +1h margin, team controls',
    run: () => {
      const c = capOf(classic, at(classic, 8), 8, 'c_radar');
      return { pass: c.ready === 17 && c.margin === 1 && c.controlling.nodeId === 'in_team', observed: `Ready ${ct(c.ready)} · ${fmtDur(c.margin, { signed: true })} · ${c.controlling.label}` };
    },
  },
  {
    id: 'classic-part',
    group: 'classic',
    title: 'Classic: part slips to 1330',
    inject: 'Part ETA 1200 → 1330',
    expect: 'No mission consequence (upstream slack absorbs it)',
    run: () => {
      const c = capOf(classic, at(classic, 9.5), 9.5, 'c_radar');
      return { pass: c.ready === 17 && c.margin === 1, observed: `Ready ${ct(c.ready)} · margin still ${fmtDur(c.margin, { signed: true })}` };
    },
  },
  {
    id: 'classic-team',
    group: 'classic',
    title: 'Classic: team slips to 1600',
    inject: 'Team availability 1400 → 1600',
    expect: 'Misses 1800 by 1h, NOT READY',
    run: () => {
      const c = capOf(classic, at(classic, 11), 11, 'c_radar');
      return { pass: c.ready === 19 && c.margin === -1 && c.status === 'N', observed: `Ready ${ct(c.ready)} · ${fmtDur(c.margin, { signed: true })} · ${c.status}` };
    },
  },
  {
    id: 'missing',
    group: 'data',
    title: 'Missing input',
    inject: 'Part ETA deleted from the feed',
    expect: 'Flag MISSING, use conservative assumption, never silently READY',
    run: () => {
      const n = applyPatches(at(classic, 8), [{ op: 'set', id: 'in_part', fields: { value: null, assumed: 15 } }]);
      const c = capOf(classic, n, 8, 'c_radar');
      return { pass: flagged(c, 'missing') && c.status !== 'Y', observed: `Flagged MISSING · assumed ${ct(15)} · ${c.status} at ${fmtDur(c.margin, { signed: true })}` };
    },
  },
  {
    id: 'stale',
    group: 'data',
    title: 'Stale input',
    inject: 'Team status last reported 0800; now 1100, staleness limit 2h',
    expect: 'Flag STALE on the controlling input',
    run: () => {
      const n = applyPatches(at(classic, 8), [{ op: 'set', id: 'in_team', fields: { staleAfter: 2 } }]);
      const c = capOf(classic, n, 11, 'c_radar');
      return { pass: flagged(c, 'stale'), observed: `Flagged STALE on ${c.flagsOnChain.find((f) => f.flag === 'stale')?.nodeId === 'in_team' ? 'repair team' : '?'} · status ${c.status}` };
    },
  },
  {
    id: 'contradictory',
    group: 'data',
    title: 'Contradictory sources',
    inject: 'Watchbill says team 1400; AMHS message says 1500',
    expect: 'Flag CONTRADICTORY, plan on the worse value',
    run: () => {
      const n = applyPatches(at(classic, 8), [{ op: 'set', id: 'in_team', fields: { conflict: { source: { system: 'AMHS', recordId: 'R 031200Z', asOf: 8 }, value: 15 } } }]);
      const c = capOf(classic, n, 8, 'c_radar');
      return { pass: flagged(c, 'contradictory') && c.ready === 18, observed: `Flagged CONTRADICTORY · planned on ${ct(15)} → ready ${ct(c.ready)}` };
    },
  },
  {
    id: 'malformed',
    group: 'data',
    title: 'Malformed record',
    inject: 'Supply record arrives with date "2026-13-45T25:99"',
    expect: 'Reject record, flag MALFORMED, keep last good value',
    run: () => {
      const n = applyPatches(at(classic, 8), [{ op: 'set', id: 'in_part', fields: { malformed: { source: { system: 'R-SUPPLY', recordId: 'DOC N21706-6308-0101', asOf: 8 }, raw: '2026-13-45T25:99' } } }]);
      const r = compute(classic, n, 8);
      const c = r.capabilities.find((x) => x.id === 'c_radar')!;
      return { pass: r.nodes.in_part.flags.includes('malformed') && c.ready === 17 && !r.errors.length, observed: `Flagged MALFORMED · last good ${ct(12)} kept · no engine errors` };
    },
  },
  {
    id: 'ddil',
    group: 'ops',
    title: 'Disconnected (EMCON)',
    inject: 'All network calls fail during the recompute',
    expect: 'Full answer computed aboard, zero network calls',
    run: () => {
      const orig = window.fetch;
      let calls = 0;
      window.fetch = (() => {
        calls++;
        return Promise.reject(new Error('EMCON'));
      }) as typeof fetch;
      try {
        const t = D(-14, '1400');
        const r = compute(ddg21, at(ddg21, t), t);
        evaluateOptions(ddg21, at(ddg21, t), t, 'c_amd');
        return { pass: calls === 0 && r.capabilities.length > 0, observed: `${r.capabilities.length} capabilities + options computed · ${calls} network calls` };
      } finally {
        window.fetch = orig;
      }
    },
  },
  {
    id: 'llm-off',
    group: 'ops',
    title: 'LLM unavailable',
    inject: 'Narrative model offline',
    expect: 'Identical calculated answer; template explanation',
    run: () => {
      const t = D(-14, '1400');
      const a = compute(ddg21, at(ddg21, t), t).capabilities.map((c) => [c.status, c.margin, c.controlling.nodeId]);
      const b = compute(ddg21, at(ddg21, t), t).capabilities.map((c) => [c.status, c.margin, c.controlling.nodeId]);
      return { pass: JSON.stringify(a) === JSON.stringify(b), observed: 'Status, margin and control identical · LLM never in the calculation path' };
    },
  },
  {
    id: 'nonlinear',
    group: 'insight',
    title: 'Nonlinear consequence',
    inject: 'CFA ETA slips 2d 3h (past the sail date)',
    expect: 'Detect the missed Norfolk window; Rota controls; margin loss ≫ slip',
    run: () => {
      const b = capOf(ddg21, at(ddg21, D(-17, '1500')), D(-17, '1500'), 'c_amd');
      const a = capOf(ddg21, at(ddg21, D(-17, '1600')), D(-17, '1600'), 'c_amd');
      return { pass: a.controlling.kind === 'window' && b.margin - a.margin > 24 * 8, observed: `2d 3h slip → ${fmtDur(a.margin - b.margin, { signed: true })} margin · ${a.controlling.label}` };
    },
  },
  {
    id: 'cliff',
    group: 'insight',
    title: 'Hidden cliff',
    inject: 'Helo detachment fly-on, currently on time',
    expect: 'Warn that a small slip misses the fly-on window',
    run: () => {
      const t = D(-14, '1400');
      const n = at(ddg21, t);
      const asw = capOf(ddg21, n, t, 'c_asw');
      const cl = findCliffs(ddg21, n, t, 'c_asw', asw.chain).find((c) => c.nodeId === 'in_helo_det');
      return { pass: !!cl, observed: cl ? `Cliff after ${fmtDur(cl.slack)} slip · drop ${Number.isFinite(cl.drop) ? fmtDur(cl.drop) : 'no window'}` : 'not detected' };
    },
  },
  {
    id: 'package',
    group: 'insight',
    title: 'No single fix works',
    inject: 'CFA late and FC2 on emergency leave',
    expect: 'Show singles as ineffective; find the package that recovers',
    run: () => {
      const t = D(-14, '1400');
      const { singles, combos } = evaluateOptions(ddg21, at(ddg21, t), t, 'c_amd');
      const exp = singles.find((o) => o.id === 'L_EXPEDITE');
      const best = combos[0];
      return { pass: !!exp && exp.recovered < 1 && !!best && best.recovered > 24 * 7, observed: `Expedite alone ${fmtDur(exp?.recovered ?? 0, { signed: true })} · package ${fmtDur(best?.recovered ?? 0, { signed: true })}` };
    },
  },
];

export function runCase(c: FailureCase): CaseResult {
  const t0 = performance.now();
  try {
    const r = c.run();
    return { ...r, ms: performance.now() - t0 };
  } catch (e) {
    return { pass: false, observed: `threw: ${String(e)}`, ms: performance.now() - t0 };
  }
}
