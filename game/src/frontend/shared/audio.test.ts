import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeSounds, installAudioLifecycle, isMasterMuted, onMasterMute, registerSound, resetAudioForTests, setMasterMuted, stopAllAudio, type Sound } from './audio';

const sound = () => {
  const s = { stop: vi.fn(), setMuted: vi.fn() } satisfies Sound;
  return s;
};

/** A stand-in for `window`: records listeners and fires them. */
function fakeTarget() {
  const on = new Map<string, Set<() => void>>();
  return {
    addEventListener: (type: string, fn: () => void) => {
      if (!on.has(type)) on.set(type, new Set());
      on.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => on.get(type)?.delete(fn),
    fire: (type: string) => on.get(type)?.forEach((fn) => fn()),
    count: (type: string) => on.get(type)?.size ?? 0,
  };
}

describe('shared audio: every sound stops when it should (D-220)', () => {
  beforeEach(() => resetAudioForTests());
  afterEach(() => resetAudioForTests());

  it('stopAllAudio stops every registered sound and cancels the speech the browser has queued', () => {
    const a = sound();
    const b = sound();
    registerSound(a);
    registerSound(b);
    const speech = { cancel: vi.fn() };
    stopAllAudio(speech);
    expect(a.stop).toHaveBeenCalledOnce();
    expect(b.stop).toHaveBeenCalledOnce();
    expect(speech.cancel).toHaveBeenCalledOnce();
  });

  it('a sound that throws while stopping does not keep the others playing', () => {
    const bad = { stop: () => { throw new Error('broken'); }, setMuted: vi.fn() };
    const good = sound();
    registerSound(bad);
    registerSound(good);
    expect(() => stopAllAudio({ cancel: vi.fn() })).not.toThrow();
    expect(good.stop).toHaveBeenCalledOnce();
  });

  it('closing, reloading or leaving the page stops all sound, and installing twice adds one handler, not two', () => {
    const win = fakeTarget();
    const speech = { cancel: vi.fn() };
    const s = sound();
    registerSound(s);
    const uninstall = installAudioLifecycle(win, speech);
    expect(installAudioLifecycle(win, speech)).toBe(uninstall);
    expect(win.count('pagehide')).toBe(1);
    expect(win.count('beforeunload')).toBe(1);
    win.fire('pagehide');
    expect(s.stop).toHaveBeenCalledOnce();
    expect(speech.cancel).toHaveBeenCalledOnce();
    win.fire('beforeunload');
    expect(speech.cancel).toHaveBeenCalledTimes(2);
    uninstall();
    expect(win.count('pagehide')).toBe(0);
  });

  it('the master mute silences every sound, cancels queued speech, keeps new sounds silent, and tells listeners', () => {
    const a = sound();
    registerSound(a);
    const heard: boolean[] = [];
    const stopListening = onMasterMute((m) => heard.push(m));
    const speech = { cancel: vi.fn() };
    setMasterMuted(true, speech);
    expect(isMasterMuted()).toBe(true);
    expect(a.setMuted).toHaveBeenLastCalledWith(true);
    expect(speech.cancel).toHaveBeenCalledOnce();
    const later = sound();
    registerSound(later);
    expect(later.setMuted).toHaveBeenCalledWith(true);
    setMasterMuted(false, speech);
    expect(a.setMuted).toHaveBeenLastCalledWith(false);
    expect(heard).toEqual([true, false]);
    stopListening();
    setMasterMuted(true, speech);
    expect(heard).toEqual([true, false]);
  });

  it('a sound removed from the registry is no longer stopped or counted', () => {
    const s = sound();
    const remove = registerSound(s);
    expect(activeSounds()).toBe(1);
    remove();
    expect(activeSounds()).toBe(0);
    stopAllAudio({ cancel: vi.fn() });
    expect(s.stop).not.toHaveBeenCalled();
  });
});
