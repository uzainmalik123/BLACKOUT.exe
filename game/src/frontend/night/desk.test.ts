// The desk's words and the office's camera (UI-04, UI-10, D-223): pure parts of the night shift, tested without a
// browser. The wording never names a move, minion or tap (like Kiro's snapshot, D-190); a meter's change is only
// ever what the engine did; the camera's walk starts where the night starts and ends at the chair.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Engine } from '../../engine/engine';
import type { GameEvent } from '../../engine/log';
import { deltaWords, metersOf } from './Desk';
import { CAMS, lerpCam, onScreen, walkCam } from './office';
import { runOn } from './run';
import { Soundscape, heartAt } from './sound';
import { alertWords, clockAt, eventWords, shiftLeft } from './words';

const baseline = () => new Uint8Array(readFileSync(new URL('../../recordings/juiceshop.sqlite', import.meta.url)));
const IDS = /\b(ATK|MIN|TAP|DEF)-\d/;

describe('the desk words what the player could see, and nothing more (D-223)', () => {
  it('never shows an internal id, over a whole run left alone', () => {
    const { engine } = runOn(new Engine({ seed: 5, difficulty: 'hard', baseline: baseline() }));
    for (let i = 0; i < 4000 && !engine.world.ending; i++) engine.advance(500);
    const kinds = new Set<string>();
    for (const e of engine.world.events) {
      const w = eventWords(e);
      if (!w) continue;
      kinds.add(e.kind);
      expect(w.text, e.kind).not.toMatch(IDS);
    }
    expect(kinds.has('move-started')).toBe(true);
    for (const a of engine.world.alerts) expect(alertWords(a.about)).not.toMatch(IDS);
  });

  it('words alerts by kind, and actions by what the player typed', () => {
    expect(alertWords('ATK-04')).toBe('Suspicious activity');
    expect(alertWords('TAP-02')).toBe('Data leaving the shop');
    expect(alertWords('MIN-01')).toBe('Automated traffic');
    const ev = (body: object) => ({ t: 0, id: 1, ...body }) as GameEvent;
    expect(eventWords(ev({ kind: 'action', action: { type: 'DEF-06', ip: '203.0.113.9', op: 'add' }, ok: true }))).toEqual({ text: '✓ firewall add 203.0.113.9', tone: 'info' });
    expect(eventWords(ev({ kind: 'souls-stolen', by: 'ATK-08', count: 3, stolen: 9, total: 312 }))?.text).toBe('3 customer records taken (9 of 312 gone)');
    expect(eventWords(ev({ kind: 'kiro', call: 'chat' }))).toBeNull();
  });

  it('reads the clocks from the engine', () => {
    const { engine } = runOn(new Engine({ seed: 1, difficulty: 'medium', baseline: baseline() }));
    expect(clockAt(engine.world, 0)).toBe('22:00:00');
    expect(shiftLeft(engine.world)).toBe('16:00');
    engine.advance(60_000);
    expect(shiftLeft(engine.world)).toBe('15:00');
  });

  it("shows a meter's change only when the engine made one", () => {
    const { engine, ...run } = runOn(new Engine({ seed: 7, difficulty: 'medium', baseline: baseline() }));
    const r = { engine, ...run };
    engine.advance(2000);
    const before = metersOf(r);
    engine.act({ type: 'DEF-01', query: 'grep 404', shown: [], shownTotal: 0 });
    expect(deltaWords(before, metersOf(r))).toBe('');
    engine.act({ type: 'DEF-11' });
    for (let i = 0; i < 20; i++) engine.advance(500);
    expect(deltaWords(before, metersOf(r))).toMatch(/^🫀 −\d+/);
    expect(deltaWords({ souls: 312, total: 312, heartbeat: 90, max: 100 }, { souls: 300, total: 312, heartbeat: 90, max: 96 })).toBe('max 96 · 💀 −12');
  });
});

describe('the office camera (UI-10)', () => {
  it('walks from where the night starts to the chair, and sits down at the desk', () => {
    expect(walkCam(0)).toMatchObject({ x: CAMS.start.x, z: CAMS.start.z });
    expect(walkCam(1).x).toBeCloseTo(CAMS.chair.x, 6);
    expect(walkCam(1).z).toBeCloseTo(CAMS.chair.z, 6);
    expect(walkCam(0.5).z).toBeGreaterThan(CAMS.start.z);
    expect(lerpCam(CAMS.chair, CAMS.seated, 1)).toEqual(CAMS.seated);
    expect(lerpCam(CAMS.chair, CAMS.seated, 0)).toEqual(CAMS.chair);
  });

  it('projects a point straight ahead to the middle of the screen, and nothing behind the camera', () => {
    const cam = { x: 0, y: 1.6, z: 0, yaw: 0, pitch: 0 };
    const p = onScreen(cam, 1600, 900, 0, 1.6, 5)!;
    expect(p.x).toBeCloseTo(800, 6);
    expect(p.y).toBeCloseTo(450, 6);
    expect(onScreen(cam, 1600, 900, 0, 1.6, -2)).toBeNull();
    // looking right moves what is ahead to the left
    expect(onScreen({ ...cam, yaw: 0.2 }, 1600, 900, 0, 1.6, 5)!.x).toBeLessThan(800);
  });
});

describe('the heartbeat follows the business (D-224)', () => {
  it('is soft when healthy, clear in danger, fast and heavy near the end', () => {
    expect(heartAt(1)).toEqual({ bpm: 62, peak: 0.18 });
    expect(heartAt(0.5).bpm).toBeGreaterThan(75);
    expect(heartAt(0.5).peak).toBeGreaterThan(heartAt(1).peak);
    expect(heartAt(0.1).bpm).toBeGreaterThan(120);
    expect(heartAt(0).peak).toBeGreaterThan(heartAt(0.5).peak);
  });
});

describe('the soundscape stays silent where there is no audio (D-220)', () => {
  it('does nothing without Web Audio', () => {
    const s = new Soundscape();
    s.start();
    s.cue('theft');
    s.setHealth(0.1);
    expect(s.running).toBe(false);
    s.stop();
  });
});
