import brand from '../../brand.json';
import { loadConfig } from './config';
import { migrate, openPool } from './db';
import { NodeRuntime } from './node';
import { createServer } from './server';
import { SyncClient } from './sync';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const pool = await openPool(cfg.databaseUrl, cfg.createDb);
  const ran = await migrate(pool);
  if (ran.length) console.log(`migrations applied: ${ran.join(', ')}`);
  const node = new NodeRuntime(cfg, pool);
  await node.start();
  if (!cfg.demo) {
    // operational mode: scenario time is wall-clock time since each mission's epoch
    for (const m of node.missions.values()) {
      await m.clockCommand({ action: 'set', data: { t0: (Date.now() - m.frame.epochUtc) / 3_600_000, wall0: Date.now(), playing: true, speed: 1 } });
    }
  }
  let sync: SyncClient | undefined;
  if (cfg.nodeKind === 'ship' && cfg.peerUrl) {
    sync = new SyncClient(node, cfg.peerUrl.replace(/\/$/, ''), process.env.SYNC_TOKEN);
    sync.start(cfg.syncIntervalMs);
  }
  const app = createServer(node);
  const server = app.listen(cfg.port, () => {
    const ms = [...node.missions.values()].map((m) => `${m.id} (${m.log.size()} facts, ${m.decisions.all().length} decisions)`).join('; ');
    console.log(`${brand.name} mission-api ${cfg.nodeId} (${cfg.nodeKind}${cfg.nodeShip ? ` ${cfg.nodeShip}` : ''}) on :${cfg.port}; injects=${cfg.injectMode}${cfg.peerUrl ? `; peer ${cfg.peerUrl}` : ''}; llm=${cfg.llm ? cfg.llm.model : 'off'}; ${ms}`);
  });
  const shutdown = () => {
    console.log('shutting down');
    sync?.stop();
    node.stop();
    server.close(() => void pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
