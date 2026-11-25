// What haunts the desk (UI-05, D-223): a canvas over the monitors, never catching the mouse. The face in a monitor
// (stage 2), the ghosts round the screens and the wisps of stolen souls (stage 4), Death behind the chair in the glass
// (stage 5), his face rising across every screen (stage 6), the lunge when a move of his lands and the recoil when
// one is cut, Kiro's face close in the centre monitor at the last chance, and the end of "you're taken": his hand on
// the player's shoulder and the ink closing in. Each is driven by the engine's events through NightShift.tsx.

import { drawDeath, drawKiro } from '../screen3-briefing/cinema/characters';

type G = CanvasRenderingContext2D;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type MonitorName = 'left' | 'centre' | 'right';

export interface HauntView {
  t: number;
  monitors: Record<MonitorName, Rect> | null;
  /** The distorted face in one monitor, 0..1 how present (gone the moment the player looks at it). */
  face: { at: MonitorName; a: number } | null;
  /** 0..1 the ghosts round the monitors. */
  ghosts: number;
  /** 0..1 Death behind the chair, reflected in the centre screen. */
  reflection: number;
  /** 0..1 his face across all three screens (stage 6). */
  crimsonFace: number;
  /** Seconds since a move of his landed (the lunge), or -1. */
  lunge: number;
  /** Seconds since one was cut (the recoil), or -1. */
  recoil: number;
  /** Seconds since souls were stolen (the wisps), or -1. */
  drain: number;
  /** 0..1 Kiro's face in the centre monitor (the last chance). */
  lastChance: number;
  /** 0..1 the ink closing in ("you're taken"). */
  ink: number;
  /** 0..1 his hand settling on the shoulder. */
  hand: number;
}

const rand = (i: number): number => {
  const x = Math.sin(i * 91.7 + 17.3) * 43758.5453;
  return x - Math.floor(x);
};
const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v));

export function paintHaunt(g: G, w: number, h: number, dpr: number, v: HauntView): void {
  g.clearRect(0, 0, w, h);
  const m = v.monitors;
  if (m) {
    if (v.face && v.face.a > 0.01) monitorFace(g, m[v.face.at], v.face.a, v.t, dpr);
    if (v.reflection > 0.01) reflection(g, m.centre, v.reflection, v.t, dpr);
    if (v.crimsonFace > 0.01) for (const k of ['left', 'centre', 'right'] as const) crimsonFace(g, m[k], v.crimsonFace, v.t, k, dpr);
    if (v.ghosts > 0.01) ghosts(g, m, v.ghosts, v.t);
    if (v.drain >= 0 && v.drain < 3) wisps(g, m, v.drain, h);
    if (v.lastChance > 0.01) kiroClose(g, m.centre, v.lastChance, v.t, dpr);
  }
  if (v.lunge >= 0 && v.lunge < 0.9) lunge(g, w, h, v.lunge, v.t, dpr);
  if (v.recoil >= 0 && v.recoil < 1.2) recoil(g, w, h, v.recoil, v.t, dpr);
  if (v.hand > 0.01) hand(g, w, h, v.hand);
  if (v.ink > 0.01) ink(g, w, h, v.ink, v.t);
}

function clip(g: G, r: Rect): void {
  g.beginPath();
  g.rect(r.x, r.y, r.w, r.h);
  g.clip();
}

/** Stage 2: a face pressed into the glass of a monitor, smeared and glitching. */
function monitorFace(g: G, r: Rect, a: number, t: number, dpr: number): void {
  g.save();
  clip(g, r);
  const jitter = Math.sin(t * 47) > 0.6 ? (rand(Math.floor(t * 20)) - 0.5) * r.w * 0.06 : 0;
  g.globalAlpha = a * (0.55 + 0.35 * Math.sin(t * 13));
  g.globalCompositeOperation = 'screen';
  const s = r.h * 1.5;
  drawDeath(g, r.x + r.w / 2 + jitter, r.y + r.h * 1.25, s, { t, form: 1, point: 0, fragment: 0.25, eyes: 1 }, dpr);
  g.globalCompositeOperation = 'source-over';
  // scan tearing across it
  g.globalAlpha = a * 0.5;
  for (let i = 0; i < 5; i++) {
    const y = r.y + ((t * 0.7 + rand(i)) % 1) * r.h;
    g.fillStyle = 'rgba(255, 40, 60, 0.25)';
    g.fillRect(r.x, y, r.w, 2 + rand(i + 3) * 5);
  }
  g.restore();
}

/** Stage 5: behind the chair, in the centre screen's glass. */
function reflection(g: G, r: Rect, a: number, t: number, dpr: number): void {
  g.save();
  clip(g, r);
  g.globalAlpha = a * 0.42;
  g.globalCompositeOperation = 'screen';
  drawDeath(g, r.x + r.w * 0.68, r.y + r.h * 1.12, r.h * 1.05, { t, form: 1, point: 0, fragment: 0.05, eyes: 0.8 }, dpr);
  g.globalCompositeOperation = 'source-over';
  // the player's own head and shoulders, dark against the screen
  g.globalAlpha = a * 0.55;
  g.fillStyle = '#020204';
  g.beginPath();
  g.ellipse(r.x + r.w * 0.46, r.y + r.h * 0.78, r.w * 0.09, r.h * 0.13, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(r.x + r.w * 0.46, r.y + r.h * 1.08, r.w * 0.26, r.h * 0.2, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Stage 6: his face, slowly, across every screen. */
function crimsonFace(g: G, r: Rect, a: number, t: number, k: string, dpr: number): void {
  g.save();
  clip(g, r);
  g.globalAlpha = clamp(a) * 0.32 * (0.8 + 0.2 * Math.sin(t * 2 + k.length));
  g.globalCompositeOperation = 'screen';
  drawDeath(g, r.x + r.w / 2, r.y + r.h * 1.6, r.h * 2.1, { t, form: 1, point: 0, fragment: 0.15, eyes: 1 }, dpr);
  g.restore();
}

/** Stage 4: pale shapes at the edges of the monitors, drifting. */
function ghosts(g: G, m: Record<MonitorName, Rect>, a: number, t: number): void {
  const spots: Array<[Rect, number]> = [
    [m.left, -1],
    [m.left, 1],
    [m.centre, -1],
    [m.right, 1],
    [m.right, -1],
  ];
  spots.forEach(([r, side], i) => {
    const drift = Math.sin(t * 0.4 + i * 1.7);
    const x = side < 0 ? r.x - r.w * 0.04 + drift * r.w * 0.03 : r.x + r.w * 1.04 + drift * r.w * 0.03;
    const y = r.y + r.h * (0.35 + 0.3 * rand(i)) + Math.sin(t * 0.7 + i) * r.h * 0.04;
    const s = r.h * (0.5 + 0.2 * rand(i + 5));
    const alpha = a * (0.12 + 0.1 * Math.sin(t * 0.9 + i * 2.1));
    if (alpha <= 0.01) return;
    g.save();
    g.globalAlpha = alpha;
    const gr = g.createLinearGradient(x, y - s * 0.5, x, y + s * 0.6);
    gr.addColorStop(0, 'rgba(200, 225, 255, 0.9)');
    gr.addColorStop(1, 'rgba(200, 225, 255, 0)');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(x, y - s * 0.38, s * 0.09, s * 0.12, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(x - s * 0.1, y - s * 0.28);
    g.quadraticCurveTo(x - s * 0.24, y + s * 0.1, x - s * 0.16 + Math.sin(t * 2 + i) * s * 0.04, y + s * 0.6);
    g.lineTo(x + s * 0.16 + Math.sin(t * 2.3 + i) * s * 0.04, y + s * 0.6);
    g.quadraticCurveTo(x + s * 0.24, y + s * 0.1, x + s * 0.1, y - s * 0.28);
    g.closePath();
    g.fill();
    // the dark of the eyes
    g.fillStyle = 'rgba(0, 0, 0, 0.7)';
    g.beginPath();
    g.ellipse(x - s * 0.035, y - s * 0.4, s * 0.018, s * 0.026, 0, 0, Math.PI * 2);
    g.ellipse(x + s * 0.035, y - s * 0.4, s * 0.018, s * 0.026, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  });
}

/** Souls leaving: pale wisps rising from the screens and away. */
function wisps(g: G, m: Record<MonitorName, Rect>, s: number, h: number): void {
  const life = clamp(s / 3);
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 18; i++) {
    const r = [m.left, m.centre, m.right][i % 3]!;
    const x = r.x + r.w * rand(i) + Math.sin(s * 3 + i) * 12;
    const y = r.y + r.h * (0.3 + 0.6 * rand(i + 2)) - life * h * (0.25 + 0.3 * rand(i + 4));
    const a = Math.sin(life * Math.PI) * 0.5;
    const rad = 10 + 16 * rand(i + 7);
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(190, 230, 255, ${a.toFixed(3)})`);
    gr.addColorStop(1, 'rgba(190, 230, 255, 0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  g.restore();
}

/** A move of his landed: he lunges at the glass, then is gone. */
function lunge(g: G, w: number, h: number, s: number, t: number, dpr: number): void {
  const u = s / 0.9;
  const a = u < 0.25 ? u / 0.25 : 1 - (u - 0.25) / 0.75;
  g.save();
  g.globalAlpha = clamp(a) * 0.75;
  const size = h * (0.9 + u * 0.9);
  drawDeath(g, w / 2, h * 0.55 + size * 0.88, size, { t, form: 1, point: clamp(u * 2), fragment: 0.1, eyes: 1 }, dpr);
  g.restore();
  g.fillStyle = `rgba(160, 0, 20, ${(0.22 * clamp(a)).toFixed(3)})`;
  g.fillRect(0, 0, w, h);
}

/** One was cut: he jerks back into the dark and breaks apart a little. */
function recoil(g: G, w: number, h: number, s: number, t: number, dpr: number): void {
  const u = s / 1.2;
  g.save();
  g.globalAlpha = (1 - u) * 0.45;
  const size = h * (0.7 - u * 0.4);
  drawDeath(g, w / 2 + u * w * 0.08, h * 0.32 + size, size, { t, form: 1, point: 0, fragment: 0.3 + u * 0.6, eyes: 1 - u }, dpr);
  g.restore();
}

/** The last chance: Kiro's face, close, in the centre monitor, the screen glitching round her. */
function kiroClose(g: G, r: Rect, a: number, t: number, dpr: number): void {
  g.save();
  clip(g, r);
  g.fillStyle = `rgba(4, 6, 12, ${(0.85 * a).toFixed(3)})`;
  g.fillRect(r.x, r.y, r.w, r.h);
  g.globalAlpha = a;
  const s = r.h * 3.1;
  drawKiro(g, r.x + r.w / 2, r.y + r.h * 0.52 + s * 0.86, s, { t, form: 1, talk: 0.6 + 0.4 * Math.sin(t * 9), look: Math.sin(t * 0.6) * 0.15, eyes: 0.85, glitch: 0.12 + 0.2 * (Math.sin(t * 17) > 0.7 ? 1 : 0), hand: null }, dpr);
  // glitch bands
  for (let i = 0; i < 6; i++) {
    if (rand(Math.floor(t * 12) + i) < 0.6) continue;
    const y = r.y + rand(i + Math.floor(t * 9)) * r.h;
    g.fillStyle = i % 2 ? 'rgba(70, 232, 255, 0.18)' : 'rgba(180, 77, 255, 0.16)';
    g.fillRect(r.x, y, r.w, 3 + rand(i) * 10);
  }
  g.restore();
}

/** "You're taken": a bony hand comes down over the right shoulder and settles. */
function hand(g: G, w: number, h: number, a: number): void {
  const u = clamp(a);
  const S = h * 0.5;
  const x = w * 0.8;
  const y = -S * 0.4 + u * (h * 0.78);
  g.save();
  g.translate(x, y);
  g.rotate(0.5);
  g.globalAlpha = clamp(u * 1.6);
  // the sleeve, ink black
  g.fillStyle = '#050407';
  g.beginPath();
  g.moveTo(-S * 0.25, -S * 1.2);
  g.lineTo(S * 0.25, -S * 1.2);
  g.lineTo(S * 0.18, -S * 0.15);
  g.lineTo(-S * 0.18, -S * 0.15);
  g.closePath();
  g.fill();
  g.strokeStyle = '#ddd5bd';
  g.lineCap = 'round';
  g.shadowColor = 'rgba(0, 0, 0, 0.8)';
  g.shadowBlur = 12;
  // metacarpals and fingers, bone
  for (let f = 0; f < 4; f++) {
    const fx = (f - 1.5) * S * 0.07;
    g.lineWidth = S * 0.028;
    g.beginPath();
    g.moveTo(fx * 0.6, -S * 0.12);
    g.lineTo(fx, S * 0.08);
    g.lineTo(fx * 1.05, S * 0.2);
    g.lineTo(fx * 1.08 + S * 0.01, S * 0.3);
    g.stroke();
  }
  g.lineWidth = S * 0.03;
  g.beginPath();
  g.moveTo(-S * 0.12, -S * 0.1);
  g.lineTo(-S * 0.2, S * 0.02);
  g.lineTo(-S * 0.23, S * 0.12);
  g.stroke();
  g.restore();
}

/** "You're taken": ink closing in from the edges until there is nothing else. */
function ink(g: G, w: number, h: number, a: number, t: number): void {
  const u = clamp(a);
  g.save();
  g.fillStyle = '#000';
  const R = Math.hypot(w, h);
  for (let i = 0; i < 26; i++) {
    const ang = (i / 26) * Math.PI * 2 + rand(i) * 0.2;
    const ex = w / 2 + Math.cos(ang) * R * 0.6;
    const ey = h / 2 + Math.sin(ang) * R * 0.6;
    const r = R * (0.08 + 0.55 * u) * (0.7 + 0.5 * rand(i + 3)) + Math.sin(t * 1.3 + i) * 6;
    g.beginPath();
    g.arc(ex, ey, Math.max(0, r), 0, Math.PI * 2);
    g.fill();
  }
  if (u > 0.85) {
    g.fillStyle = `rgba(0, 0, 0, ${((u - 0.85) / 0.15).toFixed(3)})`;
    g.fillRect(0, 0, w, h);
  }
  g.restore();
}
