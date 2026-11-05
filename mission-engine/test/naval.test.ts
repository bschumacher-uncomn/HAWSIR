import { describe, expect, it } from 'vitest';
import { steelTideSession } from '../scenarios';

describe('Operation STEEL TIDE (naval pack, synthetic)', () => {
  it('baseline (H-12): strike is Y; fuel is upstream slack on mobility', () => {
    const s = steelTideSession();
    const r = s.evaluate(48).result;
    expect(r.errors).toEqual([]);
    expect(r.requirements['strike:tide'].status).toBe('Y');
    const mob = r.requirements['met:ddgB:MOB'];
    expect(mob.bindingEdge).toBe('stock');
    expect(mob.margin).toBeCloseTo(5.72, 1);
    expect(mob.leaves.map((l) => l.node)).toEqual(['unrep:consol1:ready']);
  });

  it('H-5: SATCOM CASREP + contradictory ETA → strike N, controlled by the COD slot; relay is the later alternative', () => {
    const s = steelTideSession();
    const ev = s.evaluate(55);
    const st = ev.result.requirements['strike:tide'];
    expect(st.status).toBe('N');
    expect(st.margin).toBeCloseTo(-10.25, 2);
    expect(st.leaves[0].node).toBe('cod:satcom-modem');
    expect(st.leaves[0].terminal).toBe('slot');
    expect(ev.result.nodes['part:satcom-modem'].flags).toContain('contradictory');
    expect(ev.result.nodes['part:satcom-modem'].timeline?.[0][0]).toBe(63); // DLA's later ETA wins
    expect(ev.result.nodes['sys:ddgB-satcom:repair'].start).toBeCloseTo(67.25);
  });

  it('H-5 options: pre-brief recovers fully before EMCON; reassignment is incomplete without the CG count', () => {
    const s = steelTideSession();
    const a = s.advise(55);
    const opts = a.options['strike:tide'];
    const pre = opts.find((o) => o.id === 'prebrief:tide:ddgB')!;
    expect(pre.available).toBe(true);
    expect(pre.statusAfter).toBe('Y');
    expect(pre.deadline).toBe(56);
    const re = opts.find((o) => o.id === 'reassign:tide:ddgB')!;
    expect(re.incomplete).toContain('Port Harmon TLAM inventory not reported');
    expect(re.effective).toBe(false);
    const emcon = opts.find((o) => o.id === 'emcon-relay:tide')!;
    expect(emcon.statusAfter).toBe('Q');
    expect(emcon.risk?.level).toBe('H');
    expect(opts.some((o) => o.levers.includes('slip:tide:6') && o.levers.includes('slip:tide:12'))).toBe(false);
  });

  it('H-1.5: hub closed and part re-routed beyond COD range → relay after EMCON controls; pre-brief act-by has passed', () => {
    const s = steelTideSession();
    const a = s.advise(58.5);
    const ev = s.evaluate(58.5);
    const st = ev.result.requirements['strike:tide'];
    expect(st.margin).toBeCloseTo(-16);
    expect(st.leaves[0].node).toBe('emcon:csg:clear');
    expect(ev.result.nodes['cod:satcom-modem:range'].check?.passed).toBe(false);
    const pre = a.options['strike:tide'].find((o) => o.id === 'prebrief:tide:ddgB')!;
    expect(pre.available).toBe(false);
    expect(pre.unavailableReason).toMatch(/act-by/);
    const cod = a.options['strike:tide'].find((o) => o.id.startsWith('cod-dedicated:satcom'));
    expect(cod?.available).toBe(false);
    expect(cod?.unavailableReason).toMatch(/exceeds/);
  });

  it('data health: malformed fuel quarantined, stale DRRS-N, unreported significant change, mismatch', () => {
    const s = steelTideSession();
    const a = s.advise(55, { slackTarget: false });
    const keys = a.health.map((h) => `${h.entity}/${h.attr}:${h.flags.join('+')}`);
    expect(keys).toContain('ddgC/fuel_pct:stale+malformed');
    expect(keys).toContain('ddgB/STW/met_assessment:stale');
    expect(keys).toContain('ddgD/AW/met_assessment:unreported-change');
    expect(keys).toContain('cg/TLAM/magazine:missing');
    const stw = s.evaluate(55).result.requirements['met:ddgB:STW:tide'];
    expect(stw.flags).toContain('reported-mismatch');
  });

  it('group of N: AW screen needs 3 of 4 escorts; Okafor SPY CASREP leaves no spare', () => {
    const s = steelTideSession();
    const r = s.evaluate(55).result;
    expect(r.requirements['met:ddgD:AW'].status).toBe('N');
    expect(r.requirements['grp:csg:AW'].status).toBe('Y');
    expect(r.nodes['grp:csg:AW:k'].flags).toContain('no-redundancy');
  });

  it('every computed node built from a fact cites it', () => {
    const s = steelTideSession();
    const g = s.evaluate(55).graph;
    const part = g.nodes.find((n) => n.id === 'part:satcom-modem')!;
    expect(part.prov?.sources?.map((x) => x.system).sort()).toEqual(['DLA-TRACK', 'R-SUPPLY', 'R-SUPPLY'].sort());
    const fuel = g.nodes.find((n) => n.id === 'fuel:ddgB')!;
    expect(fuel.prov?.citations?.[0].title).toMatch(/GAO/);
  });
});
