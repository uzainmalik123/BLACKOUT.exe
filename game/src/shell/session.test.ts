import { describe, expect, it } from 'vitest';
import type { Engine } from '../engine/engine';
import { createSession, historyEntries, recordLine } from './session';

const engine = {} as Engine;

describe('session', () => {
  it('starts in /srv/juice-shop with empty state', () => {
    const s = createSession(engine);
    expect(s).toEqual({ cwd: '/srv/juice-shop', history: [], runCount: 0, overlay: new Map() });
  });

  it('ignores whitespace-only lines and keeps lines unmodified', () => {
    const s = createSession(engine);
    recordLine(s, '   ');
    recordLine(s, '');
    recordLine(s, '  ls  -la ');
    expect(s.history).toEqual(['  ls  -la ']);
    expect(s.runCount).toBe(1);
  });

  it('keeps the last 500 lines and continues numbering past the cap', () => {
    const s = createSession(engine);
    for (let i = 1; i <= 503; i++) recordLine(s, `echo ${i}`);
    expect(s.history).toHaveLength(500);
    const entries = historyEntries(s);
    expect(entries[0]).toEqual({ n: 4, line: 'echo 4' });
    expect(entries[499]).toEqual({ n: 503, line: 'echo 503' });
  });

  it('never shares state between two sessions', () => {
    const a = createSession(engine);
    const b = createSession(engine);
    recordLine(a, 'pwd');
    a.cwd = '/tmp';
    a.overlay.set('/tmp/x', { kind: 'dir' });
    expect(b.history).toEqual([]);
    expect(b.runCount).toBe(0);
    expect(b.cwd).toBe('/srv/juice-shop');
    expect(b.overlay.size).toBe(0);
  });
});
