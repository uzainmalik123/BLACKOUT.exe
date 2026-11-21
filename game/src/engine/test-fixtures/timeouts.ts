// TEST-ONLY. KI-81: GitHub's runners are 2-3x slower than a laptop, so a whole-run sim that takes 2 s here can pass
// Vitest's 5 s default locally and time out in CI. Whole-run sims, exploit cheaters and property runs name this
// timeout explicitly; unit tests keep the default, so a genuinely slow unit test still fails.
export const WHOLE_RUN_TIMEOUT_MS = 30_000;
