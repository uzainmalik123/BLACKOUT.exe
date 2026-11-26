// The play screen's situations (UI-04, D-224, D-241) against the real shell and engine: every alert shows its symptom
// and never who raised it, every suggested look is a command the shell runs, every action is one the engine accepts,
// Hard suggests nothing, and targets are picked from output.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gateOf } from '../../engine/alerts';
import { Engine } from '../../engine/engine';
import { TAPS } from '../../rules/taps';
import { runOn } from './run';
import { commandFor, forLevel, situationOf, tokens, type Situation } from './situations';

const baseline = () => new Uint8Array(readFileSync(new URL('../../recordings/juiceshop.sqlite', import.meta.url)));
const fresh = () => {
  const r = runOn(new Engine({ seed: 11, difficulty: 'medium', baseline: baseline() }));
  r.engine.beginShift();
  return r;
};
/** Every route an alert can name (engine/alerts.ts), with the gate the engine derives from it. */
const ROUTES = ['/', '/rest/user/login', '/rest/user/login (passwords)', '/rest/products/search', '/api/Users (sign-up)', '/api/Users', '/api/Products', '/file-upload', '/api/Feedbacks', ...TAPS.map((t) => t.closedBy.rule.path)];

/** The situation an open alert on `route` would show; its `about` is a decoy that must never reach the screen. */
function onRoute(run: ReturnType<typeof fresh>, route: string, about = 'ATK-08'): Situation {
  run.engine.world.alerts.push({ id: 900, about: about as never, openedAt: 0, route: route.replace(/ \(.*\)$/, ''), symptom: `unusual activity on ${route}: 9 requests in 30 s`, gate: gateOf(route) });
  const s = situationOf(run.engine.world);
  run.engine.world.alerts.pop();
  return s;
}

describe('one problem at a time, in plain words (D-224, D-241)', () => {
  it('shows the symptom and the route, a line from Kiro and a way to look, for every route an alert can name', () => {
    const r = fresh();
    for (const route of ROUTES) {
      const s = onRoute(r, route);
      expect(s.alert, route).toMatch(/^unusual activity on /);
      expect(s.route, route).toBe(route.replace(/ \(.*\)$/, ''));
      expect(s.gate, route).toBe(gateOf(route));
      expect(`${s.alert} ${s.kiro}`, route).not.toMatch(/ATK-|MIN-|TAP-|T1\d/);
      expect(s.kiro.length, route).toBeGreaterThan(5);
      expect(s.look.cmd, route).toBeTruthy();
    }
    expect(situationOf(r.engine.world).key).toBe('quiet');
  });

  it('never reads who raised the alert: the same route gives the same situation whoever it was (D-232)', () => {
    const r = fresh();
    for (const route of ROUTES) {
      const a = onRoute(r, route, 'ATK-01');
      const b = onRoute(r, route, 'MIN-02');
      expect({ ...a, look: a.look.label, act: a.act?.label }).toEqual({ ...b, look: b.look.label, act: b.act?.label });
    }
  });

  it('every look runs in the shell, and every action is one the engine knows', async () => {
    const r = fresh();
    for (let i = 0; i < 20; i++) r.engine.advance(500);
    for (const route of ROUTES) {
      const s = onRoute(r, route);
      const res = await r.shell.run(commandFor(s.look, null)!);
      expect(res.exitCode, `${route}: ${s.look.cmd}\n${res.output}`).toBe(0);
      if (!s.act) continue;
      const target = s.act.needs === 'ip' ? '203.0.113.200' : s.act.needs === 'email' ? 'nobody@juice-sh.op' : s.act.needs === 'file' ? 'nothing.txt' : '';
      if (s.act.cmd) expect(commandFor(s.act, target), route).not.toContain('{target}');
      else expect(s.act.action!(target, r.engine.world).type, route).toMatch(/^DEF-\d\d$/);
    }
  });

  it('an action that needs a target waits for one', () => {
    const s = onRoute(fresh(), '/');
    expect(s.act?.needs).toBe('ip');
    expect(commandFor(s.act!, null)).toBeNull();
    expect(commandFor(s.act!, '203.0.113.11')).toBe('iptables -A INPUT -s 203.0.113.11 -j DROP');
  });

  it('on Hard suggests no action and gives no clue, but still shows the symptom', () => {
    const s = forLevel(onRoute(fresh(), '/api/Users (sign-up)'), 'hard');
    expect(s).toMatchObject({ act: null, kiro: 'Something is wrong. Find it.', alert: 'unusual activity on /api/Users (sign-up): 9 requests in 30 s' });
    expect(forLevel(onRoute(fresh(), '/api/Users (sign-up)'), 'easy').act?.label).toBe('Lock an account');
  });

  it('picks addresses, accounts and upload files out of the output', () => {
    expect(tokens('   4756 203.0.113.11', [])).toEqual([{ text: '   4756 ' }, { text: '203.0.113.11', kind: 'ip' }]);
    expect(tokens('27|admin@juice-sh.op|2026', []).map((t) => t.kind)).toEqual([undefined, 'email', undefined]);
    expect(tokens('-rw-r--r-- 1 shop shop 120 shell.php', ['shell.php']).pop()).toEqual({ text: 'shell.php', kind: 'file' });
    expect(tokens('see notshell.php', ['shell.php']).some((t) => t.kind === 'file')).toBe(false);
  });
});
