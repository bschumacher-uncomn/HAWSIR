import { describe, expect, it } from 'vitest';
import { compute } from '../src/core/compute';
import type { GraphSpec, NodeSpec } from '../src/core/graph';
import { RoutineRegistry } from '../src/core/routines';

const routines = new RoutineRegistry();

/** HAWSIR's "classic" regression, re-expressed on the new engine. */
function classic(partAt = 12, teamAt = 14): GraphSpec {
  const nodes: NodeSpec[] = [
    { id: 'part', kind: 'event', label: 'Replacement part on board', at: partAt },
    { id: 'team', kind: 'event', label: 'Repair team available', at: teamAt },
    { id: 'repair', kind: 'task', label: 'Radar repair', deps: ['part', 'team'], duration: 3 },
    { id: 'radar', kind: 'requirement', label: 'Radar mission', deps: ['repair'], window: { start: 18, end: 20 }, qMargin: 2 },
  ];
  return { id: 'classic', horizon: [0, 48], nodes };
}

describe('time chains (HAWSIR classic equivalence)', () => {
  it('part 1200, team 1400, 3 h repair, need 1800 → ready 1700, 1 h margin, team controls', () => {
    const r = compute(classic(), { now: 0, routines });
    const req = r.requirements.radar;
    expect(r.nodes.repair.finish).toBe(17);
    expect(req.margin).toBeCloseTo(1);
    expect(req.status).toBe('Q');
    expect(req.leaves.map((l) => l.node)).toEqual(['team']);
  });

  it('part slipping to 1330 has no consequence (upstream slack)', () => {
    const r = compute(classic(13.5), { now: 0, routines });
    expect(r.requirements.radar.margin).toBeCloseTo(1);
  });

  it('team slipping to 1600 misses by 1 h', () => {
    const r = compute(classic(12, 16), { now: 0, routines });
    expect(r.requirements.radar.margin).toBeCloseTo(-1);
    expect(r.requirements.radar.status).toBe('N');
  });

  it('co-critical inputs are both reported', () => {
    const r = compute(classic(14, 14), { now: 0, routines });
    expect(r.requirements.radar.leaves.map((l) => l.node).sort()).toEqual(['part', 'team']);
  });
});

describe('windows, crews, gates and any/kofn', () => {
  it('a system lost mid-window sets a negative tail margin attributed to the window', () => {
    const g: GraphSpec = {
      id: 'tail', horizon: [0, 48], nodes: [
        { id: 'sat', kind: 'window', label: 'SATCOM up', intervals: [[-Infinity, 30]] },
        { id: 'req', kind: 'requirement', label: 'Strike C2', deps: ['sat'], window: { start: 28, end: 32 } },
      ],
    };
    const req = compute(g, { now: 0, routines }).requirements.req;
    expect(req.tail).toBeCloseTo(-2);
    expect(req.bindingEdge).toBe('tail');
    expect(req.leaves[0].terminal).toBe('window');
  });

  it('crew availability can control a task', () => {
    const g: GraphSpec = {
      id: 'crew', horizon: [0, 48], nodes: [
        { id: 'part', kind: 'event', label: 'Part', at: 5 },
        { id: 'et1', kind: 'person', label: 'ET1 Reyes' },
        { id: 'et2', kind: 'person', label: 'ET2 Park', unavailable: [{ start: 0, end: 10, reason: 'sick in quarters' }] },
        { id: 'fix', kind: 'task', label: 'Repair', deps: ['part'], duration: 4, crew: { pool: ['et1', 'et2'], k: 2, label: 'qualified ETs' } },
        { id: 'req', kind: 'requirement', label: 'Need', deps: ['fix'], window: { start: 20, end: 21 } },
      ],
    };
    const r = compute(g, { now: 0, routines });
    expect(r.nodes.fix.start).toBe(10);
    expect(r.requirements.req.margin).toBeCloseTo(6);
    expect(r.requirements.req.leaves.map((l) => l.node)).toEqual(['et2']);
    expect(r.nodes.fix.flags).not.toContain('no-redundancy');
  });

  it('a gate waits for the next slot (nonlinear consequence)', () => {
    const g = (partAt: number): GraphSpec => ({
      id: 'gate', horizon: [0, 96], nodes: [
        { id: 'part', kind: 'event', label: 'Part at airfield', at: partAt },
        { id: 'cod', kind: 'gate', label: 'COD to carrier', deps: ['part'], slots: [
          { id: 's1', label: 'COD 1', start: 10, end: 10.5, lag: 2 },
          { id: 's2', label: 'COD 2', start: 34, end: 34.5, lag: 2 },
        ] },
        { id: 'req', kind: 'requirement', label: 'Need', deps: ['cod'], window: { start: 24, end: 25 } },
      ],
    });
    const ok = compute(g(9), { now: 0, routines }).requirements.req;
    expect(ok.margin).toBeCloseTo(12);
    const late = compute(g(11), { now: 0, routines }).requirements.req;
    expect(late.margin).toBeCloseTo(-12);
    expect(late.leaves[0].terminal).toBe('slot');
  });

  it('any picks the earliest alternative and kofn flags no redundancy', () => {
    const g: GraphSpec = {
      id: 'alt', horizon: [0, 48], nodes: [
        { id: 'a', kind: 'event', label: 'A', at: 5 },
        { id: 'b', kind: 'event', label: 'B', at: 8 },
        { id: 'c', kind: 'event', label: 'C', at: 40 },
        { id: 'either', kind: 'any', label: 'A or B', deps: ['a', 'b'] },
        { id: 'two', kind: 'kofn', label: '2 of 3', k: 2, deps: ['a', 'b', 'c'] },
        { id: 'req', kind: 'requirement', label: 'Need', deps: ['either', 'two'], window: { start: 10, end: 12 } },
      ],
    };
    const r = compute(g, { now: 0, routines });
    expect(r.nodes.either.timeline?.[0][0]).toBe(5);
    expect(r.nodes.two.timeline?.[0][0]).toBe(8);
    expect(r.nodes.two.flags).toContain('no-redundancy');
    expect(r.requirements.req.leaves.map((l) => l.node)).toEqual(['b']);
  });

  it('missing time without assumption is UNK; with assumption it is flagged and not green', () => {
    const mk = (assumed?: number): GraphSpec => ({
      id: 'm', horizon: [0, 48], nodes: [
        { id: 'eta', kind: 'event', label: 'Part ETA', at: null, assumedAt: assumed },
        { id: 'req', kind: 'requirement', label: 'Need', deps: ['eta'], window: { start: 30, end: 31 }, qMargin: 1 },
      ],
    });
    expect(compute(mk(), { now: 0, routines }).requirements.req.status).toBe('UNK');
    const withA = compute(mk(10), { now: 0, routines }).requirements.req;
    expect(withA.margin).toBeCloseTo(20);
    expect(withA.status).toBe('Q');
    expect(withA.chainFlags).toContain('assumed');
  });
});

describe('stocks over time', () => {
  const fuel = (unrepAt: number, kind: 'in' | 'topoff' = 'topoff'): GraphSpec => ({
    id: 'fuel', horizon: [0, 120], nodes: [
      { id: 'unrep', kind: 'event', label: 'UNREP complete', at: unrepAt },
      {
        id: 'fuel', kind: 'stock', label: 'DDG fuel', unit: '%', t0: 0, initial: 60, capacity: 100,
        burns: [{ from: 0, to: Infinity, rate: 0.5, label: '18 kt transit' }],
        transfers: [{ id: 'x1', label: 'CONSOL', at: { node: 'unrep' }, kind, amount: 50 }],
      },
      { id: 'above15', kind: 'threshold', label: 'Fuel ≥ 15%', stock: 'fuel', level: 15 },
      { id: 'mob', kind: 'requirement', label: 'Mobility', deps: ['above15'], window: { start: 0, end: 110 } },
    ],
  });

  it('computes the breach time and attributes it to a late transfer', () => {
    // 60% at 0.5 %/h reaches 15% at t=90; UNREP at 100 is 10 h late
    const r = compute(fuel(100), { now: 0, routines });
    expect(r.nodes.above15.timeline?.[0][1]).toBeCloseTo(90);
    const req = r.requirements.mob;
    expect(req.status).toBe('N');
    expect(req.tail).toBeCloseTo(-20);
    expect(req.leaves[0].node).toBe('unrep');
    expect(req.quantity[0].minInWindow).toBeCloseTo(10);
  });

  it('an earlier transfer keeps the stock above the line; topoff is flagged non-monotone', () => {
    const r = compute(fuel(80), { now: 0, routines });
    // low point 20% at t=80 is 5% above the floor = 10 h of burn: the stock sets the margin
    expect(r.requirements.mob.margin).toBeCloseTo(10);
    expect(r.requirements.mob.bindingEdge).toBe('stock');
    expect(r.requirements.mob.status).toBe('Q');
    expect(r.requirements.mob.leaves[0].node).toBe('unrep');
    expect(r.nodes.fuel.flags).toContain('non-monotone');
    const fixed = compute(fuel(80, 'in'), { now: 0, routines });
    expect(fixed.nodes.fuel.flags).not.toContain('non-monotone');
  });
});
