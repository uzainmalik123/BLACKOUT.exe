// What the browser has seen (D-252): the prologue and the tutorial are remembered; blocked storage counts as never seen.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { forget, markSeen, seen } from './seen';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

afterEach(() => vi.unstubAllGlobals());

describe('what this browser has been shown (D-252)', () => {
  it('nothing is seen at first; marking remembers it; forgetting brings it back', () => {
    vi.stubGlobal('localStorage', memory());
    expect(seen('prologue')).toBe(false);
    expect(seen('tutorial')).toBe(false);
    markSeen('prologue');
    expect(seen('prologue')).toBe(true);
    expect(seen('tutorial')).toBe(false);
    markSeen('tutorial');
    forget('tutorial');
    expect(seen('tutorial')).toBe(false);
  });

  it('with no storage, or storage that throws, everything counts as never seen and nothing breaks', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(seen('prologue')).toBe(false);
    expect(() => markSeen('prologue')).not.toThrow();
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(seen('tutorial')).toBe(false);
    expect(() => markSeen('tutorial')).not.toThrow();
    expect(() => forget('tutorial')).not.toThrow();
  });
});
