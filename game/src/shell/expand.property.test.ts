// Feature: shell, Property 6: Glob expansion is sorted, literal when empty, and quote-aware
// **Validates: Requirements 3.10, 3.11, 3.12, 3.13**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { expandWord } from './expand';
import { arbGlobCase } from './test-fixtures/generators';
import type { Stat, VfsLister } from './types';

const CWD = '/srv/juice-shop';
const HOME = '/srv/juice-shop';

function lister(names: string[]): VfsLister {
  return {
    stat(abs): Stat | undefined {
      if (abs === CWD) return { kind: 'dir', area: 'system', readonly: false };
      if (names.some((n) => `${CWD}/${n}` === abs)) return { kind: 'file', area: 'system', readonly: false };
      return undefined;
    },
    list: (abs) => (abs === CWD ? [...names] : undefined),
  };
}

// Reference matcher: the pattern as a regular expression, `*` = any run, hidden names need a leading dot.
function refMatch(pattern: string, name: string): boolean {
  if (name.startsWith('.') && !pattern.startsWith('.')) return false;
  const re = pattern
    .split('*')
    .map((p) => p.replace(/[.\\^$+?()[\]{}|-]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${re}$`, 's').test(name);
}

const byCodePoint = (a: string, b: string) => {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i] as string).codePointAt(0)! - (y[i] as string).codePointAt(0)!;
    if (d !== 0) return d;
  }
  return x.length - y.length;
};

describe('Property 6: glob expansion', () => {
  it('equals the reference matcher, sorted, and literal when nothing matches', () => {
    fc.assert(
      fc.property(arbGlobCase, ({ names, pattern }) => {
        const got = expandWord({ text: pattern, literal: false }, { cwd: CWD }, lister(names));
        const matched = names.filter((n) => refMatch(pattern, n)).sort(byCodePoint);
        if (!pattern.includes('*')) {
          expect(got).toEqual([pattern]);
        } else if (matched.length === 0) {
          expect(got).toEqual([pattern]);
        } else {
          expect(got).toEqual(matched);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('returns a quoted (literal) word unchanged, and expands only unquoted ~', () => {
    fc.assert(
      fc.property(arbGlobCase, fc.constantFrom('', '/x', '/a/b'), ({ names, pattern }, rest) => {
        const fs = lister(names);
        expect(expandWord({ text: pattern, literal: true }, { cwd: CWD }, fs)).toEqual([pattern]);
        expect(expandWord({ text: `~${rest}`, literal: true }, { cwd: CWD }, fs)).toEqual([`~${rest}`]);
        expect(expandWord({ text: `~${rest}`, literal: false }, { cwd: CWD }, fs)).toEqual([`${HOME}${rest}`]);
      }),
      { numRuns: 200 },
    );
  });
});
