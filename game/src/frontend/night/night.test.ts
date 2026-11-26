import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../../engine/log';
import { DURATION, SHAKE, WALK_SECONDS, handshake, prompt, startFlow, step, type Flow, type Input } from './flow';
import { ENDINGS, STAGE_BEAT, anomalies, danger, kiroVerdict, reaction, whatKiroSees, type Readings } from './judge';

const run = (f: Flow, ...inputs: Input[]) => inputs.reduce(step, f);
const wait = (f: Flow, s: number) => run(f, { kind: 'time', dt: s });

describe('the night-shift prologue, kept short (UI-10, D-223, D-224)', () => {
  it('runs through the dark, the eyes and the office to Kiro offering her hand, then waits for the player', () => {
    let f = startFlow();
    for (const p of ['dark', 'eyes', 'wake', 'approach', 'intro'] as const) {
      expect(f.phase).toBe(p);
      f = wait(f, (DURATION[p] ?? 0) + 0.01);
    }
    expect(f.phase).toBe('offer');
    expect(wait(f, 999).phase).toBe('offer');
    expect(prompt(f)).toBe('[E] Shake hand');
    const story = (['dark', 'eyes', 'wake', 'approach', 'intro'] as const).reduce((a, p) => a + (DURATION[p] ?? 0), 0);
    expect(story).toBeLessThanOrEqual(18);
  });

  it('E plays the handshake: the hands reach, close, pump twice and let go, then she leads on', () => {
    let f = run({ ...startFlow(), phase: 'offer' }, { kind: 'interact' });
    expect(f.phase).toBe('shake');
    expect(handshake(0)).toMatchObject({ reach: 0, grip: 0 });
    expect(handshake(SHAKE.reach)).toMatchObject({ reach: 1, grip: 0 });
    expect(handshake(SHAKE.grip).grip).toBe(1);
    expect(handshake((SHAKE.grip + SHAKE.pumpEnd) / 2).pump).toBeCloseTo(0.5, 6);
    expect(handshake(SHAKE.release).release).toBe(1);
    f = wait(f, (DURATION.shake ?? 0) + 0.01);
    expect(f.phase).toBe('after');
  });

  it('the player follows her with W and sits with E; the login waits for the run, the alarm for the first alert (D-243)', () => {
    let f = wait({ ...startFlow(), phase: 'after' }, (DURATION.after ?? 0) + 0.01);
    expect(f.phase).toBe('walk');
    f = run(f, { kind: 'walk', dt: WALK_SECONDS / 2 });
    expect(f.walked).toBeCloseTo(0.5, 6);
    f = run(f, { kind: 'walk', dt: WALK_SECONDS });
    expect(f.phase).toBe('seat');
    expect(run(f, { kind: 'time', dt: 99 }).phase).toBe('seat');
    f = run(f, { kind: 'interact' });
    expect(f.phase).toBe('sitting');
    f = wait(f, (DURATION.sitting ?? 0) + 0.01);
    expect(f.phase).toBe('login');
    expect(run(f, { kind: 'ready' }).phase).toBe('login');
    expect(run(f, { kind: 'alarm' }).phase).toBe('login');
    f = wait(f, 99);
    expect(f.phase).toBe('login');
    f = run(f, { kind: 'ready' });
    expect(f.phase).toBe('shift');
    expect(wait(f, 99).phase).toBe('shift');
    f = run(f, { kind: 'alarm' });
    expect(f.phase).toBe('alarm');
    expect(wait(f, (DURATION.alarm ?? 0) + 0.01).phase).toBe('shift');
    expect(run(startFlow(), { kind: 'skip' }).phase).toBe('shift');
  });
});

const calm: Readings = { nginx: 'running', requests: 40, clientErrors: 2, serverErrors: 0, openAlerts: 0, heartbeat: 100, heartbeatMax: 100, logins: 3, loginFailures: 0, top: { ip: '198.51.100.23', requests: 6, errors: 0 }, toolAgents: 0 };
const scan: Readings = { ...calm, requests: 120, clientErrors: 78, top: { ip: '203.0.113.9', requests: 80, errors: 76 } };
/** Juice Shop answers unknown paths with 200: a directory scan is one address and a tool's name, not errors. */
const fuzz: Readings = { ...calm, requests: 2600, top: { ip: '203.0.113.11', requests: 2585, errors: 4 }, toolAgents: 2585, toolName: 'Fuzz Faster U Fool' };

describe("Kiro reads the live numbers when she has no hint to give (D-224)", () => {
  it('finds nothing in quiet traffic, and names what stands out in a scan', () => {
    expect(anomalies(calm)).toEqual([]);
    expect(anomalies(scan)[0]).toBe('one address, 203.0.113.9, made 80 requests and 76 of them failed');
    expect(anomalies({ ...calm, openAlerts: 2, nginx: 'stopped', loginFailures: 9 })).toEqual(['the web server is down', '2 alerts are open', '9 failed logins']);
    expect(anomalies(fuzz)).toEqual(['one address, 203.0.113.11, made 2585 requests in a minute', '2585 requests came from a tool that names itself: Fuzz Faster U Fool']);
  });

  it('says what she sees, never what to do', () => {
    expect(whatKiroSees(fuzz)).toMatch(/^Here's what I see: one address, 203\.0\.113\.11/);
    expect(whatKiroSees(calm)).toMatch(/Quiet\. Don't trust it\.$/);
    expect(whatKiroSees(fuzz)).not.toMatch(/block|iptables|firewall|lock|patch/i);
  });
});

describe('the room reacts to the engine, and the endings are the engine\'s', () => {
  it('rates how close the run is to its end from the meters alone', () => {
    expect(danger(100, 0, 312)).toBe(0);
    expect(danger(34, 0, 312)).toBe(1);
    expect(danger(80, 210, 312)).toBe(2);
    expect(danger(10, 0, 312)).toBe(3);
    expect(danger(100, 0, 0)).toBe(0);
  });

  it('gives each of the six stages its own beat, and each event its sound', () => {
    expect(Object.values(STAGE_BEAT)).toEqual(['window-shadow', 'monitor-face', 'lights-dim', 'ghosts', 'reflection', 'crimson']);
    const ev = (body: object) => ({ t: 0, id: 1, ...body }) as GameEvent;
    expect(reaction(ev({ kind: 'move-started', move: 'ATK-06', variant: 'a', stage: 3, ip: '1.2.3.4' }))).toEqual({ beat: 'lights-dim', cue: 'login' });
    expect(reaction(ev({ kind: 'souls-stolen', by: 'ATK-08', count: 3, stolen: 3, total: 312 }))).toEqual({ beat: 'drain', cue: 'theft' });
    expect(reaction(ev({ kind: 'move-cut', move: 'ATK-08', variant: 'a', by: 'DEF-12' }))).toEqual({ beat: 'recoil', cue: 'recovery' });
    expect(reaction(ev({ kind: 'action', action: { type: 'DEF-01', query: 'x' }, ok: true }))).toEqual({});
  });

  it('words every ending the engine can reach, and judges the report from its grades', () => {
    expect(Object.keys(ENDINGS).sort()).toEqual(['banished', 'clean-handover', 'flatline', 'return', 'rough-handover', 'souls-lost', 'walked-away']);
    expect(ENDINGS.banished).toMatchObject({ won: true, title: 'Death banished', line: 'The system survived. Did you?' });
    for (const e of ['souls-lost', 'flatline', 'return'] as const) expect(ENDINGS[e].scene).toBe('taken');
    expect(kiroVerdict({ detect: 'A', contain: 'B', eradicate: 'B', recover: 'D' })).toMatch(/followed the evidence/);
    expect(kiroVerdict({ detect: 'C', contain: 'F', eradicate: 'B', recover: 'D' })).toMatch(/panicked/);
  });
});
