import { describe, expect, it } from 'vitest';
import { pickDeathVoice, pickVoice, wordStart } from './narrator';

const v = (name: string, lang = 'en-US') => ({ name, lang });

describe("screen 3: Kiro speaks with a British woman's voice (D-185, D-221)", () => {
  it('picks a natural British female voice first (Edge)', () => {
    const voices = [v('Microsoft Zira - English (United States)'), v('Microsoft David - English (United States)'), v('Microsoft Sonia Online (Natural) - English (United Kingdom)', 'en-GB'), v('Microsoft Ryan Online (Natural) - English (United Kingdom)', 'en-GB')];
    expect(pickVoice(voices)?.name).toMatch(/Sonia/);
  });

  it('prefers Google UK English Female in Chrome, Serena or Kate on a Mac, Hazel on Windows', () => {
    expect(pickVoice([v('Google US English'), v('Google UK English Male', 'en-GB'), v('Google UK English Female', 'en-GB')])?.name).toBe('Google UK English Female');
    expect(pickVoice([v('Daniel', 'en-GB'), v('Serena', 'en-GB')])?.name).toBe('Serena');
    expect(pickVoice([v('Microsoft George - English (United Kingdom)', 'en-GB'), v('Microsoft Hazel - English (United Kingdom)', 'en-GB')])?.name).toMatch(/Hazel/);
  });

  it("without a British woman: a woman's English voice, then a British voice, then any English voice; never another language", () => {
    expect(pickVoice([v('Microsoft David - English (United States)'), v('Microsoft Zira - English (United States)')])?.name).toMatch(/Zira/);
    expect(pickVoice([v('Microsoft David - English (United States)'), v('Microsoft George - English (United Kingdom)', 'en-GB')])?.name).toMatch(/George/);
    expect(pickVoice([v('Some Voice', 'en-AU')])?.name).toBe('Some Voice');
    expect(pickVoice([v('Google français', 'fr-FR')])).toBeNull();
    expect(pickVoice([])).toBeNull();
  });

  it('picks a paused line up at the start of the word she was on', () => {
    const line = 'No crowbar. No mask.';
    expect(wordStart(line, 0)).toBe(0);
    expect(wordStart(line, 5)).toBe(3);
    expect(wordStart(line, 12)).toBe(12);
    expect(wordStart(line, 99)).toBe(15);
  });
});

describe("the night shift: Death speaks with the deepest man's voice there is (D-223)", () => {
  it('prefers a deep natural voice, then a known deep one, never a woman', () => {
    expect(pickDeathVoice([v('Microsoft Zira - English (United States)'), v('Microsoft Guy Online (Natural) - English (United States)'), v('Microsoft David - English (United States)')])?.name).toMatch(/Guy/);
    expect(pickDeathVoice([v('Google UK English Female', 'en-GB'), v('Google UK English Male', 'en-GB')])?.name).toBe('Google UK English Male');
    expect(pickDeathVoice([v('Microsoft Zira - English (United States)'), v('Microsoft David - English (United States)')])?.name).toMatch(/David/);
    expect(pickDeathVoice([v('Samantha'), v('Daniel', 'en-GB')])?.name).toBe('Daniel');
    // a name that merely contains a deep one is not it
    expect(pickDeathVoice([v('Fredericka'), v('Daniel', 'en-GB')])?.name).toBe('Daniel');
    expect(pickDeathVoice([v('Google français', 'fr-FR')])).toBeNull();
  });
});
