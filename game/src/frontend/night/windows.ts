// The dock and its floating windows (UI-11, D-234, D-240) as pure state, free of the DOM so it can be tested: which
// tools the dock lists on a level, which windows are open, where, and which is on top. One click on the dock opens a
// tool (or brings it forward); a window is dragged by its bar and closed at its top right; several stay open at once.
// No nested menus: every tool is one entry.

import type { TutorialPanel } from '../../content/kiro-fallback';
import type { Difficulty } from '../../rules/vocabulary';
import { DIAL } from '../shared/dial';

export type ToolId =
  | 'logs' | 'alerts' | 'traffic' | 'terminal' | 'cheats'
  | 'waf' | 'firewall' | 'features' | 'flags' | 'accounts' | 'uploads' | 'sessions' | 'deploy' | 'backups' | 'comms' | 'plug'
  | 'kiro' | 'files';

export interface Tool {
  id: ToolId;
  label: string;
  /** A glyph for the dock, in the screens' own set (no icon font). */
  glyph: string;
  /** A console that changes production: locked during the change freeze (SYS-22). */
  change?: boolean;
  /** Only where the level has investigation buttons (SYS-08). */
  investigate?: boolean;
}

/** Every tool on the dock, in its order (SCENES §5.1): the reading tools, the consoles, then Kiro and the files. */
export const TOOLS: readonly Tool[] = [
  { id: 'logs', label: 'Logs', glyph: '≣' },
  { id: 'alerts', label: 'Alerts', glyph: '⚠' },
  { id: 'traffic', label: 'Traffic', glyph: '▦' },
  { id: 'terminal', label: 'Terminal', glyph: '>_' },
  { id: 'cheats', label: 'Cheat sheet', glyph: '?' },
  { id: 'waf', label: 'WAF', glyph: '⛨', change: true },
  { id: 'firewall', label: 'Firewall', glyph: '⊘', change: true },
  { id: 'features', label: 'Feature flags', glyph: '⏻', change: true },
  { id: 'flags', label: 'Address flags', glyph: '⚑' },
  { id: 'accounts', label: 'Accounts', glyph: '☺', change: true },
  { id: 'uploads', label: 'Uploads', glyph: '⇪', change: true, investigate: true },
  { id: 'sessions', label: 'Sessions', glyph: '⚿', change: true },
  { id: 'deploy', label: 'Deploy', glyph: '⇡', change: true },
  { id: 'backups', label: 'Backups', glyph: '⟲', change: true },
  { id: 'comms', label: 'Comms', glyph: '✉' },
  { id: 'plug', label: 'The plug', glyph: '⏼', change: true },
  { id: 'kiro', label: 'Kiro', glyph: '☾' }, // the dock draws her as the logo's ghost (KiroIcon, D-250); this stays for text
  { id: 'files', label: 'Briefing', glyph: '❏' },
];

export const TOOL_BY_ID: Readonly<Record<ToolId, Tool>> = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<ToolId, Tool>;

/** The dock on a level: every tool, but the investigation-only ones where the level has no investigation buttons. */
export function dockFor(d: Difficulty): Tool[] {
  return TOOLS.filter((t) => !t.investigate || DIAL[d].investigate);
}

/** What opens when the desk shows (the dial: Easy the log and the alerts; Medium both and the terminal; Hard the terminal first). */
export function startingTools(d: Difficulty): ToolId[] {
  const dial = DIAL[d];
  if (!dial.investigate) return ['terminal'];
  return dial.terminalAtStart ? ['logs', 'alerts', 'terminal'] : ['logs', 'alerts'];
}

export interface Win {
  id: ToolId;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface Wins {
  open: Win[];
  z: number;
}

export interface View {
  w: number;
  h: number;
}

export const NO_WINDOWS: Wins = { open: [], z: 10 };

/** The bar's height: what must stay on screen so a window can always be dragged back. */
export const BAR = 30;
const MARGIN = 8;

/** Where a tool first opens, as fractions of the view, over the battlefield and clear of Kiro's column; the rest cascade. */
const HOME: Partial<Record<ToolId, [number, number, number, number]>> = {
  alerts: [0.08, 0.17, 0.29, 0.24],
  logs: [0.08, 0.43, 0.29, 0.43],
  terminal: [0.385, 0.36, 0.345, 0.5],
  kiro: [0.45, 0.14, 0.28, 0.6],
};
const SIZE: Partial<Record<ToolId, [number, number]>> = {
  traffic: [0.3, 0.42],
  cheats: [0.4, 0.62],
  accounts: [0.46, 0.5],
  deploy: [0.46, 0.55],
  features: [0.3, 0.42],
  flags: [0.3, 0.42],
  plug: [0.3, 0.38],
};

/** Keeps a window's bar reachable: at least 120 px of it inside the view, its top never above it. */
export function clamp(win: Win, view: View): Win {
  const w = Math.min(win.w, view.w - 2 * MARGIN);
  const h = Math.min(win.h, view.h - 2 * MARGIN);
  const x = Math.max(120 - w, Math.min(view.w - 120, win.x));
  const y = Math.max(0, Math.min(view.h - BAR, win.y));
  return { ...win, x, y, w, h };
}

/** Opens a tool, or brings it to the front when it is already open. */
export function openTool(s: Wins, id: ToolId, view: View): Wins {
  if (s.open.some((w) => w.id === id)) return focusTool(s, id);
  const z = s.z + 1;
  const home = HOME[id];
  let rect: [number, number, number, number];
  if (home) rect = [home[0] * view.w, home[1] * view.h, home[2] * view.w, home[3] * view.h];
  else {
    const [fw, fh] = SIZE[id] ?? [0.36, 0.44];
    const k = s.open.length % 6;
    rect = [view.w * 0.3 + k * 28, view.h * 0.14 + k * 28, fw * view.w, fh * view.h];
  }
  const win = clamp({ id, x: rect[0], y: rect[1], w: Math.max(280, rect[2]), h: Math.max(180, rect[3]), z }, view);
  return { open: [...s.open, win], z };
}

export function closeTool(s: Wins, id: ToolId): Wins {
  return s.open.some((w) => w.id === id) ? { ...s, open: s.open.filter((w) => w.id !== id) } : s;
}

/** One click on the dock: opens a closed tool, brings a covered one forward, closes the one already on top. */
export function toggleTool(s: Wins, id: ToolId, view: View): Wins {
  return topTool(s) === id ? closeTool(s, id) : openTool(s, id, view);
}

export function focusTool(s: Wins, id: ToolId): Wins {
  const win = s.open.find((w) => w.id === id);
  if (!win || win.z === s.z) return s;
  const z = s.z + 1;
  return { open: s.open.map((w) => (w.id === id ? { ...w, z } : w)), z };
}

export function moveTool(s: Wins, id: ToolId, x: number, y: number, view: View): Wins {
  return { ...s, open: s.open.map((w) => (w.id === id ? clamp({ ...w, x, y }, view) : w)) };
}

/** The window on top, if any (Escape closes it). */
export function topTool(s: Wins): ToolId | undefined {
  let top: Win | undefined;
  for (const w of s.open) if (!top || w.z > top.z) top = w;
  return top?.id;
}

export const isOpen = (s: Wins, id: ToolId): boolean => s.open.some((w) => w.id === id);

/** The dock entry a tutorial step's panel lights (CON-03, D-238); the meters and the dock itself are not entries. */
export const PANEL_TOOL: Readonly<Record<TutorialPanel, ToolId | null>> = {
  logs: 'logs',
  alerts: 'alerts',
  meters: null,
  terminal: 'terminal',
  dock: null,
  'top-talkers': 'traffic',
  'cheat-sheet': 'cheats',
  waf: 'waf',
  'feature-flags': 'features',
  deploy: 'deploy',
  backups: 'backups',
  kiro: 'kiro',
};
