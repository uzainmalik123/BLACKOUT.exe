// Every number the engine uses, per difficulty. PRD values cite their row; the rest are D-24 (all "tune").
import type { ActionId, Difficulty, Feature, MinionId, MoveId, WafRule } from '../rules/vocabulary';

const REAL_S = 30_000; // one real second in game ms (SYS-01: 1 real s = 30 game s)
const GAME_MIN = 60_000;

export interface EngineConfig {
  gameMsPerRealMs: number; // SYS-01
  pausable: boolean; // SYS-01: only Easy
  tickGameMs: number; // D-24: the engine's sub-step (100 real ms)
  directorPeriodGameMs: number; // SYS-02: every 3 real s
  moveGapGameMs: number; // D-24: the wait between Death's moves
  cutRetryGameMs: number; // D-24: the wait after a cut move
  pacing: { delayAboveOpenAlerts: number; bringForwardAfterQuietGameMs: number }; // SYS-02
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
    min02SuccessesPerWave: number; // D-24
  };
  backupEveryGameMs: number; // DEF-17: hourly snapshots
  scenarioStartIso: string; // D-24
  /** SYS-08, D-31: the only variant Death may play of these moves, normally and once tipped off. Other variants stay for reference. */
  pinnedVariants: Partial<Record<MoveId, { normal: string; tippedOff: string }>>;
  /** SYS-08, D-34: the WAF rule kinds each variant of these moves slips past. A move listed here ignores D-24's generic quiet-variant leak. */
  wafEvasion: Partial<Record<MoveId, Record<string, Array<WafRule['kind']>>>>;
}

const MEDIUM: EngineConfig = {
  gameMsPerRealMs: 30,
  pausable: false,
  tickGameMs: 3_000,
  directorPeriodGameMs: 3 * REAL_S,
  moveGapGameMs: 40 * REAL_S,
  cutRetryGameMs: 10 * REAL_S,
  pacing: { delayAboveOpenAlerts: 3, bringForwardAfterQuietGameMs: 60 * REAL_S },
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
    min02SuccessesPerWave: 1,
  },
  backupEveryGameMs: 60 * GAME_MIN,
  scenarioStartIso: '2026-10-31T22:00:00Z',
  pinnedVariants: { 'ATK-08': { normal: 'b', tippedOff: 'c' } },
  wafEvasion: { 'ATK-08': { b: ['sqli', 'block-user-agent'], c: [] } }, // .b's tamper scripts leak through the SQLi rules; only .c is loud
};

export const CONFIG: Readonly<Record<Difficulty, EngineConfig>> = {
  easy: { ...MEDIUM, pausable: true, moveGapGameMs: 60 * REAL_S, leakyWaf: false, wafEvasion: { 'ATK-08': { b: ['block-user-agent'], c: [] } } },
  medium: MEDIUM,
  hard: { ...MEDIUM, moveGapGameMs: 25 * REAL_S, pinnedVariants: { 'ATK-08': { normal: 'c', tippedOff: 'c' } } },
};
