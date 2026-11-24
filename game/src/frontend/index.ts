// The game's screens, one folder each: screen1-title/ (UI-01, UI-02's title) and screen2-menu/ (UI-02's menu).
// shared/ holds what both draw with: the glyph atlas and the small maths.
export { TitleScreen, TAGLINE } from './screen1-title/TitleScreen';
export type { TitleScreenProps } from './screen1-title/TitleScreen';
export { MenuScreen } from './screen2-menu/MenuScreen';
export type { MenuScreenProps } from './screen2-menu/MenuScreen';
export type { MenuChoice } from './screen2-menu/menu';
export { DIFFICULTY_LABEL, SCENARIO } from './screen2-menu/menu';
