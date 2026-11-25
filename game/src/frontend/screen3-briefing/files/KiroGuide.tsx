// Kiro as the guide through the briefing places (D-222): a small animated portrait of her (the cinematic's
// enchantress) with the place's line and a remark on whatever is being inspected. She takes shape again each time
// she has something new to say, and can be hushed to a small crescent sigil and called back. Text only: reading
// is never interrupted by sound.

import { useEffect, useRef, useState } from 'react';
import { drawKiro } from '../cinema/characters';

export function KiroGuide({ line, remark }: { line: string; remark: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hushed, setHushed] = useState(false);
  const said = useRef({ text: '', at: 0 });
  const text = remark ?? line;
  useEffect(() => {
    said.current = { text, at: performance.now() };
  }, [text]);

  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g || hushed) return;
    const W = 150;
    const H = 190;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let last = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 1000 / 30) return;
      last = now;
      const since = (now - said.current.at) / 1000;
      const form = reduced ? 1 : Math.min(1, 0.35 + since / 0.7);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      // a bust: the figure drawn large, her waist below the frame
      drawKiro(g, W / 2, H * 2.05, H * 2.2, { t: reduced ? 0 : (now - t0) / 1000, form, talk: since < 2.4 ? 0.5 + 0.5 * Math.abs(Math.sin(now / 110)) : 0, look: 0.15, eyes: 0.8, glitch: since < 0.5 ? 0.3 : 0, hand: null }, dpr);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [hushed]);

  if (hushed)
    return (
      <button type="button" className="kg-sigil" onClick={() => setHushed(false)} aria-label="Call Kiro back" title="Call Kiro back">
        ☾
      </button>
    );
  return (
    <aside className="kg-root" aria-live="polite">
      <canvas ref={ref} className="kg-portrait" aria-hidden="true" />
      <div className="kg-bubble" key={text}>
        <p className="kg-line">{line}</p>
        {remark && <p className="kg-remark">{remark}</p>}
      </div>
      <button type="button" className="kg-hush" onClick={() => setHushed(true)} aria-label="Hush Kiro" title="Hush Kiro">
        ×
      </button>
    </aside>
  );
}
