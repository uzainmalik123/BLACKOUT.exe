// Feature: shell, Property 5: `run` always resolves with clean text (no-baseline variant)
// **Validates: Requirements 15.1, 15.2, 15.3, 15.4, 16.3**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COMMAND_LIST } from './index';
import { makeFixture } from './test-fixtures/fixture';
import { arbUnlistedName } from './test-fixtures/generators';

const EXIT_CODES = [0, 1, 2, 127];
// Any character below U+0020 other than \n and \t, or U+007F (this covers every ANSI escape, which starts with ESC).
// eslint-disable-next-line no-control-regex
const BAD_CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/;

function expectClean(r: { output: string; exitCode?: number | undefined }): void {
  expect(typeof r.output).toBe('string');
  expect(typeof r.exitCode).toBe('number');
  expect(EXIT_CODES).toContain(r.exitCode);
  expect(r.output).not.toContain('\x1b');
  expect(BAD_CONTROL.test(r.output)).toBe(false);
}

/** Free text: control characters, unicode, whitespace, quotes, shell operators. */
const arbJunk: fc.Arbitrary<string> = fc.oneof(
  fc.string({ maxLength: 500 }),
  fc.string({ unit: 'binary', maxLength: 500 }),
  fc.stringMatching(/^[\s]{0,40}$/),
  fc.array(fc.constantFrom(...`'"\\|>< ;&$()\`*~\t\n\r\x00\x1b\x7f[é日😀`.split('')), { maxLength: 500 }).map((cs) => cs.join('')),
  fc.array(fc.constantFrom('ls', 'cat', "'", '"', '|', '>', ' ', '-l', '*', '~', '/'), { maxLength: 120 }).map((p) => p.join('').slice(0, 500)),
);

const ARGS = [
  '', '-l', '-a', '-la', '-n', '5', '-5', '-r', '-i', '-v', '-c', '-E', '-e', '-d', ',', '-f', '1', '-k', '-F:', '--', '-x', '--bogus',
  '/', '.', '..', '~', '~/x', '/tmp', '/tmp/a', '/srv/juice-shop', '/srv/juice-shop/uploads', '/var/log/nginx/access.log',
  '/evidence', '/etc/passwd', '*', '*.log', '/tmp/*', '/var/log/*/*', 'nonexistent', "'a b'", '"x"', "'", '"', '(a+)+', '[', 'a|b',
  "{print $1}", "'{print $1}'", '1.2.3.4', '999.1.1.1', 'nginx', 'stop', 'status', '-A', 'INPUT', '-s', '-j', 'DROP', '-L',
  'x.tgz', '-cf', '-xf', '-tf', 'SELECT 1', "'SELECT * FROM Users'", "'.tables'", '-header', '/srv/juice-shop/data/juiceshop.sqlite',
];
const arbArg = fc.oneof(fc.constantFrom(...ARGS), fc.string({ maxLength: 12 }));
const arbStage = fc
  .tuple(fc.constantFrom(...COMMAND_LIST), fc.array(arbArg, { maxLength: 5 }))
  .map(([c, a]) => [c, ...a].join(' '));
const arbCommandLine = fc
  .tuple(
    fc.array(arbStage, { minLength: 1, maxLength: 3 }),
    fc.option(fc.constantFrom('/tmp/out', 'out', '/evidence/x', '/srv/juice-shop/uploads/z', '~/q', '*', ''), { nil: undefined }),
  )
  .map(([stages, redirect]) => stages.join(' | ') + (redirect !== undefined ? ` > ${redirect}` : ''));
const arbSequence = fc.array(arbCommandLine, { minLength: 1, maxLength: 20 });

describe('Property 5: run always resolves with clean text (no baseline)', () => {
  it('(a) any string of 0 to 500 characters resolves with { output, exitCode } and never rejects', async () => {
    const { shell, internalErrors } = makeFixture({ baseline: false });
    await fc.assert(
      fc.asyncProperty(arbJunk, async (s) => {
        const r = await shell.run(s.slice(0, 500));
        expectClean(r);
        expect(internalErrors).toEqual([]);
      }),
      { numRuns: 200 },
    );
  }, 30_000);

  it('(b) any sequence of 1 to 20 Command_List lines resolves, with no hidden internal error', async () => {
    const { shell, internalErrors } = makeFixture({ baseline: false });
    await fc.assert(
      fc.asyncProperty(arbSequence, async (lines) => {
        for (const line of lines) {
          const r = await shell.run(line);
          expectClean(r);
          expect(internalErrors).toEqual([]);
        }
      }),
      { numRuns: 200 },
    );
  }, 30_000);

  it('(c) a first token outside the Command_List gives `command not found` or a syntax error', async () => {
    const { shell, internalErrors } = makeFixture({ baseline: false });
    await fc.assert(
      fc.asyncProperty(arbUnlistedName, fc.array(arbArg, { maxLength: 4 }), async (name, args) => {
        const r = await shell.run([name, ...args].join(' '));
        expectClean(r);
        expect(r.exitCode === 127 || r.exitCode === 2).toBe(true);
        expect(r.output.startsWith(`${name}: command not found`) || r.output.startsWith('sh: syntax error')).toBe(true);
        expect(internalErrors).toEqual([]);
      }),
      { numRuns: 200 },
    );
  }, 30_000);
});
