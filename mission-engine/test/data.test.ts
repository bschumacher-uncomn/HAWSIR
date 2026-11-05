import { describe, expect, it } from 'vitest';
import { AttributeRegistry, FactLog, type FactInput } from '../src/data/store';
import { DecisionLog } from '../src/data/decisions';

function attrs() {
  const a = new AttributeRegistry();
  a.register({ key: 'fuel_pct', type: 'number', unit: '%', min: 0, max: 100, worse: 'lower', maxAgeH: 12, description: 'Fuel on board' });
  a.register({ key: 'part_eta', type: 'hours', worse: 'higher', conflictWindowH: 48, description: 'Part ETA at hub' });
  a.register({ key: 'replenish_trigger_pct', type: 'number', unit: '%', assumed: 30, description: 'Replenish trigger' });
  return a;
}

const f = (x: Partial<FactInput> & Pick<FactInput, 'entity' | 'attr' | 'value'>): FactInput => ({
  source: { system: 'TEST', kind: 'synthetic' }, observedAt: 0, recordedAt: 0, recordedBy: 'test', ...x,
});

describe('fact store', () => {
  it('is append-only, hash-chained, and reads as-of', () => {
    const log = new FactLog(attrs());
    log.append(f({ entity: 'ddg', attr: 'fuel_pct', value: 60, observedAt: 0, recordedAt: 0 }));
    log.append(f({ entity: 'ddg', attr: 'fuel_pct', value: 52, observedAt: 10, recordedAt: 11 }));
    expect(log.view(5).get('ddg', 'fuel_pct').value).toBe(60);
    expect(log.view(12).get('ddg', 'fuel_pct').value).toBe(52);
    expect(log.verify().ok).toBe(true);
  });

  it('flags stale, missing-with-default, contradictory (worse wins), malformed (quarantined)', () => {
    const log = new FactLog(attrs());
    log.append(f({ entity: 'ddg', attr: 'fuel_pct', value: 60, observedAt: 0 }));
    expect(log.view(20).get('ddg', 'fuel_pct').flags).toContain('stale');

    const d = log.view(0).get('mission', 'replenish_trigger_pct');
    expect(d.value).toBe(30);
    expect(d.flags).toEqual(['missing', 'assumed']);

    log.append(f({ entity: 'lru', attr: 'part_eta', value: 58, source: { system: 'R-SUPPLY', kind: 'feed' }, observedAt: 50, recordedAt: 50 }));
    log.append(f({ entity: 'lru', attr: 'part_eta', value: 63, source: { system: 'DLA-TRACK', kind: 'feed' }, observedAt: 52, recordedAt: 52 }));
    const eta = log.view(53).get('lru', 'part_eta');
    expect(eta.value).toBe(63);
    expect(eta.flags).toContain('contradictory');
    expect(eta.alternatives.map((a) => a.source.system)).toEqual(['R-SUPPLY']);

    log.append(f({ entity: 'ddg', attr: 'fuel_pct', value: 142, observedAt: 5, recordedAt: 5 }));
    const bad = log.view(6).get('ddg', 'fuel_pct');
    expect(bad.value).toBe(60);
    expect(bad.flags).toContain('malformed');
    expect(bad.quarantined).toHaveLength(1);
  });

  it('scope precedence: mission value beats global', () => {
    const log = new FactLog(attrs());
    log.append(f({ entity: 'policy', attr: 'replenish_trigger_pct', value: 30 }));
    log.append(f({ entity: 'policy', attr: 'replenish_trigger_pct', value: 40, scope: 'mission:TIDE' }));
    expect(log.view(1).get('policy', 'replenish_trigger_pct', { scopes: ['mission:TIDE', 'global'] }).value).toBe(40);
    expect(log.view(1).get('policy', 'replenish_trigger_pct').value).toBe(30);
  });

  it('detects tampering and merges ship and shore logs without overwriting', () => {
    const ship = new FactLog(attrs(), 'ship');
    const shore = new FactLog(attrs(), 'shore');
    const common = f({ entity: 'ddg', attr: 'fuel_pct', value: 60, origin: 'shore' });
    ship.append(common);
    shore.append(common);
    ship.append(f({ entity: 'ddg', attr: 'fuel_pct', value: 55, observedAt: 4, recordedAt: 4 }));
    shore.append(f({ entity: 'lru', attr: 'part_eta', value: 70, observedAt: 3, recordedAt: 3 }));
    const rep = ship.merge(shore);
    expect(rep.added).toBe(1);
    expect(rep.duplicates).toBe(1);
    expect(ship.verify().ok).toBe(true);
    const back = FactLog.fromJSONL(ship.toJSONL(), attrs(), 'ship');
    expect(back.size()).toBe(ship.size());
    expect(back.verify().ok).toBe(true);
    (ship.all()[1] as { value: unknown }).value = 99;
    expect(ship.verify()).toEqual({ ok: false, brokenAt: 1 });
  });
  it('a fact received late over sync is not known before it arrived, and keeps its id', () => {
    const shore = new FactLog(attrs(), 'shore');
    const ship = new FactLog(attrs(), 'ship');
    const eta = shore.append(f({ entity: 'lru', attr: 'part_eta', value: 70, observedAt: 58.5, recordedAt: 58.5, source: { system: 'R-SUPPLY', kind: 'feed' } }));
    // the ship is out of contact until t=61
    const r = ship.merge(shore, { receivedAt: 61 });
    expect(r.added).toBe(1);
    const got = ship.all()[0];
    expect(got.id).toBe(eta.id);
    expect(got.receivedAt).toBe(61);
    expect(ship.view(60).get('lru', 'part_eta').value).toBeUndefined();
    expect(ship.view(61).get('lru', 'part_eta').value).toBe(70);
    expect(shore.view(60).get('lru', 'part_eta').value).toBe(70);
    expect(ship.verify().ok).toBe(true);
    // the receipt time is covered by the node's chain: editing it is detected
    (ship.all()[0] as { receivedAt?: number }).receivedAt = 50;
    expect(ship.verify().ok).toBe(false);
    // and survives a JSONL round trip
    const ship2 = new FactLog(attrs(), 'ship');
    ship2.merge(shore, { receivedAt: 61 });
    const back = FactLog.fromJSONL(ship2.toJSONL(), attrs(), 'ship');
    expect(back.head()).toBe(ship2.head());
  });
});

describe('decision log', () => {
  const watch = { id: 'LT Ames', role: 'TAO' };
  it('requires notes for rejections, overrides and STOP; blocks approvals while stopped', () => {
    const log = new DecisionLog();
    expect(() => log.reject('L1', watch, 1, '')).toThrow();
    log.approve('L1', watch, 1);
    log.stop(watch, 2, 'link picture unreliable');
    expect(log.isStopped(3)).toBe(true);
    expect(() => log.approve('L2', watch, 3)).toThrow();
    log.resume(watch, 4, 'picture restored');
    expect(log.isStopped(5)).toBe(false);
    log.reject('L1', watch, 5, 'CO prefers to slip H-hour');
    expect(log.activeLevers(4).has('L1')).toBe(true);
    expect(log.activeLevers(6).has('L1')).toBe(false);
    expect(log.verify().ok).toBe(true);
  });

  it('tamper is detected and restored from the edge copy', () => {
    const log = new DecisionLog();
    log.approve('L1', watch, 1, 'ok');
    log.approve('L2', watch, 2, 'ok');
    const edge = log.clone();
    log.unsafeTamper(0, { note: 'changed later' });
    expect(log.verify().ok).toBe(false);
    const r = log.restoreFrom(edge);
    expect(r.restored).toEqual([0]);
    expect(log.verify().ok).toBe(true);
  });
});
