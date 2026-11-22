// Shell archives (D-109): the gzip magic, then a canonical listing of entries. Not compressed.
// Layout: 1f 8b 08 00 | u32 count | per entry: u8 type (0 file, 1 dir) | u32 pathLen | path (UTF-8)
// | u32 byteLen | bytes. Integers are big-endian. Same entries always give the same bytes.

import type { ArchiveEntry } from './types';
import { byteCompare } from './path';

const MAGIC = [0x1f, 0x8b, 0x08, 0x00];
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

/** Serializes entries into the canonical archive byte string. */
export function encodeArchive(entries: ArchiveEntry[]): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.from([...MAGIC, ...u32(entries.length)])];
  for (const e of entries) {
    const path = encoder.encode(e.path);
    parts.push(Uint8Array.from([e.type === 'dir' ? 1 : 0, ...u32(path.length)]));
    parts.push(path);
    parts.push(Uint8Array.from(u32(e.bytes.length)));
    parts.push(e.bytes);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Parses an archive. Returns undefined when the bytes are not a Shell archive. */
export function decodeArchive(bytes: Uint8Array): ArchiveEntry[] | undefined {
  if (bytes.length < 8) return undefined;
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC[i]) return undefined;
  let at = 4;
  const read32 = (): number | undefined => {
    if (at + 4 > bytes.length) return undefined;
    const b = (k: number): number => bytes[at + k] ?? 0;
    const v = ((b(0) << 24) | (b(1) << 16) | (b(2) << 8) | b(3)) >>> 0;
    at += 4;
    return v;
  };
  const count = read32();
  if (count === undefined) return undefined;
  const entries: ArchiveEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (at >= bytes.length) return undefined;
    const t = bytes[at++];
    if (t !== 0 && t !== 1) return undefined;
    const pathLen = read32();
    if (pathLen === undefined || at + pathLen > bytes.length) return undefined;
    let path: string;
    try {
      path = decoder.decode(bytes.subarray(at, at + pathLen));
    } catch {
      return undefined;
    }
    at += pathLen;
    const len = read32();
    if (len === undefined || at + len > bytes.length) return undefined;
    entries.push({ path, type: t === 1 ? 'dir' : 'file', bytes: bytes.slice(at, at + len) });
    at += len;
  }
  return at === bytes.length ? entries : undefined;
}

/**
 * The `tar tzf` lines: each source path in the order given, each followed by its descendants in
 * ascending order, directories with a trailing `/`, the leading `/` removed. A source is an entry
 * that lies below no other entry; entries below a source are its descendants.
 */
export function listArchive(entries: ArchiveEntry[]): string[] {
  const norm = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, '') : p);
  const paths: string[] = entries.map((e) => norm(e.path));
  const below = (p: string, root: string): boolean => p.startsWith(root === '/' ? '/' : `${root}/`) && p !== root;
  const line = (e: ArchiveEntry, p: string): string => {
    const s = p.replace(/^\/+/, '');
    return e.type === 'dir' && !s.endsWith('/') ? `${s}/` : s;
  };
  const lines: string[] = [];
  const seen = new Set<number>();
  entries.forEach((e, i) => {
    const p = paths[i] ?? e.path;
    if (seen.has(i) || paths.some((q, j) => j !== i && q !== p && below(p, q))) return;
    seen.add(i);
    lines.push(line(e, p));
    const kids = entries
      .map((k, j) => ({ k, j, p: paths[j] ?? k.path }))
      .filter((x) => !seen.has(x.j) && below(x.p, p))
      .sort((a, b) => byteCompare(a.p, b.p));
    for (const x of kids) {
      seen.add(x.j);
      lines.push(line(x.k, x.p));
    }
  });
  return lines;
}
