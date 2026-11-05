import { FactLog } from '../src/data/store';
import { airliftPack } from '../src/packs/airlift';
import { navalPack } from '../src/packs/naval';
import { PackRegistry } from '../src/packs/pack';
import { MissionSession } from '../src/session';
import type { NavalModel } from '../src/packs/naval/model';
import type { AirliftModel } from '../src/packs/airlift';
import { steelTideFacts, steelTideModel } from './steel-tide';
import { c17Facts, c17Model } from './airlift-c17';

export function steelTideSession(origin = 'ship'): MissionSession<NavalModel> {
  const reg = new PackRegistry().register(airliftPack).register(navalPack);
  const log = new FactLog(reg.attrs, origin);
  log.appendMany(steelTideFacts());
  return new MissionSession<NavalModel>({ packs: [airliftPack, navalPack], main: 'naval', model: steelTideModel, log });
}

export function c17Session(): MissionSession<AirliftModel> {
  const reg = new PackRegistry().register(airliftPack);
  const log = new FactLog(reg.attrs, 'planner');
  log.appendMany(c17Facts());
  return new MissionSession<AirliftModel>({ packs: [airliftPack], main: 'airlift', model: c17Model, log });
}

export { steelTideModel, steelTideFacts, c17Model, c17Facts };
