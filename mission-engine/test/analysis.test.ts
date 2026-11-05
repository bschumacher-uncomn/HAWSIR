import { describe, expect, it } from 'vitest';
import { consequenceCurve, findCliffs, slackFor, slackTable, tornado } from '../src/core/analysis';
import { compute } from '../src/core/compute';
import type { GraphSpec } from '../src/core/graph';
import { mcBatch, runMonteCarlo } from '../src/core/montecarlo';
import { evaluateOptions, type Lever } from '../src/core/options';
import { RoutineRegistry } from '../src/core/routines';

const routines = new RoutineRegistry();
const ctx = { now: 0, routines };

const classic: GraphSpec = {
  id: 'c', horizon: [0, 48], nodes: [
    { id: 'part', kind: 'event', label: 'Part', at: 12, uncertainty: { min: -1, mode: 0, max: 3 } },
    { id: 'team', kind: 'event', label: 'Team', at: 14, uncertainty: { min: 0, mode: 0, max: 2 } },
    { id: 'repair', kind: 'task', label: 'Repair', deps: ['part', 'team'], duration: 3 },
    { id: 'req', kind: 'requirement', label: 'Need', deps: ['repair'], window: { start: 18, end: 20 }, qMargin: 2 },
  ],
};

describe('slack vs margin (bisection on monotone paths)', () => {
  it('part has 2 h of upstream slack and 3 h to failure; team has none', () => {
    const base = compute(classic, ctx);
    const part = slackFor(classic, ctx, 'part', 'req', base);
    expect(part.method).toBe('bisection');
    expect(part.noImpact).toBeCloseTo(2, 1);
    expect(part.toFailure).toBeCloseTo(3, 1);
    const team = slackFor(classic, ctx, 'team', 'req', base);
    expect(team.noImpact).toBeCloseTo(0, 1);
    expect(team.toFailure).toBeCloseTo(1, 1);
    const table = slackTable(classic, ctx, 'req', base);
    expect(table[0].toFailure).toBeCloseTo(1, 1);
    expect(table.filter((x) => Math.abs(x.toFailure - 1) < 0.05).map((x) => x.node).sort()).toEqual(['repair', 'team']);
  });

  it('a top-off stock on the path forces a scan instead of bisection', () => {
    const g: GraphSpec = {
      id: 'f', horizon: [0, 120], nodes: [
        { id: 'unrep', kind: 'event', label: 'UNREP', at: 80 },
        { id: 'fuel', kind: 'stock', label: 'Fuel', unit: '%', t0: 0, initial: 60, capacity: 100, burns: [{ from: 0, to: Infinity, rate: 0.5, label: 'burn' }], transfers: [{ id: 'x', label: 'CONSOL', at: { node: 'unrep' }, kind: 'topoff' }] },
        { id: 'floor', kind: 'threshold', label: '≥15%', stock: 'fuel', level: 15 },
        { id: 'mob', kind: 'requirement', label: 'MOB', deps: ['floor'], window: { start: 0, end: 110 } },
      ],
    };
    const base = compute(g, ctx);
    const r = slackFor(g, ctx, 'unrep', 'mob', base);
    expect(r.method).toBe('scan');
    expect(r.toFailure).toBeCloseTo(10, 1);
  });
});

describe('cliffs and tornado', () => {
  it('finds the step where missing a delivery slot costs more than the slip', () => {
    const g: GraphSpec = {
      id: 'g', horizon: [0, 96], nodes: [
        { id: 'part', kind: 'event', label: 'Part', at: 9 },
        { id: 'cod', kind: 'gate', label: 'COD', deps: ['part'], slots: [{ id: 'a', label: 'A', start: 10, end: 10.5, lag: 2 }, { id: 'b', label: 'B', start: 34, end: 34.5, lag: 2 }] },
        { id: 'req', kind: 'requirement', label: 'Need', deps: ['cod'], window: { start: 40, end: 41 } },
      ],
    };
    const curve = consequenceCurve(g, ctx, 'part', 'req', 4, 8);
    const cliffs = findCliffs(curve);
    expect(cliffs.length).toBe(1);
    expect(cliffs[0].delay).toBeCloseTo(2, 1);
    expect(cliffs[0].extraLoss).toBeGreaterThan(20);
  });

  it('tornado ranks declared uncertainties by margin swing', () => {
    const bars = tornado(classic, ctx, 'req');
    expect(bars[0].node).toBe('team');
  });
});

describe('Monte Carlo', () => {
  it('is reproducible from its seed', () => {
    const a = runMonteCarlo(classic, ctx, ['req'], 400, 42);
    const b = runMonteCarlo(classic, ctx, ['req'], 400, 42);
    expect(a).toEqual(b);
    expect(a.requirements.req.pN).toBeGreaterThan(0);
    expect(a.requirements.req.controlling.team).toBeGreaterThan(0.5);
  });

  it('batches of one seed are the same futures however they are chunked', () => {
    const whole = mcBatch(classic, ctx, ['req'], 42, 0, 300);
    const parts = [mcBatch(classic, ctx, ['req'], 42, 0, 100), mcBatch(classic, ctx, ['req'], 42, 100, 120), mcBatch(classic, ctx, ['req'], 42, 220, 80)];
    expect(parts.flatMap((p) => p.targets.req.margins)).toEqual(whole.targets.req.margins);
    expect(parts.reduce((s, p) => s + p.targets.req.status.N, 0)).toBe(whole.targets.req.status.N);
    const mc = runMonteCarlo(classic, ctx, ['req'], 300, 42);
    expect(whole.targets.req.status.N / 300).toBeCloseTo(mc.requirements.req.pN, 9);
  });
});

describe('options', () => {
  const lever = (id: string, patches: Lever['patches'], extra: Partial<Lever> = {}): Lever => ({
    id, title: id, detail: '', category: 'expedite', authority: 'CO', withinUnitAuthority: true, cost: 'low', effect: 'planning-assumption', patches, target: 'req', ...extra,
  });
  const late: GraphSpec = { ...classic, nodes: classic.nodes.map((n) => (n.id === 'team' ? { ...n, at: 16 } : n)) };

  it('expedite alone recovers nothing when another input controls; the pair recovers', () => {
    const base = compute(late, ctx);
    const out = evaluateOptions(late, ctx, base, 'req', [
      lever('expedite-part', [{ op: 'set', id: 'part', fields: { at: 10 } }]),
      lever('early-team', [{ op: 'set', id: 'team', fields: { at: 13 } }]),
    ]);
    const exp = out.find((o) => o.id === 'expedite-part')!;
    expect(exp.effective).toBe(false);
    const team = out.find((o) => o.id === 'early-team')!;
    expect(team.statusAfter).toBe('Y');
    expect(team.recovered).toBeCloseTo(3);
  });

  it('refuses prohibited categories and enforces act-by deadlines', () => {
    const base = compute(late, ctx);
    expect(() => evaluateOptions(late, ctx, base, 'req', [lever('x', [], { category: 'issue-order' as never })])).toThrow(/prohibited/);
    const out = evaluateOptions(late, { now: 20, routines }, base, 'req', [lever('y', [], { deadline: 15 })]);
    expect(out[0].available).toBe(false);
  });
});
