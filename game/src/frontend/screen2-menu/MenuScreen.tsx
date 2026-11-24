// Screen 2: the title and menu (UI-02, D-181). The haunted forest and its logo are a canvas of characters
// (menuScene.ts); this component owns the input and the real, readable menu over it. Keys: Up/Down move,
// Left/Right change the difficulty, Enter confirms, Escape goes back; the pointer selects by hover and
// confirms by click. No key hints are written on screen. The screen is silent.

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Difficulty } from '../../rules/vocabulary';
import { needsDesktop } from '../screen1-title/curtain';
import {
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  SCENARIO,
  activate,
  initialMenu,
  pick,
  select,
  step,
  whisperFor,
  type MenuChoice,
  type MenuItem,
  type MenuKey,
  type MenuState,
  type MenuStep,
} from './menu';
import { MenuScene } from './menuScene';
import './MenuScreen.css';

export interface MenuScreenProps {
  title: string;
  /** The difficulty the menu opens on (the last one picked, when the player comes back). */
  initialDifficulty?: Difficulty;
  onStart: (choice: MenuChoice) => void;
  /** Exit or Escape: back to the title screen. */
  onBack: () => void;
}

const KEYS: Record<string, MenuKey> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'enter',
  Escape: 'escape',
};

const LABEL: Record<MenuItem, string> = { start: 'Start Game', scenario: 'Scenario', difficulty: 'Difficulty', exit: 'Exit' };

function tooSmall(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const coarseOnly = window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
  return needsDesktop(window.innerWidth, coarseOnly);
}

export function MenuScreen({ title, initialDifficulty = 'medium', onStart, onBack }: MenuScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<MenuScene | null>(null);
  const callbacks = useRef({ onStart, onBack });
  const [menu, setMenu] = useState<MenuState>(() => initialMenu(initialDifficulty));
  const [leaving, setLeaving] = useState<'start' | 'back' | null>(null);
  const live = useRef({ menu, leaving: false, choice: null as MenuChoice | null, opening: initialDifficulty });

  useEffect(() => {
    callbacks.current = { onStart, onBack };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const fx = fxRef.current;
    if (!canvas || !fx) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scene = new MenuScene(canvas, fx, {
      title,
      difficulty: live.current.opening,
      reducedMotion,
      onLunged: () => {
        const choice = live.current.choice;
        if (choice) callbacks.current.onStart(choice);
      },
      onLeft: () => callbacks.current.onBack(),
    });
    sceneRef.current = scene;
    let pending = 0;
    const onResize = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        // a phone-sized window goes back to the title, which shows the desktop gate (UI-01)
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
  }, [title]);

  const apply = useCallback((r: MenuStep | null) => {
    if (!r || live.current.leaving) return;
    const scene = sceneRef.current;
    live.current.menu = r.state;
    setMenu(r.state);
    if (r.changed === 'item') scene?.react('move');
    else if (r.changed === 'difficulty') scene?.react({ difficulty: r.state.difficulty });
    switch (r.action.kind) {
      case 'start':
        live.current.leaving = true;
        live.current.choice = r.action.choice;
        setLeaving('start');
        scene?.start();
        break;
      case 'back':
        live.current.leaving = true;
        setLeaving('back');
        scene?.leave();
        break;
      case 'scenario':
        scene?.react('scenario');
        break;
      case 'none':
        break;
    }
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const key = KEYS[e.key];
      if (!key) return;
      // Enter is ours: stopping it here also stops a focused button turning it into a second click
      e.preventDefault();
      if (e.repeat && (key === 'enter' || key === 'escape')) return;
      apply(step(live.current.menu, key));
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [apply]);

  const hover = (item: MenuItem) => apply(select(live.current.menu, item));
  const click = (item: MenuItem) => apply(activate({ ...live.current.menu, item }));
  const rowClass = (item: MenuItem) => `ms-item ms-glass${menu.item === item ? ' sel' : ''}`;
  const inside = (item: MenuItem) => (
    <>
      <span className="ms-glow" aria-hidden="true" />
      <span className="ms-label">{LABEL[item]}</span>
    </>
  );
  const whisper = whisperFor(menu);

  return (
    <div className={`ms-root${leaving ? ` leaving ${leaving}` : ''}`}>
      <canvas ref={canvasRef} className="ms-canvas" aria-hidden="true" />
      <canvas ref={fxRef} className="ms-canvas ms-fx" aria-hidden="true" />
      <div className="ms-grain" aria-hidden="true" />
      <div className="ms-vignette" aria-hidden="true" />
      <div className="ms-scanlines" aria-hidden="true" />

      {/* Liquid glass: what is behind a pill is bent (a displacement map from soft noise), split into its red,
          green and blue at slightly different strengths (chromatic aberration), then frosted in the CSS. */}
      <svg className="ms-defs" aria-hidden="true" focusable="false">
        <filter id="ms-liquid" x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.007 0.011" numOctaves={2} seed={11} result="noise" />
          <feGaussianBlur in="noise" stdDeviation={3} result="map" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale={34} xChannelSelector="R" yChannelSelector="G" result="dr" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale={48} xChannelSelector="R" yChannelSelector="G" result="dg" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale={62} xChannelSelector="R" yChannelSelector="G" result="db" />
          <feColorMatrix in="dr" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
          <feColorMatrix in="dg" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g" />
          <feColorMatrix in="db" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b" />
          <feBlend in="r" in2="g" mode="screen" result="rg" />
          <feBlend in="rg" in2="b" mode="screen" />
        </filter>
      </svg>

      <h1 className="ms-sr">{title}</h1>

      <nav className="ms-menu" aria-label="Main menu" inert={leaving !== null}>
        <button type="button" className={rowClass('start')} style={{ '--i': 0 } as CSSProperties} aria-current={menu.item === 'start'} onMouseEnter={() => hover('start')} onFocus={() => hover('start')} onClick={() => click('start')}>
          {inside('start')}
        </button>

        <button type="button" className={`${rowClass('scenario')} ms-row`} style={{ '--i': 1 } as CSSProperties} aria-current={menu.item === 'scenario'} onMouseEnter={() => hover('scenario')} onFocus={() => hover('scenario')} onClick={() => click('scenario')}>
          {inside('scenario')}
          <span className="ms-value">{SCENARIO.name}</span>
        </button>

        <div className={`${rowClass('difficulty')} ms-row`} style={{ '--i': 2 } as CSSProperties} role="group" aria-label="Difficulty" onMouseEnter={() => hover('difficulty')}>
          {inside('difficulty')}
          <span className="ms-levels">
            {DIFFICULTIES.map((d) => (
              <button key={d} type="button" className={`ms-level ms-glass${menu.difficulty === d ? ' on' : ''}`} aria-pressed={menu.difficulty === d} onFocus={() => hover('difficulty')} onClick={() => apply(pick(live.current.menu, d))}>
                {DIFFICULTY_LABEL[d]}
              </button>
            ))}
          </span>
        </div>

        <button type="button" className={rowClass('exit')} style={{ '--i': 3 } as CSSProperties} aria-current={menu.item === 'exit'} onMouseEnter={() => hover('exit')} onFocus={() => hover('exit')} onClick={() => click('exit')}>
          {inside('exit')}
        </button>

        {/* the line stays; only its words change */}
        <p className="ms-whisper" style={{ '--i': 4 } as CSSProperties} aria-live="polite">
          <span key={whisper} className="ms-whisper-text">
            {whisper}
          </span>
        </p>
      </nav>
    </div>
  );
}
