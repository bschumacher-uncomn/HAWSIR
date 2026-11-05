/**
 * The demo clock. Scenario time advances from (t0, wall0) at `speed` scenario
 * hours per real hour. The state is absolute, so two nodes given the same state
 * show the same time without talking to each other.
 */
export interface ClockData {
  t0: number;
  wall0: number;
  playing: boolean;
  speed: number;
}

export class Clock {
  constructor(public data: ClockData, readonly horizon: [number, number]) {}

  now(wall = Date.now()): number {
    const d = this.data;
    const t = d.playing ? d.t0 + ((wall - d.wall0) / 3_600_000) * d.speed : d.t0;
    return Math.min(this.horizon[1], Math.max(this.horizon[0], t));
  }

  play(wall = Date.now()): void {
    this.data = { ...this.data, t0: this.now(wall), wall0: wall, playing: true };
  }

  pause(wall = Date.now()): void {
    this.data = { ...this.data, t0: this.now(wall), wall0: wall, playing: false };
  }

  seek(t: number, wall = Date.now()): void {
    this.data = { ...this.data, t0: Math.min(this.horizon[1], Math.max(this.horizon[0], t)), wall0: wall };
  }

  setSpeed(speed: number, wall = Date.now()): void {
    this.data = { ...this.data, t0: this.now(wall), wall0: wall, speed: Math.max(1, Math.min(36_000, speed)) };
  }

  atEnd(wall = Date.now()): boolean {
    return this.now(wall) >= this.horizon[1] - 1e-9;
  }
}
