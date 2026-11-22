// SYS-11: one test per grading rule, each on a crafted event log (PRD SYS-11 "Done when"). The grader reads
// world.events and nothing else (SYS-10).
import { describe, expect, it } from 'vitest';
import type { MoveId, PlayerAction } from '../rules/vocabulary';
import { CONFIG } from './config';
import { emit, type GameEvent, type GameEventBody } from './log';
import { buildReport, fmtGameMs, gradeEvents, GRADING, OFFLINE_DEBRIEF, type Grading } from './report';
import { initialWorld } from './state';

const REAL_S = 30_000;
const REAL_MIN = 60 * REAL_S;

/** A crafted event log: `at(t)` stamps game ms, `e(body)` appends. */
function log() {
  const w = initialWorld(1, 'medium');
  const api = {
    events: w.events as GameEvent[],
    at(t: number) { w.clock.gameMs = t; return api; },
    e(body: GameEventBody) { emit(w, body); return api; },
    act(action: PlayerAction, ok = true) { emit(w, { kind: 'action', action, ok }); return api; },
    start(move: MoveId, stage: 1 | 2 | 3 | 4 | 5 | 6, ip = '203.0.113.9') { emit(w, { kind: 'move-started', move, variant: 'a', stage, ip }); return api; },
    land(move: MoveId) { emit(w, { kind: 'move-landed', move, variant: 'a' }); return api; },
    steal(by: 'ATK-08' | 'ATK-09' | 'MIN-02' | 'TAP-01', count: number, stolen: number, total = 325) { emit(w, { kind: 'souls-stolen', by, count, stolen, total }); return api; },
    end(ending: 'banished' | 'souls-lost' | 'flatline' | 'return', souls = 0, heartbeat = 50) { emit(w, { kind: 'ending', ending, souls, heartbeat }); return api; },
  };
  return api;
}
const grade = (l: ReturnType<typeof log>): Grading => gradeEvents(l.events);
const fact = (g: Grading, label: string) => g.facts.find((f) => f.label === label)?.value;
const titles = (g: Grading, phase?: Grading['mistakes'][number]['phase']) => g.mistakes.filter((m) => !phase || m.phase === phase).map((m) => m.title);

/** A tidy run, still open: every stage noticed and contained at once, evidence first, a patch for the door, notified on time. */
function openRun() {
  return log()
    .at(1 * REAL_S).start('ATK-01', 1).at(2 * REAL_S).act({ type: 'DEF-05', name: 'first' }).act({ type: 'DEF-01', query: 'grep' })
    .at(3 * REAL_S).act({ type: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'Fuzz Faster U Fool' } }).e({ kind: 'move-cut', move: 'ATK-01', variant: 'a', by: 'DEF-12' })
    .at(60 * REAL_S).start('ATK-08', 4).steal('ATK-08', 3, 3).at(61 * REAL_S).act({ type: 'DEF-19' }).act({ type: 'DEF-20', to: 'legal' }).act({ type: 'DEF-13', patch: 'search' })
    .at(62 * REAL_S).e({ kind: 'door-shut', move: 'ATK-08', by: 'DEF-13' }).e({ kind: 'patch-applied', patch: 'search' }).at(90 * REAL_S);
}
/** The tidy run, banished. */
const cleanRun = () => openRun().e({ kind: 'banished' }).end('banished', 3, 90);

describe('SYS-11: the grading rules, one by one', () => {
  it('a clean run grades A in every phase with no mistakes and nothing missed', () => {
    const g = grade(cleanRun());
    expect(g.grades).toEqual({ detect: 'A', contain: 'A', eradicate: 'A', recover: 'A' });
    expect(g.mistakes).toEqual([]);
    expect(g.missed).toEqual([]);
    expect(fact(g, 'Outcome')).toBe('Banished');
    expect(fact(g, 'Souls lost')).toBe('3 of 325 (1 %)');
  });

  it('time to notice each stage: the first look, preservation, containment or eradication after the stage\'s first move; comms and bringing back don\'t count', () => {
    const l = log()
      .at(0).start('ATK-01', 1).at(20 * REAL_S).act({ type: 'DEF-20', to: 'legal' }).act({ type: 'DEF-18', what: 'nginx' }, false).at(45 * REAL_S).act({ type: 'DEF-01', query: 'tail' })
      .at(100 * REAL_S).start('ATK-03', 2).at(100 * REAL_S + 20_000).start('ATK-04', 2).at(190 * REAL_S).act({ type: 'DEF-02', sql: 'SELECT' }) // 90 s after the stage's FIRST move
      .at(300 * REAL_S).start('ATK-06', 3).at(900 * REAL_S).end('souls-lost', 325, 40); // never noticed: the run ends 600 s later
    const g = grade(l);
    expect(fact(g, 'Time to notice stage 1')).toBe(fmtGameMs(45 * REAL_S));
    expect(fact(g, 'Time to notice stage 2')).toBe(fmtGameMs(90 * REAL_S));
    expect(fact(g, 'Time to notice stage 3')).toBe('never');
    expect(titles(g, 'detect')).toEqual([expect.stringMatching(/^Stage 3 .* was never noticed/)]);
    expect(g.grades.detect).toBe('D'); // the mean counts the unnoticed stage to the end of the run: (45 + 90 + 600) / 3 real s
    const slow = grade(log().at(0).start('ATK-01', 1).at(150 * REAL_S).act({ type: 'DEF-03', path: '/x' }).at(200 * REAL_S).end('banished'));
    expect(titles(slow, 'detect')).toEqual([`Stage 1 went unnoticed for ${fmtGameMs(150 * REAL_S)}`]);
    expect(slow.grades.detect).toBe('C'); // 2.5 real min
  });

  it('detect grades by the mean time to notice: A ≤ 1, B ≤ 2, C ≤ 4, D ≤ 8 real min, F past that', () => {
    const after = (ms: number) => grade(log().at(0).start('ATK-01', 1).at(ms).act({ type: 'DEF-01', query: 'x' }).at(ms + 1).end('banished')).grades.detect;
    expect([after(GRADING.notice.A), after(GRADING.notice.A + 1), after(GRADING.notice.B + 1), after(GRADING.notice.C + 1), after(GRADING.notice.D + 1)]).toEqual(['A', 'B', 'C', 'D', 'F']);
  });

  it('time to contain: from his first move to the first fix that held (a cut by anything but an IP block, a door shut, or banishment); never → F', () => {
    const ipOnly = log().at(10 * REAL_S).start('ATK-01', 1).at(20 * REAL_S).act({ type: 'DEF-06', ip: '203.0.113.9', op: 'add' }).e({ kind: 'move-cut', move: 'ATK-01', variant: 'a', by: 'DEF-06' })
      .at(600 * REAL_S).end('souls-lost', 325, 30);
    expect(fact(grade(ipOnly), 'Time to contain')).toBe('never');
    const cut = log().at(10 * REAL_S).start('ATK-01', 1).at(100 * REAL_S).e({ kind: 'move-cut', move: 'ATK-01', variant: 'a', by: 'DEF-12' }).at(200 * REAL_S).end('banished');
    expect(fact(grade(cut), 'Time to contain')).toBe(fmtGameMs(90 * REAL_S));
    expect(grade(cut).grades.contain).toBe('A');
    const shut = log().at(10 * REAL_S).start('ATK-08', 4).at(10 * REAL_S + GRADING.contain.B + 1).e({ kind: 'door-shut', move: 'ATK-08', by: 'DEF-10' }).at(900 * REAL_S).end('banished');
    expect(grade(shut).grades.contain).toBe('C');
    const banished = log().at(10 * REAL_S).start('ATK-01', 1).at(10 * REAL_S + GRADING.contain.D + 1).e({ kind: 'banished' }).end('banished');
    expect(grade(banished).grades.contain).toBe('F');
  });

  it('souls lost: the fact, and a grade off past a quarter, two past three quarters', () => {
    const lost = (n: number) => grade(openRun().steal('ATK-08', n, n).end('banished', n, 80));
    expect(fact(lost(81), 'Souls lost')).toBe('81 of 325 (25 %)');
    expect(lost(81).grades.contain).toBe('A');
    expect(lost(82).grades.contain).toBe('B');
    expect(lost(243).grades.contain).toBe('B'); // 74.8 %
    expect(lost(244).grades.contain).toBe('C'); // 75.1 %
  });

  it('downtime caused: the plug pulled until nginx is back (or the end), summed; over a real minute a grade, over three two', () => {
    const l = log().at(0).start('ATK-01', 1).act({ type: 'DEF-19' }).at(10 * REAL_S).act({ type: 'DEF-11' }).at(40 * REAL_S).act({ type: 'DEF-18', what: 'nginx' })
      .at(50 * REAL_S).act({ type: 'DEF-11' }).at(100 * REAL_S).e({ kind: 'banished' }).end('banished'); // 30 s + 50 s (open at the end)
    const g = grade(l);
    expect(fact(g, 'Downtime caused (plug pulled)')).toBe(fmtGameMs(80 * REAL_S));
    expect(g.grades.recover).toBe('B');
    expect(titles(g, 'recover')).toEqual([`The shop was offline for ${fmtGameMs(80 * REAL_S)} by your own hand`]);
    const long = grade(log().at(0).start('ATK-01', 1).act({ type: 'DEF-19' }).act({ type: 'DEF-11' }).at(GRADING.downtime.long + 1).e({ kind: 'banished' }).end('banished'));
    expect(long.grades.recover).toBe('C');
    expect(fact(grade(cleanRun()), 'Downtime caused (plug pulled)')).toBe('0 min');
  });

  it('evidence before eradication: a snapshot before the first eradicate-phase action, else a mistake', () => {
    const none = grade(log().at(0).start('ATK-13', 5).land('ATK-13').at(REAL_S).act({ type: 'DEF-15', path: 'complaints/x.zip' }).at(2 * REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(fact(none, 'Evidence preserved')).toBe('never');
    expect(titles(none, 'eradicate')).toEqual(['No evidence was preserved before eradication']);
    expect(none.grades.eradicate).toBe('B');
    const after = grade(log().at(0).start('ATK-13', 5).land('ATK-13').at(REAL_S).act({ type: 'DEF-15', path: 'complaints/x.zip' }).at(2 * REAL_S).act({ type: 'DEF-05', name: 'late' }).at(3 * REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(fact(after, 'Evidence preserved')).toBe(`at ${fmtGameMs(2 * REAL_S)} (after changes had begun)`);
    expect(titles(after, 'eradicate')).toEqual(['Evidence was snapshotted only after eradication had begun']);
    const before = grade(log().at(0).start('ATK-13', 5).land('ATK-13').act({ type: 'DEF-05', name: 'first' }).at(REAL_S).act({ type: 'DEF-15', path: 'complaints/x.zip' }).at(2 * REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(titles(before, 'eradicate')).toEqual([]);
    const noEradication = grade(log().at(0).start('ATK-01', 1).at(REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(titles(noEradication, 'eradicate')).toEqual([]); // nothing was changed, nothing to preserve first
  });

  it("IP whack-a-mole: 3 or more IP blocks on his addresses; blocks elsewhere don't count (SIM-2)", () => {
    const blocks = (ips: string[]) => {
      const l = log().at(0).start('ATK-01', 1, '203.0.113.10').at(REAL_S).start('ATK-01', 1, '203.0.113.77').at(2 * REAL_S).start('ATK-03', 2, '203.0.113.12');
      ips.forEach((ip, i) => l.at((3 + i) * REAL_S).act({ type: 'DEF-06', ip, op: 'add' }));
      return grade(l.at(60 * REAL_S).end('souls-lost', 325, 50));
    };
    const two = blocks(['203.0.113.10', '203.0.113.77', '192.0.2.4', '198.51.100.9']);
    expect(fact(two, "IP blocks on the attacker's addresses")).toBe('2');
    expect(titles(two, 'contain')).toEqual([]);
    const three = blocks(['203.0.113.10', '203.0.113.77', '203.0.113.12']);
    expect(titles(three, 'contain')).toEqual(['IP whack-a-mole: 3 of his addresses blocked one by one']);
    expect(three.mistakes[0]!.why).toMatch(/CISA AA20-245A/);
  });

  it('early full logout: a revoke before he held a session (or another with no new session since) is marked down; after a break-in it is not', () => {
    const early = grade(log().at(0).start('ATK-01', 1).land('ATK-01').at(REAL_S).act({ type: 'DEF-09' }).at(2 * REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(titles(early, 'contain')).toEqual([`Every session revoked at ${fmtGameMs(REAL_S)} before he held one`]);
    expect(early.grades.contain).toBe('B');
    const timely = grade(log().at(0).start('ATK-03', 2).land('ATK-03').at(REAL_S).act({ type: 'DEF-09' }).at(2 * REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(titles(timely, 'contain')).toEqual([]);
    const minion = grade(log().at(0).steal('MIN-02', 1, 1).at(REAL_S).act({ type: 'DEF-09' }).at(2 * REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(titles(minion, 'contain')).toEqual([]); // a wraith's success hands him a session too (D-18)
    const twice = grade(log().at(0).start('ATK-03', 2).land('ATK-03').at(REAL_S).act({ type: 'DEF-09' }).at(30 * REAL_S).act({ type: 'DEF-09' }).at(31 * REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(titles(twice, 'contain')).toEqual([`Every session revoked at ${fmtGameMs(30 * REAL_S)} before he held one`]);
  });

  it('pulling the plug without escalating first is marked down (DEF-19 before DEF-11 is not)', () => {
    const cold = grade(log().at(0).start('ATK-01', 1).at(REAL_S).act({ type: 'DEF-11' }).at(2 * REAL_S).act({ type: 'DEF-19' }).at(3 * REAL_S).act({ type: 'DEF-18', what: 'nginx' }).e({ kind: 'banished' }).end('banished'));
    expect(titles(cold, 'contain')).toEqual([`The plug was pulled at ${fmtGameMs(REAL_S)} without escalating first`]);
    const warm = grade(log().at(0).start('ATK-01', 1).at(REAL_S).act({ type: 'DEF-19' }).act({ type: 'DEF-11' }).at(3 * REAL_S).act({ type: 'DEF-18', what: 'nginx' }).e({ kind: 'banished' }).end('banished'));
    expect(titles(warm, 'contain')).toEqual([]);
  });

  it('notification on time (SYS-14): the clock starts at the first DEF-05 or DEF-19 after souls were taken; late past the window, missing if never, marked if before confirmation', () => {
    const window = CONFIG.medium.notification.windowGameMs;
    const base = () => log().at(0).start('ATK-08', 4).steal('ATK-08', 5, 5).at(REAL_S).act({ type: 'DEF-19' });
    const onTime = grade(base().at(REAL_S + window).act({ type: 'DEF-20', to: 'legal' }).at(REAL_S + window + 1).end('banished', 5));
    expect(fact(onTime, 'Breach notification')).toBe(`on time, at ${fmtGameMs(REAL_S + window)}`);
    expect(titles(onTime, 'recover')).toEqual([]);
    const late = grade(base().at(REAL_S + window + REAL_MIN).act({ type: 'DEF-20', to: 'legal' }).end('banished', 5));
    expect(fact(late, 'Breach notification')).toBe(`late: ${fmtGameMs(window + REAL_MIN)} after confirmation (window ${fmtGameMs(window)})`);
    expect(titles(late, 'recover')).toEqual([expect.stringMatching(/^Legal was notified .* after the breach was confirmed$/)]);
    expect(late.mistakes.find((m) => m.title.startsWith('Legal was notified'))!.why).toMatch(/GDPR Art\. 33/);
    const missing = grade(base().at(10 * REAL_MIN).end('souls-lost', 325, 50));
    expect(fact(missing, 'Breach notification')).toBe(`missing (breach confirmed at ${fmtGameMs(REAL_S)})`);
    expect(titles(missing, 'recover')).toEqual(['The breach was never notified']);
    const unconfirmed = grade(log().at(0).start('ATK-08', 4).steal('ATK-08', 5, 5).at(10 * REAL_MIN).end('souls-lost', 325, 50));
    expect(fact(unconfirmed, 'Breach notification')).toBe('missing (the breach was never confirmed)');
    const rumour = grade(log().at(0).start('ATK-01', 1).at(REAL_S).act({ type: 'DEF-20', to: 'customers' }).at(2 * REAL_S).steal('ATK-08', 1, 1).at(3 * REAL_S).act({ type: 'DEF-05', name: 'x' }).act({ type: 'DEF-20', to: 'legal' }).end('banished', 1));
    expect(titles(rumour, 'recover')).toEqual(['Notified customers before the breach was confirmed']);
    const noTheft = grade(log().at(0).start('ATK-01', 1).at(REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(fact(noTheft, 'Breach notification')).toBe('not needed: no data was taken');
    // DEF-05 confirms too, and a snapshot taken before the theft does not
    const snap = grade(log().at(0).act({ type: 'DEF-05', name: 'early' }).at(REAL_S).start('ATK-08', 4).steal('ATK-08', 5, 5).at(2 * REAL_S).act({ type: 'DEF-05', name: 'after' }).at(3 * REAL_S).act({ type: 'DEF-20', to: 'legal' }).end('banished', 5));
    expect(titles(snap, 'recover')).toEqual([]);
    expect(fact(snap, 'Breach notification')).toBe(`on time, at ${fmtGameMs(3 * REAL_S)}`);
  });

  it('customers lost (churn): the count, and more than 10 is marked down', () => {
    const churn = (n: number) => { const l = cleanRun(); for (let i = 0; i < n; i++) l.e({ kind: 'customer-lost', about: 'search', max: 100 - i - 1 }); return grade(l); };
    expect(fact(churn(10), 'Customers lost for good')).toBe('10');
    expect(titles(churn(10), 'recover')).toEqual([]);
    expect(titles(churn(11), 'recover')).toEqual(['11 customers gave up and left']);
    expect(churn(11).grades.recover).toBe('B');
  });

  it('open taps at the end: listed as a fact, each run with one still dripping is marked down', () => {
    const l = cleanRun().e({ kind: 'tap-opened', tap: 'TAP-01' }).e({ kind: 'tap-opened', tap: 'TAP-02' }).e({ kind: 'tap-closed', tap: 'TAP-02', by: 'DEF-12' }).e({ kind: 'tap-opened', tap: 'TAP-03' }).e({ kind: 'tap-closed', tap: 'TAP-03' });
    const g = grade(l);
    expect(fact(g, 'Leaky taps still open at the end')).toBe('open logs');
    expect(titles(g, 'recover')).toEqual(['Still leaking at the end: open logs']);
    expect(g.mistakes.at(-1)!.why).toMatch(/OWASP/);
    expect(fact(grade(cleanRun()), 'Leaky taps still open at the end')).toBe('none');
  });

  it('missed footholds: a foothold he planted with no removal after it (unless banished); the return names its foothold and fails eradication', () => {
    const planted = (then: (l: ReturnType<typeof log>) => ReturnType<typeof log>) => grade(then(log().at(0).act({ type: 'DEF-05', name: 'x' }).at(REAL_S).start('ATK-11', 5).land('ATK-11').start('ATK-13', 5).land('ATK-13')));
    const left = planted((l) => l.at(10 * REAL_MIN).end('flatline', 0, 0));
    expect(left.missed).toEqual(['a hidden admin account (plant a hidden second admin)', 'a planted file in uploads/ (plant a file)']);
    expect(left.grades.eradicate).toBe('C');
    const removed = planted((l) => l.at(2 * REAL_S).act({ type: 'DEF-14', email: 'support-ops@juice-sh.op' }).act({ type: 'DEF-15', path: 'complaints/x.zip' }).at(10 * REAL_MIN).end('flatline', 0, 0));
    expect(removed.missed).toEqual([]);
    const restored = planted((l) => l.at(2 * REAL_S).act({ type: 'DEF-17', backupId: 0 }).at(10 * REAL_MIN).end('flatline', 0, 0));
    expect(restored.missed).toEqual([]); // a restore removes both (rules/actions.ts)
    const banished = planted((l) => l.at(10 * REAL_MIN).e({ kind: 'banished' }).end('banished'));
    expect(banished.missed).toEqual([]); // the engine only banishes with no foothold left
    const back = planted((l) => l.at(2 * REAL_S).act({ type: 'DEF-15', path: 'complaints/x.zip' }).at(10 * REAL_MIN).e({ kind: 'return', through: 'hidden-admin' }).end('return', 0, 60));
    expect(back.missed).toEqual(['a hidden admin account (plant a hidden second admin): he came back through it']);
    expect(back.grades.eradicate).toBe('F');
    const token = grade(log().at(0).act({ type: 'DEF-05', name: 'x' }).at(REAL_S).start('ATK-14', 5).land('ATK-14').at(2 * REAL_S).act({ type: 'DEF-13', patch: 'login' }).at(10 * REAL_MIN).end('flatline', 0, 0));
    expect(token.missed).toEqual(['a forged login token (token verification never patched) (forge his own login token)']); // only the token-verify patch removes it
  });

  it('symptom-only fixes: a soul door he opened whose patch never landed is marked down', () => {
    const waf = grade(log().at(0).act({ type: 'DEF-05', name: 'x' }).at(REAL_S).start('ATK-08', 4).at(2 * REAL_S).act({ type: 'DEF-12', rule: { kind: 'sqli' } }).e({ kind: 'move-cut', move: 'ATK-08', variant: 'a', by: 'DEF-12' }).at(10 * REAL_MIN).end('flatline', 0, 0));
    expect(titles(waf, 'eradicate')).toEqual(['The hole behind "dump customers through search" was never patched']);
    expect(waf.grades.eradicate).toBe('B');
    expect(titles(grade(cleanRun()), 'eradicate')).toEqual([]); // the search patch landed
  });

  it('a feature left off after its patch is live is marked down; one with no patch (uploads, /ftp, password reset) never is', () => {
    const base = () => log().at(0).act({ type: 'DEF-05', name: 'x' }).start('ATK-08', 4).at(REAL_S).act({ type: 'DEF-10', feature: 'search', enabled: false }).act({ type: 'DEF-13', patch: 'search' }).at(2 * REAL_S).e({ kind: 'patch-applied', patch: 'search' });
    const leftOff = grade(base().at(3 * REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(titles(leftOff, 'recover')).toEqual(['search left off after the patch was live']);
    const back = grade(base().at(3 * REAL_S).act({ type: 'DEF-18', what: 'search' }).e({ kind: 'banished' }).end('banished'));
    expect(titles(back, 'recover')).toEqual([]);
    const uploads = grade(log().at(0).act({ type: 'DEF-05', name: 'x' }).start('ATK-13', 5).at(REAL_S).act({ type: 'DEF-10', feature: 'uploads', enabled: false }).at(3 * REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(titles(uploads, 'recover')).toEqual([]);
  });

  it('a defacement never restored is marked down; a restore after the last one is not', () => {
    const base = () => log().at(0).act({ type: 'DEF-05', name: 'x' }).start('ATK-15', 6).land('ATK-15');
    expect(titles(grade(base().at(10 * REAL_MIN).end('flatline', 0, 0)), 'recover')).toEqual(['The defaced shop was never restored']);
    expect(titles(grade(base().at(REAL_S).act({ type: 'DEF-17', backupId: 0 }).at(10 * REAL_MIN).end('flatline', 0, 0)), 'recover')).toEqual([]);
    const ransom = grade(log().at(0).act({ type: 'DEF-05', name: 'x' }).start('ATK-17', 6).land('ATK-17').at(10 * REAL_MIN).end('flatline', 0, 0));
    expect(titles(ransom, 'recover')).toEqual(['The defaced shop was never restored']); // the renamed first product (D-40)
  });

  it('the ending fails the phase that lost it: every soul → contain, flatline → recover, the return → eradicate', () => {
    expect(grade(openRun().end('souls-lost', 325, 50)).grades.contain).toBe('F');
    expect(grade(openRun().end('flatline', 3, 0)).grades.recover).toBe('F');
    expect(grade(openRun().e({ kind: 'return', through: 'planted-file' }).end('return', 3, 50)).grades.eradicate).toBe('F');
  });

  it('a letter per mistake: A with none, B, C, D, then F', () => {
    const l = cleanRun();
    for (let i = 0; i < 11; i++) l.e({ kind: 'customer-lost', about: 'search', max: 99 - i }); // 1 point on recover
    expect(grade(l).grades.recover).toBe('B');
    l.e({ kind: 'tap-opened', tap: 'TAP-01' }); // 2
    expect(grade(l).grades.recover).toBe('C');
    const g3 = gradeEvents([...l.events.filter((e) => !(e.kind === 'action' && e.action.type === 'DEF-20'))]); // 3: never notified
    expect(g3.grades.recover).toBe('D');
    const l4 = log().at(0).start('ATK-15', 6).land('ATK-15').act({ type: 'DEF-11' }).at(GRADING.downtime.long + 1).e({ kind: 'tap-opened', tap: 'TAP-01' }).e({ kind: 'banished' }).end('banished');
    expect(grade(l4).grades.recover).toBe('F'); // 2 (downtime) + 1 (defaced) + 1 (tap)
  });

  it('an empty log grades A everywhere with sane facts', () => {
    const g = gradeEvents([]);
    expect(g.grades).toEqual({ detect: 'A', contain: 'A', eradicate: 'A', recover: 'A' });
    expect(fact(g, 'Outcome')).toBe('Unfinished');
    expect(fact(g, 'Time to contain')).toBe('never');
    expect(g.mistakes).toEqual([]);
  });

  it('the mistakes come in phase order, each with a real-world reason', () => {
    const l = log().at(0).start('ATK-01', 1, '203.0.113.9').at(REAL_S).start('ATK-13', 5, '203.0.113.9').land('ATK-13').at(2 * REAL_S).act({ type: 'DEF-15', path: 'x' }).at(10 * REAL_MIN).act({ type: 'DEF-06', ip: '203.0.113.9', op: 'add' }).act({ type: 'DEF-11' }).end('flatline', 0, 0);
    const g = grade(l);
    const phases = g.mistakes.map((m) => m.phase);
    expect(phases).toEqual([...phases].sort((a, b) => ['detect', 'contain', 'eradicate', 'recover'].indexOf(a) - ['detect', 'contain', 'eradicate', 'recover'].indexOf(b)));
    for (const m of g.mistakes) expect(m.why.length, m.title).toBeGreaterThan(40);
  });
});

describe('buildReport (ENGINE_API §5)', () => {
  it('returns exactly the agreed shape, with the offline debrief placeholder and a Markdown version of everything', async () => {
    const w = initialWorld(1, 'medium');
    for (const e of cleanRun().e({ kind: 'tap-opened', tap: 'TAP-01' }).events) w.events.push(e);
    const r = await buildReport(w);
    expect(Object.keys(r).sort()).toEqual(['debrief', 'facts', 'grades', 'markdown', 'missed', 'mistakes']);
    expect(r.debrief).toEqual({ text: OFFLINE_DEBRIEF, offline: true });
    for (const m of r.mistakes) expect(Object.keys(m).sort()).toEqual(['title', 'why']);
    for (const f of r.facts) expect(Object.keys(f).sort()).toEqual(['label', 'value']);
    expect(r.grades).toEqual({ detect: 'A', contain: 'A', eradicate: 'A', recover: 'B' });
    expect(r.markdown).toMatch(/^# Post-incident report\n/);
    for (const f of r.facts) expect(r.markdown).toContain(`**${f.label}:** ${f.value}`);
    expect(r.markdown).toContain('| Recover | B |');
    expect(r.markdown).toContain('**Still leaking at the end: open logs.**');
    expect(r.markdown).toContain('## Debrief (Kiro offline)');
    expect(r.markdown).toContain(OFFLINE_DEBRIEF);
  });

  it('reads nothing but the events: the same log grades the same on any world', async () => {
    const a = initialWorld(1, 'medium');
    const b = initialWorld(7, 'hard');
    for (const e of cleanRun().events) { a.events.push(e); b.events.push(e); }
    b.souls.stolen.push({ table: 'Users', key: 1 });
    b.heartbeat = 1;
    expect(await buildReport(a)).toEqual(await buildReport(b));
  });
});
