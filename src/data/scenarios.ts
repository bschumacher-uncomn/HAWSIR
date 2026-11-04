import type { Scenario } from '@/engine/types';
import { classic } from './classic';
import { ddg21 } from './ddg21';
import { reload72 } from './reload72';

export const SCENARIOS: Scenario[] = [ddg21, reload72, classic];
export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id) ?? ddg21;
