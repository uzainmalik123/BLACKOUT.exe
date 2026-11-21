// The replay engine (SYS-03): plays a recording's events into the virtual logs, DB changes and files at game
// speed (D-24: recorded ms × 30), and cuts a move the moment one of its stoppers holds (an IP block, a WAF rule,
// a flag, a patch, the plug), so the Director can pick the next variant. Minion waves replay through it too.
import type { DbEvent, FileEvent, RecEvent } from '../recordings/format';
import { MINION_BY_ID } from '../rules/minions';
import { MOVE_BY_ID } from '../rules/moves';
import type { ActionId, MinionId, MoveId, Stopper } from '../rules/vocabulary';
import { gameTimeIso } from './clock';
import { CONFIG } from './config';
import { stopperHolds, type VariantInfo } from './facts';
import type { RecordingLibrary, Variant } from './library';
import { emit } from './log';
import { nextRandom } from './rng';
import { SEED_ACCOUNTS } from './seed';
import { breakInto, steal } from './souls';
import type { Account, AccessLine, Replay, World } from './state';

const isMove = (id: MoveId | MinionId): id is MoveId => id.startsWith('ATK-');

function nextId(world: World): number {
  return world.death.nextId++;
}

/** One alert per Death move and per minion wave (D-24). Opening or closing one restarts the Director's "quiet" clock. */
export function openAlert(world: World, about: MoveId | MinionId): void {
  const id = nextId(world);
  world.alerts.push({ id, about, openedAt: world.clock.gameMs });
  world.quietAlertsSince = world.clock.gameMs;
  emit(world, { kind: 'alert-opened', alert: id, about });
}

export function closeAlert(world: World, about: MoveId | MinionId): void {
  const alert = world.alerts.find((a) => a.about === about && a.closedAt === undefined);
  if (!alert) return;
  alert.closedAt = world.clock.gameMs;
  world.quietAlertsSince = world.clock.gameMs;
  emit(world, { kind: 'alert-closed', alert: alert.id, about });
}

/** D-41: the seeded wait after one of Death's moves lands or is stopped. */
export function breather(world: World): number {
  const { min, max } = CONFIG[world.difficulty].breatherGameMs;
  return min + Math.round(nextRandom(world) * (max - min));
}

/**
 * Starts playing a variant. Death's moves open an alert and log move-started; waves log their own events. A wave may
 * play only a slice of its recording (D-41): events `from` up to, not including, `to`.
 */
export function startReplay(world: World, v: Variant, owner: 'death' | MinionId, ips?: string[], slice?: { from: number; to: number }): Replay {
  const ratio = CONFIG[world.difficulty].gameMsPerRealMs;
  const saved = owner === 'death' && isMove(v.move) ? world.death.resume[v.move] : undefined;
  const cursor = slice?.from ?? (saved && saved.variant === v.variant && saved.cursor < v.recording.events.length ? saved.cursor : 0);
  // An IP-cut move carries on from a fresh address (and a wave's slice starts) with its next event due now.
  const startedAt = world.clock.gameMs - (cursor > 0 ? v.recording.events[cursor]!.t * ratio : 0);
  const replay: Replay = {
    id: nextId(world), owner, move: v.move, variant: v.variant, ip: v.info.ip, recordedIp: v.recording.attackerIp, startedAt, cursor,
    ...(ips && { ips }), ...(slice && { endCursor: slice.to }),
  };
  if (saved && isMove(v.move)) delete world.death.resume[v.move];
  world.replays.push(replay);
  if (owner === 'death' && isMove(v.move)) {
    if (world.death.noRepeat !== v.move) delete world.death.noRepeat; // D-41: he has started a different move
    openAlert(world, v.move);
    emit(world, { kind: 'move-started', move: v.move, variant: v.variant, stage: MOVE_BY_ID[v.move].stage, ip: v.info.ip });
  }
  return replay;
}

export function activeDeathReplay(world: World): Replay | undefined {
  return world.replays.find((r) => r.owner === 'death');
}

function variantOf(library: RecordingLibrary, replay: Replay): Variant | undefined {
  return library.variantsOf(replay.move).find((v) => v.variant === replay.variant);
}

/**
 * Removes a replay. A cut Death move counts as played, logs move-cut and closes its alert. An IP block only
 * interrupts it: it resumes from a fresh address after a short wait (D-24). Any other stopper ends it: a breather,
 * and he won't pick the same move again until he has started a different one (D-41).
 */
export function cutReplay(world: World, replay: Replay, by: ActionId): void {
  world.replays = world.replays.filter((r) => r !== replay);
  if (replay.owner !== 'death' || !isMove(replay.move)) return;
  world.death.played.push({ move: replay.move, variant: replay.variant, outcome: 'cut' });
  if (by === 'DEF-06') world.death.resume[replay.move] = { variant: replay.variant, cursor: replay.cursor };
  else world.death.noRepeat = replay.move;
  emit(world, { kind: 'move-cut', move: replay.move, variant: replay.variant, by });
  closeAlert(world, replay.move);
  const wait = by === 'DEF-06' ? CONFIG[world.difficulty].ipResumeGameMs : breather(world);
  world.death.nextMoveAt = world.clock.gameMs + (world.death.skipWait ? 0 : wait);
  world.death.skipWait = false;
}

/** A minion success hands Death a user-session for the account it broke into (MIN-02, D-18). */
export function grantMinionSession(world: World, by: MinionId, victim: Account | undefined): void {
  if (victim && MINION_BY_ID[by].damage.givesDeath === 'user-session') {
    world.sessions.push({ id: nextId(world), email: victim.email, kind: 'user', issuedBy: by, keyVersion: world.signingKey.version });
  }
}

function whatStops(world: World, replay: Replay, info: VariantInfo): ActionId | undefined {
  if (world.nginx === 'stopped') return 'DEF-11';
  if ((replay.ips ?? [replay.ip]).every((ip) => world.firewall.blocked.includes(ip))) return 'DEF-06';
  const stoppers: Stopper[] = isMove(replay.move) ? MOVE_BY_ID[replay.move].stoppedBy : MINION_BY_ID[replay.move].closedBy;
  return stoppers.find((s) => stopperHolds(world, s, info))?.action;
}

/**
 * Each recording was made on a fresh shop, so two of Death's sign-ups can carry the same new Users id (ATK-06.a and
 * ATK-11.a both insert 326). The second gets the next free id, as the real shop's autoincrement would, and the
 * replay remembers it for the rest of its events (the Users key and any UserId column).
 */
function userIdFor(world: World, replay: Replay, e: DbEvent, by: MoveId): number {
  const recorded = Number(Object.values(e.key)[0]);
  const mapped = replay.userIds?.[String(recorded)];
  if (mapped !== undefined) return mapped;
  if (e.table !== 'Users' || e.op !== 'insert' || !e.after) return recorded;
  const email = String(e.after.email ?? '');
  const holder = world.accounts.find((x) => x.id === recorded);
  if (!holder || (holder.createdBy === by && holder.email === email)) return recorded; // free, or a retried move's own row
  const fresh = Math.max(...SEED_ACCOUNTS.map((a) => a.id), ...world.accounts.map((a) => a.id)) + 1;
  replay.userIds = { ...replay.userIds, [String(recorded)]: fresh };
  return fresh;
}

function remapped(e: DbEvent, replay: Replay, id: number): DbEvent {
  const map = replay.userIds;
  if (!map) return e;
  const fix = (row?: Record<string, unknown>) => {
    if (!row) return row;
    const out = { ...row } as NonNullable<DbEvent['after']>;
    if (e.table === 'Users' && 'id' in out) out.id = id;
    if (typeof out.UserId === 'number' && map[String(out.UserId)] !== undefined) out.UserId = map[String(out.UserId)]!;
    return out;
  };
  const key = e.table === 'Users' ? { [Object.keys(e.key)[0]!]: id } : e.key;
  return { ...e, key, ...(e.before && { before: fix(e.before) }), ...(e.after && { after: fix(e.after) }) };
}

function applyDb(world: World, replay: Replay, recorded: DbEvent, t: number): void {
  const by = replay.move;
  const id = isMove(by) && recorded.table === 'Users' ? userIdFor(world, replay, recorded, by) : Number(Object.values(recorded.key)[0]);
  const e = remapped(recorded, replay, id);
  world.logs.dbChanges.push({ t, op: e.op, table: e.table, key: e.key, ...(e.before && { before: e.before }), ...(e.after && { after: e.after }) });
  if (!isMove(by)) return;
  if (e.table === 'Users') {
    if (e.op === 'insert' && e.after) {
      const role = String(e.after.role ?? 'customer') as World['accounts'][number]['role'];
      world.accounts = world.accounts.filter((x) => x.id !== id); // a retried move inserts the same row once
      world.accounts.push({ id, email: String(e.after.email ?? `user${id}@juice-sh.op`), role, createdBy: by });
    } else if (e.op === 'update' && e.after?.password !== undefined) {
      const a = world.accounts.find((x) => x.id === id);
      if (!a) return;
      if (by === 'ATK-12') a.hijackedBy = by;
      else world.sessions.push({ id: nextId(world), email: a.email, kind: 'user', issuedBy: by, keyVersion: world.signingKey.version });
    } else if (e.op === 'delete') {
      world.accounts = world.accounts.filter((x) => x.id !== id);
    }
  } else if (e.table === 'Products' && e.op === 'update' && e.after?.description !== undefined) {
    const text = String(e.after.description);
    world.defacements.push({ productId: id, kind: /<script|<iframe/i.test(text) ? 'xss' : 'deface', by }); // ATK-17 renames product 1 (ATK-17.a)
  }
}

function applyFile(world: World, by: MoveId | MinionId, e: FileEvent): void {
  world.files = world.files.filter((f) => f.path !== e.path);
  if (e.op === 'remove') return;
  world.files.push({ path: e.path, size: e.size, sha256: e.sha256, ...(e.contentBase64 !== undefined && { contentBase64: e.contentBase64 }), ...(isMove(by) && { plantedBy: by }) });
}

function applyEvent(world: World, replay: Replay, e: RecEvent, t: number): void {
  const by = replay.move;
  switch (e.kind) {
    case 'access': {
      const ips = replay.ips ?? [replay.ip];
      const ip = e.ip === replay.recordedIp ? ips[replay.cursor % ips.length]! : e.ip;
      world.logs.access.push({ t, ip, method: e.method, target: e.target, protocol: e.protocol, status: e.status, bytes: e.bytes, referer: e.referer, userAgent: e.userAgent, by });
      return;
    }
    case 'app':
      world.logs.app.push({ t, text: e.text, by });
      return;
    case 'db':
      applyDb(world, replay, e, t);
      return;
    case 'file':
      applyFile(world, by, e);
      return;
    case 'exfil':
      if (isMove(by)) steal(world, by, e.table, e.keys);
      else if (e.table === 'Users') for (const key of e.keys) grantMinionSession(world, by, breakInto(world, by, key)); // one recorded success (D-41)
      else steal(world, by, e.table, e.keys);
  }
}

/** A Death move that played to the end: its gains land, its alert closes, the breather starts (D-41). */
function land(world: World, replay: Replay, info: VariantInfo): void {
  world.replays = world.replays.filter((r) => r !== replay);
  if (replay.owner !== 'death' || !isMove(replay.move)) return;
  const move = MOVE_BY_ID[replay.move];
  for (const g of move.gains) {
    if (g === 'map' || g === 'secrets-leaked' || g === 'admin-password') {
      if (!world.death.knowledge.includes(g)) world.death.knowledge.push(g);
    } else if (g === 'admin-session') {
      world.sessions.push({ id: nextId(world), email: 'admin@juice-sh.op', kind: 'admin', issuedBy: move.id, keyVersion: world.signingKey.version });
    } else if (g === 'user-session' && !world.sessions.some((s) => s.issuedBy === move.id)) {
      const email = info.targets[0] ?? world.accounts.find((a) => a.role === 'customer')?.email ?? 'jim@juice-sh.op';
      world.sessions.push({ id: nextId(world), email, kind: 'user', issuedBy: move.id, keyVersion: world.signingKey.version });
    }
  }
  if (move.foothold === 'forged-token') world.death.forgedToken = true;
  world.death.played.push({ move: move.id, variant: replay.variant, outcome: 'landed' });
  emit(world, { kind: 'move-landed', move: move.id, variant: replay.variant });
  closeAlert(world, move.id);
  world.death.nextMoveAt = world.clock.gameMs + (world.death.skipWait ? 0 : breather(world));
  world.death.skipWait = false;
}

/** One tick of every replay: cut what is now stopped, apply the events that are due, land what has finished. */
export function stepReplays(world: World, library: RecordingLibrary): void {
  const ratio = CONFIG[world.difficulty].gameMsPerRealMs;
  for (const replay of [...world.replays]) {
    const v = variantOf(library, replay);
    if (!v) {
      cutReplay(world, replay, 'DEF-11');
      continue;
    }
    const info: VariantInfo = { ...v.info, ip: replay.ip };
    const events = v.recording.events;
    const end = replay.endCursor ?? events.length;
    const by = whatStops(world, replay, info);
    if (by === 'DEF-06' && replay.cursor >= end) {
      land(world, replay, info); // the tool had already finished; blocking the address changes nothing
      continue;
    }
    if (by) {
      cutReplay(world, replay, by);
      continue;
    }
    const now = world.clock.gameMs;
    while (replay.cursor < end && replay.startedAt + events[replay.cursor]!.t * ratio <= now) {
      applyEvent(world, replay, events[replay.cursor]!, replay.startedAt + events[replay.cursor]!.t * ratio);
      replay.cursor++;
    }
    const finished = replay.endCursor !== undefined || replay.startedAt + v.recording.durationMs * ratio <= now; // a slice ends at its last event
    if (replay.cursor >= end && finished) land(world, replay, info);
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** nginx's `combined` format, stamped with game time (D-15: the engine renders the line, not the recording). */
export function renderCombined(world: World, line: AccessLine): string {
  const iso = gameTimeIso(world, line.t);
  const date = `${iso.slice(8, 10)}/${MONTHS[Number(iso.slice(5, 7)) - 1]}/${iso.slice(0, 4)}:${iso.slice(11, 19)} +0000`;
  return `${line.ip} - - [${date}] "${line.method} ${line.target} ${line.protocol}" ${line.status} ${line.bytes} "${line.referer || '-'}" "${line.userAgent || '-'}"`;
}

export function renderAccessLog(world: World): string {
  return world.logs.access.map((l) => renderCombined(world, l) + '\n').join('');
}

export function renderAppLog(world: World): string {
  return world.logs.app.map((l) => l.text + '\n').join('');
}
