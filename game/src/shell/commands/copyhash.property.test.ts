// Feature: shell, Property 9: Copy and hash preserve bytes
// **Validates: Requirements 4.11, 5.16, 5.17**
import { createHash } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../sha256';
import { makeFixture } from '../test-fixtures/fixture';

const T = 30_000;
const UP = '/srv/juice-shop/uploads';

const arbBytes = fc.uint8Array({ minLength: 0, maxLength: 300 });
const arbName = fc.string({ unit: fc.constantFrom(...'abcxyz019_-.'), minLength: 1, maxLength: 12 }).filter((s) => s !== '.' && s !== '..');

const reference = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

describe('Property 9: copy and hash preserve bytes', () => {
  it('cp keeps the bytes and sha256sum prints the node:crypto digest', async () => {
    await fc.assert(
      fc.asyncProperty(arbBytes, arbName, arbName, async (bytes, n1, n2) => {
        const fx = makeFixture({ baseline: false, plant: [{ path: 'planted.bin', content: bytes }] });
        const { shell } = fx;
        const digest = reference(bytes);
        expect(sha256Hex(bytes)).toBe(digest);

        // Bytes reach /tmp by copying an upload, then copy again within /tmp.
        const a = `/tmp/${n1}`;
        const b = `/tmp/${n1 === n2 ? `${n2}2` : n2}`;
        expect((await shell.run(`cp ${UP}/planted.bin ${a}`)).exitCode).toBe(0);
        expect((await shell.run(`cp ${a} ${b}`)).exitCode).toBe(0);

        for (const p of [`${UP}/planted.bin`, a, b]) {
          const first = await shell.run(`sha256sum ${p}`);
          expect(first).toEqual({ output: `${digest}  ${p}`, exitCode: 0 });
          expect(first.output).toMatch(/^[0-9a-f]{64} {2}\S/);
          expect(await shell.run(`sha256sum ${p}`)).toEqual(first);
        }

        // Archives hash deterministically.
        expect((await shell.run(`tar czf /evidence/e1.tgz ${a}`)).exitCode).toBe(0);
        const h1 = await shell.run('sha256sum /evidence/e1.tgz');
        expect(h1.exitCode).toBe(0);
        expect(await shell.run('sha256sum /evidence/e1.tgz')).toEqual(h1);
        expect(fx.internalErrors).toEqual([]);
      }),
      { numRuns: 100 },
    );
  }, T);
});
