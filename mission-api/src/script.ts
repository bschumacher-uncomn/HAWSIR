import type { FactInput, MissionDef, ScenarioEvent } from './engine';
import type { Labels } from './labels';

/**
 * A mission's watch script as deliverable injects. Each scripted report keeps
 * its event id, so the UI can show "the CASREP landed" while the store only
 * ever sees facts. With split delivery, each fact arrives where it would
 * originate: a ship's own maintenance, personnel and fuel reports on that
 * ship; supply, tracking and fleet reports (and other ships' reports) ashore.
 */
export interface Inject {
  id: string;
  eventId: string;
  at: number;
  kind: 'fact' | 'link';
  label: string;
  origin: 'ship' | 'shore';
  ship?: string;
  fact?: FactInput;
  /** Content id of the fact (filled in by the runtime). */
  factId?: string;
  link?: { up: boolean; reason: string; ship: string };
}

export function missionScript(def: MissionDef, events: ScenarioEvent[], labels: Labels): Inject[] {
  const out: Inject[] = [];
  for (const e of events) {
    e.facts.forEach((f, i) => {
      const owner = labels.ownerOf(f.entity);
      const shipSide = def.splitDelivery ? def.delivery?.[f.source.system] === 'ship' && owner !== undefined : true;
      out.push({
        id: `${e.id}:${i}`, eventId: e.id, at: Math.max(e.t, f.recordedAt), kind: 'fact',
        label: `${f.source.system}: ${f.reason ?? e.title}`,
        origin: shipSide ? 'ship' : 'shore', ship: shipSide ? owner ?? def.display.ownShip.id : undefined, fact: f,
      });
    });
    if (e.link) out.push({ id: `${e.id}:link`, eventId: e.id, at: e.t, kind: 'link', label: e.title, origin: 'ship', ship: e.link.ship, link: e.link });
  }
  return out.sort((a, b) => a.at - b.at || (a.kind === 'link' ? 1 : -1));
}
