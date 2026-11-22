// Feature: shell, Property 2: Unsupported syntax runs nothing
// **Validates: Requirements 2.7, 3.6, 3.7**
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { makeFixture } from './test-fixtures/fixture';
import { arbForbiddenSyntaxLine, arbQuotedOperatorLine } from './test-fixtures/generators';

describe('Property 2: unsupported syntax runs nothing', () => {
  it(
    'a forbidden construct gives a syntax error, exit 2, no act call and an unchanged World',
    async () => {
      const f = makeFixture({ baseline: false });
      const act = vi.spyOn(f.engine, 'act');
      await fc.assert(
        fc.asyncProperty(arbForbiddenSyntaxLine, async (line) => {
          const before = f.worldWithoutReads();
          const r = await f.shell.run(line);
          expect(r.exitCode).toBe(2);
          expect(r.output.startsWith('sh: syntax error: ')).toBe(true);
          expect(act).not.toHaveBeenCalled();
          expect(f.worldWithoutReads()).toEqual(before);
        }),
        { numRuns: 200 },
      );
    },
    30_000,
  );

  it(
    'the same operators inside quotes are not a syntax error',
    async () => {
      const f = makeFixture({ baseline: false });
      await fc.assert(
        fc.asyncProperty(arbQuotedOperatorLine, async (line) => {
          const r = await f.shell.run(line);
          expect(r.output.startsWith('sh: syntax error')).toBe(false);
          expect(r.exitCode).toBe(127);
        }),
        { numRuns: 100 },
      );
    },
    30_000,
  );
});
