import type { GraphSpec, NodeSpec, QualityFlag, RequirementNode, Severity, SourceRef } from '../../core/graph';
import { complement, contains, normalize, type Interval } from '../../core/intervals';
import type { Lever } from '../../core/options';
import type { Patch } from '../../core/patch';
import { DEFAULT_AUTHORITY } from '../../core/risk';
import { coneOf } from '../../core/analysis';
import { fmtRel } from '../../core/time';
import type { Fact, HealthItem, Resolved } from '../../data/store';
import { aircraft, rangeCheckNode } from '../airlift';
import type { BuildContext, BuildResult } from '../pack';
import { C, CLF, MET_MAP, UNREP, type MetRule } from './factors';
import type { NavalModel, ShipSpec, StrikeTasking, SystemSpec } from './model';

/**
 * Compile a naval mission model plus the facts known as of `ctx.now` into the
 * engine graph. Structure comes from the model; every changing value comes
 * from a fact, and every node built from a fact cites it.
 */
interface CasrepData {
  category: 'C-2' | 'C-3' | 'C-4';
  part?: string;
  partLabel?: string;
  repairHours: number;
  crewQual: string;
  crewK: number;
  fad?: string;
  und?: string;
  narrative?: string;
}

const POLICY_DEFAULTS = { replenish_trigger_pct: 30, extremis_fuel_pct: 15, sm_reserve_rounds: 8 } as const;
const PART_ETA_ASSUMPTION_H = 96;

function src(f?: Fact): SourceRef[] {
  return f ? [{ system: f.source.system, recordId: f.source.recordId, factId: f.id, observedAt: f.observedAt, kind: f.source.kind }] : [];
}

function provOf(rs: (Resolved | undefined)[]) {
  const facts: string[] = [];
  const sources: SourceRef[] = [];
  for (const r of rs) {
    if (!r) continue;
    if (r.fact) {
      facts.push(r.fact.id);
      sources.push(...src(r.fact));
    }
    for (const a of r.alternatives) {
      facts.push(a.id);
      sources.push(...src(a));
    }
  }
  return { facts, sources };
}

function qflags(r: Resolved | undefined): QualityFlag[] {
  return r ? r.flags.slice() : [];
}

export function buildNaval(m: NavalModel, ctx: BuildContext): BuildResult {
  const { view, now } = ctx;
  const nodes: NodeSpec[] = [];
  const levers: Lever[] = [];
  const health: HealthItem[] = [];
  const shipById = new Map(m.ships.map((s) => [s.id, s]));
  const add = (n: NodeSpec) => {
    nodes.push(n);
    return n.id;
  };
  const authority = m.authority ?? DEFAULT_AUTHORITY;
  const qM = m.qMarginH ?? 6;

  // ---------- policy values (scoped; pack defaults are governed, not "missing") ----------
  const policy = (key: keyof typeof POLICY_DEFAULTS, unit: string, label: string) => {
    const facts = view.facts('policy', key);
    const r = facts.length ? view.get<number>('policy', key, { scopes: ctx.scopes }) : undefined;
    const value = typeof r?.value === 'number' ? r.value : POLICY_DEFAULTS[key];
    return add({
      id: `policy:${key}`, kind: 'scalar', label, value, unit, flags: qflags(r),
      prov: r?.fact ? provOf([r]) : { citations: [key === 'replenish_trigger_pct' ? C.GAO98 : C.SYNTH], note: 'pack default' },
    });
  };
  const pTrigger = policy('replenish_trigger_pct', '%', 'Replenish trigger');
  const pExtremis = policy('extremis_fuel_pct', '%', 'Extremis fuel floor');
  const pSmReserve = policy('sm_reserve_rounds', 'rounds', 'SM self-defense reserve');

  // ---------- logistics network ----------
  const netName = new Map(m.network.nodes.map((n) => [n.id, n.name]));
  const dist = (a: string, b: string): number | undefined => {
    if (a === b) return 0;
    const arc = m.network.arcs.find((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a));
    return arc?.nm;
  };
  const netOpen = new Map<string, Interval[]>();
  for (const n of m.network.nodes) {
    const hist = view.history(n.id, 'node_status');
    const out: Interval[] = [];
    let openFrom: number | null = -Infinity;
    for (const f of hist) {
      const t = f.validFrom ?? f.observedAt;
      if (f.value === 'CLOSED' && openFrom !== null) {
        out.push([openFrom, t]);
        openFrom = null;
      } else if (f.value === 'OPEN' && openFrom === null) openFrom = t;
    }
    if (openFrom !== null) out.push([openFrom, Infinity]);
    netOpen.set(n.id, out);
    const closed = hist.filter((f) => f.value === 'CLOSED');
    add({
      id: `net:${n.id}`, kind: 'window', label: `${n.name} open`, intervals: out, domain: 'logistics',
      prov: { facts: hist.map((f) => f.id), sources: hist.flatMap((f) => src(f)), citations: closed.length ? [C.BAHRAIN] : undefined },
    });
  }
  const openAt = (id: string, t: number) => contains(normalize(netOpen.get(id) ?? [[-Infinity, Infinity]]), t);

  // ---------- EMCON per group ----------
  const emcon = new Map<string, Interval[]>();
  for (const g of m.groups) {
    const r = view.get<[number, number][]>(g.id, 'emcon');
    const ivs = normalize((r.value ?? []) as Interval[]);
    emcon.set(g.id, ivs as Interval[]);
    add({
      id: `emcon:${g.id}:clear`, kind: 'window', label: `${g.name} not in EMCON`, intervals: complement(ivs) as Interval[], domain: 'comms',
      prov: { ...provOf([r]), citations: [C.EMCON] },
    });
  }

  // ---------- people ----------
  for (const s of m.ships) for (const p of s.people ?? []) {
    const r = view.get<[number, number][]>(p.id, 'person_unavailable');
    const ivs = (r.value ?? []).map(([a, b]) => ({ start: a, end: b, reason: r.fact?.reason }));
    add({ id: `person:${p.id}`, kind: 'person', label: `${p.label} (${s.name})`, owner: s.id, domain: 'personnel', unavailable: ivs, qual: p.quals.join(', '), prov: provOf([r]) });
  }
  const crewWith = (s: ShipSpec, qual: string) => (s.people ?? []).filter((p) => p.quals.includes(qual)).map((p) => `person:${p.id}`);

  // ---------- part delivery routes ----------
  const partNodes = new Map<string, { eta: number | undefined; loc?: string; codGate?: string; flight?: string; slotHours: number; rangeDetail?: string; rangeOk?: boolean }>();
  const deliverPart = (partId: string, partLabel: string, ship: ShipSpec): string => {
    const etaR = view.get<number>(partId, 'part_eta');
    const locR = view.get<string>(partId, 'part_at');
    const loc = locR.value;
    const evId = `part:${partId}`;
    if (!nodes.some((n) => n.id === evId)) {
      add({
        id: evId, kind: 'event', label: `${partLabel} at ${loc ? netName.get(loc) ?? loc : 'unknown location'}`, domain: 'logistics', owner: ship.id,
        at: typeof etaR.value === 'number' ? etaR.value : null, assumedAt: now + PART_ETA_ASSUMPTION_H,
        flags: [...qflags(etaR), ...qflags(locR).filter((f) => f !== 'missing' || !locR.fact)],
        uncertainty: { min: -2, mode: 0, max: 6 }, prov: provOf([etaR, locR]),
        detail: typeof etaR.value === 'number' ? undefined : `ETA not reported; conservative ${PART_ETA_ASSUMPTION_H} h assumption`,
      });
    }
    const routes: string[] = [];
    let codGate: string | undefined;
    let flight: string | undefined;
    if (m.cod && loc && m.cod.airfields.includes(loc)) {
      const cod = m.cod;
      const nm = dist(loc, cod.opArea);
      if (nm !== undefined) {
        const range = add(rangeCheckNode(`cod:${partId}:range`, `COD leg ${netName.get(loc)}→carrier within ${cod.aircraft} range`, cod.aircraft, nm, cod.payloadLb, ship.id));
        flight = add({
          id: `cod:${partId}:flight`, kind: 'routine', label: `COD flight time ${netName.get(loc)}→carrier`, routine: 'airlift.blockHours',
          inputs: { distanceNm: nm, speedKt: aircraft(cod.aircraft).cruiseKt, groundHours: 0.5 },
        });
        const carrier = shipById.get(cod.carrier);
        const cmv = carrier?.systems.filter((x) => x.kind === 'cmv22').map((x) => `sys:${x.id}`) ?? [];
        const deck = carrier?.systems.filter((x) => x.kind === 'flightdeck').map((x) => `sys:${x.id}`) ?? [];
        codGate = add({
          id: `cod:${partId}`, kind: 'gate', label: `COD ${netName.get(loc)} → ${carrier?.name ?? 'carrier'}`, domain: 'logistics', owner: cod.carrier,
          deps: [evId, range, `net:${loc}`, ...cmv, ...deck],
          slots: cod.slots.map((s) => ({ id: s.id, label: s.label, start: s.depart, end: s.depart + cod.slotHours, lag: { ref: flight! } })),
        });
        let onShip = codGate;
        if (ship.id !== cod.carrier) onShip = add({ id: `xdeck:${partId}:${ship.id}`, kind: 'delay', label: `Helo cross-deck to ${ship.name}`, dep: codGate, lag: cod.crossDeckHours, domain: 'logistics', owner: ship.id });
        routes.push(onShip);
      }
    }
    if (m.shuttle && loc && m.shuttle.hubs.includes(loc)) {
      const sh = m.shuttle;
      const nm = dist(loc, sh.opArea);
      if (nm !== undefined) {
        const load = add({ id: `shuttle:${partId}:load`, kind: 'task', label: `Load part on ${shipById.get(sh.ship)?.name ?? sh.ship} at ${netName.get(loc)}`, deps: [evId, `net:${loc}`], duration: sh.loadHours, notBefore: now, domain: 'logistics' });
        const speed = add({ id: `shuttle:${partId}:speed`, kind: 'routine', label: `${sh.cls} speed of advance`, routine: 'naval.clfSpeed', inputs: { cls: sh.cls } });
        const transit = add({ id: `shuttle:${partId}:transit`, kind: 'routine', label: `${sh.cls} transit ${netName.get(loc)}→op area`, routine: 'naval.transitHours', inputs: { nm, nmPerDay: { ref: speed } } });
        const arrive = add({ id: `shuttle:${partId}:arrive`, kind: 'delay', label: `${sh.cls} shuttle transit`, dep: load, lag: { ref: transit }, domain: 'logistics' });
        routes.push(add({ id: `shuttle:${partId}:${ship.id}`, kind: 'delay', label: `CONREP/VERTREP to ${ship.name}`, dep: arrive, lag: sh.transferHours, domain: 'logistics' }));
      }
    }
    let rangeOk: boolean | undefined;
    let rangeDetail: string | undefined;
    if (codGate && m.cod && loc) {
      const a = aircraft(m.cod.aircraft);
      const run = ctx.routines.run('airlift.legWithinRange', { distanceNm: dist(loc, m.cod.opArea) ?? Infinity, rangeNm: a.rangeNm, payloadLb: m.cod.payloadLb, maxPayloadLb: a.maxPayloadLb });
      rangeOk = run.result.passed === true;
      rangeDetail = run.result.detail;
    }
    partNodes.set(partId, { eta: typeof etaR.value === 'number' ? etaR.value : undefined, loc, codGate, flight, slotHours: m.cod?.slotHours ?? 1, rangeOk, rangeDetail });
    const id = `part:${partId}:${ship.id}`;
    add({
      id, kind: 'any', label: `${partLabel} on board ${ship.name}`, deps: routes, domain: 'logistics', owner: ship.id,
      detail: routes.length ? undefined : `no delivery route from ${loc ? netName.get(loc) ?? loc : 'an unknown location'}`,
    });
    return id;
  };

  // ---------- systems (status history + CASREP restoration chains) ----------
  const casrepsBySystem = new Map<string, { t: number; data: CasrepData; fact: Fact }>();
  for (const s of m.ships) for (const sys of s.systems) buildSystem(s, sys);

  function buildSystem(s: ShipSpec, sys: SystemSpec) {
    const status = view.history(sys.id, 'system_status').map((f) => ({ t: f.validFrom ?? f.observedAt, kind: 'status' as const, f }));
    const caps = view.history(sys.id, 'casrep').map((f) => ({ t: f.validFrom ?? f.observedAt, kind: 'casrep' as const, f }));
    const evs = [...status, ...caps].sort((a, b) => a.t - b.t);
    const up: Interval[] = [];
    let upFrom: number | null = -Infinity;
    let open: { t: number; data: CasrepData; fact: Fact } | undefined;
    const notes: string[] = [];
    for (const e of evs) {
      if (e.kind === 'status') {
        if (e.f.value === 'UP') {
          if (upFrom === null) upFrom = e.t;
          open = undefined;
        } else if (upFrom !== null) {
          up.push([upFrom, e.t]);
          upFrom = null;
        }
      } else {
        const data = e.f.value as CasrepData;
        if (data.category === 'C-2') {
          notes.push(`C-2 CASREP at ${e.t}: ${data.narrative ?? 'deficiency'}; primary missions not degraded`);
          continue;
        }
        if (upFrom !== null) {
          up.push([upFrom, e.t]);
          upFrom = null;
        }
        open = { t: e.t, data, fact: e.f };
      }
    }
    if (upFrom !== null) up.push([upFrom, Infinity]);
    const facts = evs.map((e) => e.f);
    const prov = { facts: facts.map((f) => f.id), sources: facts.flatMap((f) => src(f)), citations: caps.length ? [C.CASREP] : undefined };
    const flags: QualityFlag[] = [];
    if (!open) {
      add({ id: `sys:${sys.id}`, kind: 'window', label: `${sys.label} (${s.name})`, intervals: up, owner: s.id, domain: 'maintenance', prov, flags, detail: notes.join('; ') || undefined });
      if (upFrom === null && !evs.some((e) => e.kind === 'casrep')) {
        health.push({ entity: sys.id, attr: 'system_status', flags: ['missing'], note: `${sys.label} on ${s.name} is down with no CASREP or estimated repair time`, facts: facts.map((f) => f.id) });
      }
      return;
    }
    casrepsBySystem.set(sys.id, open);
    const d = open.data;
    const hist = add({ id: `sys:${sys.id}:hist`, kind: 'window', label: `${sys.label} up before casualty`, intervals: up, owner: s.id, domain: 'maintenance', prov });
    const deps: string[] = [];
    if (d.part) deps.push(deliverPart(d.part, d.partLabel ?? 'Repair part', s));
    add({
      id: `sys:${sys.id}:pd`, kind: 'routine', label: `Requisition priority (${d.part ?? 'repair'})`, routine: 'naval.requisitionPriority',
      inputs: { fad: d.fad ?? 'II', und: d.und ?? 'A' }, owner: s.id,
    });
    const repair = add({
      id: `sys:${sys.id}:repair`, kind: 'task', label: `Repair ${sys.label} (${d.category} CASREP)`, deps, duration: d.repairHours, owner: s.id, domain: 'maintenance',
      crew: { pool: crewWith(s, d.crewQual), k: d.crewK, label: `qualified ${d.crewQual}` }, notBefore: Math.max(now, open.t),
      uncertainty: { min: -1, mode: 0, max: Math.max(2, d.repairHours) }, prov: { facts: [open.fact.id], sources: src(open.fact), citations: [C.CASREP] },
      detail: d.narrative,
    });
    add({ id: `sys:${sys.id}`, kind: 'any', label: `${sys.label} (${s.name})`, deps: [hist, repair], owner: s.id, domain: 'maintenance', prov });
  }

  // ---------- fuel ledgers ----------
  for (const s of m.ships) {
    if (!s.fuel) continue;
    const r = view.get<number>(s.id, 'fuel_pct');
    const t0 = r.fact?.observedAt ?? now;
    const burns = (s.speedPlan ?? []).filter((l) => l.to > t0).map((l, i) => {
      const id = add({ id: `burn:${s.id}:${i}`, kind: 'routine', label: `${s.name} burn at ${l.kt} kt`, routine: 'naval.burnPctPerHour', inputs: { cls: s.cls === 'CVN' ? 'CV' : s.cls, kt: l.kt }, owner: s.id });
      return { from: Math.max(l.from, t0), to: l.to, rate: { ref: id }, label: `${l.kt} kt ${l.label}` };
    });
    const transfers = m.unreps.filter((u) => u.receivers.includes(s.id)).map((u) => ({ id: u.id, label: u.label, at: { node: `unrep:${u.id}:${s.id}` }, kind: 'topoff' as const }));
    add({
      id: `fuel:${s.id}`, kind: 'stock', label: `${s.name} fuel`, unit: '%', t0, initial: typeof r.value === 'number' ? r.value : null, capacity: 100, floor: 0,
      burns, transfers, owner: s.id, domain: 'logistics', flags: qflags(r), uncertainty: { min: 0.95, mode: 1, max: 1.15, kind: 'scale' },
      prov: { ...provOf([r]), citations: [C.GAO98] },
    });
    add({ id: `fuel:${s.id}:extremis`, kind: 'threshold', label: `${s.name} fuel ≥ extremis floor`, stock: `fuel:${s.id}`, level: { ref: pExtremis }, owner: s.id, domain: 'logistics' });
    add({ id: `fuel:${s.id}:trigger`, kind: 'threshold', label: `${s.name} fuel ≥ replenish trigger`, stock: `fuel:${s.id}`, level: { ref: pTrigger }, owner: s.id, domain: 'logistics' });
  }

  // ---------- magazines ----------
  const inventory = new Map<string, number | undefined>();
  const assigned = new Map<string, number>();
  for (const st of m.strikes) for (const sh of st.shooters) assigned.set(sh.ship, (assigned.get(sh.ship) ?? 0) + sh.rounds);
  for (const s of m.ships) for (const mag of s.magazines ?? []) {
    const r = view.get<number>(`${s.id}/${mag.weapon}`, 'magazine');
    inventory.set(`${s.id}/${mag.weapon}`, typeof r.value === 'number' ? r.value : undefined);
    const transfers = mag.weapon === 'TLAM'
      ? m.strikes.flatMap((st) => st.shooters.filter((x) => x.ship === s.id).map((x) => ({ id: st.id, label: `${st.name} salvo (${x.rounds})`, at: st.hHour + st.windowHours, kind: 'out' as const, amount: x.rounds })))
      : [];
    add({
      id: `mag:${s.id}:${mag.weapon}`, kind: 'stock', label: `${s.name} ${mag.weapon} inventory`, unit: 'rounds', t0: r.fact?.observedAt ?? now,
      initial: typeof r.value === 'number' ? r.value : null, capacity: mag.capacity, floor: 0, burns: [], transfers, owner: s.id, domain: 'ordnance',
      flags: qflags(r), prov: { ...provOf([r]), citations: [C.TRAM] },
      detail: 'VLS cells are reloaded in port (or by TRAM alongside a T-AKE in sea state ≤ 3).',
    });
    if (mag.weapon === 'SM') add({ id: `mag:${s.id}:SM:reserve`, kind: 'threshold', label: `${s.name} SM ≥ self-defense reserve`, stock: `mag:${s.id}:SM`, level: { ref: pSmReserve }, owner: s.id, domain: 'ordnance' });
  }

  // ---------- METs ----------
  const metId = (ship: string, code: string, strike?: string) => (strike ? `met:${ship}:${code}:${strike}` : `met:${ship}:${code}`);
  const systemsOf = (s: ShipSpec, kind: string) => s.systems.filter((x) => x.kind === kind);
  const windowFor = (code: string): [number, number] => (code === 'AW' ? m.windows.aw : code === 'CCC' ? m.windows.ccc : m.windows.mob);
  const severityFor = (code: string): Severity => (code === 'MOB' || code === 'AW' ? 'II' : 'III');

  const buildMet = (s: ShipSpec, rule: MetRule, strike?: StrikeTasking): string | undefined => {
    const deps: string[] = [];
    const missingKinds: string[] = [];
    for (const sr of rule.systems) {
      const list = systemsOf(s, sr.kind);
      if (!list.length) {
        missingKinds.push(sr.kind);
        continue;
      }
      if (sr.k !== undefined) {
        deps.push(add({ id: `${metId(s.id, rule.code, strike?.id)}:${sr.kind}`, kind: 'kofn', label: `${s.name} ${sr.kind.toUpperCase()} (${sr.k} of ${list.length})`, k: sr.k, deps: list.map((x) => `sys:${x.id}`), owner: s.id, domain: 'maintenance' }));
      } else deps.push(...list.map((x) => `sys:${x.id}`));
    }
    if (rule.team) {
      const pool = crewWith(s, rule.team.qual);
      const tid = `team:${s.id}:${rule.team.qual}`;
      if (!nodes.some((n) => n.id === tid)) add({ id: tid, kind: 'kofn', label: `${s.name} ${rule.team.label} (${rule.team.k} of ${pool.length})`, k: rule.team.k, deps: pool, owner: s.id, domain: 'personnel' });
      deps.push(tid);
    }
    for (const st of rule.stocks ?? []) {
      if (st === 'fuel-extremis' && s.fuel) deps.push(`fuel:${s.id}:extremis`);
      if (st === 'sm-reserve' && (s.magazines ?? []).some((x) => x.weapon === 'SM')) deps.push(`mag:${s.id}:SM:reserve`);
      if (st === 'tlam-salvo' && strike) {
        const rounds = strike.shooters.find((x) => x.ship === s.id)?.rounds ?? 0;
        const salvo = add({ id: `salvo:${strike.id}:${s.id}`, kind: 'scalar', label: `${s.name} TLAM rounds tasked (${strike.name})`, value: rounds, unit: 'rounds', owner: s.id });
        const mag = nodes.find((n) => n.id === `mag:${s.id}:TLAM`);
        if (mag && mag.kind === 'stock') {
          // inventory available to this strike = on hand minus salvos of strikes that end before it starts
          const pre = add({
            ...mag, id: `mag:${s.id}:TLAM:pre:${strike.id}`, label: `${s.name} TLAM available for ${strike.name}`,
            transfers: mag.transfers.filter((x) => typeof x.at === 'number' && x.at <= strike.hHour && x.id !== strike.id),
          });
          deps.push(add({ id: `mag:${s.id}:TLAM:salvo:${strike.id}`, kind: 'threshold', label: `${s.name} TLAM ≥ tasked salvo`, stock: pre, level: { ref: salvo }, owner: s.id, domain: 'ordnance' }));
        }
      }
    }
    if (rule.c2 && strike) deps.push(buildC2(s, strike));
    const id = metId(s.id, rule.code, strike?.id);
    const rep = view.get<string>(`${s.id}/${rule.code}`, 'met_assessment');
    const flags: QualityFlag[] = [];
    const reportedAt = rep.fact?.observedAt;
    if (reportedAt !== undefined) {
      for (const sr of rule.systems) for (const x of systemsOf(s, sr.kind)) {
        const cas = casrepsBySystem.get(x.id);
        if (cas && cas.t > reportedAt && now > cas.t + 24 && !flags.includes('unreported-change')) {
          flags.push('unreported-change');
          health.push({ entity: `${s.id}/${rule.code}`, attr: 'met_assessment', flags: ['unreported-change'], note: `${x.label} CASREP at ${cas.t} affects ${rule.code}; no DRRS-N update within 24 h`, facts: [cas.fact.id, rep.fact!.id] });
        }
      }
    }
    const w = strike ? ([strike.hHour, strike.hHour + strike.windowHours] as [number, number]) : windowFor(rule.code);
    const req: RequirementNode = {
      id, kind: 'requirement', label: `${s.name} ${rule.label}${strike ? ` — ${strike.name}` : ''}`, code: rule.code, deps, owner: s.id, level: 'asset',
      window: { start: w[0], end: w[1] }, qMargin: qM, severity: strike ? strike.severity : severityFor(rule.code), primary: true, flags,
      reported: rep.fact ? { status: rep.value as 'Y' | 'Q' | 'N', observedAt: rep.fact.observedAt, system: rep.fact.source.system, factId: rep.fact.id } : undefined,
      prov: { citations: MET_MAP.citations, ...provOf([rep]) },
      detail: missingKinds.length ? `class has no ${missingKinds.join(', ')} in the model` : undefined,
    };
    add(req);
    return id;
  };

  function buildC2(s: ShipSpec, st: StrikeTasking): string {
    const deps = systemsOf(s, 'satcom').map((x) => `sys:${x.id}`);
    const relay = st.relayVia ? shipById.get(st.relayVia) : undefined;
    if (relay && relay.id !== s.id) {
      const key = `${s.id}~${relay.id}`;
      const rr = view.get<boolean>(key, 'in_relay_range');
      const inRange = rr.value === true;
      const range = add({
        id: `range:${key}`, kind: 'window', label: `${s.name} within Link-16 range of ${relay.name}`, intervals: inRange ? [[-Infinity, Infinity]] : [],
        flags: rr.fact ? qflags(rr) : ['missing', 'assumed'], prov: provOf([rr]), domain: 'comms',
        detail: rr.fact ? undefined : 'range not reported; assumed out of range',
      });
      const relayDeps = [
        ...systemsOf(s, 'link16').map((x) => `sys:${x.id}`),
        ...systemsOf(relay, 'link16').map((x) => `sys:${x.id}`),
        ...systemsOf(relay, 'satcom').map((x) => `sys:${x.id}`),
        range,
        `emcon:${st.group}:clear`,
      ];
      deps.push(add({ id: `c2:${s.id}:${st.id}:relay`, kind: 'all', label: `Link-16 relay of launch authority via ${relay.name}`, deps: relayDeps, owner: s.id, domain: 'comms' }));
    }
    return add({ id: `c2:${s.id}:${st.id}`, kind: 'any', label: `Launch-authority path to ${s.name}`, deps, owner: s.id, domain: 'comms', prov: { citations: [C.EMCON, C.MSRG] } });
  }

  for (const s of m.ships) {
    const rules = MET_MAP.rows.filter((r) => r.cls === s.cls && r.code !== 'STW' && (!s.mets || s.mets.includes(r.code)));
    for (const r of rules) buildMet(s, r);
  }

  // strike: STW for every TLAM-capable ship in the group (non-tasked ones carry 0 rounds, for reassignment)
  const focus: string[] = [];
  for (const st of m.strikes) {
    const group = m.groups.find((g) => g.id === st.group);
    const capable = (group?.members ?? []).map((id) => shipById.get(id)!).filter((s) => s && (s.magazines ?? []).some((x) => x.weapon === 'TLAM'));
    const stw = new Map<string, string>();
    for (const s of capable) {
      const rule = MET_MAP.rows.find((r) => r.cls === s.cls && r.code === 'STW');
      if (rule) stw.set(s.id, buildMet(s, rule, st)!);
    }
    const tasked = st.shooters.map((x) => stw.get(x.ship)).filter((x): x is string => !!x);
    add({
      id: `strike:${st.id}`, kind: 'requirement', label: `${st.name}: TLAM strike (${st.shooters.reduce((a, b) => a + b.rounds, 0)} rounds)`, code: 'STW', level: 'mission',
      deps: tasked, window: { start: st.hHour, end: st.hHour + st.windowHours }, qMargin: qM, severity: st.severity, primary: true, owner: st.group,
    });
    focus.push(`strike:${st.id}`, ...tasked);
    levers.push(...strikeLevers(st, stw, capable));
  }

  // ---------- UNREP / CONSOL ----------
  for (const u of m.unreps) {
    const known = u.departFrom.find((o) => openAt(o.hub, o.readyAt));
    const opt = known ?? u.departFrom[0];
    if (opt !== u.departFrom[0]) {
      health.push({ entity: u.id, attr: 'node_status', flags: ['contradictory'], note: `${netName.get(u.departFrom[0].hub)} closed; ${u.label} re-planned from ${netName.get(opt.hub)}`, facts: [] });
    }
    const r = view.get<number>(`${u.id}/${opt.hub}`, 'unrep_ready_at');
    const ready = add({
      id: `unrep:${u.id}:ready`, kind: 'event', label: `${shipById.get(u.provider)?.name ?? u.provider} ready to depart ${netName.get(opt.hub)}`,
      at: typeof r.value === 'number' ? r.value : opt.readyAt, uncertainty: { min: -2, mode: 0, max: 8 }, flags: r.fact ? qflags(r) : [], domain: 'logistics',
      prov: provOf([r]), detail: r.fact ? undefined : 'planned ready time (no update reported)',
    });
    const depart = add({ id: `unrep:${u.id}:depart`, kind: 'all', label: `${shipById.get(u.provider)?.name} departs ${netName.get(opt.hub)}`, deps: [ready, `net:${opt.hub}`], domain: 'logistics' });
    const speed = add({ id: `unrep:${u.id}:speed`, kind: 'scalar', label: `${u.providerCls} speed of advance`, value: CLF.rows.find((x) => x.cls === u.providerCls)?.nmPerDay ?? 384, unit: 'nm/day', prov: { citations: CLF.citations } });
    const nm = dist(opt.hub, u.rendezvous);
    const transit = add({ id: `unrep:${u.id}:transit`, kind: 'routine', label: `${u.providerCls} transit ${netName.get(opt.hub)}→${netName.get(u.rendezvous)}`, routine: 'naval.transitHours', inputs: { nm: nm ?? 0, nmPerDay: { ref: speed } } });
    let prev = add({ id: `unrep:${u.id}:arrive`, kind: 'delay', label: `${u.label}: transit to ${netName.get(u.rendezvous)}`, dep: depart, lag: { ref: transit }, domain: 'logistics' });
    for (const rid of u.receivers) {
      const s = shipById.get(rid)!;
      const base = (UNREP.rows.find((x) => x.cls === s.cls)?.alongsideH as number | undefined) ?? 2;
      const along = add({ id: `unrep:${u.id}:${rid}:along`, kind: 'routine', label: `${s.name} time alongside`, routine: 'naval.alongsideHours', inputs: { baseHours: base, oneHose: !!u.oneHose?.includes(rid) } });
      prev = add({ id: `unrep:${u.id}:${rid}`, kind: 'task', label: `${s.name} alongside ${shipById.get(u.provider)?.name}`, deps: [prev], duration: { ref: along }, notBefore: now, owner: rid, domain: 'logistics', prov: { citations: [C.NWP_4_01_4] } });
    }
    levers.push({
      id: `unrep-speed:${u.id}`, title: `Request ${shipById.get(u.provider)?.name} increase speed of advance to 18 kt`, detail: `${u.label}: 432 nm/day instead of the table rate.`,
      category: 'logistics', authority: 'Logistics task force commander (CTF)', withinUnitAuthority: false, cost: 'med', effect: 'planning-assumption',
      patches: [{ op: 'set', id: speed, fields: { value: 432 } }], target: `met:${u.receivers.find((r) => m.strikes.some((st) => st.shooters.some((x) => x.ship === r))) ?? u.receivers[0]}:MOB`, source: 'naval.unrep',
    });
  }

  // ---------- group roll-ups ----------
  for (const g of m.groups) for (const ru of g.rollups ?? []) {
    const members = g.members.map((id) => metId(id, ru.code)).filter((id) => nodes.some((n) => n.id === id));
    const k = add({ id: `grp:${g.id}:${ru.code}:k`, kind: 'kofn', label: `${g.name} ${ru.code} (${ru.k} of ${members.length})`, k: ru.k, deps: members, owner: g.id });
    add({ id: `grp:${g.id}:${ru.code}`, kind: 'requirement', label: `${g.name} ${ru.label}`, code: ru.code, level: 'group', deps: [k], window: { start: ru.window[0], end: ru.window[1] }, qMargin: qM, severity: ru.severity, owner: g.id });
    focus.push(`grp:${g.id}:${ru.code}`);
  }
  for (const s of m.ships) if (s.fuel && m.strikes.some((st) => st.shooters.some((x) => x.ship === s.id)) && nodes.some((n) => n.id === `met:${s.id}:MOB`)) focus.push(`met:${s.id}:MOB`);

  // ---------- levers that depend on parts ----------
  for (const [partId, p] of partNodes) {
    if (!p.codGate || !m.cod || !p.flight || p.eta === undefined || !p.loc) continue;
    const t = Math.max(now + m.cod.leadTimeHours, p.eta);
    const tmp: GraphSpec = { id: 'tmp', horizon: m.horizon, nodes };
    const reqs = nodes.filter((n) => n.kind === 'requirement').map((n) => n.id);
    const partNode = nodes.find((n) => n.id.startsWith(`part:${partId}:`))?.id ?? `part:${partId}`;
    const target = [...focus, ...reqs].find((r) => coneOf(tmp, r).has(partNode));
    const openThen = openAt(p.loc, t);
    levers.push({
      id: `cod-dedicated:${partId}`, title: `Request a dedicated COD sortie for the ${partId} part at ${m.marks.H !== undefined ? fmtRel(t, m.marks.H) : t.toFixed(1)}`, detail: `Launch as soon as the part is at ${netName.get(p.loc!) ?? p.loc}, outside the scheduled COD slots.`,
      category: 'expedite', authority: 'CVN Air Officer / CSG N4', withinUnitAuthority: false, cost: 'med', effect: 'planning-assumption',
      deadline: t - m.cod.leadTimeHours, patches: [{ op: 'addSlot', id: p.codGate, slot: { id: 'dedicated', label: 'Dedicated COD sortie', start: t, end: t + p.slotHours, lag: { ref: p.flight } } }],
      target, source: 'naval.cod', requiresNodes: [p.codGate],
      infeasible: p.rangeOk === false ? `COD leg infeasible: ${p.rangeDetail}` : !openThen ? `${netName.get(p.loc) ?? p.loc} is closed at ${t.toFixed(1)}` : undefined,
    });
  }

  function strikeLevers(st: StrikeTasking, stw: Map<string, string>, capable: ShipSpec[]): Lever[] {
    const out: Lever[] = [];
    const target = `strike:${st.id}`;
    const em = emcon.get(st.group) ?? [];
    const nextEmcon = em.find(([s, e]) => e > now && s <= st.hHour + st.windowHours);
    for (const sh of st.shooters) {
      const s = shipById.get(sh.ship)!;
      const c2 = `c2:${s.id}:${st.id}`;
      const deadline = nextEmcon ? nextEmcon[0] : st.hHour - 1;
      out.push({
        id: `prebrief:${st.id}:${s.id}`, title: `Pre-brief launch authority to ${s.name} before EMCON`,
        detail: `${st.launchAuthority} delegates execution on pre-briefed intent (command by negation) so ${s.name} can launch without a live authority link.`,
        category: 'c2', authority: st.launchAuthority, withinUnitAuthority: false, cost: 'low', effect: 'planning-assumption', deadline,
        risk: { severity: 'III', probability: 'D', note: 'Executes on pre-briefed intent without real-time confirmation.' },
        patches: [
          { op: 'add', node: { id: `${c2}:prebrief`, kind: 'event', label: `Launch authority pre-briefed to ${s.name}`, at: now, owner: s.id, domain: 'comms', flags: ['planning-assumption'] } },
          { op: 'addDep', id: c2, dep: `${c2}:prebrief` },
        ],
        target, source: 'naval.c2', requiresNodes: [c2],
      });
      if (st.relayVia && st.relayVia !== s.id && em.length && !out.some((l) => l.id === `emcon-relay:${st.id}`)) {
        const ws = st.hHour - 1;
        const we = st.hHour + st.windowHours + 1;
        const clear = complement(normalize(em));
        const newClear = normalize([...clear, [ws, we]] as Interval[]);
        out.push({
          id: `emcon-relay:${st.id}`, title: `Request EMCON modification for Link-16 relay via ${shipById.get(st.relayVia)?.name} (H-1 to end of window)`,
          detail: 'Allows Link-16 transmission during the launch window so the relay can pass launch authority.',
          category: 'emcon', authority: 'CWC / Information Warfare Commander', withinUnitAuthority: false, cost: 'med', effect: 'planning-assumption', deadline: ws - 0.5,
          risk: { severity: 'II', probability: 'C', note: 'Emitting during the launch window can reveal the group\'s position.' },
          patches: [{ op: 'set', id: `emcon:${st.group}:clear`, fields: { intervals: newClear } }],
          target, source: 'naval.emcon', requiresNodes: [`c2:${s.id}:${st.id}:relay`],
        });
      }
      // reassign this shooter's rounds to others with spare inventory
      const others = capable.filter((x) => x.id !== s.id && stw.has(x.id));
      const spare = others.map((x) => {
        const inv = inventory.get(`${x.id}/TLAM`);
        return { ship: x, spare: inv === undefined ? undefined : Math.max(0, inv - (assigned.get(x.id) ?? 0)) };
      });
      let need = sh.rounds;
      const takes: { ship: ShipSpec; n: number }[] = [];
      for (const o of spare.filter((x) => x.spare !== undefined).sort((a, b) => b.spare! - a.spare!)) {
        if (need <= 0) break;
        const n = Math.min(need, o.spare!);
        if (n > 0) {
          takes.push({ ship: o.ship, n });
          need -= n;
        }
      }
      const unknown = spare.filter((x) => x.spare === undefined);
      if (need > 0) for (const u of unknown) {
        takes.push({ ship: u.ship, n: need });
        need = 0;
        break;
      }
      if (takes.length) {
        const patches: Patch[] = [
          { op: 'set', id: `salvo:${st.id}:${s.id}`, fields: { value: 0 } },
          { op: 'removeDep', id: target, dep: stw.get(s.id)! },
          { op: 'addTransfer', id: `mag:${s.id}:TLAM`, transfer: { id: st.id, label: `${st.name} salvo (reassigned away)`, at: st.hHour + st.windowHours, kind: 'out', amount: 0 } },
        ];
        for (const t of takes) {
          const cur = st.shooters.find((x) => x.ship === t.ship.id)?.rounds ?? 0;
          patches.push(
            { op: 'set', id: `salvo:${st.id}:${t.ship.id}`, fields: { value: cur + t.n } },
            { op: 'addDep', id: target, dep: stw.get(t.ship.id)! },
            { op: 'addTransfer', id: `mag:${t.ship.id}:TLAM`, transfer: { id: st.id, label: `${st.name} salvo (${cur + t.n})`, at: st.hHour + st.windowHours, kind: 'out', amount: cur + t.n } },
          );
        }
        out.push({
          id: `reassign:${st.id}:${s.id}`, title: `Recommend reassigning ${s.name}'s ${sh.rounds} TLAM to ${takes.map((t) => `${t.ship.name} (+${t.n})`).join(', ')}`,
          detail: 'Shifts the salvo to shooters with spare inventory and a working launch-authority path.',
          category: 'reassign', authority: 'Strike warfare commander (STWC)', withinUnitAuthority: false, cost: 'med', effect: 'planning-assumption',
          deadline: st.hHour - 2,
          risk: { severity: 'III', probability: 'D', note: 'Receiving shooters have less inventory left for follow-on tasking.' },
          missingInfo: unknown.filter((u) => takes.some((t) => t.ship.id === u.ship.id)).map((u) => `${u.ship.name} TLAM inventory not reported`),
          patches, target, source: 'naval.strike',
        });
      }
    }
    for (const h of [6, 12]) {
      const ids = [target, ...[...stw.values()]];
      const patches: Patch[] = ids.map((id) => ({ op: 'shift', id, hours: h }) as Patch);
      for (const sh of st.shooters) patches.push({ op: 'addTransfer', id: `mag:${sh.ship}:TLAM`, transfer: { id: st.id, label: `${st.name} salvo (${sh.rounds})`, at: st.hHour + st.windowHours + h, kind: 'out', amount: sh.rounds } });
      out.push({
        id: `slip:${st.id}:${h}`, title: `Recommend the tasking authority slip H-hour ${h} h`, detail: `Moves the launch window to H+${h}.`,
        category: 'schedule', authority: st.taskingAuthority, withinUnitAuthority: false, cost: 'high', effect: 'planning-assumption', deadline: st.hHour - 1,
        risk: { severity: 'II', probability: 'C', note: 'Target may relocate; adjacent operations must re-sequence.' },
        patches, target, source: 'naval.strike', exclusive: `slip:${st.id}`,
      });
    }
    return out;
  }

  const allHealth = [...view.health(), ...health];
  const graph: GraphSpec = { id: m.id, label: m.name, horizon: m.horizon, nodes, qMargin: qM, marks: m.marks };
  return { graph, levers, focus: [...new Set(focus)], health: allHealth, authority, epochUtcMs: Date.parse(m.epochUtc) };
}
