/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOVE_BY_ID } from '../rules/moves';
import type { MoveId } from '../rules/vocabulary';
import { COMMITTED_LIBRARY, Engine } from './engine';
import { gains } from './facts';
import { eventsOfKind } from './log';
import { startReplay } from './replay';
import { runSim } from './sim';
import { WHOLE_RUN_TIMEOUT_MS } from './test-fixtures/timeouts';

const baseline = () => readFileSync(new URL('../recordings/juiceshop.sqlite', import.meta.url));

describe('Engine', () => {
  it('ships every recording committed in src/recordings/ (KI-17)', () => {
    const files = readdirSync(new URL('../recordings/', import.meta.url)).filter((f) => f.endsWith('.json')).sort();
    expect(files.length).toBeGreaterThanOrEqual(14);
    for (const f of files) {
      const [move, variant] = f.replace(/\.json$/, '').split(/\.(?=[a-z]$)/) as [MoveId, string];
      expect(COMMITTED_LIBRARY.variantsOf(move).map((v) => v.variant), f).toContain(variant);
    }
    expect(COMMITTED_LIBRARY.variantsOf('ATK-08').map((v) => v.variant)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']); // D-63 halves; D-42 plays only .d–.g
    expect(COMMITTED_LIBRARY.variantsOf('CUST').map((v) => v.variant)).toEqual(['a']); // the customers, from traffic/ (D-62, D-65)
  });

  it('plays both of his sign-ups (ATK-06.a and ATK-11.a record the same new id) as two accounts, in the world and in sqlite3', async () => {
    const e = new Engine({ seed: 1, difficulty: 'medium', baseline: baseline() });
    for (const move of ['ATK-06', 'ATK-11'] as const) {
      startReplay(e.world, COMMITTED_LIBRARY.variantsOf(move)[0]!, 'death');
      e.advance(2000);
    }
    expect(e.world.accounts.filter((a) => a.createdBy !== 'seed').map((a) => [a.id, a.email, a.createdBy])).toEqual([
      [326, 'reaper@example.org', 'ATK-06'], [327, 'support-ops@juice-sh.op', 'ATK-11'],
    ]);
    const g = await e.db();
    expect(g.db.exec("SELECT id, email, role FROM Users WHERE id > 325 ORDER BY id")[0]!.values).toEqual([
      [326, 'reaper@example.org', 'admin'], [327, 'support-ops@juice-sh.op', 'admin'],
    ]);
  });

  it('ATK-17.a renames product 1 (a defacement by ATK-17) and leaves the ransom note', () => {
    const e = new Engine({ seed: 1, difficulty: 'medium' });
    startReplay(e.world, COMMITTED_LIBRARY.variantsOf('ATK-17')[0]!, 'death');
    e.advance(2000);
    expect(e.world.defacements).toEqual([{ productId: 1, kind: 'deface', by: 'ATK-17' }]);
    expect(e.files().map((f) => f.path)).toEqual(['complaints/READ_ME_MORTAL.txt']);
    expect([...gains(e.world)]).toEqual(expect.arrayContaining(['defaced', 'ransom']));
  });

  it('runs the committed library with the real baseline: db() reflects a replayed change and a DEF-08 lock', async () => {
    const e = new Engine({ seed: 1, difficulty: 'medium', baseline: baseline() });
    startReplay(e.world, COMMITTED_LIBRARY.variantsOf('ATK-03')[0]!, 'death');
    e.advance(600);
    expect(e.accessLog().split('\n')).toContain('203.0.113.23 - - [31/Oct/2026:22:00:15 +0000] "POST /rest/user/login HTTP/1.1" 200 784 "-" "curl/8.23.0"'); // among the customers' lines (D-65)
    expect(e.act({ type: 'DEF-08', email: 'jim@juice-sh.op' }).ok).toBe(true);
    const g = await e.db();
    expect(g.db.exec("SELECT deletedAt IS NOT NULL FROM Users WHERE email='jim@juice-sh.op'")[0]!.values).toEqual([[1]]);
    expect(e.files()).toEqual([]);
    expect(e.evidence()).toEqual([]);
    expect(e.appLog()).toBe('');
  });

  it('db() without a baseline rejects with a clear message', async () => {
    await expect(new Engine({ seed: 1, difficulty: 'medium' }).db()).rejects.toThrow(/baseline/);
  });

  it('pause only works on Easy, and subscribe fires after advance and act until unsubscribed', () => {
    const e = new Engine({ seed: 1, difficulty: 'easy' });
    let calls = 0;
    const off = e.subscribe(() => calls++);
    e.advance(100);
    e.act({ type: 'DEF-07' });
    expect(calls).toBe(2);
    off();
    e.advance(100);
    expect(calls).toBe(2);
    expect(e.pause()).toBe(true);
    const t = e.world.clock.gameMs;
    e.advance(1000);
    expect(e.world.clock.gameMs).toBe(t);
    e.resume();
    e.advance(1000);
    expect(e.world.clock.gameMs).toBe(t + 30_000);
    expect(new Engine({ seed: 1, difficulty: 'medium' }).pause()).toBe(false);
    expect(eventsOfKind(e.world, 'action')).toHaveLength(1);
  });
});

describe('a real run on the committed recordings, nobody at the keyboard (KI-17)', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
  const REAL_MIN = 60_000;
  // D-42: half a door per visit, so an idle run lasts longer than it did; 30 real minutes is room for every level.
  const idle = (seed: number, difficulty: 'easy' | 'medium' | 'hard') => runSim({ seed, difficulty, library: COMMITTED_LIBRARY, maxRealMs: 30 * REAL_MIN, player: () => [] });

  it('seed 1, Medium: Death climbs the stages in order (scan, break in, admin, harvest), keeps robbing the search door, and the player loses; no false win', () => {
    const r = idle(1, 'medium');
    const landed = eventsOfKind(r.world, 'move-landed').map((e) => e.move);
    expect(landed.slice(0, 4).map((m) => MOVE_BY_ID[m].stage)).toEqual([1, 2, 3, 4]);
    const harvests = eventsOfKind(r.world, 'move-started').filter((e) => e.move === 'ATK-08').map((e) => e.variant);
    expect(harvests[0]).toBe('d'); // D-42: the quiet halves on Medium
    expect(harvests.length).toBeGreaterThanOrEqual(3); // he keeps coming back to his door
    expect(eventsOfKind(r.world, 'banished')).toEqual([]);
    expect(['souls-lost', 'flatline']).toContain(eventsOfKind(r.world, 'ending')[0]?.ending);
    const byTen = eventsOfKind(r.world, 'souls-stolen').filter((e) => e.t <= 10 * REAL_MIN * 30).at(-1)!.stolen;
    expect(byTen).toBeGreaterThanOrEqual(r.world.souls.total / 2); // SIM-1 on the real recordings (D-42)
  });

  it('on every level and a few seeds: stage order holds, he reaches the harvest, ATK-08.a never plays, and an idle player never wins', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const r = idle(seed, difficulty);
        const started = eventsOfKind(r.world, 'move-started');
        let highest = 0;
        for (const e of eventsOfKind(r.world, 'move-landed')) {
          const stage = MOVE_BY_ID[e.move].stage;
          if (stage > highest) expect(stage, `${difficulty} seed ${seed}: ${e.move}`).toBe(highest + 1);
          highest = Math.max(highest, stage);
        }
        expect(highest, `${difficulty} seed ${seed}`).toBeGreaterThanOrEqual(3);
        expect(started.some((e) => MOVE_BY_ID[e.move].stage === 4), `${difficulty} seed ${seed}`).toBe(true);
        for (const v of ['a', 'b', 'c']) expect(started.filter((e) => e.move === 'ATK-08').map((e) => e.variant)).not.toContain(v); // D-42: only the halves
        expect(['souls-lost', 'flatline'], `${difficulty} seed ${seed}`).toContain(eventsOfKind(r.world, 'ending')[0]?.ending); // D-41: after the ransom he stops, and the defacement can flatline the shop first
      }
    }
  });
});
