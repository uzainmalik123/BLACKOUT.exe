// The play screen (UI-04, UI-05, D-224, D-225): a boss fight with Death, one loop at a time:
// ATTACK (the battlefield in the centre shows his attack, from the engine) → SPOT (one short alert, Kiro's clue, the
// gate under attack lit) → ACT (three choices on keys 1–3, or the Advanced Terminal) → DEFEND (the action runs on the
// engine) → RESULT (a banner and an effect, only for what the engine really did; the meters move by the engine).
// Top: heartbeat, souls, Death's stage, the threat. Centre: the battlefield (battle.ts). Side: Kiro. Bottom: the
// choices. Investigating shows a short evidence card whose addresses, accounts and files can be picked as a target;
// the full shell is one key away (T). A button, a key and a typed command all end as the same engine action.
// Every other tool is one click on the dock and opens as a floating window (UI-11, D-234, D-240); the "Now:" strip
// reads the playbook phase; during the change freeze change controls show locked with the engine's reason (SYS-22).
// The shift begins when this screen shows (`engine.beginShift()`, D-243).

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { gameClockLabel } from '../../engine/clock';
import type { GameEvent } from '../../engine/log';
import type { PlayerAction } from '../../rules/vocabulary';
import { DIAL } from '../shared/dial';
import { ConsolePanel, type ConsoleId } from './Consoles';
import { Feed, Logs, metersOf, type Meters, type Toast } from './Desk';
import { Coach } from './Coach';
import { Dock, FloatWindow } from './Dock';
import { Battle, battleOf, type FxKind, type GateId } from './battle';
import { anomalies, danger as dangerOf, kiroMood, whatKiroSees } from './judge';
import { KiroPanel, type KiroLine } from './KiroPanel';
import { OUTCOME_KIRO, OUTCOME_WORDS, READS, liveAttacks, outcomeOf, type Outcome, type Pending } from './results';
import { readingsOf, type Run } from './run';
import { countdownOf, countdownWords, URGENT_S } from './countdown';
import { STAGE_NAMES, commandFor, forLevel, situationOf, tokens, type Step, type TargetKind } from './situations';
import { AddressFlags, AlertsTool, CheatSheet, Freeze, TrafficTool, UploadsTool, type Act } from './Tools';
import { TOOL_BY_ID, closeTool, dockFor, focusTool, isOpen, moveTool, openTool, resizeTool, toggleTool, type ToolId, type Wins } from './windows';
import { NOW_WORDS, battleGate, freezeReason, gateConsole, gateSentence, shiftLeft } from './words';
import { CONFIG } from '../../engine/config';
import { KiroCanvas } from '../shared/KiroCanvas';
import { deathPortrait } from '../shared/reaper';
import type { Rect } from './presence';

export interface Volumes {
  rain: number;
  heart: number;
  voices: number;
  effects: number;
}

export type Sfx = 'shield' | 'gate' | 'key' | 'evidence' | 'breach' | 'recover';

export interface PlayProps {
  run: Run;
  /** Death's line now, shown in the Now strip (D-254), and the first alert's warning there. */
  taunt?: string | null;
  alarm?: boolean;
  /** The drill's coach is waiting for the player to read: hold the night's clock (D-274). */
  onHold?: (on: boolean) => void;
  tick: number;
  on: boolean;
  kiroLines: KiroLine[];
  addKiro: (l: Omit<KiroLine, 'id'>) => void;
  say: (text: string) => void;
  sfx: (k: Sfx) => void;
  onResult: (ok: boolean, text: string, before: Meters) => void;
  toasts: Toast[];
  /** The dock's windows (UI-11): kept by the night shift so Escape closes the top one. */
  wins: Wins;
  setWins: (f: (w: Wins) => Wins) => void;
  /** Death's eyes in the accounts console (stage 3). */
  eyes: boolean;
  onFiles: () => void;
  paused: boolean;
  onPause: () => void;
  volumes: Volumes;
  setVolumes: (v: Volumes) => void;
  muted: boolean;
  setMuted: (m: boolean) => void;
}

interface Entry {
  id: number;
  cmd: string;
  out: string;
  err: boolean;
  note?: string;
}

const PROMPT = 'soc@juice-shop:~$';
const TARGET_WORDS: Record<TargetKind, string> = { ip: 'an address', email: 'an account', file: 'a file' };
const FX_SOUND: Partial<Record<FxKind, Sfx>> = { shield: 'shield', seal: 'gate', key: 'key', evidence: 'evidence', breach: 'breach', recover: 'recover', root: 'key' };
const GOOD: ReadonlySet<Outcome> = new Set(['contained', 'evidence', 'restored', 'deploying']);

export function Play({ toasts, ...p }: PlayProps) {
  const { run } = p;
  const w = run.engine.world;
  const easy = run.difficulty === 'easy';
  const hard = run.difficulty === 'hard';
  const dial = DIAL[run.difficulty];
  const situation = forLevel(situationOf(w), run.difficulty);
  // D-235: only Easy names the gate an alert's route belongs to, lights it on the battlefield and its console on the dock
  const gate = easy ? situation.gate : undefined;
  const meters = metersOf(run);
  const frozen = freezeReason(w);
  const [log, setLog] = useState<Entry[]>([]);
  const [cmd, setCmd] = useState('');
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<{ kind: TargetKind; value: string } | null>(null);
  const [hist, setHist] = useState<string[]>([]);
  const [hi, setHi] = useState(-1);
  const [sound, setSound] = useState(false);
  const { wins, setWins } = p;
  // the training shift (SYS-24, UI-12): the coach on screen, the suspicious line pinned in the log, no Death (D-274, D-275)
  const drill = run.engine.training();
  const [pin, setPin] = useState<number | null>(null);
  const terminal = isOpen(wins, 'terminal');
  const view = () => ({ w: window.innerWidth, h: window.innerHeight });
  const setTerminal = (f: (on: boolean) => boolean) => setWins((s) => (f(isOpen(s, 'terminal')) ? openTool(s, 'terminal', view()) : closeTool(s, 'terminal')));
  const [evidence, setEvidence] = useState<Entry | null>(null);
  const [full, setFull] = useState(false);
  const [result, setResult] = useState<{ id: number; outcome: Outcome; detail: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [q, setQ] = useState('');
  const id = useRef(1);
  const out = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pending = useRef<Pending | null>(null);
  /** Seconds since the battlefield's loop began, as of its last frame (the RESULT's clock). */
  const clockNow = useRef(0);
  const focusGate = useRef<GateId | null>(null);
  // Death's reflection in the terminal when one of his attacks lands (D-254): behind the text, faint, brief
  const [haunted, setHaunted] = useState(0);
  const files = useMemo(() => w.files.map((f) => f.path.split('/')[0]!), [w.files, p.tick]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    focusGate.current = gate ? battleGate(gate) : null;
  }, [gate]);

  // the desk is in view: the shift begins, and with it the calm and the change freeze (SYS-22, D-230, D-243)
  useEffect(() => {
    run.engine.beginShift();
  }, [run]);

  // the battlefield: its own frame loop, reading the engine; it also settles the pending RESULT
  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    const battle = new Battle();
    battle.hideDeath = !!run.engine.world.training; // the drill is the shop's own security team, never Death (D-275)
    // the browser checks read Death's presence from here (development only: the production build drops it)
    if (import.meta.env.DEV) (window as unknown as { __battle?: Battle }).__battle = battle;
    const reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let lastStrike = -1;
    let raf = 0;
    const t0 = performance.now();
    let last = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const t = (now - t0) / 1000;
      clockNow.current = t;
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const W = c.clientWidth;
      const H = c.clientHeight;
      if (W < 2 || H < 2) return;
      if (c.width !== Math.round(W * dpr)) c.width = Math.round(W * dpr);
      if (c.height !== Math.round(H * dpr)) c.height = Math.round(H * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const world = run.engine.world;
      const v = battle.update(world, t);
      for (const k of new Set(battle.fresh(t, t - last + 0.0001))) {
        const s = FX_SOUND[k];
        if (s) p.sfx(s);
      }
      last = t;
      // what lies over the battlefield on screen: he is placed where he can be seen past it, and drawn under it
      const base = c.getBoundingClientRect();
      const cover: Rect[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('.ns-win, .pl-alert, .pl-evidence, .pl-result')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > base.left && r.left < base.right && r.bottom > base.top && r.top < base.bottom) cover.push({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
      }
      battle.paint(g, W, H, dpr, t, v, focusGate.current, world.ending ? { kind: world.ending, through: world.death.returnedThrough } : null, cover, reduce);
      if (battle.presence.mode === 'striking' && battle.presence.since !== lastStrike) {
        lastStrike = battle.presence.since;
        setHaunted((n) => n + 1);
      }
      const pend = pending.current;
      if (pend) {
        const o = outcomeOf(pend, world, t);
        if (o) {
          pending.current = null;
          setResult({ id: id.current++, outcome: o, detail: pend.message });
          const line = OUTCOME_KIRO[o];
          if (line) {
            p.addKiro({ who: 'kiro', text: line });
            p.say(line);
          }
          if (o === 'contained') p.sfx('shield');
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // the loop reads the engine itself; it starts once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!haunted) return;
    const t = window.setTimeout(() => setHaunted(0), 2200);
    return () => window.clearTimeout(t);
  }, [haunted]);

  useEffect(() => {
    if (!result) return;
    const t = window.setTimeout(() => setResult(null), 3200);
    return () => window.clearTimeout(t);
  }, [result]);

  // Kiro says each new situation's clue once
  const said = useRef<string>('');
  useEffect(() => {
    if (said.current === situation.key) return;
    said.current = situation.key;
    if (situation.key === 'quiet') return;
    p.addKiro({ who: 'kiro', text: situation.kiro });
    p.say(situation.kiro);
  }, [situation.key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (out.current) out.current.scrollTop = out.current.scrollHeight;
  }, [log, busy, terminal]);

  /** Wait for the engine's answer to the last action, if it was one that settles something. */
  const watch = (from: number, live: number[], before: Meters) => {
    const evs = run.engine.world.events.slice(from).filter((e): e is Extract<GameEvent, { kind: 'action' }> => e.kind === 'action');
    const lastAct = evs[evs.length - 1];
    if (!lastAct || READS.has(lastAct.action.type)) return;
    pending.current = { type: lastAct.action.type, ok: lastAct.ok, message: lastAct.note ?? '', from: run.engine.world.events.length, heartbeat: before.heartbeat, max: before.max, at: clockNow.current, live };
  };

  const shell = async (line: string, note?: string) => {
    if (busy) return;
    setBusy(true);
    setHist((h) => [...h.slice(-49), line]);
    setHi(-1);
    const before = metersOf(run);
    const live = liveAttacks(run.engine.world);
    const n = run.engine.world.events.length;
    try {
      const r = await run.shell.run(line);
      const entry = { id: id.current++, cmd: line, out: r.output, err: !!r.exitCode, note };
      if (r.clear) setLog([]);
      else setLog((l) => [...l.slice(-40), entry]);
      if (note) {
        setEvidence(entry);
        setFull(false);
      }
      const acted = run.engine.world.events.slice(n).filter((e) => e.kind === 'action' && !READS.has(e.action.type));
      if (acted.length) p.onResult(acted.every((e) => e.kind === 'action' && e.ok), line, before);
      watch(n, live, before);
    } finally {
      setBusy(false);
    }
  };

  const take = (step: Step) => {
    if (step.needs && (!target || target.kind !== step.needs)) return;
    const line = commandFor(step, target?.value ?? null);
    if (line) return void shell(line, step.label);
    if (step.action) {
      const before = metersOf(run);
      const live = liveAttacks(run.engine.world);
      const n = run.engine.world.events.length;
      const r = run.engine.act(step.action(target?.value ?? '', run.engine.world));
      setLog((l) => [...l.slice(-40), { id: id.current++, cmd: `# console: ${step.label.toLowerCase()}${step.needs && target ? ` (${target.value})` : ''}`, out: r.message, err: !r.ok }]);
      p.onResult(r.ok, `${step.label}: ${r.message}`, before);
      watch(n, live, before);
    }
  };

  const ask = async () => {
    setAsking(true);
    try {
      const h = await run.kiro.hint();
      const text = h?.text ?? whatKiroSees(readingsOf(run.engine));
      p.addKiro({ who: 'kiro', text, offline: h?.offline });
      p.say(text);
    } finally {
      setAsking(false);
    }
  };

  const askFree = async () => {
    const text = q.trim();
    if (!text) return;
    setQ('');
    p.addKiro({ who: 'you', text });
    setAsking(true);
    try {
      const r = await run.kiro.ask(text);
      p.addKiro({ who: 'kiro', text: r.text, offline: r.offline });
    } finally {
      setAsking(false);
    }
  };

  // ---- the dock's windows (UI-11)

  /** A window's button: one `engine.act`, its answer on the toasts with what it did to the meters (refusals too). */
  const actNow: Act = (action: PlayerAction) => {
    const before = metersOf(run);
    const r = run.engine.act(action);
    if (!READS.has(action.type) || !r.ok) p.onResult(r.ok, r.message, before);
    return r;
  };
  const openWin = (id: ToolId) => setWins((s) => openTool(s, id, view()));
  const pick = (id: ToolId) => {
    if (id === 'files') return p.onFiles();
    setWins((s) => toggleTool(s, id, view()));
  };
  /** Kiro's drafted line, or an address, into the terminal's prompt (the player still presses Enter). */
  const insert = (text: string) => {
    setCmd((c) => (c && !c.endsWith(' ') ? `${c} ${text}` : c + text));
    openWin('terminal');
    window.setTimeout(() => input.current?.focus(), 0);
  };
  const explain = (line: string) => {
    openWin('kiro');
    p.addKiro({ who: 'you', text: `Explain: ${line}` });
    void run.kiro.explain(line).then((r) => p.addKiro({ who: 'kiro', text: r.text, offline: r.offline }));
  };

  // the opening's tutorial left Kiro's column (D-273): the training shift is offered when a shift starts
  const lit = new Set<ToolId>();
  if (gate && dial.gateSentence) lit.add(gateConsole(gate));

  // the terminal takes the keyboard only when the player opens it (T, its button, a click in it, Kiro's insert): opened
  // by the level it leaves 1, 2 and 3 to the actions (D-258, KI-251)
  const openedByPlayer = useRef(false);
  const toggleTerminal = () => {
    openedByPlayer.current = true;
    setTerminal((x) => !x);
  };
  // keys: 1, 2, 3 and T when the player isn't typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '1') take(situation.look);
      else if (e.key === '2' && situation.act) take(situation.act);
      else if (e.key === '3') void ask();
      else if (e.key.toLowerCase() === 't' || e.key === '`') {
        e.preventDefault();
        toggleTerminal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    if (terminal && openedByPlayer.current) input.current?.focus();
    openedByPlayer.current = false;
  }, [terminal]);

  // Kiro's mood (D-250): the ending, the last real outcome, the meters and a fresh alert, all from the engine
  const newest = w.alerts.reduce<number | null>((t, a) => (a.closedAt === undefined && (t === null || a.openedAt > t) ? a.openedAt : t), null);
  const mood = kiroMood({
    ending: w.ending,
    outcome: result?.outcome ?? null,
    danger: dangerOf(w.heartbeat, w.souls.stolen.length, w.souls.total),
    alertAge: newest === null ? null : (w.clock.gameMs - newest) / CONFIG[w.difficulty].gameMsPerRealMs / 1000,
  });
  const act = situation.act;
  // UI-15 (D-261): the countdown on the choices, from the engine's clock (whole seconds under reduced motion)
  const countdown = p.on ? countdownOf(w, !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) : null;
  const needsPick = act?.needs && (!target || target.kind !== act.needs);
  const lastKiro = [...p.kiroLines].reverse().find((l) => l.who === 'kiro');
  const hb = meters.heartbeat;
  const soulsPct = (meters.souls / Math.max(1, meters.total)) * 100;
  const stage = Math.max(0, ...w.events.map((e) => (e.kind === 'move-started' ? e.stage : 0)));
  // the stolen admin key is a line in the top bar, not a symbol by him (D-254)
  const keyStolen = battleOf(w).key;

  const output = (e: Entry, max?: number) => {
    const lines = e.out.split('\n');
    const shown = max ? lines.filter(Boolean).slice(0, max) : lines;
    return (
      <pre className={e.err ? 'is-err' : ''}>
        {shown.map((line, i) => (
          <span key={i}>
            {tokens(line, files).map((t, j) =>
              t.kind ? (
                <button
                  key={j}
                  type="button"
                  className={`pl-tok is-${t.kind}${hard ? ' is-plain' : ''}${target?.value === t.text ? ' is-picked' : ''}`}
                  title={`Pick ${t.text} as the target`}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setTarget({ kind: t.kind!, value: t.text });
                  }}
                >
                  {t.text}
                </button>
              ) : (
                <span key={j}>{t.text}</span>
              ),
            )}
            {'\n'}
          </span>
        ))}
        {max && lines.filter(Boolean).length > max && <span className="pl-more">… {lines.filter(Boolean).length - max} more lines</span>}
        {!lines.some(Boolean) && <span className="pl-more">(nothing came back yet: try again in a moment)</span>}
      </pre>
    );
  };

  /** The terminal, in its own floating window: its bar is the window's handle, its close is the window's close. */
  const terminalWin = (
    <div className={`pl-term${haunted ? ' is-haunted' : ''}`} style={haunted ? ({ '--death': `url(${deathPortrait()})` } as CSSProperties) : undefined} onClick={() => input.current?.focus()}>
      <div className="pl-term-bar" data-drag>
        <span className="dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        <span>BLACKOUT.exe · night shift · {hard ? 'terminal' : 'advanced terminal'}</span>
        <button type="button" className="pl-term-close" onClick={() => setTerminal(() => false)}>
          close (T)
        </button>
      </div>
      <div className="pl-term-out" ref={out}>
        {log.length === 0 && <p className="pl-hint">Type any command the workstation allows (try `help`, or open the cheat sheet on the dock). Click an address, account or file to pick it as a target.</p>}
        {log.map((e) => (
          <div key={e.id} className="pl-entry">
            <div className="pl-cmd">
              <span className="pl-prompt">{PROMPT}</span> {e.cmd}
              {e.note && <span className="pl-note">← {e.note.toLowerCase()}</span>}
            </div>
            {e.out && output(e)}
          </div>
        ))}
        {busy && <div className="pl-busy">…</div>}
      </div>
      <div className="pl-in">
        <span className="pl-prompt">{PROMPT}</span>
        <input
          ref={input}
          data-coach="terminal-input"
          value={cmd}
          spellCheck={false}
          autoComplete="off"
          aria-label="Type a command"
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && cmd.trim()) {
              void shell(cmd.trim());
              setCmd('');
            } else if (e.key === 'ArrowUp' && hist.length) {
              e.preventDefault();
              const n = hi < 0 ? hist.length - 1 : Math.max(0, hi - 1);
              setHi(n);
              setCmd(hist[n]!);
            } else if (e.key === 'ArrowDown' && hi >= 0) {
              e.preventDefault();
              const n = hi + 1;
              setHi(n >= hist.length ? -1 : n);
              setCmd(n >= hist.length ? '' : hist[n]!);
            } else if (e.key === 'Tab' && dial.autocomplete && run.shell.complete) {
              e.preventDefault();
              const o = run.shell.complete(cmd);
              if (o.length === 1) setCmd(cmd.slice(0, cmd.lastIndexOf(' ') + 1) + o[0]! + (o[0]!.endsWith('/') ? '' : ' '));
            } else if (e.key === 'Escape') {
              (e.target as HTMLInputElement).blur();
              setTerminal(() => false);
            }
          }}
        />
      </div>
    </div>
  );

  /** One open window's body. */
  const body = (id: ToolId) => {
    switch (id) {
      case 'logs':
        return <Logs run={run} tick={p.tick} act={actNow} explain={explain} pin={drill ? pin : null} />;
      case 'alerts':
        return (
          <>
            <AlertsTool run={run} tick={p.tick} easy={dial.gateSentence} />
            <Feed run={run} tick={p.tick} />
          </>
        );
      case 'traffic':
        return <TrafficTool run={run} tick={p.tick} act={actNow} />;
      case 'cheats':
        return <CheatSheet />;
      case 'flags':
        return <AddressFlags run={run} tick={p.tick} act={actNow} />;
      case 'uploads':
        return <UploadsTool run={run} tick={p.tick} act={actNow} />;
      case 'waf':
      case 'firewall':
      case 'features':
      case 'accounts':
      case 'sessions':
      case 'deploy':
      case 'backups':
      case 'comms':
      case 'plug':
        return <ConsolePanel id={id as ConsoleId} run={run} tick={p.tick} act={actNow} eyes={p.eyes} />;
      default:
        return null;
    }
  };

  return (
    <div className={`pl-root has-dock${p.on ? '' : ' is-off'}`}>
      <Dock tools={dockFor(run.difficulty)} open={new Set(wins.open.map((x) => x.id))} lit={lit} frozen={!!frozen} onPick={pick} />
      <header className="pl-top" data-coach="meters">
        <div className={`pl-meter heart${hb < 35 ? ' is-low' : ''}`} title="The business's health: customers being served">
          <span>🫀 Heartbeat</span>
          <i>
            <b style={{ width: `${hb}%` }} />
            {meters.max < 100 && <s style={{ width: `${100 - meters.max}%` }} />}
          </i>
          <em>{hb}</em>
        </div>
        <div className={`pl-meter souls${soulsPct < 35 ? ' is-low' : ''}`} title="Customer records still safe. Stolen ones never come back.">
          <span>💀 Souls</span>
          <i>
            <b style={{ width: `${soulsPct}%` }} />
          </i>
          <em>
            {meters.souls}/{meters.total}
          </em>
        </div>
        {drill ? (
          <div className="pl-threat">
            <span>Drill</span>
            <strong>Your security team</strong>
            <em>{situation.key === 'quiet' ? 'no attack seen' : 'a drill attack under way'}</em>
          </div>
        ) : (
        <div className="pl-threat">
          <span>Death</span>
          <strong>{stage ? `Stage ${stage} · ${STAGE_NAMES[stage as 1]}` : 'Watching'}</strong>
          <em>{situation.key === 'quiet' ? 'no attack seen' : gate ? `attacking: the ${gate}` : 'attack under way'}</em>
          {keyStolen && <em className="pl-keychip">he holds an admin key</em>}
        </div>
        )}
        <div className="pl-clock">
          <strong>{gameClockLabel(w)}</strong>
          <em>{drill ? `drill step ${drill.step.step} of 6` : `shift ends in ${shiftLeft(w)}`}</em>
          {w.nginx === 'stopped' && <em className="pl-down">shop OFFLINE</em>}
        </div>
        <nav className="pl-tools">
          {easy && (
            <button type="button" onClick={p.onPause}>
              {p.paused ? '▶ Resume' : '❚❚ Pause'}
            </button>
          )}
          <button type="button" onClick={() => setSound((s) => !s)} aria-expanded={sound}>
            {p.muted ? '🔇' : '🔊'} Sound
          </button>
        </nav>
        {sound && <SoundPanel volumes={p.volumes} set={p.setVolumes} muted={p.muted} setMuted={p.setMuted} />}
      </header>

      <main className="pl-main">
        <section className="pl-centre">
          <p className={`pl-now${p.alarm ? ' is-alarm' : ''}`} aria-live="polite">
            {p.alarm ? (
              <>
                <span>Warning:</span> <b>Suspicious activity detected</b>
              </>
            ) : (
              <>
                <span>Now:</span> <b>{NOW_WORDS[w.playbook.phase]}</b>
              </>
            )}
            {p.taunt ? <q className="pl-taunt">{p.taunt}</q> : frozen && <em>🔒 change freeze: no incident declared</em>}
          </p>
          <div className="pl-field">
            <canvas ref={canvas} className="pl-battle" aria-label="The battlefield: the shop, its seven entrances, Death" />
            <div className={`pl-alert${situation.key === 'quiet' ? ' is-quiet' : ''}`} key={situation.key}>
              <b>{situation.key === 'quiet' ? 'ALL QUIET' : situation.route ? `ALERT · ${situation.route}` : 'ALERT'}</b>
              <span>{situation.alert}</span>
              {gate && <em className="pl-gate">{gateSentence(gate)}</em>}
            </div>
            {result && (
              <div key={result.id} className={`pl-result ${GOOD.has(result.outcome) ? 'is-good' : result.outcome === 'applied' ? 'is-neutral' : 'is-bad'}`} role="status">
                <b>{OUTCOME_WORDS[result.outcome]}</b>
                {result.detail && <span>{result.detail}</span>}
              </div>
            )}
            {evidence && (
              <div className="pl-evidence" onClick={(e) => e.stopPropagation()}>
                <header>
                  <span>Evidence · {evidence.note?.toLowerCase()}</span>
                  <button type="button" onClick={() => setFull((f) => !f)}>
                    {full ? 'less' : 'show the command'}
                  </button>
                  <button type="button" onClick={() => setEvidence(null)} aria-label="Close the evidence">
                    ✕
                  </button>
                </header>
                {full && (
                  <div className="pl-cmd">
                    <span className="pl-prompt">{PROMPT}</span> {evidence.cmd}
                  </div>
                )}
                {output(evidence, full ? undefined : 6)}
                {act?.needs && <p className="pl-pickhint">{target?.kind === act.needs ? `Target picked: ${target.value}` : `Click ${TARGET_WORDS[act.needs]} above to pick your target.`}</p>}
              </div>
            )}
          </div>
        </section>

        <aside className={`pl-kiro mood-${mood}`}>
          <KiroCanvas className="pl-portrait" mood={mood} line={lastKiro?.text ?? situation.kiro} />
          <div className="pl-kiro-name">Kiro</div>
          <p className={`pl-kiro-line${lastKiro?.urgent ? ' is-urgent' : ''}`}>{asking ? '…' : (lastKiro?.text ?? situation.kiro)}</p>
          {lastKiro?.offline && <small className="pl-off">rule-written answer (Kiro offline)</small>}
          {/* her conversation window (drafts, explain, apply on Easy) opens from her column: she is not on the dock (D-270) */}
          <button type="button" className="pl-lesson-again" onClick={() => openWin('kiro')}>
            Open the conversation
          </button>
          <input
            className="pl-ask"
            placeholder="Ask Kiro anything…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') void askFree();
            }}
            aria-label="Ask Kiro"
          />
        </aside>
      </main>

      <Freeze.Provider value={frozen}>
        {wins.open.map((win) => {
          const close = () => setWins((s) => closeTool(s, win.id));
          const common = {
            win,
            title: TOOL_BY_ID[win.id].label,
            onClose: close,
            onFocus: () => setWins((s) => focusTool(s, win.id)),
            onMove: (x: number, y: number) => setWins((s) => moveTool(s, win.id, x, y, view())),
            onResize: (w: number, h: number) => setWins((s) => resizeTool(s, win.id, w, h, view())),
            lit: lit.has(win.id),
          };
          if (win.id === 'terminal')
            return (
              <FloatWindow key={win.id} {...common} bare>
                {terminalWin}
              </FloatWindow>
            );
          if (win.id === 'kiro')
            return (
              <FloatWindow key={win.id} {...common} bare>
                <KiroPanel run={run} lines={p.kiroLines} add={p.addKiro} insert={insert} onClose={close} />
              </FloatWindow>
            );
          return (
            <FloatWindow key={win.id} {...common}>
              {body(win.id)}
            </FloatWindow>
          );
        })}
      </Freeze.Provider>

      {drill && <Coach run={run} view={drill} open={new Set(wins.open.map((x) => x.id))} onHold={p.onHold} onPin={setPin} />}

      <div className="pl-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`pl-toast ${t.ok ? 'is-ok' : 'is-no'}`}>
            <span>{t.text}</span>
            {t.delta && <b>{t.delta}</b>}
          </div>
        ))}
      </div>

      <footer className="pl-actions">
        {countdown && (
          // UI-15 (D-261): the alert on screen waits for a decision; the bar empties over its window
          <div className={`pl-decide is-${countdown.state}${countdown.state === 'deciding' && countdown.left <= URGENT_S ? ' is-urgent' : ''}`} role="timer">
            <i style={{ width: `${countdown.share * 100}%` }} />
            <span>{countdownWords(countdown)}</span>
          </div>
        )}
        <ActionButton n={1} step={{ ...situation.look, label: `Investigate: ${situation.look.label}` }} onClick={() => take(situation.look)} />
        {act ? (
          <ActionButton
            n={2}
            step={{ ...act, label: `Contain: ${act.label}` }}
            disabled={!!needsPick}
            sub={needsPick ? `First click ${TARGET_WORDS[act.needs!]} in the evidence` : act.needs && target ? `Target: ${target.value}` : act.what}
            onClick={() => take(act)}
          />
        ) : (
          <div className="pl-act is-empty">
            <kbd>2</kbd>
            <span>
              <b>Your move</b>
              <em>{hard ? 'Type the command that stops it (T)' : 'Watch, and look again'}</em>
            </span>
          </div>
        )}
        <ActionButton n={3} step={{ label: 'Ask Kiro', what: anomalies(readingsOf(run.engine)).length ? 'She sees something' : 'A nudge, not the answer' }} onClick={() => void ask()} />
        <button type="button" className={`pl-act pl-termbtn${terminal ? ' is-on' : ''}`} onClick={toggleTerminal}>
          <kbd>T</kbd>
          <span>
            <b>Terminal</b>
            <em>Type commands yourself</em>
          </span>
        </button>
      </footer>
    </div>
  );
}

function ActionButton({ n, step, onClick, disabled, sub }: { n: number; step: Step; onClick: () => void; disabled?: boolean; sub?: string }) {
  return (
    <button type="button" className={`pl-act${disabled ? ' is-waiting' : ''}`} onClick={onClick} disabled={disabled}>
      <kbd>{n}</kbd>
      <span>
        <b>{step.label}</b>
        <em>{sub ?? step.what}</em>
      </span>
    </button>
  );
}

function SoundPanel({ volumes, set, muted, setMuted }: { volumes: Volumes; set: (v: Volumes) => void; muted: boolean; setMuted: (m: boolean) => void }) {
  const row = (k: keyof Volumes, label: string) => (
    <label key={k}>
      <span>{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={volumes[k]} onChange={(e) => set({ ...volumes, [k]: Number(e.target.value) })} />
    </label>
  );
  return (
    <div className="pl-sound" role="dialog" aria-label="Sound">
      {row('rain', 'Rain')}
      {row('heart', 'Heartbeat')}
      {row('voices', 'Voices')}
      {row('effects', 'Effects')}
      <button type="button" onClick={() => setMuted(!muted)}>
        {muted ? 'Unmute all' : 'Mute all'}
      </button>
    </div>
  );
}

