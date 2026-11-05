/**
 * The one place the API reaches into the engine. In the repo the engine sits
 * beside this package (HAWSIR/mission-engine); the bundler inlines it, so the
 * container image carries no engine source tree.
 */
export * from '../../mission-engine/src/index';
export { contentOf, knownAt, verifyFactChain } from '../../mission-engine/src/data/store';
export { coneOf, downstreamOf, slackFor, consequenceCurve, findCliffs } from '../../mission-engine/src/core/analysis';
export { toMap } from '../../mission-engine/src/core/compute';
export { leavesOf } from '../../mission-engine/src/core/attribution';
export { explainRequirement, flagText, relabel } from '../../mission-engine/src/core/explain';
export { contains, covering, firstFrom } from '../../mission-engine/src/core/intervals';
export { mulberry32 } from '../../mission-engine/src/core/prng';
export type { AuthoredModel } from '../../mission-engine/src/packs/authored';
export { MISSIONS, missionById, type MissionDef } from '../../mission-engine/scenarios/index';
export type { MissionDisplay, ScenarioEvent } from '../../mission-engine/scenarios/display';
export { buildFleet, fleetCatalog, type FleetPicture, type FleetCatalog } from '../../mission-engine/scenarios/fleet/model';
