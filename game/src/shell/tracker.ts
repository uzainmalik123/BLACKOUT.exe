// Read tracking (PRD SYS-09, D-98, R14.4-14.7): one ReadTracker per command line. Each kind of read
// (log DEF-01, database DEF-02, uploads DEF-03) is sent to the Engine at most once per line.
import type { Engine } from '../engine/engine';
import type { ReadTrackerLike } from './types';

type Kind = 'log' | 'db' | 'uploads';

export class ReadTracker implements ReadTrackerLike {
  private readonly kinds = new Set<Kind>();

  /**
   * Bare `message` of every `ok: false` answer, in order. The tracker does not know the command name,
   * so the caller (exec) prints each one as `<cmd>: <message>` (R14.6). The read itself still prints
   * and the exit code is unchanged.
   */
  readonly notices: string[] = [];

  constructor(
    private readonly engine: Pick<Engine, 'act'>,
    /** The whole command line, sent as the DEF-01 query. */
    private readonly line: string,
  ) {}

  get sent(): ReadonlySet<Kind> {
    return this.kinds;
  }

  log(): string | undefined {
    return this.send('log', { type: 'DEF-01', query: this.line });
  }

  /** `sql` is the first SQL text read in the line; later calls are ignored. */
  db(sql: string): string | undefined {
    return this.send('db', { type: 'DEF-02', sql });
  }

  /** `absPath` stays absolute (R14.5, D-100). Only the first path of the line is sent. */
  uploads(absPath: string): string | undefined {
    return this.send('uploads', { type: 'DEF-03', path: absPath });
  }

  private send(kind: Kind, action: Parameters<Engine['act']>[0]): string | undefined {
    if (this.kinds.has(kind)) return undefined;
    this.kinds.add(kind); // marked before act: a refusal is never retried (R14.6)
    const result = this.engine.act(action);
    if (result.ok) return undefined;
    this.notices.push(result.message);
    return result.message;
  }
}
