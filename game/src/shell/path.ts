// Pure path helpers for the Virtual_FS (R4.9). Paths are POSIX-style strings.

import { compareCodePoints } from './text';

/** Orders names by UTF-8 byte order (same as code point order). */
export function byteCompare(a: string, b: string): number {
  return compareCodePoints(a, b);
}

/**
 * Joins `input` onto `cwd` and returns an absolute path with `.` and `..` collapsed.
 * `..` at `/` stays at `/`. No trailing `/` except the root itself. An empty input is `cwd`.
 */
export function resolvePath(cwd: string, input: string): string {
  const joined = input.startsWith('/') ? input : `${cwd}/${input}`;
  const out: string[] = [];
  for (const seg of joined.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return `/${out.join('/')}`;
}

function trimTrailing(p: string): string {
  let end = p.length;
  while (end > 1 && p[end - 1] === '/') end--;
  return p.slice(0, end);
}

/** Parent directory. `dirname('/a')` is `/`; `dirname('/')` is `/`; no slash gives `.`. */
export function dirname(p: string): string {
  const t = trimTrailing(p);
  const i = t.lastIndexOf('/');
  if (i < 0) return '.';
  if (i === 0) return '/';
  return t.slice(0, i);
}

/** Last segment. `basename('/')` is `/`. */
export function basename(p: string): string {
  const t = trimTrailing(p);
  if (t === '/') return '/';
  return t.slice(t.lastIndexOf('/') + 1);
}
