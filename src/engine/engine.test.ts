import { describe, expect, it } from 'vitest';
import { classic } from '@/data/classic';
import { D, ddg21 } from '@/data/ddg21';
import { R, reload72 } from '@/data/reload72';
import { applyPatches, compute, createMonteCarlo, diffResults, evaluateOptions, explainEvent, findCliffs, runMonteCarlo, slackFor, stateAt, fmtT } from './index';

const cap = (s: typeof ddg21, t: number, id: string) => {
  const { nodes } = stateAt(s, t);
  return compute(s, nodes, t).capabilities.find((c) => c.id === id)!;
};

describe('classic radar repair', () => {
  it('baseline: team controls, 1h margin', () => {
    const c = cap(classic, 8, 'c_radar');
    expect(c.ready).toBe(17);
    expect(c.margin).toBe(1);
    expect(c.controlling.nodeId).toBe('in_team');
    expect(c.status).toBe('Y');
  });

  it('part slip to 1330 consumes upstream slack, no mission consequence', () => {
    const c = cap(classic, 9.5, 'c_radar');
    expect(c.ready).toBe(17);
    expect(c.margin).toBe(1);
  });

  it('team slip to 1600 misses the requirement by 1h', () => {
    const c = cap(classic, 11, 'c_radar');
    expect(c.ready).toBe(19);
    expect(c.margin).toBe(-1);
    expect(c.status).toBe('N');
  });

  it('distinguishes upstream slack from mission margin', () => {
    const { nodes } = stateAt(classic, 8);
    const part = slackFor(classic, nodes, 8, 'in_part', 'c_radar');
    const team = slackFor(classic, nodes, 8, 'in_team', 'c_radar');
    expect(part.noImpact).toBeCloseTo(2, 1);
    expect(part.toFailure).toBeCloseTo(3, 1);
    expect(team.noImpact).toBe(0);
    expect(team.toFailure).toBeCloseTo(1, 1);
  });

  it('options: concurrent testing + cross-deck recovers when singles do not', () => {
    const { nodes } = stateAt(classic, 11);
    const { singles, combos } = evaluateOptions(classic, nodes, 11, 'c_radar');
    expect(singles.find((o) => o.id === 'K_XDECK')!.statusAfter).not.toBe('N');
    expect(combos[0]?.marginAfter).toBeGreaterThan(0);
  });
});

describe('DDG 21-day readiness', () => {
  it('baseline before CASREP: AMD Y with full margin', () => {
    const c = cap(ddg21, D(-21, '0800'), 'c_amd');
    expect(c.status).toBe('Y');
    expect(c.upNow).toBe(true);
  });

  it('CASREP with ETA missing is flagged assumed; AMD down now', () => {
    const t = D(-20, '1100');
    const c = cap(ddg21, t, 'c_amd');
    expect(c.upNow).toBe(false);
    expect(c.flagsOnChain.some((f) => f.flag === 'missing')).toBe(true);
  });

  it('Martinez TAD has no mission consequence', () => {
    const before = stateAt(ddg21, D(-19, '0800'));
    const after = stateAt(ddg21, D(-19, '0900'));
    const d = diffResults(compute(ddg21, before.nodes, D(-19, '0800')), compute(ddg21, after.nodes, D(-19, '0900')));
    expect(d.caps.find((c) => c.id === 'c_amd')!.marginDelta).toBe(0);
  });

  it('CFA slip past sail is nonlinear: misses Norfolk window, Rota controls', () => {
    const before = cap(ddg21, D(-17, '1500'), 'c_amd');
    const after = cap(ddg21, D(-17, '1600'), 'c_amd');
    expect(after.controlling.kind).toBe('window');
    expect(before.margin - after.margin).toBeGreaterThan(24 * 8);
    expect(after.status).toBe('Q');
    const { nodes } = stateAt(ddg21, D(-17, '1600'));
    const prev = stateAt(ddg21, D(-17, '1500')).nodes;
    const ev = ddg21.events.find((e) => e.id === 'E05')!;
    const lines = explainEvent(ddg21, prev, nodes, ev, diffResults(compute(ddg21, prev, D(-17, '1500')), compute(ddg21, nodes, D(-17, '1600'))));
    expect(lines.some((l) => l.kind === 'nonlinear')).toBe(true);
  });

  it('Okafor leave shifts control from the Rota window to crew availability', () => {
    const c = cap(ddg21, D(-16, '0800'), 'c_amd');
    expect(c.controlling.kind).toBe('person');
    expect(c.controlling.nodeId).toBe('p_fc1_martinez');
  });

  it('after crew loss, expedite alone is ineffective but expedite + crew package recovers', () => {
    const t = D(-14, '1400');
    const { nodes } = stateAt(ddg21, t);
    const { singles, combos } = evaluateOptions(ddg21, nodes, t, 'c_amd');
    const exp = singles.find((o) => o.id === 'L_EXPEDITE')!;
    expect(exp.recovered).toBeLessThan(1);
    expect(combos.length).toBeGreaterThan(0);
    expect(combos[0].recovered).toBeGreaterThan(24 * 7);
  });

  it('helo fly-on is a hidden cliff', () => {
    const t = D(-14, '1400');
    const { nodes } = stateAt(ddg21, t);
    const r = compute(ddg21, nodes, t);
    const asw = r.capabilities.find((c) => c.id === 'c_asw')!;
    const cliffs = findCliffs(ddg21, nodes, t, 'c_asw', asw.chain);
    expect(cliffs.some((c) => c.nodeId === 'in_helo_det')).toBe(true);
  });

  it('accept-degraded option caps status at Q', () => {
    const t = D(-14, '1400');
    const { nodes } = stateAt(ddg21, t);
    const lever = ddg21.levers.find((l) => l.id === 'L_ACCEPT')!;
    const r = compute(ddg21, applyPatches(nodes, lever.patches), t);
    expect(r.capabilities.find((c) => c.id === 'c_amd')!.status).toBe('Q');
  });

  it('monte carlo is deterministic for a seed', () => {
    const t = D(-14, '1400');
    const { nodes } = stateAt(ddg21, t);
    const a = runMonteCarlo(ddg21, nodes, t, 200, 7);
    const b = runMonteCarlo(ddg21, nodes, t, 200, 7);
    expect(a.targets.c_amd.pMeet).toBe(b.targets.c_amd.pMeet);
    expect(a.targets.c_amd.p50).toBe(b.targets.c_amd.p50);
    const r = createMonteCarlo(ddg21, nodes, t, 200, 7);
    while (r.done < r.n) r.step(37);
    const c = r.snapshot();
    expect(Array.from(c.targets.c_amd.margins)).toEqual(Array.from(a.targets.c_amd.margins));
    expect(c.criticality.c_amd).toEqual(a.criticality.c_amd);
  });

  it('prints the event-by-event story', () => {
    const rows: string[] = [];
    for (const e of ddg21.events) {
      const amd = cap(ddg21, e.t, 'c_amd');
      const asw = cap(ddg21, e.t, 'c_asw');
      const mob = cap(ddg21, e.t, 'c_mob');
      rows.push(`${e.id} ${fmtT(ddg21, e.t)} AMD ${amd.status} ${fmtT(ddg21, amd.ready)} ctl=${amd.controlling.label} | ASW ${asw.status} | MOB ${mob.status}`);
    }
    console.log(rows.join('\n'));
  });
});

describe('reload72 VLS reload (same engine, second workflow)', () => {
  it('baseline: airlift controls AMD with 19h margin', () => {
    const c = cap(reload72, R(-3, '0600'), 'c_amd');
    expect(c.margin).toBe(19);
    expect(c.controlling.nodeId).toBe('in_ord_c17');
  });

  it('a 12h airlift slip costs 17h: berth slot A is missed and slot B controls', () => {
    const c = cap(reload72, R(-3, '1100'), 'c_amd');
    expect(c.margin).toBe(2);
    expect(c.controlling.kind).toBe('window');
  });

  it('supervisor light duty takes control and breaks the sail requirement', () => {
    const c = cap(reload72, R(-3, '1500'), 'c_amd');
    expect(c.status).toBe('N');
    expect(c.margin).toBe(-2);
    expect(c.controlling.nodeId).toBe('p_gmc_horvat');
  });

  it('expediting the airlift alone recovers nothing; adding a cross-decked supervisor recovers 15h', () => {
    const t = R(-3, '2200');
    const { nodes } = stateAt(reload72, t);
    const { singles, combos } = evaluateOptions(reload72, nodes, t, 'c_amd');
    expect(singles.find((o) => o.id === 'X_CHANIA')!.recovered).toBe(0);
    expect(combos[0].id).toBe('X_XDECK+X_CHANIA');
    expect(combos[0].recovered).toBe(15);
  });
});
