// SYS-16: the playthrough sims of PRD §10, headless, seed 1, Medium, on the made-up library (test-fixtures).
// They assert only from the event log (SYS-10). SIM-2's and SIM-5's report lines wait for SYS-11.
import { describe, expect, it } from 'vitest';
import { MINION_BY_ID } from '../rules/minions';
import { MOVE_BY_ID } from '../rules/moves';
import { FOOTHOLDS, type MinionId, type MoveId, type Patch, type PlayerAction, type Stopper } from '../rules/vocabulary';
import type { GameEvent } from './log';
import { eventsOfKind } from './log';
import { libraryFrom, type RecordingLibrary } from './library';
import { runSim, type ScriptedPlayer, type SimResult } from './sim';
import { soulsStolen } from './souls';
import { committedLibrary } from './test-fixtures/committed';
import type { World } from './state';
import { FIXTURE_LIBRARY } from './test-fixtures/recordings';

const REAL_MIN = 60_000;
const sim = (player: ScriptedPlayer, maxRealMs = 20 * REAL_MIN): SimResult => runSim({ seed: 1, player, library: FIXTURE_LIBRARY, maxRealMs });
const ending = (r: SimResult) => eventsOfKind(r.world, 'ending')[0]?.ending;
const kinds = (r: SimResult) => r.events.map((e) => e.kind);

type Act = (a: PlayerAction) => void;
/** A player that reacts to each new event once, in order, `reactAfterRealMs` after it happened (nobody reads a log instantly). */
function reactor(onEvent: (e: GameEvent, w: World, act: Act) => void, reactAfterRealMs = 1000): ScriptedPlayer {
  let seen = 0;
  return (w, realElapsed) => {
    const out: PlayerAction[] = [];
    const act: Act = (a) => out.push(a);
    for (; seen < w.events.length && w.events[seen]!.t / 30 + reactAfterRealMs <= realElapsed; seen++) onEvent(w.events[seen]!, w, act);
    return out;
  };
}

/** Close a minion wave with its one correct action (PRD §4). */
function closeMinion(minion: MinionId, act: Act): void {
  for (const s of MINION_BY_ID[minion].closedBy) {
    if (s.action === 'DEF-12') act({ type: 'DEF-12', rule: s.rule });
    if (s.action === 'DEF-07') act({ type: 'DEF-07' });
    if (s.action === 'DEF-10') act({ type: 'DEF-10', feature: s.feature, enabled: true });
  }
}

/** The containment the playbook applies when a move starts: close the route it uses, fast, then the real fix. */
function contain(move: MoveId, ip: string, w: World, act: Act, options: { noLoginRateLimit?: boolean; skipPatch?: Patch } = {}): void {
  const stoppers: Stopper[] = MOVE_BY_ID[move].stoppedBy;
  for (const s of stoppers) {
    if (s.action === 'DEF-10') act({ type: 'DEF-10', feature: s.feature, enabled: s.feature === 'feedback-captcha' });
    if (s.action === 'DEF-12') act({ type: 'DEF-12', rule: s.rule });
    if (s.action === 'DEF-13' && s.patch !== options.skipPatch) act({ type: 'DEF-13', patch: s.patch });
    if (s.action === 'DEF-07' && !options.noLoginRateLimit) act({ type: 'DEF-07' });
    if (s.action === 'DEF-09') act({ type: 'DEF-09' });
    if (s.action === 'DEF-16' && s.account === 'admin') act({ type: 'DEF-16', email: 'admin@juice-sh.op' });
  }
  if (stoppers.every((s) => 'undo' in s)) act({ type: 'DEF-06', ip, op: 'add' }); // the strike moves: at least cut this variant
}

/** Recover from a defacement (DEF-17): restore the latest backup taken before the move started. */
function recover(move: MoveId, w: World, act: Act): void {
  if (w.defacements.some((d) => d.by === move) || w.bannerDefacedBy === move) {
    const started = eventsOfKind(w, 'move-started').find((e) => e.move === move)!;
    const backup = [...w.backups].reverse().find((b) => b.takenAt <= started.t)!;
    act({ type: 'DEF-17', backupId: backup.id });
  }
}

/** Eradicate what a landed move left behind (SIM-5): accounts, files, hijacks, the forged token, then recover. */
function eradicate(move: MoveId, w: World, act: Act): void {
  for (const a of w.accounts) if (a.createdBy === move) act({ type: 'DEF-14', email: a.email });
  for (const f of w.files) if (f.plantedBy === move) act({ type: 'DEF-15', path: f.path });
  for (const a of w.accounts) if (a.hijackedBy === move && a.passwordResetAt === undefined) act({ type: 'DEF-16', email: a.email });
  if (MOVE_BY_ID[move].foothold === 'forged-token') act({ type: 'DEF-13', patch: 'token-verify' });
  recover(move, w, act);
}

/** Bring a feature back once its patch has landed (the recover step of containing well). */
const FEATURE_OF_PATCH = { search: 'search', registration: 'registration' } as const;
function bringBack(e: GameEvent, act: Act): void {
  if (e.kind === 'patch-applied' && e.patch in FEATURE_OF_PATCH) act({ type: 'DEF-18', what: FEATURE_OF_PATCH[e.patch as keyof typeof FEATURE_OF_PATCH] });
}

describe('the playthrough sims (PRD §10, SYS-16)', () => {
  it('SIM-1: a player who does nothing loses every soul before the 10th real minute', () => {
    const r = sim(() => []);
    expect(ending(r)).toBe('souls-lost');
    expect(r.realMs).toBeLessThan(10 * REAL_MIN);
    expect(eventsOfKind(r.world, 'souls-stolen').some((e) => e.by.startsWith('ATK-'))).toBe(true);
  });

  it("SIM-2: blocking every IP loses souls anyway (Death switches IP) and blocks Death's IPs at least 3 times", () => {
    const r = sim(reactor((e, w, act) => {
      const ips = e.kind === 'move-started' ? [e.ip] : e.kind === 'wave-started' ? e.ips : [];
      for (const ip of ips) if (!w.firewall.blocked.includes(ip)) act({ type: 'DEF-06', ip, op: 'add' });
    }, 4000));
    const deathIps = new Set(eventsOfKind(r.world, 'move-started').map((e) => e.ip));
    const blocksOnDeath = eventsOfKind(r.world, 'action').filter((e) => e.ok && e.action.type === 'DEF-06' && deathIps.has(e.action.ip));
    expect(blocksOnDeath.length).toBeGreaterThanOrEqual(3); // SYS-11's whack-a-mole rule; the report line itself waits for SYS-11
    const cut = eventsOfKind(r.world, 'move-cut').filter((e) => e.by === 'DEF-06');
    expect(cut.length).toBeGreaterThanOrEqual(1);
    const comeback = eventsOfKind(r.world, 'move-started').filter((e) => e.move === cut[0]!.move && e.id > cut[0]!.id);
    expect(comeback.length).toBeGreaterThanOrEqual(1); // he switched IP and carried on
    expect(comeback[0]!.ip).not.toBe(eventsOfKind(r.world, 'move-started').find((e) => e.move === cut[0]!.move)!.ip);
    expect(eventsOfKind(r.world, 'souls-stolen').some((e) => e.by.startsWith('ATK-'))).toBe(true);
    expect(ending(r)).toBe('souls-lost');
  });

  it('SIM-3: pulling the plug at the first alert and leaving it flatlines', () => {
    let pulled = false;
    const r = sim(reactor((e, _w, act) => {
      if (e.kind === 'alert-opened' && !pulled) {
        pulled = true;
        act({ type: 'DEF-11' });
      }
    }));
    expect(ending(r)).toBe('flatline');
    expect(eventsOfKind(r.world, 'souls-stolen')).toEqual([]);
  });

  it('SIM-4: containing well but never looking for footholds ends in "Banished", then the return through ATK-11', () => {
    const r = sim(reactor((e, w, act) => {
      if (e.kind === 'move-started') contain(e.move, e.ip, w, act);
      if (e.kind === 'wave-started') closeMinion(e.minion, act);
      if (e.kind === 'move-landed') recover(e.move, w, act); // recovers, but never hunts for what he left behind
      bringBack(e, act);
    }));
    expect(eventsOfKind(r.world, 'move-landed').map((e) => e.move)).toContain('ATK-11');
    expect(kinds(r)).toContain('banished');
    expect(eventsOfKind(r.world, 'return')).toMatchObject([{ through: 'hidden-admin' }]);
    expect(ending(r)).toBe('return');
  });

  it('SIM-5: the playbook (snapshot, contain, find and remove footholds, patch, restore, bring back) banishes Death with no return', () => {
    let snapshotted = false;
    const r = sim(reactor((e, w, act) => {
      if (e.kind === 'alert-opened' && !snapshotted) {
        snapshotted = true;
        act({ type: 'DEF-05', name: 'initial' });
      }
      if (e.kind === 'move-started') contain(e.move, e.ip, w, act);
      if (e.kind === 'wave-started') closeMinion(e.minion, act);
      if (e.kind === 'move-landed') eradicate(e.move, w, act);
      bringBack(e, act);
      if (e.kind === 'souls-stolen' && w.comms.escalatedAt === undefined) {
        act({ type: 'DEF-19' });
        act({ type: 'DEF-20', to: 'legal' });
      }
    }));
    expect(ending(r)).toBe('banished');
    expect(eventsOfKind(r.world, 'return')).toEqual([]);
    expect(eventsOfKind(r.world, 'action').some((e) => e.action.type === 'DEF-05')).toBe(true);
    for (const f of FOOTHOLDS) expect(eventsOfKind(r.world, 'return').some((e) => e.through === f)).toBe(false);
    // grade ≥ B in every phase waits for SYS-11
  });

  it('SIM-6: ignoring minions and handling Death perfectly loses noticeable heartbeat and some souls to MIN-02 but can still win', () => {
    const r = sim(reactor((e, w, act) => {
      if (e.kind === 'move-started') contain(e.move, e.ip, w, act, { noLoginRateLimit: true });
      if (e.kind === 'move-landed') eradicate(e.move, w, act);
      bringBack(e, act);
    }));
    expect(eventsOfKind(r.world, 'souls-stolen').filter((e) => e.by === 'MIN-02').length).toBeGreaterThanOrEqual(1);
    const end = eventsOfKind(r.world, 'ending')[0]!;
    expect(end.heartbeat).toBeLessThanOrEqual(90);
    expect(end.ending).toBe('banished');
  });

  it('SIM-7: rotating the signing key but never patching token verification returns through the forged token', () => {
    const r = sim(reactor((e, w, act) => {
      if (e.kind === 'move-started') contain(e.move, e.ip, w, act, { skipPatch: 'token-verify' });
      if (e.kind === 'wave-started') closeMinion(e.minion, act);
      if (e.kind === 'move-landed') {
        if (e.move === 'ATK-14') act({ type: 'DEF-09' });
        else eradicate(e.move, w, act);
      }
      bringBack(e, act);
    }));
    expect(eventsOfKind(r.world, 'move-landed').map((e) => e.move)).toContain('ATK-14');
    expect(eventsOfKind(r.world, 'return')).toMatchObject([{ through: 'forged-token' }]);
    expect(ending(r)).toBe('return');
  });
});

describe('SIM-8: the harvest at its recorded speed (D-31)', () => {
  /** On Hard, ATK-08.c: does the player turn search off within 60 real s of the first SQLITE_ERROR in the app log? */
  function hardHarvest(library: RecordingLibrary, reactAfterRealMs: number | undefined): SimResult {
    let acted = false;
    return runSim({
      seed: 1, difficulty: 'hard', library, maxRealMs: 20 * REAL_MIN,
      player: (w, realElapsed) => {
        if (acted || reactAfterRealMs === undefined) return [];
        const first = w.logs.app.find((l) => l.text.includes('SQLITE_ERROR'));
        if (!first || realElapsed < first.t / 30 + reactAfterRealMs) return [];
        acted = true;
        return [{ type: 'DEF-10', feature: 'search', enabled: false }];
      },
    });
  }
  const kept = (r: SimResult) => 1 - soulsStolen(r.world) / r.world.souls.total;
  const harvestOnly = (library: RecordingLibrary) =>
    libraryFrom(['ATK-01', 'ATK-08'].flatMap((m) => library.variantsOf(m as 'ATK-01').map((v) => v.recording)));

  it('a Hard player who turns search off within 60 s of the first SQLITE_ERROR keeps at least 90% of souls (made-up ATK-08.c)', () => {
    const r = hardHarvest(harvestOnly(FIXTURE_LIBRARY), 60_000);
    expect(eventsOfKind(r.world, 'move-started').find((e) => e.move === 'ATK-08')?.variant).toBe('c');
    expect(eventsOfKind(r.world, 'move-cut')).toMatchObject([{ move: 'ATK-08', by: 'DEF-10' }]);
    expect(kept(r)).toBeGreaterThanOrEqual(0.9);
  });

  it('a Hard player who does not loses every soul (made-up ATK-08.c)', () => {
    const r = hardHarvest(harvestOnly(FIXTURE_LIBRARY), undefined);
    expect(ending(r)).toBe('souls-lost');
    expect(soulsStolen(r.world)).toBe(r.world.souls.total);
  });

  const real = committedLibrary();
  it.runIf(real.variantsOf('ATK-08').some((v) => v.variant === 'c') && real.variantsOf('ATK-01').length > 0)(
    'the same two outcomes on the committed ATK-01 and ATK-08.c recordings',
    () => {
      const lib = harvestOnly(real);
      expect(kept(hardHarvest(lib, 60_000))).toBeGreaterThanOrEqual(0.9);
      const idle = hardHarvest(lib, undefined);
      expect(soulsStolen(idle.world)).toBe(idle.world.souls.total);
    },
  );
});
