import express, { type NextFunction, type Request, type Response } from 'express';
import brand from '../../brand.json';
import { actorFrom } from './auth';
import { buildFleet, canonical, fleetCatalog } from './engine';
import { wireReplacer } from './json';
import { HttpError, type ManualFactInput } from './mission';
import { narrate, narrateStats } from './narrate';
import type { NodeRuntime } from './node';
import { receivePush, servePull, SHARE_POLICY } from './sync';
import type { DecisionRequest, HealthView, MissionSummary, NarrateRequest, WhatIfRequest } from './views/contract';
import { MissionViews } from './views/service';

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;

/**
 * HTTP surface. The browser only ever sees these view models; it cannot read
 * the database, the raw graph or another node's logs except through them, and
 * every write is a manual fact or a decision attributed to the caller.
 */
export function createServer(node: NodeRuntime): express.Express {
  const app = express();
  const views = new Map([...node.missions.values()].map((m) => [m.id, new MissionViews(m)]));
  const fleetCache = new Map<string, ReturnType<typeof buildFleet>>();
  app.set('json replacer', wireReplacer);
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '4mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .then((out) => {
        if (out !== undefined && !res.headersSent) res.json(out);
      })
      .catch(next);
  };
  const mission = (req: Request) => node.mission(req.params.mission);
  const viewsOf = (req: Request) => views.get(mission(req).id)!;
  const at = (req: Request) => mission(req).parseAt(req.query.at ?? req.body?.at);
  const requireDemo = () => {
    if (!node.cfg.demo) throw new HttpError(403, 'demo controls are disabled on this node');
  };
  const syncAuth = (req: Request) => {
    const token = process.env.SYNC_TOKEN;
    if (token && req.header('x-sync-token') !== token) throw new HttpError(401, 'sync token required');
  };
  const syncMission = (req: Request) => node.mission(String(req.query.mission ?? ''));

  /** Demo control fans out to the other simulated nodes (not the simulated data link). */
  const fanOut = async (req: Request, path: string, body: unknown) => {
    if (req.header('x-demo-forwarded')) return [];
    return Promise.all(node.cfg.demoPeers.map(async (peer) => {
      try {
        const r = await fetch(`${peer}${path}`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-forwarded': '1' }, body: JSON.stringify(body), signal: AbortSignal.timeout(4000),
        });
        return { peer, ok: r.ok };
      } catch (e) {
        return { peer, ok: false, error: (e as Error).message };
      }
    }));
  };

  /* ---------------------------------------------------------------- node */

  app.get('/api/health', h(async (): Promise<HealthView> => {
    let db = true;
    try {
      await node.pool.query('select 1');
    } catch {
      db = false;
    }
    const missions: HealthView['missions'] = {};
    let ok = db;
    for (const m of node.missions.values()) {
      const facts = m.log.verify();
      const decisions = m.decisions.verify();
      missions[m.id] = { facts, decisions, storedRowMismatches: m.integrity.factMismatches };
      ok &&= facts.ok && decisions.ok && !m.integrity.factMismatches.length;
    }
    return { ok, node: node.info, db, missions, llm: { configured: !!node.cfg.llm, model: node.cfg.llm?.model } };
  }));

  app.get('/api/metrics', (_req, res) => {
    const lines = [
      `# TYPE ${brand.slug}_narrative_total counter`,
      ...Object.entries(narrateStats).map(([k, v]) => `${brand.slug}_narrative_total{result="${k}"} ${v}`),
      `# TYPE ${brand.slug}_stream_clients gauge`,
      `${brand.slug}_stream_clients ${node.bus.size()}`,
      `# TYPE ${brand.slug}_facts gauge`,
      ...[...node.missions.values()].map((m) => `${brand.slug}_facts{mission="${m.id}"} ${m.log.size()}`),
      `# TYPE ${brand.slug}_decisions gauge`,
      ...[...node.missions.values()].map((m) => `${brand.slug}_decisions{mission="${m.id}"} ${m.decisions.all().length}`),
    ];
    res.type('text/plain').send(`${lines.join('\n')}\n`);
  });

  app.get('/api/missions', h((req) => ({
    node: node.info,
    actor: actorFrom(req, node.cfg),
    demo: node.cfg.demo,
    missions: [...node.missions.values()].map((m): MissionSummary => ({ id: m.id, short: m.def.display.short, name: m.def.display.name, tagline: m.def.display.tagline })),
    policy: SHARE_POLICY.map((p) => ({ id: p.id, text: p.text })),
  })));

  app.get('/api/stream', (req, res) => {
    node.bus.add(res, { type: 'hello', node: node.info, missions: [...node.missions.keys()] });
    req.on('close', () => res.end());
  });

  app.post('/api/link', h(async (req) => {
    requireDemo();
    const up = Boolean(req.body?.up);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 200) : undefined;
    if (node.cfg.nodeKind === 'ship') await node.setLink(up, reason, Math.max(...[...node.missions.values()].map((m) => m.now())));
    const forwarded = await fanOut(req, '/api/link', { up, reason });
    return { link: node.linkState(), forwarded };
  }));

  app.post('/api/narrate', h((req) => narrate(node.cfg, (req.body ?? {}) as NarrateRequest)));

  /* -------------------------------------------------------------- mission */

  app.get('/api/m/:mission', h((req) => viewsOf(req).missionView()));
  app.get('/api/m/:mission/clock', h((req) => mission(req).clockState()));
  app.post('/api/m/:mission/clock', h(async (req) => {
    requireDemo();
    const m = mission(req);
    const clock = await m.clockCommand(req.body ?? {});
    const forwarded = await fanOut(req, `/api/m/${m.id}/clock`, { action: 'set', data: m.clock.data });
    return { ...clock, forwarded };
  }));
  app.post('/api/m/:mission/reset', h(async (req) => {
    requireDemo();
    const m = mission(req);
    await m.reset();
    const forwarded = await fanOut(req, `/api/m/${m.id}/reset`, {});
    return { ok: true, clock: m.clockState(), forwarded };
  }));

  app.get('/api/m/:mission/snapshot', h((req) => viewsOf(req).snapshot(at(req))));
  app.get('/api/m/:mission/analysis/:cap', h((req) => viewsOf(req).capAnalysis(at(req), req.params.cap)));
  app.get('/api/m/:mission/nodes/:node', h((req) => viewsOf(req).nodeAnalysis(at(req), req.params.node, String(req.query.cap ?? ''))));
  app.post('/api/m/:mission/whatif', h((req) => viewsOf(req).whatIf(at(req), ((req.body ?? {}) as WhatIfRequest).shifts ?? {})));
  app.get('/api/m/:mission/slip', h((req) => {
    const seed = Number(req.query.seed ?? Date.now() % 1e9);
    if (!Number.isFinite(seed)) throw new HttpError(400, 'seed must be a number');
    return viewsOf(req).slipChallenge(at(req), seed, req.query.cap ? String(req.query.cap) : undefined);
  }));

  app.post('/api/m/:mission/decisions', h(async (req, res) => {
    const d = await mission(req).decide((req.body ?? {}) as DecisionRequest, actorFrom(req, node.cfg));
    res.status(201);
    return d;
  }));
  app.post('/api/m/:mission/facts', h(async (req, res) => {
    const f = await mission(req).addManualFact((req.body ?? {}) as ManualFactInput, actorFrom(req, node.cfg));
    res.status(201);
    return f;
  }));

  app.get('/api/m/:mission/audit', h((req) => viewsOf(req).audit()));
  app.get('/api/m/:mission/audit/export', h((req, res) => {
    const m = mission(req);
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Disposition', `attachment; filename="${brand.slug}-${m.id}-${node.cfg.nodeId}-audit.jsonl"`);
    const lines = [
      canonical({ type: 'header', product: brand.name, node: node.info, mission: m.id, exportedAt: new Date().toISOString(), factsHead: m.log.head(), decisionsHead: m.decisions.head(), packs: m.reg.versions() }),
      ...m.log.all().map((f) => canonical({ type: 'fact', ...f })),
      ...m.decisions.all().map((d) => canonical({ type: 'decision', ...d })),
    ];
    res.send(lines.join('\n'));
  }));

  /* ---------------------------------------------------------------- fleet */

  app.get('/api/fleet/catalog', h(() => fleetCatalog()));
  app.get('/api/fleet', h((req) => {
    const known = new Set(fleetCatalog().disruptions.map((d) => d.id));
    const active = String(req.query.active ?? '').split(',').filter((x) => known.has(x)).sort();
    const k = active.join(',');
    let pic = fleetCache.get(k);
    if (!pic) {
      pic = buildFleet(active);
      fleetCache.set(k, pic);
      if (fleetCache.size > 64) fleetCache.delete(fleetCache.keys().next().value!);
    }
    return pic;
  }));

  /* ---------------------------------------------------------------- sync */

  app.post('/api/sync/push', h((req) => {
    syncAuth(req);
    return receivePush(syncMission(req), req.body);
  }));
  app.get('/api/sync/pull', h((req) => {
    syncAuth(req);
    return servePull(syncMission(req), req.query as Record<string, string>);
  }));
  app.get('/api/sync/status', h(() => ({
    node: node.info, link: node.linkState(),
    missions: Object.fromEntries([...node.missions.values()].map((m) => [m.id, { pendingPush: m.syncInfo.pending, lastSync: m.syncInfo.last, peers: m.peersView() }])),
  })));

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'no such endpoint')));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : (err as { type?: string }).type === 'entity.parse.failed' ? 400 : 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 && !(err instanceof HttpError) ? 'internal error' : (err as Error).message });
  });
  return app;
}
