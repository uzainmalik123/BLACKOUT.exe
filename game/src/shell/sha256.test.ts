/// <reference types="node" />
import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const ref = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

describe('sha256Hex', () => {
  it('matches the known vectors', () => {
    expect(sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });
  it('hashes empty input', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('hashes 1 MB of data', () => {
    const big = new Uint8Array(1024 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 0xff;
    expect(sha256Hex(big)).toBe(ref(big));
  });
  it('handles the padding boundaries', () => {
    for (const n of [55, 56, 57, 63, 64, 65, 119, 120, 128]) {
      const b = new Uint8Array(n).fill(0x61);
      expect(sha256Hex(b)).toBe(ref(b));
    }
  });
  it('matches node:crypto on random byte strings', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 600 }), (b) => sha256Hex(b) === ref(b)),
      { numRuns: 200 },
    );
  });
});
