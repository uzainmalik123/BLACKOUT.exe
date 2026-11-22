// Feature: shell, Property 16: History keeps non-blank lines in order
// **Validates: Requirements 1.5, 1.6, 1.9, 12.2, 12.3**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeFixture } from './test-fixtures/fixture';

const BLANK = ['', ' ', '   ', '\t', ' \t '];
const VALID = ['pwd', 'ls', 'ls -l /tmp', 'cd /tmp', 'cd ~', 'date', 'wc -l', 'pwd | wc -l', 'help'];
const INVALID = [
  'nosuchcmd x',
  "echo 'unterminated",
  'ls ; pwd',
  'ls | | wc',
  'cat /no/such/file',
  'ls --bogus',
  'pwd >> /tmp/x',
  'ls $HOME',
  '> out',
];

const arbPad = fc.constantFrom('', ' ', '  ', '\t');
const arbBlank = fc.constantFrom(...BLANK);
const arbValid = fc.tuple(arbPad, fc.constantFrom(...VALID), arbPad).map(([a, l, b]) => a + l + b);
const arbInvalid = fc.tuple(arbPad, fc.constantFrom(...INVALID), arbPad).map(([a, l, b]) => a + l + b);
const arbLine = fc.oneof(arbBlank, arbValid, arbInvalid);

const arbSequence = fc.oneof(
  { weight: 8, arbitrary: fc.array(arbLine, { maxLength: 40 }) },
  { weight: 1, arbitrary: fc.array(arbLine, { minLength: 480, maxLength: 620 }) },
);

describe('Property 16: history keeps non-blank lines in order', () => {
  it('lists the last 500 non-blank lines unmodified, numbered from the running count, history last', async () => {
    await fc.assert(
      fc.asyncProperty(arbSequence, async (lines) => {
        const { shell } = makeFixture({ baseline: false });
        for (const line of lines) {
          const r = await shell.run(line);
          expect(Number.isInteger(r.exitCode)).toBe(true);
        }
        const r = await shell.run('history');
        expect(r.exitCode).toBe(0);

        const entered = [...lines.filter((l) => l.trim() !== ''), 'history'];
        const kept = entered.slice(-500);
        const first = entered.length - kept.length + 1;
        const expected = kept.map((l, i) => `${String(first + i).padStart(5, ' ')}  ${l}`);
        expect(r.output.split('\n')).toEqual(expected);
      }),
      { numRuns: 100 },
    );
  }, 30_000);
});
