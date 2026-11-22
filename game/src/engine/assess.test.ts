// SYS-21 (D-114), SYS-11 (D-112): the judging engine. One test per grading rule on a crafted world and log, one per
// relevance rule, one per gap type, and the live side (statuses, the biggest gap, the refresh inside advance()).
import { describe, expect, it } from 'vitest';
import type { MoveId, PlayerAction } from '../rules/vocabulary';
import { applyAction } from './actions';
import { advance } from './advance';
import { evaluate, fmtGameMs, GAP_TYPES, GRADING, judgeAction, NO_EFFECTS, stepAssess, type Assessment, type RelevanceContext } from './assess';
import { CONFIG } from './config';
import { emit, eventsOfKind, type GameEventBody } from './log';
import { runSim } from './sim';
import { initialWorld, type World } from './state';
import { FIXTURE_LIBRARY } from './test-fixtures/recordings';
import { WHOLE_RUN_TIMEOUT_MS } from './test-fixtures/timeouts';

const REAL_S = 30_000;
const REAL_MIN = 60 * REAL_S;
const HIS_IP = '203.0.113.9';

/** A crafted run: `at(t)` sets the clock, `e(body)` logs an event, `act` logs an action (or applies a real one with `apply`). */
function run() {
  const w = initialWorld(1, 'medium');
  const api = {
    w,
    at(t: number) { w.clock.gameMs = t; return api; },
    e(body: GameEventBody) { emit(w, body); return api; },
    act(action: PlayerAction, ok = true) { emit(w, { kind: 'action', action, ok }); return api; },
    apply(action: PlayerAction) { applyAction(w, action); return api; },
    look() { return api.act({ type: 'DEF-01', query: `grep ${HIS_IP} /var/log/nginx/access.log`, shown: [`${HIS_IP} - - [31/Oct/2026:22:00:05 +0000] "GET /w1 HTTP/1.1" 404 10 "-" "ffuf"`] }); }, // a relevant look: it showed his line (D-115)
    start(move: MoveId, stage: 1 | 2 | 3 | 4 | 5 | 6, ip = HIS_IP) { emit(w, { kind: 'move-started', move, variant: 'a', stage, ip }); return api; },
    land(move: MoveId) { emit(w, { kind: 'move-landed', move, variant: 'a' }); return api; },
    steal(by: 'ATK-08' | 'ATK-09' | 'MIN-02' | 'TAP-01', count: number) {
      for (let i = 0; i < count; i++) w.souls.stolen.push({ table: 'Users', key: w.souls.stolen.length + 1 });
      emit(w, { kind: 'souls-stolen', by, count, stolen: w.souls.stolen.length, total: w.souls.total });
      return api;
    },
    end(ending: 'banished' | 'souls-lost' | 'flatline' | 'return', heartbeat = 50) { w.ending = ending; emit(w, { kind: 'ending', ending, souls: w.souls.stolen.length, heartbeat }); return api; },
  };
  return api;
}
type Run = ReturnType<typeof run>;
const grade = (r: Run): Assessment => evaluate(r.w);
const fact = (g: Assessment, label: string) => g.facts.find((f) => f.label === label)?.value;
const titles = (g: Assessment, phase?: Assessment['mistakes'][number]['phase']) => g.mistakes.filter((m) => !phase || m.phase === phase).map((m) => m.title);
const gapTypes = (g: Assessment) => g.gaps.map((x) => x.type);

/** A tidy run, still open: every stage noticed and contained at once, evidence first, the door patched, notified on time. */
function openRun() {
  const r = run()
    .at(1 * REAL_S).start('ATK-01', 1).at(2 * REAL_S).apply({ type: 'DEF-05', name: 'first' }).look()
    .at(3 * REAL_S).act({ type: 'DEF-12', rule: { kind: 'block-user-agent', pattern: 'Fuzz Faster U Fool' } }).e({ kind: 'move-cut', move: 'ATK-01', variant: 'a', by: 'DEF-12' })
    .at(60 * REAL_S).start('ATK-08', 4).steal('ATK-08', 3).at(61 * REAL_S).apply({ type: 'DEF-19' }).apply({ type: 'DEF-20', to: 'legal' }).act({ type: 'DEF-13', patch: 'search' })
    .at(62 * REAL_S).e({ kind: 'door-shut', move: 'ATK-08', by: 'DEF-13' }).e({ kind: 'patch-applied', patch: 'search' }).at(90 * REAL_S);
  r.w.patches.applied.push('search');
  return r;
}
const cleanRun = () => openRun().e({ kind: 'banished' }).end('banished', 90);

describe('SYS-11: the grading rules, one by one (from the assessor)', () => {
  it('a clean run grades A in every phase with no mistakes, nothing missed and no gap', () => {
    const g = grade(cleanRun());
    expect(g.grades).toEqual({ detect: 'A', contain: 'A', eradicate: 'A', recover: 'A' });
    expect(g.mistakes).toEqual([]);
    expect(g.missed).toEqual([]);
    expect(g.gaps).toEqual([]);
    expect(fact(g, 'Outcome')).toBe('Banished');
    expect(fact(g, 'Souls lost')).toBe('3 of 325 (1 %)');
  });

  it("time to notice each stage: the first RELEVANT action after the stage's first move; an unfocused read, comms or bringing back don't count", () => {
    const r = run()
      .at(0).start('ATK-01', 1).at(20 * REAL_S).act({ type: 'DEF-20', to: 'legal' }).act({ type: 'DEF-01', query: 'ls -la' }).act({ type: 'DEF-18', what: 'nginx' }, false).at(45 * REAL_S).look()
      .at(100 * REAL_S).start('ATK-03', 2).at(100 * REAL_S + 20_000).start('ATK-04', 2).at(190 * REAL_S).look() // 90 s after the stage's FIRST move
      .at(300 * REAL_S).start('ATK-06', 3).at(900 * REAL_S).end('souls-lost', 40); // never noticed: the run ends 600 s later
    const g = grade(r);
    expect(fact(g, 'Time to notice stage 1')).toBe(fmtGameMs(45 * REAL_S));
    expect(fact(g, 'Time to notice stage 2')).toBe(fmtGameMs(90 * REAL_S));
    expect(fact(g, 'Time to notice stage 3')).toBe('never');
    expect(titles(g, 'detect')).toEqual([expect.stringMatching(/^Stage 3 .* was never noticed/)]);
    expect(g.grades.detect).toBe('D'); // the mean counts the unnoticed stage to the end of the run: (45 + 90 + 600) / 3 real s
    const slow = grade(run().at(0).start('ATK-01', 1).at(150 * REAL_S).look().at(200 * REAL_S).end('banished'));
    expect(titles(slow, 'detect')).toEqual([`Stage 1 went unnoticed for ${fmtGameMs(150 * REAL_S)}`]);
    expect(slow.grades.detect).toBe('C'); // 2.5 real min
  });

  it('detect grades by the mean time to notice: A ≤ 1, B ≤ 2, C ≤ 4, D ≤ 8 real min, F past that', () => {
    const after = (ms: number) => grade(run().at(0).start('ATK-01', 1).at(ms).look().at(ms + 1).end('banished')).grades.detect;
    expect([after(GRADING.notice.A), after(GRADING.notice.A + 1), after(GRADING.notice.B + 1), after(GRADING.notice.C + 1), after(GRADING.notice.D + 1)]).toEqual(['A', 'B', 'C', 'D', 'F']);
  });

  it('time to contain: from his first move to the first fix that held (a cut by anything but an IP block, a door shut, or banishment); never → F', () => {
    const ipOnly = run().at(10 * REAL_S).start('ATK-01', 1).at(20 * REAL_S).act({ type: 'DEF-06', ip: HIS_IP, op: 'add' }).e({ kind: 'move-cut', move: 'ATK-01', variant: 'a', by: 'DEF-06' }).at(600 * REAL_S).end('souls-lost', 30);
    expect(fact(grade(ipOnly), 'Time to contain')).toBe('never');
    const cut = run().at(10 * REAL_S).start('ATK-01', 1).at(100 * REAL_S).e({ kind: 'move-cut', move: 'ATK-01', variant: 'a', by: 'DEF-12' }).at(200 * REAL_S).end('banished');
    expect(fact(grade(cut), 'Time to contain')).toBe(fmtGameMs(90 * REAL_S));
    expect(grade(cut).grades.contain).toBe('A');
    const shut = run().at(10 * REAL_S).start('ATK-08', 4).at(10 * REAL_S + GRADING.contain.B + 1).e({ kind: 'door-shut', move: 'ATK-08', by: 'DEF-10' }).at(900 * REAL_S).end('banished');
    expect(grade(shut).grades.contain).toBe('C');
    const banished = run().at(10 * REAL_S).start('ATK-01', 1).at(10 * REAL_S + GRADING.contain.D + 1).e({ kind: 'banished' }).end('banished');
    expect(grade(banished).grades.contain).toBe('F');
  });

  it('souls lost: the fact from the world, and a grade off past a quarter, two past three quarters', () => {
    const lost = (n: number) => grade(openRun().steal('ATK-08', n).end('banished', 80));
    expect(fact(lost(78), 'Souls lost')).toBe('81 of 325 (25 %)'); // 3 already gone in the open run
    expect(lost(78).grades.contain).toBe('A');
    expect(lost(79).grades.contain).toBe('B');
    expect(lost(240).grades.contain).toBe('B'); // 74.8 %
    expect(lost(241).grades.contain).toBe('C'); // 75.1 %
  });

  it('downtime caused: the plug pulled until nginx is back (or the end), summed; over a real minute a grade, over three two', () => {
    const r = run().at(0).start('ATK-01', 1).act({ type: 'DEF-19' }).at(10 * REAL_S).act({ type: 'DEF-11' }).at(40 * REAL_S).act({ type: 'DEF-18', what: 'nginx' })
      .at(50 * REAL_S).act({ type: 'DEF-11' }).at(100 * REAL_S).e({ kind: 'banished' }).end('banished'); // 30 s + 50 s (open at the end)
    const g = grade(r);
    expect(fact(g, 'Downtime caused (plug pulled)')).toBe(fmtGameMs(80 * REAL_S));
    expect(g.grades.recover).toBe('B');
    expect(titles(g, 'recover')).toEqual([`The shop was offline for ${fmtGameMs(80 * REAL_S)} by your own hand`]);
    const long = grade(run().at(0).start('ATK-01', 1).act({ type: 'DEF-19' }).act({ type: 'DEF-11' }).at(GRADING.downtime.long + 1).e({ kind: 'banished' }).end('banished'));
    expect(long.grades.recover).toBe('C');
    expect(fact(grade(cleanRun()), 'Downtime caused (plug pulled)')).toBe('0 min');
  });

  it('evidence before eradication: a snapshot before the first eradicate-phase action, else a mistake', () => {
    const planted = () => { const r = run().at(0).start('ATK-13', 5).land('ATK-13'); r.w.files.push({ path: 'complaints/x.zip', size: 1, sha256: 'a', plantedBy: 'ATK-13' }); return r; };
    const none = grade(planted().at(REAL_S).act({ type: 'DEF-15', path: 'complaints/x.zip' }).at(2 * REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(fact(none, 'Evidence preserved')).toBe('never');
    expect(titles(none, 'eradicate')).toEqual(['No evidence was preserved before eradication']);
    expect(none.grades.eradicate).toBe('B');
    const after = grade(planted().at(REAL_S).act({ type: 'DEF-15', path: 'complaints/x.zip' }).at(2 * REAL_S).act({ type: 'DEF-05', name: 'late' }).at(3 * REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(fact(after, 'Evidence preserved')).toBe(`at ${fmtGameMs(2 * REAL_S)} (after changes had begun)`);
    expect(titles(after, 'eradicate')).toEqual(['Evidence was snapshotted only after eradication had begun']);
    const before = grade(planted().act({ type: 'DEF-05', name: 'first' }).at(REAL_S).act({ type: 'DEF-15', path: 'complaints/x.zip' }).at(2 * REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(titles(before, 'eradicate')).toEqual([]);
    const noEradication = grade(run().at(0).start('ATK-01', 1).at(REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(titles(noEradication, 'eradicate')).toEqual([]); // nothing was changed, nothing to preserve first
  });

  it("IP whack-a-mole: 3 or more IP blocks on his addresses; blocks elsewhere don't count (SIM-2)", () => {
    const blocks = (ips: string[]) => {
      const r = run().at(0).start('ATK-01', 1, '203.0.113.10').at(REAL_S).start('ATK-01', 1, '203.0.113.77').at(2 * REAL_S).start('ATK-03', 2, '203.0.113.12');
      ips.forEach((ip, i) => r.at((3 + i) * REAL_S).act({ type: 'DEF-06', ip, op: 'add' }));
      return grade(r.at(60 * REAL_S).end('souls-lost', 50));
    };
    const two = blocks(['203.0.113.10', '203.0.113.77', '192.0.2.4', '198.51.100.9']);
    expect(fact(two, "IP blocks on the attacker's addresses")).toBe('2');
    expect(titles(two, 'contain')).toEqual([]);
    const three = blocks(['203.0.113.10', '203.0.113.77', '203.0.113.12']);
    expect(titles(three, 'contain')).toEqual(['IP whack-a-mole: 3 of his addresses blocked one by one']);
    expect(three.mistakes.find((m) => m.title.startsWith('IP whack'))!.why).toMatch(/CISA AA20-245A/);
  });

  it('early full logout: a revoke before he held a session (or another with no new session since) is marked down; after a break-in it is not', () => {
    const early = grade(run().at(0).start('ATK-01', 1).land('ATK-01').at(REAL_S).act({ type: 'DEF-09' }).at(2 * REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(titles(early, 'contain')).toEqual([`Every session revoked at ${fmtGameMs(REAL_S)} before he held one`]);
    expect(early.grades.contain).toBe('B');
    const timely = grade(run().at(0).start('ATK-03', 2).land('ATK-03').at(REAL_S).act({ type: 'DEF-09' }).at(2 * REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(titles(timely, 'contain')).toEqual([]);
    const minion = grade(run().at(0).steal('MIN-02', 1).at(REAL_S).act({ type: 'DEF-09' }).at(2 * REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(titles(minion, 'contain')).toEqual([]); // a wraith's success hands him a session too (D-18)
    const twice = grade(run().at(0).start('ATK-03', 2).land('ATK-03').at(REAL_S).act({ type: 'DEF-09' }).at(30 * REAL_S).act({ type: 'DEF-09' }).at(31 * REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(titles(twice, 'contain')).toEqual([`Every session revoked at ${fmtGameMs(30 * REAL_S)} before he held one`]);
  });

  it('pulling the plug without escalating first is marked down (DEF-19 before DEF-11 is not)', () => {
    const cold = grade(run().at(0).start('ATK-01', 1).at(REAL_S).act({ type: 'DEF-11' }).at(2 * REAL_S).act({ type: 'DEF-19' }).at(3 * REAL_S).act({ type: 'DEF-18', what: 'nginx' }).e({ kind: 'banished' }).end('banished'));
    expect(titles(cold, 'contain')).toEqual([`The plug was pulled at ${fmtGameMs(REAL_S)} without escalating first`]);
    const warm = grade(run().at(0).start('ATK-01', 1).at(REAL_S).act({ type: 'DEF-19' }).act({ type: 'DEF-11' }).at(3 * REAL_S).act({ type: 'DEF-18', what: 'nginx' }).e({ kind: 'banished' }).end('banished'));
    expect(titles(warm, 'contain')).toEqual([]);
  });

  it('notification on time (SYS-14, D-116): the clock starts at the escalation after souls were taken; late past the window, missing if never, marked if before confirmation', () => {
    const window = CONFIG.medium.notification.windowGameMs;
    const base = () => run().at(0).start('ATK-08', 4).steal('ATK-08', 5).at(REAL_S).apply({ type: 'DEF-19' });
    const onTime = grade(base().at(REAL_S + window).apply({ type: 'DEF-20', to: 'legal' }).at(REAL_S + window + 1).end('banished'));
    expect(fact(onTime, 'Breach notification')).toBe(`on time, at ${fmtGameMs(REAL_S + window)}`);
    expect(titles(onTime, 'recover')).toEqual([]);
    const late = grade(base().at(REAL_S + window + REAL_MIN).apply({ type: 'DEF-20', to: 'legal' }).end('banished'));
    expect(fact(late, 'Breach notification')).toBe(`late: ${fmtGameMs(window + REAL_MIN)} after confirmation (window ${fmtGameMs(window)})`);
    expect(titles(late, 'recover')).toEqual([expect.stringMatching(/^Legal was notified .* after the breach was confirmed$/)]);
    expect(late.mistakes.find((m) => m.title.startsWith('Legal was notified'))!.why).toMatch(/GDPR Art\. 33/);
    const missing = grade(base().at(10 * REAL_MIN).end('souls-lost', 50));
    expect(fact(missing, 'Breach notification')).toBe(`missing (breach confirmed at ${fmtGameMs(REAL_S)})`);
    expect(titles(missing, 'recover')).toEqual(['The breach was never notified']);
    const unconfirmed = grade(run().at(0).start('ATK-08', 4).steal('ATK-08', 5).at(10 * REAL_MIN).end('souls-lost', 50));
    expect(fact(unconfirmed, 'Breach notification')).toBe('missing (the breach was never confirmed)');
    const rumour = grade(run().at(0).start('ATK-01', 1).at(REAL_S).apply({ type: 'DEF-20', to: 'customers' }).at(2 * REAL_S).steal('ATK-08', 1).at(3 * REAL_S).apply({ type: 'DEF-19' }).apply({ type: 'DEF-20', to: 'legal' }).end('banished'));
    expect(titles(rumour, 'recover')).toEqual(['Notified customers before the breach was confirmed']);
    const noTheft = grade(run().at(0).start('ATK-01', 1).at(REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(fact(noTheft, 'Breach notification')).toBe('not needed: no data was taken');
    // a snapshot never confirms (D-116): notified after one with no escalation is notified unconfirmed
    const snap = grade(run().at(0).apply({ type: 'DEF-05', name: 'early' }).at(REAL_S).start('ATK-08', 4).steal('ATK-08', 5).at(2 * REAL_S).apply({ type: 'DEF-05', name: 'after' }).at(3 * REAL_S).apply({ type: 'DEF-20', to: 'legal' }).end('banished'));
    expect(titles(snap, 'recover')).toEqual(['Notified legal before the breach was confirmed']);
    expect(fact(snap, 'Breach notification')).toBe(`on time, at ${fmtGameMs(3 * REAL_S)}`);
  });

  it('customers lost (churn): the count from the world, and more than 10 is marked down', () => {
    const churn = (n: number) => { const r = cleanRun(); r.w.customers.lost = n; return grade(r); };
    expect(fact(churn(10), 'Customers lost for good')).toBe('10');
    expect(titles(churn(10), 'recover')).toEqual([]);
    expect(titles(churn(11), 'recover')).toEqual(['11 customers gave up and left']);
    expect(churn(11).grades.recover).toBe('B');
  });

  it('open taps at the end: listed as a fact, each run with one still dripping is marked down', () => {
    const r = cleanRun();
    r.w.taps.open.push({ id: 'TAP-01', openedAt: 10 * REAL_S, nextDripAt: 0, drips: 0 });
    const g = grade(r);
    expect(fact(g, 'Leaky taps still open at the end')).toBe('open logs');
    expect(titles(g, 'recover')).toEqual(['Still leaking at the end: open logs']);
    expect(g.mistakes.at(-1)!.why).toMatch(/OWASP/);
    expect(fact(grade(cleanRun()), 'Leaky taps still open at the end')).toBe('none');
  });

  it('missed footholds: what is left in the world at the end (exact, closes KI-110); the return names its foothold and fails eradication', () => {
    const planted = () => {
      const r = run().at(0).act({ type: 'DEF-05', name: 'x' }).at(REAL_S).start('ATK-11', 5).land('ATK-11').start('ATK-13', 5).land('ATK-13');
      r.w.accounts.push({ id: 327, email: 'support-ops@juice-sh.op', role: 'admin', createdBy: 'ATK-11' });
      r.w.files.push({ path: 'complaints/x.zip', size: 1, sha256: 'a', plantedBy: 'ATK-13' });
      return r;
    };
    const left = grade(planted().at(10 * REAL_MIN).end('flatline', 0));
    expect(left.missed).toEqual(['a hidden admin account (plant a hidden second admin)', 'a planted file in uploads/ (plant a file)']);
    expect(left.grades.eradicate).toBe('C');
    const removed = planted().at(2 * REAL_S).apply({ type: 'DEF-14', email: 'support-ops@juice-sh.op' }).apply({ type: 'DEF-15', path: 'complaints/x.zip' }).at(10 * REAL_MIN).end('flatline', 0);
    expect(grade(removed).missed).toEqual([]);
    const restoredBack = planted().at(2 * REAL_S).apply({ type: 'DEF-17', backupId: 0 }).at(10 * REAL_MIN).end('flatline', 0);
    expect(grade(restoredBack).missed).toEqual([]); // the first backup predates him
    const banished = planted().at(10 * REAL_MIN).e({ kind: 'banished' }).end('banished');
    expect(grade(banished).missed).toEqual([]); // the engine only banishes with none left
    const back = planted().at(2 * REAL_S).apply({ type: 'DEF-15', path: 'complaints/x.zip' }).at(10 * REAL_MIN).e({ kind: 'return', through: 'hidden-admin' }).end('return', 60);
    expect(grade(back).missed).toEqual(['a hidden admin account (plant a hidden second admin): he came back through it']);
    expect(grade(back).grades.eradicate).toBe('F');
    const token = run().at(0).act({ type: 'DEF-05', name: 'x' }).at(REAL_S).start('ATK-14', 5).land('ATK-14').at(2 * REAL_S).act({ type: 'DEF-13', patch: 'login' }).at(10 * REAL_MIN).end('flatline', 0);
    token.w.death.forgedToken = true;
    expect(grade(token).missed).toEqual(['a forged login token (token verification never patched) (forge his own login token)']); // only the token-verify patch removes it
  });

  it('symptom-only fixes: a soul door he opened whose patch never landed is marked down at the end', () => {
    const waf = grade(run().at(0).act({ type: 'DEF-05', name: 'x' }).at(REAL_S).start('ATK-08', 4).at(2 * REAL_S).act({ type: 'DEF-12', rule: { kind: 'sqli' } }).e({ kind: 'move-cut', move: 'ATK-08', variant: 'a', by: 'DEF-12' }).at(10 * REAL_MIN).end('flatline', 0));
    expect(titles(waf, 'eradicate')).toEqual(['The hole behind "dump customers through search" was never patched']);
    expect(waf.grades.eradicate).toBe('B');
    expect(titles(grade(cleanRun()), 'eradicate')).toEqual([]); // the search patch landed
  });

  it('a feature left off after its patch is live is marked down at the end; one with no patch (uploads, /ftp, password reset) never is', () => {
    const base = () => { const r = run().at(0).act({ type: 'DEF-05', name: 'x' }).start('ATK-08', 4).at(REAL_S).apply({ type: 'DEF-10', feature: 'search', enabled: false }).act({ type: 'DEF-13', patch: 'search' }).at(2 * REAL_S).e({ kind: 'patch-applied', patch: 'search' }); r.w.patches.applied.push('search'); return r; };
    const leftOff = grade(base().at(3 * REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(titles(leftOff, 'recover')).toEqual(['search left off after the patch was live']);
    const back = grade(base().at(3 * REAL_S).apply({ type: 'DEF-18', what: 'search' }).e({ kind: 'banished' }).end('banished'));
    expect(titles(back, 'recover')).toEqual([]);
    const uploads = grade(run().at(0).act({ type: 'DEF-05', name: 'x' }).start('ATK-13', 5).at(REAL_S).apply({ type: 'DEF-10', feature: 'uploads', enabled: false }).at(3 * REAL_S).e({ kind: 'banished' }).end('banished'));
    expect(titles(uploads, 'recover')).toEqual([]);
  });

  it('a defacement still live at the end is marked down; one restored is not', () => {
    const base = () => { const r = run().at(0).act({ type: 'DEF-05', name: 'x' }).start('ATK-15', 6).land('ATK-15'); r.w.defacements.push({ productId: 1, kind: 'deface', by: 'ATK-15' }); return r; };
    expect(titles(grade(base().at(10 * REAL_MIN).end('flatline', 0)), 'recover')).toEqual(['The defaced shop was never restored']);
    expect(titles(grade(base().at(REAL_S).apply({ type: 'DEF-17', backupId: 0 }).at(10 * REAL_MIN).end('flatline', 0)), 'recover')).toEqual([]);
  });

  it('the ending fails the phase that lost it: every soul → contain, flatline → recover, the return → eradicate', () => {
    expect(grade(openRun().end('souls-lost', 50)).grades.contain).toBe('F');
    expect(grade(openRun().end('flatline', 0)).grades.recover).toBe('F');
    expect(grade(openRun().e({ kind: 'return', through: 'planted-file' }).end('return', 50)).grades.eradicate).toBe('F');
  });

  it('a letter per mistake: A with none, B, C, D, then F', () => {
    const r = cleanRun();
    r.w.customers.lost = 11; // 1 point on recover
    expect(grade(r).grades.recover).toBe('B');
    r.w.taps.open.push({ id: 'TAP-01', openedAt: 0, nextDripAt: 0, drips: 0 }); // 2
    expect(grade(r).grades.recover).toBe('C');
    delete r.w.comms.notifiedAt.legal; // 3: never notified
    expect(grade(r).grades.recover).toBe('D');
    const r4 = run().at(0).start('ATK-15', 6).land('ATK-15').act({ type: 'DEF-11' }).at(GRADING.downtime.long + 1).e({ kind: 'banished' }).end('banished');
    r4.w.defacements.push({ productId: 1, kind: 'deface', by: 'ATK-15' });
    r4.w.taps.open.push({ id: 'TAP-01', openedAt: 0, nextDripAt: 0, drips: 0 });
    expect(grade(r4).grades.recover).toBe('F'); // 2 (downtime) + 1 (defaced) + 1 (tap)
  });

  it('a fresh world grades A everywhere with sane facts and no gap', () => {
    const g = evaluate(initialWorld(1, 'medium'));
    expect(g.grades).toEqual({ detect: 'A', contain: 'A', eradicate: 'A', recover: 'A' });
    expect(fact(g, 'Outcome')).toBe('Unfinished');
    expect(fact(g, 'Time to contain')).toBe('never');
    expect(g.mistakes).toEqual([]);
    expect(g.gap).toBeUndefined();
    expect(g.phases).toEqual({ detect: { status: 'quiet', evidence: [] }, contain: { status: 'quiet', evidence: [] }, eradicate: { status: 'clean', evidence: [] }, recover: { status: 'ok', evidence: [] } });
  });

  it('the mistakes come in phase order, each with a real-world reason', () => {
    const r = run().at(0).start('ATK-01', 1).at(REAL_S).start('ATK-13', 5).land('ATK-13').at(2 * REAL_S).act({ type: 'DEF-15', path: 'x' }).at(10 * REAL_MIN).act({ type: 'DEF-06', ip: HIS_IP, op: 'add' }).act({ type: 'DEF-11' }).end('flatline', 0);
    const g = grade(r);
    const phases = g.mistakes.map((m) => m.phase);
    const order = ['detect', 'contain', 'eradicate', 'recover'];
    expect(phases).toEqual([...phases].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    for (const m of g.mistakes) expect(m.why.length, m.title).toBeGreaterThan(40);
  });
});

describe('relevant actions by outcome (D-115)', () => {
  const HIS = `${HIS_IP} - - [31/Oct/2026:22:00:05 +0000] "GET /rest/products/search?q=1%27 HTTP/1.1" 500 197 "-" "sqlmap"`;
  const SHOPPER = `192.0.2.4 - - [31/Oct/2026:22:00:06 +0000] "GET / HTTP/1.1" 200 3257 "-" "Mozilla/5.0"`;
  const ctx = (over: Partial<RelevanceContext> = {}): RelevanceContext => ({
    started: new Set(['ATK-01', 'ATK-08']), addresses: new Set([HIS_IP, '203.0.113.77']), moves: new Map([[HIS_IP, 'ATK-08'], ['203.0.113.77', 'ATK-01']]), appTexts: new Set(['Error: SQLITE_ERROR: near "(": syntax error']),
    hisAccounts: new Set(['death@juice-sh.op']), hisFiles: new Set(['complaints/x.zip']), effects: { ...NO_EFFECTS }, ...over,
  });
  const yes = (a: PlayerAction, c = ctx()) => expect(judgeAction(a, c).relevant, JSON.stringify(a).slice(0, 120)).toBe(true);
  const no = (a: PlayerAction, c = ctx()) => expect(judgeAction(a, c).relevant, JSON.stringify(a).slice(0, 120)).toBe(false);

  it('(a) a read is relevant when it SHOWED a line of his and was focused: an accidental tail that shows his lines counts, a cat of the whole log does not', () => {
    yes({ type: 'DEF-01', query: 'tail -n 50 /var/log/nginx/access.log', shown: [SHOPPER, SHOPPER, HIS] }); // 3 lines shown, one his: focused by size
    yes({ type: 'DEF-01', query: 'grep 500 access.log | tail', shown: [HIS, SHOPPER], shownTotal: 2 });
    no({ type: 'DEF-01', query: 'cat /var/log/nginx/access.log', shown: Array.from({ length: 200 }, (_, i) => (i === 7 ? HIS : SHOPPER)), shownTotal: 9000 }); // 9,000 lines, one of his among the 200 passed: unfocused
    yes({ type: 'DEF-01', query: 'cat /var/log/nginx/access.log', shown: Array.from({ length: 200 }, (_, i) => (i % 5 === 0 ? HIS : SHOPPER)), shownTotal: 9000 }); // a fifth of the shown lines are his: focused
    no({ type: 'DEF-01', query: 'tail access.log', shown: [SHOPPER, SHOPPER] }); // nothing of his
    no({ type: 'DEF-01', query: 'ls -la /var/log/nginx', shown: ['access.log', 'error.log'] });
    no({ type: 'DEF-01', query: `grep ${HIS_IP} access.log` }); // no shown lines yet (the shell sends them later): not judged relevant
    yes({ type: 'DEF-01', query: 'tail app.log', shown: ['Error: SQLITE_ERROR: near "(": syntax error'] }); // an app-log line his move wrote
  });

  it('(a) a query that shows his planted account, a listing that shows his planted file; the same with nothing of his does not count', () => {
    yes({ type: 'DEF-02', sql: 'SELECT email, role FROM Users WHERE role = "admin"', shown: ['admin@juice-sh.op|admin', 'death@juice-sh.op|admin'] });
    no({ type: 'DEF-02', sql: 'SELECT email, role FROM Users WHERE role = "admin"', shown: ['admin@juice-sh.op|admin'] });
    no({ type: 'DEF-02', sql: 'SELECT * FROM Users' }); // no lines shown
    yes({ type: 'DEF-03', path: '/srv/juice-shop/uploads/complaints', shown: ['invoice.pdf', 'complaints/x.zip'] });
    no({ type: 'DEF-03', path: '/srv/juice-shop/uploads/complaints', shown: ['invoice.pdf'] });
    expect(judgeAction({ type: 'DEF-02', sql: 'SELECT * FROM Users', shown: ['death@juice-sh.op'] }, ctx())).toMatchObject({ relevant: true, users: true });
  });

  it('(b) an action is relevant when it actually hurt him this tick: a cut, a freeze, a door shut, a tap closed, a foothold or a defacement removed', () => {
    yes({ type: 'DEF-06', ip: HIS_IP, op: 'add' }, ctx({ effects: { ...NO_EFFECTS, cut: [{ move: 'ATK-08', by: 'DEF-06' }] } }));
    no({ type: 'DEF-06', ip: HIS_IP, op: 'add' }); // blocked, but nothing was cut (proxies, or an address he no longer uses)
    no({ type: 'DEF-06', ip: '8.8.8.8', op: 'add' }, ctx({ effects: { ...NO_EFFECTS, cut: [{ move: 'ATK-08', by: 'DEF-06' }] } }));
    yes({ type: 'DEF-10', feature: 'search', enabled: false }, ctx({ effects: { ...NO_EFFECTS, frozen: ['ATK-08'] } }));
    no({ type: 'DEF-10', feature: 'search', enabled: false }); // nothing of his was running or shut
    yes({ type: 'DEF-10', feature: 'search', enabled: false }, ctx({ effects: { ...NO_EFFECTS, shut: [{ move: 'ATK-08', by: 'DEF-10' }] } }));
    no({ type: 'DEF-10', feature: 'registration', enabled: false }, ctx({ effects: { ...NO_EFFECTS, shut: [{ move: 'ATK-08', by: 'DEF-10' }] } })); // not the stopper that shut it
    yes({ type: 'DEF-11' }, ctx({ effects: { ...NO_EFFECTS, frozen: ['ATK-01'] } }));
    no({ type: 'DEF-11' });
    yes({ type: 'DEF-12', rule: { kind: 'block-path', method: 'GET', path: '/support/logs' } }, ctx({ effects: { ...NO_EFFECTS, tapsClosed: ['TAP-01'] } }));
    no({ type: 'DEF-12', rule: { kind: 'block-path', method: 'GET', path: '/support/logs' } });
    yes({ type: 'DEF-14', email: 'support-ops@juice-sh.op' }, ctx({ effects: { ...NO_EFFECTS, footholdsRemoved: ['hidden-admin'] } }));
    no({ type: 'DEF-14', email: 'jim@juice-sh.op' });
    yes({ type: 'DEF-15', path: 'complaints/x.zip' }, ctx({ effects: { ...NO_EFFECTS, footholdsRemoved: ['planted-file'] } }));
    yes({ type: 'DEF-16', email: 'morty@juice-sh.op' }, ctx({ effects: { ...NO_EFFECTS, footholdsRemoved: ['hijacked-user'] } }));
    yes({ type: 'DEF-17', backupId: 0 }, ctx({ effects: { ...NO_EFFECTS, defacementRemoved: true } }));
    yes({ type: 'DEF-17', backupId: 0 }, ctx({ effects: { ...NO_EFFECTS, footholdsRemoved: ['hidden-admin'] } }));
    no({ type: 'DEF-17', backupId: 0 });
    yes({ type: 'DEF-09' }, ctx({ effects: { ...NO_EFFECTS, shut: [{ move: 'ATK-09', by: 'DEF-09' }] } }));
  });

  it('the log keeps a summary of a read, never its text (D-122): the lines passed, how many were his, what they were about, the total; the judge reads the summary', () => {
    const w = initialWorld(1, 'medium');
    emit(w, { kind: 'move-started', move: 'ATK-08', variant: 'd', stage: 4, ip: HIS_IP });
    stepAssess(w);
    applyAction(w, { type: 'DEF-01', query: 'grep 500 access.log', shown: [HIS, SHOPPER, HIS], shownTotal: 9000 });
    const logged = w.events.find((e) => e.kind === 'action')!;
    expect(logged.kind === 'action' && logged.action).toEqual({ type: 'DEF-01', query: 'grep 500 access.log', shownTotal: 9000, shownCount: 3, shownHis: 2, shownAbout: ['ATK-08'] });
    expect(JSON.stringify(w.events)).not.toContain('sqlmap'); // nothing of the lines' text
    w.clock.gameMs += 1;
    stepAssess(w);
    expect(w.assess.relevant).toEqual([logged.id]); // judged from the summary: two of three lines his, so focused
    applyAction(w, { type: 'DEF-01', query: 'cat access.log', shown: Array.from({ length: 200 }, (_, i) => (i === 0 ? HIS : SHOPPER)), shownTotal: 9000 });
    w.clock.gameMs += 1;
    stepAssess(w);
    expect(w.assess.relevant).toEqual([logged.id]); // the unfocused cat is logged as 1 of 200, and stays irrelevant
    const cat = w.events.filter((e) => e.kind === 'action').at(-1)!;
    expect(cat.kind === 'action' && cat.action).toMatchObject({ shownCount: 200, shownHis: 1, shownTotal: 9000 });
    applyAction(w, { type: 'DEF-01', query: 'cat access.log', shown: Array.from({ length: 300 }, () => HIS) }); // over the cap: the first 200 are judged, the total kept
    const big = w.events.filter((e) => e.kind === 'action').at(-1)!;
    expect(big.kind === 'action' && big.action).toMatchObject({ shownCount: 200, shownHis: 200, shownTotal: 300 });
  });

  it('never relevant on their own: a snapshot, comms, bringing back, a lookup', () => {
    for (const a of [{ type: 'DEF-05', name: 'x' }, { type: 'DEF-18', what: 'nginx' }, { type: 'DEF-19' }, { type: 'DEF-20', to: 'legal' }, { type: 'DEF-04', ip: HIS_IP, mode: 'active' }] as PlayerAction[]) no(a);
  });

  it('in a run: a look that shows his line counts from the moment his address is known; the assessor keeps the verdicts; a block that cuts him counts', () => {
    const r = run().at(0).start('ATK-01', 1, '203.0.113.10').at(REAL_S).act({ type: 'DEF-01', query: 'tail access.log', shown: ['203.0.113.77 - - "GET /w1" 404'] }) // his address only later
      .at(2 * REAL_S).start('ATK-01', 1, '203.0.113.77').at(3 * REAL_S).act({ type: 'DEF-01', query: 'tail access.log', shown: ['203.0.113.77 - - "GET /w2" 404'] })
      .at(4 * REAL_S).act({ type: 'DEF-06', ip: '203.0.113.77', op: 'add' }).e({ kind: 'move-cut', move: 'ATK-01', variant: 'a', by: 'DEF-06' });
    const g = grade(r);
    expect(g.relevant).toEqual([r.w.events.at(-3)!.id, r.w.events.at(-2)!.id]);
    expect(g.lastRelevantActionAt).toBe(4 * REAL_S);
  });

  it('a patch that lands makes its deploy relevant at that moment; a deleted account or file he planted stays his for a later judgement', () => {
    const w = initialWorld(1, 'medium');
    w.accounts.push({ id: 326, email: 'death@juice-sh.op', role: 'admin', createdBy: 'ATK-06' });
    w.files.push({ path: 'complaints/x.zip', size: 1, sha256: 'a', plantedBy: 'ATK-13' });
    emit(w, { kind: 'move-started', move: 'ATK-08', variant: 'd', stage: 4, ip: HIS_IP });
    stepAssess(w);
    expect(w.assess.hisAccounts).toEqual(['death@juice-sh.op']);
    expect(w.assess.hisFiles).toEqual(['complaints/x.zip']);
    applyAction(w, { type: 'DEF-13', patch: 'search' }); // deploying: nothing yet
    w.clock.gameMs = 10 * REAL_S;
    stepAssess(w);
    expect(w.assess.relevant).toEqual([]);
    w.clock.gameMs = 20 * REAL_S;
    emit(w, { kind: 'patch-applied', patch: 'search' });
    stepAssess(w);
    expect(w.assess.relevant).toEqual([w.events.find((e) => e.kind === 'action')!.id]); // the deploy, judged relevant when it landed
    expect(w.assess.lastRelevantActionAt).toBe(20 * REAL_S);
    applyAction(w, { type: 'DEF-14', email: 'death@juice-sh.op' }); // gone from the world now
    applyAction(w, { type: 'DEF-15', path: 'complaints/x.zip' });
    stepAssess(w);
    expect(w.assess.relevant).toHaveLength(3); // judged from what it remembered: both removed a foothold of his
  });
});

describe('confirming the breach (D-116)', () => {
  const DOOR_LINE = `${HIS_IP} - - [31/Oct/2026:22:10:05 +0000] "GET /rest/products/search?q=x HTTP/1.1" 500 197 "-" "Mozilla/5.0"`;
  const SCAN_LINE = `203.0.113.77 - - [31/Oct/2026:22:00:05 +0000] "GET /w1 HTTP/1.1" 404 10 "-" "ffuf"`;
  function stolenWorld() {
    const w = initialWorld(1, 'medium');
    emit(w, { kind: 'move-started', move: 'ATK-01', variant: 'a', stage: 1, ip: '203.0.113.77' });
    emit(w, { kind: 'move-started', move: 'ATK-08', variant: 'd', stage: 4, ip: HIS_IP });
    w.souls.stolen.push({ table: 'Users', key: 1 });
    emit(w, { kind: 'souls-stolen', by: 'ATK-08', count: 1, stolen: 1, total: w.souls.total });
    w.clock.gameMs = 10 * REAL_S;
    stepAssess(w);
    return w;
  }
  const after = (w: World, a: PlayerAction) => { applyAction(w, a); w.clock.gameMs += 1; stepAssess(w); return w.comms.breachConfirmedAt; };

  it('a snapshot never confirms; a focused look at the scan does not; a focused look at the harvest does', () => {
    const w = stolenWorld();
    expect(after(w, { type: 'DEF-05', name: 'x' })).toBeUndefined();
    expect(after(w, { type: 'DEF-01', query: 'tail access.log', shown: [SCAN_LINE] })).toBeUndefined();
    expect(after(w, { type: 'DEF-01', query: 'grep 500 access.log', shown: [DOOR_LINE] })).toBe(w.clock.gameMs - 1);
    expect(eventsOfKind(w, 'breach-confirmed')).toMatchObject([{ by: 'DEF-01' }]);
  });

  it('a focused Users query that showed his planted account confirms; an unfocused one does not', () => {
    const w = stolenWorld();
    w.accounts.push({ id: 326, email: 'death@juice-sh.op', role: 'admin', createdBy: 'ATK-06' });
    expect(after(w, { type: 'DEF-02', sql: 'SELECT email FROM Users', shown: Array.from({ length: 200 }, (_, i) => (i === 0 ? 'death@juice-sh.op' : `c${i}@example.com`)), shownTotal: 326 })).toBeUndefined();
    expect(after(w, { type: 'DEF-02', sql: 'SELECT email FROM Users WHERE role = "admin"', shown: ['admin@juice-sh.op', 'death@juice-sh.op'] })).toBeDefined();
    expect(eventsOfKind(w, 'breach-confirmed')).toMatchObject([{ by: 'DEF-02' }]);
  });

  it('a fix that hurt the harvest confirms: search off that freezes his visit; and so does the escalation', () => {
    const w = stolenWorld();
    w.replays.push({ id: 7, owner: 'death', move: 'ATK-08', variant: 'd', ip: HIS_IP, recordedIp: HIS_IP, startedAt: 0, cursor: 0 });
    applyAction(w, { type: 'DEF-10', feature: 'search', enabled: false });
    w.replays[0]!.frozenSince = w.clock.gameMs; // as stepReplays would do the same tick
    stepAssess(w);
    expect(w.comms.breachConfirmedAt).toBe(w.clock.gameMs);
    expect(eventsOfKind(w, 'breach-confirmed')).toMatchObject([{ by: 'DEF-10' }]);
    const v = stolenWorld();
    expect(after(v, { type: 'DEF-19' })).toBeDefined();
  });

  it('nothing confirms before a soul is taken', () => {
    const w = initialWorld(1, 'medium');
    emit(w, { kind: 'move-started', move: 'ATK-08', variant: 'd', stage: 4, ip: HIS_IP });
    stepAssess(w);
    expect(after(w, { type: 'DEF-01', query: 'grep 500 access.log', shown: [DOOR_LINE] })).toBeUndefined();
    expect(after(w, { type: 'DEF-19' })).toBeUndefined();
  });
});

describe('taps (D-119)', () => {
  it("a tap's leak is a theft: legal must be told; an open tap at the end is a mistake", () => {
    const r = run().at(0).e({ kind: 'tap-opened', tap: 'TAP-01' }).at(REAL_S).steal('TAP-01', 3).at(10 * REAL_MIN).end('flatline', 0);
    r.w.taps.open.push({ id: 'TAP-01', openedAt: 0, nextDripAt: 0, drips: 1 });
    const g = grade(r);
    expect(fact(g, 'Breach notification')).toBe('missing (the breach was never confirmed)');
    expect(titles(g, 'recover')).toEqual(expect.arrayContaining(['The breach was never notified', 'Still leaking at the end: open logs']));
    expect(gapTypes(g)).toContain('breach-unconfirmed');
  });
});

describe('phase statuses with evidence', () => {
  it('detect: quiet, then behind while a stage is unseen, current once every started stage has a relevant action after it', () => {
    const r = run();
    expect(grade(r).phases.detect).toEqual({ status: 'quiet', evidence: [] });
    r.at(0).start('ATK-01', 1).at(10 * REAL_S);
    expect(grade(r).phases.detect).toMatchObject({ status: 'behind', evidence: [`stage 1: unnoticed for ${fmtGameMs(10 * REAL_S)}`] });
    r.look();
    expect(grade(r).phases.detect).toMatchObject({ status: 'current', evidence: [`stage 1: noticed ${fmtGameMs(10 * REAL_S)} after it started`] });
  });

  it('contain: open while no fix has held and his move runs, holding once one did, with the shut doors and his blocks as evidence', () => {
    const r = run().at(0).start('ATK-08', 4).at(5 * REAL_S);
    r.w.replays.push({ id: 1, owner: 'death', move: 'ATK-08', variant: 'd', ip: HIS_IP, recordedIp: HIS_IP, startedAt: 0, cursor: 0 });
    expect(grade(r).phases.contain).toEqual({ status: 'open', evidence: ['no fix has held yet', 'dump customers through search is running now'] });
    r.w.replays = [];
    r.e({ kind: 'door-shut', move: 'ATK-08', by: 'DEF-10' });
    r.w.death.shutDoors.push('ATK-08');
    expect(grade(r).phases.contain).toMatchObject({ status: 'holding', evidence: [`first fix held ${fmtGameMs(5 * REAL_S)} after his first move (door-shut by DEF-10)`, 'dump customers through search: shut for now'] });
  });

  it('eradicate: pending while a door is unpatched, a foothold is left or evidence came late; clean otherwise', () => {
    const r = run().at(0).start('ATK-08', 4);
    expect(grade(r).phases.eradicate).toEqual({ status: 'pending', evidence: ['dump customers through search: not patched'] });
    r.w.patches.pending.push({ patch: 'search', readyAt: 1 });
    expect(grade(r).phases.eradicate.evidence).toEqual(['dump customers through search: patch deploying']);
    r.w.patches.pending = [];
    r.w.patches.applied.push('search');
    r.w.accounts.push({ id: 327, email: 'support-ops@juice-sh.op', role: 'admin', createdBy: 'ATK-11' });
    expect(grade(r).phases.eradicate).toEqual({ status: 'pending', evidence: ['dump customers through search: patched', 'footholds left: hidden-admin'] });
    r.w.accounts.pop();
    expect(grade(r).phases.eradicate).toEqual({ status: 'clean', evidence: ['dump customers through search: patched'] });
  });

  it('recover: degraded while the plug is pulled, a feature is off past its patch, the shop is defaced, a tap drips or legal is owed', () => {
    const r = openRun();
    expect(grade(r).phases.recover).toEqual({ status: 'ok', evidence: [] });
    r.w.nginx = 'stopped';
    r.w.taps.open.push({ id: 'TAP-02', openedAt: 0, nextDripAt: 0, drips: 0 });
    r.w.defacements.push({ productId: 1, kind: 'deface', by: 'ATK-15' });
    r.w.features.search = false;
    delete r.w.comms.notifiedAt.legal;
    expect(grade(r).phases.recover).toEqual({ status: 'degraded', evidence: ['the plug is pulled (0 min so far)', 'search is still off though its patch is live', 'the shop is defaced', 'leaking: photo wall', 'legal not notified'] });
  });
});

describe('the gaps: every type has a test, the biggest stands first with how long it has stood', () => {
  it('door-uninvestigated: a soul door he opened with no look at its address or path since, until its patch lands', () => {
    const r = run().at(10 * REAL_S).start('ATK-08', 4, '203.0.113.85').at(20 * REAL_S);
    expect(grade(r).gap).toEqual({ type: 'door-uninvestigated', since: 10 * REAL_S });
    r.act({ type: 'DEF-01', query: 'grep 203.0.113.10 access.log', shown: ['203.0.113.10 - - "GET / HTTP/1.1" 200'] }); // not his address: not even relevant
    expect(gapTypes(grade(r))).toContain('door-uninvestigated');
    r.act({ type: 'DEF-01', query: 'grep 500 access.log', shown: ['203.0.113.85 - - [31/Oct/2026:22:10:05 +0000] "GET /rest/products/search?q=x HTTP/1.1" 500 197 "-" "Mozilla/5.0"'] }); // showed the door's own line
    expect(gapTypes(grade(r))).not.toContain('door-uninvestigated');
  });

  it('stage-unseen: a started stage with no relevant action after its first move', () => {
    const r = run().at(0).start('ATK-01', 1).act({ type: 'DEF-05', name: 'x' }).at(5 * REAL_S).look().at(10 * REAL_S).start('ATK-03', 2);
    expect(grade(r).gaps).toEqual([{ type: 'stage-unseen', since: 10 * REAL_S }]);
    r.act({ type: 'DEF-12', rule: { kind: 'sqli' } }).e({ kind: 'move-cut', move: 'ATK-03', variant: 'a', by: 'DEF-12' }); // the rule cut him: relevant (D-115 b)
    expect(grade(r).gaps).toEqual([]);
  });

  it('foothold-unqueried and planted-file-unchecked: a foothold in the world and no Users query (or uploads listing) since it was planted', () => {
    const r = run().at(0).act({ type: 'DEF-02', sql: 'SELECT * FROM Users', shown: ['jim@juice-sh.op'] }).at(10 * REAL_S).start('ATK-11', 5).land('ATK-11').at(20 * REAL_S).start('ATK-13', 5).land('ATK-13').at(30 * REAL_S);
    r.w.accounts.push({ id: 327, email: 'support-ops@juice-sh.op', role: 'admin', createdBy: 'ATK-11' });
    r.w.files.push({ path: 'complaints/x.zip', size: 1, sha256: 'a', plantedBy: 'ATK-13' });
    r.w.patches.applied.push('search');
    expect(grade(r).gaps.filter((g) => g.type !== 'stage-unseen')).toEqual([{ type: 'foothold-unqueried', since: 10 * REAL_S }, { type: 'planted-file-unchecked', since: 20 * REAL_S }]);
    r.act({ type: 'DEF-02', sql: 'SELECT * FROM Users WHERE role = "admin"', shown: ['admin@juice-sh.op|admin', 'support-ops@juice-sh.op|admin'] }); // showed the planted account
    expect(gapTypes(grade(r))).not.toContain('foothold-unqueried');
    r.act({ type: 'DEF-03', path: '/srv/juice-shop/uploads/complaints', shown: ['complaints/x.zip'] }); // showed the planted file
    expect(gapTypes(grade(r))).not.toContain('planted-file-unchecked');
    r.w.accounts.pop(); // removed: no foothold, no gap
    r.w.files.pop();
    expect(gapTypes(grade(r)).filter((t) => t.includes('foothold') || t.includes('planted'))).toEqual([]);
  });

  it('eradicated-without-evidence: changes made with no snapshot at all, until one is taken', () => {
    const r = run().at(0).start('ATK-13', 5).land('ATK-13').at(10 * REAL_S).act({ type: 'DEF-15', path: 'complaints/x.zip' }).at(20 * REAL_S);
    expect(gapTypes(grade(r))).toContain('eradicated-without-evidence');
    expect(grade(r).gaps.find((g) => g.type === 'eradicated-without-evidence')!.since).toBe(10 * REAL_S);
    r.act({ type: 'DEF-05', name: 'late' });
    expect(gapTypes(grade(r))).not.toContain('eradicated-without-evidence');
  });

  it('door-unpatched: a soul door he opened, its patch neither deployed nor deploying', () => {
    const r = run().at(10 * REAL_S).start('ATK-09', 4).at(20 * REAL_S).act({ type: 'DEF-01', query: 'grep /api/Users access.log', shown: [`${HIS_IP} - - "GET /api/Users/7 HTTP/1.1" 200 300 "-" "curl"`] });
    expect(grade(r).gaps).toEqual([{ type: 'door-unpatched', since: 10 * REAL_S }]);
    r.w.patches.pending.push({ patch: 'users-access', readyAt: 99 });
    expect(grade(r).gaps).toEqual([]);
  });

  it('breach-unconfirmed, then notification-due: souls taken with no confirmation, then confirmed with legal not told', () => {
    const r = run().at(0).start('ATK-08', 4).at(5 * REAL_S).steal('ATK-08', 2).at(10 * REAL_S).look(); // a look at his line, not at the harvest: no confirmation (D-116)
    r.w.patches.applied.push('search');
    expect(grade(r).gaps).toEqual([{ type: 'breach-unconfirmed', since: 5 * REAL_S }]);
    r.at(20 * REAL_S).apply({ type: 'DEF-19' });
    expect(grade(r).gaps).toEqual([{ type: 'notification-due', since: 20 * REAL_S }]);
    r.at(30 * REAL_S).apply({ type: 'DEF-20', to: 'legal' });
    expect(grade(r).gaps).toEqual([]);
  });

  it('defacement-live, tap-open, plug-pulled, feature-off-after-patch and move-uncontained read the world, with their start times', () => {
    const r = openRun();
    expect(grade(r).gaps).toEqual([]);
    r.at(100 * REAL_S).start('ATK-15', 6).land('ATK-15');
    r.w.defacements.push({ productId: 1, kind: 'deface', by: 'ATK-15' });
    r.w.taps.open.push({ id: 'TAP-01', openedAt: 70 * REAL_S, nextDripAt: 0, drips: 0 }, { id: 'TAP-02', openedAt: 80 * REAL_S, nextDripAt: 0, drips: 0 });
    r.at(110 * REAL_S).act({ type: 'DEF-11' });
    r.w.nginx = 'stopped';
    r.w.features.search = false;
    r.w.replays.push({ id: 9, owner: 'death', move: 'ATK-15', variant: 'a', ip: HIS_IP, recordedIp: HIS_IP, startedAt: 100 * REAL_S, cursor: 0 });
    expect(grade(r).gaps.filter((g) => g.type !== 'stage-unseen')).toEqual([
      { type: 'defacement-live', since: 100 * REAL_S },
      { type: 'tap-open', since: 70 * REAL_S },
      { type: 'plug-pulled', since: 110 * REAL_S },
      { type: 'feature-off-after-patch', since: 62 * REAL_S },
      { type: 'move-uncontained', since: 100 * REAL_S },
    ]);
    expect(grade(r).gaps.filter((g) => g.type !== 'stage-unseen')[0]).toEqual({ type: 'defacement-live', since: 100 * REAL_S });
    r.w.replays[0]!.frozenSince = 1; // a frozen move isn't running
    expect(gapTypes(grade(r))).not.toContain('move-uncontained');
  });

  it('every gap type the assessor knows is covered above', () => {
    expect([...GAP_TYPES]).toEqual(['door-uninvestigated', 'stage-unseen', 'foothold-unqueried', 'planted-file-unchecked', 'eradicated-without-evidence', 'door-unpatched', 'breach-unconfirmed', 'notification-due', 'defacement-live', 'tap-open', 'plug-pulled', 'feature-off-after-patch', 'move-uncontained']);
  });
});

describe('the assessor inside advance() (SYS-21)', () => {
  it('judges an action on the next tick, refreshes the snapshot once a real second and at the ending, and the state stays JSON-plain', () => {
    const w = initialWorld(1, 'medium');
    advance(w, FIXTURE_LIBRARY, 100);
    expect(w.assess.assessedAt).toBe(CONFIG.medium.tickGameMs);
    advance(w, FIXTURE_LIBRARY, 500);
    expect(w.assess.assessedAt).toBe(CONFIG.medium.tickGameMs); // not yet a second
    advance(w, FIXTURE_LIBRARY, 500);
    expect(w.assess.assessedAt).toBe(w.clock.gameMs);
    advance(w, FIXTURE_LIBRARY, 9000); // the scan has started: his address is known
    const scanIp = w.events.find((e) => e.kind === 'move-started')!.kind === 'move-started' ? (w.events.find((e) => e.kind === 'move-started') as { ip: string }).ip : '';
    applyAction(w, { type: 'DEF-01', query: 'tail access.log', shown: [`${scanIp} - - [x] "GET /w1 HTTP/1.1" 404 10 "-" "ffuf"`] });
    const at = w.clock.gameMs;
    advance(w, FIXTURE_LIBRARY, 100);
    expect(w.assess.lastRelevantActionAt).toBe(at); // judged at once
    expect(w.assess.relevant).toEqual([w.events.find((e) => e.kind === 'action')!.id]);
    expect(w.assess.assessedAt).toBeLessThanOrEqual(at); // the snapshot waits for the second
    expect(JSON.parse(JSON.stringify(w.assess))).toEqual(w.assess);
    w.ending = 'flatline';
    emit(w, { kind: 'ending', ending: 'flatline', souls: 0, heartbeat: 0 });
    stepAssess(w);
    expect(w.assess.assessedAt).toBe(w.clock.gameMs); // the ending refreshes at once
    expect(w.assess.facts[0]).toEqual({ label: 'Outcome', value: 'Flatline' });
  });

  it('the snapshot tracks the live run: the scan opens stage-unseen, a focused look closes it; the gap stands from the move start', () => {
    const w = initialWorld(1, 'medium');
    advance(w, FIXTURE_LIBRARY, 10_000);
    const start = w.events.find((e) => e.kind === 'move-started')!;
    expect(w.assess.gap).toMatchObject({ type: 'stage-unseen', since: start.t });
    expect(w.assess.phases.detect.status).toBe('behind');
    const ip = start.kind === 'move-started' ? start.ip : '';
    applyAction(w, { type: 'DEF-01', query: `grep ${ip} /var/log/nginx/access.log`, shown: [`${ip} - - [x] "GET /w1 HTTP/1.1" 404 10 "-" "ffuf"`] });
    advance(w, FIXTURE_LIBRARY, 1000);
    expect(w.assess.phases.detect.status).toBe('current');
    expect(w.assess.gaps.map((g) => g.type)).not.toContain('stage-unseen');
  });
});

describe('a player who only spams ls and pwd (D-114)', { timeout: WHOLE_RUN_TIMEOUT_MS }, () => {
  it('has no relevant action, every stage unseen, and a poor detect grade after eight real minutes', () => {
    const r = runSim({ seed: 1, library: FIXTURE_LIBRARY, maxRealMs: 8 * 60_000, player: (_w, t) => (t % 2000 === 0 ? [{ type: 'DEF-03', path: '/srv/juice-shop' }, { type: 'DEF-01', query: 'ls -la /var/log/nginx' }] : []) });
    const g = evaluate(r.world);
    expect(r.events.filter((e) => e.kind === 'action').length).toBeGreaterThan(400);
    expect(g.relevant).toEqual([]);
    expect(g.lastRelevantActionAt).toBe(0);
    expect(g.phases.detect.status).toBe('behind');
    expect(['D', 'F']).toContain(g.grades.detect);
    expect(r.world.assess.grades.detect).toBe(g.grades.detect); // the live snapshot agrees
  });
});
