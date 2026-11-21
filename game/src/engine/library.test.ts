/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateRecording, type Recording } from '../recordings/format';
import { MOVES } from '../rules/moves';
import { MINION_IDS } from '../rules/vocabulary';
import { libraryFrom } from './library';
import { FIXTURE_LIBRARY, fakeRecording } from './test-fixtures/recordings';

const load = (file: string) => JSON.parse(readFileSync(new URL(`../recordings/${file}`, import.meta.url), 'utf8')) as Recording;

describe('the recording library', () => {
  it('groups the committed recordings by move: ATK-03 has variant a on 203.0.113.23, ATK-08 variant a on 203.0.113.81', () => {
    const lib = libraryFrom([load('ATK-08.a.json'), load('ATK-03.a.json')]);
    expect(lib.variantsOf('ATK-03').map((v) => [v.variant, v.info.ip, v.info.quiet])).toEqual([['a', '203.0.113.23', false]]);
    expect(lib.variantsOf('ATK-08').map((v) => [v.variant, v.info.ip, v.info.quiet])).toEqual([['a', '203.0.113.81', false]]);
    expect(lib.variantsOf('ATK-01')).toEqual([]);
  });

  it('reads quiet from the label and targets from db events (resolving ids through the seed), and sorts variants by name', () => {
    const b = fakeRecording('ATK-05', 'b', { ip: '203.0.113.2', quiet: true, events: [
      { t: 0, kind: 'db', op: 'update', table: 'Users', key: { id: 2 }, before: { password: 'x' }, after: { password: 'y' } }, // a real update carries only the changed columns
    ] });
    const a = fakeRecording('ATK-05', 'a', { ip: '203.0.113.1' });
    const lib = libraryFrom([b, a]);
    expect(lib.variantsOf('ATK-05').map((v) => v.variant)).toEqual(['a', 'b']);
    expect(lib.variantsOf('ATK-05')[1]!.info).toEqual({ ip: '203.0.113.2', quiet: true, targets: ['jim@juice-sh.op'], move: 'ATK-05', variant: 'b' });
  });

  it('refuses an invalid recording with its validation errors', () => {
    const bad = { ...fakeRecording('ATK-01', 'a', { ip: '203.0.113.1' }), attackerIp: '10.66.0.66' };
    expect(() => libraryFrom([bad as Recording])).toThrow(/attackerIp/);
  });

  it('every fixture recording passes validateRecording and every move and minion has 3 variants (ATK-08 also its four halves, D-63)', () => {
    for (const id of [...MOVES.map((m) => m.id), ...MINION_IDS]) {
      const vs = FIXTURE_LIBRARY.variantsOf(id);
      expect(vs.map((v) => v.variant), id).toEqual(id === 'ATK-08' ? ['a', 'b', 'c', 'd', 'e', 'f', 'g'] : ['a', 'b', 'c']);
      for (const v of vs) {
        expect(validateRecording(v.recording), `${id}.${v.variant}`).toEqual([]);
        expect(v.recording.move).toBe(id);
      }
      expect(vs[2]!.info.quiet).toBe(true);
      expect(new Set(vs.map((v) => v.info.ip)).size).toBe(vs.length);
    }
  });

  it('fixture moves carry the events their rows describe', () => {
    const kinds = (id: Parameters<typeof FIXTURE_LIBRARY.variantsOf>[0]) => FIXTURE_LIBRARY.variantsOf(id)[0]!.recording.events.map((e) => e.kind);
    expect(kinds('ATK-08')).toContain('exfil');
    expect(kinds('ATK-06')).toContain('db');
    expect(kinds('ATK-13')).toContain('file');
    expect(kinds('ATK-01').filter((k) => k === 'access').length).toBeGreaterThanOrEqual(60);
  });
});
