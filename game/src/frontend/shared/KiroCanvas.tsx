// Kiro's portrait (UI-13, D-250): the logo's ghost on a small canvas, in a mood that blends into the next over about
// half a second, talking for a moment each time she has a new line. Used by the play screen's Kiro panel, the
// report and the briefing files' guide. Reduced motion keeps her moods and drops the movement.

import { useEffect, useRef } from 'react';
import { EXPRESSIONS, LOGO_PATH, blendExpression, drawGhost, talkLevel, type Mood } from './ghost';

/** Kiro as a small still icon: the logo's outline and eyes (its own pixels, D-250). */
export function KiroIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size * 1.2} viewBox="30 22 88 106" aria-hidden="true">
      <path d={LOGO_PATH} fill="#fbf9ff" />
      <ellipse cx="78" cy="59.5" rx="4.6" ry="7" fill="#0e0a16" />
      <ellipse cx="95" cy="59.5" rx="4.6" ry="7" fill="#0e0a16" />
    </svg>
  );
}

export interface KiroCanvasProps {
  mood: Mood;
  /** Her latest line: each new one makes her talk for about as long as it takes to say. */
  line?: string | null;
  className?: string;
  /** How much of the canvas's height she fills (0..1). */
  fit?: number;
  /** Comes together (fades in, in slices) when she appears and again with each new line. */
  appear?: boolean;
  /** At most this many frames a second. */
  fps?: number;
}

/** About how long a line takes to say (seconds). */
export const sayingTime = (line: string): number => Math.min(6, 0.5 + line.split(/\s+/).filter(Boolean).length * 0.36);

export function KiroCanvas({ mood, line, className, fit = 0.72, appear = false, fps = 60 }: KiroCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ mood, from: -1, until: -1, formAt: -1 });
  useEffect(() => {
    live.current.mood = mood;
  }, [mood]);
  useEffect(() => {
    if (!line) return;
    const now = performance.now() / 1000;
    live.current.from = now;
    live.current.until = now + sayingTime(line);
    live.current.formAt = now;
  }, [line]);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    const reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const gap = 1000 / (reduce ? Math.min(fps, 15) : fps) - 2;
    let expr = EXPRESSIONS[live.current.mood];
    let raf = 0;
    let last = performance.now();
    let drawn = -Infinity;
    const t0 = last;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - drawn < gap) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      drawn = now;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth;
      const H = c.clientHeight;
      if (!W || !H) return;
      if (c.width !== Math.round(W * dpr)) c.width = Math.round(W * dpr);
      if (c.height !== Math.round(H * dpr)) c.height = Math.round(H * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      expr = blendExpression(expr, EXPRESSIONS[live.current.mood], reduce ? 1 : 1 - Math.exp(-dt * 5));
      const t = (now - t0) / 1000;
      const sec = now / 1000;
      const talk = talkLevel({ from: live.current.from, until: live.current.until, word: -1 }, sec, reduce);
      const size = Math.min(H * fit, W * 0.62);
      const formAt = live.current.formAt < 0 ? t0 / 1000 : live.current.formAt;
      const form = appear && !reduce ? Math.min(1, 0.3 + (sec - formAt) / 0.7) : 1;
      drawGhost(g, W / 2, H * 0.52, size, { t, expr, talk, reduce, form }, dpr);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [fit, appear, fps]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
