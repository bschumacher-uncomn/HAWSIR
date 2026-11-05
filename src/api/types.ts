/**
 * The web app's view of mission-api: the API's contract, plus the names the
 * screens have always used for them.
 */
export type * from '@contract/contract';
import type {
  CapabilityView, EngineView, EventView, LeverView, MissionView, NodeState, ViewNode,
} from '@contract/contract';

export type Scenario = MissionView;
export type NodeDef = ViewNode;
export type NodeResult = NodeState;
export type CapabilityResult = CapabilityView;
export type EngineResult = EngineView;
export type ChangeEvent = EventView;
export type Lever = LeverView;
export type NodeMap = Record<string, ViewNode>;
