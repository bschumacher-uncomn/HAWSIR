import {
  applyPatches, compute, consequenceCurve, DEFAULT_AUTHORITY, downstreamOf, evaluateOptions, findCliffs, knownAt, mcBatch, mulberry32, runMonteCarlo,
  shiftable, slackFor, toMap, tornado, verifyFactChain,
  type Evaluation, type Fact, type Lever, type OptionEval as EngineOption, type Patch, type ScenarioEvent,
} from '../engine';
import { attrLabel, valueText } from '../labels';
import { HttpError, type MissionRuntime } from '../mission';
import type {
  AuditView, CapAnalysis, Cliff, ControllingConstraint, CurvePoint, EngineView, EventImpact, EventView, LeverView, McChunk, McChunkRequest, McChunkTarget,
  McView, MissionView, NodeAnalysis, OptionEval, SensitivityBar, SlackResult, SlipChallenge, Snapshot, ViewNode, WhatIfResult,
} from './contract';
import { fmtT } from './format';
import { capabilityLines, diffCaps, eventLines, type FactChange } from './lines';
import { engineView, viewNodes } from './map';

const MC_RUNS = 400;
const MC_SEED = 1337;
const MC_MAX_RUNS = 10_000;
const MC_MAX_CHUNK = 1_000;

/** Valid what-if shifts as sorted [id, hours] pairs (the order is part of memo keys). */
function cleanShifts(shifts: Record<string, number> | undefined): [string, number][] {
  const clean = Object.entries(shifts ?? {}).filter(([, h]) => typeof h === 'number' && Number.isFinite(h) && Math.abs(h) > 1e-9);
  if (clean.length > 40) throw new HttpError(413, 'at most 40 shifted inputs per what-if');
  for (const [, h] of clean) if (Math.abs(h) > 24 * 60) throw new HttpError(422, 'a shift is limited to 60 days either way');
  return clean.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The evaluated graph with the shiftable inputs among the what-if shifts moved. */
function shifted(ev: Evaluation, clean: [string, number][]) {
  if (!clean.length) return ev.graph;
  const specs = toMap(ev.graph);
  const patches: Patch[] = clean.filter(([id]) => specs[id] && shiftable(specs[id], ev.ctx.now)).map(([id, hours]) => ({ op: 'shift', id, hours }));
  return applyPatches(ev.graph, patches);
}

/**
 * Everything the HAWSIR screens read, computed from one mission's logs. Each
 * view is memoised on the content key of the picture it describes (time, facts
 * known then, decisions made by then), so replaying the watch costs one
 * computation per distinct picture.
 */
export class MissionViews {
  constructor(private readonly m: MissionRuntime) {}

  /* --------------------------------------------------------------- static */

  missionView(): MissionView {
    const m = this.m;
    const d = m.def.display;
    const qMargin = (m.def.model as { qMarginH?: number; qMargin?: number }).qMarginH ?? 24;
    return {
      id: m.id, name: d.name, short: d.short, tagline: d.tagline,
      timeScale: m.frame.timeScale, dDay: m.frame.dDay, hHour: m.frame.hHour, epochUtc: m.frame.epochUtc, tzOffset: d.tzOffset,
      ship: { id: d.ownShip.id, name: d.ownShip.name, hull: d.ownShip.hull, cls: d.ownShip.cls, homeport: d.ownShip.homeport },
      ships: d.ships,
      mission: d.mission,
      watchStart: d.watchStart,
      horizon: m.horizon,
      watchEnd: m.watchEnd,
      phases: d.phases,
      events: this.events().map((e) => this.eventView(e)),
      thresholds: { qMargin, cliff: 2 },
      track: d.tracks[d.ownShip.id] ?? [],
      tracks: d.tracks,
      places: d.places,
      legs: d.legs.map((l) => ({ id: l.id, label: l.label, kind: l.kind, nodeId: l.nodeId, from: l.from, to: l.to, gateId: l.bySlot ? l.nodeId : undefined, byWindow: l.bySlot, ship: l.ship })),
      missionArea: d.missionArea,
      mapView: d.mapView,
      defaultFocus: d.defaultFocus,
      splitDelivery: m.def.splitDelivery,
    };
  }

  /** Reports this node can receive: a data-link event only exists on the ship whose link it is. */
  events(): ScenarioEvent[] {
    const m = this.m;
    return m.events.filter((e) => e.facts.length > 0 || m.script.some((i) => i.eventId === e.id && m.receives(i)));
  }

  eventView(e: ScenarioEvent): EventView {
    const f = e.facts[0];
    const injects = this.m.script.filter((i) => i.eventId === e.id);
    const sides = new Set(injects.map((i) => this.m.arrivesAt(i)));
    return {
      id: e.id, t: e.t, kind: e.kind, severity: e.severity, title: e.title, detail: e.detail, board: e.board, facts: e.facts.length,
      source: f ? { system: f.source.system, recordId: f.source.recordId ?? '', asOf: f.observedAt } : { system: 'DATA-LINK', recordId: e.id, asOf: e.t },
      arrives: sides.size > 1 ? 'both' : sides.has('shore') ? 'shore' : 'ship',
    };
  }

  /* ------------------------------------------------------------- pictures */

  private view(ev: Evaluation): EngineView {
    return this.m.memo('view', `${ev.asOf}|${ev.result.graphHash}|${ev.assumptions.join(',')}`, () => engineView(ev.graph, ev.result, ev.build.focus, this.m.frame));
  }

  private nodes(ev: Evaluation): ViewNode[] {
    return this.m.memo('nodes', `${ev.asOf}|${ev.result.graphHash}`, () => viewNodes(ev.graph, ev.result, this.m.ownShip));
  }

  lever(l: Lever): LeverView {
    return {
      id: l.id, title: l.title, detail: l.detail, category: l.category, authority: l.authority, withinShipAuthority: l.withinUnitAuthority,
      deadline: l.deadline, cost: l.cost, risk: l.risk ? `${l.risk.severity}/${l.risk.probability}: ${l.risk.note}` : 'No declared risk beyond the cost',
      target: l.target, requiresNodes: l.requiresNodes, exclusive: l.exclusive, infeasible: l.infeasible, missingInfo: l.missingInfo,
    };
  }

  snapshot(t: number): Snapshot {
    // the link is live node state outside the memo key; never serve it from cache
    return { ...this.picture(t), link: this.m.node.linkState(this.m) };
  }

  private picture(t: number): Omit<Snapshot, 'link'> {
    const m = this.m;
    return m.memo('snapshot', m.key(t), () => {
      const t0 = performance.now();
      const ev = m.evaluate(t);
      const auth = ev.assumptions.length ? m.evaluateAuthoritative(t) : ev;
      const result = this.view(ev);
      const authResult = auth === ev ? result : this.view(auth);
      const applied = this.events().filter((e) => m.eventKnownAt(e, t) !== undefined).map((e) => e.id);
      const impacts: Record<string, EventImpact> = {};
      for (const id of applied) {
        const imp = this.impact(m.events.find((e) => e.id === id)!, t);
        if (imp) impacts[id] = imp;
      }
      const stop = m.decisions.isStopped(t) ? [...m.decisions.all()].reverse().find((d) => d.kind === 'stop' && d.at <= t + 1e-9) : undefined;
      const known = m.log.all().filter((f) => knownAt(f) <= t + 1e-9);
      const facts = m.log.view(t);
      const legFrom: Record<string, string> = {};
      for (const leg of m.def.display.legs) {
        const ref = /^@([a-z_]+):(.+)$/.exec(leg.from);
        if (!ref) legFrom[leg.id] = leg.from;
        else {
          const v = facts.get<unknown>(ref[2], ref[1]).value;
          if (typeof v === 'string') legFrom[leg.id] = v;
        }
      }
      return {
        mission: m.id, at: t, key: m.key(t), nodes: this.nodes(ev), result, authResult, applied, impacts,
        levers: ev.build.levers.map((l) => this.lever(l)), approved: ev.assumptions, focus: ev.build.focus,
        halted: { stopped: !!stop, note: stop?.note, by: stop?.actor.id },
        counts: { facts: known.length, quarantined: known.filter((f) => f.quarantine).length, decisions: m.decisions.all().filter((d) => d.at <= t + 1e-9).length },
        legFrom,
        computeMs: Math.round((performance.now() - t0) * 10) / 10,
      };
    });
  }

  /**
   * What one report changed, on this node: the picture with every fact known
   * just before it plus the reports scripted ahead of it at the same instant,
   * against the same picture with this report's facts added.
   */
  private impact(e: ScenarioEvent, t: number): EventImpact | undefined {
    const m = this.m;
    const at = m.eventKnownAt(e, t);
    if (at === undefined) return undefined;
    return m.memo('impact', `${e.id}|${m.knowledgeKey(at)}`, () => {
      const mine = new Set(m.eventFacts(e).filter((f) => knownAt(f) <= at + 1e-9).map((f) => f.id));
      const order = m.events.findIndex((x) => x.id === e.id);
      const earlierSameTime = new Set(m.events.slice(0, order).flatMap((x) => m.eventFacts(x).map((f) => f.id)));
      const known = m.log.all().filter((f) => knownAt(f) <= at + 1e-9) as Fact[];
      const beforeFacts = known.filter((f) => !mine.has(f.id) && (knownAt(f) < at - 1e-9 || earlierSameTime.has(f.id)));
      const afterFacts = known.filter((f) => beforeFacts.includes(f) || mine.has(f.id));
      const before = m.sessionOver(beforeFacts).evaluate(at);
      const after = m.sessionOver(afterFacts).evaluate(at);
      const bv = engineView(before.graph, before.result, before.build.focus, m.frame);
      const av = engineView(after.graph, after.result, after.build.focus, m.frame);
      const changed = after.graph.nodes.filter((n) => {
        const b = before.graph.nodes.find((x) => x.id === n.id);
        return !b || JSON.stringify(b) !== JSON.stringify(n);
      }).map((n) => n.id);
      const diff = diffCaps(bv, av, changed);
      const view = m.log.view(at - 1e-6);
      const time = (x: number) => fmtT(m.frame, x);
      const changes: FactChange[] = m.eventFacts(e).filter((f) => mine.has(f.id)).map((f) => {
        const def = m.reg.attrs.get(f.attr);
        const prior = view.get<unknown>(f.entity, f.attr);
        const label = m.labels.label(f.entity);
        const slip = def?.type === 'hours' && typeof f.value === 'number' && typeof prior.value === 'number' && f.attr !== 'duration_h' ? f.value - prior.value : undefined;
        return {
          fact: f, label, attrLabel: attrLabel(f.attr), quarantined: !!f.quarantine,
          before: prior.fact ? valueText(f.attr, def?.type, prior.value, time, def?.unit, (id) => m.labels.label(id)) : undefined,
          after: f.quarantine ? String(f.value) : valueText(f.attr, def?.type, f.value, time, def?.unit, (id) => m.labels.label(id)),
          slip,
        };
      });
      const ev = this.eventView(e);
      const linkNote = e.link ? `${e.link.up ? 'Data link restored' : 'Data link lost'}: ${e.link.reason}. ${e.link.up ? 'Queued reports and decisions sync now.' : 'This node keeps computing on what it holds; new shore reports stop arriving until the link returns.'}` : undefined;
      return { event: ev, diff, lines: eventLines(ev, changes, diff, m.frame, linkNote) };
    });
  }

  /* ------------------------------------------------------------- analysis */

  private mc(ev: Evaluation): McView {
    const m = this.m;
    return m.memo('mc', m.key(ev.asOf), () => {
      const ids = Object.keys(ev.result.requirements);
      const r = runMonteCarlo(ev.graph, ev.ctx, ids, MC_RUNS, MC_SEED);
      const targets: McView['targets'] = {};
      const criticality: McView['criticality'] = {};
      for (const id of ids) {
        const x = r.requirements[id];
        targets[id] = { pMeet: x.pY + x.pQ, pY: x.pY, pQ: x.pQ, pN: x.pN, pUNK: x.pUNK, p10: x.margin.p10, p50: x.margin.p50, p90: x.margin.p90 };
        criticality[id] = x.controlling;
      }
      return { n: r.n, seed: r.seed, targets, criticality, uncertain: r.uncertainNodes };
    });
  }

  private option(o: EngineOption, levers: Map<string, Lever>, codes: Map<string, string>): OptionEval {
    const ctl: ControllingConstraint = { nodeId: '', kind: 'input', label: o.controllingAfter.join(', ') || 'nothing in the horizon', detail: '' };
    return {
      id: o.id, levers: o.levers.map((id) => this.lever(levers.get(id)!)), available: o.available, unavailableReason: o.unavailableReason, targetId: o.target,
      marginBefore: o.marginBefore, marginAfter: o.marginAfter, recovered: o.recovered, statusBefore: o.statusBefore, statusAfter: o.statusAfter,
      controllingAfter: ctl,
      sideEffects: o.sideEffects.map((s) => ({ capId: s.requirement, code: codes.get(s.requirement) ?? s.requirement, delta: s.delta, before: s.before, after: s.after })),
      effective: o.effective, why: o.why.replace(/t=(-?\d+(?:\.\d+)?)/g, (_, x) => fmtT(this.m.frame, Number(x))), authority: o.authority, incomplete: o.incomplete,
    };
  }

  private slackOf(ev: Evaluation, nodeId: string, capId: string): SlackResult {
    const s = slackFor(ev.graph, ev.ctx, nodeId, capId, ev.result);
    let toFailure = s.toFailure;
    let recoverable = true;
    if (s.baseMargin < 0) {
      toFailure = s.baseMargin;
      if (Number.isFinite(s.baseMargin)) {
        const r = compute(applyPatches(ev.graph, [{ op: 'shift', id: nodeId, hours: s.baseMargin - 1 / 60 }]), { ...ev.ctx, hash: false });
        recoverable = (r.requirements[capId]?.margin ?? -Infinity) >= 0;
      } else recoverable = false;
    }
    return { nodeId, targetId: capId, noImpact: s.noImpact, toFailure, recoverable, unbounded: s.noImpact === Infinity };
  }

  capAnalysis(t: number, capId: string): CapAnalysis {
    const m = this.m;
    return m.memo('cap', `${capId}|${m.key(t)}`, () => {
      const ev = m.evaluate(t);
      const view = this.view(ev);
      const cap = view.capabilities.find((c) => c.id === capId);
      if (!cap) throw new HttpError(404, `no capability "${capId}" in the picture at this time`);
      const specs = toMap(ev.graph);
      const shiftables = [...new Set([...cap.chain, ...cap.coCritical])].filter((id) => specs[id] && shiftable(specs[id], ev.ctx.now)).slice(0, 8);
      const slack = shiftables.map((id) => this.slackOf(ev, id, capId)).sort((a, b) => a.toFailure - b.toFailure || a.noImpact - b.noImpact);
      const cliffs: Cliff[] = [];
      for (const id of shiftables.slice(0, 6)) {
        const curve = consequenceCurve(ev.graph, ev.ctx, id, capId, 72, 72);
        const c = findCliffs(curve)[0];
        if (c) cliffs.push({ nodeId: id, targetId: capId, slack: Math.max(0, c.delay - 1), drop: c.extraLoss });
      }
      const nodes = Object.fromEntries(this.nodes(ev).map((n) => [n.id, n]));
      const lines = capabilityLines(cap, { graph: ev.graph, result: ev.result, view, nodes, frame: m.frame, facts: m.log.view(t), slack, cliffs });
      const levers = ev.build.levers.filter((l) => !ev.assumptions.includes(l.id));
      const byId = new Map(levers.map((l) => [l.id, l]));
      const codes = new Map(view.capabilities.map((c) => [c.id, c.code]));
      const evals = levers.length ? evaluateOptions(ev.graph, ev.ctx, ev.result, capId, levers, { pairs: true, authority: ev.build.authority ?? DEFAULT_AUTHORITY }) : [];
      const all = evals.map((o) => this.option(o, byId, codes));
      return { slack, cliffs, lines, options: { singles: all.filter((o) => o.levers.length === 1), combos: all.filter((o) => o.levers.length > 1) }, mc: this.mc(ev) };
    });
  }

  nodeAnalysis(t: number, nodeId: string, capId: string): NodeAnalysis {
    const m = this.m;
    return m.memo('node', `${nodeId}|${capId}|${m.key(t)}`, () => {
      const ev = m.evaluate(t);
      const spec = toMap(ev.graph)[nodeId];
      if (!spec) throw new HttpError(404, `no node "${nodeId}" in the picture at this time`);
      if (!ev.result.requirements[capId]) throw new HttpError(404, `no capability "${capId}" in the picture at this time`);
      const canShift = shiftable(spec, ev.ctx.now);
      const maxH = m.frame.timeScale === 'hours' ? 12 : 168;
      const curve: CurvePoint[] = canShift ? consequenceCurve(ev.graph, ev.ctx, nodeId, capId, maxH, 96).map((p) => ({ delta: p.delay, margin: p.margin })) : [];
      const down = downstreamOf(ev.graph, nodeId);
      return {
        nodeId, targetId: capId, slack: canShift ? this.slackOf(ev, nodeId, capId) : undefined, curve,
        affected: Object.keys(ev.result.requirements).filter((id) => down.has(id)),
      };
    });
  }

  whatIf(t: number, shifts: Record<string, number>): WhatIfResult {
    const m = this.m;
    const clean = cleanShifts(shifts);
    return m.memo('whatif', `${JSON.stringify(clean)}|${m.key(t)}`, () => {
      const t0 = performance.now();
      const ev = m.evaluate(t);
      const g = shifted(ev, clean);
      const r = compute(g, ev.ctx);
      return {
        at: t, nodes: viewNodes(g, r, m.ownShip), result: engineView(g, r, ev.build.focus, m.frame),
        computeMs: Math.round((performance.now() - t0) * 10) / 10,
      };
    });
  }

  /** One chunk of a seeded Monte Carlo over the picture at t (what-if shifts applied). */
  monteCarlo(t: number, req: McChunkRequest): McChunk {
    const m = this.m;
    const seed = Number(req.seed);
    const start = Number(req.start);
    const count = Number(req.count);
    if (!Number.isInteger(seed) || seed < 0 || seed > 2 ** 32 - 1) throw new HttpError(422, 'seed must be an integer in [0, 2^32)');
    if (!Number.isInteger(start) || start < 0 || start >= MC_MAX_RUNS) throw new HttpError(422, `start must be an integer in [0, ${MC_MAX_RUNS})`);
    if (!Number.isInteger(count) || count < 1 || count > MC_MAX_CHUNK || start + count > MC_MAX_RUNS) {
      throw new HttpError(422, `count must be 1–${MC_MAX_CHUNK} and stay within ${MC_MAX_RUNS} runs`);
    }
    const clean = cleanShifts(req.shifts);
    return m.memo('mc-chunk', `${seed}|${start}|${count}|${JSON.stringify(clean)}|${m.key(t)}`, () => {
      const t0 = performance.now();
      const ev = m.evaluate(t);
      const b = mcBatch(shifted(ev, clean), ev.ctx, Object.keys(ev.result.requirements), seed, start, count);
      const targets: McChunk['targets'] = {};
      for (const [id, x] of Object.entries(b.targets)) {
        const o: McChunkTarget = { margins: [], never: 0, unbounded: 0, unknown: 0, status: x.status, chain: x.chain, controlling: x.controlling };
        for (const v of x.margins) {
          if (Number.isFinite(v)) o.margins.push(v);
          else if (Number.isNaN(v)) o.unknown++;
          else if (v > 0) o.unbounded++;
          else o.never++;
        }
        targets[id] = o;
      }
      return { at: t, seed, start, count, targets, uncertain: b.uncertainNodes, computeMs: Math.round((performance.now() - t0) * 10) / 10 };
    });
  }

  /** One-at-a-time sensitivity of a capability's margin to each uncertain input. */
  sensitivity(t: number, target: string, shifts?: Record<string, number>): SensitivityBar[] {
    const m = this.m;
    const clean = cleanShifts(shifts);
    return m.memo('sensitivity', `${target}|${JSON.stringify(clean)}|${m.key(t)}`, () => {
      const ev = m.evaluate(t);
      if (!ev.result.requirements[target]) throw new HttpError(404, `no capability "${target}" in the picture at this time`);
      const fin = (x: number) => (Number.isFinite(x) ? x : null);
      return tornado(shifted(ev, clean), ev.ctx, target)
        .filter((b) => b.swing > 1e-6)
        .map((b) => ({ nodeId: b.node, label: b.label, low: fin(b.low), high: fin(b.high), swing: b.swing }));
    });
  }

  /**
   * Random slip: pick one input upstream of a capability, slip it, and report
   * the consequence. The headline is the delay to the capability, which is
   * what a watch officer cares about; compute time is a footnote.
   */
  slipChallenge(t: number, seed: number, capId?: string): SlipChallenge {
    const m = this.m;
    const t0 = performance.now();
    const ev = m.evaluate(t);
    const view = this.view(ev);
    const rnd = mulberry32(seed);
    const caps = capId ? view.capabilities.filter((c) => c.id === capId) : view.capabilities.filter((c) => ev.build.focus.includes(c.id));
    if (!caps.length) throw new HttpError(404, 'no capability to test');
    const specs = toMap(ev.graph);
    // only things that have not happened yet can slip
    const ahead = (id: string) => {
      const n = specs[id];
      if (n.kind !== 'event') return true;
      const at = typeof n.at === 'number' ? n.at : n.at === null ? n.assumedAt : undefined;
      return at !== undefined && at > ev.ctx.now;
    };
    const candidates = (target: string) => Object.keys(specs).filter((id) => shiftable(specs[id], ev.ctx.now) && ahead(id) && downstreamOf(ev.graph, id).has(target));
    const pool = caps.map((c) => ({ c, ids: candidates(c.id) })).filter((x) => x.ids.length);
    if (!pool.length) throw new HttpError(409, 'nothing feeding these capabilities is still ahead of the watch; move the clock back to test a slip');
    const { c: cap, ids: cone } = pool[Math.floor(rnd() * pool.length)];
    const nodeId = cone[Math.floor(rnd() * cone.length)];
    const slip = Math.round((2 + rnd() * 70) * 2) / 2;
    const r = compute(applyPatches(ev.graph, [{ op: 'shift', id: nodeId, hours: slip }]), { ...ev.ctx, hash: false });
    const after = engineView(ev.graph, r, ev.build.focus, m.frame).capabilities.find((c) => c.id === cap.id)!;
    const s = this.slackOf(ev, nodeId, cap.id);
    const delay = Number.isFinite(after.ready) && Number.isFinite(cap.ready) ? after.ready - cap.ready : after.ready === cap.ready ? 0 : Infinity;
    return {
      nodeId, label: specs[nodeId].label, slip, targetId: cap.id, targetCode: cap.code, delay,
      marginBefore: cap.margin, marginAfter: after.margin, statusBefore: cap.status, statusAfter: after.status,
      noImpact: s.noImpact, absorbed: Math.abs(delay) < 1e-6 && cap.status === after.status,
      controllingAfter: after.controlling.label, computeMs: Math.round((performance.now() - t0) * 10) / 10,
    };
  }

  /* ----------------------------------------------------------------- audit */

  audit(): AuditView {
    const m = this.m;
    const facts = m.log.all() as Fact[];
    const decisions = m.decisions.all();
    return {
      mission: m.id, node: m.node.info,
      facts: facts.map((f) => ({ ...f })),
      decisions: decisions.map((d) => ({ ...d })),
      heads: { facts: m.log.head(), decisions: m.decisions.head() },
      serverVerify: { facts: verifyFactChain(facts), decisions: m.decisions.verify(), storedRowMismatches: m.integrity.factMismatches },
      peers: m.peersView(),
      pendingPush: m.syncInfo.pending,
    };
  }
}
