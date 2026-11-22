import initSqlJs from 'sql.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MOVES } from '../rules/moves';
import { MINION_IDS, TAP_IDS, type Difficulty } from '../rules/vocabulary';
import { ALERT_HINTS, DRAFTS, HINT_POLICY, MOVE_HINTS, OFFLINE_ANSWER, debriefTemplate, hintsFor, type DebriefInput } from './kiro-fallback';

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
