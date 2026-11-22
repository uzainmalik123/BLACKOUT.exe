// Every number the engine uses, per difficulty. PRD values cite their row; the rest are D-24 (all "tune").
import type { ActionId, Difficulty, MinionId, MoveId, RequestClass, WafRule } from '../rules/vocabulary';

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
    dip: Partial<Record<ActionId, number>>; // D-24: one-off costs
  };
  customers: {
    share: number; // SYS-19, D-65: the share of REC-06's shoppers each loop plays (Easy ≈ 1, Medium ≈ 2, Hard ≈ 4 access lines per real s)
    cost: Record<RequestClass, number>; // D-65: heartbeat taken at once for each customer request the player's actions fail, by what the customer was doing
    giveUpAfter: number; // D-65: a shopper who fails this many times in one loop gives up (churn); a `page` failure (an asset, the product list, reviews) annoys but doesn't count
    churn: number; // D-65: how much the heartbeat's maximum drops, for good, per shopper who gives up
    recoverAfterGameMs: number; // D-65: SYS-06's recovery waits this long after the last failed customer request
    rateLimit: { windowMs: number; burst: number }; // D-65: a rate-limited path answers 429 to an address past `burst` hits within `windowMs` recorded ms
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
    takeAllBelowFraction: number; // D-44: once fewer than this share of the total souls are left, one visit takes the rest
    pauseGraceGameMs: number; // D-45: a Death move stopped by anything but an IP block freezes in place this long before it is cut
  };
  proxies: {
    afterIpCuts: number; // D-46 (KI-78): after this many IP-block cuts in a row he switches to rotating proxies for the rest of the run
    pool: number; // D-46: addresses in one proxy pool; his lines rotate through them and only blocking all of them cuts him
  };
  stuckBreathers: number; // D-46 (KI-80): with nothing he can play for this many of the level's longest breathers, banishment counts only what he can reach
  taps: {
    everyGameMs: { min: number; max: number }; // D-42: the seeded wait before the next leaky tap opens (the first one too)
    maxOpen: number; // D-42: at most this many taps open at once
    dripEveryGameMs: number; // D-42: an open tap drips once per real minute
    dripFraction: number; // D-42: each drip takes this share of the total souls (rounded, at least 1)
  };
  notification: { windowGameMs: number }; // SYS-14 (D-112): the breach-notification window after confirmation, GDPR's 72 h compressed to the run length
  struggle: { idleGameMs: number; soulsWindowGameMs: number; soulsFraction: number; unlocks: boolean }; // SYS-13 (D-113): struggling = no useful action for idleGameMs, or souls down by soulsFraction within soulsWindowGameMs; unlocks a suggestion on Medium/Hard only
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
    dip: { 'DEF-07': 2, 'DEF-09': 10, 'DEF-13': 3, 'DEF-14': 10, 'DEF-16': 1 },
  },
  // D-65: a flag, a rate limit, a WAF rule or an IP block costs what it costs the customers (replaces D-46's interim feature weights).
  // Tuned on Medium, seed 1: everything off flatlines the shop in about 10 real minutes, search off alone in about 15.
  customers: {
    share: 0.4,
    cost: { page: 0.1, search: 1.5, login: 1, signup: 10, basket: 1.5, checkout: 4, feedback: 0.5, complaint: 3, 'password-reset': 2, ftp: 0.5 },
    giveUpAfter: 2,
    churn: 1,
    recoverAfterGameMs: 60 * REAL_S,
    rateLimit: { windowMs: 15_000, burst: 2 },
  },
  minions: {
    periodGameMs: { 'MIN-01': 120 * REAL_S, 'MIN-02': 180 * REAL_S, 'MIN-03': 240 * REAL_S, 'MIN-04': 300 * REAL_S },
    firstWaveGameMs: { 'MIN-01': 30 * REAL_S, 'MIN-02': 60 * REAL_S, 'MIN-03': 90 * REAL_S, 'MIN-04': 120 * REAL_S },
    waveDurationGameMs: 20 * REAL_S,
    successesPerWave: 1,
    soulCapFraction: 0.05,
    alongsideDeath: true,
  },
  doors: { visitCapFraction: 0.5, takeAllBelowFraction: 0.1, pauseGraceGameMs: 10 * REAL_S },
  proxies: { afterIpCuts: 3, pool: 24 },
  stuckBreathers: 2,
  taps: { everyGameMs: { min: 180 * REAL_S, max: 240 * REAL_S }, maxOpen: 2, dripEveryGameMs: 60 * REAL_S, dripFraction: 0.01 },
  notification: { windowGameMs: 6 * 60 * GAME_MIN }, // D-112: a run is about 6 game hours (PRD §1), so the 72 h clock runs 12× game time
  struggle: { idleGameMs: 90 * REAL_S, soulsWindowGameMs: 120 * REAL_S, soulsFraction: 0.1, unlocks: true }, // SYS-13
  backupEveryGameMs: 60 * GAME_MIN,
  scenarioStartIso: '2026-10-31T22:00:00Z',
  pinnedVariants: { 'ATK-08': { normal: ['d', 'e'], tippedOff: ['f', 'g'] } }, // D-42: the halves (D-63); .b/.c retired, .a test-only
  // .d/.e's tamper scripts leak through the SQLi rules; only .f/.g are loud. ATK-01.b's browser agent slips past the ffuf rule (D-46).
  wafEvasion: { 'ATK-01': { a: [], b: ['block-user-agent'] }, 'ATK-08': { d: QUIET_LEAKS, e: QUIET_LEAKS, f: [], g: [] } },
};

export const CONFIG: Readonly<Record<Difficulty, EngineConfig>> = {
  easy: {
    ...MEDIUM, pausable: true, breatherGameMs: { min: 45 * REAL_S, max: 60 * REAL_S }, leakyWaf: false,
    minions: { ...MEDIUM.minions, alongsideDeath: false }, customers: { ...MEDIUM.customers, share: 0.2 }, wafEvasion: { 'ATK-01': { a: [], b: ['block-user-agent'] }, 'ATK-08': { d: EASY_LEAKS, e: EASY_LEAKS, f: [], g: [] } },
    taps: { ...MEDIUM.taps, everyGameMs: { min: 240 * REAL_S, max: 300 * REAL_S } },
    struggle: { ...MEDIUM.struggle, unlocks: false }, // SYS-13: on Easy Kiro helps anyway (KIRO-03); nothing to unlock
  },
  medium: MEDIUM,
  hard: {
    ...MEDIUM, breatherGameMs: { min: 20 * REAL_S, max: 35 * REAL_S }, minions: { ...MEDIUM.minions, successesPerWave: 2 }, customers: { ...MEDIUM.customers, share: 0.8 },
    pinnedVariants: { 'ATK-08': { normal: ['f', 'g'], tippedOff: ['f', 'g'] } },
    taps: { ...MEDIUM.taps, everyGameMs: { min: 120 * REAL_S, max: 180 * REAL_S } },
  },
};
