// Feature: shell, Property 13: The VFS shows the Engine as it is now
// **Validates: Requirements 4.2, 4.3, 4.4, 4.5, 6.1, 6.2, 11.7**
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { gameTimeIso } from '../engine/clock';
import { WHOLE_RUN_TIMEOUT_MS } from '../engine/test-fixtures/timeouts';
import { sha256Hex } from './sha256';
import { makeFixture, type PlantSpec } from './test-fixtures/fixture';
import { compareCodePoints } from './text';

const UPLOADS = '/srv/juice-shop/uploads';
const ACCESS = '/var/log/nginx/access.log';
const APP = '/var/log/juice-shop/app.log';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** What `run` prints for a log or file: sanitized, one final newline dropped. */
const shown = (text: string): string => (text.endsWith('\n') ? text.slice(0, -1) : text);

const arbSeg = fc.constantFrom('a.txt', 'B.php', 'shell.php', 'x', 'y.bin', 'sub', 'deep', 'z9');
const arbContent = fc.stringMatching(/^[a-z0-9]{1,20}$/);
// Unique paths where no path is a directory prefix of another path.
const arbPlants = fc
  .uniqueArray(fc.array(arbSeg, { minLength: 1, maxLength: 3 }).map((s) => s.join('/')), { maxLength: 5 })
  .filter((paths) => paths.every((p) => paths.every((q) => p === q || !q.startsWith(`${p}/`))))
  .chain((paths) =>
    fc.tuple(...paths.map((path) => arbContent.map((content): PlantSpec => ({ path, content })))),
  );
const arbEvidence = fc.uniqueArray(fc.constantFrom('snap1', 'snap2', 'before', 'after.1', 'x'), { maxLength: 3 });
const arbAdvances = fc.array(fc.integer({ min: 0, max: 20_000 }), { minLength: 1, maxLength: 2 });

function directChildren(paths: string[]): string[] {
  return [...new Set(paths.map((p) => p.split('/')[0]!))].sort(compareCodePoints);
}

describe('Property 13: the VFS shows the Engine as it is now', () => {
  it('logs, uploads, evidence and rm follow the Engine', async () => {
    await fc.assert(
      fc.asyncProperty(arbPlants, arbEvidence, arbAdvances, async (plant, evidence, advances) => {
        const [first, ...rest] = advances as [number, ...number[]];
        const fx = makeFixture({ baseline: false, plant, advanceMs: first, evidence });
        const { shell, engine, world } = fx;

        // Logs at the moment of each read, between advances.
        for (const ms of [0, ...rest]) {
          if (ms > 0) engine.advance(ms);
          const access = await shell.run(`cat ${ACCESS}`);
          expect(access.output).toBe(shown(engine.accessLog()));
          const app = await shell.run(`cat ${APP}`);
          expect(app.output).toBe(shown(engine.appLog()));
          const now = Date.parse(gameTimeIso(world));
          for (const line of access.output.split('\n')) {
            if (line === '') continue;
            const m = /\[(\d\d)\/(\w{3})\/(\d{4}):(\d\d:\d\d:\d\d) \+0000\]/.exec(line);
            expect(m, line).not.toBeNull();
            const iso = `${m![3]}-${String(MONTHS.indexOf(m![2]!) + 1).padStart(2, '0')}-${m![1]}T${m![4]}Z`;
            expect(Date.parse(iso)).toBeLessThanOrEqual(now);
          }
        }

        // Uploads: direct children, exact bytes and digests.
        const files = engine.files();
        const listing = await shell.run(`ls ${UPLOADS}`);
        expect(listing.output).toBe(directChildren(files.map((f) => f.path)).join('\n'));
        for (const f of files) {
          const cat = await shell.run(`cat ${UPLOADS}/${f.path}`);
          const content = plant.find((p) => p.path === f.path)!.content as string;
          expect(cat.output).toBe(content);
          expect(sha256Hex(new TextEncoder().encode(cat.output))).toBe(f.sha256);
        }

        // Evidence: every Engine entry as <name>.tgz, no duplicates.
        const ev = await shell.run('ls /evidence');
        const names = ev.output === '' ? [] : ev.output.split('\n');
        expect(names).toEqual(engine.evidence().map((e) => `${e.name}.tgz`).sort(compareCodePoints));
        expect(new Set(names).size).toBe(names.length);

        // rm of an uploaded file: when the Engine removed it, the next ls omits it.
        if (files.length > 0) {
          const target = files[0]!.path;
          await shell.run(`rm ${UPLOADS}/${target}`);
          const remaining = engine.files().map((f) => f.path);
          const after = await shell.run(`ls ${UPLOADS}`);
          expect(after.output).toBe(directChildren(remaining).join('\n'));
          if (!remaining.includes(target)) {
            expect(fx.actsOfType('DEF-15').some((a) => a.path === target)).toBe(true);
          }
        }
      }),
      { numRuns: 100 },
    );
  }, WHOLE_RUN_TIMEOUT_MS * 3);
});
