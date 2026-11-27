// The drill's coach (UI-12, D-274): its plan per step, the suspicious request on a real training run and its words,
// where it points, and where the callout goes. The pure parts, without a browser.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TRAINING_STEPS, type TutorialPanel } from '../../content/kiro-fallback';
import { Engine } from '../../engine/engine';
import { COACH_PLAN, anchorTarget, calloutAt, drillAddresses, marksFor, suspectIp, suspectLine, type Anchor, type LineKind } from './coach';
import { TOOL_BY_ID, type ToolId } from './windows';

const baseline = () => new Uint8Array(readFileSync(new URL('../../recordings/juiceshop.sqlite', import.meta.url)));
/** CON-03's spoiler list (kiro-fallback.test.ts): the coach's own words obey it too. */
const SPOILER =
  /\b(death|reaper|minions?|footholds?|backdoors?|taps?|quiet\w*|proxy|proxies|tamper\w*|return\w*|gates?|harvest\w*|soul doors?|banish\w*|sqlmap|hydra|ffuf|union|select|admin\w*)\b/i;

describe('the coach plan (D-274)', () => {
  it('has a plan for every step that says every paragraph once, in order, and ends waiting for the action', () => {
    for (const step of TRAINING_STEPS) {
      const plan = COACH_PLAN[step.id]!;
      expect(plan, step.id).toBeDefined();
      expect(plan.filter((m) => m.para !== undefined).map((m) => m.para)).toEqual(step.lines.map((_, i) => i));
      const marks = marksFor(step);
      expect(marks.map((m) => m.wait)).toEqual(marks.map((_, i) => (i === marks.length - 1 ? 'action' : 'next')));
      for (const m of marks) if (!m.line) expect(m.text.length).toBeGreaterThan(0);
    }
  });

  it('points at the suspicious request before the tool on the flag, block, password and search steps', () => {
    const lineAt = (id: string) => COACH_PLAN[id]!.findIndex((m) => m.line);
    for (const id of ['flag', 'block', 'rate-limit', 'search-off']) {
      expect(lineAt(id), id).toBeGreaterThanOrEqual(0);
      expect(lineAt(id), id).toBeLessThan(COACH_PLAN[id]!.length - 1);
    }
  });

  it('points at every panel each step names (a dock tool through the dock, or its own window)', () => {
    const PANEL: Record<TutorialPanel, ToolId | 'meters' | 'dock' | null> = {
      logs: 'logs', alerts: 'alerts', meters: 'meters', terminal: 'terminal', dock: 'dock', 'top-talkers': 'traffic', 'cheat-sheet': 'cheats',
      waf: 'waf', 'feature-flags': 'features', deploy: 'deploy', backups: 'backups', kiro: null,
    };
    for (const step of TRAINING_STEPS) {
      const anchors: Anchor[] = COACH_PLAN[step.id]!.flatMap((m) => [...m.anchors]);
      const hits = (p: TutorialPanel) => {
        const want = PANEL[p];
        if (want === null) return true;
        if (want === 'meters' || want === 'dock') return anchors.some((a) => a.at === want);
        return anchors.some((a) => (a.at === 'window' && a.tool === want) || (want === 'logs' && a.at === 'line') || (a.at === 'dock' && TOOL_BY_ID[want].group));
      };
      for (const p of step.panels) expect(hits(p), `${step.id} points at ${p}`).toBe(true);
    }
  });
});

describe('the suspicious request on a real drill (D-274, KI-234)', () => {
  it('picks a drill address line of the step kind and says why in plain words, without spoilers; the tool targets that address', () => {
    const e = new Engine({ scenario: 'training', baseline: baseline() });
    e.beginShift();
    const seen = new Map<LineKind, string>();
    for (let i = 0; i < 4 * 400 && !e.training()!.complete; i++) {
      e.advance(250);
      const w = e.world;
      const v = e.training()!;
      if (v.state !== 'teach') continue;
      const kind = COACH_PLAN[v.step.id]!.find((m) => m.line)?.line;
      if (kind && !seen.has(kind)) {
        const s = suspectLine(w, kind, kind === 'scan' ? (suspectIp(w) ?? undefined) : undefined);
        if (s) {
          expect(drillAddresses(w).has(s.line.ip)).toBe(true);
          expect(s.text).toContain(s.line.ip);
          expect(s.why).toContain(s.line.ip);
          expect(s.why, s.why).not.toMatch(SPOILER);
          if (kind === 'login') expect(s.line.status).toBe(401);
          if (kind === 'search') expect(s.line.target).toContain('/rest/products/search');
          seen.set(kind, s.why);
        }
      }
      // a diligent player, acting as the coach points
      const ip = suspectIp(w);
      if (v.step.id === 'flag' && ip && !w.flags.some((f) => f.ip === ip)) {
        expect(anchorTarget({ at: 'window', tool: 'traffic', el: ['flag:{ip}'] }, new Set(['traffic']), ip).selectors[0]).toBe(`[data-coach="win:traffic"] [data-coach="flag:${ip}"]`);
        e.act({ type: 'DEF-21', ip });
      }
      if (v.step.id === 'block' && ip) e.act({ type: 'DEF-06', ip, op: 'add' });
      if (v.step.id === 'rate-limit') e.act({ type: 'DEF-07' });
      if (v.step.id === 'search-off' && w.features.search) e.act({ type: 'DEF-10', feature: 'search', enabled: false });
      if (v.step.id === 'patch' && !w.patches.pending.length && !w.patches.applied.includes('search')) e.act({ type: 'DEF-13', patch: 'search' });
      if (v.step.id === 'evidence' && !w.evidence.length) e.act({ type: 'DEF-05', name: 'drill' });
    }
    expect(e.training()!.complete).toBe(true);
    expect([...seen.keys()].sort()).toEqual(['login', 'scan', 'search']);
  });
});

describe('where the coach points and where its callout goes', () => {
  it('a closed window is pointed at through its dock entry; an open one inside, falling back to the window', () => {
    expect(anchorTarget({ at: 'window', tool: 'waf', el: ['waf:login'] }, new Set(), null)).toEqual({ selectors: ['[data-coach="dock:waf"]'], opens: 'waf' });
    expect(anchorTarget({ at: 'window', tool: 'waf', el: ['waf:login'] }, new Set(['waf']), null).selectors).toEqual(['[data-coach="win:waf"] [data-coach="waf:login"]', '[data-coach="win:waf"]']);
    expect(anchorTarget({ at: 'window', tool: 'traffic', el: ['flag:{ip}'] }, new Set(['traffic']), null).selectors).toEqual(['[data-coach="win:traffic"]']);
    expect(anchorTarget({ at: 'line' }, new Set(), null).opens).toBe('logs');
    // the terminal as the other way to do it: outlined while open, never sent for while closed
    expect(anchorTarget({ at: 'window', tool: 'terminal', also: true, el: ['terminal-input'] }, new Set(), null)).toEqual({ selectors: [] });
    expect(anchorTarget({ at: 'center' }, new Set(), null).selectors).toEqual([]);
  });

  it('puts the callout beside the target, never over it, inside the view', () => {
    const view = { w: 1366, h: 768 };
    const box = { w: 360, h: 200 };
    const cases = [
      { x: 140, y: 100, w: 300, h: 200 }, // left: callout right of it
      { x: 1000, y: 300, w: 300, h: 100 }, // right: callout left of it
      { x: 100, y: 50, w: 1200, h: 200 }, // wide at the top: below it
      { x: 100, y: 500, w: 1200, h: 250 }, // wide at the bottom: above it
    ];
    for (const r of cases) {
      const p = calloutAt(r, box, view);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x + box.w).toBeLessThanOrEqual(view.w);
      expect(p.y + box.h).toBeLessThanOrEqual(view.h);
      const overlaps = p.x < r.x + r.w && p.x + box.w > r.x && p.y < r.y + r.h && p.y + box.h > r.y;
      expect(overlaps, JSON.stringify(r)).toBe(false);
    }
    expect(calloutAt(null, box, view)).toEqual({ x: (view.w - box.w) / 2, y: (view.h - box.h) / 2 });
  });
});
