// Every number the engine uses, per difficulty. PRD values cite their row; the rest are D-24 (all "tune").
import type { ActionId, Difficulty, Feature, MinionId, MoveId } from '../rules/vocabulary';

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
    drainPerGameMin: { openDoor: number; minion: number; plug: number; defaced: number; recover: number }; // SYS-06
    featureWeight: Record<Feature, number>; // D-24
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
    drainPerGameMin: { openDoor: 1, minion: 0.5, plug: 4, defaced: 3, recover: 1 },
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
};

export const CONFIG: Readonly<Record<Difficulty, EngineConfig>> = {
  easy: { ...MEDIUM, pausable: true, moveGapGameMs: 60 * REAL_S, leakyWaf: false },
  medium: MEDIUM,
  hard: { ...MEDIUM, moveGapGameMs: 25 * REAL_S, pinnedVariants: { 'ATK-08': { normal: 'c', tippedOff: 'c' } } },
};
