// The battlefield and the results (D-225) against the real engine: gates seal when the engine's fixes hold, the key
// is the engine's gains, the roots its footholds; an outcome is only "contained" when the engine cut an attack by
// that action; a button and the typed command are the same engine action.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Engine } from '../../engine/engine';
import { MOVES } from '../../rules/moves';
import { Battle, GATES, battleOf, fxOf, gateOf, menaceStep } from './battle';
import { liveAttacks, outcomeOf, type Pending } from './results';
import { lab } from '../../engine/test-fixtures/lab';
import { runOn } from './run';
import { commandFor, situationOf } from './situations';

const baseline = () => new Uint8Array(readFileSync(new URL('../../recordings/juiceshop.sqlite', import.meta.url)));
/** A run whose shift has begun, as the play screen begins it when it shows (D-243). */
const fresh = (difficulty: 'easy' | 'medium' | 'hard' = 'medium', seed = 7) => {
  const r = runOn(new Engine({ seed, difficulty, baseline: baseline() }));
  r.engine.beginShift();
  return r;
};
/** The same run with the incident already declared, so an action lands at once (the change freeze, D-230). */
const declared = (difficulty: 'easy' | 'medium' | 'hard' = 'medium', seed = 7) => { const r = fresh(difficulty, seed); lab(r.engine.world); return r; };
const pendingFor = (run: ReturnType<typeof fresh>, type: Pending['type'], ok = true): Pending => ({ type, ok, message: '', from: run.engine.world.events.length, heartbeat: run.engine.world.heartbeat, max: run.engine.world.heartbeatMax, at: 0, live: liveAttacks(run.engine.world) });

describe('the battlefield is the engine, drawn (D-225)', () => {
  it('every one of his moves comes through one of seven gates', () => {
    expect(GATES).toHaveLength(7);
    for (const m of MOVES) expect(gateOf(m.id), m.id).toBeDefined();
    expect(new Set(GATES.flatMap((g) => g.moves)).size).toBe(MOVES.length);
  });

  it('a gate seals when the engine says a fix holds for every attack through it', () => {
    const r = declared();
    expect(battleOf(r.engine.world).gates.search).not.toBe('sealed');
    r.engine.act({ type: 'DEF-10', feature: 'search', enabled: false });
    expect(battleOf(r.engine.world).gates.search).toBe('sealed');
    expect(battleOf(r.engine.world).gates.login).not.toBe('sealed');
  });

  it("shows his live attacks, the stolen key, his roots and the souls from the engine's state", () => {
    const r = fresh('hard', 3);
    let saw = { raid: false, key: false, roots: false, stage: 0 };
    for (let i = 0; i < 4000 && !r.engine.world.ending; i++) {
      r.engine.advance(500);
      const v = battleOf(r.engine.world);
      saw = { raid: saw.raid || v.raids.length > 0, key: saw.key || v.key, roots: saw.roots || v.roots.length > 0, stage: Math.max(saw.stage, v.stage) };
      expect(v.souls).toBe(r.engine.world.souls.total - r.engine.world.souls.stolen.length);
    }
    expect(saw.raid).toBe(true);
    expect(saw.stage).toBeGreaterThanOrEqual(3);
    expect(saw.key || saw.roots).toBe(true);
  });

  it('plays a shield on a cut, a breach on a landing, souls on a theft; and a shattered key when the key goes', () => {
    const ev = (body: object) => ({ t: 0, id: 1, ...body }) as never;
    expect(fxOf(ev({ kind: 'move-cut', move: 'ATK-04', variant: 'a', by: 'DEF-07' }))[0]).toEqual({ kind: 'shield', gate: 'login' });
    expect(fxOf(ev({ kind: 'move-landed', move: 'ATK-08', variant: 'd' }))[0]).toEqual({ kind: 'breach', gate: 'search' });
    expect(fxOf(ev({ kind: 'souls-stolen', by: 'ATK-08', count: 4, stolen: 4, total: 325 }))).toEqual([{ kind: 'souls', n: 4 }]);
    expect(fxOf(ev({ kind: 'action', action: { type: 'DEF-01', query: 'x' }, ok: true }))).toEqual([]);
    const r = declared();
    const b = new Battle();
    b.update(r.engine.world, 0);
    r.engine.world.sessions.push({ id: 99, email: 'admin@juice-sh.op', kind: 'admin', issuedBy: 'ATK-03', keyVersion: r.engine.world.signingKey.version });
    expect(b.update(r.engine.world, 1).key).toBe(true);
    r.engine.act({ type: 'DEF-09' });
    expect(b.update(r.engine.world, 2).key).toBe(false);
    expect(b.fresh(2, 0.5)).toContain('key');
  });
});

describe("Death's menace follows the engine (D-226)", () => {
  it("his successes bring him closer, the player's cuts push him back, banishment ends him", () => {
    const ev = (body: object) => ({ t: 0, id: 1, ...body }) as never;
    expect(menaceStep(ev({ kind: 'move-landed', move: 'ATK-06', variant: 'a' }))).toBeGreaterThan(0);
    expect(menaceStep(ev({ kind: 'souls-stolen', by: 'ATK-08', count: 5, stolen: 5, total: 325 }))).toBeGreaterThan(0);
    expect(menaceStep(ev({ kind: 'move-cut', move: 'ATK-06', variant: 'a', by: 'DEF-14' }))).toBeLessThan(0);
    expect(menaceStep(ev({ kind: 'door-shut', move: 'ATK-08', by: 'DEF-13' }))).toBeLessThan(0);
    expect(menaceStep(ev({ kind: 'banished' }))).toBe(-1);
    expect(menaceStep(ev({ kind: 'action', action: { type: 'DEF-01', query: 'x' }, ok: true }))).toBe(0);
  });

  it('over a run left alone he only comes closer; a fix that stops his move pushes him back', () => {
    const r = fresh('hard', 3);
    const b = new Battle();
    b.update(r.engine.world, 0);
    let t = 0;
    let low = 1;
    for (let i = 0; i < 400 && !r.engine.world.ending; i++) {
      r.engine.advance(500);
      t += 0.5;
      b.update(r.engine.world, t);
      low = Math.min(low, b.menace);
    }
    expect(b.menace).toBeGreaterThan(0.5);
    const c = fresh('medium', 7);
    const bc = new Battle();
    bc.update(c.engine.world, 0);
    for (let i = 0; i < 160 && !(c.engine.world.replays.some((x) => x.move === 'ATK-01') && c.engine.world.incident.declaredAt !== undefined); i++) c.engine.advance(250); // the calm opening, then the scan's first alert lifts the freeze (D-230, D-232)
    expect(c.engine.world.replays.some((x) => x.move === 'ATK-01')).toBe(true);
    bc.update(c.engine.world, 1);
    const before = bc.menace;
    c.engine.act({ type: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'Fuzz Faster U Fool' } });
    c.engine.advance(250);
    bc.update(c.engine.world, 2);
    expect(bc.menace).toBeLessThan(before);
  });
});

describe('RESULT says what the engine did, never more (D-225)', () => {
  it('reads show nothing and cost nothing', () => {
    const r = fresh();
    r.engine.advance(2000);
    const p = pendingFor(r, 'DEF-01');
    r.engine.act({ type: 'DEF-01', query: 'grep x', shown: [], shownTotal: 0 });
    expect(outcomeOf(p, r.engine.world, 99)).toBeNull();
    expect(Math.round(r.engine.world.heartbeat)).toBe(Math.round(p.heartbeat));
  });

  it('a refused action is "didn\'t work"; a plug pulled is a shut-down shop, and it costs the customers', () => {
    const r = declared();
    expect(outcomeOf({ ...pendingFor(r, 'DEF-06'), ok: false }, r.engine.world, 0)).toBe('failed');
    const p = pendingFor(r, 'DEF-11');
    r.engine.act({ type: 'DEF-11' });
    expect(outcomeOf(p, r.engine.world, 0)).toBeNull();
    for (let i = 0; i < 10; i++) r.engine.advance(500);
    expect(outcomeOf(p, r.engine.world, 10)).toBe('shutdown');
    expect(r.engine.world.heartbeat).toBeLessThan(p.heartbeat);
  });

  it('contained when the engine stops the running attack by that action (D-45 freezes it, then cuts it)', () => {
    const r = fresh('medium', 7);
    // wait for his scan, then block the scanner's tool, the fix that stops it (rules/moves.ts)
    for (let i = 0; i < 160 && !(r.engine.world.replays.some((x) => x.move === 'ATK-01') && r.engine.world.incident.declaredAt !== undefined); i++) r.engine.advance(250); // the calm opening, then the scan's first alert lifts the freeze (D-230, D-232)
    expect(r.engine.world.replays.some((x) => x.move === 'ATK-01')).toBe(true);
    const p = pendingFor(r, 'DEF-12');
    r.engine.act({ type: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'Fuzz Faster U Fool' } });
    for (let i = 0; i < 8; i++) r.engine.advance(250);
    expect(outcomeOf(p, r.engine.world, 1)).toBe('contained');
  });

  it('the button and the typed command are the same engine action', async () => {
    const a = fresh('medium', 7);
    const b = fresh('medium', 7);
    // past the calm to the first alert (the scan), which lifts the freeze (D-230, D-252); both runs step alike
    let n = 0;
    while (n < 160 && a.engine.world.incident.declaredAt === undefined) {
      a.engine.advance(250);
      n++;
    }
    for (let i = 0; i < n; i++) b.engine.advance(250);
    const s = situationOf(a.engine.world);
    const ip = a.engine.topTalkers(1)[0]!.ip;
    // the button runs the situation's command; the player types the same line
    const line = commandFor(s.act!, ip) ?? `iptables -A INPUT -s ${ip} -j DROP`;
    await a.shell.run(line);
    await b.shell.run(`iptables -A INPUT -s ${ip} -j DROP`);
    const last = (r: typeof a) => r.engine.world.events.filter((e) => e.kind === 'action').pop();
    expect(last(a)).toMatchObject({ action: { type: 'DEF-06', ip, op: 'add' }, ok: true });
    expect({ ...last(a), id: 0, t: 0 }).toEqual({ ...last(b), id: 0, t: 0 });
    expect(a.engine.world.firewall.blocked).toEqual(b.engine.world.firewall.blocked);
  });
});
