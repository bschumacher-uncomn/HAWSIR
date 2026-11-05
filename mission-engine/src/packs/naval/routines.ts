import { interpolate } from '../../core/provenance';
import type { RoutineDef } from '../../core/routines';
import { C, CLF, ENDURANCE, UMMIPS_PD } from './factors';

const enduranceRows = ENDURANCE.rows;
const clfRows = CLF.rows;
const pdRows = UMMIPS_PD.rows as { fad: string; A: number; B: number; C: number }[];

export const NAVAL_ROUTINES: RoutineDef[] = [
  {
    id: 'naval.burnPctPerHour',
    title: 'Fuel burn rate (% of load per hour) by class and speed',
    description: 'Interpolates GAO/NSIAD-98-1 Table III.3 daily % of load and divides by 24. Below 18 kt the 18 kt value is used (conservative) and flagged.',
    kind: 'value',
    inputs: { cls: { type: 'string' }, kt: { type: 'number', unit: 'kt', monotone: 'increasing' } },
    output: { unit: '%/h' },
    tables: ['naval.endurance'],
    citations: ENDURANCE.citations,
    fn: ({ cls, kt }) => {
      const pts = enduranceRows.filter((r) => r.cls === cls).map((r) => ({ x: r.kt, y: r.pctPerDay }));
      if (!pts.length) return { value: null, detail: `no endurance data for class ${cls}` };
      const { y, clamped } = interpolate(pts, kt);
      return { value: y / 24, unit: '%/h', binding: ['kt'], extrapolated: clamped, detail: `${cls} at ${kt} kt burns ${y.toFixed(1)}%/day = ${(y / 24).toFixed(3)}%/h${clamped ? ' (outside table, clamped)' : ''}` };
    },
    tests: [
      { name: 'DDG-51 at 18 kt', inputs: { cls: 'DDG-51', kt: 18 }, expect: { value: 10 / 24 } },
      { name: 'DDG-51 at 26 kt', inputs: { cls: 'DDG-51', kt: 26 }, expect: { value: 18 / 24 } },
      { name: 'CG-47 at 24 kt (interpolated)', inputs: { cls: 'CG-47', kt: 24 }, expect: { value: 11.5 / 24 } },
    ],
  },
  {
    id: 'naval.transitHours',
    title: 'Transit time',
    description: 'Distance divided by speed of advance in nm/day, in hours.',
    kind: 'value',
    inputs: { nm: { type: 'number', unit: 'nm', monotone: 'increasing' }, nmPerDay: { type: 'number', unit: 'nm/day', monotone: 'decreasing' } },
    output: { unit: 'h' },
    tables: ['naval.clf'],
    citations: CLF.citations,
    fn: ({ nm, nmPerDay }) => ({ value: (nm / nmPerDay) * 24, unit: 'h', binding: ['nm', 'nmPerDay'], detail: `${nm.toLocaleString('en-US')} nm at ${nmPerDay} nm/day = ${((nm / nmPerDay) * 24).toFixed(1)} h` }),
    tests: [{ name: 'T-AO 384 nm/day over 600 nm', inputs: { nm: 600, nmPerDay: 384 }, expect: { value: 37.5 } }],
  },
  {
    id: 'naval.alongsideHours',
    title: 'Time alongside for an UNREP receiver',
    description: 'Class base time × 1.5 when only one hose is rigged (NWP 4-01.4 §1.6.1: up to +50% for small escorts).',
    kind: 'value',
    inputs: { baseHours: { type: 'number', unit: 'h', monotone: 'increasing' }, oneHose: { type: 'boolean' } },
    output: { unit: 'h' },
    tables: ['naval.unrep'],
    citations: [C.NWP_4_01_4],
    fn: ({ baseHours, oneHose }) => ({ value: baseHours * (oneHose ? 1.5 : 1), unit: 'h', detail: `${baseHours} h alongside${oneHose ? ' × 1.5 (one hose)' : ''}` }),
    tests: [
      { name: 'two hoses', inputs: { baseHours: 2, oneHose: false }, expect: { value: 2 } },
      { name: 'one hose', inputs: { baseHours: 2, oneHose: true }, expect: { value: 3 } },
    ],
  },
  {
    id: 'naval.requisitionPriority',
    title: 'Requisition priority designator',
    description: 'UMMIPS: Force/Activity Designator × Urgency of Need → priority designator 01–15.',
    kind: 'value',
    inputs: { fad: { type: 'string' }, und: { type: 'string' } },
    output: { unit: 'PD' },
    tables: ['naval.ummips'],
    citations: UMMIPS_PD.citations,
    fn: ({ fad, und }) => {
      const row = pdRows.find((r) => r.fad === fad);
      const pd = row ? (row as Record<string, number | string>)[und] : undefined;
      if (typeof pd !== 'number') return { value: null, detail: `no priority for F/AD ${fad}, UND ${und}` };
      return { value: pd, unit: 'PD', detail: `F/AD ${fad} + UND ${und} → PD ${String(pd).padStart(2, '0')}` };
    },
    tests: [
      { name: 'F/AD II routine (sourced example)', inputs: { fad: 'II', und: 'C' }, expect: { value: 12 } },
      { name: 'F/AD II CASREP urgency', inputs: { fad: 'II', und: 'A' }, expect: { value: 2 } },
    ],
  },
  {
    id: 'naval.clfSpeed',
    title: 'CLF ship speed of advance',
    description: 'nm/day for a CLF class (Brown & Carlyle 2008, p. 803).',
    kind: 'value',
    inputs: { cls: { type: 'string' } },
    output: { unit: 'nm/day' },
    tables: ['naval.clf'],
    citations: CLF.citations,
    fn: ({ cls }) => {
      const r = clfRows.find((x) => x.cls === cls);
      return r ? { value: r.nmPerDay, unit: 'nm/day', detail: `${cls} transits ${r.nmPerDay} nm/day` } : { value: null, detail: `unknown CLF class ${cls}` };
    },
    tests: [{ name: 'T-AKE', inputs: { cls: 'T-AKE' }, expect: { value: 308 } }],
  },
];
