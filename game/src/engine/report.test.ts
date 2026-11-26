// SYS-11 (D-112, D-114): the report is the judging engine's final snapshot in ENGINE_API §5's shape. The rules
// themselves are tested in assess.test.ts.
import { describe, expect, it } from 'vitest';
import { advance } from './advance';
import { emit } from './log';
import { buildReport, OFFLINE_DEBRIEF } from './report';
import { initialWorld } from './state';
import { FIXTURE_LIBRARY } from './test-fixtures/recordings';

describe('buildReport (ENGINE_API §5)', () => {
  it('returns exactly the agreed shape, with the offline debrief placeholder and a Markdown version of everything', async () => {
    const w = initialWorld(1, 'medium');
    w.clock.gameMs = 30_000;
    emit(w, { kind: 'move-started', move: 'ATK-01', variant: 'a', stage: 1, ip: '203.0.113.9' });
    w.taps.open.push({ id: 'TAP-01', openedAt: 0, nextDripAt: 0, drips: 0 });
    w.clock.gameMs = 150 * 30_000; // never noticed for 2.5 real minutes: detect F (D-260's bands)
    w.ending = 'banished';
    emit(w, { kind: 'banished' });
    emit(w, { kind: 'ending', ending: 'banished', souls: 0, heartbeat: 90 });
    const r = await buildReport(w);
    expect(Object.keys(r).sort()).toEqual(['debrief', 'facts', 'grades', 'markdown', 'missed', 'mistakes']);
    expect(r.debrief).toEqual({ text: OFFLINE_DEBRIEF, offline: true });
    for (const m of r.mistakes) expect(Object.keys(m).sort()).toEqual(['title', 'why']);
    for (const f of r.facts) expect(Object.keys(f).sort()).toEqual(['label', 'value']);
    expect(r.grades).toEqual({ detect: 'F', contain: 'D', eradicate: 'A', recover: 'B' }); // noticed never; the first fix (banishment) 149 real s after his move
    expect(r.markdown).toMatch(/^# Post-incident report: Banished\n/); // D-118: the verdict first
    for (const f of r.facts) expect(r.markdown).toContain(`**${f.label}:** ${f.value}`);
    expect(r.markdown).toContain('| Recover | B |');
    expect(r.markdown).toContain('**Still leaking at the end: open logs.**');
    expect(r.markdown).toContain('## Debrief (Kiro offline)');
    expect(r.markdown).toContain(OFFLINE_DEBRIEF);
  });

  it("is the assessor's snapshot: the same facts, grades, mistakes and missed the live state holds at the ending", async () => {
    const w = initialWorld(1, 'medium');
    advance(w, FIXTURE_LIBRARY, 20 * 60_000);
    expect(w.ending).toBeDefined();
    const r = await buildReport(w);
    expect(r.facts).toEqual(w.assess.facts);
    expect(r.grades).toEqual(w.assess.grades);
    expect(r.mistakes).toEqual(w.assess.mistakes.map(({ title, why }) => ({ title, why })));
    expect(r.missed).toEqual(w.assess.missed);
  });
});
