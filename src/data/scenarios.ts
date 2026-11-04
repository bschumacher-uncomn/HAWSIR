import type { Scenario } from '@/engine/types';
import { classic } from './classic';
import { ddg21 } from './ddg21';

export const SCENARIOS: Scenario[] = [ddg21, classic];
export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id) ?? ddg21;
