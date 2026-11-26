// Death's taunts (PRD CON-04, §3.1): pre-written, never an LLM (D-11). At least three per move, plus the
// special moments. Flavour only: a line may hint at what he's doing, never at how to stop him.
import type { MoveId } from '../rules/vocabulary';

export const MOVE_TAUNTS: Readonly<Record<MoveId, readonly string[]>> = {
  'ATK-01': [
    'Knock, knock. Every door. One at a time.',
    'Let me see how your house is built.',
    'So many rooms. Which one did you forget to lock?',
  ],
  'ATK-02': [
    'You leave your papers lying in the hall.',
    'Such interesting documents. Did you mean to share them?',
    'Your secrets were never buried. Only misplaced.',
  ],
  'ATK-03': [
    'Your door asked me who I was. I told it what it wanted to hear.',
    'No key needed. Your lock trusts every word.',
    'Admin. How easily you hand me the crown.',
  ],
  'ATK-04': [
    'One word after another, until the door gives.',
    'A password older than your fear of me.',
    'Patience is a virtue. I have eternity.',
  ],
  'ATK-05': [
    'Their secret question has such an easy answer.',
    'I know their mother’s name. I know everything.',
    'A new password for them. A new face for me.',
  ],
  'ATK-06': [
    'I wrote myself into your book of masters.',
    'Your house has a new owner. He looks like me.',
    'You let anyone sign their name. So I did.',
  ],
  'ATK-07': [
    'You changed the lock. I kept the key.',
    'A token is a promise. Yours keep their promises to me.',
    'Did you think a new password would make me forget?',
  ],
  'ATK-08': [
    'Ask your search box nicely and it tells you everything.',
    'One soul at a time. Or all at once. I haven’t decided.',
    'Names, secrets, hashes. Such a generous harvest.',
  ],
  'ATK-09': [
    'Your list of the living. Mine now.',
    'You keep them all in one place. How thoughtful.',
    'Page after page of souls, and nobody asks why I’m reading.',
  ],
  'ATK-10': [
    'Whose basket is this? Whose is the next?',
    'Their orders, their homes. I’m only browsing.',
    'Every number opens another door.',
  ],
  'ATK-11': [
    'A friendly name. You’ll never notice one more.',
    'I leave a little of myself behind. Just in case.',
    'Even if you drive me out, someone will let me back in.',
  ],
  'ATK-12': [
    'This one belongs to me now. They don’t know it yet.',
    'I wear their name like a borrowed coat.',
    'A new password they will never remember setting.',
  ],
  'ATK-13': [
    'A small gift in your cellar. Don’t open it.',
    'I leave things where you never look.',
    'Something of mine now sleeps on your disk.',
  ],
  'ATK-14': [
    'I need no key. I forge my own.',
    'Your guards check the seal. Not who sealed it.',
    'A name that doesn’t exist. Doors open for it all the same.',
  ],
  'ATK-15': [
    'Let your customers read my words instead.',
    'Your shop window looks better in my handwriting.',
    'Every visitor will know I was here.',
  ],
  'ATK-16': [
    'A little poison on the shelf. Who will taste it first?',
    'Your customers come to buy. They leave with me.',
    'The page looks the same. It isn’t.',
  ],
  'ATK-17': [
    'Read me, mortal. Then pay.',
    'Your house is mine. The ransom is in the hall.',
    'This is how your night ends.',
  ],
};

export const SPECIAL_TAUNTS = {
  /** A move of his was cut short by the player. */
  blocked: [
    'Clever. It won’t save you.',
    'You closed a door. I have others.',
    'You saw me. Now watch me move.',
  ],
  /** An alert waited past its window with no decision (SYS-25, D-261). */
  tooSlow: [
    'Too slow.',
    'Tick, tock. I don’t wait.',
    'You hesitated. I didn’t.',
  ],
  /** The player tipped him off (an active lookup, locking an account he uses). */
  tippedOff: [
    'You’ve noticed me. Then I won’t take my time.',
    'Looking for me? I’m already looking at you.',
    'Bold. Let’s hurry this up.',
  ],
  /** Banished: every route closed and every foothold removed. */
  banished: [
    'Not tonight, then.',
    'You locked every door. Even the ones I hid.',
    'I’ll find another house. There are always more.',
  ],
  /** The return through a missed foothold. */
  return: [
    'Did you think I would leave without a way back?',
    'You forgot one door. I didn’t.',
    'Celebrating already? I’m home.',
  ],
} as const satisfies Record<string, readonly string[]>;
