// The recordings the engine can play, grouped by move (SYS-03). The game injects the committed ones;
// the sims inject made-up ones from src/engine/test-fixtures/.
import { validateRecording, type Recording } from '../recordings/format';
import type { CustomerId, MinionId, MoveId } from '../rules/vocabulary';
import type { VariantInfo } from './facts';
import { SEED_ACCOUNTS } from './seed';

export interface Variant {
  move: MoveId | MinionId | CustomerId;
  variant: string;
  recording: Recording;
  info: VariantInfo;
}

export interface RecordingLibrary {
  variantsOf(move: MoveId | MinionId | CustomerId): Variant[]; // 'CUST': the customer traffic (REC-06), which SYS-19 plays, never the Director
}

export const EMPTY_LIBRARY: RecordingLibrary = { variantsOf: () => [] };

/** What the engine needs to know about a recording before playing it (D-24). */
export function variantInfo(r: Recording): VariantInfo {
  const targets = new Set<string>();
  const userAgents = new Set<string>();
  for (const e of r.events) {
    if (e.kind === 'access') userAgents.add(e.userAgent);
    if (e.kind !== 'db' || e.table !== 'Users') continue;
    const email = e.after?.email ?? e.before?.email ?? SEED_ACCOUNTS.find((a) => a.id === Number(Object.values(e.key)[0]))?.email;
    if (typeof email === 'string') targets.add(email); // a real update carries only the changed columns (D-15): the id names the user
  }
  return { ip: r.attackerIp, quiet: r.label.toLowerCase().startsWith('quiet'), targets: [...targets], move: r.move, variant: r.variant, userAgents: [...userAgents] };
}

/** Builds a library; throws when a recording fails D-15 validation. Variants come back sorted by name. */
export function libraryFrom(recordings: Recording[]): RecordingLibrary {
  const byMove = new Map<string, Variant[]>();
  for (const r of recordings) {
    const errors = validateRecording(r);
    if (errors.length > 0) throw new Error(`${r.move}.${r.variant}: ${errors.join('; ')}`);
    const list = byMove.get(r.move) ?? [];
    list.push({ move: r.move as MoveId | MinionId | CustomerId, variant: r.variant, recording: r, info: variantInfo(r) });
    byMove.set(r.move, list);
  }
  for (const list of byMove.values()) list.sort((a, b) => a.variant.localeCompare(b.variant));
  return { variantsOf: (move) => byMove.get(move) ?? [] };
}
