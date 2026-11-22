/// <reference types="node" />
// Feature: shell, Property 27: The exported command list equals the steering list
// **Validates: Requirements 2.1, 2.2, 2.6**
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COMMAND_LIST, checkCommandLine } from './index';
import { COMMANDS } from './registry';

const STEERING = readFileSync(new URL('../../../.kiro/steering/game-shell.md', import.meta.url), 'utf8');

/** The command names in the first backtick line after "Only these commands exist:". */
function steeringCommands(): string[] {
  const match = /Only these commands exist:\s*\n\s*`([^`]+)`/.exec(STEERING);
  if (!match) throw new Error('game-shell.md: the command list line was not found');
  return (match[1] as string).trim().split(/\s+/);
}

const LISTED: readonly string[] = COMMAND_LIST;
const arbListed = fc.constantFrom(...LISTED);
const arbIdentifier = fc
  .stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,11}$/)
  .filter((n) => !LISTED.includes(n));

describe('Property 27: the command list equals the steering list', () => {
  it('has the same set as the steering line, 31 entries, no duplicates; differences are named', () => {
    const steering = steeringCommands();
    const diffs = [
      ...steering.filter((c) => !LISTED.includes(c)).map((c) => `${c}: only in game-shell.md`),
      ...LISTED.filter((c) => !steering.includes(c)).map((c) => `${c}: only in COMMAND_LIST`),
    ];
    expect(diffs, diffs.join('; ')).toEqual([]);
    expect(LISTED).toHaveLength(31);
    expect(new Set(LISTED).size).toBe(LISTED.length);
    expect(new Set(steering).size).toBe(steering.length);
  });

  it('every listed name has a registry spec whose name matches', () => {
    fc.assert(
      fc.property(arbListed, (n) => {
        const spec = (COMMANDS as Record<string, { name: string } | undefined>)[n];
        expect(spec?.name).toBe(n);
      }),
      { numRuns: 200 },
    );
  });

  it('checkCommandLine accepts every listed name alone and in pairs', () => {
    fc.assert(
      fc.property(arbListed, arbListed, (a, b) => {
        expect(checkCommandLine(a)).toBe(true);
        expect(checkCommandLine(`${a} | ${b}`)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('checkCommandLine rejects any name outside the list, alone or in a pipeline', () => {
    fc.assert(
      fc.property(arbIdentifier, arbListed, (x, a) => {
        expect(checkCommandLine(x)).toBe(false);
        expect(checkCommandLine(`${a} | ${x}`)).toBe(false);
        expect(checkCommandLine(`${x} | ${a}`)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
