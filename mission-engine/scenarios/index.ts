import type { FactInput } from '../src/data/store';
import { FactLog } from '../src/data/store';
import { airliftPack } from '../src/packs/airlift';
import { authoredPack, type AuthoredModel } from '../src/packs/authored';
import { navalPack } from '../src/packs/naval';
import { PackRegistry, type DomainPack } from '../src/packs/pack';
import { MissionSession } from '../src/session';
import type { NavalModel } from '../src/packs/naval/model';
import type { AirliftModel } from '../src/packs/airlift';
import type { MissionDisplay, ScenarioEvent } from './display';
import { DELIVERY, steelTideDisplay, steelTideEvents, steelTideFacts, steelTideModel, baselineFacts as steelTideBaseline } from './steel-tide';
import { atlasShieldBaseline, atlasShieldDisplay, atlasShieldEvents, atlasShieldModel } from './atlas-shield';
import { c17Facts, c17Model } from './airlift-c17';

/** Everything needed to run a mission: packs, the model, the facts known at the start, the watch script, and display metadata. */
export interface MissionDef<M = unknown> {
  id: string;
  packs: DomainPack[];
  main: string;
  model: M;
  baseline: () => FactInput[];
  events: () => ScenarioEvent[];
  display: MissionDisplay;
  /** When ship and shore run as separate nodes, each report arrives where it originates. False: every node receives every report. */
  splitDelivery: boolean;
  /** With split delivery: which side each source system reports to (ship-side reports also need an owning ship). */
  delivery?: Record<string, 'ship' | 'shore'>;
}

export const STEEL_TIDE: MissionDef<NavalModel> = {
  id: 'steel-tide', packs: [airliftPack, navalPack], main: 'naval', model: steelTideModel,
  baseline: steelTideBaseline, events: steelTideEvents, display: steelTideDisplay, splitDelivery: true, delivery: DELIVERY,
};

export const ATLAS_SHIELD: MissionDef<AuthoredModel> = {
  id: 'atlas-shield', packs: [authoredPack], main: 'authored', model: atlasShieldModel,
  baseline: atlasShieldBaseline, events: atlasShieldEvents, display: atlasShieldDisplay, splitDelivery: false,
};

export const MISSIONS: MissionDef[] = [ATLAS_SHIELD as MissionDef, STEEL_TIDE as MissionDef];

export function missionById(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}

export function registryFor(def: MissionDef): PackRegistry {
  const reg = new PackRegistry();
  for (const p of def.packs) reg.register(p);
  return reg;
}

/** A session with the baseline and every scripted report already known (tests, CLI). */
export function sessionFor<M>(def: MissionDef<M>, origin = 'local'): MissionSession<M> {
  const log = new FactLog(registryFor(def as MissionDef).attrs, origin);
  log.appendMany(def.baseline());
  for (const e of def.events()) log.appendMany(e.facts);
  return new MissionSession<M>({ packs: def.packs, main: def.main, model: def.model, log });
}

export function steelTideSession(origin = 'ship'): MissionSession<NavalModel> {
  const reg = new PackRegistry().register(airliftPack).register(navalPack);
  const log = new FactLog(reg.attrs, origin);
  log.appendMany(steelTideFacts());
  return new MissionSession<NavalModel>({ packs: [airliftPack, navalPack], main: 'naval', model: steelTideModel, log });
}

export function atlasShieldSession(origin = 'ship'): MissionSession<AuthoredModel> {
  return sessionFor(ATLAS_SHIELD, origin);
}

export function c17Session(): MissionSession<AirliftModel> {
  const reg = new PackRegistry().register(airliftPack);
  const log = new FactLog(reg.attrs, 'planner');
  log.appendMany(c17Facts());
  return new MissionSession<AirliftModel>({ packs: [airliftPack], main: 'airlift', model: c17Model, log });
}

export { steelTideModel, steelTideFacts, c17Model, c17Facts, atlasShieldModel };
export type { MissionDisplay, ScenarioEvent } from './display';
