// Feature: shell, task 14.3: the archive byte format (D-109). **Validates: Requirements 8.1, 8.2, 8.7**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeArchive, encodeArchive, listArchive } from './archive-format';
import { sha256Hex } from './sha256';
import type { ArchiveEntry } from './types';

const enc = new TextEncoder();
const file = (path: string, text = ''): ArchiveEntry => ({ path, type: 'file', bytes: enc.encode(text) });
const dir = (path: string): ArchiveEntry => ({ path, type: 'dir', bytes: new Uint8Array() });

describe('encode/decode round trip', () => {
  it('keeps files, dirs, empty content and UTF-8 paths', () => {
    const entries = [dir('/srv/app'), file('/srv/app/a.txt', 'hello'), file('/tmp/empty'), file('/tmp/日本語/ü.log', 'ß')];
    expect(decodeArchive(encodeArchive(entries))).toEqual(entries);
  });

  it('keeps an empty archive and a leading U+FEFF in a path', () => {
    expect(decodeArchive(encodeArchive([]))).toEqual([]);
    const entries = [file('\uFEFF/x', 'a')];
    expect(decodeArchive(encodeArchive(entries))).toEqual(entries);
  });

  it('starts with the gzip magic', () => {
    expect([...encodeArchive([]).subarray(0, 4)]).toEqual([0x1f, 0x8b, 0x08, 0x00]);
  });
});

describe('determinism', () => {
  const base = [dir('/a'), file('/a/b', 'x')];
  it('gives the same bytes and digest for the same entries', () => {
    const one = encodeArchive(base);
    const two = encodeArchive([dir('/a'), file('/a/b', 'x')]);
    expect(two).toEqual(one);
    expect(sha256Hex(two)).toBe(sha256Hex(one));
    expect(sha256Hex(one)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs when content, path or type differs', () => {
    const h = (e: ArchiveEntry[]): string => sha256Hex(encodeArchive(e));
    const ref = h(base);
    expect(h([dir('/a'), file('/a/b', 'y')])).not.toBe(ref);
    expect(h([dir('/a'), file('/a/c', 'x')])).not.toBe(ref);
    expect(h([dir('/a'), { ...file('/a/b', 'x'), type: 'dir' }])).not.toBe(ref);
  });
});

describe('decodeArchive rejects malformed input', () => {
  const good = encodeArchive([file('/a', 'xyz'), dir('/d')]);
  it('bad magic', () => {
    const b = good.slice();
    b[0] = 0;
    expect(decodeArchive(b)).toBeUndefined();
    expect(decodeArchive(new Uint8Array())).toBeUndefined();
  });
  it('truncated at every length', () => {
    for (let n = 0; n < good.length; n++) expect(decodeArchive(good.subarray(0, n))).toBeUndefined();
  });
  it('bad type byte', () => {
    const b = good.slice();
    b[8] = 2;
    expect(decodeArchive(b)).toBeUndefined();
  });
  it('trailing bytes', () => {
    const b = new Uint8Array(good.length + 1);
    b.set(good);
    expect(decodeArchive(b)).toBeUndefined();
  });
  it('invalid UTF-8 in a path', () => {
    const b = encodeArchive([file('/a')]);
    // layout: magic(4) count(4) type(1) pathLen(4) path...
    b[13 + 1] = 0xff;
    expect(decodeArchive(b)).toBeUndefined();
  });
});

describe('listArchive', () => {
  it('lists sources in given order, descendants ascending, dirs with /, no leading /', () => {
    const entries = [
      file('/tmp/z.txt'),
      dir('/var/log'),
      file('/var/log/nginx/access.log'),
      dir('/var/log/nginx'),
      file('/var/log/app.log'),
      file('/etc/hosts'),
    ];
    expect(listArchive(entries)).toEqual([
      'tmp/z.txt',
      'var/log/',
      'var/log/app.log',
      'var/log/nginx/',
      'var/log/nginx/access.log',
      'etc/hosts',
    ]);
  });

  it('lists a lone directory with a trailing slash', () => {
    expect(listArchive([dir('/srv')])).toEqual(['srv/']);
  });
});

describe('Property: encode then decode is the identity', () => {
  const arbEntry = fc.record({
    path: fc.string({ minLength: 1, maxLength: 40 }).map((s) => `/${s}`),
    type: fc.constantFrom<'file' | 'dir'>('file', 'dir'),
    bytes: fc.uint8Array({ maxLength: 64 }),
  });
  it('round trips and is deterministic', () => {
    fc.assert(
      fc.property(fc.array(arbEntry, { maxLength: 10 }), (entries) => {
        const bytes = encodeArchive(entries);
        expect(decodeArchive(bytes)).toEqual(entries);
        expect(encodeArchive(entries)).toEqual(bytes);
      }),
      { numRuns: 200 },
    );
  });
});
