// Death's presence on the play screen (D-254): he appears, approaches, strikes, recoils and returns only on the
// engine's events, takes a new place each visit, and stands where he can be seen past the windows.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Engine } from '../../engine/engine';
import { Battle } from './battle';
import { HOLD, boxOf, placeDeath, presenceStep, startPresence, visibleShare, type Presence, type PresenceInput } from './presence';
import { runOn } from './run';

const ev = (body: object) => ({ t: 0, id: 1, ...body }) as never;
const quiet: Omit<PresenceInput, 't'> = { events: [], frozen: 0, danger: 0, live: 0 };
const step = (p: Presence, t: number, more: Partial<PresenceInput> = {}) => presenceStep(p, { ...quiet, t, ...more });

describe("Death's presence follows the engine (D-254)", () => {
  it('is away in the calm, and comes back out of the dark when an attack begins', () => {
    let p = startPresence();
    for (let t = 0; t < 10; t += 0.5) p = step(p, t);
    expect(p.mode).toBe('away');
    p = step(p, 10, { events: [ev({ kind: 'move-started', move: 'ATK-01', stage: 1 })], live: 1 });
    expect(p).toMatchObject({ mode: 'returning', visit: 1, move: 'ATK-01' });
    p = step(p, 10 + HOLD.returning, { live: 1 });
    expect(p.mode).toBe('approaching');
    p = step(p, 10 + HOLD.returning + HOLD.approaching, { live: 1 });
    expect(p.mode).toBe('watching');
  });

  it('strikes when an attack lands, then watches', () => {
    let p: Presence = { mode: 'watching', since: 0, visit: 2 };
    p = step(p, 5, { events: [ev({ kind: 'move-landed', move: 'ATK-08', variant: 'a' })] });
    expect(p).toMatchObject({ mode: 'striking', move: 'ATK-08', visit: 2 });
    expect(step(p, 5 + HOLD.striking).mode).toBe('watching');
  });

  it("recoils when the player's fix stops his attack (cut or frozen), stays away, and returns only when another attack runs", () => {
    for (const stop of [{ events: [ev({ kind: 'move-cut', move: 'ATK-01', variant: 'a', by: 'DEF-06' })] }, { frozen: 1 }]) {
      let p: Presence = { mode: 'approaching', since: 0, visit: 1, move: 'ATK-01' };
      p = step(p, 3, stop);
      expect(p.mode).toBe('recoiling');
      p = step(p, 3 + HOLD.recoiling);
      expect(p.mode).toBe('away');
      for (let t = 5; t < 30; t += 1) p = step(p, t, { live: 0 });
      expect(p.mode).toBe('away');
      p = step(p, 31, { live: 1 });
      expect(p).toMatchObject({ mode: 'returning', visit: 2 });
    }
  });

  it('looms when the business is close to failing, and steps back when it recovers', () => {
    let p: Presence = { mode: 'watching', since: 0, visit: 1 };
    p = step(p, 1, { danger: 2 });
    expect(p.mode).toBe('critical');
    p = step(p, 2, { danger: 3 });
    expect(p.mode).toBe('critical');
    p = step(p, 3, { danger: 1 });
    expect(p.mode).toBe('watching');
  });

  it('comes straight back, close, on his return', () => {
    const p = step({ mode: 'away', since: 0, visit: 4 }, 9, { events: [ev({ kind: 'return' })] });
    expect(p).toMatchObject({ mode: 'returning', sudden: true, visit: 5 });
  });

  it('nothing else moves him: reads, alerts and customer events leave him as he is', () => {
    const p: Presence = { mode: 'watching', since: 0, visit: 1 };
    const after = step(p, 1, { events: [ev({ kind: 'action', action: { type: 'DEF-01', query: 'x' }, ok: true }), ev({ kind: 'alert-opened', alert: 3, about: 'ATK-01' }), ev({ kind: 'ticket', about: 'login', status: 500 })] });
    expect(after).toEqual(p);
  });
});

describe('where he stands (D-254)', () => {
  const field = { w: 1400, h: 800 };
  const at = { shop: { x: 588, y: 400 }, gate: { x: 900, y: 300 } };
  // as the dock opens them at 1920 x 1080 (measured): the alerts and the logs on the left, the terminal in the middle
  const cover = [
    { x: 40, y: 20, w: 550, h: 255 },
    { x: 40, y: 300, w: 550, h: 460 },
    { x: 625, y: 225, w: 660, h: 540 },
  ];

  it('watching, he stands where most of him can be seen, beside a window, never hidden behind one', () => {
    const s = placeDeath('watching', 1, field, cover, at);
    expect(s.seen).toBeGreaterThanOrEqual(0.55);
    expect(visibleShare(boxOf(s.x, s.y, s.s), field, cover)).toBe(s.seen);
    expect(s.x - 0.56 * s.s).toBeGreaterThanOrEqual(-1);
    expect(s.x + 0.32 * s.s).toBeLessThanOrEqual(field.w + 1);
  });

  it('each visit varies his place among the good ones, so he is not predictable', () => {
    const places = [1, 2, 3, 4, 5, 6, 7, 8].map((v) => placeDeath('watching', v, field, [], at));
    expect(new Set(places.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`)).size).toBeGreaterThanOrEqual(4);
    // and the variation never costs visibility: with windows open each visit is still a well-seen place
    for (const v of [1, 2, 3, 4, 5, 6]) expect(placeDeath('watching', v, field, cover, at).seen).toBeGreaterThanOrEqual(0.55);
  });

  it('attacking, he goes to the gate under attack; striking, he is larger and leans in; critical, larger still', () => {
    const near = placeDeath('approaching', 1, field, [], at);
    expect(Math.abs(near.x - at.gate.x)).toBeLessThan(field.w * 0.3);
    const strike = placeDeath('striking', 1, field, [], at);
    const loom = placeDeath('critical', 1, field, [], at);
    expect(strike.s).toBeGreaterThan(near.s);
    expect(strike.lean).toBeLessThan(0);
    expect(loom.s).toBeGreaterThan(strike.s);
  });

  it('when windows cover the gate, he slides to where he can still be seen', () => {
    const wall = [{ x: 600, y: 0, w: 600, h: 800 }];
    const s = placeDeath('approaching', 1, field, wall, at);
    expect(s.seen).toBeGreaterThanOrEqual(0.45);
  });
});

describe('on the real engine (D-254)', () => {
  const baseline = () => new Uint8Array(readFileSync(new URL('../../recordings/juiceshop.sqlite', import.meta.url)));

  it('he is away in the calm, appears with his first attack, and tears away when the player blocks it', () => {
    const r = runOn(new Engine({ seed: 7, difficulty: 'medium', baseline: baseline() }));
    r.engine.beginShift();
    const b = new Battle();
    let t = 0;
    b.update(r.engine.world, t);
    expect(b.presence.mode).toBe('away');
    const seen = new Set<string>();
    for (let i = 0; i < 160 && !r.engine.world.replays.some((x) => x.move === 'ATK-01' && x.owner === 'death'); i++) {
      r.engine.advance(250);
      t += 0.25;
      b.update(r.engine.world, t);
      seen.add(b.presence.mode);
    }
    expect(seen.has('returning') || seen.has('approaching')).toBe(true);
    for (let i = 0; i < 160 && r.engine.world.incident.declaredAt === undefined; i++) {
      r.engine.advance(250);
      t += 0.25;
      b.update(r.engine.world, t);
    }
    r.engine.act({ type: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'Fuzz Faster U Fool' } });
    const after = new Set<string>();
    for (let i = 0; i < 12; i++) {
      r.engine.advance(250);
      t += 0.25;
      b.update(r.engine.world, t);
      after.add(b.presence.mode);
    }
    expect(after.has('recoiling') || after.has('away')).toBe(true);
  });
});
