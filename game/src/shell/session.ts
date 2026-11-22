import type { Engine } from '../engine/engine';
import type { Session } from './types';

export const HISTORY_LIMIT = 500;
export const HOME = '/srv/juice-shop';

/** A fresh session per shell: no module-level state (R1.3). */
export function createSession(engine: Engine): Session {
  void engine; // the session holds no Engine data; the parameter keeps the design's signature
  return { cwd: HOME, history: [], runCount: 0, overlay: new Map() };
}

/**
 * Stores a command line unmodified and counts it (R1.6). A whitespace-only line is
 * neither stored nor counted (R1.5). Only the last 500 lines are kept (R12.3).
 */
export function recordLine(session: Session, line: string): void {
  if (line.trim() === '') return;
  session.history.push(line);
  session.runCount += 1;
  if (session.history.length > HISTORY_LIMIT) {
    session.history.splice(0, session.history.length - HISTORY_LIMIT);
  }
}

/** The numbered `history` lines; numbering continues from the running count (R12.3). */
export function historyEntries(session: Session): { n: number; line: string }[] {
  const count = session.history.length;
  return session.history.map((line, i) => ({ n: session.runCount - count + 1 + i, line }));
}
