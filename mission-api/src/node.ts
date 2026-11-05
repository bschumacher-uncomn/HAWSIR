import { EventBus } from './bus';
import type { Config } from './config';
import type { Pool } from './db';
import { MISSIONS, type MissionDef } from './engine';
import { HttpError, MissionRuntime } from './mission';
import * as store from './pgstore';
import type { LinkState, NodeInfo, StreamEvent } from './views/contract';

interface LinkData {
  up: boolean;
  since: number;
  reason?: string;
}

/**
 * One node (a ship or the shore) serving several missions. The node owns what
 * is physical: the database, the data link, the live event stream and the
 * single write queue. Each mission owns its logs, clock and script.
 */
export class NodeRuntime {
  readonly bus = new EventBus();
  readonly missions = new Map<string, MissionRuntime>();
  link: LinkData = { up: true, since: 0 };
  /** Ship: hook the sync client sets so a restored link syncs at once. */
  onLinkUp?: () => void;
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: NodeJS.Timeout;

  constructor(readonly cfg: Config, readonly pool: Pool, defs: MissionDef[] = MISSIONS) {
    for (const d of defs.filter((m) => !cfg.missions.length || cfg.missions.includes(m.id))) this.missions.set(d.id, new MissionRuntime(this, d));
    if (!this.missions.size) throw new Error(`no missions selected (MISSIONS=${cfg.missions.join(',')}); known: ${defs.map((d) => d.id).join(', ')}`);
  }

  get info(): NodeInfo {
    const ship = this.cfg.nodeShip;
    const name = ship ? [...this.missions.values()].map((m) => m.labels.shipName.get(ship)).find(Boolean) : undefined;
    return {
      id: this.cfg.nodeId, kind: this.cfg.nodeKind, ship,
      label: this.cfg.nodeKind === 'shore' ? 'Shore (fleet logistics / MOC)' : this.cfg.nodeId === 'solo' ? 'Shipboard node (standalone)' : `${name ?? ship} (shipboard node)`,
    };
  }

  mission(id: string): MissionRuntime {
    const m = this.missions.get(id);
    if (!m) throw new HttpError(404, `no mission "${id}" on this node`);
    return m;
  }

  async start(): Promise<void> {
    const info = await store.nodeInfo(this.pool);
    if (info && info.id !== this.cfg.nodeId) throw new Error(`database belongs to node ${info.id}; refusing to start as ${this.cfg.nodeId}`);
    await store.setNodeInfo(this.pool, this.cfg.nodeId, this.cfg.nodeKind, this.cfg.nodeShip);
    this.link = (await store.getState<LinkData>(this.pool, 'node:link')) ?? { up: true, since: 0 };
    for (const m of this.missions.values()) await m.load();
    this.timer = setInterval(() => void this.tick().catch((e) => console.error('tick failed', e)), 250);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.bus.close();
  }

  private async tick(): Promise<void> {
    for (const m of this.missions.values()) {
      await m.deliverDue();
      if (m.clock.data.playing && m.now() >= m.watchEnd - 1e-9) await m.clockCommand({ action: 'pause' });
    }
  }

  serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  emit(e: StreamEvent): void {
    this.bus.emit(e);
  }

  /* ---------------------------------------------------------------- link */

  linkState(m?: MissionRuntime): LinkState {
    return {
      up: this.link.up, since: this.link.since, reason: this.link.reason, peer: this.cfg.peerUrl ? 'shore' : undefined,
      pendingPush: m?.syncInfo.pending ?? 0, lastSync: m?.syncInfo.last,
    };
  }

  async setLink(up: boolean, reason: string | undefined, at: number): Promise<void> {
    await this.serial(() => this.setLinkInner(up, reason ?? (up ? 'Data link restored' : 'Data link lost'), at));
  }

  /** Call only from inside the write queue. */
  async setLinkInner(up: boolean, reason: string, at: number): Promise<void> {
    if (this.link.up === up && this.link.reason === reason) return;
    this.link = { up, since: at, reason };
    await store.setState(this.pool, 'node:link', this.link);
    this.emit({ type: 'link', link: this.linkState() });
    if (up) setTimeout(() => this.onLinkUp?.(), 0);
  }

  async resetAll(): Promise<void> {
    for (const m of this.missions.values()) await m.reset();
    await this.serial(async () => {
      this.link = { up: true, since: 0 };
      await store.setState(this.pool, 'node:link', this.link);
    });
    this.emit({ type: 'link', link: this.linkState() });
  }
}
