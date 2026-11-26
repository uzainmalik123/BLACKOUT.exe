// The WAF as a bandage (SYS-23, D-231). A DEF-12 rule or the DEF-07 rate limit stops the move it matches now: the
// Director still attempts a move an untried rule would stop, the replay freezes and cuts it, and the cut records a
// bandage. After the level's bandage breathers that rule no longer holds against the move's quiet variants (the
// tamper scripts, the browser agent): the rule has been evaded, for good, for that move. A second, different rule
// earns one more breather. A move with no quiet recording stays stopped (ATK-03, ATK-04 until their .b land, KI-231).
import { MOVE_BY_ID } from '../rules/moves';
import type { MoveId, Stopper, WafRule } from '../rules/vocabulary';
import { CONFIG } from './config';
import type { RecordingLibrary } from './library';
import { emit } from './log';
import type { World } from './state';

export const LOGIN_RATE_LIMIT: WafRule = { kind: 'rate-limit', path: '/rest/user/login' };

/** Same rule, as the WAF console and facts.ts compare them. */
export function sameRule(a: WafRule, b: WafRule): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'block-user-agent' && b.kind === 'block-user-agent') return a.pattern.toLowerCase() === b.pattern.toLowerCase();
  if (a.kind === 'block-path' && b.kind === 'block-path') return a.method === b.method && a.path === b.path;
  if (a.kind === 'rate-limit' && b.kind === 'rate-limit') return a.path === b.path;
  return true; // sqli
}

/** The WAF rule a stopper stands for: DEF-12's own, DEF-07 the login rate limit. */
export function ruleOf(stopper: Stopper): WafRule | undefined {
  if (stopper.action === 'DEF-12') return stopper.rule;
  if (stopper.action === 'DEF-07') return LOGIN_RATE_LIMIT;
  return undefined;
}

/** Has this rule been tried against this move (an attempt it cut)? Until then the Director attempts the move. */
export function tried(world: World, move: MoveId, rule: WafRule): boolean {
  return world.bandages.some((b) => b.move === move && sameRule(b.rule, rule));
}

/** Has this move's quiet way past the rule arrived (the bandage's breathers are over)? */
export function evaded(world: World, move: MoveId, rule: WafRule): boolean {
  return world.bandages.some((b) => b.move === move && sameRule(b.rule, rule) && world.clock.gameMs >= b.evadesAt);
}

/** Any rule evaded for this move: on Hard that unlocks its quiet variants beside the pinned loud ones (D-231). */
export function anyEvaded(world: World, move: MoveId): boolean {
  return world.bandages.some((b) => b.move === move && world.clock.gameMs >= b.evadesAt);
}

/** A rule cut one of his moves: the bandage is on; it fails after the level's breathers (Easy two, else one). */
export function bandage(world: World, move: MoveId, rule: WafRule): void {
  if (tried(world, move, rule)) return;
  const { bandage: cfg, breatherGameMs } = CONFIG[world.difficulty];
  const now = world.clock.gameMs;
  world.bandages.push({ move, rule, at: now, evadesAt: now + cfg.breathers * breatherGameMs.max });
}

/** One tick: log `rule-evaded` for every bandage whose time has come, if the move has a quiet recording to use. */
export function stepBandages(world: World, library: RecordingLibrary): void {
  const now = world.clock.gameMs;
  for (const b of world.bandages) {
    if (b.announced || now < b.evadesAt) continue;
    b.announced = true;
    if (!library.variantsOf(b.move).some((v) => v.info.quiet)) continue; // no quiet way: the rule keeps holding (KI-231)
    if (!MOVE_BY_ID[b.move]) continue;
    emit(world, { kind: 'rule-evaded', move: b.move, rule: b.rule });
  }
}
