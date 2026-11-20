// SYS-17: the PRD tables, checked against each other. The stage-order and fast-check tests live in src/engine/.
import { describe, expect, it } from 'vitest';
import { ACTIONS, ACTION_BY_ID } from './actions';
import { MINIONS, MINION_BY_ID } from './minions';
import { MOVES, MOVE_BY_ID, type Move } from './moves';
import { FEATURE_DEFAULTS, FOOTHOLDS, type ActionId, type Gain, type Need, type Stopper } from './vocabulary';

const actionIds = new Set<string>(ACTIONS.map((a) => a.id));
const allGains = new Set<Gain>(MOVES.flatMap((m) => m.gains));
const stagesWithGains = new Set(MOVES.filter((m) => m.gains.length > 0).map((m) => m.stage));

/** True when the start state or some move can make this need hold. */
function producible(need: Need): boolean {
  if ('gain' in need) return allGains.has(need.gain);
  if ('anyOf' in need) return need.anyOf.some(producible);
  if ('anySession' in need) return allGains.has('admin-session') || allGains.has('user-session');
  if ('anyFoothold' in need) return MOVES.some((m) => m.foothold !== undefined);
  if ('anyAdmin' in need) return allGains.has('admin-session') || allGains.has('own-admin') || allGains.has('admin-password');
  if ('stageGain' in need) return stagesWithGains.has(need.stageGain);
  if ('featureOn' in need) return FEATURE_DEFAULTS[need.featureOn];
  if ('loginNotRateLimited' in need) return true; // nothing is rate-limited at the start
  return false;
}

const stopperAction = (s: Stopper): ActionId => s.action;
const preEmptive = (s: Stopper) => !('undo' in s);

describe('the PRD tables (SYS-17)', () => {
  it('has the PRD counts: 17 moves (10 must, 7 should), 20 actions (17 must, 3 should: the rows, not the summary line; KI-16), 4 minions', () => {
    expect(MOVES).toHaveLength(17);
    expect(MOVES.filter((m) => m.pri === 'M')).toHaveLength(10);
    expect(ACTIONS).toHaveLength(20);
    expect(ACTIONS.filter((a) => a.pri === 'M')).toHaveLength(17);
    expect(MINIONS).toHaveLength(4);
  });

  it('ids are unique, numbered in PRD order, and the BY_ID maps cover every row', () => {
    expect(MOVES.map((m) => m.id)).toEqual([...Array(17)].map((_, i) => `ATK-${String(i + 1).padStart(2, '0')}`));
    expect(ACTIONS.map((a) => a.id)).toEqual([...Array(20)].map((_, i) => `DEF-${String(i + 1).padStart(2, '0')}`));
    expect(MINIONS.map((m) => m.id)).toEqual(['MIN-01', 'MIN-02', 'MIN-03', 'MIN-04']);
    expect(Object.keys(MOVE_BY_ID)).toHaveLength(17);
    expect(Object.keys(ACTION_BY_ID)).toHaveLength(20);
    expect(Object.keys(MINION_BY_ID)).toHaveLength(4);
  });

  it('every ATK has at least one stopper and every stopper names a DEF that exists', () => {
    for (const m of MOVES) {
      expect(m.stoppedBy.length, m.id).toBeGreaterThan(0);
      for (const s of m.stoppedBy) expect(actionIds.has(stopperAction(s)), `${m.id} ← ${s.action}`).toBe(true);
    }
  });

  it('every move that can be pre-empted has a pre-emptive stopper; the strike moves at least an undo', () => {
    for (const m of MOVES) {
      if (m.stage === 6) expect(m.stoppedBy.length, m.id).toBeGreaterThan(0);
      else expect(m.stoppedBy.some(preEmptive), m.id).toBe(true);
    }
  });

  it('every Need is produced by some move or by the start state', () => {
    for (const m of MOVES) for (const n of m.needs) expect(producible(n), `${m.id} needs ${JSON.stringify(n)}`).toBe(true);
  });

  it('every foothold is planted by a move and has a DEF that removes it', () => {
    for (const f of FOOTHOLDS) {
      expect(MOVES.some((m) => m.foothold === f), f).toBe(true);
      expect(ACTIONS.some((a) => a.removes.includes(f)), f).toBe(true);
    }
  });

  it('every MIN has its closing DEF', () => {
    for (const mi of MINIONS) {
      expect(mi.closedBy.length, mi.id).toBeGreaterThan(0);
      for (const s of mi.closedBy) expect(actionIds.has(stopperAction(s)), `${mi.id} ← ${s.action}`).toBe(true);
    }
  });

  it('keeps D-18 and D-19: ATK-15/16 need only map and are stopped by the PUT /api/Products rule; ATK-12 needs user-session; MIN-02 hands Death a user-session', () => {
    const putProducts = { action: 'DEF-12', rule: { kind: 'block-path', method: 'PUT', path: '/api/Products' } };
    for (const id of ['ATK-15', 'ATK-16'] as const) {
      expect(MOVE_BY_ID[id].needs).toEqual([{ gain: 'map' }]);
      expect(MOVE_BY_ID[id].stage).toBe(6);
      expect(MOVE_BY_ID[id].stoppedBy).toContainEqual(putProducts);
    }
    expect(MOVE_BY_ID['ATK-12'].needs).toEqual([{ gain: 'user-session' }]);
    expect(MINION_BY_ID['MIN-02'].damage).toEqual({ heartbeat: false, soulsPerSuccess: 1, givesDeath: 'user-session' });
  });

  it('stage 1 moves need nothing Death must first gain, and every later stage needs something', () => {
    const stage1 = MOVES.filter((m) => m.stage === 1);
    expect(stage1.map((m) => m.id)).toEqual(['ATK-01', 'ATK-02']);
    expect(MOVE_BY_ID['ATK-01'].needs).toEqual([]);
    for (const m of MOVES.filter((m) => m.stage > 1)) expect(m.needs.length, m.id).toBeGreaterThan(0);
  });

  it('tip-offs, dips and durations follow the PRD: DEF-04 and DEF-08 tip Death off; DEF-13 takes 20 game minutes', () => {
    expect(ACTIONS.filter((a) => a.tipsOff).map((a) => a.id)).toEqual(['DEF-04', 'DEF-08']);
    expect(ACTION_BY_ID['DEF-13'].durationGameMs).toBe(20 * 60_000);
    expect(ACTIONS.filter((a) => a.id !== 'DEF-13').every((a) => a.durationGameMs === 0)).toBe(true);
    expect(ACTIONS.filter((a) => a.dip > 0).map((a) => a.id)).toEqual(['DEF-07', 'DEF-09', 'DEF-13', 'DEF-14', 'DEF-16']);
  });

  it('actions map to the right phase and place', () => {
    const byPhase = (p: (typeof ACTIONS)[number]['phase']) => ACTIONS.filter((a) => a.phase === p).map((a) => a.id);
    expect(byPhase('investigate')).toEqual(['DEF-01', 'DEF-02', 'DEF-03', 'DEF-04']);
    expect(byPhase('preserve')).toEqual(['DEF-05']);
    expect(byPhase('contain')).toEqual(['DEF-06', 'DEF-07', 'DEF-08', 'DEF-09', 'DEF-10', 'DEF-11']);
    expect(byPhase('eradicate')).toEqual(['DEF-12', 'DEF-13', 'DEF-14', 'DEF-15', 'DEF-16']);
    expect(byPhase('recover')).toEqual(['DEF-17', 'DEF-18']);
    expect(byPhase('communicate')).toEqual(['DEF-19', 'DEF-20']);
    expect(ACTIONS.filter((a) => a.where === 'terminal').map((a) => a.id)).toEqual(['DEF-01', 'DEF-02', 'DEF-03', 'DEF-04', 'DEF-05', 'DEF-06', 'DEF-11', 'DEF-14', 'DEF-15', 'DEF-18']);
    expect(ACTION_BY_ID['DEF-08'].where).toBe('both');
  });

  it('souls moves are the harvest stage and ransom ends the chain', () => {
    const souls: Move[] = MOVES.filter((m) => m.gains.includes('souls'));
    expect(souls.map((m) => m.id)).toEqual(['ATK-08', 'ATK-09', 'ATK-10']);
    expect(souls.every((m) => m.stage === 4)).toBe(true);
    expect(MOVE_BY_ID['ATK-17'].gains).toEqual(['ransom']);
  });
});
