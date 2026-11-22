// Feature: shell, Property 4: Unlisted commands fail with 127 and change nothing
// **Validates: Requirements 1.8, 2.4, 2.5, 2.7, 15.3**
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { COMMAND_LIST } from './index';
import { makeFixture } from './test-fixtures/fixture';
import { arbUnlistedName } from './test-fixtures/generators';

const arbArg = fc.constantFrom('', 'a', '-l', "'x y'", '*.log', '~', '/tmp', '/var/log/nginx/access.log');
const arbListed = fc.constantFrom(...COMMAND_LIST);
// A stage name that is listed or unlisted; the line holds at least one unlisted name.
const arbName = fc.oneof(arbListed, arbUnlistedName);
const arbLine = fc
  .tuple(
    fc.array(fc.tuple(arbName, arbArg), { maxLength: 3 }),
    fc.tuple(arbUnlistedName, arbArg),
    fc.array(fc.tuple(arbName, arbArg), { maxLength: 3 }),
    fc.option(fc.constantFrom('/tmp/o', 'out'), { nil: undefined }),
  )
  .map(([before, bad, after, redirect]) => {
    const stages = [...before, bad, ...after];
    const line = stages.map(([n, a]) => `${n} ${a}`.trim()).join(' | ') + (redirect ? ` > ${redirect}` : '');
    const first = stages.find(([n]) => !(COMMAND_LIST as readonly string[]).includes(n));
    return { line, name: (first as [string, string])[0] };
  });

describe('Property 4: unlisted commands fail with 127 and change nothing', () => {
  it('answers `<name>: command not found`, calls no action and leaves the World unchanged', async () => {
    const { shell, engine, worldWithoutReads } = makeFixture({ baseline: false });
    const act = vi.spyOn(engine, 'act');
    await fc.assert(
      fc.asyncProperty(arbLine, async ({ line, name }) => {
        const before = structuredClone(worldWithoutReads());
        const r = await shell.run(line);
        expect(r.exitCode).toBe(127);
        expect(r.output).toBe(`${name}: command not found`);
        expect(act).not.toHaveBeenCalled();
        expect(worldWithoutReads()).toEqual(before);
      }),
      { numRuns: 200 },
    );
  }, 30_000);
});
