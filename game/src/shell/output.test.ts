import { describe, expect, it } from 'vitest';
import { fail, finish, ok, sanitize } from './output';

describe('sanitize', () => {
  it('shows control characters in caret notation', () => {
    expect(sanitize('\x1b[31m')).toBe('^[[31m');
    expect(sanitize('a\x00b')).toBe('a^@b');
    expect(sanitize('\x07\x08\r')).toBe('^G^H^M');
    expect(sanitize('\x7f')).toBe('^?');
  });
  it('keeps newline and tab', () => {
    expect(sanitize('a\tb\nc')).toBe('a\tb\nc');
  });
  it('leaves printable and non-ASCII text alone', () => {
    expect(sanitize('plain ~ text é ☃')).toBe('plain ~ text é ☃');
  });
});

describe('finish', () => {
  it('drops exactly one final newline', () => {
    expect(finish('a\n')).toBe('a');
    expect(finish('a\n\n')).toBe('a\n');
    expect(finish('a')).toBe('a');
    expect(finish('')).toBe('');
    expect(finish('\n')).toBe('');
  });
});

describe('ok and fail', () => {
  it('build results', () => {
    expect(ok('x')).toEqual({ stdout: 'x', stderr: '', code: 0 });
    expect(fail('cat', 'boom')).toEqual({ stdout: '', stderr: 'cat: boom\n', code: 1 });
  });
});
