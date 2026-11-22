import { describe, expect, it } from 'vitest';
import type { PlayerAction } from '../rules/vocabulary';
import { applyAction, applyPendingPatches, takeBackupIfDue } from './actions';
import { CONFIG } from './config';
import { footholds, gains } from './facts';
import { eventsOfKind } from './log';
import { soulsStolen } from './souls';
import { initialWorld, type World } from './state';

const medium = CONFIG.medium;
const fresh = () => initialWorld(1, 'medium');
const withoutEvents = (w: World) => ({ ...w, events: [] });
const deathAdmin = (w: World) => w.accounts.push({ id: 326, email: 'death@juice-sh.op', role: 'admin', createdBy: 'ATK-06' });
const hiddenAdmin = (w: World) => w.accounts.push({ id: 327, email: 'support-ops@juice-sh.op', role: 'admin', createdBy: 'ATK-11' });

describe('applyAction: every DEF row', () => {
  it('rejects unknown targets without changing the world', () => {
    const bad: PlayerAction[] = [
      { type: 'DEF-06', ip: 'nope', op: 'add' }, { type: 'DEF-06', ip: '203.0.113.9', op: 'delete' }, { type: 'DEF-08', email: 'x@y' },
      { type: 'DEF-14', email: 'x@y' }, { type: 'DEF-15', path: 'nope.txt' }, { type: 'DEF-16', email: 'x@y' }, { type: 'DEF-17', backupId: 99 },
      { type: 'DEF-18', what: 'nginx' }, { type: 'DEF-18', what: 'search' }, { type: 'DEF-10', feature: 'search', enabled: true },
    ];
    for (const a of bad) {
      const w = fresh();
      const before = structuredClone(w);
      const r = applyAction(w, a);
      expect(r.ok, JSON.stringify(a)).toBe(false);
      expect(r.message).not.toBe('');
      expect(withoutEvents(w)).toEqual(withoutEvents(before));
      expect(eventsOfKind(w, 'action')).toMatchObject([{ action: a, ok: false }]);
    }
  });

  it('DEF-01/02/03 and a passive DEF-04 only log', () => {
    const w = fresh();
    const before = structuredClone(w);
    for (const a of [{ type: 'DEF-01', query: 'grep 203' }, { type: 'DEF-02', sql: 'SELECT 1' }, { type: 'DEF-03', path: '/srv' }, { type: 'DEF-04', ip: '203.0.113.23', mode: 'passive' }] as PlayerAction[])
      expect(applyAction(w, a).ok).toBe(true);
    expect(withoutEvents(w)).toEqual(withoutEvents(before));
    expect(eventsOfKind(w, 'action')).toHaveLength(4);
    expect(eventsOfKind(w, 'tip-off')).toHaveLength(0);
  });

  it('DEF-04 active on one of his addresses and DEF-08 tip Death off: next move now and one stage skip each', () => {
    const w = fresh();
    w.clock.gameMs = 500_000;
    w.death.nextMoveAt = 9_000_000;
    w.events.push({ id: 1, t: 1, kind: 'move-started', move: 'ATK-01', variant: 'a', stage: 1, ip: '203.0.113.23' });
    expect(applyAction(w, { type: 'DEF-04', ip: '203.0.113.23', mode: 'active' }).ok).toBe(true);
    expect(w.death).toMatchObject({ nextMoveAt: 500_000, stageSkips: 1 });
    w.death.nextMoveAt = 9_000_000;
    expect(applyAction(w, { type: 'DEF-08', email: 'jim@juice-sh.op' }).ok).toBe(true);
    expect(w.accounts[1]!.lockedAt).toBe(500_000);
    expect(w.death).toMatchObject({ nextMoveAt: 500_000, stageSkips: 2 });
    expect(eventsOfKind(w, 'tip-off').map((e) => e.by)).toEqual(['DEF-04', 'DEF-08']);
    expect(applyAction(w, { type: 'DEF-08', email: 'jim@juice-sh.op' }).ok).toBe(false);
  });

  it('DEF-04 active on any other address does nothing (D-111, KI-90): not a customer, a minion, the proxy or the internet', () => {
    const w = fresh();
    w.clock.gameMs = 500_000;
    w.death.nextMoveAt = 9_000_000;
    w.logs.access.push({ t: 1, ip: '203.0.113.150', method: 'GET', target: '/wp-admin', protocol: 'HTTP/1.1', status: 200, bytes: 1, referer: '', userAgent: 'scanner', by: 'MIN-01' });
    w.logs.access.push({ t: 2, ip: '192.0.2.7', method: 'GET', target: '/', protocol: 'HTTP/1.1', status: 200, bytes: 1, referer: '', userAgent: 'Mozilla/5.0', by: 'CUST' });
    w.waves.push({ id: 9, minion: 'MIN-01', n: 1, ips: ['203.0.113.150', '203.0.113.151'], startedAt: 0, endsAt: 1, successesDone: 0 });
    const before = structuredClone(w);
    for (const ip of ['8.8.8.8', '10.0.0.10', '192.0.2.7', '203.0.113.150', '203.0.113.151']) {
      const r = applyAction(w, { type: 'DEF-04', ip, mode: 'active' });
      expect(r.ok, ip).toBe(true);
      expect(r.message, ip).toBe(`Active lookup of ${ip}`); // the same words whether or not he noticed: the answer is never an oracle
    }
    expect(withoutEvents(w)).toEqual(withoutEvents(before));
    expect(eventsOfKind(w, 'tip-off')).toHaveLength(0);
    expect(w.death).toMatchObject({ nextMoveAt: 9_000_000, stageSkips: 0, tippedOff: false });
  });

  it("DEF-04 active tips him off on every address he has used this run: a move's start, a fresh address after an IP cut, a proxy he holds or rotated through", () => {
    const w = fresh();
    w.events.push({ id: 1, t: 1, kind: 'move-started', move: 'ATK-01', variant: 'a', stage: 1, ip: '203.0.113.23' }); // the recorded start
    w.events.push({ id: 2, t: 2, kind: 'move-started', move: 'ATK-01', variant: 'a', stage: 1, ip: '203.0.113.77' }); // resumed from a fresh address (D-24)
    w.logs.access.push({ t: 3, ip: '198.18.4.9', method: 'GET', target: '/x', protocol: 'HTTP/1.1', status: 200, bytes: 1, referer: '', userAgent: 'ffuf', by: 'ATK-01' }); // a proxy he rotated through (D-46)
    w.replays.push({ id: 5, owner: 'death', move: 'ATK-08', variant: 'd', ip: '198.19.1.1', recordedIp: '203.0.113.85', ips: ['198.19.1.1', '198.19.1.2'], startedAt: 0, cursor: 0 }); // the pool he holds now
    for (const ip of ['203.0.113.23', '203.0.113.77', '198.18.4.9', '198.19.1.1', '198.19.1.2']) {
      expect(applyAction(w, { type: 'DEF-04', ip, mode: 'active' })).toEqual({ ok: true, message: `Active lookup of ${ip}` });
    }
    expect(eventsOfKind(w, 'tip-off')).toHaveLength(5);
    expect(w.death.tippedOff).toBe(true);
  });

  it('DEF-05 snapshots the logs, never confirms a breach (D-116), and refuses a duplicate name', () => {
    const w = fresh();
    w.logs.access.push({ t: 1, ip: '203.0.113.23', method: 'GET', target: '/', protocol: 'HTTP/1.1', status: 200, bytes: 1, referer: '', userAgent: '', by: 'ATK-01' });
    expect(applyAction(w, { type: 'DEF-05', name: 'first' }).ok).toBe(true);
    expect(w.evidence).toEqual([{ name: 'first', takenAt: 0, accessLines: 1, appLines: 0 }]);
    expect(w.comms.breachConfirmedAt).toBeUndefined();
    w.souls.stolen.push({ table: 'Users', key: 1 });
    w.clock.gameMs = 77;
    expect(applyAction(w, { type: 'DEF-05', name: 'second' }).ok).toBe(true);
    expect(w.comms.breachConfirmedAt).toBeUndefined(); // D-116: a snapshot never starts the clock
    expect(applyAction(w, { type: 'DEF-05', name: 'second' }).ok).toBe(false);
  });

  it('DEF-06 blocks and unblocks an IPv4 address once', () => {
    const w = fresh();
    expect(applyAction(w, { type: 'DEF-06', ip: '203.0.113.23', op: 'add' }).ok).toBe(true);
    expect(applyAction(w, { type: 'DEF-06', ip: '203.0.113.23', op: 'add' }).ok).toBe(false);
    expect(w.firewall.blocked).toEqual(['203.0.113.23']);
    expect(applyAction(w, { type: 'DEF-06', ip: '203.0.113.23', op: 'delete' }).ok).toBe(true);
    expect(w.firewall.blocked).toEqual([]);
  });

  it('DEF-07 rate-limits the login with a small dip, once', () => {
    const w = fresh();
    expect(applyAction(w, { type: 'DEF-07' }).ok).toBe(true);
    expect(w.waf).toEqual([{ kind: 'rate-limit', path: '/rest/user/login' }]);
    expect(w.heartbeat).toBe(100 - medium.heartbeat.dip['DEF-07']!);
    expect(applyAction(w, { type: 'DEF-07' }).ok).toBe(false);
  });

  it('DEF-09 drops admin-session (ATK-07 stopped) but leaves forged-token, with a dip', () => {
    const w = fresh();
    w.sessions.push({ id: 1, email: 'admin@juice-sh.op', kind: 'admin', issuedBy: 'ATK-03', keyVersion: 1 });
    w.death.forgedToken = true;
    w.clock.gameMs = 10;
    expect(applyAction(w, { type: 'DEF-09' }).ok).toBe(true);
    expect(w.sessions).toEqual([]);
    expect(w.signingKey).toEqual({ version: 2, rotatedAt: 10 });
    expect(gains(w).has('admin-session')).toBe(false);
    expect(footholds(w).has('forged-token')).toBe(true);
    expect(w.heartbeat).toBe(100 - medium.heartbeat.dip['DEF-09']!);
  });

  it('DEF-10 flips a feature and DEF-18 brings it back to its default', () => {
    const w = fresh();
    expect(applyAction(w, { type: 'DEF-10', feature: 'search', enabled: false }).ok).toBe(true);
    expect(applyAction(w, { type: 'DEF-10', feature: 'feedback-captcha', enabled: true }).ok).toBe(true);
    expect(w.features).toMatchObject({ search: false, 'feedback-captcha': true });
    expect(applyAction(w, { type: 'DEF-18', what: 'search' }).ok).toBe(true);
    expect(w.features.search).toBe(true);
  });

  it('DEF-11 pulls the plug and DEF-18 nginx brings it back', () => {
    const w = fresh();
    expect(applyAction(w, { type: 'DEF-11' }).ok).toBe(true);
    expect(w.nginx).toBe('stopped');
    expect(applyAction(w, { type: 'DEF-11' }).ok).toBe(false);
    expect(applyAction(w, { type: 'DEF-18', what: 'nginx' }).ok).toBe(true);
    expect(w.nginx).toBe('running');
  });

  it('DEF-12 adds a WAF rule once', () => {
    const w = fresh();
    expect(applyAction(w, { type: 'DEF-12', rule: { kind: 'sqli' } }).ok).toBe(true);
    expect(applyAction(w, { type: 'DEF-12', rule: { kind: 'sqli' } }).ok).toBe(false);
    expect(applyAction(w, { type: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'sqlmap' } }).ok).toBe(true);
    expect(w.waf).toHaveLength(2);
  });

  it('DEF-13 is pending for 20 game minutes, then applied with a 3-point dip and an event', () => {
    const w = fresh();
    w.clock.gameMs = 1000;
    expect(applyAction(w, { type: 'DEF-13', patch: 'login' }).ok).toBe(true);
    expect(applyAction(w, { type: 'DEF-13', patch: 'login' }).ok).toBe(false);
    expect(w.patches.pending).toEqual([{ patch: 'login', readyAt: 1000 + medium.patchDurationGameMs }]);
    w.clock.gameMs = 1000 + medium.patchDurationGameMs - 1;
    expect(applyPendingPatches(w)).toEqual([]);
    w.clock.gameMs += 1;
    expect(applyPendingPatches(w)).toEqual(['login']);
    expect(w.patches).toEqual({ applied: ['login'], pending: [] });
    expect(w.heartbeat).toBe(100 - medium.heartbeat.dip['DEF-13']!);
    expect(eventsOfKind(w, 'patch-applied')).toMatchObject([{ patch: 'login' }]);
    expect(applyAction(w, { type: 'DEF-13', patch: 'login' }).ok).toBe(false);
  });

  it("DEF-14 on a seed account costs heartbeat; on Death's ATK-06 account removes own-admin and his sessions", () => {
    const w = fresh();
    deathAdmin(w);
    w.sessions.push({ id: 1, email: 'death@juice-sh.op', kind: 'admin', issuedBy: 'ATK-06', keyVersion: 1 });
    expect(applyAction(w, { type: 'DEF-14', email: 'death@juice-sh.op' }).ok).toBe(true);
    expect(gains(w).has('own-admin')).toBe(false);
    expect(w.sessions).toEqual([]);
    expect(w.heartbeat).toBe(100);
    const r = applyAction(w, { type: 'DEF-14', email: 'jim@juice-sh.op' });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/real/i);
    expect(w.accounts.some((a) => a.email === 'jim@juice-sh.op')).toBe(false);
    expect(w.heartbeat).toBe(100 - medium.heartbeat.dip['DEF-14']!);
  });

  it('DEF-15 removes a planted file and its foothold', () => {
    const w = fresh();
    w.files.push({ path: 'complaints/invoice.zip', size: 1, sha256: 'a'.repeat(64), plantedBy: 'ATK-13' });
    expect(footholds(w).has('planted-file')).toBe(true);
    expect(applyAction(w, { type: 'DEF-15', path: 'complaints/invoice.zip' }).ok).toBe(true);
    expect(w.files).toEqual([]);
    expect(footholds(w).has('planted-file')).toBe(false);
  });

  it('DEF-16 resets a password: ends a hijack, forgets the admin password, costs 1', () => {
    const w = fresh();
    w.death.knowledge.push('admin-password');
    w.accounts[6]!.hijackedBy = 'ATK-12';
    w.clock.gameMs = 5;
    expect(applyAction(w, { type: 'DEF-16', email: 'morty@juice-sh.op' }).ok).toBe(true);
    expect(footholds(w).has('hijacked-user')).toBe(false);
    expect(gains(w).has('admin-password')).toBe(true);
    expect(applyAction(w, { type: 'DEF-16', email: 'admin@juice-sh.op' }).ok).toBe(true);
    expect(gains(w).has('admin-password')).toBe(false);
    expect(w.accounts[0]!.passwordResetAt).toBe(5);
    expect(w.heartbeat).toBe(100 - 2 * medium.heartbeat.dip['DEF-16']!);
  });

  it('DEF-17 restore never changes souls and brings back an ATK-11 admin from a later backup', () => {
    const w = fresh();
    w.souls.stolen.push({ table: 'Users', key: 1 });
    hiddenAdmin(w);
    w.files.push({ path: 'READ_ME_MORTAL.txt', size: 1, sha256: 'b'.repeat(64), plantedBy: 'ATK-17' });
    w.sessions.push({ id: 1, email: 'support-ops@juice-sh.op', kind: 'admin', issuedBy: 'ATK-11', keyVersion: 1 });
    w.clock.gameMs = medium.backupEveryGameMs;
    takeBackupIfDue(w);
    expect(w.backups.map((b) => b.id)).toEqual([0, 1]);
    takeBackupIfDue(w);
    expect(w.backups).toHaveLength(2);
    expect(applyAction(w, { type: 'DEF-17', backupId: 0 }).ok).toBe(true);
    expect(footholds(w).has('hidden-admin')).toBe(false);
    expect(w.files).toEqual([]);
    expect(w.sessions).toEqual([]);
    expect(soulsStolen(w)).toBe(1);
    expect(applyAction(w, { type: 'DEF-17', backupId: 1 }).ok).toBe(true);
    expect(footholds(w).has('hidden-admin')).toBe(true);
    expect(gains(w).has('ransom')).toBe(true);
    expect(soulsStolen(w)).toBe(1);
  });

  it('DEF-19 escalates once and confirms a breach; DEF-20 notifies each audience once', () => {
    const w = fresh();
    w.souls.stolen.push({ table: 'Users', key: 2 });
    w.clock.gameMs = 9;
    expect(applyAction(w, { type: 'DEF-19' }).ok).toBe(true);
    expect(w.comms).toEqual({ escalatedAt: 9, notifiedAt: {}, breachConfirmedAt: 9 });
    expect(applyAction(w, { type: 'DEF-19' }).ok).toBe(false);
    expect(applyAction(w, { type: 'DEF-20', to: 'legal' }).ok).toBe(true);
    expect(applyAction(w, { type: 'DEF-20', to: 'legal' }).ok).toBe(false);
    expect(applyAction(w, { type: 'DEF-20', to: 'customers' }).ok).toBe(true);
    expect(w.comms.notifiedAt).toEqual({ legal: 9, customers: 9 });
  });

  it('refuses every action after an ending', () => {
    const w = fresh();
    w.ending = 'flatline';
    const r = applyAction(w, { type: 'DEF-07' });
    expect(r.ok).toBe(false);
    expect(w.waf).toEqual([]);
  });
});
