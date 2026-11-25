// The Chart Room (D-222): the system map as the cinematic's antique sea chart on its candle-lit table, at rest and
// explorable. Hovering a place rings it in light; choosing one (click, or Tab and Enter) zooms the chart to it and
// opens a card with its exact values; Escape or "Whole chart" zooms back out. Kiro remarks on what is chosen.

import { useEffect, useRef, useState } from 'react';
import { paintShot, type Frame, type Hotspot } from '../cinema/shots';
import { KiroGuide } from './KiroGuide';
import { PLACES } from './sceneData';

/** Kiro's remark for a place on the chart, by its hotspot id. */
function remarkFor(id: string | null, title: string): string | null {
  if (!id) return null;
  if (id.startsWith('door-')) return /login/i.test(title) ? "That one never closes. If I were him, I'd start there." : 'A door with a lock. You can close it from the feature flags, at a cost to the customers who use it.';
  const r: Record<string, string> = {
    'part-customers': 'Every ship out there is a customer. Most of them.',
    'part-web': 'Every request comes through this gate, and it writes each one down. If it falls, the whole shop goes dark.',
    'part-app': 'The shop itself. It keeps its own diary of everything that breaks.',
    'part-db': 'The vault. Everyone they trusted us with is in here.',
    firewall: 'A sea wall with nobody on it tonight.',
    waf: 'A lighthouse with its lamp out. No rules, no warnings.',
    'log-0': 'One line for every visitor. This is where you will read his footsteps.',
    'log-1': 'When the shop stumbles, it writes it here.',
    backup: 'Every hour, on the hour. Restoring is a time machine: it takes back the good with the bad.',
  };
  return r[id] ?? null;
}

export function ChartRoom() {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const hotRef = useRef<Hotspot[]>([]);
  const view = useRef({ z: 1, cx: 0, cy: 0, tz: 1, tcx: 0, tcy: 0 });
  const [hots, setHots] = useState<Hotspot[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Hotspot | null>(null);
  const live = useRef({ hover: null as string | null, chosen: null as Hotspot | null, mx: 0, my: 0 });
  useEffect(() => {
    live.current.hover = hover;
    live.current.chosen = chosen;
  });

  useEffect(() => {
    const el = host.current;
    const c = canvas.current;
    const g = c?.getContext('2d');
    if (!el || !c || !g) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0;
    let H = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const size = () => {
      W = Math.max(320, el.clientWidth);
      H = Math.max(240, el.clientHeight);
      c.width = Math.floor(W * dpr);
      c.height = Math.floor(H * dpr);
      c.style.width = `${W}px`;
      c.style.height = `${H}px`;
      const v = view.current;
      if (!v.cx) Object.assign(v, { cx: W / 2, cy: H / 2, tcx: W / 2, tcy: H / 2 });
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    let raf = 0;
    let lastHots = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const v = view.current;
      const ch = live.current.chosen;
      v.tz = ch ? 1.9 : 1;
      v.tcx = ch ? ch.x + ch.w / 2 : W / 2;
      v.tcy = ch ? ch.y + ch.h / 2 : H / 2;
      const k = reduced ? 1 : 0.12;
      v.z += (v.tz - v.z) * k;
      v.cx += (v.tcx - v.cx) * k;
      v.cy += (v.tcy - v.cy) * k;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#0b0705';
      g.fillRect(0, 0, W, H);
      // zoom about the chosen place, keeping it in the middle
      g.translate(W / 2, H / 2);
      g.scale(v.z, v.z);
      g.translate(-v.cx, -v.cy);
      const f: Frame = { g, W, H, dpr, t: Math.max(0, (now - t0) / 1000), st: 9.5, u: 0.95, mx: reduced ? 0 : live.current.mx * 0.4, my: reduced ? 0 : live.current.my * 0.4, talk: 0, hover: live.current.hover, reduced, hot: [] };
      paintShot('map', f);
      // a ring of light round the place under the pointer, and the chosen one
      for (const id of [live.current.hover, ch?.id]) {
        const h = f.hot.find((x) => x.id === id);
        if (!h) continue;
        g.save();
        g.strokeStyle = h.tone === 'crimson' ? 'rgba(255, 42, 74, 0.9)' : h.tone === 'emerald' ? 'rgba(61, 220, 151, 0.9)' : 'rgba(70, 232, 255, 0.95)';
        g.lineWidth = 2.5 / v.z;
        g.shadowColor = g.strokeStyle;
        g.shadowBlur = 14;
        g.beginPath();
        g.roundRect(h.x - 6, h.y - 6, h.w + 12, h.h + 12, 12);
        g.stroke();
        g.restore();
      }
      // hotspots in screen space, for the pointer and the keyboard
      hotRef.current = f.hot.map((h) => ({ ...h, x: (h.x - v.cx) * v.z + W / 2, y: (h.y - v.cy) * v.z + H / 2, w: h.w * v.z, h: h.h * v.z }));
      if (now - lastHots > 300) {
        lastHots = now;
        const next = hotRef.current;
        setHots((cur) => (cur.length === next.length && cur.every((x, i) => x.id === next[i]!.id && Math.abs(x.x - next[i]!.x) < 3 && Math.abs(x.y - next[i]!.y) < 3) ? cur : next));
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // Escape zooms back out before it closes the files
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && live.current.chosen) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setChosen(null);
      }
    };
    window.addEventListener('keydown', down, true);
    return () => window.removeEventListener('keydown', down, true);
  }, []);

  const at = (e: { clientX: number; clientY: number }) => {
    const r = host.current?.getBoundingClientRect();
    if (!r) return null;
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    live.current.mx = (x / r.width) * 2 - 1;
    live.current.my = (y / r.height) * 2 - 1;
    return hotRef.current.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) ?? null;
  };

  const choose = (h: Hotspot | null) => setChosen((cur) => (h && cur?.id !== h.id ? h : null));
  const place = chosen ?? hots.find((h) => h.id === hover) ?? null;

  return (
    <div
      ref={host}
      className={`fs-scene fs-chart${hover ? ' pointing' : ''}`}
      onPointerMove={(e) => setHover(at(e)?.id ?? null)}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => choose(at(e))}
    >
      <canvas ref={canvas} className="fs-canvas" aria-hidden="true" />
      <div className="fs-hots">
        {hots.map((h) => (
          <button key={h.id} type="button" className="fs-hot" style={{ left: h.x, top: h.y, width: h.w, height: h.h }} aria-label={`${h.title}: ${h.body}`} aria-pressed={chosen?.id === h.id} onFocus={() => setHover(h.id)} onBlur={() => setHover(null)} onClick={(e) => {
            e.stopPropagation();
            choose(h);
          }} />
        ))}
      </div>
      {place && (
        <div className={`fs-card ${place.tone}${chosen ? ' chosen' : ''}`} role="note">
          <b>{place.title}</b>
          {place.body.split(' · ').map((line, i) => (
            <span key={i}>{line}</span>
          ))}
          {chosen && (
            <button type="button" className="fs-back" onClick={(e) => {
              e.stopPropagation();
              setChosen(null);
            }}>
              ← Whole chart
            </button>
          )}
        </div>
      )}
      {!place && <p className="fs-hint">Point at a place on the chart, or Tab to it; choose it to look closer.</p>}
      <KiroGuide line={PLACES['system-map'].caption} remark={remarkFor(chosen?.id ?? hover, place?.title ?? '')} />
    </div>
  );
}
