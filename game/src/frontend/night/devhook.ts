// The night shift's development-only hook (D-223): `window.__blackout`, for the headless browser checks to read the
// prologue's phase, skip to the desk and fast-forward a run to its ending. director.ts imports this
// module only behind `import.meta.env.DEV`, so the production build does not contain it.

import type { Night } from './director';
import type { Input } from './flow';

export function installHook(night: Night): () => void {
  const hook = {
    phase: () => night.phaseNow,
    skip: () => night.skip(),
    input: (i: Input) => night.input(i),
    run: () => night.currentRun,
    /** Fast-forward the run by real milliseconds; returns where it stands. */
    advance: (realMs: number) => {
      const r = night.currentRun;
      if (!r) return null;
      for (let left = realMs; left > 0 && !r.engine.world.ending; left -= 1000) r.engine.advance(Math.min(1000, left));
      const w = r.engine.world;
      return { ending: w.ending ?? null, souls: w.souls.total - w.souls.stolen.length, heartbeat: Math.round(w.heartbeat), events: w.events.length };
    },
  };
  const win = window as unknown as { __blackout?: typeof hook };
  win.__blackout = hook;
  return () => {
    if (win.__blackout === hook) delete win.__blackout;
  };
}
