// The spoiler-free snapshot the browser sends the Kiro server with every call (PRD SYS-12, KIRO-07, D-190).
// The game runs client-side, so Kiro's read-only tools (game/server/tools.ts) read this copy, built from
// `engine.world` as the player sees it. Nothing here says who an address belongs to, which move an alert is
// about, or carries a `by` / `createdBy` / `plantedBy` field: those are the engine's spoilers (ENGINE_API §2).
// snapshot.test.ts proves it: no `ATK-|MIN-|TAP-` id and no `by` key is ever serialised.
import { fmtGameMs } from '../engine/assess';
import { CONFIG } from '../engine/config';
import type { Engine } from '../engine/engine';
import type { World } from '../engine/state';
import type { Difficulty, Feature, PlayerAction, WafRule } from '../rules/vocabulary';

/** How many of the newest log lines the snapshot carries (D-190): what a defender has on screen, not the whole night. */
export const SNAPSHOT_LINES = 500;
export const SNAPSHOT_ACTIONS = 20;

export type AlertKind = 'attack' | 'noise' | 'leak';

export interface SnapshotAlert {
  id: number;
  /** What the panel shows: a Death move looks like an attack, a minion wave like noise, a leaky tap like a leak. Never the id. */
  kind: AlertKind;
  openedAt: string; // game clock, as shown ("1 h 05 min")
  closedAt?: string;
}

export interface SnapshotAction {
  at: string; // game clock
  type: PlayerAction['type'];
  /** The player's own input, in one line (a query, a path, an address, a rule); never what the judge made of it. */
  what: string;
  ok: boolean;
}

export interface KiroSnapshot {
  difficulty: Difficulty;
  clock: { gameMs: number; shown: string; wallClock: string; shiftEndsIn: string; paused: boolean };
  souls: { total: number; stolen: number };
  heartbeat: { now: number; max: number };
  nginx: 'running' | 'stopped';
  ending?: string;
  alerts: SnapshotAlert[];
  accounts: Array<{ email: string; role: string; locked: boolean }>;
  sessions: { total: number; admin: number };
  uploads: Array<{ path: string; size: number; sha256: string }>;
  firewall: { blocked: string[] };
  waf: WafRule[];
  features: Record<Feature, boolean>;
  patches: { applied: string[]; deploying: string[] };
  evidence: Array<{ name: string; takenAt: string }>;
  backups: Array<{ id: number; takenAt: string }>;
  comms: { escalated: boolean; notifiedLegal: boolean; notifiedCustomers: boolean };
  logs: { access: string[]; app: string[]; accessTotal: number; appTotal: number };
  actions: SnapshotAction[];
}

function wallClock(world: World, gameMs: number): string {
  return new Date(Date.parse(CONFIG[world.difficulty].scenarioStartIso) + gameMs).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function alertKind(about: string): AlertKind {
  if (about.startsWith('ATK-')) return 'attack';
  if (about.startsWith('TAP-')) return 'leak';
  return 'noise';
}

/** One line of the player's own input for an action (never the judge's `shownAbout`, D-122). */
export function describeAction(a: PlayerAction): string {
  switch (a.type) {
    case 'DEF-01': return `read logs: ${a.query}`;
    case 'DEF-02': return `sql: ${a.sql}`;
    case 'DEF-03': return `read upload: ${a.path}`;
    case 'DEF-04': return `${a.mode} lookup of ${a.ip}`;
    case 'DEF-05': return `evidence snapshot ${a.name}`;
    case 'DEF-06': return `firewall ${a.op} ${a.ip}`;
    case 'DEF-07': return 'login rate limit';
    case 'DEF-08': return `lock ${a.email}`;
    case 'DEF-09': return 'revoke all sessions';
    case 'DEF-10': return `${a.feature} ${a.enabled ? 'on' : 'off'}`;
    case 'DEF-11': return 'stop the web server';
    case 'DEF-12': return `waf rule ${JSON.stringify(a.rule)}`;
    case 'DEF-13': return `deploy patch ${a.patch}`;
    case 'DEF-14': return `delete ${a.email}`;
    case 'DEF-15': return `remove upload ${a.path}`;
    case 'DEF-16': return `force password reset ${a.email}`;
    case 'DEF-17': return `restore backup ${a.backupId}`;
    case 'DEF-18': return `bring back ${a.what}`;
    case 'DEF-19': return 'escalate to the incident lead';
    case 'DEF-20': return `notify ${a.to}`;
  }
}

/** The last `n` lines of a rendered log (a trailing newline makes no empty line). */
function tailLines(text: string, n: number): { lines: string[]; total: number } {
  const all = text.length === 0 ? [] : text.replace(/\n$/, '').split('\n');
  return { lines: all.slice(-n), total: all.length };
}

/** Builds the snapshot from the live engine. Pure over `engine.world` plus the engine's rendered logs. */
export function buildSnapshot(engine: Pick<Engine, 'world' | 'accessLog' | 'appLog'>): KiroSnapshot {
  const w = engine.world;
  const at = (ms: number) => fmtGameMs(ms);
  const access = tailLines(engine.accessLog(), SNAPSHOT_LINES);
  const app = tailLines(engine.appLog(), SNAPSHOT_LINES);
  const actions: SnapshotAction[] = [];
  for (let i = w.events.length - 1; i >= 0 && actions.length < SNAPSHOT_ACTIONS; i--) {
    const e = w.events[i]!;
    if (e.kind !== 'action') continue;
    actions.unshift({ at: at(e.t), type: e.action.type, what: describeAction(e.action), ok: e.ok });
  }
  return {
    difficulty: w.difficulty,
    clock: {
      gameMs: w.clock.gameMs,
      shown: at(w.clock.gameMs),
      wallClock: wallClock(w, w.clock.gameMs),
      shiftEndsIn: at(Math.max(0, w.clock.shiftEndsAt - w.clock.gameMs)),
      paused: w.clock.paused,
    },
    souls: { total: w.souls.total, stolen: w.souls.stolen.length },
    heartbeat: { now: Math.round(w.heartbeat), max: Math.round(w.heartbeatMax) },
    nginx: w.nginx,
    ...(w.ending !== undefined && { ending: w.ending }),
    alerts: w.alerts
      .slice()
      .sort((a, b) => b.openedAt - a.openedAt)
      .map((a) => ({ id: a.id, kind: alertKind(a.about), openedAt: at(a.openedAt), ...(a.closedAt !== undefined && { closedAt: at(a.closedAt) }) })),
    accounts: w.accounts.map((a) => ({ email: a.email, role: a.role, locked: a.lockedAt !== undefined })),
    sessions: { total: w.sessions.length, admin: w.sessions.filter((s) => s.kind === 'admin').length },
    uploads: w.files.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256 })),
    firewall: { blocked: [...w.firewall.blocked] },
    waf: w.waf.map((r) => ({ ...r })),
    features: { ...w.features },
    patches: { applied: [...w.patches.applied], deploying: w.patches.pending.map((p) => p.patch) },
    evidence: w.evidence.map((e) => ({ name: e.name, takenAt: at(e.takenAt) })),
    backups: w.backups.map((b) => ({ id: b.id, takenAt: at(b.takenAt) })),
    comms: {
      escalated: w.comms.escalatedAt !== undefined,
      notifiedLegal: w.comms.notifiedAt.legal !== undefined,
      notifiedCustomers: w.comms.notifiedAt.customers !== undefined,
    },
    logs: { access: access.lines, app: app.lines, accessTotal: access.total, appTotal: app.total },
    actions,
  };
}
