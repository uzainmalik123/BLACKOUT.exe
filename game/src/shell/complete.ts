// Easy-only autocomplete (R13, D-94). Pure over the session and the VFS lister: no reads, no writes, no actions.

import { resolvePath } from './path';
import { COMMAND_NAMES } from './registry';
import { HOME } from './session';
import { compareCodePoints } from './text';
import type { Session } from './types';

/** The part of the VFS that completion needs. */
export interface CompleteFs {
  list(abs: string): string[] | undefined;
  stat(abs: string): { kind: 'dir' | 'file' } | undefined;
}

export const MAX_COMPLETIONS = 20;

function finish(items: Iterable<string>): string[] {
  return [...new Set(items)].sort(compareCodePoints).slice(0, MAX_COMPLETIONS);
}

/** Candidates for `partial`. Never throws; returns `[]` on any failure. */
export function complete(session: Pick<Session, 'cwd'>, vfs: CompleteFs, partial: string): string[] {
  try {
    if (!partial.includes(' ')) {
      return finish(COMMAND_NAMES.filter((name) => name.startsWith(partial)));
    }

    const word = partial.slice(partial.lastIndexOf(' ') + 1);
    if (word === '~') return ['~/'];

    const slash = word.lastIndexOf('/');
    const dirPart = word.slice(0, slash + 1); // as typed, keeps a leading `~`
    const prefix = word.slice(slash + 1);
    const lookupDir = dirPart === '' ? session.cwd : resolvePath(session.cwd, expandHome(dirPart));

    const names = vfs.list(lookupDir);
    if (!names) return [];

    const out: string[] = [];
    for (const name of names) {
      if (!name.startsWith(prefix)) continue;
      if (name.startsWith('.') && !prefix.startsWith('.')) continue;
      const child = lookupDir === '/' ? `/${name}` : `${lookupDir}/${name}`;
      const isDir = vfs.stat(child)?.kind === 'dir';
      out.push(`${dirPart}${name}${isDir ? '/' : ''}`);
    }
    return finish(out);
  } catch {
    return [];
  }
}

function expandHome(dirPart: string): string {
  return dirPart.startsWith('~/') ? `${HOME}${dirPart.slice(1)}` : dirPart;
}
