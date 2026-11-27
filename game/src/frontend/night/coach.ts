// The drill's coach (UI-12, D-274) as pure logic, free of the DOM so it can be tested: for each training step, the
// callouts in order (each paragraph of TRAINING_STEPS's text, plus the suspicious request itself before the tool), what
// each points at, the request picked from the live log and why it looks wrong in plain words, where a target is on
// screen (inside its window, or its dock entry while the window is closed) and where the callout goes. The coach only
// points: the player does every action (Coach.tsx draws it).

import type { TrainingStep } from '../../content/kiro-fallback';
import { senderOf } from '../../content/explanations';
import { CONFIG } from '../../engine/config';
import { renderCombined } from '../../engine/replay';
import type { AccessLine, World } from '../../engine/state';
import { TOOL_BY_ID, type ToolId } from './windows';

/** What a callout points at. `el` are `data-coach` values inside the window, the first on screen wins; `{ip}` is the suspect. */
export type Anchor =
  | { at: 'center' }
  | { at: 'meters' }
  | { at: 'dock' }
  | { at: 'window'; tool: ToolId; el?: readonly string[]; also?: boolean }
  | { at: 'line' };

/** The kind of suspicious request a step points at. */
export type LineKind = 'scan' | 'login' | 'search';

export interface PlanMark {
  /** The paragraph of the step's `lines` this callout says; absent for the suspicious request's own callout. */
  para?: number;
  /** This callout is the suspicious request of this kind. */
  line?: LineKind;
  anchors: readonly Anchor[];
}

const win = (tool: ToolId, ...el: string[]): Anchor => ({ at: 'window', tool, ...(el.length ? { el } : {}) });
/** A second place the same action can be done (the terminal), outlined only while its window is open. */
const also = (tool: ToolId, ...el: string[]): Anchor => ({ at: 'window', tool, also: true, ...(el.length ? { el } : {}) });

/** D-274: one entry per TRAINING_STEPS id. The last callout of each step waits for the player's action. */
export const COACH_PLAN: Readonly<Record<string, readonly PlanMark[]>> = {
  room: [
    { para: 0, anchors: [{ at: 'center' }] },
    { para: 1, anchors: [win('logs'), win('alerts'), { at: 'meters' }] },
    { para: 2, anchors: [{ at: 'dock' }] },
  ],
  flag: [
    { para: 0, anchors: [win('alerts')] },
    { line: 'scan', anchors: [{ at: 'line' }] },
    { para: 1, anchors: [win('traffic', 'flag:{ip}'), also('terminal', 'terminal-input')] },
  ],
  block: [
    { line: 'scan', anchors: [{ at: 'line' }] },
    { para: 0, anchors: [win('traffic', 'block:{ip}'), also('terminal', 'terminal-input')] },
  ],
  'rate-limit': [
    { para: 0, anchors: [win('alerts')] },
    { line: 'login', anchors: [{ at: 'line' }] },
    { para: 1, anchors: [win('waf', 'waf:login')] },
  ],
  'search-off': [
    { para: 0, anchors: [win('alerts')] },
    { line: 'search', anchors: [{ at: 'line' }] },
    { para: 1, anchors: [win('features', 'feature:search')] },
  ],
  patch: [{ para: 0, anchors: [win('deploy', 'deploy:search', 'patch:search')] }],
  evidence: [{ para: 0, anchors: [win('terminal', 'terminal-input'), also('backups')] }],
};

export interface Mark {
  text: string;
  anchors: readonly Anchor[];
  /** `next`: the player reads it and presses Next (the drill's clock waits); `action`: it waits for the step's action. */
  wait: 'next' | 'action';
  line?: LineKind;
}

/** The callouts of a step, in order: its paragraphs (and the suspicious request's callout, whose text is `whyWords`'s). */
export function marksFor(step: TrainingStep): Mark[] {
  const plan = COACH_PLAN[step.id] ?? [{ para: 0, anchors: [{ at: 'center' }] }];
  return plan.map((m, i) => ({
    text: m.para !== undefined ? (step.lines[m.para] ?? '') : '',
    anchors: m.anchors,
    wait: i === plan.length - 1 ? 'action' : 'next',
    ...(m.line ? { line: m.line } : {}),
  }));
}

// ------------------------------------------------------------------ the suspicious request

/** Every address the drill has played from (its starts and its running replays). */
export function drillAddresses(world: World): Set<string> {
  const set = new Set<string>();
  for (const e of world.events) if (e.kind === 'move-started') set.add(e.ip);
  for (const r of world.replays) for (const ip of r.ips ?? [r.ip]) set.add(ip);
  return set;
}

const SEARCH = '/rest/products/search';
const LOGIN = '/rest/user/login';
/** Quotes, brackets, comment marks or database words in a request's query: not what a shopper types. */
const DB_SHAPED = /%27|'|%22|%28|%29|--|\b(order|by|and|or|null|char|sleep)\b/i;

const matches: Record<LineKind, (l: AccessLine) => boolean> = {
  scan: (l) => l.method === 'GET' && !l.target.startsWith('/rest/') && !l.target.startsWith('/api/'),
  login: (l) => l.method === 'POST' && l.target.startsWith(LOGIN) && l.status === 401,
  search: (l) => l.target.startsWith(SEARCH) && (l.status >= 500 || DB_SHAPED.test(l.target)),
};

export interface Suspect {
  /** The line's index in `world.logs.access` (the log window pins it). */
  index: number;
  line: AccessLine;
  /** The line as the log shows it. */
  text: string;
  /** Why it looks wrong, in plain words. */
  why: string;
}

/**
 * The newest access line of this kind from an address the drill plays from, and why it looks wrong. For the scan, an
 * address already blocked is passed over (the block step points at the one still knocking).
 */
export function suspectLine(world: World, kind: LineKind, prefer?: string): Suspect | null {
  const drill = drillAddresses(world);
  const src = world.logs.access;
  let found = -1;
  let fallback = -1;
  for (let i = src.length - 1; i >= 0 && i >= src.length - 50_000; i--) {
    const l = src[i]!;
    if (!drill.has(l.ip) || !matches[kind](l)) continue;
    if (prefer && l.ip !== prefer) {
      if (fallback < 0 && !world.firewall.blocked.includes(l.ip)) fallback = i;
      continue;
    }
    found = i;
    break;
  }
  const index = found >= 0 ? found : fallback;
  if (index < 0) return null;
  const line = src[index]!;
  return { index, line, text: renderCombined(world, line), why: whyWords(world, line, kind) };
}

/** The address the step's tool should act on: the confirmed flag the drill played from, else the newest scanning address. */
export function suspectIp(world: World): string | null {
  const drill = drillAddresses(world);
  const confirmed = world.flags.find((f) => f.confirmedAt !== undefined && drill.has(f.ip) && !world.firewall.blocked.includes(f.ip));
  if (confirmed) return confirmed.ip;
  const flagged = world.flags.find((f) => drill.has(f.ip) && !world.firewall.blocked.includes(f.ip));
  if (flagged) return flagged.ip;
  const s = suspectLine(world, 'scan');
  return s && !world.firewall.blocked.includes(s.line.ip) ? s.line.ip : null;
}

/** The suspect's last real minute in the log: requests, failed logins, distinct paths, the same answer size. */
export function minuteOf(world: World, ip: string): { requests: number; failed: number; paths: number; sameSize: number } {
  const since = world.clock.gameMs - 60_000 * CONFIG[world.difficulty].gameMsPerRealMs;
  const paths = new Set<string>();
  const sizes = new Map<number, number>();
  let requests = 0;
  let failed = 0;
  const src = world.logs.access;
  for (let i = src.length - 1; i >= 0; i--) {
    const l = src[i]!;
    if (l.t < since) continue;
    if (l.ip !== ip) continue;
    requests++;
    if (l.target.startsWith(LOGIN) && l.status === 401) failed++;
    paths.add(l.target.split('?')[0]!);
    sizes.set(l.bytes, (sizes.get(l.bytes) ?? 0) + 1);
  }
  return { requests, failed, paths: paths.size, sameSize: Math.max(0, ...sizes.values()) };
}

const UA_WORDS = (ua: string): string =>
  senderOf(ua) === 'browser' ? '' : ' Its user agent is not a browser\'s: a script or a tool sent it, not a shopper on the page.';

/**
 * Why a line looks wrong, in plain words read from the line and the minute around it. It names no tool, technique or
 * attacker (the CON-03 spoiler list is tested on it): it teaches how to read a log, not how the real shift is won.
 */
export function whyWords(world: World, line: AccessLine, kind: LineKind): string {
  const m = minuteOf(world, line.ip);
  const many = m.requests === 1 ? 'one request' : `${m.requests} requests`;
  switch (kind) {
    case 'scan':
      return (
        `Look at this request from ${line.ip}: it asks for a page the shop doesn't link to anywhere. ` +
        `This address sent ${many} in the last minute, for ${m.paths} different paths, and ${m.sameSize} of the answers are exactly ${line.bytes} bytes: ` +
        'the shop answers every unknown path with the same page, so a wall of identical answers means someone is trying a list of names to map the site. ' +
        `A shopper follows the links on the page.${UA_WORDS(line.userAgent)}`
      );
    case 'login':
      return (
        `A failed login (401) from ${line.ip}. This address tried to log in ${m.failed === 1 ? 'once' : `${m.failed} times`} in the last minute and failed. ` +
        `A person mistypes a password once or twice and types slowly; this is a list of passwords being tried, faster than anyone types.${UA_WORDS(line.userAgent)}`
      );
    case 'search':
      return (
        `A search from ${line.ip} answered ${line.status}${line.status >= 500 ? ', a server error' : ''}. ` +
        'Its query carries quotes, brackets and database words where a shopper types a product name: someone is feeding the search box text meant for the database behind it. ' +
        `Search should never fail like that, let alone again and again from one address.${UA_WORDS(line.userAgent)}`
      );
  }
}

// ------------------------------------------------------------------ where it points

export interface Target {
  /** CSS selectors to try in order; the first on screen is the target. Empty: the callout sits in the middle. */
  selectors: string[];
  /** The tool's window is closed: the target is its dock entry, and the callout first says to open it. */
  opens?: ToolId;
}

/** Where an anchor is on screen, given the open windows and the suspect's address. */
export function anchorTarget(a: Anchor, open: ReadonlySet<ToolId>, ip: string | null): Target {
  switch (a.at) {
    case 'center':
      return { selectors: [] };
    case 'meters':
      return { selectors: ['[data-coach="meters"]'] };
    case 'dock':
      return { selectors: ['[data-coach="dock"]'] };
    case 'line':
      if (!open.has('logs')) return { selectors: ['[data-coach="dock:logs"]'], opens: 'logs' };
      return { selectors: ['[data-coach="win:logs"] [data-coach="line"]', '[data-coach="win:logs"]'] };
    case 'window': {
      if (!open.has(a.tool)) return a.also ? { selectors: [] } : { selectors: [`[data-coach="dock:${a.tool}"]`], opens: a.tool };
      const inside = (a.el ?? []).filter((e) => !e.includes('{ip}') || ip).map((e) => `[data-coach="win:${a.tool}"] [data-coach="${e.replace('{ip}', ip ?? '')}"]`);
      return { selectors: [...inside, `[data-coach="win:${a.tool}"]`] };
    }
  }
}

/** "Open the Traffic window on the dock." for a target behind a closed window. */
export const openWords = (tool: ToolId): string => `Open ${TOOL_BY_ID[tool].label} on the dock (left).`;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GAP = 16;
const EDGE = 8;

/** Where the callout goes: beside the target (right, left, below, above, the first that fits), inside the view. */
export function calloutAt(target: Rect | null, box: { w: number; h: number }, view: { w: number; h: number }): { x: number; y: number } {
  const fitX = (x: number) => Math.max(EDGE, Math.min(view.w - box.w - EDGE, x));
  const fitY = (y: number) => Math.max(EDGE, Math.min(view.h - box.h - EDGE, y));
  if (!target) return { x: fitX((view.w - box.w) / 2), y: fitY((view.h - box.h) / 2) };
  const r = target;
  if (r.x + r.w + GAP + box.w <= view.w - EDGE) return { x: r.x + r.w + GAP, y: fitY(r.y) };
  if (r.x - GAP - box.w >= EDGE) return { x: r.x - GAP - box.w, y: fitY(r.y) };
  if (r.y + r.h + GAP + box.h <= view.h - EDGE) return { x: fitX(r.x), y: r.y + r.h + GAP };
  if (r.y - GAP - box.h >= EDGE) return { x: fitX(r.x), y: r.y - GAP - box.h };
  // nothing fits beside a target this big: the corner of the view the target leaves most room in
  return { x: r.x + r.w / 2 > view.w / 2 ? EDGE : view.w - box.w - EDGE, y: fitY(view.h - box.h - EDGE) };
}
