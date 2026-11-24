// The Kiro panel's client (PRD SYS-12, KIRO-01..06, KIRO-09; ENGINE_API §5; D-190): the `Kiro` interface the screens
// use, over the Kiro server's HTTP API (game/server/). Every call sends the spoiler-free snapshot (snapshot.ts);
// the server runs the real Kiro on rails and answers with text already checked (rails.ts). When the server is
// unreachable, slow, out of budget or says `offline`, the rule-written CON-03 text shows instead, labelled
// "Kiro (offline)". The client checks the server's text once more (rails.ts) before showing it: belt and braces.
// Nothing here calls `engine.advance`, `pause` or `resume`: the screen owns the clock. The game never waits for Kiro.
import type { Report } from '../engine/report';
import { DRAFTS, HINT_POLICY, OFFLINE_ANSWER, debriefTemplate, hintsFor, type Draft } from '../content/kiro-fallback';
import type { Shell } from '../shell';
import { gapWords } from './gaps';
import { debriefMatches, guardDraft, hintIsClean, replyIsClean } from './rails';
import { buildSnapshot, type KiroSnapshot } from './snapshot';
import type { Engine } from '../engine/engine';

export interface KiroReply {
  text: string;
  offline: boolean; // true: the rule-written text; label it "Kiro (offline)"
}

export interface KiroDraft {
  title: string;
  why: string;
  lines: string[]; // every line parses as a listed shell command (KIRO-08); the player copies or types them
  stripped: number; // lines Kiro wrote that the shell does not run (shown as a count, never as text)
  offline: boolean;
}

/** ENGINE_API §5's interface, plus `draft` (KIRO-02), `debrief` (KIRO-06) and `applyDraft` (KIRO-04). */
export interface Kiro {
  ask(question: string): Promise<KiroReply>; // chat; 5–20 s on purpose (KIRO-01)
  hint(): Promise<KiroReply | null>; // the rules decide when (SYS-13, KIRO-03); null = none now
  explain(line: string): Promise<KiroReply>; // "explain this log line" (KIRO-05)
  draft(goal: string): Promise<KiroDraft>; // a script the player runs themselves (KIRO-02)
  debrief(report: Report): Promise<KiroReply>; // the post-incident write-up around SYS-11's facts (KIRO-06)
  /** KIRO-04, Easy only: runs a draft through the shell, line by line, when the player clicks. Never automatic. */
  applyDraft(shell: Shell, draft: KiroDraft): Promise<{ ok: boolean; outputs: string[]; message?: string }>;
  /** True once the server has answered a call this run, false once it has failed one; for the panel's label. */
  readonly online: boolean;
  /** Calls the server has accepted this run (KIRO-10's per-run cap counts down from 60). */
  readonly calls: number;
}

export interface KiroClientOptions {
  baseUrl?: string; // default '' (same origin: Vite proxies /api/kiro/* in dev, the server serves dist in prod)
  fetch?: typeof fetch; // for tests
  timeoutMs?: number; // the client gives up a little after the server's own 25 s (KIRO-09)
  difficulty?: 'easy' | 'medium' | 'hard'; // default engine.world.difficulty
}

export const CLIENT_TIMEOUT_MS = 30_000;

type Difficulty = 'easy' | 'medium' | 'hard';

interface RunHandle {
  token: string;
}

/** The offline draft that fits a goal best: the one whose title and reason share the most words with it. */
export function pickDraft(goal: string): Draft {
  const words = new Set(goal.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  let best: Draft = DRAFTS[0]!;
  let bestScore = -1;
  for (const d of DRAFTS) {
    const own = `${d.id} ${d.title} ${d.why}`.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const score = own.filter((w) => w.length > 2 && words.has(w)).length;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

export function createKiro(engine: Engine, opts: KiroClientOptions = {}): Kiro {
  const base = opts.baseUrl ?? '';
  const doFetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = opts.timeoutMs ?? CLIENT_TIMEOUT_MS;
  const difficulty: Difficulty = opts.difficulty ?? engine.world.difficulty;
  let run: Promise<RunHandle | null> | undefined;
  let online = false;
  let calls = 0;
  let hintsGiven = 0;
  const hintedAlerts = new Set<number>();

  async function post<T>(path: string, body: unknown): Promise<T | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await doFetch(`${base}/api/kiro/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        online = false;
        return null;
      }
      return (await res.json()) as T;
    } catch {
      online = false;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function getRun(): Promise<RunHandle | null> {
    run ??= post<{ token: string }>('run', { difficulty }).then((r) => (r && typeof r.token === 'string' ? { token: r.token } : null));
    return run;
  }

  /** The snapshot sent with the latest call: the debrief rail may allow the numbers Kiro saw in it (D-191). */
  let lastSnapshot: KiroSnapshot | undefined;

  /**
   * One call on the run: null when the server is unreachable, refused it or the run could not start. A call the
   * server accepted is logged in the world (`engine.noteKiro`, D-191: the report counts them), with the credits
   * Kiro reported when it answered; a fallback answer (`offline`) is still a call made.
   */
  async function call<T extends { offline?: boolean; credits?: number }>(path: string, body: Record<string, unknown>): Promise<T | null> {
    const handle = await getRun();
    if (!handle) {
      run = undefined; // try to start a run again next time
      return null;
    }
    const snapshot: KiroSnapshot = buildSnapshot(engine);
    lastSnapshot = snapshot;
    const res = await post<T>(path, { token: handle.token, snapshot, ...body });
    if (res === null) return null;
    calls += 1;
    online = !res.offline;
    engine.noteKiro(path === 'ask' ? 'chat' : (path as 'hint' | 'explain' | 'draft' | 'debrief'), typeof res.credits === 'number' ? res.credits : undefined);
    return res;
  }

  function newestOpenAlert(): { id: number; about: string } | undefined {
    const open = engine.world.alerts.filter((a) => a.closedAt === undefined);
    const a = open.length > 0 ? open.reduce((x, y) => (y.openedAt >= x.openedAt ? y : x)) : undefined;
    return a && { id: a.id, about: a.about };
  }

  /** The rule-written hint for now: the newest open alert's CON-03 text, else the gap's words (gaps.ts). */
  function fallbackHint(gap: string | undefined): string | undefined {
    const alert = newestOpenAlert();
    if (alert && alert.about !== 'CUST') return hintsFor(alert.about as Parameters<typeof hintsFor>[0], difficulty)[0];
    return gapWords(gap);
  }

  const kiro: Kiro = {
    get online() {
      return online;
    },
    get calls() {
      return calls;
    },

    async ask(question) {
      const res = await call<{ text: string; offline: boolean }>('ask', { question });
      if (res && !res.offline && typeof res.text === 'string' && replyIsClean(res.text)) return { text: res.text, offline: false };
      return { text: OFFLINE_ANSWER, offline: true };
    },

    async explain(line) {
      const res = await call<{ text: string; offline: boolean }>('explain', { line });
      if (res && !res.offline && typeof res.text === 'string' && replyIsClean(res.text)) return { text: res.text, offline: false };
      return { text: OFFLINE_ANSWER, offline: true };
    },

    async hint() {
      const w = engine.world;
      const gap = w.assess.gap?.type;
      // The rules decide when (KIRO-03, SYS-13): Easy volunteers one per open alert; Medium and Hard answer only
      // while the struggle detector has unlocked more suggestions than hints given (ENGINE_API §2).
      if (HINT_POLICY[difficulty] === 'volunteered') {
        const alert = newestOpenAlert();
        if (!alert || hintedAlerts.has(alert.id)) return null;
        hintedAlerts.add(alert.id);
      } else {
        if (w.struggle.suggestions <= hintsGiven) return null;
        hintsGiven += 1;
      }
      const fallback = fallbackHint(gap);
      const res = await call<{ text: string; offline: boolean }>('hint', { gap, fallback });
      if (res && !res.offline && typeof res.text === 'string' && hintIsClean(res.text, gap)) return { text: res.text, offline: false };
      return fallback === undefined ? null : { text: fallback, offline: true };
    },

    async draft(goal) {
      const res = await call<{ title?: string; why?: string; lines: string[]; stripped?: number; offline: boolean }>('draft', { goal });
      if (res && !res.offline && Array.isArray(res.lines)) {
        const guarded = guardDraft(res.lines.join('\n')); // the server already did this; a second pass costs nothing
        if (guarded.lines.length > 0) {
          return {
            title: typeof res.title === 'string' ? res.title : 'Kiro\'s draft',
            why: typeof res.why === 'string' ? res.why : '',
            lines: guarded.lines,
            stripped: (typeof res.stripped === 'number' ? res.stripped : 0) + guarded.stripped.length,
            offline: false,
          };
        }
      }
      const d = pickDraft(goal);
      return { title: d.title, why: d.why, lines: [...d.lines], stripped: 0, offline: true };
    },

    async debrief(report) {
      const facts = { facts: report.facts, grades: report.grades, mistakes: report.mistakes, missed: report.missed };
      const res = await call<{ text: string; offline: boolean }>('debrief', { report: facts });
      if (res && !res.offline && typeof res.text === 'string' && debriefMatches(res.text, facts, lastSnapshot)) return { text: res.text, offline: false };
      return { text: debriefTemplate(facts), offline: true };
    },

    async applyDraft(shell, draft) {
      if (difficulty !== 'easy') return { ok: false, outputs: [], message: 'Kiro only applies a draft on Easy.' };
      const outputs: string[] = [];
      for (const line of draft.lines) {
        if (line.includes('<')) return { ok: false, outputs, message: `Fill in ${line.match(/<[^>]+>/)?.[0] ?? 'the placeholder'} first.` };
        const r = await shell.run(line);
        outputs.push(r.output);
        if (r.exitCode !== undefined && r.exitCode !== 0) return { ok: false, outputs, message: `Stopped at: ${line}` };
      }
      return { ok: true, outputs };
    },
  };
  return kiro;
}

export type { KiroSnapshot };
