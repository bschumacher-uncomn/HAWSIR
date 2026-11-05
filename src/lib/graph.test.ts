import { describe, expect, it } from 'vitest';
import type { NodeMap, Scenario, ViewNode } from '@/api/types';
import { viewTimeFor } from '@/state/engine';
import { fmtMargin, fmtT } from './time';
import { affectedCapabilities, upstreamCone } from './graph';

const node = (id: string, kind: ViewNode['kind'], deps: string[] = [], extra: Partial<ViewNode> = {}): ViewNode => ({
  id, kind, engineKind: kind === 'capability' ? 'requirement' : kind === 'input' ? 'event' : 'task', label: id, domain: 'maintenance', deps, sources: [], flags: [], shiftable: false, ...extra,
});

describe('presentation helpers', () => {
  const nodes: NodeMap = {
    part: node('part', 'input'),
    crew: node('crew', 'person'),
    fix: node('fix', 'task', ['part'], { crew: { pool: ['crew'], k: 1, label: 'tech' } }),
    cap: node('cap', 'capability', ['fix']),
    other: node('other', 'capability', ['part']),
  };

  it('walks deps and crew pools upstream, and finds the capabilities a node feeds', () => {
    expect([...upstreamCone(nodes, 'cap')].sort()).toEqual(['cap', 'crew', 'fix', 'part']);
    expect(affectedCapabilities(nodes, 'part').sort()).toEqual(['cap', 'other']);
    expect(affectedCapabilities(nodes, 'crew')).toEqual(['cap']);
  });

  it('labels unbounded margins in words, never as a symbol or a division error', () => {
    expect(fmtMargin(Infinity)).toBe('NO LIMIT');
    expect(fmtMargin(-Infinity)).toBe('NEVER');
    expect(fmtMargin(192, 'atLeast')).toBe('≥ 8d 0h');
    expect(fmtMargin(106)).toBe('4d 10h');
  });

  it('fetches pictures on a coarse step, but exactly at a report', () => {
    const s = { timeScale: 'days', dDay: 21, epochUtc: 0, horizon: [0, 700], events: [{ t: 10.5 }] } as unknown as Scenario;
    expect(viewTimeFor(s, 9.9)).toBe(9);
    expect(viewTimeFor(s, 10.7)).toBe(10.5);
    expect(viewTimeFor(s, 11.2)).toBe(11);
    expect(fmtT(s, (21 - 5) * 24 + 22)).toBe('D-5 2200');
  });
});
