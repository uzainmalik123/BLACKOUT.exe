// SYS-17 (D-19): no seeded run plays a stage-N move before a stage-(N-1) move, except after a tip-off
// (one skip of one stage) or during the return (an ending in D-24, so no move follows it).
import { describe, expect, it } from 'vitest';
import { applyAction } from './actions';
import { advance } from './advance';
import { eventsOfKind } from './log';
import { initialWorld, type World } from './state';
import { lab } from './test-fixtures/lab';
import { FIXTURE_LIBRARY } from './test-fixtures/recordings';
import { WHOLE_RUN_TIMEOUT_MS } from './test-fixtures/timeouts';

const REAL_S = 1000;

function run(seed: number, player?: (w: World, t: number) => void): World {
  const w = lab(initialWorld(seed, 'medium'));
  for (let t = 0; t < 12 * 60 * REAL_S && !w.ending; t += REAL_S) {
    player?.(w, t);
    advance(w, FIXTURE_LIBRARY, REAL_S);
  }
  return w;
}

/** Each started move's stage must be ≤ the highest stage landed before it + 1, plus one per tip-off seen so far. */
function checkOrder(w: World): void {
  let highest = 0;
  let skips = 0;
  for (const e of w.events) {
    if (e.kind === 'tip-off') skips++;
    if (e.kind === 'move-landed') highest = Math.max(highest, eventsOfKind(w, 'move-started').find((s) => s.move === e.move && s.id < e.id)!.stage);
    if (e.kind === 'move-started') {
      expect(e.stage, `${e.move} at ${e.t} (seed ${w.seed})`).toBeLessThanOrEqual(highest + 1 + skips);
      if (e.stage > highest + 1) skips--;
    }
    if (e.kind === 'return') expect(w.events.slice(w.events.indexOf(e)).filter((x) => x.kind === 'move-started')).toEqual([]);
  }
}

describe('stage order (SYS-17, D-19)', () => {
  it('no seeded run plays a stage-N move before a stage-(N-1) move', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
    for (let seed = 1; seed <= 20; seed++) {
      const w = run(seed);
      expect(eventsOfKind(w, 'move-started').length, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      checkOrder(w);
    }
  });

  it('a tip-off allows exactly one skip of one stage', () => {
    const w = run(3, (world, t) => {
      if (t === 60 * REAL_S) applyAction(world, { type: 'DEF-04', ip: '203.0.113.10', mode: 'active' });
    });
    expect(eventsOfKind(w, 'tip-off')).toHaveLength(1);
    checkOrder(w);
  });
});
