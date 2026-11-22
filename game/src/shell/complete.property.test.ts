// Feature: shell, Property 26: Autocomplete
// **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COMMAND_LIST } from './index';
import { resolvePath } from './path';
import { HOME } from './session';
import { makeFixture } from './test-fixtures/fixture';
import { compareCodePoints } from './text';
import { VirtualFs } from './vfs';

const TIMEOUT_MS = 30_000;

// Directories to start from (all exist in the initial layout).
const arbCwd = fc.constantFrom('/', '/srv/juice-shop', '/var/log', '/var/log/nginx', '/tmp', '/evidence', '/srv');

// Path fragments: real names, partial names, dots, tilde, and random noise.
const arbPiece = fc.oneof(
  fc.constantFrom('srv', 'var', 'log', 'juice-shop', 'nginx', 'uploads', 'data', 'access.log', 'app.log', 'tmp', 'evidence', '..', '.', '~', '.h', 'a', 'S', ''),
  fc.stringMatching(/^[a-zA-Z0-9._-]{0,6}$/),
);
const arbPath = fc
  .tuple(fc.constantFrom('', '/', '~/', '../', './'), fc.array(arbPiece, { maxLength: 3 }), arbPiece)
  .map(([lead, mid, last]) => lead + [...mid, last].join('/'));
const arbName = fc.oneof(
  fc.constantFrom(...COMMAND_LIST).chain((n) => fc.integer({ min: 0, max: n.length }).map((k) => n.slice(0, k))),
  fc.stringMatching(/^[a-zA-Z0-9]{0,6}$/),
);
const arbPartial = fc.oneof(
  arbName,
  fc.tuple(fc.constantFrom('cat', 'ls', 'cd', 'grep -i x', '', ' ', 'rm  '), arbPath).map(([c, p]) => `${c} ${p}`),
  fc.tuple(arbName, fc.stringMatching(/^[ a-z/~.]{0,8}$/)).map(([a, b]) => `${a} ${b}`),
);

describe('Property 26: Autocomplete', () => {
  it(
    'returns at most 20 sorted unique prefix matches that exist, and changes nothing',
    async () => {
      const fx = makeFixture({ baseline: false, difficulty: 'easy', advanceMs: 5_000, evidence: ['snap1'] });
      const { shell, engine, world } = fx;
      const vfs = new VirtualFs(engine, new Map());
      expect(shell.complete).toBeDefined();
      const names = new Set<string>(COMMAND_LIST);

      await fc.assert(
        fc.asyncProperty(arbCwd, arbPartial, async (dir, partial) => {
          await shell.run(`cd ${dir}`);
          const cwd = (await shell.run('pwd')).output;
          const before = structuredClone(world);
          const listing = vfs.list(cwd);
          const actionsBefore = fx.actions().length;

          let result: string[] = [];
          expect(() => {
            result = shell.complete!(partial);
          }).not.toThrow();

          expect(result.length).toBeLessThanOrEqual(20);
          expect([...result].sort(compareCodePoints)).toEqual(result);
          expect(new Set(result).size).toBe(result.length);

          const typed = partial.includes(' ') ? partial.slice(partial.lastIndexOf(' ') + 1) : partial;
          for (const cand of result) {
            expect(cand.startsWith(typed), `${cand} vs ${typed}`).toBe(true);
            if (!partial.includes(' ')) {
              expect(names.has(cand)).toBe(true);
            } else if (cand === '~/') {
              expect(vfs.stat(HOME)).toBeDefined();
            } else {
              const expanded = cand.startsWith('~/') ? `${HOME}${cand.slice(1)}` : cand;
              expect(vfs.stat(resolvePath(cwd, expanded)), cand).toBeDefined();
            }
          }

          // Nothing changed: World, cwd, listing, actions.
          expect(world).toEqual(before);
          expect((await shell.run('pwd')).output).toBe(cwd);
          expect(vfs.list(cwd)).toEqual(listing);
          expect(fx.actions().length).toBe(actionsBefore);
        }),
        { numRuns: 100 },
      );
    },
    TIMEOUT_MS,
  );
});
