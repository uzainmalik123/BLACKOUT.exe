import { describe, expect, it } from 'vitest';
import { ACTIONS, DOCS, initialNav, navKey, point, press, videoClosed, type Nav, type NavKey } from './briefing';

const keys = (nav: Nav, ...ks: NavKey[]) => ks.reduce((n, k) => navKey(n, k).nav, nav);

describe('screen 3: the briefing screen (UI-03, D-183, D-184)', () => {
  it('has two buttons, Watch the briefing then Start the night shift, and the four CON-01 files behind it', () => {
    expect(ACTIONS).toEqual(['watch', 'start']);
    expect(DOCS.map((d) => d.id)).toEqual(['system-map', 'admins', 'normal-traffic', 'playbook']);
    expect(initialNav()).toEqual({ mode: 'idle', index: 0, seen: 0, right: 0 });
  });

  it('the arrows (or Tab) move between the two buttons and wrap round; nothing else moves', () => {
    expect(keys(initialNav(), 'down').index).toBe(1);
    expect(keys(initialNav(), 'right', 'right').index).toBe(0);
    expect(keys(initialNav(), 'up').index).toBe(1);
    expect(keys(initialNav(), 'tab').index).toBe(1);
  });

  it('Enter on Watch plays the briefing; while it plays the screen takes no keys', () => {
    const v = navKey(initialNav(), 'enter');
    expect(v.nav.mode).toBe('video');
    expect(navKey(v.nav, 'enter').nav).toBe(v.nav);
    expect(press(v.nav, 'start').action).toEqual({ kind: 'none' });
  });

  it('when the briefing closes, the furthest beat and the best quiz score are kept and Start is the next button', () => {
    const v = press(initialNav(), 'watch').nav;
    const after = videoClosed(v, 7, 2);
    expect(after).toEqual({ mode: 'idle', index: 1, seen: 7, right: 2 });
    const again = videoClosed(press(after, 'watch').nav, 3, 1);
    expect(again.seen).toBe(7);
    expect(again.right).toBe(2);
    expect(videoClosed(initialNav(), 5)).toEqual(initialNav());
  });

  it('Start hands over (by key or click), at once, with no clock', () => {
    const r = navKey(keys(initialNav(), 'down'), 'enter');
    expect(r.action).toEqual({ kind: 'start' });
    expect(r.nav.mode).toBe('done');
    expect(navKey(r.nav, 'escape').nav.mode).toBe('done');
    expect(press(initialNav(), 'start').action).toEqual({ kind: 'start' });
  });

  it('Escape asks first: Enter goes back to the menu, Escape stays', () => {
    const asked = keys(initialNav(), 'escape');
    expect(asked.mode).toBe('confirm');
    expect(navKey(asked, 'escape').nav.mode).toBe('idle');
    expect(navKey(asked, 'enter').action).toEqual({ kind: 'back' });
  });

  it('the pointer selects the button under it, only on the buttons', () => {
    expect(point(initialNav(), 1).index).toBe(1);
    expect(point(initialNav(), 5).index).toBe(0);
    const playing = press(initialNav(), 'watch').nav;
    expect(point(playing, 1)).toBe(playing);
  });
});
