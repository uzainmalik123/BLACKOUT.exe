// The title screen (UI-02's title) and the desktop gate (UI-01).
// The scene is a canvas of characters (scene.ts); this component owns input and the real UI:
// the hint, the menu's two buttons, and the phone/small-window gate. The screen is silent.

import { useCallback, useEffect, useRef, useState } from 'react';
import { needsDesktop } from './curtain';
import { CurtainScene, type SceneUi, type Selection } from './scene';
import './TitleScreen.css';

export const TAGLINE = ['Keep the system alive.', 'Death is already inside.'] as const;

function detectGate(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const coarseOnly = window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
  return needsDesktop(window.innerWidth, coarseOnly);
}

export interface TitleScreenProps {
  title: string;
  onEnterSystem: () => void;
  onExit: () => void;
}

export function TitleScreen({ title, onEnterSystem, onExit }: TitleScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<CurtainScene | null>(null);
  const enterRef = useRef<HTMLButtonElement>(null);
  const exitRef = useRef<HTMLButtonElement>(null);
  const callbacks = useRef({ onEnterSystem, onExit });
  const live = useRef({ menu: false, selected: 'enter' as Selection });

  const [gate, setGate] = useState(detectGate);
  const [ui, setUi] = useState<SceneUi>({ phase: 'intro', menu: false });
  const [selected, setSelected] = useState<Selection>('enter');

  useEffect(() => {
    callbacks.current = { onEnterSystem, onExit };
  });
  useEffect(() => {
    live.current.menu = ui.menu;
    live.current.selected = selected;
  });

  // the scene lives as long as the screen (rebuilt if the gate flips on resize)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scene = new CurtainScene(canvas, {
      title,
      tagline: TAGLINE,
      gate,
      reducedMotion,
      onUi: setUi,
      onEntered: () => callbacks.current.onEnterSystem(),
      onExited: () => callbacks.current.onExit(),
    });
    sceneRef.current = scene;
    let pending = 0;
    const onResize = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        scene.resize();
        setGate(detectGate());
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(pending);
      scene.destroy();
      sceneRef.current = null;
    };
  }, [gate, title]);

  useEffect(() => {
    sceneRef.current?.setSelection(selected);
  }, [selected]);

  useEffect(() => {
    if (!ui.menu) return;
    (selected === 'enter' ? enterRef : exitRef).current?.focus({ preventScroll: true });
  }, [ui.menu, selected]);

  const activate = useCallback((which: Selection) => {
    if (which === 'enter') sceneRef.current?.enter();
    else sceneRef.current?.exit();
  }, []);

  const choose = useCallback((which: Selection) => {
    setSelected(which);
  }, []);

  useEffect(() => {
    if (gate) return;
    const isMenuButton = (el: Element | null) => el === enterRef.current || el === exitRef.current;
    // The curtains open on their own. Until the choice appears, any key or click only hurries
    // them along (or, after EXIT, brings them back); then the arrows move between the two.
    const down = (e: KeyboardEvent) => {
      if (!live.current.menu) {
        if (!e.repeat) sceneRef.current?.nudge();
        return;
      }
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown':
          e.preventDefault();
          choose(live.current.selected === 'enter' ? 'exit' : 'enter');
          break;
        case 'Enter':
        case ' ':
          // a focused button handles its own Enter/Space
          if (!isMenuButton(document.activeElement)) {
            e.preventDefault();
            activate(live.current.selected);
          }
          break;
      }
    };
    const press = (e: PointerEvent) => {
      if (!live.current.menu && !(e.target instanceof Element && e.target.closest('.ts-choice'))) sceneRef.current?.nudge();
    };
    const move = (e: PointerEvent) => {
      sceneRef.current?.setMouse((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('pointerdown', press);
    window.addEventListener('pointermove', move);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('pointerdown', press);
      window.removeEventListener('pointermove', move);
    };
  }, [gate, activate, choose]);

  return (
    <div className="ts-root" data-phase={gate ? 'gate' : ui.phase}>
      <canvas ref={canvasRef} className="ts-canvas" aria-hidden="true" />

      {/* Cinematic overlays — purely visual, aria-hidden */}
      <div className="ts-overlay-vignette"  aria-hidden="true" />
      <div className="ts-overlay-scanlines" aria-hidden="true" />
      <div className="ts-overlay-aberration" aria-hidden="true" />

      <h1 className="ts-sr">{title}</h1>
      <p className="ts-sr">{TAGLINE.join(' ')}</p>

      {gate ? (
        <section className="ts-gate" role="alert" aria-labelledby="ts-gate-h">
          <p className="ts-gate-title" aria-hidden="true">
            {title}
          </p>
          <h2 id="ts-gate-h" className="ts-heading">
            DESKTOP ACCESS REQUIRED
          </h2>
          <p className="ts-note">This experience requires a desktop computer. Mobile devices are not supported.</p>
          <p className="ts-gate-whisper">She will wait for you at a real keyboard.</p>
        </section>
      ) : (
        <>
          {/* No panel: the choice is written straight onto the dark, like an inscription. */}
          <section className={`ts-choice${ui.menu ? ' on' : ''}`} inert={!ui.menu} aria-hidden={!ui.menu} aria-labelledby="ts-choice-h">
            <h2 id="ts-choice-h" className="ts-rule">
              <span>Desktop access required</span>
            </h2>
            <p className="ts-whisper">This experience requires a desktop computer. Mobile devices are not supported.</p>
            <div className="ts-paths" data-sel={selected}>
              <button
                ref={enterRef}
                type="button"
                className={`ts-path enter${selected === 'enter' ? ' sel' : ''}`}
                onMouseEnter={() => choose('enter')}
                onFocus={() => choose('enter')}
                onClick={() => activate('enter')}
              >
                <span className="ts-sigil" aria-hidden="true">
                  ◆
                </span>
                Enter the system
              </button>
              <span className="ts-or" aria-hidden="true">
                or
              </span>
              <button
                ref={exitRef}
                type="button"
                className={`ts-path exit${selected === 'exit' ? ' sel' : ''}`}
                onMouseEnter={() => choose('exit')}
                onFocus={() => choose('exit')}
                onClick={() => activate('exit')}
              >
                <span className="ts-sigil" aria-hidden="true">
                  ◆
                </span>
                Exit
              </button>
            </div>
          </section>

          {ui.phase === 'closed' && (
            <div className="ts-closed" role="status">
              <p>The system will wait.</p>
              <p className="ts-keys">Press any key to return</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
