// Tilde and glob expansion (R3.10 to R3.12, R3.15, D-93, D-104). Runs at execution time,
// per stage, against the read-only VfsLister. A glob never counts as a read of uploads/.

import { resolvePath } from './path';
import { compareCodePoints } from './text';
import type { VfsLister, Word } from './types';

const HOME = '/srv/juice-shop';

/** The only part of the session expansion needs. */
export interface SessionView {
  cwd: string;
}

/** Which slot of the stage a word fills. Only `arg` words are glob-expanded. */
export type WordRole = 'arg' | 'command' | 'redirect';

/** `~` or `~/x` becomes `/srv/juice-shop` or `/srv/juice-shop/x`. Anything else is unchanged. */
export function expandTilde(text: string): string {
  if (text === '~') return HOME;
  if (text.startsWith('~/')) return HOME + text.slice(1);
  return text;
}

/** Does `name` match one path segment where `*` is any run of characters? Leading-dot rule applies. */
function segmentMatches(segment: string, name: string): boolean {
  if (name.startsWith('.') && !segment.startsWith('.')) return false;
  const parts = segment.split('*');
  if (parts.length === 1) return name === segment;
  const first = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  if (!name.startsWith(first) || !name.endsWith(last)) return false;
  let pos = first.length;
  if (name.length - pos < last.length) return false;
  const end = name.length - last.length;
  for (const mid of parts.slice(1, -1)) {
    const at = name.indexOf(mid, pos);
    if (at < 0 || at + mid.length > end) return false;
    pos = at + mid.length;
  }
  return pos <= end;
}

function joinShown(shown: string, seg: string): string {
  if (shown === '') return seg;
  if (shown === '/') return `/${seg}`;
  return `${shown}/${seg}`;
}

/**
 * Expands `*` in `pattern`, walking the file system one segment at a time. Results keep the
 * prefix form the player typed, are sorted by code point, and the list is `[pattern]` when
 * nothing matches.
 */
export function globExpand(pattern: string, cwd: string, vfs: VfsLister): string[] {
  const absolute = pattern.startsWith('/');
  const trailingSlash = pattern.length > 1 && pattern.endsWith('/');
  const segments = pattern.split('/').filter((s) => s !== '');
  let cands: { abs: string; shown: string }[] = [
    { abs: absolute ? '/' : cwd, shown: absolute ? '/' : '' },
  ];
  for (const seg of segments) {
    const next: { abs: string; shown: string }[] = [];
    for (const c of cands) {
      if (!seg.includes('*')) {
        const abs = resolvePath(c.abs, seg);
        if (vfs.stat(abs)) next.push({ abs, shown: joinShown(c.shown, seg) });
        continue;
      }
      const names = vfs.list(c.abs);
      if (!names) continue;
      for (const name of names) {
        if (segmentMatches(seg, name)) {
          next.push({ abs: resolvePath(c.abs, name), shown: joinShown(c.shown, name) });
        }
      }
    }
    cands = next;
    if (cands.length === 0) break;
  }
  const out = cands
    .filter((c) => !trailingSlash || vfs.stat(c.abs)?.kind === 'dir')
    .map((c) => (trailingSlash ? `${c.shown}/` : c.shown));
  if (out.length === 0) return [pattern];
  return out.sort(compareCodePoints);
}

/**
 * Expands one word. `literal` words stay as they are. The command name is never expanded here,
 * and a redirect target gets `~` only (D-104).
 */
export function expandWord(
  w: Word,
  session: SessionView,
  vfs: VfsLister,
  role: WordRole = 'arg',
): string[] {
  if (w.literal || role === 'command') return [w.text];
  const text = expandTilde(w.text);
  if (role === 'redirect' || !text.includes('*')) return [text];
  return globExpand(text, session.cwd, vfs);
}
