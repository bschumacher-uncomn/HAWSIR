import { describe, expect, it } from 'vitest';
import { DISRUPTIONS } from '../scenarios/fleet/data';
import { buildFleet, type FleetPicture } from '../scenarios/fleet/model';

const status = (p: FleetPicture) => Object.fromEntries(p.missions.map((m) => [m.spec.id, m.status]));
const mission = (p: FleetPicture, id: string) => p.missions.find((m) => m.spec.id === id)!;

describe('fleet lab on the mission engine', () => {
  const base = buildFleet([]);

  it('rolls every hull into its missions, with every package timed by the engine', () => {
    expect(base.ships).toHaveLength(38);
    expect(base.missions).toHaveLength(12);
    expect(base.packages.length).toBeGreaterThanOrEqual(140);
    expect(base.packages.every((p) => Number.isFinite(p.slack) || !p.recoverable || p.slack === Infinity)).toBe(true);
    expect(status(base)).toEqual({
      atlas: 'Q', vigil: 'Q', csg14: 'Q', arg: 'Q', guard: 'Y', mcm: 'Q', sentry: 'Y', keen: 'Y', hadr: 'Q', south: 'Y', comptuex: 'Q', homeland: 'Y',
    });
  });

  it('is deterministic', () => {
    const again = buildFleet([]);
    expect(again.missions.map((m) => m.margin)).toEqual(base.missions.map((m) => m.margin));
    expect(again.packages.map((p) => p.slack)).toEqual(base.packages.map((p) => p.slack));
  });

  it('runs DDG-170 on the full ATLAS SHIELD thread; redundancy absorbs DDG-173', () => {
    const atlas = mission(base, 'atlas');
    expect(base.ships.find((s) => s.spec.hull === 'DDG-170')!.caps.map((c) => c.cap)).toEqual(expect.arrayContaining(['AMD', 'MOB', 'C5I']));
    expect(atlas.controlling?.hull).toBe('DDG-170');
    expect(atlas.reqs[0].absorbed.map((c) => c.hull)).toEqual(['DDG-173']);
  });

  it('AMC stand-down breaks five missions; CSG-14 is then controlled by the carrier air wing', () => {
    const amc = buildFleet(['amc']);
    const flipped = amc.missions.filter((m) => m.status !== status(base)[m.spec.id]).map((m) => m.spec.id);
    expect(flipped.sort()).toEqual(['arg', 'csg14', 'keen', 'mcm', 'vigil']);
    expect(mission(amc, 'csg14').controlling).toMatchObject({ hull: 'CVN-85', cap: 'STRIKE' });
  });

  it('Suez closure breaks the oiler but not the Red Sea escort', () => {
    const suez = buildFleet(['suez']);
    expect(mission(suez, 'csg14').status).toBe('N');
    expect(mission(suez, 'guard').status).not.toBe('N');
  });

  it('typhoon at Guam closes Apra and breaks KEEN EDGE and PACIFIC MERCY', () => {
    const t = buildFleet(['typhoon']);
    expect(mission(t, 'keen').status).toBe('N');
    expect(mission(t, 'hadr').status).toBe('N');
  });

  it('NSIPS outage flags rejoin dates stale without moving any time', () => {
    const n = buildFleet(['nsips']);
    expect(n.missions.map((m) => m.margin)).toEqual(base.missions.map((m) => m.margin));
    expect(n.ships.find((s) => s.spec.hull === 'DDG-174')?.packages.some((p) => p.hits.includes('nsips'))).toBe(true);
  });

  it('routine resupply is never touched by the curated disruptions', () => {
    const all = buildFleet(DISRUPTIONS.map((d) => d.id));
    expect(all.packages.filter((p) => p.routine && p.hits.length)).toHaveLength(0);
  });
});
