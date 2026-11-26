// The player's actions (PRD §5): every DEF row's effect on the world. Pure, in place, never throws:
// an action on something that isn't there answers ok:false and leaves the world as it was.
import { ACTION_BY_ID } from '../rules/actions';
import { FEATURE_DEFAULTS, SHOWN_LINES_MAX, type ActionId, type Patch, type PlayerAction, type WafRule } from '../rules/vocabulary';
import { CONFIG } from './config';
import { dip } from './heartbeat';
import { summariseShown } from './assess';
import { emit } from './log';
import { answerAlerts } from './decisions';
import { confirmBreach } from './notification';
import { deathAddresses } from './pool';
import { changeFrozen, declareIncident } from './shift';
import type { Backup, World } from './state';

export type { PlayerAction } from '../rules/vocabulary';

export interface ActionResult {
  ok: boolean;
  message: string;
}

const ok = (message: string): ActionResult => ({ ok: true, message });
const no = (message: string): ActionResult => ({ ok: false, message });
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** SYS-22 (D-230): what a change action answers while no incident is declared. The shell prints it as it is. */
export const FREEZE_MESSAGE = 'No incident declared. Change control forbids production changes outside an incident.';
/** The actions the freeze refuses: every change (DEF-05..DEF-20) but the escalation, which declares the incident itself. */
const FROZEN: ReadonlySet<ActionId> = new Set<ActionId>(['DEF-05', 'DEF-06', 'DEF-07', 'DEF-08', 'DEF-09', 'DEF-10', 'DEF-11', 'DEF-12', 'DEF-13', 'DEF-14', 'DEF-15', 'DEF-16', 'DEF-17', 'DEF-18', 'DEF-20']);

function sameRule(a: WafRule, b: WafRule): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function tipOff(world: World, by: ActionId): void {
  emit(world, { kind: 'tip-off', by });
  world.death.stageSkips += 1;
  world.death.nextMoveAt = world.clock.gameMs;
  world.death.skipWait = true;
  world.death.tippedOff = true;
}

function costOf(world: World, id: ActionId): void {
  dip(world, CONFIG[world.difficulty].heartbeat.dip[id] ?? 0);
}

function run(world: World, action: PlayerAction): ActionResult {
  const now = world.clock.gameMs;
  const account = (email: string) => world.accounts.find((a) => a.email === email);
  switch (action.type) {
    case 'DEF-01':
    case 'DEF-02':
    case 'DEF-03':
      return ok(ACTION_BY_ID[action.type].name);
    case 'DEF-04':
      // D-111 (KI-90): only an active lookup of an address Death or his proxies use or have used tips him off; the
      // answer reads the same either way, so the shell never becomes an oracle for which addresses are his.
      if (action.mode === 'active' && deathAddresses(world).has(action.ip)) tipOff(world, 'DEF-04');
      return ok(action.mode === 'active' ? `Active lookup of ${action.ip}` : `whois ${action.ip}`);
    case 'DEF-05': {
      if (world.evidence.some((e) => e.name === action.name)) return no(`Evidence ${action.name} already exists`);
      world.evidence.push({ name: action.name, takenAt: now, accessLines: world.logs.access.length, appLines: world.logs.app.length });
      return ok(`Evidence ${action.name} preserved`); // D-116: a snapshot never confirms the breach
    }
    case 'DEF-06': {
      if (!IPV4.test(action.ip)) return no(`${action.ip} is not an IPv4 address`);
      const blocked = world.firewall.blocked.includes(action.ip);
      if (action.op === 'add') {
        if (blocked) return no(`${action.ip} is already blocked`);
        world.firewall.blocked.push(action.ip);
        return ok(`Dropping ${action.ip}`);
      }
      if (!blocked) return no(`${action.ip} is not blocked`);
      world.firewall.blocked = world.firewall.blocked.filter((ip) => ip !== action.ip);
      return ok(`${action.ip} unblocked`);
    }
    case 'DEF-07': {
      const rule: WafRule = { kind: 'rate-limit', path: '/rest/user/login' };
      if (world.waf.some((r) => sameRule(r, rule))) return no('The login is already rate-limited');
      world.waf.push(rule);
      costOf(world, 'DEF-07');
      return ok('Login rate-limited');
    }
    case 'DEF-08': {
      const a = account(action.email);
      if (!a) return no(`No account ${action.email}`);
      if (a.lockedAt !== undefined) return no(`${action.email} is already locked`);
      a.lockedAt = now;
      tipOff(world, 'DEF-08');
      return ok(`${action.email} locked`);
    }
    case 'DEF-09':
      world.signingKey = { version: world.signingKey.version + 1, rotatedAt: now };
      world.sessions = [];
      costOf(world, 'DEF-09');
      return ok('Every session revoked; signing key rotated');
    case 'DEF-10':
      if (world.features[action.feature] === action.enabled) return no(`${action.feature} is already ${action.enabled ? 'on' : 'off'}`);
      world.features[action.feature] = action.enabled;
      return ok(`${action.feature} ${action.enabled ? 'on' : 'off'}`);
    case 'DEF-11':
      if (world.nginx === 'stopped') return no('nginx is already stopped');
      world.nginx = 'stopped';
      return ok('nginx stopped');
    case 'DEF-12':
      if (world.waf.some((r) => sameRule(r, action.rule))) return no('That WAF rule already exists');
      world.waf.push(action.rule);
      return ok(`WAF rule added: ${action.rule.kind}`);
    case 'DEF-13': {
      if (world.patches.applied.includes(action.patch)) return no(`${action.patch} is already patched`);
      if (world.patches.pending.some((p) => p.patch === action.patch)) return no(`${action.patch} is already deploying`);
      world.patches.pending.push({ patch: action.patch, readyAt: now + CONFIG[world.difficulty].patchDurationGameMs });
      return ok(`Deploying the ${action.patch} patch`);
    }
    case 'DEF-14': {
      const a = account(action.email);
      if (!a) return no(`No account ${action.email}`);
      world.accounts = world.accounts.filter((x) => x !== a);
      world.sessions = world.sessions.filter((s) => s.email !== a.email);
      if (a.createdBy === 'seed') {
        costOf(world, 'DEF-14');
        return ok(`${action.email} deleted: that was a real account`);
      }
      return ok(`${action.email} deleted`);
    }
    case 'DEF-15': {
      const f = world.files.find((x) => x.path === action.path);
      if (!f) return no(`No such file: ${action.path}`);
      world.files = world.files.filter((x) => x !== f);
      return ok(`${action.path} removed`);
    }
    case 'DEF-16': {
      const a = account(action.email);
      if (!a) return no(`No account ${action.email}`);
      a.passwordResetAt = now;
      if (a.email === 'admin@juice-sh.op') world.death.knowledge = world.death.knowledge.filter((k) => k !== 'admin-password');
      costOf(world, 'DEF-16');
      return ok(`${action.email} must reset their password`);
    }
    case 'DEF-17': {
      const b = world.backups.find((x) => x.id === action.backupId);
      if (!b) return no(`No backup ${action.backupId}`);
      restore(world, b);
      return ok(`Restored backup ${b.id}`);
    }
    case 'DEF-18':
      if (action.what === 'nginx') {
        if (world.nginx === 'running') return no('nginx is already running');
        world.nginx = 'running';
        return ok('nginx started');
      }
      if (world.features[action.what] === FEATURE_DEFAULTS[action.what]) return no(`${action.what} is already back`);
      world.features[action.what] = FEATURE_DEFAULTS[action.what];
      return ok(`${action.what} back to normal`);
    case 'DEF-19':
      if (world.comms.escalatedAt !== undefined) return no('The incident lead already knows');
      world.comms.escalatedAt = now;
      declareIncident(world, 'escalation'); // SYS-22, D-230: an escalation declares the incident and lifts the freeze
      confirmBreach(world, 'DEF-19'); // SYS-14, D-116: escalating confirms the breach once souls are gone
      return ok('The incident lead acknowledges');
    case 'DEF-20':
      if (world.comms.notifiedAt[action.to] !== undefined) return no(`${action.to} already notified`);
      world.comms.notifiedAt[action.to] = now;
      return ok(`${action.to} notified`);
    case 'DEF-21': {
      // D-233: a suspicion, confirmed by the next hostile request from that address (flags.ts); never judged here
      if (!IPV4.test(action.ip)) return no(`${action.ip} is not an IPv4 address`);
      if (world.flags.some((f) => f.ip === action.ip)) return no(`${action.ip} is already flagged`);
      const cfg = CONFIG[world.difficulty];
      const last = world.flags.at(-1);
      const readyAt = last === undefined ? now : last.at + cfg.flag.cooldownRealMs * cfg.gameMsPerRealMs; // D-239: one flag per cooldown
      if (now < readyAt) {
        const waitS = Math.ceil((readyAt - now) / cfg.gameMsPerRealMs / 1000);
        return no(`Too soon: one flag every ${cfg.flag.cooldownRealMs / 1000} s. Next flag in ${waitS} s`);
      }
      const note = action.note?.trim();
      world.flags.push({ ip: action.ip, at: now, ...(note && { note }) });
      return ok(`${action.ip} flagged: a suspicion until it acts again`);
    }
  }
}

function restore(world: World, b: Backup): void {
  world.accounts = structuredClone(b.accounts);
  world.files = structuredClone(b.files);
  world.defacements = structuredClone(b.defacements);
  world.sessions = world.sessions.filter((s) => world.accounts.some((a) => a.email === s.email));
}

/** Applies one player action and logs it (SYS-10). After an ending every action is refused. */
export function applyAction(world: World, action: PlayerAction): ActionResult {
  const result = world.ending ? no(`The incident is over: ${world.ending}`) : changeFrozen(world) && FROZEN.has(action.type) ? no(FREEZE_MESSAGE) : run(world, action);
  if ('shown' in action && action.shown !== undefined) {
    // D-115, D-122: at most 200 lines are judged, and the log keeps only what the judge needs of them, never the text
    const { shown, ...rest } = action;
    action = { ...rest, shownTotal: action.shownTotal ?? shown.length, ...summariseShown(world, shown.slice(0, SHOWN_LINES_MAX)) };
  }
  emit(world, { kind: 'action', action, ok: result.ok, note: result.message });
  if (result.ok) answerAlerts(world, action.type); // SYS-25 (D-261): a decision inside an alert's window
  return result;
}

/** DEF-13 deploys land when their time is up: the hole closes, the restart dips the heartbeat. */
export function applyPendingPatches(world: World): Patch[] {
  const ready = world.patches.pending.filter((p) => p.readyAt <= world.clock.gameMs);
  if (ready.length === 0) return [];
  world.patches.pending = world.patches.pending.filter((p) => !ready.includes(p));
  for (const p of ready) {
    world.patches.applied.push(p.patch);
    emit(world, { kind: 'patch-applied', patch: p.patch });
    costOf(world, 'DEF-13');
  }
  return ready.map((p) => p.patch);
}

/** Hourly game-time snapshots for DEF-17. */
export function takeBackupIfDue(world: World): void {
  const every = CONFIG[world.difficulty].backupEveryGameMs;
  if (world.clock.gameMs - world.clock.lastBackupAt < every) return;
  world.clock.lastBackupAt = world.clock.gameMs;
  const id = world.backups.length;
  world.backups.push({
    id, takenAt: world.clock.gameMs,
    accounts: structuredClone(world.accounts), files: structuredClone(world.files), defacements: structuredClone(world.defacements),
  });
}
