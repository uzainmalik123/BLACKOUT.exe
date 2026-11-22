import { describe, expect, it } from 'vitest';
import { compareCodePoints, decodeUtf8, encodeUtf8, joinLines, splitLines } from './text';

describe('splitLines and joinLines', () => {
  it('returns no lines for empty text', () => {
    expect(splitLines('')).toEqual([]);
  });
  it('treats one final newline as a terminator', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('a\nb')).toEqual(['a', 'b']);
  });
  it('keeps empty lines', () => {
    expect(splitLines('\n')).toEqual(['']);
    expect(splitLines('a\n\nb\n\n')).toEqual(['a', '', 'b', '']);
  });
  it('joins with a newline after every line', () => {
    expect(joinLines(['a', 'b'])).toBe('a\nb\n');
    expect(joinLines([])).toBe('');
  });
  it('round-trips newline-terminated text', () => {
    const t = 'x\n\ny\n';
    expect(joinLines(splitLines(t))).toBe(t);
  });
});

describe('compareCodePoints', () => {
  it('orders by code point, not locale', () => {
    expect(compareCodePoints('Z', 'a')).toBeLessThan(0);
    expect(compareCodePoints('a', 'a')).toBe(0);
    expect(compareCodePoints('ab', 'a')).toBeGreaterThan(0);
    expect(compareCodePoints('a', 'ab')).toBeLessThan(0);
  });
  it('puts astral characters after high BMP characters (UTF-8 byte order)', () => {
    expect(compareCodePoints('\u{1F600}', '\uFFFF')).toBeGreaterThan(0);
    expect(compareCodePoints('\uFFFF', '\u{1F600}')).toBeLessThan(0);
  });
  it('agrees with UTF-8 byte order', () => {
    const a = encodeUtf8('\u{1F600}');
    const b = encodeUtf8('\uFFFF');
    expect(a[0]! > b[0]!).toBe(true);
  });
});

describe('utf8', () => {
  it('round-trips and replaces invalid bytes', () => {
    expect(decodeUtf8(encodeUtf8('héllo ☃'))).toBe('héllo ☃');
    expect(decodeUtf8(new Uint8Array([0xff]))).toBe('\uFFFD');
  });
});
