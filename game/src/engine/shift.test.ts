// D-118: the end of the shift. At config.shiftGameMs the judge picks clean-handover, rough-handover or walked-away;
// an idle player still loses before the shift ends on every level; the report shows the verdict first.
import { describe, expect, it } from 'vitest';
import { advance } from './advance';
import { CONFIG } from './config';
import { found } from './doors';
import { footholds } from './facts';
import { emit, eventsOfKind } from './log';
import { buildReport } from './report';
import { runSim } from './sim';
import { noShift, shiftVerdict, unfixedDoors, VERDICTS } from './shift';
import { initialWorld, type World } from './state';
import type { PlayerAction } from '../rules/vocabulary';
import { committedLibrary } from './test-fixtures/committed';
import { FIXTURE_LIBRARY } from './test-fixtures/recordings';
import { WHOLE_RUN_TIMEOUT_MS } from './test-fixtures/timeouts';

const REAL_MIN = 60 * 30_000;

/** A world where he found both soul doors (and, for the handover test, planted his stage-5 footholds). */
function gotInto(w: World, lostShare: number): void {
  for (const move of ['ATK-08', 'ATK-09', 'ATK-11', 'ATK-13'] as const) {
    emit(w, { kind: 'move-started', move, variant: 'd', stage: 4, ip: '203.0.113.85' });
    emit(w, { kind: 'move-landed', move, variant: 'd' });
    w.death.played.push({ move, variant: 'd', outcome: 'landed' });
  }
  w.death.knowledge.push('map');
  const n = Math.round(w.souls.total * lostShare);
  for (let i = 1; i <= n; i++) w.souls.stolen.push({ table: 'Users', key: i });
}

describe('the verdict at the end of the shift (D-118)', () => {
  it('clean handover: every found soul door really fixed, souls lost under a quarter, the shop alive; a foothold left does not spoil it', () => {
    const w = initialWorld(1, 'medium');
    gotInto(w, 0.1);
    w.patches.applied.push('search', 'users-access');
    w.accounts.push({ id: 327, email: 'support-ops@juice-sh.op', role: 'admin', createdBy: 'ATK-11' }); // a foothold left
    expect(unfixedDoors(w, FIXTURE_LIBRARY)).toEqual({ unfixed: [], open: [] });
    expect(shiftVerdict(w, FIXTURE_LIBRARY)).toBe('clean-handover');
  });

  it('rough handover: the shop alive, souls lost under half, a found door shut only by containment', () => {
    const w = initialWorld(1, 'medium');
    gotInto(w, 0.3);
    w.patches.applied.push('users-access');
    w.features.search = false; // shut, not fixed
    w.death.shutDoors.push('ATK-08');
    expect(unfixedDoors(w, FIXTURE_LIBRARY)).toEqual({ unfixed: ['ATK-08'], open: [] });
    expect(shiftVerdict(w, FIXTURE_LIBRARY)).toBe('rough-handover');
    w.souls.stolen = w.souls.stolen.slice(0, 10); // few souls lost, but a door unfixed: still rough
    expect(shiftVerdict(w, FIXTURE_LIBRARY)).toBe('rough-handover');
  });

  it('walked away: souls lost at half or more, or a found door open with no real fix, even an empty one (D-117)', () => {
    const w = initialWorld(1, 'medium');
    gotInto(w, VERDICTS.rough);
    w.patches.applied.push('search', 'users-access');
    expect(shiftVerdict(w, FIXTURE_LIBRARY)).toBe('walked-away');
    const v = initialWorld(1, 'medium');
    gotInto(v, 0.05);
    v.patches.applied.push('users-access'); // the search door open, unfixed
    expect(unfixedDoors(v, FIXTURE_LIBRARY)).toEqual({ unfixed: ['ATK-08'], open: ['ATK-08'] });
    expect(shiftVerdict(v, FIXTURE_LIBRARY)).toBe('walked-away');
    for (let i = 1; i <= v.souls.total; i++) if (!v.souls.stolen.some((s) => s.key === i)) v.souls.stolen.push({ table: 'Users', key: i }); // emptied, still open and unfixed
    v.souls.stolen = v.souls.stolen.slice(0, Math.floor(v.souls.total * 0.4)); // (not every soul, or the run would be souls-lost)
    expect(shiftVerdict(v, FIXTURE_LIBRARY)).toBe('walked-away');
  });

  it('the clock ends the run at the limit with the verdict as the ending; a lab sim can push the limit out; the report shows the verdict first', async () => {
    const w = initialWorld(1, 'medium');
    gotInto(w, 0.1);
    w.patches.applied.push('search', 'users-access');
    w.clock.gameMs = CONFIG.medium.shiftGameMs - CONFIG.medium.tickGameMs;
    advance(w, FIXTURE_LIBRARY, 100);
    expect(w.ending).toBe('clean-handover');
    expect(eventsOfKind(w, 'ending')[0]).toMatchObject({ ending: 'clean-handover', t: CONFIG.medium.shiftGameMs });
    const r = await buildReport(w);
    expect(r.facts[0]).toEqual({ label: 'Outcome', value: 'Clean handover' });
    expect(r.markdown.startsWith('# Post-incident report: Clean handover')).toBe(true);
    const v = initialWorld(1, 'medium');
    noShift(v);
    v.clock.gameMs = CONFIG.medium.shiftGameMs - CONFIG.medium.tickGameMs;
    advance(v, FIXTURE_LIBRARY, 100);
    expect(v.ending).toBeUndefined();
    expect(JSON.parse(JSON.stringify(v.clock))).toEqual(v.clock);
  });

  it('the shift is Easy ~20, Medium ~16, Hard ~13 real minutes', () => {
    expect([CONFIG.easy.shiftGameMs, CONFIG.medium.shiftGameMs, CONFIG.hard.shiftGameMs].map((ms) => ms / REAL_MIN)).toEqual([20, 16, 13]);
  });
});

describe('whole runs against the shift (D-118)', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
  it('a do-nothing player never wins on any level or seed (the committed recordings): every soul lost, a flatline, or walked away at the shift\'s end (D-121)', () => {
    const lib = committedLibrary();
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const r = runSim({ seed, difficulty, library: lib, maxRealMs: 25 * REAL_MIN, player: () => [] });
        const end = eventsOfKind(r.world, 'ending')[0]!;
        expect(['souls-lost', 'flatline', 'walked-away'], `${difficulty} seed ${seed}`).toContain(end.ending);
        expect(eventsOfKind(r.world, 'banished'), `${difficulty} seed ${seed}`).toEqual([]);
        expect(end.t, `${difficulty} seed ${seed}`).toBeLessThanOrEqual(CONFIG[difficulty].shiftGameMs);
      }
    }
  });

  it('a player who cuts the first dump early and patches the door earns a clean handover (D-120: a door he started a visit through counts as found, cut short or not)', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
    const runs = [1, 2, 3, 4, 5, 6].map((seed) => {
      let snap = false;
      return runSim({
        seed, library: FIXTURE_LIBRARY, maxRealMs: 20 * REAL_MIN,
        setup: (w) => { w.clock.shiftEndsAt = 7 * REAL_MIN; }, // the shift ends while his story is still going
        player: (w) => {
          const acts: PlayerAction[] = [];
          if (!snap && w.events.length > 0) { snap = true; acts.push({ type: 'DEF-05', name: 'first' }); }
          const dump = eventsOfKind(w, 'souls-stolen').find((e) => e.by === 'ATK-08'); // the first row gone: cut the dump, then fix the hole
          if (dump && w.features.search) acts.push({ type: 'DEF-10', feature: 'search', enabled: false });
          if (dump && !w.patches.applied.includes('search') && !w.patches.pending.some((p) => p.patch === 'search')) acts.push({ type: 'DEF-13', patch: 'search' });
          if (eventsOfKind(w, 'move-started').some((e) => e.move === 'ATK-09')) { // the users door too, should he reach it
            if (w.sessions.length > 0) acts.push({ type: 'DEF-09' });
            if (!w.patches.applied.includes('users-access') && !w.patches.pending.some((p) => p.patch === 'users-access')) acts.push({ type: 'DEF-13', patch: 'users-access' });
          }
          if (w.defacements.length > 0) acts.push({ type: 'DEF-17', backupId: [...w.backups].reverse().find((b) => b.takenAt <= eventsOfKind(w, 'move-started').find((e) => w.defacements.some((d) => d.by === e.move))!.t)!.id });
          for (const t of w.taps.open) acts.push({ type: 'DEF-12', rule: { kind: 'block-path', method: 'GET', path: t.id === 'TAP-01' ? '/support/logs' : t.id === 'TAP-02' ? '/rest/memories' : '/rest/products/*/reviews' } });
          return acts;
        },
      });
    });
    const cutShort = runs.filter((r) => eventsOfKind(r.world, 'move-cut').some((e) => e.move === 'ATK-08' && e.by === 'DEF-10') && !eventsOfKind(r.world, 'move-landed').some((e) => e.move === 'ATK-08'));
    expect(cutShort.length).toBeGreaterThanOrEqual(1); // on some seed the search dump starts before the shift ends, and is cut, never landed
    for (const r of cutShort) {
      expect(found(r.world, 'ATK-08'), `seed ${r.world.seed}`).toBe(true); // got into: a visit started, cut short
      expect(unfixedDoors(r.world, FIXTURE_LIBRARY), `seed ${r.world.seed}`).toEqual({ unfixed: [], open: [] });
      expect(r.world.souls.stolen.length / r.world.souls.total, `seed ${r.world.seed}`).toBeLessThan(VERDICTS.clean);
      expect(eventsOfKind(r.world, 'ending')[0]!.ending, `seed ${r.world.seed}`).toBe('clean-handover');
    }
  });

  it('fixing every door he found but leaving a foothold ends the shift as a clean handover, with the foothold in the report (the real advance() path)', async () => {
    const w = initialWorld(1, 'medium');
    gotInto(w, 0.1); // both doors got into, a tenth of the souls gone
    w.patches.applied.push('search', 'users-access'); // really fixed
    w.accounts.push({ id: 327, email: 'support-ops@juice-sh.op', role: 'admin', createdBy: 'ATK-11' }); // a hidden admin left
    w.files.push({ path: 'complaints/invoice.zip', size: 512, sha256: 'a', plantedBy: 'ATK-13' }); // and a planted file
    w.clock.gameMs = CONFIG.medium.shiftGameMs - 2 * CONFIG.medium.tickGameMs;
    advance(w, FIXTURE_LIBRARY, 300); // three ticks: the shift ends on the second
    expect(w.ending).toBe('clean-handover');
    expect(footholds(w).size).toBe(2);
    const r = await buildReport(w);
    expect(r.facts[0]).toEqual({ label: 'Outcome', value: 'Clean handover' });
    expect(r.missed).toEqual(['a hidden admin account (plant a hidden second admin)', 'a planted file in uploads/ (plant a file)']);
    expect(r.grades.eradicate).toBe('C'); // two footholds left: the report says so, the verdict does not
  });
});
