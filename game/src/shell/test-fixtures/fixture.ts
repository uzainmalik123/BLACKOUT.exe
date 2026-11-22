/// <reference types="node" />
// TEST-ONLY. The Shell's test fixture (R16.7: no network, a seeded World, the committed baseline). Builds an Engine
// the way the engine tests do; the shell field is wired in task 5.4.
import { readFileSync } from 'node:fs';
import { Engine } from '../../engine/engine';
import { eventsOfKind, type GameEvent } from '../../engine/log';
import type { VFile, World } from '../../engine/state';
import { sha256Hex } from '../sha256';
import type { Difficulty, PlayerAction } from '../../rules/vocabulary';
import { createShell } from '../index';
import type { Shell } from '../types';

export { WHOLE_RUN_TIMEOUT_MS } from '../../engine/test-fixtures/timeouts';

/** The committed baseline, read once for the whole test file. */
const BASELINE: Uint8Array = readFileSync(new URL('../../recordings/juiceshop.sqlite', import.meta.url));

export interface FixtureOptions {
  difficulty?: Difficulty;
  seed?: number;
  /** false builds an Engine with no database (sqlite3 then answers `Error: database is unavailable`). Default true. */
  baseline?: boolean;
  /** Files to plant in the World (`world.files`) before anything else. */
  plant?: PlantSpec[];
  /** Game time to advance (Engine.advance, in real ms) so the logs fill, after planting. */
  advanceMs?: number;
  /** Evidence snapshots to take (`engine.act({ type: 'DEF-05', name })`), after `advanceMs`. */
  evidence?: string[];
}

/**
 * A file to plant. `path` is relative to uploads/. With `content`, size, sha256 and `contentBase64` are derived;
 * without it the file is planted with no `contentBase64` (size and sha256 from the spec, or 0 and 64 zeros).
 */
export interface PlantSpec {
  path: string;
  content?: string | Uint8Array;
  size?: number;
  sha256?: string;
  plantedBy?: VFile['plantedBy'];
}

function toVFile(p: PlantSpec): VFile {
  const file: VFile = { path: p.path, size: p.size ?? 0, sha256: p.sha256 ?? '0'.repeat(64) };
  if (p.content !== undefined) {
    const bytes = typeof p.content === 'string' ? new TextEncoder().encode(p.content) : p.content;
    file.size = p.size ?? bytes.length;
    file.sha256 = p.sha256 ?? sha256Hex(bytes);
    file.contentBase64 = Buffer.from(bytes).toString('base64');
  }
  if (p.plantedBy !== undefined) file.plantedBy = p.plantedBy;
  return file;
}

export type ActionEvent = Extract<GameEvent, { kind: 'action' }>;

export interface Fixture {
  engine: Engine;
  /** `createShell(engine)` with `onInternalError` pushing into `internalErrors`. */
  shell: Shell;
  world: World;
  /** Every player action event so far (`eventsOfKind(world, 'action')`). */
  actions(): ActionEvent[];
  /** The actions of one type, in order. */
  actsOfType<T extends PlayerAction['type']>(t: T): Extract<PlayerAction, { type: T }>[];
  /** A deep copy of the World minus the DEF-01..03 read-action events. */
  worldWithoutReads(): unknown;
  /** Everything the Shell reported through `onInternalError` (filled once task 5.4 wires it). */
  internalErrors: unknown[];
}

const READ_ACTIONS = new Set<PlayerAction['type']>(['DEF-01', 'DEF-02', 'DEF-03']);

export function makeFixture(opts: FixtureOptions = {}): Fixture {
  const { difficulty = 'medium', seed = 1, baseline = true } = opts;
  const engine = new Engine({ seed, difficulty, ...(baseline ? { baseline: BASELINE } : {}) });
  const world = engine.world;
  for (const p of opts.plant ?? []) world.files.push(toVFile(p));
  if (opts.advanceMs) engine.advance(opts.advanceMs);
  for (const name of opts.evidence ?? []) {
    const r = engine.act({ type: 'DEF-05', name });
    if (!r.ok) throw new Error(`makeFixture: evidence '${name}' refused: ${r.message}`);
  }
  const actions = (): ActionEvent[] => eventsOfKind(world, 'action');
  const internalErrors: unknown[] = [];
  const shell = createShell(engine, { onInternalError: (e) => internalErrors.push(e) });
  return {
    engine,
    shell,
    world,
    actions,
    actsOfType: (t) => actions().map((e) => e.action).filter((a): a is Extract<PlayerAction, { type: typeof t }> => a.type === t),
    worldWithoutReads: () => {
      const copy = structuredClone(world);
      copy.events = copy.events.filter((e) => !(e.kind === 'action' && READ_ACTIONS.has(e.action.type)));
      return copy;
    },
    internalErrors,
  };
}
