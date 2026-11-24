// Read tracking (PRD SYS-09, D-98, D-160, R14.4-14.8): one ReadTracker per command line. Each kind of read
// (log DEF-01, database DEF-02, uploads DEF-03) is queued at its first read and sent to the Engine
// once, by `flush`, when the line finishes, carrying what reached the player's screen.
import type { Engine } from '../engine/engine';
import { SHOWN_LINES_MAX } from '../rules/vocabulary';
import { splitLines } from './text';
import type { ReadTrackerLike } from './types';

type Kind = 'log' | 'db' | 'uploads';
type ReadAction = { type: 'DEF-01'; query: string } | { type: 'DEF-02'; sql: string } | { type: 'DEF-03'; path: string };

export class ReadTracker implements ReadTrackerLike {
  private readonly kinds = new Set<Kind>();
  private readonly queue: { kind: Kind; action: ReadAction; cmd: string }[] = [];

  /**
   * Refused answers (possible only after an ending), in order, with the command that first queued the
   * kind. Filled by `flush`; the caller prints each as `<cmd>: <message>` (R14.6).
   */
  readonly notices: { cmd: string; message: string }[] = [];

  /** Name of the command now running; exec sets it before each stage. Recorded as `cmd` on queueing. */
  stage = '';

  constructor(
    private readonly engine: Pick<Engine, 'act'>,
    /** The whole command line, sent as the DEF-01 query. */
    private readonly line: string,
  ) {}

  get sent(): ReadonlySet<Kind> {
    return this.kinds;
  }

  log(): void {
    this.enqueue('log', { type: 'DEF-01', query: this.line });
  }

  /** `sql` is the first SQL text read in the line; later calls are ignored. */
  db(sql: string): void {
    this.enqueue('db', { type: 'DEF-02', sql });
  }

  /** `absPath` stays absolute (R14.5, D-100). Only the first path of the line is queued. */
  uploads(absPath: string): void {
    this.enqueue('uploads', { type: 'DEF-03', path: absPath });
  }

  /**
   * Sends the queued actions in queue order, all with the same `shown` (first SHOWN_LINES_MAX lines of the
   * line's final stdout) and `shownTotal` (its full line count). Stops after the first refusal (R14.6).
   * Call once per line.
   */
  flush(finalStdout: string): void {
    const lines = splitLines(finalStdout);
    const queued = this.queue.splice(0);
    for (const { action, cmd } of queued) {
      const result = this.engine.act({ ...action, shown: lines.slice(0, SHOWN_LINES_MAX), shownTotal: lines.length });
      if (!result.ok) {
        this.notices.push({ cmd, message: result.message });
        return;
      }
    }
  }

  private enqueue(kind: Kind, action: ReadAction): void {
    if (this.kinds.has(kind)) return;
    this.kinds.add(kind); // marked first: a kind is never queued twice
    this.queue.push({ kind, action, cmd: this.stage });
  }
}
