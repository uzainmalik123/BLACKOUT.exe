/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMMITTED_LIBRARY, Engine } from './engine';
import { eventsOfKind } from './log';
import { startReplay } from './replay';

const baseline = () => readFileSync(new URL('../recordings/juiceshop.sqlite', import.meta.url));

describe('Engine', () => {
  it('ships the committed recordings: ATK-03.a and ATK-08.a', () => {
    expect(COMMITTED_LIBRARY.variantsOf('ATK-03').map((v) => v.variant)).toEqual(['a']);
    expect(COMMITTED_LIBRARY.variantsOf('ATK-08').map((v) => v.variant)).toEqual(['a']);
  });

  it('runs the committed library with the real baseline: db() reflects a replayed change and a DEF-08 lock', async () => {
    const e = new Engine({ seed: 1, difficulty: 'medium', baseline: baseline() });
    startReplay(e.world, COMMITTED_LIBRARY.variantsOf('ATK-03')[0]!, 'death');
    e.advance(600);
    expect(e.accessLog()).toBe('203.0.113.23 - - [31/Oct/2026:22:00:15 +0000] "POST /rest/user/login HTTP/1.1" 200 784 "-" "curl/8.23.0"\n');
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
