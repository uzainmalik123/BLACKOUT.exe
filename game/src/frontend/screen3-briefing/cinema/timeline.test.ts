import { describe, expect, it } from 'vitest';
import { LINE_DELAY, SHOTS, TOTAL, advance, lineSeconds, mmss, paceFor, replay, seekTo, shotIndex, shotProgress, skipToEnd, spokenLength, startPlayback, togglePlay } from './timeline';

describe('screen 3: the cinematic runs 60 seconds, no more (D-189)', () => {
  it('is eight shots in order, back to back, from 0 to 60 seconds', () => {
    expect(TOTAL).toBe(60);
    expect(SHOTS.map((s) => s.id)).toEqual(['street', 'kiro', 'map', 'gate', 'logs', 'admin', 'death', 'blackout']);
    expect(SHOTS[0]!.t0).toBe(0);
    expect(SHOTS[SHOTS.length - 1]!.t1).toBe(TOTAL);
    for (let i = 1; i < SHOTS.length; i++) expect(SHOTS[i]!.t0).toBe(SHOTS[i - 1]!.t1);
  });

  it('keeps the brief\'s timings', () => {
    expect(SHOTS.map((s) => [s.t0, s.t1])).toEqual([
      [0, 7],
      [7, 15],
      [15, 25],
      [25, 35],
      [35, 43],
      [43, 50],
      [50, 56],
      [56, 60],
    ]);
  });

  it('every line fits its shot at Kiro\'s pace, with room to breathe', () => {
    for (const s of SHOTS) {
      expect(LINE_DELAY + lineSeconds(s.line), s.id).toBeLessThan(s.t1 - s.t0 - 0.3);
      expect(s.line, s.id).not.toMatch(/undefined|NaN|null/);
    }
  });

  it('says the brief\'s lines and captions', () => {
    const by = (id: string) => SHOTS.find((s) => s.id === id)!;
    expect(by('street').caption).toBe('ONE SHOP. ONE NIGHT. ONE DEFENDER.');
    expect(by('kiro').line).toContain("I don't haunt the shop. I keep it alive.");
    expect(by('map').caption).toBe('SEVEN DOORS. SIX CAN CLOSE. ONE NEVER DOES.');
    expect(by('map').line).toBe('Seven public doors. Six can close. Login stays open. Behind them: 312 customers and every order they trusted us with.');
    expect(by('gate').caption).toBe('NO GUARDS AT THE GATE. JUST YOU.');
    expect(by('logs').caption).toBe('NOT EVERY REQUEST IS A CUSTOMER.');
    expect(by('admin').line).toContain('Preserve the evidence before deleting anything');
    expect(by('death').line).toContain('he only needs one mistake');
    expect(by('blackout').line).toBe('Evidence first. Panic later. Your shift starts now.');
  });

  it("paces Kiro so each line ends inside its shot, whatever the voice's speed, within limits", () => {
    expect(spokenLength('312 customers')).toBe('312 customers'.length + 15);
    // a quick voice keeps the floor rate; a slow one is sped up to fit; never past the ceiling
    expect(paceFor('a'.repeat(60), 10, 15)).toBe(1.05);
    expect(paceFor('a'.repeat(130), 8, 12)).toBeCloseTo(130 / (8 * 12), 6);
    expect(paceFor('a'.repeat(400), 4, 10)).toBe(1.7);
    for (const s of SHOTS) {
      const rate = paceFor(s.line, s.t1 - s.t0 - LINE_DELAY - 0.3, 12);
      expect(spokenLength(s.line) / (12 * rate), s.id).toBeLessThanOrEqual(s.t1 - s.t0 - LINE_DELAY - 0.29);
    }
  });

  it('finds the shot at a moment, and how far into it', () => {
    expect(shotIndex(0)).toBe(0);
    expect(shotIndex(7)).toBe(1);
    expect(shotIndex(59.9)).toBe(7);
    expect(shotIndex(60)).toBe(7);
    expect(shotProgress(2, 20)).toBeCloseTo(0.5, 6);
  });
});

describe('screen 3: the cinematic plays, pauses, skips and replays', () => {
  it('plays to the end card and stops there, never past 60 seconds', () => {
    let p = startPlayback();
    p = advance(p, 20);
    expect(p).toMatchObject({ t: 20, playing: true, ended: false, seen: 3 });
    p = advance(p, 100);
    expect(p).toMatchObject({ t: 60, playing: false, ended: true, seen: 8 });
    expect(advance(p, 5)).toBe(p);
  });

  it('a paused film stands still; play again goes on', () => {
    const paused = togglePlay(advance(startPlayback(), 3));
    expect(paused.playing).toBe(false);
    expect(advance(paused, 10)).toBe(paused);
    expect(togglePlay(paused).playing).toBe(true);
  });

  it('skip goes straight to the end card; replay starts over and keeps how far it got', () => {
    const s = skipToEnd(advance(startPlayback(), 12));
    expect(s).toMatchObject({ t: 60, ended: true, playing: false, seen: 2 });
    expect(replay(s)).toMatchObject({ t: 0, ended: false, playing: true, seen: 2 });
    expect(togglePlay(s)).toMatchObject({ t: 0, playing: true });
  });

  it('seeking jumps to a moment, and to the end card at the end', () => {
    expect(seekTo(startPlayback(), 36)).toMatchObject({ t: 36, playing: true, ended: false, seen: 5 });
    expect(seekTo(startPlayback(), -4).t).toBe(0);
    expect(seekTo(startPlayback(), 99)).toMatchObject({ ended: true, t: 60 });
    expect(mmss(60)).toBe('1:00');
  });
});
