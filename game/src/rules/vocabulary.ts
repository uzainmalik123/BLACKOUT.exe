// The ids and tokens every rules table and the engine share (PRD §3–§5, SYS-04, SYS-17).
// Numbers and interpretations the PRD leaves open are in docs/DECISIONS.md D-24.

export type Stage = 1 | 2 | 3 | 4 | 5 | 6;
export type Difficulty = 'easy' | 'medium' | 'hard';

export type MoveId =
  | 'ATK-01' | 'ATK-02' | 'ATK-03' | 'ATK-04' | 'ATK-05' | 'ATK-06' | 'ATK-07' | 'ATK-08' | 'ATK-09'
  | 'ATK-10' | 'ATK-11' | 'ATK-12' | 'ATK-13' | 'ATK-14' | 'ATK-15' | 'ATK-16' | 'ATK-17';
export type ActionId =
  | 'DEF-01' | 'DEF-02' | 'DEF-03' | 'DEF-04' | 'DEF-05' | 'DEF-06' | 'DEF-07' | 'DEF-08' | 'DEF-09' | 'DEF-10'
  | 'DEF-11' | 'DEF-12' | 'DEF-13' | 'DEF-14' | 'DEF-15' | 'DEF-16' | 'DEF-17' | 'DEF-18' | 'DEF-19' | 'DEF-20';
export type MinionId = 'MIN-01' | 'MIN-02' | 'MIN-03' | 'MIN-04';
/** The leaky taps (PRD §4.1, D-42): small exposures anyone can scrape. */
export type TapId = 'TAP-01' | 'TAP-02' | 'TAP-03';
/** Whoever took souls or wrote a log line: Death, a minion or a leaky tap's scrapers. */
export type Actor = MoveId | MinionId | TapId;

/** What a move gives Death (PRD §3 "Gains"). */
export type Gain =
  | 'map' | 'secrets-leaked' | 'admin-session' | 'admin-password' | 'user-session' | 'own-admin'
  | 'souls' | 'defaced' | 'xss-live' | 'ransom';
/** Something Death leaves behind that lets him return (SYS-07). */
export type Foothold = 'hidden-admin' | 'hijacked-user' | 'planted-file' | 'forged-token';
/** The feature-flags console (DEF-10). */
export type Feature = 'search' | 'registration' | 'password-reset' | 'uploads' | 'ftp' | 'feedback-captcha';
/** The holes the deploy console can patch (DEF-13). */
export type Patch =
  | 'login' | 'registration' | 'search' | 'basket-ownership' | 'change-password' | 'token-verify' | 'product-update'
  | 'users-access'; // D-30: access control on GET /api/Users (ATK-09)
/** The WAF console (DEF-12). */
export type WafRule =
  | { kind: 'sqli' }
  | { kind: 'block-user-agent'; pattern: string }
  | { kind: 'block-path'; method: string; path: string }
  | { kind: 'rate-limit'; path: string };

/** What must hold for the Director to pick a move (PRD §3 "Needs"); all entries of a move must hold. */
export type Need =
  | { gain: Gain }
  | { anyOf: Need[] }
  | { anySession: true }
  | { anyFoothold: true }
  | { stageGain: Stage }
  | { featureOn: Feature }
  | { loginNotRateLimited: true };

/** A DEF row that closes a move (PRD §3 "Stopped by"). `undo` stoppers only close a move after it lands. */
export type Stopper =
  | { action: 'DEF-06' }
  | { action: 'DEF-07' }
  | { action: 'DEF-08'; account: 'used' | 'target' }
  | { action: 'DEF-09' }
  | { action: 'DEF-10'; feature: Feature }
  | { action: 'DEF-12'; rule: WafRule }
  | { action: 'DEF-13'; patch: Patch }
  | { action: 'DEF-14'; account: 'used' }
  | { action: 'DEF-16'; account: 'admin' | 'target' }
  | { action: 'DEF-14' | 'DEF-15' | 'DEF-17' | 'DEF-20'; undo: true };

/** The feature flags at the start of a run: everything on, the feedback CAPTCHA off. */
export const FEATURE_DEFAULTS: Readonly<Record<Feature, boolean>> = {
  search: true, registration: true, 'password-reset': true, uploads: true, ftp: true, 'feedback-captcha': false,
};

/** A soul is one row of these tables (D-24, KI-15). */
export const SOUL_TABLES = ['Users'] as const;

export type Ending = 'banished' | 'souls-lost' | 'flatline' | 'return';

/** What Death comes back with through each foothold (SYS-07, D-24). */
export const RETURN_GRANTS: Readonly<Record<Foothold, Gain>> = {
  'hidden-admin': 'own-admin', 'hijacked-user': 'user-session', 'forged-token': 'admin-session', 'planted-file': 'map',
};

export const STAGES: readonly Stage[] = [1, 2, 3, 4, 5, 6];
export const GAINS: readonly Gain[] = [
  'map', 'secrets-leaked', 'admin-session', 'admin-password', 'user-session', 'own-admin', 'souls', 'defaced', 'xss-live', 'ransom',
];
export const FOOTHOLDS: readonly Foothold[] = ['hidden-admin', 'hijacked-user', 'planted-file', 'forged-token'];
export const PATCHES: readonly Patch[] = ['login', 'registration', 'search', 'basket-ownership', 'change-password', 'token-verify', 'product-update', 'users-access'];
export const FEATURES: readonly Feature[] = ['search', 'registration', 'password-reset', 'uploads', 'ftp', 'feedback-captcha'];
export const MINION_IDS: readonly MinionId[] = ['MIN-01', 'MIN-02', 'MIN-03', 'MIN-04'];
export const TAP_IDS: readonly TapId[] = ['TAP-01', 'TAP-02', 'TAP-03'];

/** One player action, as the shell, the consoles and the sims send it to the engine (PRD §5). */
export type PlayerAction =
  | { type: 'DEF-01'; query: string }
  | { type: 'DEF-02'; sql: string }
  | { type: 'DEF-03'; path: string }
  | { type: 'DEF-04'; ip: string; mode: 'passive' | 'active' }
  | { type: 'DEF-05'; name: string }
  | { type: 'DEF-06'; ip: string; op: 'add' | 'delete' }
  | { type: 'DEF-07' }
  | { type: 'DEF-08'; email: string }
  | { type: 'DEF-09' }
  | { type: 'DEF-10'; feature: Feature; enabled: boolean }
  | { type: 'DEF-11' }
  | { type: 'DEF-12'; rule: WafRule }
  | { type: 'DEF-13'; patch: Patch }
  | { type: 'DEF-14'; email: string }
  | { type: 'DEF-15'; path: string }
  | { type: 'DEF-16'; email: string }
  | { type: 'DEF-17'; backupId: number }
  | { type: 'DEF-18'; what: 'nginx' | Feature }
  | { type: 'DEF-19' }
  | { type: 'DEF-20'; to: 'legal' | 'customers' };
