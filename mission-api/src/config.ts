import type { Actor } from './views/contract';

export interface Config {
  port: number;
  databaseUrl: string;
  /** Create the database if it does not exist (local development). */
  createDb: boolean;
  nodeId: string;
  nodeKind: 'ship' | 'shore';
  /** Ship hull this node runs on (ship nodes). */
  nodeShip?: string;
  /** Shore API this ship syncs with over the (simulated) data link. */
  peerUrl?: string;
  /** Other nodes that receive demo-control commands (clock, link, reset). Not the data link. */
  demoPeers: string[];
  demo: boolean;
  /** Ships running their own node (their reports do not arrive ashore directly). */
  simShips: string[];
  /** all: every scripted report arrives here; split: reports arrive where they originate (ship or shore). */
  injectMode: 'all' | 'split';
  devActor: Actor;
  /** Trust identity headers set by the mesh (UDS Authservice / Istio). Off unless the API sits behind it. */
  trustIdentityHeaders: boolean;
  syncIntervalMs: number;
  /** Scenario hours per real hour when a mission clock plays on its own (the UI usually drives the watch). */
  startSpeed: number;
  /** Missions this node serves (empty = all). */
  missions: string[];
  /** OpenAI-compatible endpoint for the optional narrative rephrasing (in-cluster model). Unset = template only. */
  llm?: { url: string; model: string; key?: string; timeoutMs: number };
}

function list(v?: string): string[] {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function loadConfig(env = process.env): Config {
  const nodeKind = (env.NODE_KIND === 'shore' ? 'shore' : 'ship') as Config['nodeKind'];
  const nodeShip = nodeKind === 'ship' ? env.NODE_SHIP ?? 'ddgB' : undefined;
  const peerUrl = env.PEER_URL || undefined;
  const demoPeers = list(env.DEMO_PEERS);
  const solo = !peerUrl && !demoPeers.length && env.INJECT_MODE !== 'split';
  const nodeId = env.NODE_ID ?? (solo ? 'solo' : nodeKind === 'shore' ? 'shore' : `ship-${(nodeShip ?? 'x').toLowerCase()}`);
  let devActor: Actor = { id: 'lcdr.torres', role: 'Readiness officer' };
  if (env.DEV_ACTOR) {
    try {
      devActor = JSON.parse(env.DEV_ACTOR);
    } catch {
      devActor = { id: env.DEV_ACTOR, role: 'Readiness officer' };
    }
  }
  return {
    port: Number(env.PORT ?? 8820),
    databaseUrl: env.DATABASE_URL ?? `postgres://postgres:postgres@localhost:5432/mission_${nodeId.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
    createDb: env.DB_CREATE !== '0',
    nodeId,
    nodeKind,
    nodeShip,
    peerUrl,
    demoPeers,
    demo: env.DEMO_MODE !== '0',
    simShips: list(env.SIM_SHIPS ?? 'ddgB'),
    injectMode: (env.INJECT_MODE ?? (peerUrl || demoPeers.length ? 'split' : 'all')) === 'split' ? 'split' : 'all',
    devActor,
    trustIdentityHeaders: env.TRUST_IDENTITY_HEADERS === '1',
    syncIntervalMs: Number(env.SYNC_INTERVAL_MS ?? 2000),
    startSpeed: Number(env.DEMO_SPEED ?? 600),
    missions: list(env.MISSIONS),
    llm: env.LLM_URL ? { url: env.LLM_URL.replace(/\/$/, ''), model: env.LLM_MODEL ?? 'local', key: env.LLM_API_KEY || undefined, timeoutMs: Number(env.LLM_TIMEOUT_MS ?? 6000) } : undefined,
  };
}
