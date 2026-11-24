import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DRAFTS, OFFLINE_ANSWER, debriefTemplate, hintsFor } from '../content/kiro-fallback';
import { Engine } from '../engine/engine';
import { buildReport } from '../engine/report';
import { WHOLE_RUN_TIMEOUT_MS } from '../engine/test-fixtures/timeouts';
import { createShell } from '../shell';
import { createKiro, pickDraft } from './client';
import { GAP_WORDS } from './gaps';

const baseline = () => readFileSync(new URL('../recordings/juiceshop.sqlite', import.meta.url));

/** A fake server: answers every POST from `replies` by path, or fails the way the real one would when down. */
function fakeFetch(replies: Record<string, (body: Record<string, unknown>) => { status?: number; json?: unknown } | 'down' | 'hang'>): { fetch: typeof fetch; calls: Array<{ path: string; body: Record<string, unknown> }> } {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = url.slice(url.lastIndexOf('/') + 1);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    calls.push({ path, body });
    const r = replies[path]?.(body) ?? 'down';
    if (r === 'down') throw new TypeError('fetch failed');
    if (r === 'hang') return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetch: f, calls };
}

const ok = (json: unknown) => () => ({ json });

describe('the Kiro client (SYS-12, KIRO-09, D-190)', () => {
  it('falls back to CON-03 for every call when the server is down, and labels it offline', async () => {
    const engine = new Engine({ seed: 1, difficulty: 'medium' });
    engine.advance(5000);
    const { fetch, calls } = fakeFetch({});
    const kiro = createKiro(engine, { fetch, timeoutMs: 500 });
    expect(await kiro.ask('who is that?')).toEqual({ text: OFFLINE_ANSWER, offline: true });
    expect(await kiro.explain('1.2.3.4 - - [x] "GET / HTTP/1.1" 200 1 "-" "-"')).toEqual({ text: OFFLINE_ANSWER, offline: true });
    const d = await kiro.draft('who is making the most requests');
    expect(d.offline).toBe(true);
    expect(d.lines).toEqual([...DRAFTS[0]!.lines]);
    const report = await buildReport(engine.world);
    const facts = { facts: report.facts, grades: report.grades, mistakes: report.mistakes, missed: report.missed };
    expect(await kiro.debrief(report)).toEqual({ text: debriefTemplate(facts), offline: true });
    expect(kiro.online).toBe(false);
    expect(kiro.calls).toBe(0);
    expect(calls.every((c) => c.path === 'run')).toBe(true); // it keeps trying to start a run; it never sends a call without one
  });

  it('falls back when the server hangs past the client timeout', async () => {
    const engine = new Engine({ seed: 1, difficulty: 'medium' });
    const { fetch } = fakeFetch({ run: ok({ token: 't1' }), ask: () => 'hang' });
    const kiro = createKiro(engine, { fetch, timeoutMs: 100 });
    const r = await kiro.ask('hello?');
    expect(r).toEqual({ text: OFFLINE_ANSWER, offline: true });
  });

  it('sends the run token and a spoiler-free snapshot with every call, and shows a clean online answer', async () => {
    const engine = new Engine({ seed: 2, difficulty: 'easy' });
    engine.advance(20_000);
    const { fetch, calls } = fakeFetch({ run: ok({ token: 'tok' }), ask: ok({ text: 'That address made the most requests.', offline: false, latencyMs: 5 }) });
    const kiro = createKiro(engine, { fetch });
    expect(await kiro.ask('who?')).toEqual({ text: 'That address made the most requests.', offline: false });
    expect(kiro.online).toBe(true);
    expect(kiro.calls).toBe(1);
    const ask = calls.find((c) => c.path === 'ask')!;
    expect(ask.body.token).toBe('tok');
    expect(ask.body.question).toBe('who?');
    const snapshot = ask.body.snapshot as { difficulty: string; logs: { access: string[] } };
    expect(snapshot.difficulty).toBe('easy');
    expect(JSON.stringify(snapshot)).not.toMatch(/\b(ATK|MIN|TAP)-\d\d\b/);
  });

  it('re-checks the server\'s text: a dirty answer, hint, draft or debrief falls back even when the server said online', async () => {
    const engine = new Engine({ seed: 2, difficulty: 'easy' });
    engine.advance(20_000);
    const report = await buildReport(engine.world);
    const { fetch } = fakeFetch({
      run: ok({ token: 'tok' }),
      ask: ok({ text: 'Per PRD DEF-06, block it.', offline: false }),
      draft: ok({ lines: ['sudo rm -rf /', 'docker ps'], offline: false }),
      debrief: ok({ text: 'Great job. 99 of 100.', offline: false }),
    });
    const kiro = createKiro(engine, { fetch });
    expect((await kiro.ask('?')).offline).toBe(true);
    expect((await kiro.draft('anything')).offline).toBe(true);
    expect((await kiro.debrief(report)).offline).toBe(true);
  });

  it('on Easy, hints once per open alert (volunteered); on Medium only while the struggle detector has unlocked one', async () => {
    const easy = new Engine({ seed: 3, difficulty: 'easy' });
    while (easy.world.alerts.length === 0 && easy.world.clock.gameMs < 60 * 60_000) easy.advance(1000);
    expect(easy.world.alerts.length).toBeGreaterThan(0);
    const alert = easy.world.alerts[0]!;
    const { fetch, calls } = fakeFetch({ run: ok({ token: 'tok' }), hint: (b) => ({ json: { text: `Count requests per address (gap ${String(b.gap)}).`, offline: false } }) });
    const kiroEasy = createKiro(easy, { fetch });
    const h1 = await kiroEasy.hint();
    expect(h1?.offline).toBe(false);
    expect(await kiroEasy.hint()).toBeNull(); // the same alert: no second hint
    const sent = calls.find((c) => c.path === 'hint')!.body;
    expect(sent.fallback).toBe(hintsFor(alert.about as 'ATK-01', 'easy')[0]);
    expect(JSON.stringify(sent.snapshot)).not.toMatch(/\b(ATK|MIN|TAP)-\d\d\b/);

    const medium = new Engine({ seed: 3, difficulty: 'medium' });
    const kiroMedium = createKiro(medium, { fetch });
    expect(await kiroMedium.hint()).toBeNull(); // nothing unlocked
    medium.world.struggle.suggestions = 1; // what SYS-13 does when the player is stuck (a test-only poke)
    medium.world.assess.gap = { type: 'stage-unseen', since: 0 };
    const h2 = await kiroMedium.hint();
    expect(h2?.offline).toBe(false);
    expect(await kiroMedium.hint()).toBeNull();
  }, WHOLE_RUN_TIMEOUT_MS);

  it('a hint that names a fix is replaced by the alert\'s CON-03 text, or the gap\'s words when no alert is open', async () => {
    const medium = new Engine({ seed: 3, difficulty: 'medium' });
    medium.world.struggle.suggestions = 2;
    medium.world.assess.gap = { type: 'foothold-unqueried', since: 0 };
    const { fetch } = fakeFetch({ run: ok({ token: 'tok' }), hint: ok({ text: 'Deploy the patch and revoke sessions.', offline: false }) });
    const kiro = createKiro(medium, { fetch });
    expect(await kiro.hint()).toEqual({ text: GAP_WORDS['foothold-unqueried'], offline: true });
  });

  it('applyDraft runs a draft through the shell on Easy only, never with a placeholder left in', async () => {
    const easy = new Engine({ seed: 1, difficulty: 'easy', baseline: baseline() });
    const shell = createShell(easy);
    const { fetch } = fakeFetch({});
    const kiro = createKiro(easy, { fetch, timeoutMs: 100 });
    const draft = await kiro.draft('status codes at a glance');
    expect(draft.offline).toBe(true);
    const applied = await kiro.applyDraft(shell, draft);
    expect(applied.ok).toBe(true);
    expect(applied.outputs).toHaveLength(draft.lines.length);
    const withPlaceholder = await kiro.applyDraft(shell, { title: 'x', why: '', lines: ['whois <ip>'], stripped: 0, offline: true });
    expect(withPlaceholder.ok).toBe(false);
    expect(withPlaceholder.message).toContain('<ip>');

    const medium = new Engine({ seed: 1, difficulty: 'medium', baseline: baseline() });
    const refused = await createKiro(medium, { fetch, timeoutMs: 100 }).applyDraft(createShell(medium), draft);
    expect(refused.ok).toBe(false);
    expect(refused.outputs).toEqual([]);
  });

  it('pickDraft finds the offline draft nearest a goal', () => {
    expect(pickDraft('snapshot the evidence before I change anything').id).toBe('snapshot');
    expect(pickDraft('which user agents are the busiest').id).toBe('top-agents');
    expect(pickDraft('').id).toBe(DRAFTS[0]!.id);
  });
});
