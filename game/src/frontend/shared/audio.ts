// Every sound the game makes goes through here (D-220), so none can outlive the page or play twice: Kiro's voice
// (speech synthesis, the only sound since D-221) registers itself, as any future sound must; `stopAllAudio` silences all of
// them and cancels any speech still queued in the browser (speech lives in the browser, not the page, and some
// browsers keep talking after a tab is closed or reloaded); `installAudioLifecycle` calls it when the page is hidden
// for good or unloads; and the master mute silences everything at once and keeps new sounds silent.

export interface Sound {
  /** Stop for good: cut off speech, close audio graphs. */
  stop(): void;
  /** Follow the master mute. */
  setMuted(muted: boolean): void;
}

/** The part of `speechSynthesis` this needs. */
export interface SpeechLike {
  cancel(): void;
}

const sounds = new Set<Sound>();
const listeners = new Set<(muted: boolean) => void>();
let muted = false;

function browserSpeech(): SpeechLike | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
}

/** Add a sound; it takes the master mute at once. Returns the way to remove it. */
export function registerSound(s: Sound): () => void {
  sounds.add(s);
  s.setMuted(muted);
  return () => {
    sounds.delete(s);
  };
}

/** How many sounds are registered (for tests and checks). */
export const activeSounds = (): number => sounds.size;

/** Silence everything now: every registered sound stops, and any speech the browser has queued is cancelled. */
export function stopAllAudio(speech: SpeechLike | null = browserSpeech()): void {
  for (const s of [...sounds]) {
    try {
      s.stop();
    } catch {
      // one broken sound must not keep the others playing
    }
  }
  try {
    speech?.cancel();
  } catch {
    // nothing to cancel
  }
}

export const isMasterMuted = (): boolean => muted;

/** The master mute: every sound follows it, and muting also cancels speech already queued. */
export function setMasterMuted(m: boolean, speech: SpeechLike | null = browserSpeech()): void {
  if (m === muted) return;
  muted = m;
  for (const s of [...sounds]) s.setMuted(m);
  if (m) {
    try {
      speech?.cancel();
    } catch {
      // nothing to cancel
    }
  }
  for (const fn of [...listeners]) fn(m);
}

/** Be told when the master mute changes. Returns the way to stop listening. */
export function onMasterMute(fn: (muted: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

interface Target {
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
}

const installed = new WeakMap<object, () => void>();

/**
 * Stop all sound when the page goes away: `pagehide` (closing, reloading, navigating, or the page going into the
 * back-forward cache) and `beforeunload`. Safe to call more than once. Returns the way to uninstall.
 */
export function installAudioLifecycle(target: Target | null = typeof window !== 'undefined' ? window : null, speech?: SpeechLike | null): () => void {
  if (!target) return () => undefined;
  const existing = installed.get(target);
  if (existing) return existing;
  const stop = () => stopAllAudio(speech === undefined ? browserSpeech() : speech);
  target.addEventListener('pagehide', stop);
  target.addEventListener('beforeunload', stop);
  const uninstall = () => {
    target.removeEventListener('pagehide', stop);
    target.removeEventListener('beforeunload', stop);
    installed.delete(target);
  };
  installed.set(target, uninstall);
  return uninstall;
}

/** For tests: forget every sound and listener and unmute. */
export function resetAudioForTests(): void {
  sounds.clear();
  listeners.clear();
  muted = false;
}
