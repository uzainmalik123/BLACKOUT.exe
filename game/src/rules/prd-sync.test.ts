/// <reference types="node" />
// SYS-17: the rules data has to say what PRD §3 says. Parses Death's moves table in docs/PRD.md and checks every ATK
// row against game/src/rules/moves.ts, so a PRD ruling that isn't mirrored in code fails `npm run health`.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACTIONS } from './actions';
import { MOVES, MOVE_BY_ID } from './moves';
import { FOOTHOLDS, GAINS, type MoveId, type Need } from './vocabulary';

interface PrdMove { id: MoveId; stage: number; needs: string; gains: string; stoppedBy: string; pri: string }

const PRD = readFileSync(new URL('../../../docs/PRD.md', import.meta.url), 'utf8');

/** The rows of §3's table: `| ATK-.. |` lines between the "## 3." heading and the next "## " heading. */
export function prdMoves(prd: string): PrdMove[] {
  const start = prd.indexOf("## 3. Death's moves");
  const end = prd.indexOf('\n## ', start + 1);
  const section = prd.slice(start, end);
  return section.split('\n').filter((l) => l.startsWith('| ATK-')).map((line) => {
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
    if (cells.length !== 10) throw new Error(`PRD §3 row has ${cells.length} cells, expected 10: ${line.slice(0, 40)}`);
    const [id, stage, , , , , needs, gains, stoppedBy, pri] = cells as [MoveId, string, string, string, string, string, string, string, string, string];
    return { id, stage: Number(stage.match(/^\d/)?.[0]), needs, gains, stoppedBy, pri };
  });
}

/** The DEF ids that close a move: the "Stopped by" cell without its notes (brackets) and after its first sentence. */
export function stopperIds(cell: string): string[] {
  let text = cell;
  while (/\([^()]*\)/.test(text)) text = text.replace(/\([^()]*\)/g, '');
  text = text.split(/\.\s/)[0]!;
  return [...new Set(text.match(/DEF-\d\d/g) ?? [])].sort();
}

const VOCAB = new Set<string>([...GAINS, ...FOOTHOLDS]);
/** Gain and foothold names a PRD cell mentions as `code` or **bold**. */
function vocabIn(cell: string): string[] {
  const tokens = [...cell.matchAll(/`([^`]+)`|\*\*([^*]+)\*\*/g)].map((m) => (m[1] ?? m[2])!);
  return [...new Set(tokens.filter((t) => VOCAB.has(t)))].sort();
}

function gainsNamed(needs: Need[]): string[] {
  const out = new Set<string>();
  const walk = (n: Need) => {
    if ('gain' in n) out.add(n.gain);
    if ('anyOf' in n) n.anyOf.forEach(walk);
  };
  needs.forEach(walk);
  return [...out].sort();
}

describe('rules/moves.ts matches PRD §3 (SYS-17)', () => {
  const rows = prdMoves(PRD);

  it('the PRD table has the same 17 moves, in order', () => {
    expect(rows.map((r) => r.id)).toEqual(MOVES.map((m) => m.id));
  });

  it("the summary lines of §3 and §5 count the rows' priorities (closes KI-16)", () => {
    const [, moveMust, moveShould] = PRD.match(/\*\*Must = (\d+) moves, should = (\d+)\.\*\*/)!;
    expect([Number(moveMust), Number(moveShould)]).toEqual([MOVES.filter((m) => m.pri === 'M').length, MOVES.filter((m) => m.pri === 'S').length]);
    const [, actionMust, actionShould] = PRD.match(/\*\*Must = (\d+), should = (\d+)\.\*\* Difficulty only/)!;
    expect([Number(actionMust), Number(actionShould)]).toEqual([ACTIONS.filter((a) => a.pri === 'M').length, ACTIONS.filter((a) => a.pri === 'S').length]);
  });

  it('the stopper parser reads notes and sentences the way the PRD writes them', () => {
    expect(stopperIds('DEF-12 (scanner rule). DEF-06 only interrupts it')).toEqual(['DEF-12']);
    expect(stopperIds('DEF-14 (removes it once planted; DEF-02 to find it), DEF-10 (a (nested) note)')).toEqual(['DEF-10', 'DEF-14']);
    expect(stopperIds('DEF-08 / DEF-14 (on the account he uses), DEF-09')).toEqual(['DEF-08', 'DEF-09', 'DEF-14']);
  });

  for (const row of prdMoves(PRD)) {
    it(`${row.id}: same stage, priority, stoppers, gains and the gains its Needs name`, () => {
      const move = MOVE_BY_ID[row.id];
      expect(move.stage, 'stage').toBe(row.stage);
      expect(move.pri, 'priority').toBe(row.pri);
      expect([...new Set(move.stoppedBy.map((s) => s.action))].sort(), 'Stopped by').toEqual(stopperIds(row.stoppedBy));
      expect([...move.gains, ...(move.foothold ? [move.foothold] : [])].sort(), 'Gains').toEqual(vocabIn(row.gains));
      expect(gainsNamed(move.needs), 'Needs').toEqual(vocabIn(row.needs));
    });
  }
});
