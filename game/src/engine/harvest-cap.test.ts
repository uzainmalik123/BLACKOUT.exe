// D-41 rule 5 (PRD SYS-05): no single move ends the game. One harvest move takes at most about half of the souls
// left when it starts; checked here for a harvest starting with every soul left (the worst case; KI-55 is the rest).
// It is made true by re-recording the harvests in row ranges, not by the engine; the ones that still break it are KI-54.
import { describe, expect, it } from 'vitest';
import { MOVES } from '../rules/moves';
import { SOUL_TABLES } from '../rules/vocabulary';
import { CONFIG } from './config';
import { SEED_ACCOUNTS } from './seed';
import { committedLibrary } from './test-fixtures/committed';

/** KI-54: recorded before D-41, each takes every soul. Re-recording one must move it out of this list. */
const STILL_TAKE_EVERYTHING: ReadonlySet<string> = new Set(['ATK-08.b', 'ATK-08.c', 'ATK-09.a']);

const SEED_IDS = new Set(SEED_ACCOUNTS.map((a) => a.id));
const harvests = MOVES.filter((m) => m.stage === 4 && m.gains.includes('souls'));
/** A variant Death can play on some level: a pinned move (D-31) plays only its pinned variants (ATK-08.a never does). */
const playable = (move: string, variant: string) => {
  const pins = Object.values(CONFIG).map((c) => c.pinnedVariants[move as keyof typeof c.pinnedVariants]);
  return pins.every((p) => p === undefined) || pins.some((p) => p !== undefined && (p.normal === variant || p.tippedOff === variant));
};

describe('one harvest takes at most about half the souls left (D-41, SYS-05)', () => {
  const total = SEED_ACCOUNTS.length;
  const half = Math.ceil(total / 2);
  const lib = committedLibrary();
  const variants = harvests.flatMap((m) => lib.variantsOf(m.id)).filter((v) => playable(v.move, v.variant));

  it('checks at least one committed harvest recording', () => {
    expect(variants.length).toBeGreaterThan(0);
  });

  for (const v of variants) {
    const name = `${v.move}.${v.variant}`;
    const souls = new Set<number>();
    for (const e of v.recording.events) {
      if (e.kind !== 'exfil' || !(SOUL_TABLES as readonly string[]).includes(e.table)) continue;
      for (const k of e.keys) if (SEED_IDS.has(k)) souls.add(k);
    }
    const check = STILL_TAKE_EVERYTHING.has(name) ? it.fails : it;
    check(`${name} takes at most ${half} of ${total} souls${STILL_TAKE_EVERYTHING.has(name) ? ' (fails until re-recorded: KI-54)' : ''}`, () => {
      expect(souls.size).toBeLessThanOrEqual(half);
    });
  }
});
