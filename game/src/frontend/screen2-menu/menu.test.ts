import { describe, expect, it } from 'vitest';
import { DIFFICULTY_LINE, MENU_ITEMS, activate, initialMenu, pick, select, step, whisperFor, type MenuState } from './menu';

describe('screen 2 menu (UI-02, D-181)', () => {
  it('has the four items in order and starts on Start Game at Medium', () => {
    expect(MENU_ITEMS).toEqual(['start', 'scenario', 'difficulty', 'exit']);
    expect(initialMenu()).toEqual({ item: 'start', difficulty: 'medium' });
  });

  it('Up and Down move through the items and wrap round', () => {
    let s: MenuState = initialMenu();
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      s = step(s, 'down').state;
      seen.push(s.item);
    }
    expect(seen).toEqual(['scenario', 'difficulty', 'exit', 'start']);
    expect(step(initialMenu(), 'up').state.item).toBe('exit');
    expect(step(initialMenu(), 'down').changed).toBe('item');
  });

  it('Left and Right change the difficulty from anywhere, select its row, and stop at either end', () => {
    const r = step(initialMenu(), 'right');
    expect(r.state).toEqual({ item: 'difficulty', difficulty: 'hard' });
    expect(r.changed).toBe('difficulty');
    const end = step(r.state, 'right');
    expect(end.state.difficulty).toBe('hard');
    expect(end.changed).toBeNull();
    expect(step(step(r.state, 'left').state, 'left').state.difficulty).toBe('easy');
    expect(step({ item: 'start', difficulty: 'easy' }, 'left')).toMatchObject({ state: { item: 'difficulty', difficulty: 'easy' }, changed: 'item' });
  });

  it('Enter starts with the chosen scenario and difficulty, cycles the difficulty row, and Exit goes back', () => {
    expect(step({ item: 'start', difficulty: 'hard' }, 'enter').action).toEqual({ kind: 'start', choice: { scenario: 'juice-shop', difficulty: 'hard' } });
    expect(step({ item: 'difficulty', difficulty: 'hard' }, 'enter').state.difficulty).toBe('easy');
    expect(step({ item: 'scenario', difficulty: 'easy' }, 'enter').action).toEqual({ kind: 'scenario' });
    expect(activate({ item: 'exit', difficulty: 'easy' }).action).toEqual({ kind: 'back' });
  });

  it('Escape goes back from any item', () => {
    for (const item of MENU_ITEMS) expect(step({ item, difficulty: 'medium' }, 'escape').action).toEqual({ kind: 'back' });
  });

  it('the pointer selects by hover and picks a level by click; repeating either changes nothing', () => {
    expect(select(initialMenu(), 'exit')?.state.item).toBe('exit');
    expect(select(initialMenu(), 'start')).toBeNull();
    expect(pick(initialMenu(), 'easy')?.state).toEqual({ item: 'difficulty', difficulty: 'easy' });
    expect(pick({ item: 'difficulty', difficulty: 'easy' }, 'easy')).toBeNull();
  });

  it('the whisper under the menu gives each difficulty its one line', () => {
    for (const d of ['easy', 'medium', 'hard'] as const) expect(whisperFor({ item: 'difficulty', difficulty: d })).toBe(DIFFICULTY_LINE[d]);
    for (const item of MENU_ITEMS) expect(whisperFor({ item, difficulty: 'medium' }).length).toBeGreaterThan(10);
  });
});
