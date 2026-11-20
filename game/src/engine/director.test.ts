import { describe, expect, it } from 'vitest';
import { MOVE_BY_ID } from '../rules/moves';
import { applyAction } from './actions';
import { advance } from './advance';
import { CONFIG } from './config';
import { checkBanishment, playableMoves, playableVariants, returnGrants } from './director';
import { footholds, gains } from './facts';
import { eventsOfKind } from './log';
import { EMPTY_LIBRARY, libraryFrom, type RecordingLibrary } from './library';
import { startReplay } from './replay';
import { initialWorld, type World } from './state';
import { FIXTURE_LIBRARY } from './test-fixtures/recordings';

const medium = CONFIG.medium;
const REAL_MIN = 60_000;
const only = (...moves: Parameters<RecordingLibrary['variantsOf']>[0][]) => libraryFrom(moves.flatMap((m) => FIXTURE_LIBRARY.variantsOf(m).map((v) => v.recording)));
const adminSession = (w: World) => w.sessions.push({ id: 900, email: 'admin@juice-sh.op', kind: 'admin', issuedBy: 'ATK-03', keyVersion: w.signingKey.version });

/** Plays one move to the end as Death (no Director involved). */
function landNow(w: World, lib: RecordingLibrary, move: Parameters<RecordingLibrary['variantsOf']>[0]): void {
  startReplay(w, lib.variantsOf(move)[0]!, 'death');
  while (w.replays.length > 0 && !w.ending) advance(w, lib, 100);
}

describe('playable moves (SYS-07)', () => {
  it('a move is playable when its Needs hold and a variant has no stopper (a blocked IP is not one)', () => {
    const w = initialWorld(1, 'medium');
    expect(playableMoves(w, FIXTURE_LIBRARY).map((m) => m.id)).toEqual(['ATK-01']);
    w.death.knowledge.push('map');
    expect(playableMoves(w, FIXTURE_LIBRARY).map((m) => m.id)).toEqual(['ATK-01', 'ATK-02', 'ATK-03', 'ATK-04', 'ATK-05', 'ATK-06', 'ATK-08', 'ATK-15', 'ATK-16']);
    for (const v of FIXTURE_LIBRARY.variantsOf('ATK-08')) w.firewall.blocked.push(v.info.ip);
    expect(playableVariants(w, FIXTURE_LIBRARY, MOVE_BY_ID['ATK-08']).map((v) => v.variant)).toEqual(['b']); // blocked IPs alone never stop him (D-24); Medium plays .b only (D-31)
    w.features.search = false;
    expect(playableVariants(w, FIXTURE_LIBRARY, MOVE_BY_ID['ATK-08'])).toEqual([]);
    w.waf.push({ kind: 'sqli' });
    expect(playableVariants(w, FIXTURE_LIBRARY, MOVE_BY_ID['ATK-03']).map((v) => v.variant)).toEqual(['c']); // the quiet one leaks through
    expect(playableMoves(w, EMPTY_LIBRARY)).toEqual([]);
  });

  it('a landed move is not playable again', () => {
    const w = initialWorld(1, 'medium');
    landNow(w, FIXTURE_LIBRARY, 'ATK-01');
    expect(gains(w).has('map')).toBe(true);
    expect(playableMoves(w, FIXTURE_LIBRARY).map((m) => m.id)).not.toContain('ATK-01');
  });
});

describe('banishment and the return (SYS-07)', () => {
  it("win when no move's Needs hold and no foothold is left", () => {
    const lib = only('ATK-01');
    const w = initialWorld(1, 'medium');
    landNow(w, lib, 'ATK-01');
    advance(w, lib, 3100);
    expect(w.ending).toBe('banished');
    expect(eventsOfKind(w, 'banished')).toHaveLength(1);
    expect(eventsOfKind(w, 'ending')).toMatchObject([{ ending: 'banished' }]);
  });

  it("leaving ATK-11's admin in place always triggers the return", () => {
    const lib = only('ATK-11');
    const w = initialWorld(1, 'medium');
    adminSession(w);
    landNow(w, lib, 'ATK-11');
    expect(footholds(w).has('hidden-admin')).toBe(true);
    advance(w, lib, 3100);
    expect(eventsOfKind(w, 'banished')).toHaveLength(1); // provisional: he goes quiet
    expect(w.ending).toBeUndefined();
    expect(w.death.quietSince).toBeDefined();
    advance(w, lib, 2 * REAL_MIN - 3100 - 100);
    expect(eventsOfKind(w, 'return')).toEqual([]);
    advance(w, lib, 3200);
    expect(eventsOfKind(w, 'return')).toMatchObject([{ through: 'hidden-admin' }]);
    expect(w.ending).toBe('return');
    expect(w.death.returnedThrough).toBe('hidden-admin');
    expect(gains(w).has('own-admin')).toBe(true); // what he came back with
    advance(w, lib, 10 * REAL_MIN);
    expect(eventsOfKind(w, 'return')).toHaveLength(1);
  });

  it('removing the foothold during the quiet period banishes him for good', () => {
    const lib = only('ATK-11');
    const w = initialWorld(1, 'medium');
    adminSession(w);
    landNow(w, lib, 'ATK-11');
    advance(w, lib, REAL_MIN);
    expect(w.death.quietSince).toBeDefined();
    expect(applyAction(w, { type: 'DEF-14', email: 'support-ops@juice-sh.op' }).ok).toBe(true);
    advance(w, lib, 3100);
    expect(w.ending).toBe('banished');
    expect(eventsOfKind(w, 'return')).toEqual([]);
  });

  it('a route reopened during the quiet period clears it: he is not quiet while he can still play', () => {
    const lib = only('ATK-01', 'ATK-02');
    const w = initialWorld(1, 'medium');
    applyAction(w, { type: 'DEF-10', feature: 'ftp', enabled: false });
    w.files.push({ path: 'complaints/x.zip', size: 1, sha256: 'a'.repeat(64), plantedBy: 'ATK-13' });
    landNow(w, lib, 'ATK-01');
    advance(w, lib, 3100);
    expect(w.death.quietSince).toBeDefined();
    applyAction(w, { type: 'DEF-18', what: 'ftp' });
    advance(w, lib, 3100);
    expect(w.death.quietSince).toBeUndefined();
  });

  it('a rotated key does not remove the forged token: the return comes through it (SIM-7 shape)', () => {
    const lib = only('ATK-14');
    const w = initialWorld(1, 'medium');
    w.death.knowledge.push('map', 'secrets-leaked');
    landNow(w, lib, 'ATK-14');
    applyAction(w, { type: 'DEF-09' });
    expect(footholds(w).has('forged-token')).toBe(true);
    advance(w, lib, 2 * REAL_MIN + 6200);
    expect(eventsOfKind(w, 'return')).toMatchObject([{ through: 'forged-token' }]);
    expect(gains(w).has('admin-session')).toBe(true);
  });

  it('returnGrants follows D-24 and checkBanishment does nothing while a move is playable', () => {
    expect(returnGrants('hidden-admin')).toBe('own-admin');
    expect(returnGrants('hijacked-user')).toBe('user-session');
    expect(returnGrants('forged-token')).toBe('admin-session');
    expect(returnGrants('planted-file')).toBe('map');
    const w = initialWorld(1, 'medium');
    checkBanishment(w, FIXTURE_LIBRARY);
    expect(w.ending).toBeUndefined();
    expect(eventsOfKind(w, 'banished')).toEqual([]);
    expect(medium.returnDelayGameMs).toBe(2 * REAL_MIN * 30);
  });
});
