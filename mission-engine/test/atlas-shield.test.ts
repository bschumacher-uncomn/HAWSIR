import { describe, expect, it } from 'vitest';
import { consequenceCurve, findCliffs } from '../src/core/analysis';
import { leavesOf } from '../src/core/attribution';
import { compute } from '../src/core/compute';
import { evaluateOptions } from '../src/core/options';
import { applyPatches } from '../src/core/patch';
import { ATLAS_SHIELD, atlasShieldSession } from '../scenarios';
import { D } from '../scenarios/atlas-shield';

/**
 * Operation ATLAS SHIELD on the new engine. These pin the same story the
 * original prototype tests pinned: what controls AMD after each report, the
 * nonlinear CFA slip, and which options actually recover it.
 */
const s = atlasShieldSession();
const amd = (t: number) => s.evaluate(t).result.requirements.c_amd;

describe('Atlas Shield (authored graph bound to facts)', () => {
  it('baseline before the CASREP: AMD Y and up now', () => {
    const r = amd(D(-21, '0900'));
    expect(r.status).toBe('Y');
    expect(r.upNow).toBe(true);
  });

  it('the CASREP adds the repair chain; with no CFA ETA the engine assumes and flags it', () => {
    const ev = s.evaluate(D(-20, '1100'));
    const r = ev.result.requirements.c_amd;
    expect(r.upNow).toBe(false);
    expect(ev.graph.nodes.some((n) => n.id === 't_spy_repair')).toBe(true);
    expect(ev.result.nodes.in_cfa_eta.flags).toEqual(expect.arrayContaining(['missing', 'assumed']));
    expect(s.evaluate(D(-20, '1000')).graph.nodes.some((n) => n.id === 't_spy_repair')).toBe(false);
  });

  it('Martinez TAD has no mission consequence when it lands', () => {
    expect(amd(D(-19, '0900')).margin).toBeCloseTo(amd(D(-19, '0800')).margin, 6);
  });

  it('the CFA slip past sail is nonlinear: it misses the Norfolk pier and the Rota window controls', () => {
    const before = amd(D(-17, '1500'));
    const after = amd(D(-17, '1600'));
    expect(before.margin - after.margin).toBeGreaterThan(24 * 8);
    expect(after.status).toBe('Q');
    expect(leavesOf(after.controlling).some((l) => l.terminal === 'slot')).toBe(true);
  });

  it("Okafor's leave moves control from the Rota window to FC1 Martinez", () => {
    const leaves = leavesOf(amd(D(-16, '0800')).controlling);
    expect(leaves.map((l) => l.node)).toContain('p_fc1_martinez');
  });

  it('at D-14 1400: AMD Q, ready D-5 2200 with 4d 10h of margin', () => {
    const r = amd(D(-14, '1400'));
    expect(r.status).toBe('Q');
    expect(r.cover?.[0]).toBeCloseTo(D(-5, '2200'), 6);
    expect(r.margin).toBeCloseTo(4 * 24 + 10, 6);
  });

  it('reports carry their data quality: contradictory ETA, withdrawn estimate, quarantined record, stale part ETA', () => {
    const ev = s.evaluate(D(-14, '1400'));
    expect(ev.result.nodes.in_cfa_eta.flags).toContain('contradictory');
    expect(ev.result.nodes.t_spy_repair.flags).toEqual(expect.arrayContaining(['missing', 'assumed']));
    expect(ev.result.nodes.p_tao_diaz.flags).toContain('malformed');
    expect(ev.graph.nodes.find((n) => n.id === 'p_tao_diaz')!.kind === 'person' && (ev.graph.nodes.find((n) => n.id === 'p_tao_diaz') as { from?: number }).from).toBe(D(-15, '0900'));
  });

  it('expedite alone recovers nothing; expedite plus fly-away techs recovers a week', () => {
    const t = D(-14, '1400');
    const ev = s.evaluate(t);
    const levers = ev.build.levers.filter((l) => l.target === 'c_amd');
    const opts = evaluateOptions(ev.graph, ev.ctx, ev.result, 'c_amd', levers);
    const exp = opts.find((o) => o.id === 'L_EXPEDITE')!;
    expect(exp.recovered).toBeLessThan(1);
    const best = opts.filter((o) => o.levers.length === 2).sort((a, b) => b.recovered - a.recovered)[0];
    expect(best.levers).toEqual(expect.arrayContaining(['L_EXPEDITE']));
    expect(best.recovered).toBeGreaterThan(24 * 7);
  });

  it('the helo fly-on is a hidden cliff for ASW', () => {
    const ev = s.evaluate(D(-14, '1400'));
    const curve = consequenceCurve(ev.graph, ev.ctx, 'in_helo_det', 'c_asw', 72, 144);
    expect(findCliffs(curve).length).toBeGreaterThan(0);
  });

  it('accepting degraded AMD caps it at Q', () => {
    const ev = s.evaluate(D(-14, '1400'));
    const lever = ev.build.levers.find((l) => l.id === 'L_ACCEPT')!;
    const r = compute(applyPatches(ev.graph, lever.patches), ev.ctx);
    expect(r.requirements.c_amd.status).toBe('Q');
  });

  it('every scripted report is valid against the attribute registry except the deliberately malformed one', () => {
    const facts = ATLAS_SHIELD.events().flatMap((e) => e.facts);
    const bad = s.log.all().filter((f) => f.quarantine).map((f) => f.source.recordId);
    expect(facts.length).toBeGreaterThan(10);
    expect(bad).toEqual(['Q-TAO-04-UPD']);
  });
});
