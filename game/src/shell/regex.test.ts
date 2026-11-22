import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compilePattern, type RegexDialect } from './regex';

function re(dialect: RegexDialect, source: string, flags = ''): RegExp {
  const r = compilePattern(dialect, source, flags);
  if (!r.ok) throw new Error(`expected ${source} to compile, got ${r.reason}`);
  return r.regex;
}

function reason(dialect: RegexDialect, source: string): string {
  const r = compilePattern(dialect, source);
  return r.ok ? 'ok' : r.reason;
}

describe('BRE versus ERE specials', () => {
  it('treats + ? | ( ) { } as literal in BRE', () => {
    expect(re('bre', 'a+b').test('a+b')).toBe(true);
    expect(re('bre', 'a+b').test('aab')).toBe(false);
    expect(re('bre', 'a?').test('a?')).toBe(true);
    expect(re('bre', 'a|b').test('a|b')).toBe(true);
    expect(re('bre', 'a|b').test('a')).toBe(false);
    expect(re('bre', '(x)').test('(x)')).toBe(true);
    expect(re('bre', 'a{2}').test('a{2}')).toBe(true);
    expect(re('bre', 'a{2}').test('aa')).toBe(false);
  });

  it('treats + ? | ( ) { } as operators in ERE', () => {
    expect(re('ere', 'a+b').test('aaab')).toBe(true);
    expect(re('ere', 'colou?r').test('color')).toBe(true);
    expect(re('ere', 'cat|dog').test('hotdog')).toBe(true);
    expect(re('ere', '^(ab)$').test('ab')).toBe(true);
    expect(re('ere', '^a{2}$').test('aa')).toBe(true);
    expect(re('ere', '^a{2}$').test('aaa')).toBe(false);
    expect(re('ere', '^a{2,3}$').test('aaa')).toBe(true);
  });

  it('treats . * ^ $ [ ] as special in both dialects', () => {
    for (const d of ['bre', 'ere'] as const) {
      expect(re(d, 'a.c').test('abc')).toBe(true);
      expect(re(d, '^ab*$').test('abbb')).toBe(true);
      expect(re(d, '^ab').test('xab')).toBe(false);
      expect(re(d, 'ab$').test('abx')).toBe(false);
      expect(re(d, '[0-9]x').test('5x')).toBe(true);
      expect(re(d, '[[:digit:]]+x'.replace('+', '')).test('5x')).toBe(true);
      expect(re(d, '[^a]').test('a')).toBe(false);
    }
  });

  it('escapes the other dialect specials with a backslash', () => {
    expect(re('ere', 'a\\+b').test('a+b')).toBe(true);
    expect(re('ere', 'a\\.b').test('axb')).toBe(false);
    expect(re('bre', 'a\\.b').test('a.b')).toBe(true);
    expect(re('bre', 'a\\.b').test('axb')).toBe(false);
  });

  it('treats a leading * and a mid-pattern ^ or $ as literal in BRE', () => {
    expect(re('bre', '*a').test('*a')).toBe(true);
    expect(re('bre', 'a^b').test('a^b')).toBe(true);
    expect(re('bre', 'a$b').test('a$b')).toBe(true);
  });

  it('keeps a backslash literal inside a bracket expression', () => {
    expect(re('ere', '[\\]').test('\\')).toBe(true);
    expect(re('ere', '[\\]').test('n')).toBe(false);
  });
});

describe('flags', () => {
  it('-i makes the match case-insensitive', () => {
    expect(re('bre', 'admin', 'i').test('ADMIN')).toBe(true);
    expect(re('ere', 'ad(m|n)in', 'i').test('ADNIN')).toBe(true);
  });

  it('is case-sensitive without the flag', () => {
    expect(re('bre', 'admin').test('ADMIN')).toBe(false);
  });
});

describe('rejection rules (unsupported)', () => {
  it('rejects a pattern longer than 256 characters, accepts exactly 256', () => {
    for (const d of ['bre', 'ere'] as const) {
      expect(reason(d, 'a'.repeat(257))).toBe('unsupported');
      expect(reason(d, 'a'.repeat(256))).toBe('ok');
    }
  });

  it('rejects a back-reference', () => {
    expect(reason('bre', '\\(a\\)\\1')).toBe('unsupported');
    expect(reason('bre', 'a\\1')).toBe('unsupported');
    expect(reason('ere', '(a)\\1')).toBe('unsupported');
    expect(reason('ere', '(a)\\9')).toBe('unsupported');
  });

  it('rejects a quantified group holding a quantifier', () => {
    expect(reason('ere', '(a+)+')).toBe('unsupported');
    expect(reason('ere', '(a*)*')).toBe('unsupported');
    expect(reason('ere', '(a+)*')).toBe('unsupported');
    expect(reason('ere', '(a+){2}')).toBe('unsupported');
    expect(reason('ere', '(a|b+)?')).toBe('unsupported');
    expect(reason('ere', '((a+))+')).toBe('unsupported');
    expect(reason('ere', '(x(a{2})y)+')).toBe('unsupported');
  });

  it('accepts a quantified group without an inner quantifier, and an unquantified group with one', () => {
    expect(reason('ere', '(ab)+')).toBe('ok');
    expect(reason('ere', '(a|b)*')).toBe('ok');
    expect(reason('ere', '(a+)')).toBe('ok');
    expect(reason('ere', '(a+)b')).toBe('ok');
    expect(reason('ere', '(a)+(b+)')).toBe('ok');
  });

  it('rejects a counted repeat above 255, accepts 255', () => {
    expect(reason('ere', 'a{256}')).toBe('unsupported');
    expect(reason('ere', 'a{1,256}')).toBe('unsupported');
    expect(reason('ere', 'a{256,}')).toBe('unsupported');
    expect(reason('ere', 'a{255}')).toBe('ok');
    expect(reason('ere', 'a{1,255}')).toBe('ok');
  });

  it('carries a non-empty error message', () => {
    const r = compilePattern('ere', '(a+)+');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });
});

describe('catastrophic patterns are rejected, not run', () => {
  it('rejects (a+)+ and friends without ever building a RegExp', () => {
    for (const p of ['(a+)+$', '(a*)*b', '(a+)*$', '((a+)+)+']) {
      expect(reason('ere', p)).toBe('unsupported');
    }
  });

  it('returns immediately for (a+)+ instead of matching it', () => {
    const start = Date.now();
    const r = compilePattern('ere', '^(a+)+$');
    expect(r.ok).toBe(false);
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('treats the same text as harmless in BRE, where it is literal', () => {
    const r = re('bre', '(a+)+$');
    const start = Date.now();
    expect(r.test('a'.repeat(40) + 'b')).toBe(false);
    expect(Date.now() - start).toBeLessThan(100);
  });
});

describe('malformed patterns report invalid', () => {
  it('reports an unterminated bracket expression', () => {
    expect(reason('bre', '[abc')).toBe('invalid');
    expect(reason('ere', '[abc')).toBe('invalid');
    expect(reason('ere', '[[:nope:]]')).toBe('invalid');
  });

  it('reports unbalanced parentheses in ERE', () => {
    expect(reason('ere', '(a')).toBe('invalid');
    expect(reason('ere', 'a)')).toBe('invalid');
  });

  it('reports a quantifier with nothing to repeat in ERE', () => {
    expect(reason('ere', '*a')).toBe('invalid');
    expect(reason('ere', '+')).toBe('invalid');
    expect(reason('ere', 'a|*b')).toBe('invalid');
  });

  it('reports a trailing backslash', () => {
    expect(reason('bre', 'a\\')).toBe('invalid');
    expect(reason('ere', 'a\\')).toBe('invalid');
  });

  it('reports a pattern RegExp itself refuses', () => {
    expect(reason('ere', 'a{3}{2}')).toBe('invalid');
  });
});

describe('never throws', () => {
  it('returns a result for arbitrary text in either dialect', () => {
    fc.assert(
      fc.property(fc.constantFrom<RegexDialect>('bre', 'ere'), fc.string({ maxLength: 300 }), (d, s) => {
        const r = compilePattern(d, s, 'i');
        expect(typeof r.ok).toBe('boolean');
      }),
      { numRuns: 300 },
    );
  });

  it('returns a result for strings built from regex metacharacters', () => {
    const meta = fc.stringMatching(/^[a-c()[\]{}*+?|.^$\\0-9,:-]{0,40}$/);
    fc.assert(
      fc.property(fc.constantFrom<RegexDialect>('bre', 'ere'), meta, (d, s) => {
        const r = compilePattern(d, s);
        if (r.ok) expect(r.regex).toBeInstanceOf(RegExp);
        else expect(['unsupported', 'invalid']).toContain(r.reason);
      }),
      { numRuns: 500 },
    );
  });

  it('reports invalid for an unknown flag instead of throwing', () => {
    expect(compilePattern('ere', 'a', 'zz')).toMatchObject({ ok: false, reason: 'invalid' });
  });
});
