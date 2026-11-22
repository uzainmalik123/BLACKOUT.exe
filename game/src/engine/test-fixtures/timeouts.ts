// TEST-ONLY. KI-81: GitHub's runners are 2-3x slower than a laptop, so a whole-run sim that takes 2 s here can pass
// Vitest's 5 s default locally and time out in CI. Whole-run sims, exploit cheaters and property runs name this
// timeout explicitly; unit tests keep the default, so a genuinely slow unit test still fails. 120 s since the judging
// engine (D-114) and the larger library: some of these tests play 15 whole runs (5 seeds x 3 levels) and took 31-39 s
// on a runner, so 30 s turned main red (KI-81). One run is still cheap; the volume per test is what costs.
export const WHOLE_RUN_TIMEOUT_MS = 120_000;
