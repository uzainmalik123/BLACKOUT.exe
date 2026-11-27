// The dock, its windows, the "Now:" strip, the freeze's locks and the alerts' wording (UI-11, D-234, D-235, D-240..D-242):
// the pure parts, tested without a browser.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OPENING_TUTORIAL } from '../../content/kiro-fallback';
import { FREEZE_MESSAGE } from '../../engine/actions';
import { gateOf } from '../../engine/alerts';
import { Engine } from '../../engine/engine';
import type { PlaybookPhase } from '../../engine/state';
import { TAPS } from '../../rules/taps';
import { COMMAND_NAMES, COMMANDS } from '../../shell/registry';
import { NO_FILTER, filterWords, passes } from './Desk';
import { cheatRows } from './Tools';
import { BAR, DOCK_GROUPS, DOCK_RIGHT, MIN_H, MIN_W, NO_WINDOWS, PANEL_TOOL, TOOLS, TOOL_BY_ID, clamp, closeTool, dockFor, focusTool, moveTool, openTool, resizeTool, startingTools, toggleTool, topTool, type ToolId } from './windows';
import { NOW_WORDS, battleGate, freezeReason, gateConsole, gateSentence } from './words';

const baseline = () => new Uint8Array(readFileSync(new URL('../../recordings/juiceshop.sqlite', import.meta.url)));
const VIEW = { w: 1440, h: 900 };

describe('the window manager (UI-11, D-240)', () => {
  it('opens a tool once, on top, inside the view; a second open brings it forward', () => {
    let s = openTool(NO_WINDOWS, 'logs', VIEW);
    s = openTool(s, 'waf', VIEW);
    expect(s.open.map((w) => w.id)).toEqual(['logs', 'waf']);
    expect(topTool(s)).toBe('waf');
    s = openTool(s, 'logs', VIEW);
    expect(s.open).toHaveLength(2);
    expect(topTool(s)).toBe('logs');
    for (const w of s.open) {
      expect(w.x + w.w).toBeGreaterThan(0);
      expect(w.y).toBeGreaterThanOrEqual(0);
      expect(w.y + BAR).toBeLessThanOrEqual(VIEW.h);
    }
  });

  it('keeps several open at once, each tool its own window, and closes one without the others', () => {
    let s = NO_WINDOWS;
    for (const t of TOOLS) if (t.id !== 'files') s = openTool(s, t.id, VIEW);
    expect(new Set(s.open.map((w) => w.id)).size).toBe(TOOLS.length - 1);
    s = closeTool(s, 'deploy');
    expect(s.open.some((w) => w.id === 'deploy')).toBe(false);
    expect(s.open).toHaveLength(TOOLS.length - 2);
    expect(closeTool(s, 'deploy')).toBe(s);
  });

  it('one click on the dock opens, brings forward, or closes the window already on top', () => {
    let s = toggleTool(NO_WINDOWS, 'alerts', VIEW);
    s = toggleTool(s, 'traffic', VIEW);
    s = toggleTool(s, 'alerts', VIEW); // covered: forward, not closed
    expect(topTool(s)).toBe('alerts');
    expect(s.open).toHaveLength(2);
    s = toggleTool(s, 'alerts', VIEW); // on top: closed
    expect(s.open.map((w) => w.id)).toEqual(['traffic']);
  });

  it('drags a window but never loses its bar off screen', () => {
    let s = openTool(NO_WINDOWS, 'cheats', VIEW);
    s = moveTool(s, 'cheats', 300, 200, VIEW);
    expect(s.open[0]).toMatchObject({ x: 300, y: 200 });
    s = moveTool(s, 'cheats', -5000, -300, VIEW);
    expect(s.open[0]!.x + s.open[0]!.w).toBeGreaterThanOrEqual(120);
    expect(s.open[0]!.y).toBe(0);
    s = moveTool(s, 'cheats', 99999, 99999, VIEW);
    expect(s.open[0]!.x).toBeLessThanOrEqual(VIEW.w - 120);
    expect(s.open[0]!.y).toBe(VIEW.h - BAR);
    expect(clamp({ id: 'logs', x: 0, y: 0, w: 5000, h: 5000, z: 1 }, VIEW).w).toBeLessThan(VIEW.w);
  });

  it('focus raises without moving, and does nothing for a closed tool', () => {
    let s = openTool(openTool(NO_WINDOWS, 'kiro', VIEW), 'comms', VIEW);
    const before = s.open.find((w) => w.id === 'kiro')!;
    s = focusTool(s, 'kiro');
    expect(topTool(s)).toBe('kiro');
    expect(s.open.find((w) => w.id === 'kiro')).toMatchObject({ x: before.x, y: before.y });
    expect(focusTool(s, 'plug')).toBe(s);
  });

  it('the dock lists every tool SCENES §5.1 names, one entry each, no nesting', () => {
    const ids = TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['logs', 'alerts', 'terminal', 'waf', 'features', 'flags', 'accounts', 'sessions', 'deploy', 'backups', 'comms', 'plug', 'kiro', 'files', 'traffic', 'cheats'] satisfies ToolId[]) expect(ids).toContain(id);
    expect(TOOL_BY_ID.flags.change).toBeFalsy(); // flagging works during the freeze (DEF-21)
  });

  it('the dock fits: Kiro is not on it, every entry sits in one of four groups, two columns of at most nine rows (D-270)', () => {
    for (const level of ['easy', 'medium', 'hard'] as const) {
      const dock = dockFor(level);
      expect(dock.map((t) => t.id)).not.toContain('kiro');
      expect(dock.map((t) => t.id)).toContain('files');
      for (const t of dock) expect(DOCK_GROUPS.map((g) => g.id)).toContain(t.group);
      // each group's entries are together, the groups in DOCK_GROUPS's order
      const order = dock.map((t) => DOCK_GROUPS.findIndex((g) => g.id === t.group));
      expect(order).toEqual([...order].sort((a, b) => a - b));
      const rows = DOCK_GROUPS.reduce((n, g) => n + Math.ceil(dock.filter((t) => t.group === g.id).length / 2), 0);
      expect(rows).toBeLessThanOrEqual(9);
    }
    expect(TOOL_BY_ID.kiro.group).toBeUndefined(); // still a window, opened from her column
    // the first windows open right of the wider dock
    for (const view of [VIEW, { w: 1366, h: 768 }]) for (const id of ['logs', 'alerts'] as const) expect(openTool(NO_WINDOWS, id, view).open[0]!.x).toBeGreaterThanOrEqual(DOCK_RIGHT(view));
  });

  it('resizes a window from its edge or corner, above the minimum and inside the view, and keeps the size (D-272)', () => {
    let s = moveTool(openTool(NO_WINDOWS, 'waf', VIEW), 'waf', 400, 200, VIEW);
    s = resizeTool(s, 'waf', 700, 500, VIEW);
    expect(s.open[0]).toMatchObject({ x: 400, y: 200, w: 700, h: 500 });
    s = resizeTool(s, 'waf', 10, 10, VIEW);
    expect(s.open[0]).toMatchObject({ w: MIN_W, h: MIN_H });
    s = resizeTool(s, 'waf', 99999, 99999, VIEW);
    expect(s.open[0]!.x + s.open[0]!.w).toBeLessThanOrEqual(VIEW.w);
    expect(s.open[0]!.y + s.open[0]!.h).toBeLessThanOrEqual(VIEW.h);
    const sized = s.open[0]!;
    s = focusTool(openTool(s, 'logs', VIEW), 'waf');
    s = moveTool(s, 'waf', 300, 150, VIEW);
    expect(s.open.find((w) => w.id === 'waf')).toMatchObject({ w: sized.w, h: sized.h, x: 300, y: 150 });
    expect(resizeTool(s, 'plug', 500, 500, VIEW).open).toEqual(s.open); // a closed tool: nothing changes
  });

  it('every tutorial panel lights a dock entry, the meters, or the dock itself (CON-03, D-238)', () => {
    for (const level of ['easy', 'medium', 'hard'] as const)
      for (const step of OPENING_TUTORIAL[level])
        for (const panel of step.panels) {
          const tool = PANEL_TOOL[panel];
          if (tool) expect(TOOLS.map((t) => t.id)).toContain(tool);
          else expect(['meters', 'dock']).toContain(panel);
        }
  });
});

describe('the difficulty dial on the dock (SYS-08, D-241)', () => {
  it('Easy and Medium have the investigation-only uploads list, Hard does not', () => {
    expect(dockFor('easy').some((t) => t.id === 'uploads')).toBe(true);
    expect(dockFor('medium').some((t) => t.id === 'uploads')).toBe(true);
    expect(dockFor('hard').some((t) => t.id === 'uploads')).toBe(false);
    for (const id of ['waf', 'features', 'flags', 'accounts', 'sessions', 'deploy', 'backups', 'comms', 'plug'] satisfies ToolId[]) expect(dockFor('hard').map((t) => t.id)).toContain(id);
  });

  it('opens the log and the alerts on Easy, both and the terminal on Medium, the terminal first on Hard', () => {
    expect(startingTools('easy')).toEqual(['logs', 'alerts']);
    expect(startingTools('medium')).toEqual(['logs', 'alerts', 'terminal']);
    expect(startingTools('hard')).toEqual(['terminal']);
  });
});

describe('the "Now:" strip and the freeze (UI-11, SYS-22)', () => {
  it('words every playbook phase as UI-11 says', () => {
    expect(NOW_WORDS).toEqual({ watch: 'Look around', identify: 'Identify: find out who and how', contain: 'Contain', eradicate: 'Eradicate', recover: 'Recover' } satisfies Record<PlaybookPhase, string>);
  });

  it('locks change controls with the engine own refusal until the incident is declared', () => {
    const e = new Engine({ seed: 3, difficulty: 'medium', baseline: baseline() });
    expect(freezeReason(e.world)).toBeNull(); // before the shift begins nothing is frozen
    e.beginShift();
    expect(freezeReason(e.world)).toBe(FREEZE_MESSAGE);
    expect(e.act({ type: 'DEF-07' })).toEqual({ ok: false, message: freezeReason(e.world) });
    expect(e.act({ type: 'DEF-19' }).ok).toBe(true); // the escalation declares it
    expect(freezeReason(e.world)).toBeNull();
  });
});

describe('alerts by route and symptom, the gate on Easy only (D-232, D-235, D-242)', () => {
  const ROUTES = ['/', '/rest/user/login', '/rest/user/login (passwords)', '/rest/products/search', '/api/Users (sign-up)', '/api/Users', '/api/Products', '/file-upload', '/api/Feedbacks', ...TAPS.map((t) => t.closedBy.rule.path)];

  it('names the gate in one plain sentence, and never an attacker or an id', () => {
    expect(gateSentence('login')).toBe('This looks like an attack on the login gate.');
    expect(gateSentence('front door')).toBe('This looks like an attack on the front door.');
    for (const r of ROUTES) expect(gateSentence(gateOf(r))).not.toMatch(/ATK-|MIN-|TAP-|Death|minion/);
  });

  it('lights a console on the dock and an entrance on the battlefield for every gate', () => {
    const ids = TOOLS.map((t) => t.id);
    for (const r of ROUTES) {
      expect(ids).toContain(gateConsole(gateOf(r)));
      expect(['front', 'login', 'passwords', 'signup', 'search', 'admin', 'uploads']).toContain(battleGate(gateOf(r)));
    }
    expect(gateConsole('passwords')).toBe('waf');
    expect(gateConsole('uploads')).toBe('uploads');
  });
});

describe('the logs window filters by click (SYS-08)', () => {
  const line = { ip: '203.0.113.9', status: 401, target: '/rest/user/login?x=1' };
  it('passes a line through an address, a status class and a path fragment', () => {
    expect(passes(line, NO_FILTER)).toBe(true);
    expect(passes(line, { ...NO_FILTER, ip: '203.0.113.9' })).toBe(true);
    expect(passes(line, { ...NO_FILTER, ip: '203.0.113.90' })).toBe(false);
    expect(passes(line, { ...NO_FILTER, status: '4xx' })).toBe(true);
    expect(passes(line, { ...NO_FILTER, status: '5xx' })).toBe(false);
    expect(passes(line, { ...NO_FILTER, path: 'USER/login' })).toBe(true);
    expect(filterWords({ ip: '203.0.113.9', status: '4xx', path: '' }, 'curl')).toBe('ip 203.0.113.9, status 4xx, curl');
  });
});

describe('the cheat sheet is the shell registry (UI-11)', () => {
  it('lists every command, in order, with its summary, usage and first example', () => {
    const rows = cheatRows();
    expect(rows.map((r) => r.name)).toEqual([...COMMAND_NAMES]);
    for (const r of rows) {
      const c = COMMANDS[r.name as keyof typeof COMMANDS];
      expect({ ...r, example: '' }).toEqual({ name: r.name, summary: c.summary, usage: c.usage, example: '' });
      expect([...c.examples, c.usage]).toContain(r.example);
      expect(r.example, r.name).toContain(r.name);
    }
  });
});
