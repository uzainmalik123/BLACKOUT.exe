import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeSounds, resetAudioForTests, setMasterMuted, stopAllAudio } from '../../shared/audio';
import { Narrator } from '../narrator';

/** Just enough of speech synthesis for the narrator. */
function fakeSpeech() {
  return { speak: vi.fn(), cancel: vi.fn(), resume: vi.fn(), getVoices: () => [], addEventListener: vi.fn(), speaking: false, pending: false };
}

describe('the cinematic\'s sound stops when it should (D-220, D-221)', () => {
  let speech: ReturnType<typeof fakeSpeech>;

  beforeEach(() => {
    vi.useFakeTimers();
    resetAudioForTests();
    speech = fakeSpeech();
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      constructor(readonly text: string) {}
    });
    vi.stubGlobal('window', {
      speechSynthesis: speech,
      SpeechSynthesisUtterance: globalThis.SpeechSynthesisUtterance,
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (id: number) => clearTimeout(id),
    });
  });

  afterEach(() => {
    stopAllAudio(null);
    resetAudioForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('stopping all audio (leaving the screen, closing the page) cuts Kiro off', () => {
    const n = new Narrator();
    n.say('Evidence first. Panic later.');
    stopAllAudio(speech);
    expect(speech.cancel).toHaveBeenCalled();
    // the line he was about to say never starts
    vi.advanceTimersByTime(200);
    expect(speech.speak).not.toHaveBeenCalled();
  });

  it('Kiro speaks a line, and when the video closes he is cut off and leaves the shared audio', () => {
    const n = new Narrator();
    expect(activeSounds()).toBe(1);
    n.say('One shop. One night.');
    vi.advanceTimersByTime(100);
    expect(speech.speak).toHaveBeenCalledOnce();
    n.dispose();
    expect(speech.cancel).toHaveBeenCalled();
    expect(activeSounds()).toBe(0);
  });

  it('the master mute keeps Kiro quiet until unmuted', () => {
    const n = new Narrator();
    setMasterMuted(true, speech);
    n.say('Detect. Contain.');
    vi.advanceTimersByTime(200);
    expect(speech.speak).not.toHaveBeenCalled();
    setMasterMuted(false, speech);
    n.say('Remove him. Recover.');
    vi.advanceTimersByTime(200);
    expect(speech.speak).toHaveBeenCalledOnce();
  });

  it('muting mid-line cuts him off straight away', () => {
    const n = new Narrator();
    n.say('Every visitor leaves footprints in the logs.');
    vi.advanceTimersByTime(100);
    speech.cancel.mockClear();
    setMasterMuted(true, speech);
    expect(speech.cancel).toHaveBeenCalled();
    n.dispose();
  });
});
