// The night shift runs on the real engine, shell and database (D-223): an integration test of the wiring the
// dashboard relies on, with no stub anywhere.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Engine } from '../../engine/engine';
import { lab } from '../../engine/test-fixtures/lab';
import { ENDINGS, anomalies } from './judge';
import { readingsOf, runOn } from './run';

const baseline = () => new Uint8Array(readFileSync(new URL('../../recordings/juiceshop.sqlite', import.meta.url)));
/** A run whose shift has begun, as the play screen begins it when it shows (D-243). */
const newRun = (difficulty: 'easy' | 'medium' | 'hard' = 'medium', seed = 7) => {
  const r = runOn(new Engine({ seed, difficulty, baseline: baseline() }));
  r.engine.beginShift();
  return r;
};

describe('the night shift on the real engine (D-223)', () => {
  it('a run does not begin the shift: the play screen does, when it shows (D-243, KI-230)', () => {
    const { engine } = runOn(new Engine({ seed: 7, difficulty: 'medium', baseline: baseline() }));
    for (let i = 0; i < 160; i++) engine.advance(250);
    expect(engine.world.shift.beganAt).toBeUndefined();
    expect(engine.world.events.some((e) => e.kind === 'move-started')).toBe(false);
  });

  it('a training run volunteers no hint (KI-235, D-275); a real run keeps its hints', async () => {
    const drill = runOn(new Engine({ scenario: 'training', baseline: baseline() }));
    drill.engine.beginShift();
    for (let i = 0; i < 200; i++) drill.engine.advance(250); // past the drill's first alert
    expect(drill.engine.world.alerts.length).toBeGreaterThan(0);
    expect(await drill.kiro.hint()).toBeNull();
    const real = runOn(new Engine({ seed: 7, difficulty: 'easy', baseline: baseline() }));
    expect(real.kiro.hint).not.toBe(drill.kiro.hint);
  });

  it('the first check reads Death\'s first scan in the live numbers', () => {
    const { engine } = newRun();
    for (let i = 0; i < 160; i++) engine.advance(250); // 40 real s: past the calm opening (D-230: 20–30 s on Medium)
    const r = readingsOf(engine);
    expect(r.requests).toBeGreaterThan(0);
    expect(r.nginx).toBe('running');
    expect(engine.world.events.some((e) => e.kind === 'move-started')).toBe(true);
    expect(anomalies(r).length).toBeGreaterThan(0);
  });

  it('grep, sqlite3, iptables and systemctl run through the shell and change the world as the engine says', async () => {
    const { engine, shell } = newRun();
    for (let i = 0; i < 160; i++) engine.advance(250); // past the calm opening and its first alert (D-230, D-232)
    // Juice Shop answers unknown paths with 200: the scan shows as a tool's name, which grep finds
    const grep = await shell.run('grep "Fuzz Faster" /var/log/nginx/access.log | head -3');
    expect(grep.exitCode).toBe(0);
    expect(grep.output.split('\n').filter(Boolean).length).toBe(3);
    const sql = await shell.run('sqlite3 /srv/juice-shop/data/juiceshop.sqlite "SELECT email FROM Users WHERE role = \'admin\' LIMIT 2;"');
    expect(sql.exitCode).toBe(0);
    expect(sql.output).toMatch(/@/);
    const ip = engine.topTalkers(1)[0]!.ip;
    const block = await shell.run(`iptables -A INPUT -s ${ip} -j DROP`);
    expect(block.exitCode).toBe(0);
    expect(engine.world.firewall.blocked).toContain(ip);
    await shell.run('systemctl stop nginx');
    expect(engine.world.nginx).toBe('stopped');
    await shell.run('systemctl start nginx');
    expect(engine.world.nginx).toBe('running');
    // every one of those went through engine.act and is in the event log
    expect(engine.world.events.filter((e) => e.kind === 'action').length).toBeGreaterThanOrEqual(4);
  });

  it('a console button is an engine action whose answer the screen shows; harmless reads cost nothing', () => {
    const { engine } = newRun();
    lab(engine.world); // the incident declared: a console action lands at once (the change freeze, D-230)
    engine.advance(1000);
    const before = engine.world.heartbeat;
    const r = engine.act({ type: 'DEF-12', rule: { kind: 'sqli' } });
    expect(r.ok).toBe(true);
    expect(r.message.length).toBeGreaterThan(0);
    expect(engine.world.waf.length).toBe(1);
    engine.act({ type: 'DEF-01', query: 'x', shown: [], shownTotal: 0 });
    expect(engine.world.heartbeat).toBe(before);
  });

  it('left alone, a run reaches one of the endings the screens word', () => {
    const { engine } = newRun('hard', 3);
    for (let i = 0; i < 4000 && !engine.world.ending; i++) engine.advance(500);
    expect(engine.world.ending).toBeDefined();
    expect(ENDINGS[engine.world.ending!]).toBeDefined();
    expect(ENDINGS[engine.world.ending!].won).toBe(false);
  });
});
