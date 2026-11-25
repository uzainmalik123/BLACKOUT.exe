// The game's screens, one folder each: screen1-title/ (UI-01, UI-02's title), screen2-menu/ (UI-02's menu) and
// screen3-briefing/ (UI-03), night/ (screens 4 and 5: the night shift, UI-04..UI-10). shared/ holds what they draw with: the glyph atlas, the grid painter, the small maths.
export { TitleScreen, TAGLINE } from './screen1-title/TitleScreen';
export type { TitleScreenProps } from './screen1-title/TitleScreen';
export { MenuScreen } from './screen2-menu/MenuScreen';
export type { MenuScreenProps } from './screen2-menu/MenuScreen';
export type { MenuChoice } from './screen2-menu/menu';
export { DIFFICULTY_LABEL, SCENARIO } from './screen2-menu/menu';
export { BriefingScreen } from './screen3-briefing/BriefingScreen';
export type { BriefingScreenProps } from './screen3-briefing/BriefingScreen';
export { BriefingFiles } from './screen3-briefing/DocPanel';
export { DOCS, type BriefingResult } from './screen3-briefing/briefing';
export { installAudioLifecycle, isMasterMuted, setMasterMuted, stopAllAudio } from './shared/audio';
export { NightShift } from './night/NightShift';
export type { NightShiftProps } from './night/NightShift';
