import { describe, expect, it } from 'vitest';
import { c17Session, steelTideSession } from '../scenarios';
import { airliftPack } from '../src/packs/airlift';
import { navalPack } from '../src/packs/naval';
import { PackRegistry } from '../src/packs/pack';
import { RoutineRegistry, type RoutineDef } from '../src/core/routines';

const tao = { id: 'LT Brandt', role: 'TAO' };

describe('session: human control', () => {
  it('approval stores exact patches; the assumption is applied only from its time onward', () => {
    const s = steelTideSession();
    const d = s.approve('prebrief:tide:ddgB', tao, 55.25, 'pre-brief before EMCON');
    expect(d.patches?.length).toBeGreaterThan(0);
    expect(d.basis?.factsHead).toBe(s.log.head());
    expect(s.evaluate(55.1).result.requirements['strike:tide'].status).toBe('N');
    const after = s.evaluate(58.5);
    expect(after.assumptions).toEqual(['prebrief:tide:ddgB']);
    expect(after.result.requirements['strike:tide'].status).toBe('Y');
    expect(after.graph.nodes.find((n) => n.id === 'c2:ddgB:tide:prebrief')?.flags).toContain('planning-assumption');
    // the authoritative fact log is untouched by the decision
    expect(s.log.all().some((f) => f.source.kind === 'assumption')).toBe(false);
  });

  it('cannot approve after the act-by time; STOP suspends advice and blocks approvals', () => {
    const s = steelTideSession();
    expect(() => s.approve('prebrief:tide:ddgB', tao, 57, 'late')).toThrow(/act-by/);
    s.decisions.stop(tao, 57, 'picture unreliable');
    expect(s.advise(57.5).suspended).toBe(true);
    expect(s.advise(57.5).answers).toEqual([]);
    expect(() => s.approve('emcon-relay:tide', tao, 57.6)).toThrow(/stopped/);
    s.decisions.resume(tao, 57.7);
    expect(s.advise(57.8, { slackTarget: false }).suspended).toBe(false);
  });

  it('overrides are recorded beside the engine verdict', () => {
    const s = steelTideSession();
    s.decisions.override('strike:tide', 'Q', tao, 55, 'CO judges relay timing acceptable');
    const a = s.advise(55.5, { slackTarget: false });
    expect(a.overrides[0].status).toBe('Q');
    expect(a.answers.find((x) => x.requirement === 'strike:tide')!.status).toBe('N');
  });

  it('advice carries a trace: fact head, decision head, graph hash, routine versions', () => {
    const s = steelTideSession();
    const a = s.advise(55, { slackTarget: false });
    expect(a.trace.factsHead).toBe(s.log.head());
    expect(a.trace.graphHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(a.trace.routines)).toContain('naval.burnPctPerHour');
    expect(a.trace.unverifiedRoutines).toEqual([]);
  });

  it('is deterministic: same facts, same answer', () => {
    const a = steelTideSession().evaluate(55).result;
    const b = steelTideSession().evaluate(55).result;
    expect(a.graphHash).toBe(b.graphHash);
    expect(a.requirements['strike:tide'].margin).toBe(b.requirements['strike:tide'].margin);
  });
});

describe('packs and routines', () => {
  it('every shipped routine passes its tests and declared monotonicity', () => {
    const reg = new PackRegistry().register(airliftPack).register(navalPack);
    const v = reg.routines.verifyAll();
    expect(v.filter((x) => !x.ok)).toEqual([]);
    expect(v.length).toBeGreaterThanOrEqual(9);
  });

  it('a pack cannot register before the pack it depends on', () => {
    expect(() => new PackRegistry().register(navalPack)).toThrow(/depends on airlift/);
  });

  it('verification catches a wrong monotonicity declaration and a broken contract', () => {
    const r = new RoutineRegistry();
    const bad: RoutineDef = {
      id: 'x.bad', title: 'bad', description: '', kind: 'value', output: { unit: 'h' },
      inputs: { nm: { type: 'number', monotone: 'decreasing' } },
      fn: ({ nm }) => ({ value: nm / 10, unit: 'h', detail: 'nm/10' }),
      tests: [{ name: 't', inputs: { nm: 100 }, expect: { value: 10 } }],
    };
    r.register(bad, 'test');
    const v = r.verify('x.bad');
    expect(v.tests[0].ok).toBe(true);
    expect(v.monotonicity[0].ok).toBe(false);
    r.register({ ...bad, id: 'x.contract', inputs: { nm: { type: 'number' } }, fn: () => ({ value: 1, unit: 'min', detail: '' }) }, 'test');
    expect(r.run('x.contract', { nm: 1 }).contractErrors.length).toBe(2);
  });

  it('the airlift pack runs AMPLIFI-style checks with a time margin, and composes into the naval pack', () => {
    const s = c17Session();
    const r = s.evaluate(0).result;
    expect(r.requirements.delivered.status).toBe('Y');
    expect(r.requirements.delivered.margin).toBeCloseTo(4.47, 1);
    s.log.append({ entity: 'reach-417', attr: 'airlift.cargo_lb', value: 165000, observedAt: 1, recordedAt: 1, recordedBy: 't', source: { system: 'GDSS', kind: 'synthetic' } });
    const heavy = s.evaluate(1).result.requirements.delivered;
    expect(heavy.status).toBe('N');
    expect(heavy.leaves[0].terminal).toBe('check');
    const naval = steelTideSession().evaluate(58.5).result;
    expect(naval.nodes['cod:satcom-modem:range'].routineRun?.routine).toBe('airlift.legWithinRange');
  });
});
