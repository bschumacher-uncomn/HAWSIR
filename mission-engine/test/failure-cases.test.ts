import { describe, expect, it } from 'vitest';
import { compute } from '../src/core/compute';
import type { GraphSpec, NodeSpec } from '../src/core/graph';
import { RoutineRegistry } from '../src/core/routines';
import { AttributeRegistry, FactLog } from '../src/data/store';
import { steelTideSession } from '../scenarios';

/**
 * Failure-case matrix (challenge deliverable): every bad-input class must be
 * visible to the watchstander and must never come out green.
 */
const routines = new RoutineRegistry();
const attrs = new AttributeRegistry();
attrs.register({ key: 'eta', type: 'hours', worse: 'higher', maxAgeH: 12, conflictWindowH: 48, description: 'ETA' });

function graphFromEta(log: FactLog, asOf: number): GraphSpec {
  const r = log.view(asOf).get<number>('part', 'eta');
  const nodes: NodeSpec[] = [
    { id: 'eta', kind: 'event', label: 'Part ETA', at: typeof r.value === 'number' ? r.value : null, assumedAt: asOf + 48, flags: r.flags },
    { id: 'req', kind: 'requirement', label: 'Need', deps: ['eta'], window: { start: 100, end: 101 }, qMargin: 4 },
  ];
  return { id: 'f', horizon: [0, 200], nodes };
}

const fact = (value: unknown, system: string, t: number) => ({
  entity: 'part', attr: 'eta', value, observedAt: t, recordedAt: t, recordedBy: 'test', source: { system, kind: 'synthetic' as const },
});

describe('failure-case matrix', () => {
  const cases: [string, (log: FactLog) => void, string][] = [
    ['missing', () => {}, 'missing'],
    ['stale', (l) => { l.append(fact(20, 'A', 0)); }, 'stale'],
    ['contradictory', (l) => { l.append(fact(20, 'A', 30)); l.append(fact(40, 'B', 31)); }, 'contradictory'],
    ['malformed', (l) => { l.append(fact(20, 'A', 30)); l.append(fact('ETA 2 days', 'A', 31)); }, 'malformed'],
  ];
  for (const [name, seed, flag] of cases) {
    it(`${name}: flagged on the chain and never green`, () => {
      const log = new FactLog(attrs);
      seed(log);
      const r = compute(graphFromEta(log, 32), { now: 32, routines }).requirements.req;
      expect(r.chainFlags).toContain(flag);
      expect(r.status).not.toBe('Y');
    });
  }

  it('contradictory: the worse value is used and both sources are kept', () => {
    const log = new FactLog(attrs);
    log.append(fact(20, 'A', 30));
    log.append(fact(40, 'B', 31));
    const v = log.view(32).get<number>('part', 'eta');
    expect(v.value).toBe(40);
    expect(v.alternatives.map((a) => a.source.system)).toEqual(['A']);
  });

  it('uncertain: Monte Carlo spread is reported, not hidden', () => {
    const a = steelTideSession().advise(55, { monteCarlo: 200, slackTarget: false });
    const mob = a.mc!.requirements['met:ddgB:MOB'];
    expect(mob.pN).toBeGreaterThan(0);
    expect(mob.pY + mob.pQ + mob.pN + mob.pUNK).toBeCloseTo(1);
  });

  it('a cycle in the graph is reported, not silently computed', () => {
    const g: GraphSpec = { id: 'cyc', horizon: [0, 10], nodes: [
      { id: 'a', kind: 'all', label: 'A', deps: ['b'] },
      { id: 'b', kind: 'all', label: 'B', deps: ['a'] },
    ] };
    expect(compute(g, { now: 0, routines }).errors[0]).toMatch(/cycle/);
  });

  it('an unknown dependency is reported', () => {
    const g: GraphSpec = { id: 'u', horizon: [0, 10], nodes: [{ id: 'a', kind: 'all', label: 'A', deps: ['ghost'] }] };
    expect(compute(g, { now: 0, routines }).errors[0]).toMatch(/unknown dependency/);
  });
});
