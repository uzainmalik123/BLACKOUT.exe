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
import { steal } from './souls';
import type { AccessLine, Replay, World } from './state';

const isMove = (id: MoveId | MinionId): id is MoveId => id.startsWith('ATK-');

function nextId(world: World): number {
  return world.death.nextId++;
}

function openAlert(world: World, about: MoveId | MinionId): void {
  const id = nextId(world);
  world.alerts.push({ id, about, openedAt: world.clock.gameMs });
  emit(world, { kind: 'alert-opened', alert: id, about });
}

export function closeAlert(world: World, about: MoveId | MinionId): void {
  const alert = world.alerts.find((a) => a.about === about && a.closedAt === undefined);
  if (!alert) return;
  alert.closedAt = world.clock.gameMs;
  emit(world, { kind: 'alert-closed', alert: alert.id, about });
}

/** Starts playing a variant. Death's moves open an alert and log move-started; waves log their own events. */
export function startReplay(world: World, v: Variant, owner: 'death' | MinionId): Replay {
  const replay: Replay = { id: nextId(world), owner, move: v.move, variant: v.variant, ip: v.info.ip, startedAt: world.clock.gameMs, cursor: 0 };
  world.replays.push(replay);
  if (owner === 'death' && isMove(v.move)) {
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

/** Removes a replay. A cut Death move counts as played, logs move-cut, closes its alert and sets a short retry. */
export function cutReplay(world: World, replay: Replay, by: ActionId): void {
  world.replays = world.replays.filter((r) => r !== replay);
  if (replay.owner !== 'death' || !isMove(replay.move)) return;
  world.death.played.push({ move: replay.move, variant: replay.variant, outcome: 'cut' });
  emit(world, { kind: 'move-cut', move: replay.move, variant: replay.variant, by });
  closeAlert(world, replay.move);
  world.death.nextMoveAt = world.clock.gameMs + CONFIG[world.difficulty].cutRetryGameMs;
}

function whatStops(world: World, replay: Replay, info: VariantInfo): ActionId | undefined {
  if (world.nginx === 'stopped') return 'DEF-11';
  if (world.firewall.blocked.includes(replay.ip)) return 'DEF-06';
  const stoppers: Stopper[] = isMove(replay.move) ? MOVE_BY_ID[replay.move].stoppedBy : MINION_BY_ID[replay.move].closedBy;
  return stoppers.find((s) => stopperHolds(world, s, info))?.action;
}

function applyDb(world: World, by: MoveId | MinionId, e: DbEvent): void {
  world.logs.dbChanges.push({ t: world.clock.gameMs, op: e.op, table: e.table, key: e.key, ...(e.before && { before: e.before }), ...(e.after && { after: e.after }) });
  if (!isMove(by)) return;
  const id = Number(Object.values(e.key)[0]);
  if (e.table === 'Users') {
    if (e.op === 'insert' && e.after) {
      const role = String(e.after.role ?? 'customer') as World['accounts'][number]['role'];
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
    if (by === 'ATK-17') world.bannerDefacedBy = by;
    else {
      const text = String(e.after.description);
      world.defacements.push({ productId: id, kind: /<script|<iframe/i.test(text) ? 'xss' : 'deface', by });
    }
  }
}

function applyFile(world: World, by: MoveId | MinionId, e: FileEvent): void {
  world.files = world.files.filter((f) => f.path !== e.path);
  if (e.op === 'remove') return;
  world.files.push({ path: e.path, size: e.size, sha256: e.sha256, ...(e.contentBase64 !== undefined && { contentBase64: e.contentBase64 }), ...(isMove(by) && { plantedBy: by }) });
}

function applyEvent(world: World, replay: Replay, e: RecEvent): void {
  const t = world.clock.gameMs;
  const by = replay.move;
  switch (e.kind) {
    case 'access':
      world.logs.access.push({ t, ip: e.ip, method: e.method, target: e.target, protocol: e.protocol, status: e.status, bytes: e.bytes, referer: e.referer, userAgent: e.userAgent, by });
      return;
    case 'app':
      world.logs.app.push({ t, text: e.text, by });
      return;
    case 'db':
      applyDb(world, by, e);
      return;
    case 'file':
      applyFile(world, by, e);
      return;
    case 'exfil':
      steal(world, by, e.table, e.keys);
  }
}

/** A Death move that played to the end: its gains land, its alert closes, the next wait starts. */
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
  world.death.nextMoveAt = world.clock.gameMs + CONFIG[world.difficulty].moveGapGameMs;
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
    const by = whatStops(world, replay, v.info);
    if (by) {
      cutReplay(world, replay, by);
      continue;
    }
    const events = v.recording.events;
    const now = world.clock.gameMs;
    while (replay.cursor < events.length && replay.startedAt + events[replay.cursor]!.t * ratio <= now) {
      applyEvent(world, replay, events[replay.cursor]!);
      replay.cursor++;
    }
    if (replay.cursor >= events.length && replay.startedAt + v.recording.durationMs * ratio <= now) land(world, replay, v.info);
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
