import { describe, expect, it } from 'vitest';
import { DISRUPTIONS } from '@/data/fleet';
import { buildFleet, type FleetPicture } from './model';

const status = (p: FleetPicture) => Object.fromEntries(p.missions.map((m) => [m.spec.id, m.status]));
const mission = (p: FleetPicture, id: string) => p.missions.find((m) => m.spec.id === id)!;

describe('fleet picture', () => {
  const base = buildFleet([]);

  it('rolls 38 hulls into 12 missions with every package timed by the engine', () => {
    expect(base.ships).toHaveLength(38);
    expect(base.missions).toHaveLength(12);
    expect(base.packages.length).toBeGreaterThanOrEqual(140);
    expect(base.packages.every((p) => Number.isFinite(p.slack) || !p.recoverable)).toBe(true);
    expect(status(base)).toEqual({
      atlas: 'Q', vigil: 'Q', csg14: 'Q', arg: 'Q', guard: 'Y', mcm: 'Q', sentry: 'Y', keen: 'Y', hadr: 'Q', south: 'Y', comptuex: 'Q', homeland: 'Y',
    });
  });

  it('is deterministic', () => {
    const again = buildFleet([]);
    expect(again.missions.map((m) => m.margin)).toEqual(base.missions.map((m) => m.margin));
    expect(again.packages.map((p) => p.slack)).toEqual(base.packages.map((p) => p.slack));
  });

  it('uses the detailed scenarios for DDG-170 and DDG-173; redundancy absorbs DDG-173', () => {
    const atlas = mission(base, 'atlas');
    expect(atlas.controlling?.hull).toBe('DDG-170');
    expect(atlas.reqs[0].absorbed.map((c) => c.hull)).toEqual(['DDG-173']);
  });

  it('AMC stand-down breaks five missions; CSG-14 is then controlled by the carrier air wing', () => {
    const amc = buildFleet(['amc']);
    const flipped = amc.missions.filter((m) => m.status !== status(base)[m.spec.id]).map((m) => m.spec.id);
    expect(flipped.sort()).toEqual(['arg', 'csg14', 'keen', 'mcm', 'vigil']);
    expect(mission(amc, 'csg14').controlling).toMatchObject({ hull: 'CVN-85', cap: 'STRIKE' });
  });

  it('Suez closure breaks the oiler but not the Red Sea escort, which absorbs DDG-181', () => {
    const suez = buildFleet(['suez']);
    expect(mission(suez, 'csg14').status).toBe('N');
    expect(mission(suez, 'guard').status).toBe('Y');
    expect(mission(suez, 'guard').reqs[0].absorbed.map((c) => c.hull)).toContain('DDG-181');
  });

  it('typhoon at Guam closes Apra and breaks KEEN EDGE and PACIFIC MERCY', () => {
    const t = buildFleet(['typhoon']);
    expect(mission(t, 'keen').status).toBe('N');
    expect(mission(t, 'hadr').status).toBe('N');
  });

  it('NSIPS outage flags rejoin dates stale (Q) without changing any mission', () => {
    const n = buildFleet(['nsips']);
    expect(status(n)).toEqual(status(base));
    expect(n.ships.find((s) => s.spec.hull === 'DDG-174')?.status).toBe('Q');
  });

  it('routine resupply is never touched by the curated disruptions', () => {
    const all = buildFleet(DISRUPTIONS.map((d) => d.id));
    expect(all.packages.filter((p) => p.routine && p.hits.length)).toHaveLength(0);
  });
});
