// Every number the engine uses, per difficulty. PRD values cite their row; the rest are D-24 (all "tune").
import type { ActionId, Difficulty, Feature, MinionId, MoveId, WafRule } from '../rules/vocabulary';

const REAL_S = 30_000; // one real second in game ms (SYS-01: 1 real s = 30 game s)
const GAME_MIN = 60_000;
const QUIET_LEAKS: Array<WafRule['kind']> = ['sqli', 'block-user-agent']; // D-34 on Medium/Hard: the quiet harvest's tamper scripts and random agent
const EASY_LEAKS: Array<WafRule['kind']> = ['block-user-agent']; // D-34 on Easy: the SQLi rule set stops it

export interface EngineConfig {
  gameMsPerRealMs: number; // SYS-01
  pausable: boolean; // SYS-01: only Easy
  tickGameMs: number; // D-24: the engine's sub-step (100 real ms)
  directorPeriodGameMs: number; // SYS-02: every 3 real s
  breatherGameMs: { min: number; max: number }; // D-41: the seeded wait after each of Death's moves, landed or cut (replaces D-24's gaps)
  ipResumeGameMs: number; // D-24, D-41: the wait before an IP-blocked move carries on from a fresh address
  pacing: { delayAtOpenAlerts: number; bringForwardAfterQuietGameMs: number }; // SYS-02; D-43: the delay fires at this many open alerts
  returnDelayGameMs: number; // SYS-07: 2 real min
  patchDurationGameMs: number; // DEF-13: ≈ 20 game min
  leakyWaf: boolean; // DEF-12: quiet variants get through on Medium/Hard
  heartbeat: {
    drainPerRealMin: { openDoor: number; minion: number; plug: number; defaced: number; recover: number }; // SYS-06, per REAL minute (D-33)
    featureWeight: Record<Feature, number>; // D-24's weights, per real minute (D-33)
    dip: Partial<Record<ActionId, number>>; // D-24: one-off costs
  };
  minions: {
    periodGameMs: Record<MinionId, number>; // PRD §4 "Waves (Medium)"
    firstWaveGameMs: Record<MinionId, number>; // D-24
    waveDurationGameMs: number; // D-24
    successesPerWave: number; // D-41: a wave lands at most this many successes (a recorded exfil each)
    soulCapFraction: number; // D-41: minions take at most this share of the souls over a run (rounded down)
    alongsideDeath: boolean; // D-41: a wave and a Death move may run at once (the combo); never on Easy
  };
  doors: {
    visitCapFraction: number; // D-42: a visit to a big soul door stops once it has taken this share of the souls left when it started (rounded up)
  };
  taps: {
    everyGameMs: { min: number; max: number }; // D-42: the seeded wait before the next leaky tap opens (the first one too)
    maxOpen: number; // D-42: at most this many taps open at once
    dripEveryGameMs: number; // D-42: an open tap drips once per real minute
    dripFraction: number; // D-42: each drip takes this share of the total souls (rounded, at least 1)
  };
  backupEveryGameMs: number; // DEF-17: hourly snapshots
  scenarioStartIso: string; // D-24
  /** SYS-08, D-31, D-42: the only variants Death may play of these moves, normally and once tipped off. Other variants stay for reference. */
  pinnedVariants: Partial<Record<MoveId, { normal: string[]; tippedOff: string[] }>>;
  /** SYS-08, D-34: the WAF rule kinds each variant of these moves slips past. A move listed here ignores D-24's generic quiet-variant leak. */
  wafEvasion: Partial<Record<MoveId, Record<string, Array<WafRule['kind']>>>>;
}

const MEDIUM: EngineConfig = {
  gameMsPerRealMs: 30,
  pausable: false,
  tickGameMs: 3_000,
  directorPeriodGameMs: 3 * REAL_S,
  breatherGameMs: { min: 30 * REAL_S, max: 45 * REAL_S },
  ipResumeGameMs: 10 * REAL_S,
  pacing: { delayAtOpenAlerts: 2, bringForwardAfterQuietGameMs: 60 * REAL_S },
  returnDelayGameMs: 120 * REAL_S,
  patchDurationGameMs: 20 * GAME_MIN,
  leakyWaf: true,
  heartbeat: {
    drainPerRealMin: { openDoor: 3, minion: 1.5, plug: 33, defaced: 20, recover: 2 },
    featureWeight: { search: 0.3, registration: 0.1, 'password-reset': 0.05, uploads: 0.05, ftp: 0.02, 'feedback-captcha': 0.02 },
    dip: { 'DEF-07': 2, 'DEF-09': 10, 'DEF-13': 3, 'DEF-14': 10, 'DEF-16': 1 },
  },
  minions: {
    periodGameMs: { 'MIN-01': 120 * REAL_S, 'MIN-02': 180 * REAL_S, 'MIN-03': 240 * REAL_S, 'MIN-04': 300 * REAL_S },
    firstWaveGameMs: { 'MIN-01': 30 * REAL_S, 'MIN-02': 60 * REAL_S, 'MIN-03': 90 * REAL_S, 'MIN-04': 120 * REAL_S },
    waveDurationGameMs: 20 * REAL_S,
    successesPerWave: 1,
    soulCapFraction: 0.05,
    alongsideDeath: true,
  },
  doors: { visitCapFraction: 0.5 },
  taps: { everyGameMs: { min: 180 * REAL_S, max: 240 * REAL_S }, maxOpen: 2, dripEveryGameMs: 60 * REAL_S, dripFraction: 0.01 },
  backupEveryGameMs: 60 * GAME_MIN,
  scenarioStartIso: '2026-10-31T22:00:00Z',
  pinnedVariants: { 'ATK-08': { normal: ['d', 'e'], tippedOff: ['f', 'g'] } }, // D-42: the halves (D-63); .b/.c retired, .a test-only
  wafEvasion: { 'ATK-08': { d: QUIET_LEAKS, e: QUIET_LEAKS, f: [], g: [] } }, // .d/.e's tamper scripts leak through the SQLi rules; only .f/.g are loud
};

export const CONFIG: Readonly<Record<Difficulty, EngineConfig>> = {
  easy: {
    ...MEDIUM, pausable: true, breatherGameMs: { min: 45 * REAL_S, max: 60 * REAL_S }, leakyWaf: false,
    minions: { ...MEDIUM.minions, alongsideDeath: false }, wafEvasion: { 'ATK-08': { d: EASY_LEAKS, e: EASY_LEAKS, f: [], g: [] } },
    taps: { ...MEDIUM.taps, everyGameMs: { min: 240 * REAL_S, max: 300 * REAL_S } },
  },
  medium: MEDIUM,
  hard: {
    ...MEDIUM, breatherGameMs: { min: 20 * REAL_S, max: 35 * REAL_S }, minions: { ...MEDIUM.minions, successesPerWave: 2 },
    pinnedVariants: { 'ATK-08': { normal: ['f', 'g'], tippedOff: ['f', 'g'] } },
    taps: { ...MEDIUM.taps, everyGameMs: { min: 120 * REAL_S, max: 180 * REAL_S } },
  },
};
