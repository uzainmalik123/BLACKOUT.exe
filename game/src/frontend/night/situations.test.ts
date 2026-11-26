// The play screen's situations (UI-04, D-224) against the real shell and engine: every suggested look is a command
// the shell runs, every action is one the engine accepts, Hard suggests nothing, and targets are picked from output.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Engine } from '../../engine/engine';
import { MINION_IDS, TAP_IDS } from '../../rules/vocabulary';
import { MOVES } from '../../rules/moves';
import { runOn } from './run';
import { commandFor, forLevel, situationOf, tokens, type Situation } from './situations';

const baseline = () => new Uint8Array(readFileSync(new URL('../../recordings/juiceshop.sqlite', import.meta.url)));
const fresh = () => runOn(new Engine({ seed: 11, difficulty: 'medium', baseline: baseline() }));
const ACTORS = [...MOVES.map((m) => m.id), ...MINION_IDS, ...TAP_IDS];

/** The situation an open alert about `about` would show. */
function about(run: ReturnType<typeof fresh>, about: string): Situation {
  run.engine.world.alerts.push({ id: 900, about: about as never, openedAt: 0, route: '/', symptom: 'unusual activity on the site', gate: 'front door' });
  const s = situationOf(run.engine.world);
  run.engine.world.alerts.pop();
  return s;
}

describe('one problem at a time, in plain words (D-224)', () => {
  it('has a plain alert, a line from Kiro and a way to look for everything that raises an alert', () => {
    const r = fresh();
    for (const a of ACTORS) {
      const s = about(r, a);
      expect(s.alert, a).not.toMatch(/ATK-|MIN-|TAP-|SQL|injection|T1\d/);
      expect(s.kiro.length, a).toBeGreaterThan(5);
      expect(s.look.cmd, a).toBeTruthy();
    }
    expect(situationOf(r.engine.world).key).toBe('quiet');
  });

  it('every look runs in the shell, and every action is one the engine knows', async () => {
    const r = fresh();
    for (let i = 0; i < 20; i++) r.engine.advance(500);
    for (const a of ACTORS) {
      const s = about(r, a);
      const res = await r.shell.run(commandFor(s.look, null)!);
      expect(res.exitCode, `${a}: ${s.look.cmd}\n${res.output}`).toBe(0);
      if (!s.act) continue;
      const target = s.act.needs === 'ip' ? '203.0.113.200' : s.act.needs === 'email' ? 'nobody@juice-sh.op' : s.act.needs === 'file' ? 'nothing.txt' : '';
      if (s.act.cmd) expect(commandFor(s.act, target), a).not.toContain('{target}');
      else expect(s.act.action!(target, r.engine.world).type, a).toMatch(/^DEF-\d\d$/);
    }
  });

  it('an action that needs a target waits for one', () => {
    const s = about(fresh(), 'ATK-01');
    expect(s.act?.needs).toBe('ip');
    expect(commandFor(s.act!, null)).toBeNull();
    expect(commandFor(s.act!, '203.0.113.11')).toBe('iptables -A INPUT -s 203.0.113.11 -j DROP');
  });

  it('on Hard names no stage and suggests no action', () => {
    const s = forLevel(about(fresh(), 'ATK-06'), 'hard');
    expect(s).toMatchObject({ stage: null, act: null, alert: 'Suspicious activity detected.' });
    expect(forLevel(about(fresh(), 'ATK-06'), 'easy')).toMatchObject({ stage: 3, alert: 'A new admin account just appeared.' });
  });

  it('picks addresses, accounts and upload files out of the output', () => {
    expect(tokens('   4756 203.0.113.11', [])).toEqual([{ text: '   4756 ' }, { text: '203.0.113.11', kind: 'ip' }]);
    expect(tokens('27|admin@juice-sh.op|2026', []).map((t) => t.kind)).toEqual([undefined, 'email', undefined]);
    expect(tokens('-rw-r--r-- 1 shop shop 120 shell.php', ['shell.php']).pop()).toEqual({ text: 'shell.php', kind: 'file' });
    expect(tokens('see notshell.php', ['shell.php']).some((t) => t.kind === 'file')).toBe(false);
  });
});
