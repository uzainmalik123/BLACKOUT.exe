import initSqlJs from 'sql.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MOVES } from '../rules/moves';
import { MINION_IDS, TAP_IDS, type Difficulty } from '../rules/vocabulary';
import {
  ALERT_HINTS, DRAFTS, DRILL_COMPLETE, HINT_POLICY, MOVE_HINTS, OFFLINE_ANSWER, OPENING_TUTORIAL, TRAINING_STEPS, debriefTemplate, hintsFor,
  type DebriefInput, type TutorialPanel,
} from './kiro-fallback';

const LEVELS: readonly Difficulty[] = ['easy', 'medium', 'hard'];

/** The shell's command list, read from the steering file the in-game Kiro is held to (SYS-09, KDEV-01). */
const steering = readFileSync(fileURLToPath(new URL('../../../.kiro/steering/game-shell.md', import.meta.url)), 'utf8');
const COMMANDS = new Set(/Only these commands exist:\s*\n\s*`([^`]+)`/.exec(steering)![1]!.split(/\s+/));

/** Splits a command line on unquoted `|` into commands, dropping an unquoted `> file` redirect. Quote-aware. */
function segments(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | undefined;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = undefined;
      cur += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
    } else if (ch === '|') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.replace(/\s>\s*\S+\s*$/, '').trim());
}

/** Words that name the action closing one of Death's moves (PRD §3 "Stopped by"). A move hint may use none (KIRO-03). */
const CLOSING_ACTION =
  /\b(deploy\w*|patch\w*|rate.?limit\w*|revok\w*|iptables|waf|firewall|block\w*|disabl\w*|off|delet\w*|remov\w*|restor\w*|backups?|lock\w*|force\w*|rotat\w*|flags?|consoles?|rules?|notif\w*|captcha|rm)\b/i;
const INTERNAL_ID = /\b(ATK|MIN|DEF|TAP|SYS|KIRO|CUST|CON|REC|UI|KI|D)-\d+\b|\bCUST\b/;

const moveHints = Object.values(MOVE_HINTS).flatMap((h) => [...h.easy, ...h.medium, ...h.hard]);
const allHints = [...moveHints, ...Object.values(ALERT_HINTS).flatMap((h) => [...h.easy, ...h.medium, ...h.hard])];

describe("Kiro's offline hints (CON-03, KIRO-03)", () => {
  it('has hints at every level for every move, minion and leaky tap', () => {
    for (const m of MOVES) for (const level of LEVELS) expect(MOVE_HINTS[m.id][level].length, `${m.id} ${level}`).toBeGreaterThan(0);
    for (const id of [...MINION_IDS, ...TAP_IDS]) for (const level of LEVELS) expect(ALERT_HINTS[id][level].length, `${id} ${level}`).toBeGreaterThan(0);
    expect(Object.keys(MOVE_HINTS).sort()).toEqual(MOVES.map((m) => m.id).sort());
  });

  it('routes an alert to its hints', () => {
    expect(hintsFor('ATK-08', 'medium')).toBe(MOVE_HINTS['ATK-08'].medium);
    expect(hintsFor('MIN-02', 'easy')).toBe(ALERT_HINTS['MIN-02'].easy);
    expect(hintsFor('TAP-01', 'hard')).toBe(ALERT_HINTS['TAP-01'].hard);
  });

  it('Easy says the most; Medium and Hard are short (Hard is said only when asked)', () => {
    for (const h of Object.values({ ...MOVE_HINTS, ...ALERT_HINTS })) {
      const len = (xs: readonly string[]) => Math.max(...xs.map((x) => x.length));
      expect(len(h.easy)).toBeGreaterThan(len(h.medium));
      expect(len(h.easy)).toBeGreaterThan(len(h.hard));
      expect(len(h.medium)).toBeLessThanOrEqual(160);
      expect(len(h.hard)).toBeLessThanOrEqual(120);
    }
    expect(HINT_POLICY).toEqual({ easy: 'volunteered', medium: 'when-stuck', hard: 'on-request' });
  });

  it('never names the action that closes one of Death\'s moves', () => {
    for (const [id, h] of Object.entries(MOVE_HINTS)) {
      for (const text of [...h.easy, ...h.medium, ...h.hard]) expect(text, `${id}: ${text}`).not.toMatch(CLOSING_ACTION);
    }
  });

  it('never names an internal id', () => {
    for (const text of [...allHints, OFFLINE_ANSWER]) expect(text).not.toMatch(INTERNAL_ID);
  });
});

describe("Kiro's offline drafts (CON-03, KIRO-02)", () => {
  it('reads the same command list from the steering file as PRD SYS-09 names', () => {
    const prd = readFileSync(fileURLToPath(new URL('../../../docs/PRD.md', import.meta.url)), 'utf8');
    const row = /\| SYS-09 \|[^|]*\|[^`]*Commands: `([^`]+)`/.exec(prd)![1]!.split(/\s+/);
    expect([...COMMANDS].sort()).toEqual(row.sort());
  });

  it.each(DRAFTS.map((d) => [d.id, d] as const))('%s uses only the shell\'s listed commands and none of what it lacks', (_id, d) => {
    expect(d.lines.length).toBeGreaterThan(0);
    for (const line of d.lines) {
      expect(line, line).not.toMatch(/&&|;|\$\(|`|\bsudo\b|\|\|/);
      for (const seg of segments(line)) expect(COMMANDS.has(seg.split(/\s+/)[0]!), `${seg} in ${line}`).toBe(true);
    }
    expect(`${d.title} ${d.why}`).not.toMatch(INTERNAL_ID);
  });

  it('ids are unique', () => {
    expect(new Set(DRAFTS.map((d) => d.id)).size).toBe(DRAFTS.length);
  });

  it('every SQL a draft runs works on the baseline database', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database(readFileSync(fileURLToPath(new URL('../recordings/juiceshop.sqlite', import.meta.url))));
    try {
      const statements = DRAFTS.flatMap((d) => d.lines).flatMap((l) => [.../^sqlite3 .* "([^"]+)"$/.exec(l)?.slice(1) ?? []]);
      expect(statements.length).toBeGreaterThan(0);
      for (const sql of statements) expect(() => db.exec(sql), sql).not.toThrow();
    } finally {
      db.close();
    }
  });
});

describe("Kiro's offline debrief (CON-03, KIRO-06)", () => {
  const report: DebriefInput = {
    facts: [
      { label: 'Time to notice', value: '00:14:30' },
      { label: 'Souls lost', value: '41 of 312' },
      { label: 'Downtime caused', value: '6 game minutes' },
    ],
    grades: { detect: 'B', contain: 'C', eradicate: 'A', recover: 'F' },
    mistakes: [{ title: 'Logged everyone out before finding every foothold', why: 'It warned the attacker and changed nothing: the hidden account still worked.' }],
    missed: ['A staff-looking admin account created during the incident'],
  };

  it('quotes every fact and grade exactly as the report gives them', () => {
    const text = debriefTemplate(report);
    for (const f of report.facts) expect(text).toContain(`**${f.label}:** ${f.value}`);
    expect(text).toContain('**Detection: B.**');
    expect(text).toContain('**Containment: C.**');
    expect(text).toContain('**Eradication: A.**');
    expect(text).toContain('**Recovery: F.**');
    for (const m of report.mistakes) expect(text).toContain(m.why);
    for (const m of report.missed) expect(text).toContain(m);
  });

  it('adds no number the report does not contain', () => {
    const text = debriefTemplate(report);
    const given = new Set(JSON.stringify(report).match(/\d+(?::\d+)*/g));
    for (const n of text.match(/\d+(?::\d+)*/g) ?? []) expect(given.has(n), n).toBe(true);
  });

  it('handles a clean run', () => {
    const text = debriefTemplate({ ...report, mistakes: [], missed: [] });
    expect(text).toContain('No mistakes were recorded.');
    expect(text).toContain('Nothing the attacker left behind was missed.');
    expect(text).not.toMatch(INTERNAL_ID);
  });
});

describe("Kiro's tutorial texts (CON-03 extended, D-238)", () => {
  /** Words that would give away Death, his techniques or how the real shift is won (playtest round 1 design, anti-goals). */
  const SPOILER =
    /\b(death|reaper|minions?|footholds?|backdoors?|taps?|quiet\w*|proxy|proxies|tamper\w*|return\w*|gates?|harvest\w*|soul doors?|banish\w*|sqlmap|hydra|ffuf|union|select|admin\w*)\b/i;
  /** The word each panel goes by in the text, so a step that points at a panel also names it. */
  const PANEL_WORD: Readonly<Record<TutorialPanel, RegExp>> = {
    logs: /\blog\b/i, alerts: /\balerts?\b/i, meters: /\bmeters\b/i, terminal: /\bterminal\b/i, dock: /\bdock\b/i,
    'top-talkers': /\btop talkers\b/i, 'cheat-sheet': /\bcheat sheet\b/i, waf: /\bWAF console\b/, 'feature-flags': /\bfeature flags console\b/i,
    deploy: /\bdeploy console\b/i, backups: /\bbackups and evidence console\b/i, kiro: /\bKiro\b/,
  };
  /** The shell's commands plus DEF-21's `flag` (SYS-22's stream adds it to the steering list; until then it is named here). */
  const TUTORIAL_COMMANDS = new Set([...COMMANDS, 'flag']);
  const READ_ONLY = new Set(['ls', 'cat', 'head', 'tail', 'grep', 'awk', 'sort', 'uniq', 'wc', 'cut', 'file', 'sha256sum', 'whois', 'help', 'man']);
  const commandsIn = (text: string) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

  const texts: Array<[string, string]> = [
    ...LEVELS.flatMap((level) =>
      OPENING_TUTORIAL[level].flatMap((s) => s.lines.map((l, i): [string, string] => [`opening ${level} ${s.id} ${i + 1}`, l]))),
    ...TRAINING_STEPS.flatMap((s) => [
      ...s.lines.map((l, i): [string, string] => [`training ${s.id} ${i + 1}`, l]),
      [`training ${s.id} done`, s.done] as [string, string],
    ]),
    ['drill complete title', DRILL_COMPLETE.title],
    ...DRILL_COMPLETE.learned.map((l, i): [string, string] => [`drill complete ${i + 1}`, l]),
    ['drill complete next', DRILL_COMPLETE.next],
  ];

  it.each(texts)('%s: no spoiler, no internal id, only real commands', (_name, text) => {
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toMatch(SPOILER);
    expect(text).not.toMatch(INTERNAL_ID);
    for (const cmd of commandsIn(text)) {
      expect(cmd, cmd).not.toMatch(/&&|;|\$\(|\bsudo\b|\|\|/);
      for (const seg of segments(cmd)) expect(TUTORIAL_COMMANDS.has(seg.split(/\s+/)[0]!), `${seg} in ${text}`).toBe(true);
    }
  });

  it('the opening: Easy walks log, alerts, meters, terminal, dock; Medium three lines; Hard the one line', () => {
    expect(OPENING_TUTORIAL.easy.map((s) => s.panels[0])).toEqual(['logs', 'alerts', 'meters', 'terminal', 'dock']);
    expect(OPENING_TUTORIAL.medium.flatMap((s) => s.lines)).toHaveLength(3);
    expect(OPENING_TUTORIAL.hard.flatMap((s) => s.lines)).toEqual(['Change freeze is on until an incident is declared. Look around.']);
    for (const s of OPENING_TUTORIAL.medium) for (const l of s.lines) expect(l.length).toBeLessThanOrEqual(160);
  });

  it("the opening's terminal step offers exactly one safe, read-only command", () => {
    const cmds = OPENING_TUTORIAL.easy.find((s) => s.id === 'terminal')!.lines.flatMap(commandsIn);
    expect(cmds).toHaveLength(1);
    for (const seg of segments(cmds[0]!)) expect(READ_ONLY.has(seg.split(/\s+/)[0]!), seg).toBe(true);
  });

  it('every step names each panel it points at, so the highlight and the words agree', () => {
    const steps = [...LEVELS.flatMap((l) => OPENING_TUTORIAL[l]), ...TRAINING_STEPS];
    for (const s of steps) {
      const text = [...s.lines, ...('done' in s ? [s.done] : [])].join(' ');
      for (const p of s.panels) expect(text, `${s.id} names ${p}`).toMatch(PANEL_WORD[p]);
    }
  });

  it('the training shift runs the six steps in order and calls itself a drill', () => {
    expect(TRAINING_STEPS.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 5, 6]);
    expect(new Set(TRAINING_STEPS.map((s) => s.id)).size).toBe(TRAINING_STEPS.length);
    expect(TRAINING_STEPS[0]!.lines[0]).toMatch(/^This is a drill\./);
    expect(DRILL_COMPLETE.title).toBe('Drill complete');
  });

  it('each training step names the tool that does its action', () => {
    const tool: Readonly<Record<string, RegExp>> = {
      flag: /flag on its row|`flag <ip>`/, block: /block on its row|`iptables -A INPUT -s <ip> -j DROP`/, 'rate-limit': /WAF console.*rate limit/,
      'search-off': /feature flags console.*search off/, patch: /deploy console.*deploy it/, evidence: /backups and evidence console|`tar czf \/evidence\//,
    };
    for (const [id, re] of Object.entries(tool)) expect(TRAINING_STEPS.find((s) => s.id === id)!.lines.join(' '), id).toMatch(re);
  });
});
