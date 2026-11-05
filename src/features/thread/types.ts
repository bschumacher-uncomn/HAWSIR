/** A mission thread: the dependency graph laid out as lanes and steps for people to follow. */
export interface ThreadLane {
  id: string;
  label: string;
  sub?: string;
  color: string;
}

export type ThreadStepKind = 'start' | 'task' | 'gate' | 'decision' | 'end' | 'branch';

export interface ThreadStep {
  id: string;
  kind: ThreadStepKind;
  label: string;
  lane: string;
  col: number;
  /** Engine node that times this step (start/ready/wait). */
  node?: string;
  /** Performer callsign carried on the token while the step runs. */
  actor?: string;
  /** Resource nodes (inputs, people) shown as status chips. */
  needs?: string[];
  note?: string;
}

export interface ThreadLink {
  from: string;
  to: string;
  /** What travels on the handoff (data product, aircraft, report). */
  cargo?: string;
  branch?: 'yes' | 'no';
}

export interface ThreadSpec {
  name: string;
  lanes: ThreadLane[];
  steps: ThreadStep[];
  links: ThreadLink[];
  /** One-line point the thread makes. */
  thesis?: string;
}
