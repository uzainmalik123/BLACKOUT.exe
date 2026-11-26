// The difficulty dial (SYS-08, UI-02, UI-11, D-234, D-241): one table the screens and the menu read, its timings from
// the engine's config, so the menu can only promise what a level does.
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../engine/config';
import { DIAL, SAME_AT_EVERY_LEVEL, dialLines } from './dial';

describe('the dial on screen (D-234)', () => {
  it('Easy needs no typing, Medium adds the terminal, Hard is terminal first', () => {
    expect(DIAL.easy).toMatchObject({ investigate: true, rowActions: true, autocomplete: true, kiroApply: true, terminalAtStart: false, gateSentence: true });
    expect(DIAL.medium).toMatchObject({ investigate: true, rowActions: true, autocomplete: false, kiroApply: false, terminalAtStart: true, gateSentence: false });
    expect(DIAL.hard).toMatchObject({ investigate: false, rowActions: false, autocomplete: false, kiroApply: false, terminalAtStart: true, gateSentence: false });
  });
});

describe("the difficulty pick's lists (UI-02)", () => {
  it('are generated from the engine config: the calm, the breather, the shift, the pause', () => {
    // D-252 (approved 2026-11-26): the calm kept, shortened from 25–30, 20–30 and 15–25 s
    expect(dialLines('easy')).toContain('The calm before the first sign of trouble: 8–10 s');
    expect(dialLines('medium')).toContain('The calm before the first sign of trouble: 6–9 s');
    expect(dialLines('hard')).toContain('The calm before the first sign of trouble: 5–8 s');
    // D-260 (approved 2026-11-26): the 3-minute night, his rests shortened again (25–35, 15–25, 10–18 s after D-258),
    // and a second move may start while one plays on every level (D-259)
    expect(dialLines('easy')).toContain('Death rests 15–20 s between moves, and runs up to two at once');
    expect(dialLines('medium')).toContain('Death rests 8–12 s between moves, and runs up to two at once');
    expect(dialLines('hard')).toContain('Death rests 5–8 s between moves, and runs up to two at once');
    expect(dialLines('easy')).toContain('The shift lasts about 4 minutes'); // D-260: was 20
    expect(dialLines('medium')).toContain('The shift lasts about 3 minutes'); // D-260: was 11 (D-259), 16 before
    expect(dialLines('hard')).toContain('The shift lasts about 2.5 minutes'); // D-260: was 9 (D-259), 13 before
    for (const d of ['easy', 'medium', 'hard'] as const) expect(dialLines(d)).toContain(CONFIG[d].pausable ? 'You can pause' : 'No pausing');
  });

  it('follow a change in the config, never a hand-typed number', () => {
    const was = CONFIG.medium.firstMoveDelayRealMs;
    (CONFIG.medium as { firstMoveDelayRealMs: { min: number; max: number } }).firstMoveDelayRealMs = { min: 7000, max: 9000 };
    try {
      expect(dialLines('medium')).toContain('The calm before the first sign of trouble: 7–9 s');
    } finally {
      (CONFIG.medium as { firstMoveDelayRealMs: { min: number; max: number } }).firstMoveDelayRealMs = was;
    }
  });

  it('say what each level switches on, and one line what none changes', () => {
    expect(dialLines('easy')[0]).toBe('No typing needed: every investigation is a click');
    expect(dialLines('medium')[0]).toBe('Buttons for every investigation, and the terminal');
    expect(dialLines('hard')[0]).toBe('Terminal first: buttons only on the consoles');
    expect(dialLines('easy')).toContain('Alerts say which gate is under attack');
    expect(dialLines('hard')).not.toContain('Alerts say which gate is under attack');
    expect(SAME_AT_EVERY_LEVEL).toMatch(/attacks.*consequences.*verdict/);
  });
});
