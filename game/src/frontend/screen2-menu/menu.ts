// Screen 2's menu (UI-02, D-181, D-188) as pure state, free of the DOM so it can be tested: which item is selected,
// which difficulty is chosen, and what a key does. The screen and the scene only render what this decides.

import type { Difficulty } from '../../rules/vocabulary';

/** Start Game, the difficulty pick, Exit (D-188: the one scenario needs no row). */
export const MENU_ITEMS = ['start', 'difficulty', 'exit'] as const;
export type MenuItem = (typeof MENU_ITEMS)[number];

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];

/** The one scenario there is (SCENES §2); Start Game hands it on with the difficulty. */
export const SCENARIO = { id: 'juice-shop', name: 'Juice Shop Breach' } as const;
export type ScenarioId = (typeof SCENARIO)['id'];

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** One line each, as SCENES §2 words them. */
export const DIFFICULTY_LINE: Record<Difficulty, string> = {
  easy: 'Never seen a server log. Kiro explains everything.',
  medium: "You know your way around. Kiro hints when you're stuck.",
  hard: 'A real shift. Raw logs, Kiro stays quiet.',
};

/** The whisper under the menu for the selected item; the difficulty row shows its level's line. */
export function whisperFor(state: MenuState): string {
  switch (state.item) {
    case 'start':
      return 'The night shift begins the moment you do.';
    case 'difficulty':
      return DIFFICULTY_LINE[state.difficulty];
    case 'exit':
      return 'Leave her in the dark.';
  }
}

export interface MenuState {
  item: MenuItem;
  difficulty: Difficulty;
}

export interface MenuChoice {
  scenario: ScenarioId;
  difficulty: Difficulty;
}

export type MenuKey = 'up' | 'down' | 'left' | 'right' | 'enter' | 'escape';

export type MenuAction =
  | { kind: 'none' }
  /** Start Game: hand the choice on. */
  | { kind: 'start'; choice: MenuChoice }
  /** Exit or Escape: back to the title screen (a browser tab cannot close itself). */
  | { kind: 'back' };

export interface MenuStep {
  state: MenuState;
  action: MenuAction;
  /** What changed, for the scene to react to (she answers every move). */
  changed: 'item' | 'difficulty' | null;
}

export const initialMenu = (difficulty: Difficulty = 'medium'): MenuState => ({ item: 'start', difficulty });

const NONE: MenuAction = { kind: 'none' };

function moveItem(item: MenuItem, by: number): MenuItem {
  const i = MENU_ITEMS.indexOf(item);
  const n = MENU_ITEMS.length;
  return MENU_ITEMS[(((i + by) % n) + n) % n]!;
}

/** Left and Right step through the levels and stop at either end; Enter on the row cycles round. */
function shiftDifficulty(d: Difficulty, by: number, wrap: boolean): Difficulty {
  const i = DIFFICULTIES.indexOf(d);
  const n = DIFFICULTIES.length;
  const j = wrap ? (((i + by) % n) + n) % n : Math.min(n - 1, Math.max(0, i + by));
  return DIFFICULTIES[j]!;
}

/** The selected item does its thing (Enter, or a click on it). */
export function activate(state: MenuState): MenuStep {
  switch (state.item) {
    case 'start':
      return { state, action: { kind: 'start', choice: { scenario: SCENARIO.id, difficulty: state.difficulty } }, changed: null };
    case 'difficulty': {
      const difficulty = shiftDifficulty(state.difficulty, 1, true);
      return { state: { ...state, difficulty }, action: NONE, changed: 'difficulty' };
    }
    case 'exit':
      return { state, action: { kind: 'back' }, changed: null };
  }
}

/** What one key does. Up and Down wrap round the items; Left and Right change the difficulty from anywhere. */
export function step(state: MenuState, key: MenuKey): MenuStep {
  switch (key) {
    case 'up':
    case 'down':
      return { state: { ...state, item: moveItem(state.item, key === 'up' ? -1 : 1) }, action: NONE, changed: 'item' };
    case 'left':
    case 'right': {
      const difficulty = shiftDifficulty(state.difficulty, key === 'left' ? -1 : 1, false);
      const item: MenuItem = 'difficulty';
      if (difficulty === state.difficulty && item === state.item) return { state, action: NONE, changed: null };
      return { state: { item, difficulty }, action: NONE, changed: difficulty !== state.difficulty ? 'difficulty' : 'item' };
    }
    case 'enter':
      return activate(state);
    case 'escape':
      return { state, action: { kind: 'back' }, changed: null };
  }
}

/** The pointer: hovering an item selects it; returns null when nothing changes. */
export function select(state: MenuState, item: MenuItem): MenuStep | null {
  return item === state.item ? null : { state: { ...state, item }, action: NONE, changed: 'item' };
}

/** A click on one level of the difficulty row. */
export function pick(state: MenuState, difficulty: Difficulty): MenuStep | null {
  if (difficulty === state.difficulty && state.item === 'difficulty') return null;
  return { state: { item: 'difficulty', difficulty }, action: NONE, changed: difficulty !== state.difficulty ? 'difficulty' : 'item' };
}
