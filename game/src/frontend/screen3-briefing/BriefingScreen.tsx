// Screen 3: the briefing (UI-03, D-182 to D-189). The scene is a cabin in a dark forest drawn in characters
// (cabinScene.ts) from a still camera, eyes in its doorway. Over it on the left: the bleeding logo, the scenario in
// big letters, and two buttons in screen 2's style: Watch the briefing (the 60-second cinematic, Cinematic.tsx) and
// Start the night shift. No clock. Up/Down (or Left/Right, or Tab) choose, Enter presses, Escape asks before going
// back to the menu. The screen is silent.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { needsDesktop } from '../screen1-title/curtain';
import { DIFFICULTY_LABEL, SCENARIO, type MenuChoice } from '../screen2-menu/menu';
import { ACTIONS, initialNav, navKey, point, press, videoClosed, type Action, type BriefingResult, type Nav, type NavKey } from './briefing';
import { Cinematic } from './Cinematic';
import { CabinScene } from './cabinScene';
import { LogoCanvas } from './LogoCanvas';
import { Narrator } from './narrator';
import { QUIZ } from './cinema/facts';
import { SHOTS, TOTAL } from './cinema/timeline';
import './BriefingScreen.css';

export interface BriefingScreenProps {
  title: string;
  choice: MenuChoice;
  /** Start the night shift: the screen has closed. */
  onBegin: (result: BriefingResult) => void;
  /** Back to the menu (after the player confirmed). */
  onBack: () => void;
}

const KEYS: Record<string, NavKey> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'enter',
  Escape: 'escape',
  Tab: 'tab',
};

/** About how long the briefing takes to watch. */
const MINUTES = Math.max(1, Math.round(TOTAL / 60));
const QUIZZES = QUIZ.length;

const LABEL: Record<Action, string> = {
  watch: 'Watch the briefing',
  start: 'Start the night shift',
};

function tooSmall(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const coarseOnly = window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
  return needsDesktop(window.innerWidth, coarseOnly);
}

export function BriefingScreen({ title, choice, onBegin, onBack }: BriefingScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<CabinScene | null>(null);
  const callbacks = useRef({ onBegin, onBack });
  const [nav, setNav] = useState<Nav>(initialNav);
  const [closing, setClosing] = useState(false);
  const live = useRef({ nav: initialNav(), result: null as BriefingResult | null });

  useEffect(() => {
    callbacks.current = { onBegin, onBack };
  });

  /** Start the night shift: the light dies until only the eyes are left, then hand over. */
  const finish = useCallback((nav: Nav) => {
    const L = live.current;
    if (L.result) return;
    L.result = { seen: nav.seen, of: SHOTS.length, right: nav.right, quizzes: QUIZZES };
    setClosing(true);
    sceneRef.current?.close();
  }, []);

  const apply = useCallback(
    (next: Nav, action: ReturnType<typeof navKey>['action']) => {
      const L = live.current;
      if (L.result) return;
      // opening the video: unlock the browser's speech inside this click or key, so Kiro starts talking by himself
      if (next.mode === 'video' && L.nav.mode !== 'video') Narrator.unlock();
      L.nav = next;
      setNav(next);
      if (action.kind === 'start') finish(next);
      else if (action.kind === 'back') callbacks.current.onBack();
    },
    [finish],
  );

  // the cabin lives as long as the screen
  useEffect(() => {
    const canvas = canvasRef.current;
    const fx = fxRef.current;
    if (!canvas || !fx) return;
    const scene = new CabinScene(canvas, fx, {
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      onClosed: () => {
        const r = live.current.result;
        if (r) callbacks.current.onBegin(r);
      },
    });
    sceneRef.current = scene;
    let pending = 0;
    const onResize = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        if (tooSmall()) callbacks.current.onBack();
        else scene.resize();
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(pending);
      scene.destroy();
      sceneRef.current = null;
    };
  }, []);

  // keys for the buttons and the "leave?" question; the video takes its own while it plays
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const key = KEYS[e.key];
      if (!key) return;
      const L = live.current;
      if (L.nav.mode === 'video') return;
      e.preventDefault();
      if (L.result || (e.repeat && key !== 'up' && key !== 'down')) return;
      const r = navKey(L.nav, key);
      apply(r.nav, r.action);
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [apply]);

  const pressAction = (a: Action) => {
    const r = press(live.current.nav, a);
    apply(r.nav, r.action);
  };
  const closeVideo = (seen: number, right: number) => apply(videoClosed(live.current.nav, seen, right), { kind: 'none' });
  const startFromVideo = (seen: number, right: number) => {
    const n = videoClosed(live.current.nav, seen, right);
    const r = press(n, 'start');
    apply(r.nav, r.action);
  };

  const note: Record<Action, string> = {
    watch: nav.seen > 0 ? `Watched · quick check ${nav.right} of ${QUIZZES} · watch again` : `Kiro shows you what you're up against · ${MINUTES} min`,
    start: 'He is already inside',
  };

  return (
    <div className={`bs-root mode-${nav.mode}${closing ? ' closing' : ''}`}>
      <canvas ref={canvasRef} className="bs-canvas" aria-hidden="true" />
      <canvas ref={fxRef} className="bs-canvas bs-fx" aria-hidden="true" />
      <div className="bs-grain" aria-hidden="true" />
      <div className="bs-vignette" aria-hidden="true" />

      <h1 className="bs-sr">{title}: the briefing</h1>

      <header className="bs-head">
        <LogoCanvas title={title} className="bs-logo" />
      </header>

      <nav className="bs-menu" aria-label="Briefing" inert={closing || nav.mode !== 'idle'}>
        <p className="bs-scenario" style={{ '--i': 0 } as CSSProperties}>
          <b>{SCENARIO.name}</b>
          <span>{DIFFICULTY_LABEL[choice.difficulty]}</span>
        </p>
        {ACTIONS.map((a, i) => (
          <button
            key={a}
            type="button"
            className={`bs-item ${a}${nav.index === i ? ' sel' : ''}`}
            style={{ '--i': i + 1 } as CSSProperties}
            aria-current={nav.index === i}
            onMouseEnter={() => apply(point(live.current.nav, i), { kind: 'none' })}
            onFocus={() => apply(point(live.current.nav, i), { kind: 'none' })}
            onClick={() => pressAction(a)}
          >
            <span className="bs-label">
              <span className="bs-sigil" aria-hidden="true">
                ◆
              </span>
              {LABEL[a]}
            </span>
            <span className="bs-note">{note[a]}</span>
          </button>
        ))}
      </nav>

      {nav.mode === 'video' && <Cinematic title={title} onClose={closeVideo} onStart={startFromVideo} />}

      {nav.mode === 'confirm' && (
        <div className="bs-confirm" role="alertdialog" aria-labelledby="bs-confirm-h">
          <h2 id="bs-confirm-h">Leave the cabin?</h2>
          <p>You go back to the menu.</p>
          <div className="bs-confirm-paths">
            <button type="button" className="bs-path" onClick={() => apply(navKey(live.current.nav, 'escape').nav, { kind: 'none' })}>
              Stay
            </button>
            <button
              type="button"
              className="bs-path leave"
              onClick={() => {
                const r = navKey(live.current.nav, 'enter');
                apply(r.nav, r.action);
              }}
            >
              Leave
            </button>
          </div>
        </div>
      )}

      {closing && (
        <p className="bs-arrives" role="status">
          He is here.
        </p>
      )}
    </div>
  );
}
