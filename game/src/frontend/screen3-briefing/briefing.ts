// Screen 3, the briefing (UI-03, D-182, D-183, D-184), as pure state free of the DOM so it can be tested: the screen's two
// big buttons (Watch the briefing, Start the night shift), the briefing video playing over it, and the "leave?"
// question. There is no countdown (D-183). The files themselves are CON-01's (`content/briefing/`).

import { BRIEFING, type BriefingFile } from '../../content/briefing';

export const DOCS: readonly BriefingFile[] = BRIEFING;
export type DocId = BriefingFile['id'];

/** The screen's buttons, in order. */
export const ACTIONS = ['watch', 'start'] as const;
export type Action = (typeof ACTIONS)[number];

/** idle: on the buttons · video: the briefing playing · confirm: "leave?" · done: handed over */
export type Mode = 'idle' | 'video' | 'confirm' | 'done';

export interface Nav {
  mode: Mode;
  /** The selected button. */
  index: number;
  /** Beats of the briefing seen so far (the furthest reached), across every viewing. */
  seen: number;
  /** The best quiz score across every viewing. */
  right: number;
}

export type NavKey = 'up' | 'down' | 'left' | 'right' | 'enter' | 'escape' | 'tab';

export type NavAction = { kind: 'none' } | { kind: 'start' } | { kind: 'back' };

export interface NavStep {
  nav: Nav;
  action: NavAction;
}

export const initialNav = (): Nav => ({ mode: 'idle', index: 0, seen: 0, right: 0 });

const NONE: NavAction = { kind: 'none' };

/** Press a button (Enter on it, or a click). */
export function press(nav: Nav, action: Action): NavStep {
  if (nav.mode === 'done' || nav.mode === 'video') return { nav, action: NONE };
  const index = ACTIONS.indexOf(action);
  if (action === 'watch') return { nav: { ...nav, mode: 'video', index }, action: NONE };
  return { nav: { ...nav, mode: 'done', index }, action: { kind: 'start' } };
}

/** The video closed (skipped or finished), having reached `beats` beats with `right` quiz answers right. */
export function videoClosed(nav: Nav, beats: number, right = 0): Nav {
  if (nav.mode !== 'video') return nav;
  // after watching, the next thing to do is start
  return { ...nav, mode: 'idle', seen: Math.max(nav.seen, beats), right: Math.max(nav.right, right), index: beats > 0 ? ACTIONS.indexOf('start') : nav.index };
}

/** The pointer over a button: select it. */
export function point(nav: Nav, i: number): Nav {
  if (nav.mode !== 'idle' || i < 0 || i >= ACTIONS.length) return nav;
  return { ...nav, index: i };
}

/** What a key does on the screen itself (the video handles its own keys while it plays). */
export function navKey(nav: Nav, key: NavKey): NavStep {
  switch (nav.mode) {
    case 'idle':
      if (key === 'up' || key === 'down' || key === 'left' || key === 'right' || key === 'tab') {
        const by = key === 'up' || key === 'left' ? -1 : 1;
        return { nav: { ...nav, index: (nav.index + by + ACTIONS.length) % ACTIONS.length }, action: NONE };
      }
      if (key === 'enter') return press(nav, ACTIONS[nav.index]!);
      if (key === 'escape') return { nav: { ...nav, mode: 'confirm' }, action: NONE };
      return { nav, action: NONE };
    case 'confirm':
      if (key === 'enter') return { nav: { ...nav, mode: 'done' }, action: { kind: 'back' } };
      if (key === 'escape') return { nav: { ...nav, mode: 'idle' }, action: NONE };
      return { nav, action: NONE };
    case 'video':
    case 'done':
      return { nav, action: NONE };
  }
}

/** What the briefing hands to the next screen. */
export interface BriefingResult {
  /** Beats of the briefing seen, out of `of`. */
  seen: number;
  of: number;
  /** Quiz answers right (the best viewing), out of `quizzes`. */
  right: number;
  quizzes: number;
}
