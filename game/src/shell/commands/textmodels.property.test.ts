/// <reference types="node" />
// Feature: shell, Property 11: Text commands match their reference models
// **Validates: Requirements 5.1, 5.2, 5.5, 5.6, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../sha256';
import { makeFixture } from '../test-fixtures/fixture';

const UPLOADS = '/srv/juice-shop/uploads';
const FILE = `${UPLOADS}/model.txt`;

// Arbitraries live here (shared generators.ts is not edited). No `'` (the shell has no escapes) and no control
// characters other than tab, so `sanitize` leaves the output alone.
const CHARS = [...'abcXYZ019 _-.:;,|\t', 'é', '日'];
const arbLine = fc.array(fc.constantFrom(...CHARS), { maxLength: 12 }).map((cs) => cs.join(''));
const arbLines = fc.array(arbLine, { maxLength: 12 });
const arbNumLine = fc
  .tuple(fc.integer({ min: -50, max: 50 }), fc.constantFrom('', ' x', ' 7 y'))
  .map(([n, s]) => `${n}${s}`);

const q = (s: string): string => `'${s}'`;
const out = (lines: string[]): string => lines.join('\n');
const cmp = (a: string, b: string): number => {
  const x = [...a].map((c) => c.codePointAt(0) as number);
  const y = [...b].map((c) => c.codePointAt(0) as number);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return (x[i] as number) < (y[i] as number) ? -1 : 1;
  return x.length - y.length;
};
const words = (l: string): string[] => l.match(/[^ \t\n]+/g) ?? [];
const num = (s: string): number => {
  const m = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)/.exec(s);
  return m ? Number(m[0]) : 0;
};

function setup() {
  const fx = makeFixture({ baseline: false });
  const put = (content: string): void => {
    const bytes = new TextEncoder().encode(content);
    fx.world.files.length = 0;
    fx.world.files.push({ path: 'model.txt', size: bytes.length, sha256: sha256Hex(bytes), contentBase64: Buffer.from(bytes).toString('base64') });
  };
  const run = async (line: string, content: string) => {
    put(content);
    return fx.shell.run(line);
  };
  return { fx, run };
}
const text = (lines: string[]): string => lines.map((l) => `${l}\n`).join('');

describe('Property 11: text commands match their reference models', () => {
  it('head and tail pick the first and last k lines', async () => {
    const { run } = setup();
    await fc.assert(
      fc.asyncProperty(arbLines, fc.integer({ min: 0, max: 15 }), fc.boolean(), async (lines, k, dash) => {
        const opt = dash ? `-${k}` : `-n ${k}`;
        const h = await run(`head ${opt} ${FILE}`, text(lines));
        expect(h).toEqual({ output: out(lines.slice(0, k)), exitCode: 0 });
        const t = await run(`tail ${opt} ${FILE}`, text(lines));
        expect(t).toEqual({ output: out(lines.slice(Math.max(0, lines.length - k))), exitCode: 0 });
      }),
      { numRuns: 100 },
    );
  }, 30_000);

  it('sort orders by code point, -r reverses, -n by number, -k N by field', async () => {
    const { run } = setup();
    await fc.assert(
      fc.asyncProperty(arbLines, fc.array(arbNumLine, { maxLength: 10 }), fc.integer({ min: 1, max: 3 }), async (lines, nums, n) => {
        const base = await run(`cat ${FILE} | sort`, text(lines));
        expect(base.output).toBe(out([...lines].sort(cmp)));
        const r = await run(`cat ${FILE} | sort -r`, text(lines));
        expect(r.output).toBe(out([...lines].sort((a, b) => cmp(b, a))));
        const num_ = await run(`cat ${FILE} | sort -n`, text(nums));
        expect(num_.output).toBe(out([...nums].sort((a, b) => num(a) - num(b))));
        const k = await run(`cat ${FILE} | sort -k ${n}`, text(lines));
        expect(k.output).toBe(out([...lines].sort((a, b) => cmp(words(a)[n - 1] ?? '', words(b)[n - 1] ?? ''))));
      }),
      { numRuns: 100 },
    );
  }, 30_000);

  it('uniq -c is the run-length encoding of adjacent lines', async () => {
    const { run } = setup();
    const arbRuns = fc.array(fc.tuple(fc.constantFrom('a', 'b', 'c d', ''), fc.integer({ min: 1, max: 4 })), { maxLength: 8 });
    await fc.assert(
      fc.asyncProperty(arbRuns, async (runs) => {
        const lines = runs.flatMap(([l, c]) => Array<string>(c).fill(l));
        const enc: [string, number][] = [];
        for (const l of lines) {
          const last = enc[enc.length - 1];
          if (last && last[0] === l) last[1]++;
          else enc.push([l, 1]);
        }
        const r = await run(`cat ${FILE} | uniq -c`, text(lines));
        expect(r.output).toBe(out(enc.map(([l, c]) => `${String(c).padStart(7)} ${l}`)));
      }),
      { numRuns: 100 },
    );
  }, 30_000);

  it('wc -l, -w and -c count lines, words and bytes', async () => {
    const { run } = setup();
    await fc.assert(
      fc.asyncProperty(arbLines, async (lines) => {
        const t = text(lines);
        expect((await run(`cat ${FILE} | wc -l`, t)).output).toBe(String(lines.length));
        expect((await run(`cat ${FILE} | wc -w`, t)).output).toBe(String(words(t).length));
        expect((await run(`cat ${FILE} | wc -c`, t)).output).toBe(String(Buffer.byteLength(t)));
      }),
      { numRuns: 100 },
    );
  }, 30_000);

  it('cut -d -f splits and selects fields', async () => {
    const { run } = setup();
    const arbList = fc.uniqueArray(fc.integer({ min: 1, max: 5 }), { minLength: 1, maxLength: 4 });
    await fc.assert(
      fc.asyncProperty(arbLines, fc.constantFrom(',', ':', ';', '|'), arbList, async (lines, sep, list) => {
        const sorted = [...list].sort((a, b) => a - b);
        const expected = lines.map((l) => {
          if (!l.includes(sep)) return l;
          const f = l.split(sep);
          return sorted.filter((n) => n <= f.length).map((n) => f[n - 1]).join(sep);
        });
        const r = await run(`cat ${FILE} | cut -d ${q(sep)} -f ${list.join(',')}`, text(lines));
        expect(r.output).toBe(out(expected));
      }),
      { numRuns: 100 },
    );
  }, 30_000);

  it("awk '{print $N, $NF, NR, $0}' matches the field-split reference", async () => {
    const { run } = setup();
    await fc.assert(
      fc.asyncProperty(arbLines, fc.integer({ min: 1, max: 6 }), fc.option(fc.constantFrom(',', ':', ';'), { nil: undefined }), async (lines, n, sep) => {
        const expected = lines.map((l, i) => {
          const f = sep === undefined ? (l.match(/[^ \t]+/g) ?? []) : l === '' ? [] : l.split(sep);
          return [f[n - 1] ?? '', f[f.length - 1] ?? '', String(i + 1), l].join(' ');
        });
        const opt = sep === undefined ? '' : `-F${q(sep)} `;
        const r = await run(`cat ${FILE} | awk ${opt}'{print $${n}, $NF, NR, $0}'`, text(lines));
        expect(r.output).toBe(out(expected));
      }),
      { numRuns: 100 },
    );
  }, 30_000);

  it('ls and ls -a list names in code-point order, hiding dot names unless -a', async () => {
    const { fx } = setup();
    const arbName = fc.array(fc.constantFrom(...'abzAZ09._-'), { minLength: 1, maxLength: 5 }).map((c) => c.join('')).filter((s) => s !== '.' && s !== '..');
    const arbPaths = fc.array(fc.tuple(arbName, fc.option(arbName, { nil: undefined })), { maxLength: 8 });
    await fc.assert(
      fc.asyncProperty(arbPaths, async (paths) => {
        fx.world.files.length = 0;
        const rel = new Set<string>();
        for (const [a, b] of paths) {
          const p = b === undefined ? a : `${a}/${b}`;
          // A name cannot be both a file and a directory.
          if (rel.has(a) || [...rel].some((r) => b === undefined && r.startsWith(`${a}/`))) continue;
          rel.add(p);
        }
        const files = [...rel];
        for (const p of files) fx.world.files.push({ path: p, size: 0, sha256: '0'.repeat(64) });
        const names = [...new Set(files.map((p) => p.split('/')[0] as string))].sort(cmp);
        const plain = await fx.shell.run(`ls ${UPLOADS}`);
        expect(plain).toEqual({ output: out(names.filter((n) => !n.startsWith('.'))), exitCode: 0 });
        const all = await fx.shell.run(`ls -a ${UPLOADS}`);
        expect(all).toEqual({ output: out(names), exitCode: 0 });
      }),
      { numRuns: 100 },
    );
  }, 30_000);
});
