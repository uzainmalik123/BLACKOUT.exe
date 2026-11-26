// The cinematic's colours, and Death's painter re-exported for the screens that drew him from here. Death is the cute
// grim reaper of the team's reference (`frontend/shared/reaper.ts`, D-253); Kiro is the Kiro logo's ghost
// (`frontend/shared/ghost.ts`, D-250). Both are painted on canvas each frame, the same on every screen.

export const CYAN = '#46e8ff';
export const AMBER = '#ffb23e';
export const CRIMSON = '#ff2a4a';
export const VIOLET = '#b44dff';
export const EMERALD = '#3ddc97';

export { drawDeath, type DeathPose } from '../../shared/reaper';
