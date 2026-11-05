import type { ClockState } from '@contract/contract';
import { api, ApiError } from './client';

/**
 * The watch is driven from the screen: the presenter plays, pauses and scrubs
 * here, and the API's mission clock follows. Reports are delivered to the
 * node's store when its clock passes them, so before showing a time ahead of
 * the clock we move the clock forward. Looking back needs no move (the store
 * answers "as of" any earlier time). Moves are queued per mission so two views
 * can never race the clock backwards.
 */
interface ClockSync {
  now: number;
  chain: Promise<unknown>;
  /** False when the node runs in operational mode (wall-clock time; no seeking). */
  movable: boolean;
}

const clocks = new Map<string, ClockSync>();

function sync(mission: string): ClockSync {
  let c = clocks.get(mission);
  if (!c) {
    c = { now: NaN, chain: Promise.resolve(), movable: true };
    c.chain = api.get<ClockState>(`/m/${mission}/clock`).then((s) => (c!.now = s.t)).catch(() => undefined);
    clocks.set(mission, c);
  }
  return c;
}

function enqueue<T>(c: ClockSync, fn: () => Promise<T>): Promise<T> {
  const run = c.chain.then(fn, fn);
  c.chain = run.catch(() => undefined);
  return run;
}

async function seek(mission: string, c: ClockSync, t: number): Promise<void> {
  try {
    const s = await api.post<ClockState>(`/m/${mission}/clock`, { action: 'seek', t });
    c.now = s.t;
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) c.movable = false;
    else throw e;
  }
}

/** Make sure the node has received everything up to `t` (moves the clock forward only). */
export function ensureAt(mission: string, t: number): Promise<void> {
  const c = sync(mission);
  return enqueue(c, async () => {
    if (c.movable && !(t <= c.now + 1e-9)) await seek(mission, c, t);
  });
}

/** Put the clock exactly at `t` (before recording a decision at the time on screen). */
export function setClock(mission: string, t: number): Promise<void> {
  const c = sync(mission);
  return enqueue(c, async () => {
    if (c.movable && Math.abs(t - c.now) > 1e-9) await seek(mission, c, t);
  });
}

/** Forget what we know about a mission's clock (after a reset). */
export function forgetClock(mission: string): void {
  clocks.delete(mission);
}
