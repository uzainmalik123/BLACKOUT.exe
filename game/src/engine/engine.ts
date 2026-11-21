// The engine the game runs: one World, the recordings it may play, and the sql.js copy the shell's `sqlite3`
// reads. The UI and the shell talk to this class; everything underneath is pure functions over the World.
import type { Recording } from '../recordings/format';
import type { Difficulty, PlayerAction } from '../rules/vocabulary';
import { applyAction, type ActionResult } from './actions';
import { advance } from './advance';
import { pause, resume } from './clock';
import { libraryFrom, type RecordingLibrary } from './library';
import { renderAccessLog, renderAppLog } from './replay';
import { openBaseline, syncDb, type GameDb } from './sqldb';
import { initialWorld, type Evidence, type VFile, type World } from './state';

/**
 * Every recording committed in src/recordings/ (REC-02), bundled by Vite (KI-17). Test-only variants such as
 * ATK-08.a, and the retired ATK-08.b/.c, stay in the library; the Director plays only ATK-08's halves (D-31, D-42: `pinnedVariants` in config.ts).
 */
const COMMITTED = import.meta.glob<Recording>('../recordings/*.json', { eager: true, import: 'default' });
export const COMMITTED_LIBRARY: RecordingLibrary = libraryFrom(Object.keys(COMMITTED).sort().map((path) => COMMITTED[path]!));

export interface EngineOptions {
  seed: number;
  difficulty: Difficulty;
  library?: RecordingLibrary;
  baseline?: Uint8Array; // juiceshop.sqlite; needed for db()
}

export class Engine {
  readonly world: World;
  private readonly library: RecordingLibrary;
  private readonly baseline: Uint8Array | undefined;
  private gameDb: Promise<GameDb> | undefined;
  private readonly listeners = new Set<(world: World) => void>();

  constructor(opts: EngineOptions) {
    this.world = initialWorld(opts.seed, opts.difficulty);
    this.library = opts.library ?? COMMITTED_LIBRARY;
    this.baseline = opts.baseline;
  }

  advance(realMs: number): void {
    advance(this.world, this.library, realMs);
    this.notify();
  }

  act(action: PlayerAction): ActionResult {
    const result = applyAction(this.world, action);
    advance(this.world, this.library, 0); // let a cut or an ending show on the same call
    this.notify();
    return result;
  }

  pause(): boolean {
    return pause(this.world);
  }

  resume(): void {
    resume(this.world);
  }

  /** The sql.js database, brought up to date with the world on every call. */
  async db(): Promise<GameDb> {
    if (!this.baseline) throw new Error('Engine.db() needs the baseline juiceshop.sqlite bytes (EngineOptions.baseline)');
    this.gameDb ??= openBaseline(this.baseline);
    const g = await this.gameDb;
    syncDb(g, this.world);
    return g;
  }

  accessLog(): string {
    return renderAccessLog(this.world);
  }

  appLog(): string {
    return renderAppLog(this.world);
  }

  files(): VFile[] {
    return this.world.files.map((f) => ({ ...f }));
  }

  evidence(): Evidence[] {
    return this.world.evidence.map((e) => ({ ...e }));
  }

  subscribe(fn: (world: World) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.world);
  }
}
