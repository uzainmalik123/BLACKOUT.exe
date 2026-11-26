// The post-incident report's reading (D-256): the overall grade's formula, and every line read from the engine.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluate } from '../../engine/assess';
import { Engine } from '../../engine/engine';
import { aftermathOf, letterOf, overallGrade } from './aftermath';
import { runOn } from './run';

const baseline = () => new Uint8Array(readFileSync(new URL('../../recordings/juiceshop.sqlite', import.meta.url)));

describe('the overall grade (D-256)', () => {
  it('is the mean of the four phases on a 4-point scale, as a letter', () => {
    expect(overallGrade({ detect: 'A', contain: 'A', eradicate: 'A', recover: 'A' }, 'banished')).toMatchObject({ grade: 'A', mean: 4, cap: null, result: 'Victory' });
    expect(overallGrade({ detect: 'B', contain: 'F', eradicate: 'A', recover: 'A' }, 'clean-handover')).toMatchObject({ grade: 'B', mean: 2.75 });
    expect(overallGrade({ detect: 'C', contain: 'C', eradicate: 'D', recover: 'C' }, 'clean-handover').grade).toBe('C');
    expect(overallGrade({ detect: 'F', contain: 'F', eradicate: 'D', recover: 'F' }, 'clean-handover').grade).toBe('F');
    for (const [m, g] of [
      [3.5, 'A'],
      [3.49, 'B'],
      [2.5, 'B'],
      [1.5, 'C'],
      [0.5, 'D'],
      [0.49, 'F'],
    ] as const)
      expect(letterOf(m), String(m)).toBe(g);
  });

  it('a loss caps it at D and a rough handover at C, and says why', () => {
    const good = { detect: 'A', contain: 'A', eradicate: 'B', recover: 'A' } as const;
    for (const e of ['souls-lost', 'flatline', 'return', 'walked-away'] as const) {
      const o = overallGrade(good, e);
      expect(o.grade, e).toBe('D');
      expect(o.result).toBe('Defeat');
      expect(o.why).toMatch(/Capped at D/);
    }
    expect(overallGrade(good, 'rough-handover')).toMatchObject({ grade: 'C', result: 'Shift over' });
    expect(overallGrade({ detect: 'F', contain: 'F', eradicate: 'F', recover: 'F' }, 'flatline')).toMatchObject({ grade: 'F', cap: 'D' });
    expect(overallGrade(good)).toMatchObject({ result: 'Unfinished', cap: null });
  });
});

describe("the report's reading comes from the engine (D-256)", () => {
  it('a night left to him: his grades, the mistakes with their consequences, what got through, three lessons', () => {
    const r = runOn(new Engine({ seed: 3, difficulty: 'hard', baseline: baseline() }));
    r.engine.beginShift();
    for (let i = 0; i < 6000 && !r.engine.world.ending; i++) r.engine.advance(500);
    const w = r.engine.world;
    const m = aftermathOf(w);
    const a = evaluate(w);
    expect(m.grades).toEqual(a.grades);
    expect(m.wrong.map((x) => x.title).sort()).toEqual(a.mistakes.map((x) => x.title).sort());
    expect(m.wrong.length).toBeGreaterThan(0);
    expect(m.missed.length).toBeGreaterThan(0);
    expect(m.lessons).toHaveLength(3);
    expect(m.professional.length).toBeGreaterThan(0);
    expect(m.nextTime.length).toBeGreaterThan(0);
    expect(m.damage.soulsLost).toBe(w.souls.stolen.length);
    expect(m.right.filter((l) => l.startsWith('Stopped'))).toHaveLength(0); // he was never stopped
  });

  it("the player's block of his scan is a defence that worked; nothing is credited that the log does not hold", () => {
    const r = runOn(new Engine({ seed: 7, difficulty: 'medium', baseline: baseline() }));
    r.engine.beginShift();
    for (let i = 0; i < 160 && r.engine.world.incident.declaredAt === undefined; i++) r.engine.advance(250);
    r.engine.act({ type: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'Fuzz Faster U Fool' } });
    // D-45: a fix that holds freezes his move at once and cuts it after a grace
    for (let i = 0; i < 400 && !r.engine.world.events.some((e) => e.kind === 'move-cut'); i++) r.engine.advance(250);
    const m = aftermathOf(r.engine.world);
    const cuts = r.engine.world.events.filter((e) => e.kind === 'move-cut').length;
    expect(cuts).toBeGreaterThan(0);
    expect(m.right.some((l) => l.startsWith('Stopped'))).toBe(true);
    expect(m.right.filter((l) => l.startsWith('Stopped')).length).toBeLessThanOrEqual(cuts);
    expect(m.overall.result).toBe('Unfinished');
  });
});
