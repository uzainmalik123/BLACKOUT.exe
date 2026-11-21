import { describe, expect, it } from 'vitest';
import { MOVE_BY_ID } from '../rules/moves';
import { anyStopperHolds, footholds, gains, needHolds, needsHold, stopperHolds, usedAccountEmails, type VariantInfo } from './facts';
import { initialWorld, type World } from './state';

const loud: VariantInfo = { ip: '203.0.113.81', quiet: false, targets: [] };
const quiet: VariantInfo = { ip: '203.0.113.82', quiet: true, targets: [] };
const adminSession = (w: World) => w.sessions.push({ id: 1, email: 'admin@juice-sh.op', kind: 'admin', issuedBy: 'ATK-03', keyVersion: w.signingKey.version });

describe('derived gains and footholds', () => {
  it('derives own-admin from an ATK-06 account and loses it when the account is locked or gone', () => {
    const w = initialWorld(1, 'medium');
    expect(gains(w).has('own-admin')).toBe(false);
    w.accounts.push({ id: 326, email: 'death@juice-sh.op', role: 'admin', createdBy: 'ATK-06' });
    expect(gains(w).has('own-admin')).toBe(true);
    expect(usedAccountEmails(w)).toEqual(['death@juice-sh.op']);
    w.accounts.at(-1)!.lockedAt = 5;
    expect(gains(w).has('own-admin')).toBe(false);
    w.accounts.pop();
    expect(gains(w).has('own-admin')).toBe(false);
  });

  it('derives hidden-admin, planted-file and forged-token from accounts, files and the token flag; the token-verify patch removes forged-token', () => {
    const w = initialWorld(1, 'medium');
    expect(footholds(w).size).toBe(0);
    w.accounts.push({ id: 327, email: 'support-ops@juice-sh.op', role: 'admin', createdBy: 'ATK-11' });
    w.files.push({ path: 'complaints/invoice.zip', size: 10, sha256: 'a'.repeat(64), plantedBy: 'ATK-13' });
    w.death.forgedToken = true;
    expect([...footholds(w)].sort()).toEqual(['forged-token', 'hidden-admin', 'planted-file']);
    w.patches.applied.push('token-verify');
    expect(footholds(w).has('forged-token')).toBe(false);
  });

  it('derives hijacked-user from an ATK-12 account until its password is reset', () => {
    const w = initialWorld(1, 'medium');
    w.accounts[6]!.hijackedBy = 'ATK-12';
    expect(footholds(w).has('hijacked-user')).toBe(true);
    expect(gains(w).has('user-session')).toBe(true);
    w.accounts[6]!.passwordResetAt = 100;
    expect(footholds(w).has('hijacked-user')).toBe(false);
  });

  it('admin-session needs a session signed with the current key: rotating the key drops it', () => {
    const w = initialWorld(1, 'medium');
    adminSession(w);
    expect(gains(w).has('admin-session')).toBe(true);
    w.signingKey.version = 2;
    expect(gains(w).has('admin-session')).toBe(false);
  });

  it('knowledge, souls, defacements and the ransom note are gains too', () => {
    const w = initialWorld(1, 'medium');
    w.death.knowledge.push('map', 'secrets-leaked', 'admin-password');
    w.souls.stolen.push({ table: 'Users', key: 1 });
    w.defacements.push({ productId: 1, kind: 'deface', by: 'ATK-15' }, { productId: 2, kind: 'xss', by: 'ATK-16' });
    w.files.push({ path: 'READ_ME_MORTAL.txt', size: 1, sha256: 'b'.repeat(64), plantedBy: 'ATK-17' });
    expect([...gains(w)].sort()).toEqual(['admin-password', 'defaced', 'map', 'ransom', 'secrets-leaked', 'souls', 'xss-live']);
  });
});

describe('needHolds', () => {
  it('evaluates anyOf, anySession, anyFoothold, stageGain 3 (own-admin), featureOn, loginNotRateLimited', () => {
    const w = initialWorld(1, 'medium');
    expect(needHolds(w, { featureOn: 'search' })).toBe(true);
    expect(needHolds(w, { loginNotRateLimited: true })).toBe(true);
    expect(needHolds(w, { anySession: true })).toBe(false);
    expect(needHolds(w, { anyFoothold: true })).toBe(false);
    expect(needHolds(w, { stageGain: 3 })).toBe(false);
    expect(needHolds(w, { anyOf: [{ gain: 'map' }, { featureOn: 'ftp' }] })).toBe(true);
    w.waf.push({ kind: 'rate-limit', path: '/rest/user/login' });
    expect(needHolds(w, { loginNotRateLimited: true })).toBe(false);
    w.features.search = false;
    expect(needHolds(w, { featureOn: 'search' })).toBe(false);
    w.sessions.push({ id: 1, email: 'jim@juice-sh.op', kind: 'user', issuedBy: 'MIN-02', keyVersion: 1 });
    expect(needHolds(w, { anySession: true })).toBe(true);
    w.accounts.push({ id: 326, email: 'death@juice-sh.op', role: 'admin', createdBy: 'ATK-06' });
    expect(needHolds(w, { stageGain: 3 })).toBe(true);
    w.files.push({ path: 'x', size: 1, sha256: 'c'.repeat(64), plantedBy: 'ATK-13' });
    expect(needHolds(w, { anyFoothold: true })).toBe(true);
  });
});

describe('D-30: Needs and stoppers of ATK-09, ATK-11 and ATK-17', () => {
  const map = (w: World) => w.death.knowledge.push('map');

  it('ATK-09 needs a user session, an admin session or his own admin, but not a hidden admin alone', () => {
    const atk09 = MOVE_BY_ID['ATK-09'];
    const w = initialWorld(1, 'medium');
    map(w);
    expect(needsHold(w, atk09)).toBe(false);
    w.accounts.push({ id: 326, email: 'support-ops@juice-sh.op', role: 'admin', createdBy: 'ATK-11' });
    expect(needsHold(w, atk09)).toBe(false); // the hidden admin is a foothold, not a session
    w.sessions.push({ id: 1, email: 'jim@juice-sh.op', kind: 'user', issuedBy: 'MIN-02', keyVersion: 1 });
    expect(needsHold(w, atk09)).toBe(true);
    w.sessions = [];
    adminSession(w);
    expect(needsHold(w, atk09)).toBe(true);
    w.sessions = [];
    w.accounts.push({ id: 327, email: 'reaper@example.org', role: 'admin', createdBy: 'ATK-06' });
    expect(needsHold(w, atk09)).toBe(true);
  });

  it('ATK-09 is stopped by the /api/Users access-control patch (DEF-13)', () => {
    const w = initialWorld(1, 'medium');
    expect(anyStopperHolds(w, MOVE_BY_ID['ATK-09'], loud)).toBe(false);
    w.patches.applied.push('users-access');
    expect(anyStopperHolds(w, MOVE_BY_ID['ATK-09'], loud)).toBe(true);
  });

  it('ATK-11 and ATK-17 need only map', () => {
    const w = initialWorld(1, 'medium');
    expect(needsHold(w, MOVE_BY_ID['ATK-11'])).toBe(false);
    expect(needsHold(w, MOVE_BY_ID['ATK-17'])).toBe(false);
    map(w);
    expect(needsHold(w, MOVE_BY_ID['ATK-11'])).toBe(true);
    expect(needsHold(w, MOVE_BY_ID['ATK-17'])).toBe(true);
  });

  it('registration off (DEF-10) or patched (DEF-13) stops ATK-11 and ATK-06 together', () => {
    for (const close of [(w: World) => { w.features.registration = false; }, (w: World) => { w.patches.applied.push('registration'); }]) {
      const w = initialWorld(1, 'medium');
      close(w);
      expect(anyStopperHolds(w, MOVE_BY_ID['ATK-11'], loud)).toBe(true);
      expect(anyStopperHolds(w, MOVE_BY_ID['ATK-06'], loud)).toBe(true);
    }
  });

  it('uploads off (DEF-10) or a WAF rule blocking PUT /api/Products (DEF-12) stops ATK-17, even its quiet variants', () => {
    const off = initialWorld(1, 'medium');
    off.features.uploads = false;
    expect(anyStopperHolds(off, MOVE_BY_ID['ATK-17'], loud)).toBe(true);
    const waf = initialWorld(1, 'medium');
    waf.waf.push({ kind: 'block-path', method: 'PUT', path: '/api/Products' });
    expect(anyStopperHolds(waf, MOVE_BY_ID['ATK-17'], quiet)).toBe(true);
  });
});

describe('stopperHolds', () => {
  it('a sqli WAF rule stops a loud variant but not a quiet one on Medium (leaky), and stops both on Easy', () => {
    const w = initialWorld(1, 'medium');
    const sqli = { action: 'DEF-12', rule: { kind: 'sqli' } } as const;
    expect(stopperHolds(w, sqli, loud)).toBe(false);
    w.waf.push({ kind: 'sqli' });
    expect(stopperHolds(w, sqli, loud)).toBe(true);
    expect(stopperHolds(w, sqli, quiet)).toBe(false);
    const easy = initialWorld(1, 'easy');
    easy.waf.push({ kind: 'sqli' });
    expect(stopperHolds(easy, sqli, quiet)).toBe(true);
  });

  it('block-path is never leaky, and a user-agent rule matches case-insensitively', () => {
    const w = initialWorld(1, 'medium');
    w.waf.push({ kind: 'block-path', method: 'PUT', path: '/api/Products' }, { kind: 'block-user-agent', pattern: 'fuzz faster u fool' });
    expect(stopperHolds(w, { action: 'DEF-12', rule: { kind: 'block-path', method: 'PUT', path: '/api/Products' } }, quiet)).toBe(true);
    expect(stopperHolds(w, { action: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'Fuzz Faster U Fool' } }, loud)).toBe(true);
    expect(stopperHolds(w, { action: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'Fuzz Faster U Fool' } }, quiet)).toBe(false);
  });

  it('DEF-06 holds for a variant whose IP is blocked', () => {
    const w = initialWorld(1, 'medium');
    expect(stopperHolds(w, { action: 'DEF-06' }, loud)).toBe(false);
    w.firewall.blocked.push(loud.ip);
    expect(stopperHolds(w, { action: 'DEF-06' }, loud)).toBe(true);
    expect(stopperHolds(w, { action: 'DEF-06' }, quiet)).toBe(false);
  });

  it('account stoppers: DEF-08/DEF-14 on the accounts he uses, DEF-08/DEF-16 on a variant\'s targets, DEF-16 on the admin', () => {
    const w = initialWorld(1, 'medium');
    adminSession(w);
    expect(stopperHolds(w, { action: 'DEF-08', account: 'used' })).toBe(false);
    w.accounts[0]!.lockedAt = 1;
    expect(stopperHolds(w, { action: 'DEF-08', account: 'used' })).toBe(true);
    expect(stopperHolds(w, { action: 'DEF-14', account: 'used' })).toBe(false);
    w.sessions = [];
    expect(stopperHolds(w, { action: 'DEF-14', account: 'used' })).toBe(false); // he never had an account of his own
    w.death.played.push({ move: 'ATK-06', variant: 'a', outcome: 'landed' });
    expect(stopperHolds(w, { action: 'DEF-14', account: 'used' })).toBe(true); // he did, and it is gone
    w.sessions.push({ id: 901, email: 'jim@juice-sh.op', kind: 'user', issuedBy: 'MIN-02', keyVersion: w.signingKey.version });
    expect(stopperHolds(w, { action: 'DEF-14', account: 'own' })).toBe(true); // ATK-06: his registered account is gone
    expect(stopperHolds(w, { action: 'DEF-14', account: 'used' })).toBe(false); // ATK-09 (D-45): he still uses jim's account
    w.sessions.pop();
    w.accounts.push({ id: 326, email: 'death@juice-sh.op', role: 'admin', createdBy: 'ATK-06' });
    expect(stopperHolds(w, { action: 'DEF-14', account: 'used' })).toBe(false);
    w.accounts.pop();
    const jim: VariantInfo = { ...loud, targets: ['jim@juice-sh.op'] };
    expect(stopperHolds(w, { action: 'DEF-08', account: 'target' }, jim)).toBe(false);
    w.accounts[1]!.lockedAt = 2;
    expect(stopperHolds(w, { action: 'DEF-08', account: 'target' }, jim)).toBe(true);
    expect(stopperHolds(w, { action: 'DEF-16', account: 'target' }, jim)).toBe(false);
    w.accounts[1]!.passwordResetAt = 3;
    expect(stopperHolds(w, { action: 'DEF-16', account: 'target' }, jim)).toBe(true);
    expect(stopperHolds(w, { action: 'DEF-16', account: 'admin' })).toBe(false);
    w.accounts[0]!.passwordResetAt = 3;
    expect(stopperHolds(w, { action: 'DEF-16', account: 'admin' })).toBe(true);
  });

  it('DEF-07, DEF-09, DEF-10 and DEF-13 read the WAF, the key, the flags and the patches', () => {
    const w = initialWorld(1, 'medium');
    expect(stopperHolds(w, { action: 'DEF-07' })).toBe(false);
    w.waf.push({ kind: 'rate-limit', path: '/rest/user/login' });
    expect(stopperHolds(w, { action: 'DEF-07' })).toBe(true);
    adminSession(w);
    expect(stopperHolds(w, { action: 'DEF-09' })).toBe(false);
    w.signingKey.version = 2;
    expect(stopperHolds(w, { action: 'DEF-09' })).toBe(true);
    expect(stopperHolds(w, { action: 'DEF-10', feature: 'search' })).toBe(false);
    w.features.search = false;
    expect(stopperHolds(w, { action: 'DEF-10', feature: 'search' })).toBe(true);
    expect(stopperHolds(w, { action: 'DEF-13', patch: 'login' })).toBe(false);
    w.patches.applied.push('login');
    expect(stopperHolds(w, { action: 'DEF-13', patch: 'login' })).toBe(true);
  });

  it('undo stoppers (DEF-15/17/20) never pre-empt a move; anyStopperHolds checks a move\'s list', () => {
    const w = initialWorld(1, 'medium');
    expect(stopperHolds(w, { action: 'DEF-17', undo: true })).toBe(false);
    expect(anyStopperHolds(w, MOVE_BY_ID['ATK-17'])).toBe(false);
    expect(anyStopperHolds(w, MOVE_BY_ID['ATK-08'], loud)).toBe(false);
    w.features.search = false;
    expect(anyStopperHolds(w, MOVE_BY_ID['ATK-08'], loud)).toBe(true);
  });
});

describe('WAF rules against ATK-08 (D-34, on the halves: D-42)', () => {
  const sqli = { action: 'DEF-12', rule: { kind: 'sqli' } } as const;
  const ua = { action: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'sqlmap' } } as const;
  const half = (variant: string): VariantInfo => ({ ip: '203.0.113.85', quiet: false, targets: [], move: 'ATK-08', variant });
  const quietHalves = [half('d'), half('e')];
  const loudHalves = [half('f'), half('g')];
  const withRules = (difficulty: 'easy' | 'medium' | 'hard') => {
    const w = initialWorld(1, difficulty);
    w.waf.push({ kind: 'sqli' }, { kind: 'block-user-agent', pattern: 'sqlmap' });
    return w;
  };

  it('the SQLi rule set stops the quiet halves ATK-08.d/.e on Easy only; on Medium and Hard their tamper scripts leak through', () => {
    for (const q of quietHalves) {
      expect(stopperHolds(withRules('easy'), sqli, q)).toBe(true);
      expect(stopperHolds(withRules('medium'), sqli, q)).toBe(false);
      expect(stopperHolds(withRules('hard'), sqli, q)).toBe(false);
    }
  });

  it('a sqlmap user-agent rule matches only the loud halves ATK-08.f/.g, on every level', () => {
    for (const d of ['easy', 'medium', 'hard'] as const) {
      for (const q of quietHalves) expect(stopperHolds(withRules(d), ua, q), d).toBe(false);
      for (const l of loudHalves) {
        expect(stopperHolds(withRules(d), ua, l), d).toBe(true);
        expect(stopperHolds(withRules(d), sqli, l), d).toBe(true);
      }
    }
  });

  it("ATK-08's stoppers are search off, the SQLi rules, the sqlmap user-agent rule and the search patch", () => {
    expect(MOVE_BY_ID['ATK-08'].stoppedBy).toEqual([
      { action: 'DEF-10', feature: 'search' }, sqli, ua, { action: 'DEF-13', patch: 'search' },
    ]);
  });
});
