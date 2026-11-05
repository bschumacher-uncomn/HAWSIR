import type { DomainPack } from '../pack';
import { buildNaval } from './build';
import { NAVAL_TABLES } from './factors';
import { NAVAL_ATTRIBUTES, type NavalModel } from './model';
import { NAVAL_ROUTINES } from './routines';

export const navalPack: DomainPack<NavalModel> = {
  id: 'naval',
  version: '0.1.0',
  title: 'Naval readiness (strike group, CLF, maintenance, C2)',
  dependsOn: ['airlift'],
  attributes: NAVAL_ATTRIBUTES,
  tables: NAVAL_TABLES,
  routines: NAVAL_ROUTINES,
  build: buildNaval,
};

export * from './model';
export * from './factors';
export { buildNaval } from './build';
