// DEF-21, D-233: a flag is a suspicion until a hostile request from that address, after the flag, confirms it. A
// confirmed flag declares the incident and, on a harvest address after souls were taken, confirms the breach.
import { describe, expect, it } from 'vitest';
import type { Actor } from '../rules/vocabulary';
import { applyAction } from './actions';
import { advance } from './advance';
import { attackerAddressesEver, falseLeads, flaggedMove, stepFlags } from './flags';
import { eventsOfKind } from './log';
import { CONFIG } from './config';
import { beginShift } from './shift';
import { initialWorld, type World } from './state';
import { lab } from './test-fixtures/lab';
import { FIXTURE_LIBRARY } from './test-fixtures/recordings';

const HIS = '203.0.113.9';
const COOLDOWN = CONFIG.medium.flag.cooldownRealMs * CONFIG.medium.gameMsPerRealMs; // D-239: game ms between two flags
function line(w: World, t: number, ip: string, by: Actor): void {
  w.logs.access.push({ t, ip, method: 'GET', target: '/w', protocol: 'HTTP/1.1', status: 200, bytes: 1, referer: '', userAgent: 'x', by });
  w.clock.gameMs = t;
  stepFlags(w);
}

describe('flagging an address (DEF-21)', () => {
  it('records a suspicion with its note, once per address, for a real address only; carries no verdict', () => {
    const w = lab(initialWorld(1, 'medium'));
    expect(applyAction(w, { type: 'DEF-21', ip: 'nope' }).ok).toBe(false);
    const r = applyAction(w, { type: 'DEF-21', ip: HIS, note: ' the scanner ' });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('suspicion');
    expect(w.flags).toEqual([{ ip: HIS, at: w.clock.gameMs, note: 'the scanner' }]);
    expect(applyAction(w, { type: 'DEF-21', ip: HIS }).ok).toBe(false); // already flagged
    expect(Object.keys(w.flags[0]!)).not.toContain('correct');
  });

  it('refuses a flag inside the cooldown with a plain reason and leaves the world unchanged; the next one is allowed once it passes (D-239)', () => {
    for (const level of ['easy', 'medium', 'hard'] as const) {
      const cfg = CONFIG[level];
      expect(cfg.flag.cooldownRealMs).toBe(15_000);
      const cooldownGameMs = cfg.flag.cooldownRealMs * cfg.gameMsPerRealMs;
      const w = lab(initialWorld(1, level));
      w.clock.gameMs = 1000;
      expect(applyAction(w, { type: 'DEF-21', ip: HIS }).ok).toBe(true);
      w.clock.gameMs = 1000 + cooldownGameMs - 1;
      const before = structuredClone({ ...w, events: [] }); // the refusal is logged (SYS-10), nothing else changes
      const r = applyAction(w, { type: 'DEF-21', ip: '192.0.2.4' });
      expect(r.ok).toBe(false);
      expect(r.message).toBe('Too soon: one flag every 15 s. Next flag in 1 s');
      expect({ ...w, events: [] }).toEqual(before);
      w.clock.gameMs = 1000 + cooldownGameMs;
      expect(applyAction(w, { type: 'DEF-21', ip: '192.0.2.4' }).ok).toBe(true);
      expect(w.flags.map((f) => f.ip)).toEqual([HIS, '192.0.2.4']);
    }
  });

  it('is confirmed by the next hostile line from that address after the flag: a Death move, a wave or a tap; never a customer, never an earlier line', () => {
    for (const by of ['ATK-01', 'MIN-01', 'TAP-01'] as Actor[]) {
      const w = lab(initialWorld(1, 'medium'));
      line(w, 1000, HIS, by); // before the flag: does not count
      w.clock.gameMs = 2000;
      applyAction(w, { type: 'DEF-21', ip: HIS });
      stepFlags(w);
      expect(w.flags[0]!.confirmedAt).toBeUndefined();
      line(w, 3000, '192.0.2.4', 'CUST');
      line(w, 3500, HIS, 'CUST'); // a customer on that address (never happens in play, D-65): still nothing
      expect(w.flags[0]!.confirmedAt).toBeUndefined();
      line(w, 4000, HIS, by);
      expect(w.flags[0]!.confirmedAt).toBe(4000);
      expect(eventsOfKind(w, 'flag-confirmed')).toMatchObject([{ ip: HIS, about: by, t: 4000 }]);
      line(w, 5000, HIS, by);
      expect(eventsOfKind(w, 'flag-confirmed')).toHaveLength(1); // once
    }
  });

  it('a flag is allowed during the change freeze; a confirmed flag declares the incident, a wrong one declares nothing', () => {
    const w = initialWorld(1, 'medium');
    beginShift(w);
    expect(applyAction(w, { type: 'DEF-06', ip: HIS, op: 'add' }).ok).toBe(false); // frozen
    expect(applyAction(w, { type: 'DEF-21', ip: '192.0.2.4', note: 'a hunch' }).ok).toBe(true);
    w.clock.gameMs = COOLDOWN; // D-239: the next flag waits out the cooldown
    expect(applyAction(w, { type: 'DEF-21', ip: HIS }).ok).toBe(true);
    line(w, COOLDOWN + 1000, '192.0.2.4', 'CUST');
    expect(w.incident.declaredAt).toBeUndefined(); // the hunch on a shopper declares nothing
    line(w, COOLDOWN + 2000, HIS, 'ATK-01');
    expect(w.incident).toEqual({ declaredAt: COOLDOWN + 2000, by: 'flag' });
    expect(eventsOfKind(w, 'incident-declared')).toMatchObject([{ by: 'flag' }]);
    expect(applyAction(w, { type: 'DEF-06', ip: HIS, op: 'add' }).ok).toBe(true); // the freeze is lifted
  });

  it('a confirmed flag of a harvest address after souls were taken confirms the breach (D-116 gains the flag); before any theft it does not', () => {
    const w = lab(initialWorld(1, 'medium'));
    applyAction(w, { type: 'DEF-21', ip: HIS });
    line(w, 1000, HIS, 'ATK-08');
    expect(w.comms.breachConfirmedAt).toBeUndefined(); // nothing taken yet
    const v = lab(initialWorld(1, 'medium'));
    v.souls.stolen.push({ table: 'Users', key: 1 });
    applyAction(v, { type: 'DEF-21', ip: HIS });
    line(v, 1000, HIS, 'ATK-08');
    expect(v.comms.breachConfirmedAt).toBe(1000);
    expect(eventsOfKind(v, 'breach-confirmed')).toMatchObject([{ by: 'DEF-21' }]);
    const scan = lab(initialWorld(1, 'medium'));
    scan.souls.stolen.push({ table: 'Users', key: 1 });
    applyAction(scan, { type: 'DEF-21', ip: HIS });
    line(scan, 1000, HIS, 'ATK-01'); // the scanner is not the harvest
    expect(scan.comms.breachConfirmedAt).toBeUndefined();
  });

  it('false leads are the flags on addresses that were never an attacker\'s, judged from the whole run; flaggedMove names what a confirmation was', () => {
    const w = lab(initialWorld(1, 'medium'));
    advance(w, FIXTURE_LIBRARY, 4000); // the scan has started
    const scan = eventsOfKind(w, 'move-started')[0]!;
    for (const ip of [scan.ip, '192.0.2.200', '192.0.2.201']) {
      expect(applyAction(w, { type: 'DEF-21', ip }).ok).toBe(true);
      advance(w, FIXTURE_LIBRARY, CONFIG.medium.flag.cooldownRealMs); // D-239: one flag per cooldown
    }
    expect(w.flags.find((f) => f.ip === scan.ip)!.confirmedAt).toBeDefined();
    expect(attackerAddressesEver(w).has(scan.ip)).toBe(true);
    expect(falseLeads(w)).toBe(2);
    expect(flaggedMove(w, scan.ip)).toBe('ATK-01');
    expect(flaggedMove(w, '192.0.2.200')).toBeUndefined();
  });
});
