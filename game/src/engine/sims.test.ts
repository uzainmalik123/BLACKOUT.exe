import { footholds } from './facts';
import { gradeEvents } from './report';
// SYS-16: the playthrough sims of PRD §10, headless, seed 1, Medium, on the made-up library (test-fixtures).
// They assert only from the event log (SYS-10); SIM-2's and SIM-5's report lines read SYS-11's grading of it.
import { describe, expect, it } from 'vitest';
import { MINION_BY_ID } from '../rules/minions';
import { MOVE_BY_ID } from '../rules/moves';
import { TAP_BY_ID } from '../rules/taps';
import { FOOTHOLDS, type Difficulty, type Feature, type MinionId, type MoveId, type Patch, type PlayerAction, type Stopper } from '../rules/vocabulary';
import type { GameEvent } from './log';
import { eventsOfKind } from './log';
import type { RecEvent } from '../recordings/format';
import { CONFIG } from './config';
import { libraryFrom, type RecordingLibrary } from './library';
import { runSim, type ScriptedPlayer, type SimResult } from './sim';
import { soulsStolen } from './souls';
import { committedLibrary } from './test-fixtures/committed';
import { stepWaves } from './minions';
import { stepReplays } from './replay';
import { initialWorld, type World } from './state';
import { FIXTURE_LIBRARY, fakeRecording } from './test-fixtures/recordings';
import { WHOLE_RUN_TIMEOUT_MS } from './test-fixtures/timeouts';

const REAL_MIN = 60_000;
const sim = (player: ScriptedPlayer, maxRealMs = 20 * REAL_MIN, seed = 1): SimResult => runSim({ seed, player, library: FIXTURE_LIBRARY, maxRealMs });
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
function contain(move: MoveId, ip: string, w: World, act: Act, options: { noLoginRateLimit?: boolean; skipPatch?: Patch; skipFeature?: Feature } = {}): void {
  const stoppers: Stopper[] = MOVE_BY_ID[move].stoppedBy;
  for (const s of stoppers) {
    if (s.action === 'DEF-10' && s.feature !== options.skipFeature) act({ type: 'DEF-10', feature: s.feature, enabled: s.feature === 'feedback-captcha' });
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
  if (w.defacements.some((d) => d.by === move)) {
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

describe('the playthrough sims (PRD §10, SYS-16)', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
  it('SIM-1: a player who does nothing loses (every soul or a flatline), never wins, and has lost at least half the souls before the 10th real minute (D-42)', () => {
    const r = sim(() => []);
    expect(['souls-lost', 'flatline']).toContain(ending(r));
    expect(kinds(r)).not.toContain('banished');
    const byTen = eventsOfKind(r.world, 'souls-stolen').filter((e) => e.t <= 10 * REAL_MIN * 30).at(-1)!.stolen;
    expect(byTen).toBeGreaterThanOrEqual(r.world.souls.total / 2);
    expect(eventsOfKind(r.world, 'souls-stolen').some((e) => e.by.startsWith('ATK-'))).toBe(true);
  });

  it("SIM-2: blocking every IP loses souls anyway (Death switches IP) and blocks Death's IPs at least 3 times", () => {
    const r = sim(reactor((e, w, act) => {
      const ips = e.kind === 'move-started' ? [e.ip] : e.kind === 'wave-started' ? e.ips : [];
      for (const ip of ips) if (!w.firewall.blocked.includes(ip)) act({ type: 'DEF-06', ip, op: 'add' });
    }, 4000));
    const deathIps = new Set(eventsOfKind(r.world, 'move-started').map((e) => e.ip));
    const blocksOnDeath = eventsOfKind(r.world, 'action').filter((e) => e.ok && e.action.type === 'DEF-06' && deathIps.has(e.action.ip));
    expect(blocksOnDeath.length).toBeGreaterThanOrEqual(3); // SYS-11's whack-a-mole rule
    expect(gradeEvents(r.events).mistakes.map((m) => m.title)).toContainEqual(expect.stringMatching(/^IP whack-a-mole/)); // the report flags it (PRD §10)
    const cut = eventsOfKind(r.world, 'move-cut').filter((e) => e.by === 'DEF-06');
    expect(cut.length).toBeGreaterThanOrEqual(1);
    const comeback = eventsOfKind(r.world, 'move-started').filter((e) => e.move === cut[0]!.move && e.id > cut[0]!.id);
    expect(comeback.length).toBeGreaterThanOrEqual(1); // he switched IP and carried on
    expect(comeback[0]!.ip).not.toBe(eventsOfKind(r.world, 'move-started').find((e) => e.move === cut[0]!.move)!.ip);
    expect(eventsOfKind(r.world, 'souls-stolen').some((e) => e.by.startsWith('ATK-'))).toBe(true);
    expect(['souls-lost', 'flatline']).toContain(ending(r)); // D-42: he keeps robbing; the shop may flatline before the last soul goes
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
    // D-30: closing or patching registration stops ATK-11 as well as ATK-06, so this player leaves registration open
    // and gets rid of ATK-06's admin by deleting it (DEF-14, one of ATK-06's stoppers) instead.
    // The seed decides whether he plants ATK-11 or takes over a customer (ATK-12) at stage 5 before the ransom; the
    // finale then ends his story moves (D-41). SIM-4 checks every seed where he plants it (KI-80: the others stall).
    const runs = [1, 2, 3, 4, 5, 6].map((seed) => sim(reactor((e, w, act) => {
      if (e.kind === 'move-started') contain(e.move, e.ip, w, act, { skipFeature: 'registration', skipPatch: 'registration' });
      if (e.kind === 'wave-started') closeMinion(e.minion, act);
      if (e.kind === 'move-landed' && e.move === 'ATK-06') for (const a of w.accounts) if (a.createdBy === 'ATK-06') act({ type: 'DEF-14', email: a.email });
      if (e.kind === 'move-landed') recover(e.move, w, act); // recovers, but never hunts for what he left behind
      bringBack(e, act);
    }), 20 * REAL_MIN, seed));
    // Runs that stall after the finale with a route he will never play (ATK-02's /ftp, never seen) are KI-80's.
    const planted = runs.filter((r) => eventsOfKind(r.world, 'move-landed').some((e) => e.move === 'ATK-11') && r.world.ending !== undefined);
    expect(planted.length).toBeGreaterThanOrEqual(2);
    for (const r of planted) {
      expect(kinds(r), `seed ${r.world.seed}`).toContain('banished');
      expect(ending(r), `seed ${r.world.seed}`).toBe('return');
      // ATK-11's admin brings him back unless a restore (the recover step) happened to wipe it with the defacement
      if (r.world.accounts.some((a) => a.createdBy === 'ATK-11')) expect(eventsOfKind(r.world, 'return'), `seed ${r.world.seed}`).toMatchObject([{ through: 'hidden-admin' }]);
    }
    expect(planted.filter((r) => eventsOfKind(r.world, 'return')[0]?.through === 'hidden-admin').length).toBeGreaterThanOrEqual(1);
  });

  it('SIM-5: the playbook (snapshot, contain, find and remove footholds, patch, restore, bring back, close every tap) banishes Death with no return', () => {
    let snapshotted = false;
    const r = sim(withTaps(reactor((e, w, act) => {
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
    })));
    expect(ending(r)).toBe('banished');
    expect(eventsOfKind(r.world, 'return')).toEqual([]);
    expect(eventsOfKind(r.world, 'action').some((e) => e.action.type === 'DEF-05')).toBe(true);
    for (const f of FOOTHOLDS) expect(eventsOfKind(r.world, 'return').some((e) => e.through === f)).toBe(false);
    const report = gradeEvents(r.events); // PRD §10: grade ≥ B in every phase (SYS-11)
    for (const phase of ['detect', 'contain', 'eradicate', 'recover'] as const) expect(['A', 'B'], `${phase}: ${JSON.stringify(report.mistakes.filter((m) => m.phase === phase).map((m) => m.title))}`).toContain(report.grades[phase]);
    expect(report.missed).toEqual([]);
  });

  it('SIM-6: ignoring minions and handling Death perfectly loses noticeable heartbeat and some souls to MIN-02 but can still win', () => {
    const r = sim(withTaps(reactor((e, w, act) => {
      if (e.kind === 'move-started') contain(e.move, e.ip, w, act, { noLoginRateLimit: true });
      if (e.kind === 'move-landed') eradicate(e.move, w, act);
      bringBack(e, act);
    })));
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

/** D-44: a win needs every tap closed, so the winning players close each one as it opens. */
function withTaps(player: ScriptedPlayer): ScriptedPlayer {
  return (w, realElapsed) => [...player(w, realElapsed), ...closingTaps(w)];
}

/**
 * D-42: the harvest sims measure the harvest, so their scripted players also close each leaky tap the moment it opens
 * (one WAF path block, as any player who reads the alert would).
 */
function closingTaps(w: World): PlayerAction[] {
  return w.taps.open.filter((t) => !w.waf.some((r) => r.kind === 'block-path' && r.path === TAP_BY_ID[t.id].closedBy.rule.path))
    .map((t) => ({ type: 'DEF-12', rule: TAP_BY_ID[t.id].closedBy.rule }));
}

describe('SIM-8: the harvest at its recorded speed (D-31, on the halves: D-42)', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
  /** On Hard, ATK-08.f: does the player turn search off within 60 real s of the first SQLITE_ERROR in the app log? */
  function hardHarvest(library: RecordingLibrary, reactAfterRealMs: number | undefined): SimResult {
    let acted = false;
    return runSim({
      seed: 1, difficulty: 'hard', library, maxRealMs: 45 * REAL_MIN, // D-42: an idle player loses the rest over many visits
      player: (w, realElapsed) => {
        const taps = closingTaps(w);
        if (acted || reactAfterRealMs === undefined) return taps;
        const first = w.logs.app.find((l) => l.text.includes('SQLITE_ERROR'));
        if (!first || realElapsed < first.t / 30 + reactAfterRealMs) return taps;
        acted = true;
        return [...taps, { type: 'DEF-10', feature: 'search', enabled: false }];
      },
    });
  }
  const kept = (r: SimResult) => 1 - soulsStolen(r.world) / r.world.souls.total;
  const harvestOnly = (library: RecordingLibrary) =>
    libraryFrom(['ATK-01', 'ATK-08'].flatMap((m) => library.variantsOf(m as 'ATK-01').map((v) => v.recording)));

  for (const [name, lib] of [['made-up', harvestOnly(FIXTURE_LIBRARY)], ['committed', harvestOnly(committedLibrary())]] as const) {
    const ready = lib.variantsOf('ATK-08').some((v) => v.variant === 'f') && lib.variantsOf('ATK-01').length > 0;
    it.runIf(ready)(`a Hard player who turns search off within 60 s of the first SQLITE_ERROR keeps at least 90% of souls, and Death never comes back to search (${name} ATK-08.f)`, () => {
      const r = hardHarvest(lib, 60_000);
      expect(eventsOfKind(r.world, 'move-started').filter((e) => e.move === 'ATK-08').map((e) => e.variant)).toEqual(['f']);
      expect(eventsOfKind(r.world, 'move-cut')).toMatchObject([{ move: 'ATK-08', by: 'DEF-10' }]);
      expect(eventsOfKind(r.world, 'door-shut')).toMatchObject([{ move: 'ATK-08', by: 'DEF-10' }]);
      expect(kept(r)).toBeGreaterThanOrEqual(0.9);
    });
    it.runIf(ready)(`a Hard player who does not loses every soul over his visits, none taking more than half of what was left (${name})`, () => {
      const r = hardHarvest(lib, undefined);
      expect(ending(r)).toBe('souls-lost');
      expect(soulsStolen(r.world)).toBe(r.world.souls.total);
      const visits = eventsOfKind(r.world, 'move-started').filter((e) => e.move === 'ATK-08');
      expect(visits.length).toBeGreaterThanOrEqual(4);
      expect(new Set(visits.map((e) => e.variant))).toEqual(new Set(['f', 'g'])); // the loud halves on Hard
    });
  }
});

describe('SYS-06 target times in a running game (D-33)', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
  const closeAllMinions: PlayerAction[] = [
    { type: 'DEF-07' }, { type: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'scanner' } },
    { type: 'DEF-12', rule: { kind: 'rate-limit', path: '/api/*' } }, { type: 'DEF-10', feature: 'feedback-captcha', enabled: true },
  ];
  const cfg = CONFIG.medium.heartbeat;
  const minutesToFlatline = (perMinute: number, start = 100) => (start / perMinute) * REAL_MIN;
  /** One Death move that keeps a door open for 40 real minutes and does nothing else. */
  const slowScan = libraryFrom([fakeRecording('ATK-01', 'a', { ip: '203.0.113.9', durationMs: 40 * REAL_MIN, events: Array.from({ length: 40 }, (_, i) => ({ t: 1 + i * REAL_MIN, kind: 'access', ip: '203.0.113.9', method: 'GET', target: `/s${i}`, protocol: 'HTTP/1.1', status: 404, bytes: 10, referer: '', userAgent: 'curl/8.0', requestTimeMs: 1 }) as RecEvent) })]);
  const once = (actions: PlayerAction[]): ScriptedPlayer => { let done = false; return () => (done ? [] : ((done = true), actions)); };

  it('a player who pulls the plug and leaves it flatlines the shop about 3 real minutes later', () => {
    const r = runSim({ seed: 1, player: once([{ type: 'DEF-11' }]), library: FIXTURE_LIBRARY, maxRealMs: 10 * REAL_MIN });
    expect(ending(r)).toBe('flatline');
    expect(r.realMs).toBeGreaterThanOrEqual(minutesToFlatline(cfg.drainPerRealMin.plug) - 1000);
    expect(r.realMs).toBeLessThanOrEqual(minutesToFlatline(cfg.drainPerRealMin.plug) + 1000);
  });

  it('one open door alone takes about half an hour to flatline the shop', () => {
    const r = runSim({ seed: 1, player: once(closeAllMinions), library: slowScan, maxRealMs: 45 * REAL_MIN });
    expect(ending(r)).toBe('flatline');
    const perMinute = cfg.drainPerRealMin.openDoor; // D-65: the CAPTCHA on costs nothing (no shopper fails it)
    expect(r.realMs).toBeGreaterThan(30 * REAL_MIN);
    expect(Math.abs(r.realMs - (3000 + minutesToFlatline(perMinute, 100 - cfg.dip['DEF-07']!)))).toBeLessThan(5000);
  });

  it('a defacement left live (with his door open) flatlines the shop in under 5 real minutes', () => {
    const r = runSim({
      seed: 1, player: once(closeAllMinions), library: slowScan, maxRealMs: 10 * REAL_MIN,
      setup: (w) => { w.defacements.push({ productId: 1, kind: 'deface', by: 'ATK-15' }); },
    });
    expect(ending(r)).toBe('flatline');
    const both = cfg.drainPerRealMin.defaced + cfg.drainPerRealMin.openDoor;
    expect(r.realMs).toBeLessThan(5 * REAL_MIN);
    expect(Math.abs(r.realMs - minutesToFlatline(both, 100 - cfg.dip['DEF-07']!))).toBeLessThan(5000);
  });
});

describe('SIM-9: WAF rules against the low-and-slow harvest (D-34, on the halves: D-42)', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
  const harvestOnly = (library: RecordingLibrary) =>
    libraryFrom(['ATK-01', 'ATK-08'].flatMap((m) => library.variantsOf(m as 'ATK-01').map((v) => v.recording)));
  /** On Medium (ATK-08.d), 20 s after the first SQLITE_ERROR the player does `actions` once; taps are closed as they open. */
  function mediumHarvest(library: RecordingLibrary, actions: PlayerAction[]): SimResult {
    let acted = false;
    return runSim({
      seed: 1, difficulty: 'medium', library, maxRealMs: 60 * REAL_MIN, // D-42: he takes half of what's left per visit
      player: (w, realElapsed) => {
        const taps = closingTaps(w);
        if (acted) return taps;
        const first = w.logs.app.find((l) => l.text.includes('SQLITE_ERROR'));
        if (!first || realElapsed < first.t / 30 + 20_000) return taps;
        acted = true;
        return [...taps, ...actions];
      },
    });
  }
  const wafOnly: PlayerAction[] = [{ type: 'DEF-12', rule: { kind: 'sqli' } }, { type: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'sqlmap' } }];
  const searchOff: PlayerAction[] = [{ type: 'DEF-10', feature: 'search', enabled: false }];
  const kept = (r: SimResult) => 1 - soulsStolen(r.world) / r.world.souls.total;

  for (const [name, lib] of [['made-up', harvestOnly(FIXTURE_LIBRARY)], ['committed', harvestOnly(committedLibrary())]] as const) {
    const ready = lib.variantsOf('ATK-08').some((v) => v.variant === 'd') && lib.variantsOf('ATK-01').length > 0;
    it.runIf(ready)(`a Medium player who only adds WAF rules loses every soul to the quiet halves over his visits (${name})`, () => {
      const r = mediumHarvest(lib, wafOnly);
      const visits = eventsOfKind(r.world, 'move-started').filter((e) => e.move === 'ATK-08');
      expect(visits[0]?.variant).toBe('d');
      expect(new Set(visits.map((e) => e.variant))).toEqual(new Set(['d', 'e']));
      expect(eventsOfKind(r.world, 'move-cut')).toEqual([]);
      expect(soulsStolen(r.world)).toBe(r.world.souls.total);
    });
    it.runIf(ready)(`one who turns search off instead keeps most of them, and Death never comes back to search (${name})`, () => {
      const r = mediumHarvest(lib, searchOff);
      expect(eventsOfKind(r.world, 'move-cut')).toMatchObject([{ move: 'ATK-08', by: 'DEF-10' }]);
      expect(eventsOfKind(r.world, 'move-started').filter((e) => e.move === 'ATK-08')).toHaveLength(1);
      expect(kept(r)).toBeGreaterThanOrEqual(0.9);
    });
  }
});

describe('D-41: pacing and fairness, in whole runs', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
  const real = committedLibrary();
  const idle = (seed: number, difficulty: Difficulty, library: RecordingLibrary = real) =>
    runSim({ seed, difficulty, library, maxRealMs: 20 * REAL_MIN, player: () => [] });
  const LEVELS: Difficulty[] = ['easy', 'medium', 'hard'];

  /** Walks the log counting running waves and Death moves; returns the most of each ever running at once. */
  function overlaps(events: GameEvent[]): { waves: number; moves: number; waveWithMove: boolean } {
    let waves = 0, moves = 0, maxWaves = 0, maxMoves = 0, waveWithMove = false;
    for (const e of events) {
      if (e.kind === 'wave-started') waves++;
      if (e.kind === 'wave-ended') waves--;
      if (e.kind === 'move-started') moves++;
      if (e.kind === 'move-landed' || e.kind === 'move-cut') moves--;
      maxWaves = Math.max(maxWaves, waves);
      maxMoves = Math.max(maxMoves, moves);
      if (waves > 0 && moves > 0) waveWithMove = true;
    }
    return { waves: maxWaves, moves: maxMoves, waveWithMove };
  }

  it('an idle run never has two minion waves at once nor two Death moves at once; Easy never runs a wave alongside a move', () => {
    for (const difficulty of LEVELS) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const o = overlaps(idle(seed, difficulty).events);
        expect(o.waves, `${difficulty} seed ${seed}`).toBe(1);
        expect(o.moves, `${difficulty} seed ${seed}`).toBe(1);
        if (difficulty === 'easy') expect(o.waveWithMove, `easy seed ${seed}`).toBe(false);
      }
    }
    expect(overlaps(idle(1, 'medium').events).waveWithMove).toBe(true); // the combo happens on Medium
  });

  it("breathers: after every move that lands or is stopped, the next one waits within the level's range", () => {
    for (const difficulty of LEVELS) {
      const { min, max } = CONFIG[difficulty].breatherGameMs;
      let checked = 0;
      for (const seed of [1, 2, 3, 4, 5]) {
        const events = idle(seed, difficulty).events;
        events.forEach((e, i) => {
          if (e.kind !== 'move-landed' && !(e.kind === 'move-cut' && e.by !== 'DEF-06')) return;
          const next = events.slice(i + 1).find((x) => x.kind === 'move-started');
          if (!next) return;
          checked++;
          expect(next.t - e.t, `${difficulty} seed ${seed}`).toBeGreaterThanOrEqual(min);
          // Easy may also wait for a wave to end (no combo); Medium/Hard only for the Director's next 3 s tick, plus at most
          // one pacing delay (D-43: 2 or more open alerts, e.g. a wave and a leaky tap, add one longest breather).
          if (difficulty !== 'easy') expect(next.t - e.t, `${difficulty} seed ${seed}`).toBeLessThanOrEqual(2 * max + CONFIG[difficulty].directorPeriodGameMs);
        });
      }
      expect(checked, difficulty).toBeGreaterThanOrEqual(10);
    }
  });

  it('after a move is cut by a stopper, his next move is a different one (a player who pulls the plug on every break-in, then plugs it back in)', () => {
    const r = sim(reactor((e, w, act) => {
      if (e.kind === 'move-started' && MOVE_BY_ID[e.move].stage >= 2 && w.nginx === 'running') act({ type: 'DEF-11' });
      if (e.kind === 'move-cut' && w.nginx === 'stopped') act({ type: 'DEF-18', what: 'nginx' });
    }, 0), 8 * REAL_MIN);
    const cuts = eventsOfKind(r.world, 'move-cut').filter((e) => e.by !== 'DEF-06');
    expect(cuts.length).toBeGreaterThanOrEqual(3);
    for (const cut of cuts) {
      const next = eventsOfKind(r.world, 'move-started').find((e) => e.id > cut.id);
      if (next) expect(next.move).not.toBe(cut.move);
    }
  });

  it('after the ransom (ATK-17) lands no move starts, though stage-5 moves are still open; stuck, he returns through a foothold left (D-46)', () => {
    const noHarvest = libraryFrom(['ATK-01', 'ATK-03', 'ATK-04', 'ATK-06', 'ATK-11', 'ATK-13', 'ATK-15', 'ATK-17', 'MIN-01', 'MIN-02']
      .flatMap((m) => real.variantsOf(m as MoveId).map((v) => v.recording)));
    for (const seed of [1, 2, 3]) {
      const r = idle(seed, 'medium', noHarvest);
      const ransom = eventsOfKind(r.world, 'move-landed').find((e) => e.move === 'ATK-17');
      expect(ransom, `seed ${seed}`).toBeDefined();
      expect(eventsOfKind(r.world, 'move-started').filter((e) => e.t > ransom!.t), `seed ${seed}`).toEqual([]);
      const end = eventsOfKind(r.world, 'ending')[0]!;
      // D-46 (KI-80): stuck after the finale, he returns through the foothold the idle player left; or the defacement
      // flatlines the shop first
      expect(['return', 'flatline'], `seed ${seed}`).toContain(end.ending);
      if (end.ending === 'return') expect(footholds(r.world).size, `seed ${seed}`).toBeGreaterThan(0);
      expect(end.t - ransom!.t).toBeGreaterThan(CONFIG.medium.stuckBreathers * CONFIG.medium.breatherGameMs.max); // at least two breathers later
    }
  });

  it('over two hours of minions alone, they take at most 5% of the souls and keep handing Death sessions past it', () => {
    const minionsOnly = libraryFrom(['MIN-01', 'MIN-02'].flatMap((m) => real.variantsOf(m as MinionId).map((v) => v.recording)));
    for (const difficulty of LEVELS) {
      const w = initialWorld(1, difficulty);
      for (let i = 0; i < (120 * REAL_MIN) / 100; i++) {
        w.clock.gameMs += CONFIG[difficulty].tickGameMs;
        stepReplays(w, minionsOnly);
        stepWaves(w, minionsOnly);
      }
      const cap = Math.floor(w.souls.total * CONFIG[difficulty].minions.soulCapFraction);
      expect(cap / w.souls.total).toBeLessThanOrEqual(0.05);
      expect(soulsStolen(w), difficulty).toBe(cap);
      expect(w.sessions.filter((s) => s.issuedBy === 'MIN-02').length, difficulty).toBeGreaterThan(cap); // sessions past the cap
    }
  });
});
