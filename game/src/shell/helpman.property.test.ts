// Feature: shell, Property 15: `help` and `man` come from the registry
// **Validates: Requirements 12.5, 12.6, 12.7, 12.10**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseArgs } from './argparse';
import { COMMAND_LIST, checkCommandLine } from './index';
import { COMMANDS } from './registry';
import { makeFixture } from './test-fixtures/fixture';

const arbCommand = fc.constantFrom(...COMMAND_LIST);

// A name outside the list that is one plain word (no leading '-', so `man` does not see a flag).
const arbOtherName = fc
  .array(fc.constantFrom(...'abcXYZ019_@%+=:,./'), { minLength: 1, maxLength: 10 })
  .map((cs) => cs.join(''))
  .filter((n) => !(COMMAND_LIST as readonly string[]).includes(n));

/** The lines of one section of a man page: from after `title` to the next blank line. */
function section(text: string, title: string): string[] {
  const lines = text.split('\n');
  const start = lines.indexOf(title);
  if (start < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (l === '') break;
    out.push(l.trim());
  }
  return out;
}

describe('Property 15: help and man come from the registry', () => {
  it('help has one alphabetical line per command with a summary of at most 80 characters', async () => {
    const { shell } = makeFixture({ baseline: false });
    await fc.assert(
      fc.asyncProperty(arbCommand, async (name) => {
        const r = await shell.run('help');
        expect(r.exitCode).toBe(0);
        const lines = r.output.split('\n');
        expect(lines).toHaveLength(COMMAND_LIST.length);
        const names = lines.map((l) => l.split('  ')[0] as string);
        expect(names).toEqual([...COMMAND_LIST].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
        expect(lines.filter((l) => l.split('  ')[0] === name)).toHaveLength(1);
        for (const l of lines) {
          const summary = l.slice(l.indexOf('  ') + 2);
          expect(summary.length).toBeGreaterThan(0);
          expect(summary.length).toBeLessThanOrEqual(80);
        }
      }),
      { numRuns: 100 },
    );
  }, 30_000);

  it('man lists exactly the registry flags, and every example passes checkCommandLine', async () => {
    const { shell } = makeFixture({ baseline: false });
    await fc.assert(
      fc.asyncProperty(arbCommand, async (name) => {
        const spec = COMMANDS[name];
        const r = await shell.run(`man ${name}`);
        expect(r.exitCode).toBe(0);

        // Exactly the spec flags, in order, each with a description.
        const flagLines = section(r.output, 'FLAGS').filter((l) => l !== '(none)');
        expect(flagLines.map((l) => l.split(/\s+/)[0])).toEqual(spec.flags.map((f) => f.name));
        for (const l of flagLines) expect(l.split('  ').pop()!.length).toBeGreaterThan(0);

        // Every flag-looking token in the text is accepted by parseArgs (no unsupported flag appears).
        for (const raw of r.output.split(/\s+/)) {
          if (!/^-[A-Za-z]/.test(raw)) continue;
          const token = raw.replace(/[<|,.;)].*$/, '');
          const parsed = parseArgs(spec, [token]);
          if (!parsed.ok) expect(parsed.kind).not.toBe('unsupported');
        }

        // Every example is a valid command line, and there is at least one.
        const examples = section(r.output, 'EXAMPLES');
        expect(examples).toEqual(spec.examples);
        expect(examples.length).toBeGreaterThan(0);
        for (const e of examples) expect(checkCommandLine(e)).toBe(true);
      }),
      { numRuns: 100 },
    );
  }, 30_000);

  it('man of a name outside the list prints `No manual entry for <name>` with exit code 1 and changes nothing', async () => {
    const { shell, worldWithoutReads } = makeFixture({ baseline: false });
    await fc.assert(
      fc.asyncProperty(arbOtherName, async (name) => {
        const before = structuredClone(worldWithoutReads());
        const r = await shell.run(`man ${name}`);
        expect(r.exitCode).toBe(1);
        expect(r.output).toBe(`No manual entry for ${name}`);
        expect(worldWithoutReads()).toEqual(before);
      }),
      { numRuns: 100 },
    );
  }, 30_000);
});
