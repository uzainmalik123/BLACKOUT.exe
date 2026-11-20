// Derived facts (SYS-04, D-24): Death's gains and footholds are read off the data they rest on, never bookkept.
// The Director (SYS-02), the replay engine (SYS-03) and banishment (SYS-07) all ask these questions.
import { MOVES, type Move } from '../rules/moves';
import { FEATURE_DEFAULTS, RETURN_GRANTS, type Foothold, type Gain, type Need, type Stopper, type WafRule } from '../rules/vocabulary';
import { CONFIG } from './config';
import type { Account, World } from './state';

/** What the engine knows about one recorded variant when it evaluates stoppers. */
export interface VariantInfo {
  ip: string;
  quiet: boolean; // D-24: the label starts with "quiet"
  targets: string[]; // emails of the Users rows the recording touches (ATK-05's victim, ATK-12's victim)
  move?: string; // the recording's move and variant, for per-variant dials (D-34)
  variant?: string;
}

const live = (a: Account) => a.lockedAt === undefined;
const RANSOM_NOTE = 'READ_ME_MORTAL.txt';

export function gains(world: World): Set<Gain> {
  const g = new Set<Gain>(world.death.knowledge);
  const v = world.signingKey.version;
  if (world.sessions.some((s) => s.kind === 'admin' && s.keyVersion === v)) g.add('admin-session');
  if (world.sessions.some((s) => s.kind === 'user' && s.keyVersion === v) || world.accounts.some(isHijacked)) g.add('user-session');
  if (world.accounts.some((a) => a.createdBy === 'ATK-06' && live(a))) g.add('own-admin');
  if (world.souls.stolen.length > 0) g.add('souls');
  if (world.defacements.some((d) => d.kind === 'deface') || world.bannerDefacedBy !== undefined) g.add('defaced');
  if (world.defacements.some((d) => d.kind === 'xss')) g.add('xss-live');
  if (world.files.some((f) => f.plantedBy === 'ATK-17' && f.path.endsWith(RANSOM_NOTE))) g.add('ransom');
  if (world.death.returnedThrough !== undefined) g.add(RETURN_GRANTS[world.death.returnedThrough]);
  return g;
}

function isHijacked(a: Account): boolean {
  return a.hijackedBy !== undefined && a.passwordResetAt === undefined;
}

export function footholds(world: World): Set<Foothold> {
  const f = new Set<Foothold>();
  if (world.accounts.some((a) => a.createdBy === 'ATK-11')) f.add('hidden-admin');
  if (world.accounts.some(isHijacked)) f.add('hijacked-user');
  if (world.files.some((x) => x.plantedBy === 'ATK-13')) f.add('planted-file');
  if (world.death.forgedToken && !world.patches.applied.includes('token-verify')) f.add('forged-token');
  return f;
}

/** The accounts Death is using: his sessions' users plus the accounts he created. */
export function usedAccountEmails(world: World): string[] {
  const emails = new Set<string>();
  for (const s of world.sessions) if (s.keyVersion === world.signingKey.version) emails.add(s.email);
  for (const a of world.accounts) if (a.createdBy !== 'seed') emails.add(a.email);
  return [...emails];
}

const loginRateLimited = (world: World) => world.waf.some((r) => r.kind === 'rate-limit' && r.path === '/rest/user/login');

export function needHolds(world: World, need: Need): boolean {
  if ('gain' in need) return gains(world).has(need.gain);
  if ('anyOf' in need) return need.anyOf.some((n) => needHolds(world, n));
  const g = gains(world);
  if ('anySession' in need) return g.has('admin-session') || g.has('user-session') || g.has('own-admin') || footholds(world).has('hidden-admin');
  if ('anyFoothold' in need) return footholds(world).size > 0;
  if ('stageGain' in need) return MOVES.some((m) => m.stage === need.stageGain && m.gains.some((x) => g.has(x)));
  if ('featureOn' in need) return world.features[need.featureOn];
  return !loginRateLimited(world);
}

export function needsHold(world: World, move: Move): boolean {
  return move.needs.every((n) => needHolds(world, n));
}

function sameRule(a: WafRule, b: WafRule): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'block-user-agent' && b.kind === 'block-user-agent') return a.pattern.toLowerCase() === b.pattern.toLowerCase();
  if (a.kind === 'block-path' && b.kind === 'block-path') return a.method === b.method && a.path === b.path;
  if (a.kind === 'rate-limit' && b.kind === 'rate-limit') return a.path === b.path;
  return true; // sqli
}

const LEAKY_KINDS: ReadonlySet<WafRule['kind']> = new Set(['sqli', 'block-user-agent']);

const account = (world: World, email: string) => world.accounts.find((a) => a.email === email);
const lockedOrGone = (world: World, email: string) => { const a = account(world, email); return a === undefined || !live(a); };
const allLocked = (world: World, emails: string[]) => emails.length > 0 && emails.every((e) => lockedOrGone(world, e));
const allReset = (world: World, emails: string[]) => emails.length > 0 && emails.every((e) => account(world, e)?.passwordResetAt !== undefined);

/** True when this stopper currently closes the move (for the given variant, when the stopper depends on it). */
export function stopperHolds(world: World, stopper: Stopper, variant?: VariantInfo): boolean {
  if ('undo' in stopper) return false; // undo stoppers close a move after it lands; they never pre-empt it
  switch (stopper.action) {
    case 'DEF-06':
      return variant !== undefined && world.firewall.blocked.includes(variant.ip);
    case 'DEF-07':
      return loginRateLimited(world);
    case 'DEF-08':
      return stopper.account === 'used' ? allLocked(world, usedAccountEmails(world)) : allLocked(world, variant?.targets ?? []);
    case 'DEF-09':
      return world.signingKey.version > 1 && !world.sessions.some((s) => s.keyVersion === world.signingKey.version);
    case 'DEF-10':
      return world.features[stopper.feature] !== FEATURE_DEFAULTS[stopper.feature];
    case 'DEF-12': {
      const present = world.waf.some((r) => sameRule(r, stopper.rule));
      const config = CONFIG[world.difficulty];
      const evasion = variant?.move !== undefined ? config.wafEvasion[variant.move as keyof typeof config.wafEvasion] : undefined;
      const leaks = evasion !== undefined
        ? (evasion[variant?.variant ?? ''] ?? []).includes(stopper.rule.kind) // a dialled move (D-34)
        : config.leakyWaf && variant?.quiet === true && LEAKY_KINDS.has(stopper.rule.kind); // D-24's generic quiet leak
      return present && !leaks;
    }
    case 'DEF-13':
      return world.patches.applied.includes(stopper.patch);
    case 'DEF-14': // the account he registered or planted is gone (only meaningful once he had one)
      return world.death.played.some((p) => p.outcome === 'landed' && (p.move === 'ATK-06' || p.move === 'ATK-11')) && !world.accounts.some((a) => a.createdBy !== 'seed');
    case 'DEF-16':
      return stopper.account === 'admin' ? account(world, 'admin@juice-sh.op')?.passwordResetAt !== undefined : allReset(world, variant?.targets ?? []);
  }
}

export function anyStopperHolds(world: World, move: Move, variant?: VariantInfo): boolean {
  return move.stoppedBy.some((s) => stopperHolds(world, s, variant));
}
