import { canonical, sha256 } from '../core/hash';
import type { Readiness } from '../core/graph';
import type { Patch } from '../core/patch';

/**
 * Human authority, recorded. Every approval, rejection, modification,
 * override, STOP and resume is an append-only, hash-chained entry that names
 * who decided, on which facts (fact-log head) and which computed picture
 * (graph and result hashes). Approved options become planning assumptions
 * inside the engine only; nothing here writes to an authoritative system.
 */
export type DecisionKind = 'approve' | 'reject' | 'modify' | 'withdraw' | 'monitor' | 'override' | 'stop' | 'resume' | 'note';

export interface Actor {
  id: string;
  role: string;
}

export interface DecisionInput {
  kind: DecisionKind;
  at: number;
  actor: Actor;
  lever?: string;
  requirement?: string;
  note?: string;
  /** For modify: the patches the human approved instead of the lever's own. */
  patches?: Patch[];
  /** For override: the human's assessment shown beside (never instead of) the engine's. */
  status?: Readiness;
  basis?: { factsHead?: string; graphHash?: string; resultHash?: string };
  wallClock?: string;
}

export interface Decision extends DecisionInput {
  seq: number;
  prevHash: string;
  hash: string;
}

const GENESIS = '0'.repeat(64);

function entryHash(prev: string, d: DecisionInput & { seq: number }): string {
  return sha256(prev + canonical(d));
}

export class DecisionLog {
  private entries: Decision[] = [];

  record(input: DecisionInput): Decision {
    const needsNote: DecisionKind[] = ['reject', 'modify', 'override', 'stop', 'withdraw'];
    if (needsNote.includes(input.kind) && !input.note?.trim()) throw new Error(`${input.kind} requires a note explaining why`);
    if (['approve', 'reject', 'modify', 'withdraw'].includes(input.kind) && !input.lever) throw new Error(`${input.kind} requires a lever id`);
    if (input.kind === 'modify' && !input.patches?.length) throw new Error('modify requires the modified patches');
    if (input.kind === 'override' && (!input.requirement || !input.status)) throw new Error('override requires a requirement and a status');
    if (input.kind === 'resume' && !this.isStopped(input.at)) throw new Error('resume without an active STOP');
    if (['approve', 'modify'].includes(input.kind) && this.isStopped(input.at)) throw new Error('advisory output is stopped; resume before approving');
    const seq = this.entries.length;
    const prevHash = seq ? this.entries[seq - 1].hash : GENESIS;
    const body = { ...input, seq };
    const d: Decision = { ...body, prevHash, hash: entryHash(prevHash, body) };
    this.entries.push(d);
    return d;
  }

  approve(lever: string, actor: Actor, at: number, note?: string, basis?: DecisionInput['basis']): Decision {
    return this.record({ kind: 'approve', lever, actor, at, note, basis });
  }
  reject(lever: string, actor: Actor, at: number, note: string, basis?: DecisionInput['basis']): Decision {
    return this.record({ kind: 'reject', lever, actor, at, note, basis });
  }
  modify(lever: string, patches: Patch[], actor: Actor, at: number, note: string, basis?: DecisionInput['basis']): Decision {
    return this.record({ kind: 'modify', lever, patches, actor, at, note, basis });
  }
  withdraw(lever: string, actor: Actor, at: number, note: string): Decision {
    return this.record({ kind: 'withdraw', lever, actor, at, note });
  }
  monitor(requirement: string, actor: Actor, at: number, note?: string): Decision {
    return this.record({ kind: 'monitor', requirement, actor, at, note });
  }
  override(requirement: string, status: Readiness, actor: Actor, at: number, note: string): Decision {
    return this.record({ kind: 'override', requirement, status, actor, at, note });
  }
  stop(actor: Actor, at: number, note: string): Decision {
    return this.record({ kind: 'stop', actor, at, note });
  }
  resume(actor: Actor, at: number, note?: string): Decision {
    return this.record({ kind: 'resume', actor, at, note });
  }

  all(): readonly Decision[] {
    return this.entries;
  }

  head(): string {
    return this.entries.length ? this.entries[this.entries.length - 1].hash : GENESIS;
  }

  isStopped(asOf = Infinity): boolean {
    let stopped = false;
    for (const d of this.entries) {
      if (d.at > asOf) continue;
      if (d.kind === 'stop') stopped = true;
      if (d.kind === 'resume') stopped = false;
    }
    return stopped;
  }

  /** Levers in force as planning assumptions at `asOf`: latest approve/modify not later rejected or withdrawn. */
  activeLevers(asOf = Infinity): Map<string, Decision> {
    const m = new Map<string, Decision>();
    for (const d of this.entries) {
      if (d.at > asOf || !d.lever) continue;
      if (d.kind === 'approve' || d.kind === 'modify') m.set(d.lever, d);
      if (d.kind === 'reject' || d.kind === 'withdraw') m.delete(d.lever);
    }
    return m;
  }

  overrides(asOf = Infinity): Map<string, Decision> {
    const m = new Map<string, Decision>();
    for (const d of this.entries) if (d.at <= asOf && d.kind === 'override' && d.requirement) m.set(d.requirement, d);
    return m;
  }

  verify(): { ok: boolean; brokenAt?: number } {
    let prev = GENESIS;
    for (let i = 0; i < this.entries.length; i++) {
      const { hash, prevHash, ...body } = this.entries[i];
      if (prevHash !== prev || entryHash(prev, body) !== hash) return { ok: false, brokenAt: i };
      prev = hash;
    }
    return { ok: true };
  }

  /** Test hook for the tamper demo: mutate an entry in place without re-hashing. */
  unsafeTamper(i: number, fields: Partial<DecisionInput>): void {
    Object.assign(this.entries[i], fields);
  }

  /** Restore entries that differ from a verified edge copy (store-and-forward recovery). */
  restoreFrom(copy: DecisionLog): { restored: number[] } {
    if (!copy.verify().ok) throw new Error('edge copy does not verify');
    const restored: number[] = [];
    copy.all().forEach((d, i) => {
      if (!this.entries[i] || this.entries[i].hash !== d.hash || entryHash(d.prevHash, (({ hash: _h, prevHash: _p, ...b }) => b)(this.entries[i])) !== d.hash) {
        this.entries[i] = structuredClone(d);
        restored.push(i);
      }
    });
    return { restored };
  }

  clone(): DecisionLog {
    const c = new DecisionLog();
    c.entries = structuredClone(this.entries);
    return c;
  }

  toJSONL(): string {
    return this.entries.map((e) => canonical(e)).join('\n');
  }
}
