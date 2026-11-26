// The night shift (UI-04..UI-10, D-223, D-224): screens 4 and 5 as one place. Death's eyes in the dark; the office
// at night, first person; Kiro's welcome and the handshake; the walk to the desk; sitting down; the alarm; then the
// play screen (Play.tsx: one problem at a time, one terminal, Kiro, three buttons), with every tool one click on its
// dock as a floating window (UI-11, D-234); the ending; Kiro's judgement. The frame loop, the voices, the sound and the
// prologue's keys live in the director (director.ts); this component shows what it says and passes on what the player does.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Difficulty } from '../../rules/vocabulary';
import { BriefingFiles } from '../screen3-briefing/DocPanel';
import { isMasterMuted, onMasterMute, setMasterMuted } from '../shared/audio';
import { deltaWords, metersOf, type Meters, type Toast } from './Desk';
import { Night, SEATED } from './director';
import type { Phase } from './flow';
import type { MonitorName, Rect } from './haunt';
import { ENDINGS, type Scene } from './judge';
import type { KiroLine } from './KiroPanel';
import { Play, type Volumes } from './Play';
import { ReportWall } from './Report';
import type { Run } from './run';
import { BUS_DEFAULTS } from './sound';
import { NO_WINDOWS, closeTool, openTool, startingTools, topTool, type Wins } from './windows';
import './night.css';
import './play.css';
import './dock.css';

export interface NightShiftProps {
  difficulty: Difficulty;
  /** A retry starts at the desk: the prologue is played once a session. */
  skipPrologue?: boolean;
  onMenu: () => void;
  onAgain: (d: Difficulty) => void;
}

const rectOf = (el: HTMLElement | null, base: DOMRect): Rect | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
};

export function NightShift({ difficulty, skipPrologue = false, onMenu, onAgain }: NightShiftProps) {
  const office = useRef<HTMLCanvasElement>(null);
  const haunt = useRef<HTMLCanvasElement>(null);
  const clip = useRef<HTMLVideoElement>(null);
  const night = useRef<Night | null>(null);

  const [phase, setPhase] = useState<Phase>(skipPrologue ? 'shift' : 'dark');
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [sub, setSub] = useState<{ who: 'Kiro' | 'Death' | ''; text: string } | null>(null);
  const [cue, setCue] = useState<string | null>(null);
  const [wins, setWins] = useState<Wins>(NO_WINDOWS);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [kiroLines, setKiroLines] = useState<KiroLine[]>([]);
  const [files, setFiles] = useState(false);
  const [volumes, setVolumes] = useState<Volumes>({ ...BUS_DEFAULTS, voices: 0.8 });
  const [muted, setMuted] = useState(isMasterMuted);
  const [paused, setPaused] = useState(false);
  const [menu, setMenu] = useState(false);
  const [ending, setEnding] = useState<Scene | null>(null);
  const [card, setCard] = useState(false);
  const [report, setReport] = useState(false);
  const [eyesInAccounts, setEyesInAccounts] = useState(false);
  const [shakeDesk, setShakeDesk] = useState(false);
  const [glitch, setGlitch] = useState(false);
  const lineId = useRef(1);
  const toastId = useRef(1);

  const addKiro = useCallback((l: Omit<KiroLine, 'id'>) => {
    const id = lineId.current++;
    setKiroLines((ls) => [...ls.slice(-40), { ...l, id }]);
  }, []);

  // the director: made once per mount, given the canvases and the screen's setters
  useEffect(() => {
    const host = {
      office: office.current!,
      haunt: haunt.current!,
      clip: () => clip.current,
      monitors: (): Record<MonitorName, Rect> | null => {
        const base = office.current?.getBoundingClientRect();
        if (!base) return null;
        // the play screen's alert, the battlefield and Kiro (the haunt reaches over them)
        const q = (sel: string) => office.current?.parentElement?.querySelector<HTMLElement>(sel) ?? null;
        const [l, c, r] = [q('.pl-alert'), q('.pl-field'), q('.pl-kiro')];
        const a = rectOf(l, base);
        const b = rectOf(c, base);
        const d = rectOf(r, base);
        return a && b && d ? { left: a, centre: b, right: d } : null;
      },
    };
    const n = new Night(difficulty, skipPrologue, host, {
      phase: setPhase,
      prompt: (text) => setCue(text),
      sub: setSub,
      run: (r) => {
        setRun(r);
        // the level's first windows (the dial, D-241: Easy the log and the alerts, Medium also the terminal, Hard the terminal)
        const view = { w: window.innerWidth, h: window.innerHeight };
        setWins((s) => (s.open.length ? s : startingTools(r.difficulty).reduce((acc, id) => openTool(acc, id, view), s)));
      },
      error: setError,
      tick: () => setTick((x) => x + 1), // the danger level tinted the desk's monitors, which the dock replaced (D-240)
      eyesInAccounts: setEyesInAccounts,
      shake: setShakeDesk,
      glitch: setGlitch,
      ending: (scene) => {
        setEnding(scene);
        setWins(NO_WINDOWS);
      },
      card: () => setCard(true),
      kiro: addKiro,
    });
    night.current = n;
    n.start();
    return () => {
      n.dispose();
      night.current = null;
    };
    // one director per mount: a retry remounts with a new key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => onMasterMute(setMuted), []);
  useEffect(() => {
    const n = night.current;
    if (!n) return;
    n.setBus('rain', volumes.rain);
    n.setBus('heart', volumes.heart);
    n.setBus('effects', volumes.effects);
    n.setVoices(volumes.voices);
  }, [volumes]);
  useEffect(() => night.current?.setMenu(menu), [menu]);
  // Escape steps back: out of the files, the window on top, else the menu
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const top = topTool(wins);
      if (files) setFiles(false);
      else if (top) setWins((s) => closeTool(s, top));
      else if (!ending) setMenu((m) => !m);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wins, files, ending]);

  const onResult = useCallback(
    (ok: boolean, text: string, before: Meters) => {
      if (!run) return;
      const delta = deltaWords(before, metersOf(run));
      const id = toastId.current++;
      setToasts((ts) => [...ts.slice(-2), { id, ok, text, delta }]);
      window.setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 6000);
      night.current?.cue(ok ? (delta.includes('−') ? 'warn' : 'recovery') : 'warn');
    },
    [run],
  );

  const toggleMute = (m: boolean) => {
    setMasterMuted(m);
    setMuted(m);
  };
  const pause = () => setPaused(night.current?.togglePause() ?? false);

  if (report && run) return <ReportWall run={run} onAgain={onAgain} onMenu={onMenu} />;

  const seated = SEATED.has(phase);
  const end = run?.engine.world.ending ? ENDINGS[run.engine.world.ending] : null;

  return (
    <main className={`ns-root phase-${phase}${ending ? ' is-ending' : ''}${shakeDesk ? ' is-shake' : ''}${glitch ? ' is-glitch' : ''}`}>
      <canvas ref={office} className="ns-office" aria-hidden />
      <video ref={clip} className="ns-clip" src="/night/handshake.mp4" muted playsInline preload="auto" aria-hidden />
      {seated && run && phase !== 'login' && (
        <Play
          run={run}
          tick={tick}
          on={!ending}
          kiroLines={kiroLines}
          addKiro={addKiro}
          say={(text) => night.current?.say('Kiro', text)}
          sfx={(k) => night.current?.sfx(k)}
          onResult={onResult}
          toasts={toasts}
          wins={wins}
          setWins={setWins}
          eyes={eyesInAccounts}
          onFiles={() => setFiles(true)}
          paused={paused}
          onPause={pause}
          volumes={volumes}
          setVolumes={setVolumes}
          muted={muted}
          setMuted={toggleMute}
        />
      )}
      <canvas ref={haunt} className="ns-haunt" aria-hidden />

      {phase === 'login' && (
        <div className="ns-login" role="status">
          <p className="ns-login-brand">BLACKOUT.exe</p>
          <p>SECURITY OPERATIONS</p>
          <p className="ns-login-user">operator: night shift</p>
          <p className="ns-login-dots">{run ? 'status: monitoring' : 'logging in…'}</p>
        </div>
      )}
      {phase === 'alarm' && <div className="ns-warning">WARNING — SUSPICIOUS ACTIVITY DETECTED</div>}

      {cue && !menu && (
        <div className="ns-prompt">
          {cue.split(/(\[[A-Z]\])/).map((part, i) => (/^\[[A-Z]\]$/.test(part) ? <kbd key={i}>{part[1]}</kbd> : <span key={i}>{part}</span>))}
        </div>
      )}

      {sub && (
        <p className={`ns-sub who-${sub.who.toLowerCase() || 'none'}`} aria-live="polite">
          {sub.who && <b>{sub.who}</b>}
          {sub.text}
        </p>
      )}

      {!seated && phase !== 'dark' && phase !== 'eyes' && !menu && <p className="ns-controls">Mouse to look · A / D turn · E interact · Esc menu</p>}

      {menu && (
        <div className="ns-menu" role="dialog" aria-label="Menu">
          <h2>{seated && difficulty !== 'easy' ? "The night doesn't wait" : 'Paused'}</h2>
          <button type="button" onClick={() => setMenu(false)}>
            Resume
          </button>
          {!seated && (
            <button
              type="button"
              onClick={() => {
                night.current?.skip();
                setMenu(false);
              }}
            >
              Skip to the desk
            </button>
          )}
          <button type="button" onClick={() => toggleMute(!muted)}>
            {muted ? 'Unmute' : 'Mute'}
          </button>
          <button type="button" onClick={onMenu}>
            Main menu
          </button>
        </div>
      )}

      {card && end && (
        <div className={`ns-card-end ${end.won ? 'is-won' : 'is-lost'}`} role="dialog" aria-label={end.title}>
          <h1>{run?.engine.world.ending === 'banished' ? 'DEATH BANISHED' : end.scene === 'taken' ? 'YOU LOST' : end.title.toUpperCase()}</h1>
          <p>{end.line}</p>
          <nav>
            <button type="button" onClick={() => onAgain(difficulty)}>
              Try again
            </button>
            <button type="button" onClick={() => setReport(true)}>
              View incident report
            </button>
            <button type="button" onClick={onMenu}>
              Main menu
            </button>
          </nav>
        </div>
      )}

      {error && (
        <div className="ns-menu" role="alert">
          <h2>The workstation would not start</h2>
          <p>{error}</p>
          <button type="button" onClick={onMenu}>
            Main menu
          </button>
        </div>
      )}

      {files && <BriefingFiles onClose={() => setFiles(false)} />}
    </main>
  );
}
