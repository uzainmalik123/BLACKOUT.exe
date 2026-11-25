// The bleeding BLACKOUT.exe logo (D-181's LogoArt), on its own small canvas, so screen 3 carries the same mark as
// screen 2: bone letters soaking into blood, the drips forming, falling and drawing back.

import { useEffect, useRef } from 'react';
import { FACES } from '../shared/atlas';
import { LogoArt } from '../screen2-menu/logoArt';

export function LogoCanvas({ title, className = '' }: { title: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const logo = new LogoArt(title);
    let alive = true;
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      logo.resize(window.innerWidth, window.innerHeight, dpr);
      const w = Math.ceil(logo.width);
      const h = Math.ceil(logo.height + logo.ch * 16);
      canvas.width = Math.ceil(w * dpr);
      canvas.height = Math.ceil(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    if (document.fonts) {
      Promise.all(FACES.map((f) => document.fonts.load(f)))
        .then(() => alive && size())
        .catch(() => undefined);
    }
    const t0 = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const t = (now - t0) / 1000;
      const reveal = Math.min(1, t / 1.6);
      logo.render(t, reveal);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(logo.canvas, 0, 0, logo.width, logo.height);
      logo.drawDrips(ctx, 0, 0, t, reveal);
    };
    raf = requestAnimationFrame(frame);
    window.addEventListener('resize', size);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
    };
  }, [title]);
  return <canvas ref={ref} className={className} role="img" aria-label={title} />;
}
