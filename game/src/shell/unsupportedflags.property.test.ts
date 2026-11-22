// Feature: shell, Property 14: Unsupported flags are rejected uniformly
// **Validates: Requirements 5.19, 12.9, 16.1**
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { COMMAND_LIST } from './index';
import { COMMANDS } from './registry';
import { makeFixture } from './test-fixtures/fixture';

// A flag that is not in the command's registry list (and not a numeric count where numericCount is set).
// Short flags are single characters (a bundle names its first bad character); `--word` forms are never bundles, so they are named whole.
const arbCommandAndFlag = fc.constantFrom(...COMMAND_LIST).chain((name) => {
  const spec = COMMANDS[name];
  const known = new Set(spec.flags.map((f) => f.name));
  const letters = fc
    .constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''))
    .map((c) => `-${c}`);
  const digits = spec.numericCount ? [] : ['-0', '-5'];
  const longs = fc.stringMatching(/^[a-z]{2,8}$/).map((w) => `--${w}`);
  return fc
    .oneof(letters, longs, fc.constantFrom(...digits, '-@', '-%'))
    .filter((f) => !known.has(f))
    .map((flag) => ({ name, flag }));
});

describe('Property 14: unsupported flags are rejected uniformly', () => {
  it('prints the flag and the usage line, exits 1, calls no action and changes nothing', async () => {
    const { shell, engine, worldWithoutReads } = makeFixture({ baseline: false });
    const act = vi.spyOn(engine, 'act');
    const probe = async (): Promise<string> => (await shell.run('ls -la /tmp ~')).output;
    const fsBefore = await probe();
    act.mockClear();
    await fc.assert(
      fc.asyncProperty(arbCommandAndFlag, async ({ name, flag }) => {
        const before = structuredClone(worldWithoutReads());
        const r = await shell.run(`${name} ${flag}`);
        expect(r.exitCode).toBe(1);
        expect(r.output).toBe(`${name}: unsupported flag '${flag}'\n${name}: usage: ${COMMANDS[name].usage}`);
        expect(act).not.toHaveBeenCalled();
        expect(worldWithoutReads()).toEqual(before);
      }),
      { numRuns: 100 },
    );
    expect(await probe()).toBe(fsBefore);
  }, 30_000);
});
