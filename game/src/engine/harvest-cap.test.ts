// PRD SYS-05, D-42 (was D-41 rule 5): every half Death can play takes at most half of the full seed (the recordings
// are halves, D-63). Later visits, from a shop with fewer souls left, are held to half of what is left by the
// engine's cap (doors.test.ts).
import { describe, expect, it } from 'vitest';
import { MOVES } from '../rules/moves';
import { SOUL_TABLES } from '../rules/vocabulary';
import { CONFIG } from './config';
import { SEED_ACCOUNTS } from './seed';
import { committedLibrary } from './test-fixtures/committed';

const SEED_IDS = new Set(SEED_ACCOUNTS.map((a) => a.id));
const harvests = MOVES.filter((m) => m.stage === 4 && m.gains.includes('souls'));
/** A variant Death can play on some level: a pinned move (D-31, D-42) plays only its pinned halves (ATK-08.a/.b/.c never do). */
const playable = (move: string, variant: string) => {
  const pins = Object.values(CONFIG).map((c) => c.pinnedVariants[move as keyof typeof c.pinnedVariants]);
  return pins.every((p) => p === undefined) || pins.some((p) => p !== undefined && (p.normal.includes(variant) || p.tippedOff.includes(variant)));
};

describe('every playable harvest half takes at most half the full seed (D-42, D-63, SYS-05)', () => {
  const total = SEED_ACCOUNTS.length;
  const half = Math.ceil(total / 2);
  const lib = committedLibrary();
  const variants = harvests.flatMap((m) => lib.variantsOf(m.id)).filter((v) => playable(v.move, v.variant));

  it('checks the halves Death plays: ATK-08.d–.g and ATK-09.b/.c, and never ATK-08.a/.b/.c', () => {
    expect(variants.map((v) => `${v.move}.${v.variant}`)).toEqual(['ATK-08.d', 'ATK-08.e', 'ATK-08.f', 'ATK-08.g', 'ATK-09.b', 'ATK-09.c']);
  });

  for (const v of variants) {
    const name = `${v.move}.${v.variant}`;
    const souls = new Set<number>();
    for (const e of v.recording.events) {
      if (e.kind !== 'exfil' || !(SOUL_TABLES as readonly string[]).includes(e.table)) continue;
      for (const k of e.keys) if (SEED_IDS.has(k)) souls.add(k);
    }
    it(`${name} takes at most ${half} of ${total} souls`, () => {
      expect(souls.size).toBeLessThanOrEqual(half);
    });
  }
});
