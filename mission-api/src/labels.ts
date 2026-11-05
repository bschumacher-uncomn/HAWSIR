import type { AuthoredModel, Fact, MissionDef, NavalModel } from './engine';

/**
 * Human labels for fact entities, and which ship an entity belongs to. Used
 * for explanation text, for deciding where a scripted report arrives, and for
 * the shore's sharing policy.
 */
export class Labels {
  private labels = new Map<string, string>();
  private owners = new Map<string, string>();
  readonly shipName = new Map<string, string>();

  constructor(def: MissionDef) {
    for (const s of def.display.ships) {
      this.shipName.set(s.id, s.name);
      this.set(s.id, `${s.name} (${s.hull})`, s.id);
    }
    if (def.main === 'naval') this.naval(def.model as NavalModel);
    if (def.main === 'authored') {
      const m = def.model as AuthoredModel;
      for (const n of m.nodes) {
        this.set(n.id, n.label, n.owner);
        for (const b of n.bind ?? []) if (b.entity && !this.labels.has(b.entity)) this.set(b.entity, n.label, n.owner);
      }
    }
    this.set('policy', 'Mission policy');
  }

  private naval(model: NavalModel): void {
    for (const s of model.ships) {
      for (const y of s.systems) this.set(y.id, `${y.label} — ${s.name}`, s.id);
      for (const p of s.people ?? []) this.set(p.id, `${p.label} — ${s.name}`, s.id);
      for (const m of s.magazines ?? []) this.set(`${s.id}/${m.weapon}`, `${s.name} ${m.weapon} magazine`, s.id);
      for (const code of ['MOB', 'AW', 'STW', 'CCC', 'COD']) this.set(`${s.id}/${code}`, `${s.name} ${code} (DRRS-N)`, s.id);
    }
    for (const g of model.groups) this.set(g.id, g.name);
    for (const n of model.network.nodes) this.set(n.id, n.name);
    for (const u of model.unreps) for (const d of u.departFrom) this.set(`${u.id}/${d.hub}`, `${u.label} from ${this.label(d.hub)}`);
    for (const st of model.strikes) {
      this.set(st.id, st.name);
      if (st.relayVia) for (const sh of st.shooters) this.set(`${sh.ship}~${st.relayVia}`, `${this.shipName.get(sh.ship)} ↔ ${this.shipName.get(st.relayVia)} Link-16 relay range`, sh.ship);
    }
  }

  private set(id: string, label: string, owner?: string): void {
    this.labels.set(id, label);
    if (owner) this.owners.set(id, owner);
  }

  /** Learn labels from facts (parts named in CASREPs). */
  learn(facts: readonly Fact[]): void {
    for (const f of facts) {
      if (f.attr !== 'casrep' || !f.value || typeof f.value !== 'object') continue;
      const v = f.value as { part?: string; partLabel?: string };
      if (v.part && !this.labels.has(v.part)) {
        this.labels.set(v.part, v.partLabel ?? v.part);
        const o = this.ownerOf(f.entity);
        if (o) this.owners.set(v.part, o);
      }
    }
  }

  label(id: string): string {
    return this.labels.get(id) ?? id;
  }

  /** Ship an entity belongs to, if any (ddgB-satcom → ddgB, ddgB/TLAM → ddgB, ddgB~cg → ddgB). */
  ownerOf(entity: string): string | undefined {
    const known = this.owners.get(entity);
    if (known) return known;
    const ids = [...this.shipName.keys()].sort((a, b) => b.length - a.length);
    return ids.find((s) => entity === s || entity.startsWith(`${s}-`) || entity.startsWith(`${s}/`) || entity.startsWith(`${s}~`));
  }
}

const ATTR_LABEL: Record<string, string> = {
  ready_at: 'available', duration_h: 'duration', outage: 'outage', person_unavailable: 'unavailable', uncertainty: 'uncertainty',
  part_eta: 'ETA', part_at: 'location', fuel_pct: 'fuel', casrep: 'CASREP', node_status: 'status', magazine: 'magazine',
  met_assessment: 'DRRS-N assessment', emcon: 'EMCON', in_relay_range: 'relay range', unrep_ready_at: 'ready',
};

export function attrLabel(attr: string): string {
  return ATTR_LABEL[attr] ?? attr.replace(/_/g, ' ');
}

/** One value as a short phrase. `time` formats scenario hours. */
export function valueText(attr: string, type: string | undefined, v: unknown, time: (t: number) => string, unit?: string, label?: (id: string) => string): string {
  if (v === undefined) return '—';
  if (v === null) return 'not known';
  if (attr === 'casrep' && typeof v === 'object') {
    const c = v as { category?: string; partLabel?: string; narrative?: string };
    return `${c.category ?? 'CASREP'}${c.narrative ? `: ${c.narrative}` : ''}${c.partLabel ? ` (needs ${c.partLabel})` : ''}`;
  }
  if (attr === 'uncertainty' && typeof v === 'object') {
    const u = v as { min?: number; mode?: number; max?: number };
    return `${u.min ?? 0}h / ${u.mode ?? 0}h / ${u.max ?? 0}h spread`;
  }
  if (type === 'intervals' && Array.isArray(v)) return (v as number[][]).map(([a, b]) => `${time(a)} to ${Number.isFinite(b) ? time(b) : 'further notice'}`).join(', ') || 'none';
  if (type === 'hours' && typeof v === 'number') return attr === 'duration_h' ? `${Math.round(v * 10) / 10} h` : time(v);
  if (typeof v === 'number') return `${Math.round(v * 10) / 10}${unit === '%' || attr === 'fuel_pct' ? '%' : unit ? ` ${unit}` : ''}`;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string') return label && attr === 'part_at' ? label(v) : v;
  return JSON.stringify(v);
}
