// What this browser has already been shown (D-252): the night shift's prologue (so it can be skipped next time) and
// the opening tutorial (shown on the first shift only). Kept in localStorage; when storage is missing or blocked
// (a private window, a test) everything counts as never seen, so a player is never denied the first time.

const KEY = { prologue: 'blackout.seen.prologue', tutorial: 'blackout.seen.tutorial' } as const;

export type Seen = keyof typeof KEY;

export function seen(what: Seen): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY[what]) === '1';
  } catch {
    return false;
  }
}

export function markSeen(what: Seen): void {
  try {
    globalThis.localStorage?.setItem(KEY[what], '1');
  } catch {
    // not kept: the next visit shows it again
  }
}

/** Forget one (the tutorial's "show it again"). */
export function forget(what: Seen): void {
  try {
    globalThis.localStorage?.removeItem(KEY[what]);
  } catch {
    // nothing kept anyway
  }
}
