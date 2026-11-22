// Feature: shell, Property 12: `grep` partition and exit status
// **Validates: Requirements 5.7, 5.8**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeFixture } from '../test-fixtures/fixture';

const UP = '/srv/juice-shop/uploads';
const arbLine = fc.string({ unit: fc.constantFrom('a', 'b', 'A', 'B', 'c', ' ', ',', '-'), maxLength: 8 });
const arbLines = fc.array(arbLine, { maxLength: 12 });
// A literal pattern with no BRE/ERE specials and no leading '-'.
const arbPattern = fc.string({ unit: fc.constantFrom('a', 'b', 'A', 'B', 'c'), minLength: 1, maxLength: 3 });

const text = (lines: string[]): string => lines.map((l) => `${l}\n`).join('');
const out = (lines: string[]): string => lines.join('\n');

describe('Property 12: grep partition and exit status', () => {
  it('p and -v p partition the input; -c, -i, -n and the exit code agree', async () => {
    await fc.assert(
      fc.asyncProperty(arbLines, arbPattern, async (lines, p) => {
        const { shell } = makeFixture({
          baseline: false,
          plant: [
            { path: 'in.txt', content: text(lines) },
            { path: 'lower.txt', content: text(lines.map((l) => l.toLowerCase())) },
          ],
        });
        const f = `${UP}/in.txt`;
        const hit = (l: string): boolean => l.includes(p);
        const matched = lines.filter(hit);
        const rest = lines.filter((l) => !hit(l));

        const g = await shell.run(`grep ${p} ${f}`);
        const v = await shell.run(`grep -v ${p} ${f}`);
        expect(g.output).toBe(out(matched));
        expect(v.output).toBe(out(rest));
        expect(g.exitCode).toBe(matched.length === 0 ? 1 : 0);
        expect(v.exitCode).toBe(rest.length === 0 ? 1 : 0);
        // partition: sizes add up to the input and the two selections interleave back to it in order
        expect(matched.length + rest.length).toBe(lines.length);
        let mi = 0;
        let ri = 0;
        const merged = lines.map((l) => (hit(l) ? matched[mi++] : rest[ri++]));
        expect(merged).toEqual(lines);

        const c = await shell.run(`grep -c ${p} ${f}`);
        expect(c.output).toBe(String(matched.length));
        expect(c.exitCode).toBe(matched.length === 0 ? 1 : 0);

        const n = await shell.run(`grep -n ${p} ${f}`);
        const numbered = lines.flatMap((l, i) => (hit(l) ? [`${i + 1}:${l}`] : []));
        expect(n.output).toBe(out(numbered));

        const i = await shell.run(`grep -i ${p} ${f}`);
        const lowerHits = lines.filter((l) => l.toLowerCase().includes(p.toLowerCase()));
        expect(i.output).toBe(out(lowerHits));
        const lo = await shell.run(`grep ${p.toLowerCase()} ${UP}/lower.txt`);
        expect(lo.output).toBe(out(lowerHits.map((l) => l.toLowerCase())));
        expect(i.exitCode).toBe(lo.exitCode);
      }),
      { numRuns: 100 },
    );
  }, 30_000);
});
