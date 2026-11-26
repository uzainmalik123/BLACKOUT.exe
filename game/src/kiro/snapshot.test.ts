import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { renderAccessLog, renderAppLog } from '../engine/replay';
import { runSim } from '../engine/sim';
import type { World } from '../engine/state';
import { WHOLE_RUN_TIMEOUT_MS } from '../engine/test-fixtures/timeouts';
import type { PlayerAction } from '../rules/vocabulary';
import { buildSnapshot, describeAction, SNAPSHOT_ACTIONS, SNAPSHOT_LINES } from './snapshot';

const snapshotOf = (world: World) => buildSnapshot({ world, accessLog: () => renderAccessLog(world), appLog: () => renderAppLog(world) });

/** An internal id, or the words the engine uses for who did what. Nothing of this may leave the browser (D-190). */
const SPOILER_ID = /\b(ATK|MIN|TAP)-\d\d\b/;
const SPOILER_KEYS = new Set(['by', 'createdBy', 'plantedBy', 'hijackedBy', 'issuedBy', 'about', 'shownAbout', 'shownHis', 'owner', 'move', 'minion', 'variant', 'knowledge', 'assess', 'gap', 'gaps', 'grades', 'mistakes']);

function keysOf(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) keysOf(x, out);
  else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); }
  return out;
}

/** A player who reads the logs, blocks the busiest address, locks an admin and takes a snapshot: every action kind that carries player input. (On a lab run, D-230: Death from 0, no freeze.) */
const busyPlayer = (world: World, realMs: number): PlayerAction[] => {
  if (realMs === 10_000) return [{ type: 'DEF-01', query: 'tail -n 50 /var/log/nginx/access.log', shown: renderAccessLog(world).split('\n').slice(-50), shownTotal: world.logs.access.length }];
  if (realMs === 20_000) {
    const ip = world.logs.access.at(-1)?.ip;
    return ip ? [{ type: 'DEF-06', ip, op: 'add' }] : [];
  }
  if (realMs === 30_000) return [{ type: 'DEF-02', sql: 'SELECT email, role FROM Users WHERE role != "customer"', shown: ['admin@juice-sh.op|admin'], shownTotal: 1 }];
  if (realMs === 40_000) return [{ type: 'DEF-05', name: 'first' }, { type: 'DEF-10', feature: 'search', enabled: false }];
  if (realMs === 50_000) return [{ type: 'DEF-12', rule: { kind: 'sqli' } }, { type: 'DEF-13', patch: 'search' }, { type: 'DEF-19' }];
  return [];
};

describe('the Kiro snapshot (SYS-12, KIRO-07, D-190)', () => {
  it('never serialises a move, minion or tap id, nor any field saying who did what (property over seeds, levels and run lengths)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), fc.constantFrom('easy', 'medium', 'hard' as const), fc.integer({ min: 15, max: 150 }), (seed, difficulty, seconds) => {
        const { world } = runSim({ lab: true, seed, difficulty, player: busyPlayer, maxRealMs: seconds * 1000 });
        const s = snapshotOf(world);
        const json = JSON.stringify(s);
        expect(json).not.toMatch(SPOILER_ID);
        for (const k of keysOf(s)) expect(SPOILER_KEYS.has(k), `key ${k}`).toBe(false);
        expect(s.logs.access.length).toBeLessThanOrEqual(SNAPSHOT_LINES);
        expect(s.logs.app.length).toBeLessThanOrEqual(SNAPSHOT_LINES);
        expect(s.actions.length).toBeLessThanOrEqual(SNAPSHOT_ACTIONS);
        expect(s.logs.accessTotal).toBe(world.logs.access.length);
        expect(s.alerts.length).toBe(world.alerts.length);
        expect(s.accounts.length).toBe(world.accounts.length);
      }),
      { numRuns: 6 },
    );
  }, WHOLE_RUN_TIMEOUT_MS);

  it('shows the alerts as what they look like, newest first, with game-clock times and no id of what they are about', () => {
    const { world } = runSim({ lab: true, seed: 3, difficulty: 'medium', player: () => [], maxRealMs: 120_000 });
    const s = snapshotOf(world);
    expect(world.alerts.length).toBeGreaterThan(0);
    const kinds = new Set(s.alerts.map((a) => a.kind));
    for (const k of kinds) expect(['attack', 'noise', 'leak']).toContain(k);
    for (let i = 1; i < s.alerts.length; i++) expect(world.alerts.find((a) => a.id === s.alerts[i - 1]!.id)!.openedAt).toBeGreaterThanOrEqual(world.alerts.find((a) => a.id === s.alerts[i]!.id)!.openedAt);
    expect(JSON.stringify(s.alerts)).not.toMatch(SPOILER_ID);
    expect(s.alerts.every((a) => /min/.test(a.openedAt))).toBe(true);
  }, WHOLE_RUN_TIMEOUT_MS);

  it('carries the player\'s own input per action and never the judge\'s summary', () => {
    const { world } = runSim({ lab: true, seed: 1, difficulty: 'easy', player: busyPlayer, maxRealMs: 60_000 });
    const s = snapshotOf(world);
    expect(s.actions.map((a) => a.type)).toEqual(['DEF-01', 'DEF-06', 'DEF-02', 'DEF-05', 'DEF-10', 'DEF-12', 'DEF-13', 'DEF-19']);
    expect(s.actions[0]!.what).toBe('read logs: tail -n 50 /var/log/nginx/access.log');
    expect(s.actions[3]!.what).toBe('evidence snapshot first');
    expect(describeAction({ type: 'DEF-12', rule: { kind: 'block-path', method: 'GET', path: '/support/logs' } })).toContain('/support/logs');
    expect(s.firewall.blocked).toHaveLength(1);
    expect(s.features.search).toBe(false);
    expect(s.waf).toEqual([{ kind: 'sqli' }]);
    expect(s.comms.escalated).toBe(true);
    expect(s.evidence.map((e) => e.name)).toEqual(['first']);
  }, WHOLE_RUN_TIMEOUT_MS);

  it('renders the clock as the player\'s dashboard does', () => {
    const { world } = runSim({ lab: true, seed: 2, difficulty: 'hard', player: () => [], maxRealMs: 10_000 });
    const s = snapshotOf(world);
    expect(s.clock.gameMs).toBe(world.clock.gameMs);
    expect(s.clock.shown).toBe('5 min');
    expect(s.clock.wallClock).toBe('2026-10-31 22:05:00 UTC');
    expect(s.difficulty).toBe('hard');
    expect(s.souls.total).toBe(world.souls.total);
  });
});
