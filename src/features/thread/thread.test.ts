import { describe, expect, it } from 'vitest';
import { mcm } from '@/data/mcm';
import { SCENARIOS } from '@/data/scenarios';
import { applyPatches, compute, evaluateOptions, stateAt, toMap } from '@/engine';
import { autoThread } from './auto';
import { layoutThread } from './layout';
import { linkState, stepState, threadTimes } from './model';

const at = (t: number) => {
  const { nodes } = stateAt(mcm, t);
  const r = compute(mcm, nodes, t);
  return { nodes, r, cap: r.capabilities.find((c) => c.id === 'c_assess')! };
};
const only = (id: string, t: number) => {
  const e = mcm.events.find((x) => x.id === id)!;
  const nodes = applyPatches(toMap(mcm.nodes), e.patches);
  return compute(mcm, nodes, t).capabilities.find((c) => c.id === 'c_assess')!;
};

describe('Operation Open Passage (MCM thread)', () => {
  it('baseline meets 1800 with 2h margin, controlled by USV readiness', () => {
    const { cap } = at(6);
    expect(cap.status).toBe('Y');
    expect(cap.margin).toBeCloseTo(2, 6);
    expect(cap.controlling.nodeId).toBe('sys_usv');
  });

  it('USV maintenance eats 30 min of margin but stays ready', () => {
    const { cap } = at(6.25);
    expect(cap.status).toBe('Y');
    expect(cap.margin).toBeCloseTo(1.5, 6);
  });

  it('helo delay is absorbed: the flight window is still open and the assessment does not move', () => {
    const before = at(6.25).cap;
    const { cap, r } = at(7);
    expect(cap.ready).toBeCloseTo(before.ready, 6);
    expect(r.nodes.g_flight.usedWindow).toBe('w_am');
  });

  it('comms fault leaves timing alone but makes the survey stale on the critical chain', () => {
    const { cap, r } = at(8.25);
    expect(cap.status).toBe('Q');
    expect(cap.margin).toBeCloseTo(1.5, 6);
    expect(r.nodes.t_usv_survey.flags).toContain('stale');
    expect(cap.flagsOnChain.map((f) => f.nodeId)).toContain('t_usv_survey');
  });

  it('reviewer gap controls: assessment 75 minutes late, waiting on OS1 Vega', () => {
    const { cap, r } = at(10);
    expect(cap.status).toBe('N');
    expect(cap.margin * 60).toBeCloseTo(-75, 6);
    expect(cap.controlling.nodeId).toBe('p_pma_vega');
    expect(r.nodes.t_pma.control.type).toBe('crew');
  });

  it('the reviewer gap alone gives the same result as all four reports', () => {
    expect(only('M04', 10).margin).toBeCloseTo(at(10).cap.margin, 6);
    expect(only('M01', 10).status).toBe('Y');
    expect(only('M02', 10).margin).toBeCloseTo(at(6).cap.margin, 6);
  });

  it('reassigning a qualified reviewer recovers; airborne-only does not substitute for sonar', () => {
    const { nodes } = at(10);
    const { singles } = evaluateOptions(mcm, nodes, 10, 'c_assess');
    const kim = singles.find((o) => o.id === 'M_REVIEWER')!;
    const air = singles.find((o) => o.id === 'M_AIRONLY')!;
    expect(kim.effective).toBe(true);
    expect(kim.marginAfter).toBeCloseTo(1.5, 6);
    expect(kim.statusAfter).toBe('Q');
    expect(air.effective).toBe(false);
    expect(air.statusAfter).toBe('N');
  });

  it('stale clears once the survey is done', () => {
    expect(at(13.5).r.nodes.t_usv_survey.flags).not.toContain('stale');
  });
});

describe('Thread model', () => {
  it('every hand-laid step and link resolves to engine nodes and lanes', () => {
    const spec = mcm.thread!;
    const lanes = new Set(spec.lanes.map((l) => l.id));
    const steps = new Set(spec.steps.map((s) => s.id));
    const ids = new Set(mcm.nodes.map((n) => n.id));
    for (const s of spec.steps) {
      expect(lanes.has(s.lane)).toBe(true);
      if (s.node) expect(ids.has(s.node)).toBe(true);
      for (const n of s.needs ?? []) expect(ids.has(n)).toBe(true);
    }
    for (const l of spec.links) expect(steps.has(l.from) && steps.has(l.to)).toBe(true);
  });

  it('times steps from the engine and plays them on a clock', () => {
    const { nodes, r, cap } = at(10);
    const times = threadTimes(mcm.thread!, mcm, nodes, r, cap);
    const pma = times.s_pma;
    expect(pma.arrive).toBeCloseTo(14, 6);
    expect(pma.start).toBeCloseTo(16.75, 6);
    expect(pma.wait?.kind).toBe('crew');
    expect(pma.onChain).toBe(true);
    expect(times.s_sortie.onChain).toBe(false);
    expect(stepState(pma, 15, 'task')).toBe('waiting');
    expect(stepState(pma, 17, 'task')).toBe('active');
    expect(stepState(pma, 19, 'task')).toBe('done');
    expect(linkState(times.s_collect, pma, 15)).toBe('carrying');
    expect(stepState(times.s_follow, 20, 'branch', true)).toBe('skipped');
  });

  it('lays out without overlaps', () => {
    const { pos } = layoutThread(mcm.thread!);
    const boxes = Object.values(pos);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
  });

  it('auto-lays a thread for every capability of every scenario', () => {
    for (const s of SCENARIOS) {
      const nodes = toMap(s.nodes);
      const r = compute(s, nodes, s.watchStart);
      for (const c of r.capabilities) {
        const spec = autoThread(nodes, c.id)!;
        expect(spec.steps.some((x) => x.kind === 'end' && x.node === c.id)).toBe(true);
        const ids = new Set(spec.steps.map((x) => x.id));
        for (const l of spec.links) expect(ids.has(l.from) && ids.has(l.to)).toBe(true);
        const times = threadTimes(spec, s, nodes, r, c);
        expect(Object.keys(times)).toHaveLength(spec.steps.length);
      }
    }
  });
});
