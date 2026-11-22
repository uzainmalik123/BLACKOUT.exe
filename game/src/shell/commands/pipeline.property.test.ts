// Feature: shell, Property 10: A pipeline equals the composition of its stages
// **Validates: Requirements 3.1, 5.4**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../sha256';
import { makeFixture } from '../test-fixtures/fixture';

const UPLOADS = '/srv/juice-shop/uploads/';

// File text: one to eight non-empty lines over a small alphabet, always ending in a newline.
const arbText = fc
  .array(
    fc
      .array(fc.constantFrom('a', 'b', 'c', 'A', '1', ' ', '\t', '.', '-'), { minLength: 1, maxLength: 6 })
      .map((cs) => cs.join('')),
    { minLength: 1, maxLength: 8 },
  )
  .map((lines) => `${lines.join('\n')}\n`);

// Stage A takes the input file as its operand; stage B is given the file that holds A's output
// (no `wc` in B, which prints the file name when it has an operand).
const arbStageA = fc.oneof(
  fc.constant((f: string) => `cat ${f}`),
  fc.nat(10).map((n) => (f: string) => `head -n ${n} ${f}`),
  fc.nat(10).map((n) => (f: string) => `tail -n ${n} ${f}`),
  fc.constantFrom('', ' -r').map((fl) => (f: string) => `sort${fl} ${f}`),
  fc.constant((f: string) => `uniq ${f}`),
  fc.constantFrom('a', 'b', '1').map((p) => (f: string) => `grep ${p} ${f}`),
  fc.constantFrom('a', 'b').map((p) => (f: string) => `grep -v ${p} ${f}`),
  fc.constant((f: string) => `wc -l ${f}`),
);
const arbStageB = fc.oneof(
  fc.constant((f?: string) => `cat${f ? ` ${f}` : ''}`),
  fc.nat(10).map((n) => (f?: string) => `head -n ${n}${f ? ` ${f}` : ''}`),
  fc.nat(10).map((n) => (f?: string) => `tail -n ${n}${f ? ` ${f}` : ''}`),
  fc.constant((f?: string) => `sort${f ? ` ${f}` : ''}`),
  fc.constant((f?: string) => `uniq -c${f ? ` ${f}` : ''}`),
  fc.constantFrom('a', 'b', '1').map((p) => (f?: string) => `grep ${p}${f ? ` ${f}` : ''}`),
);

describe('Property 10: a pipeline equals the composition of its stages', () => {
  it('`A | B` prints what B prints for a file holding the output of A', async () => {
    const { shell, world } = makeFixture({ baseline: false });
    let seq = 0;
    const plant = (text: string): string => {
      const path = `p${seq++}.txt`;
      const bytes = new TextEncoder().encode(text);
      world.files.push({ path, size: bytes.length, sha256: sha256Hex(bytes), contentBase64: Buffer.from(bytes).toString('base64') });
      return UPLOADS + path;
    };
    await fc.assert(
      fc.asyncProperty(arbText, arbStageA, arbStageB, async (text, a, b) => {
        const input = plant(text);
        const first = await shell.run(a(input));
        // `run` drops the final newline of the output (finish); the file holds the full output.
        const mid = plant(first.output === '' ? '' : `${first.output}\n`);
        const piped = await shell.run(`${a(input)} | ${b()}`);
        const composed = await shell.run(b(mid));
        expect(piped.output).toBe(composed.output);
        expect(piped.exitCode).toBe(composed.exitCode);
      }),
      { numRuns: 100 },
    );
  }, 30_000);

  it('`cat f1 f2` is the contents of f1 followed by the contents of f2', async () => {
    const { shell, world } = makeFixture({ baseline: false });
    let seq = 0;
    const plant = (text: string): string => {
      const path = `c${seq++}.txt`;
      const bytes = new TextEncoder().encode(text);
      world.files.push({ path, size: bytes.length, sha256: sha256Hex(bytes), contentBase64: Buffer.from(bytes).toString('base64') });
      return UPLOADS + path;
    };
    await fc.assert(
      fc.asyncProperty(arbText, arbText, async (t1, t2) => {
        const r = await shell.run(`cat ${plant(t1)} ${plant(t2)}`);
        expect(r.output).toBe((t1 + t2).slice(0, -1));
        expect(r.exitCode).toBe(0);
      }),
      { numRuns: 100 },
    );
  }, 30_000);
});
