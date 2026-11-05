/**
 * A three-leg C-17 movement (synthetic), the kind of mission AMPLIFI plans,
 * running on the same engine through the airlift pack. Shows that checklist
 * verdicts and a time margin with a controlling constraint come from one graph.
 */
import type { AirliftModel } from '../src/packs/airlift';
import type { FactInput } from '../src/data/store';

export const c17Model: AirliftModel = {
  id: 'reach-417',
  name: 'REACH 417 (C-17A, 3 legs)',
  aircraft: 'C-17A',
  legs: [
    { id: 'leg1', from: 'KDOV', to: 'LERT', nm: 3150, groundHours: 0 },
    { id: 'leg2', from: 'LERT', to: 'OKAS', nm: 2390, groundHours: 3 },
    { id: 'leg3', from: 'OKAS', to: 'FJDG', nm: 2350, groundHours: 3 },
  ],
  cargoLb: 90000,
  loadAt: 2,
  requiredDeliveryAt: 30,
  reserveFactor: 1.1,
  horizon: [0, 72],
};

export function c17Facts(): FactInput[] {
  return [
    { entity: 'reach-417', attr: 'airlift.cargo_lb', value: 90000, observedAt: 0, recordedAt: 0, recordedBy: 'planner', source: { system: 'GDSS', recordId: 'R417', kind: 'synthetic' } },
    { entity: 'reach-417', attr: 'airlift.load_ready_at', value: 2, observedAt: 0, recordedAt: 0, recordedBy: 'planner', source: { system: 'GATES', recordId: 'R417-L', kind: 'synthetic' } },
  ];
}
