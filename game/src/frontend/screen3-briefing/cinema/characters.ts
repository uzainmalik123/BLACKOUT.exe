// The cinematic's two characters (D-189, D-221), painted on canvas each frame as original illustrations.
//
// Kiro, the player's familiar, is a dark enchantress: long matted black locks falling past her waist, a tarnished
// crescent moon rising from her top knot, ash-grey skin marked with small sigils, eyes ringed in black smudge (one
// cyan, one amber, faintly lit), a choker of green-bronze beads, a dark wrapped bodice with plates and crystals,
// armlets and bracelets of chain, and hands stained black to the wrist, a chain swinging between them. Cyan smoke
// curls off her, and a holographic shimmer slices her sideways while she forms or glitches.
//
// Death is the grim reaper, drawn in ink: a hooded black robe whose edges break into splatter and speckle, a skull
// in the hood's dark with deep sockets and bared teeth, two faint embers for eyes, a scythe whose long blade arcs
// over his head, and a bony hand that rises to point at the viewer.
//
// Both are drawn into a reusable buffer first (at three-quarter resolution), so the shimmer and the fragmenting can
// slice the whole figure.

type G = CanvasRenderingContext2D;

export const CYAN = '#46e8ff';
export const AMBER = '#ffb23e';
export const CRIMSON = '#ff2a4a';
export const VIOLET = '#b44dff';
export const EMERALD = '#3ddc97';

const rand = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** A canvas reused between frames for drawing a figure before slicing it. */
class Buffer {
  readonly canvas: HTMLCanvasElement;
  readonly g: G;
  constructor() {
    this.canvas = document.createElement('canvas');
    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('2D canvas unavailable');
    this.g = g;
  }
  size(w: number, h: number, dpr: number): G {
    const W = Math.max(2, Math.ceil(w * dpr));
    const H = Math.max(2, Math.ceil(h * dpr));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    } else this.g.clearRect(0, 0, W, H);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return this.g;
  }
}

let kiroBuf: Buffer | null = null;
let deathBuf: Buffer | null = null;

/** Draw a buffer onto `g` in horizontal slices, some shifted sideways (the shimmer, the fragmenting). */
function sliced(g: G, buf: Buffer, x: number, y: number, w: number, h: number, amount: number, t: number, tint: boolean): void {
  if (amount <= 0.001) {
    g.drawImage(buf.canvas, x, y, w, h);
    return;
  }
  const bands = 26;
  const sw = buf.canvas.width;
  const sh = buf.canvas.height;
  const step = Math.floor(t * 12);
  for (let b = 0; b < bands; b++) {
    const r = rand(b * 13.7 + step * 3.1);
    const shift = r < 0.35 * amount ? (rand(b + step) - 0.5) * w * 0.18 * amount : 0;
    const y0 = (b / bands) * h;
    const y1 = ((b + 1) / bands) * h;
    g.drawImage(buf.canvas, 0, (b / bands) * sh, sw, sh / bands, x + shift, y + y0, w, y1 - y0 + 0.5);
  }
  if (tint) {
    g.save();
    g.globalAlpha = 0.28 * amount;
    g.globalCompositeOperation = 'lighter';
    g.drawImage(buf.canvas, x + 4 * amount, y, w, h);
    g.restore();
  }
}

/** A curved, tapering strand (a lock of hair, a chain's sag) from a toward b, bulging by `bend`. */
function strand(b: G, ax: number, ay: number, bx: number, by: number, bend: number, w0: number, w1: number, color: string): void {
  const mx = (ax + bx) / 2 + bend;
  const my = (ay + by) / 2;
  const steps = 8;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const p = (t: number) => ({ x: (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * mx + t * t * bx, y: (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * my + t * t * by });
    const a = p(t0);
    const c = p(t1);
    b.strokeStyle = color;
    b.lineWidth = Math.max(0.6, w0 + (w1 - w0) * t0);
    b.beginPath();
    b.moveTo(a.x, a.y);
    b.lineTo(c.x, c.y);
    b.stroke();
  }
}

export interface KiroPose {
  t: number;
  /** 0..1 how much of her has come together. */
  form: number;
  /** 0..1 how much she is talking. */
  talk: number;
  /** -1..1 where her head turns (negative: toward her right, our left). */
  look: number;
  /** 0..1 how wide her eyes are; low is a narrow, knowing look. */
  eyes: number;
  /** 0..1 an extra glitch. */
  glitch: number;
  /** Raise her right hand toward (x, y) in figure units, a cyan light at the fingertip; null to hold the chain. */
  hand: { x: number; y: number } | null;
}

const SKIN = '#9a9c96';
const SKIN_LIGHT = '#c4c6bf';
const SKIN_DARK = '#5d5f5a';
const HAIR = '#0b0a0d';
const BRONZE = '#a8946a';
const VERDIGRIS = '#6c8f7c';

/** A hand stained black to the wrist, long fingers, from the wrist along `ang`. */
function darkHand(b: G, wx: number, wy: number, ang: number, S: number, curl: number): void {
  const L = S * 0.07;
  b.save();
  b.translate(wx, wy);
  b.rotate(ang);
  b.fillStyle = '#1a1716';
  b.beginPath();
  b.ellipse(L * 0.35, 0, L * 0.42, L * 0.3, 0, 0, Math.PI * 2);
  b.fill();
  b.strokeStyle = '#1a1716';
  b.lineCap = 'round';
  for (let f = 0; f < 4; f++) {
    const y0 = (f - 1.5) * L * 0.16;
    b.lineWidth = L * 0.13;
    b.beginPath();
    b.moveTo(L * 0.6, y0);
    b.quadraticCurveTo(L * 1.05, y0 + curl * L * 0.2, L * (1.25 - f * 0.05), y0 + curl * L * (0.5 + f * 0.05));
    b.stroke();
  }
  b.lineWidth = L * 0.14;
  b.beginPath();
  b.moveTo(L * 0.3, -L * 0.25);
  b.lineTo(L * 0.7, -L * 0.5);
  b.stroke();
  // a ring catching the light
  b.fillStyle = BRONZE;
  b.beginPath();
  b.arc(L * 0.75, -L * 0.04, L * 0.06, 0, Math.PI * 2);
  b.fill();
  b.restore();
}

/** Kiro, standing with her base at (x, y) and her crescent's tip `s` pixels above it. About 0.8 s wide. */
export function drawKiro(g: G, x: number, y: number, s: number, p: KiroPose, screenDpr: number): void {
  if (p.form <= 0.01) return;
  const dpr = screenDpr * 0.75;
  if (!kiroBuf) kiroBuf = new Buffer();
  const bw = s * 1.1;
  const bh = s * 1.08;
  const b = kiroBuf.size(bw, bh, dpr);
  b.save();
  b.translate(bw / 2, bh);
  const S = s;
  const t = p.t;
  const sway = Math.sin(t * 0.8) * S * 0.006;
  const turn = p.look * S * 0.02;
  b.lineCap = 'round';
  b.lineJoin = 'round';
  // cyan smoke behind her
  for (let i = 0; i < 7; i++) {
    const life = (t * 0.12 + i / 7) % 1;
    const sx = (rand(i) - 0.5) * S * 0.6 + Math.sin(t * 0.7 + i) * S * 0.04;
    const sy = -S * (0.05 + life * 0.95);
    const r = S * (0.05 + life * 0.08);
    const a = Math.sin(life * Math.PI) * 0.2;
    const gr = b.createRadialGradient(sx, sy, 0, sx, sy, r);
    gr.addColorStop(0, `rgba(70, 232, 255, ${a.toFixed(3)})`);
    gr.addColorStop(1, 'rgba(70, 232, 255, 0)');
    b.fillStyle = gr;
    b.fillRect(sx - r, sy - r, r * 2, r * 2);
  }
  // the mass of hair behind her: long matted locks to below the waist
  for (let i = 0; i < 34; i++) {
    const u = i / 33 - 0.5;
    const x0 = u * S * 0.16 + turn;
    const y0 = -S * 0.9 + Math.abs(u) * S * 0.05;
    const len = S * (0.62 + 0.25 * rand(i));
    const spread = u * S * 0.42;
    const w = S * (0.011 + 0.006 * rand(i + 4));
    strand(b, x0, y0, x0 + spread + Math.sin(t * 0.7 + i) * S * 0.015, y0 + len, u * S * 0.12 + Math.sin(t * 0.5 + i * 0.7) * S * 0.02, w, w * 0.6, i % 3 ? HAIR : '#16151a');
  }
  // the body: ash-grey skin, the bodice wrapped dark over it
  const skinGrad = b.createLinearGradient(-S * 0.2, 0, S * 0.2, 0);
  skinGrad.addColorStop(0, SKIN_DARK);
  skinGrad.addColorStop(0.45, SKIN_LIGHT);
  skinGrad.addColorStop(1, SKIN);
  const body = new Path2D();
  body.moveTo(-S * 0.05 + sway, -S * 0.73);
  body.quadraticCurveTo(-S * 0.17, -S * 0.7, -S * 0.18, -S * 0.64);
  body.quadraticCurveTo(-S * 0.12, -S * 0.5, -S * 0.11, -S * 0.38);
  body.quadraticCurveTo(-S * 0.16, -S * 0.2, -S * 0.17, 0);
  body.lineTo(S * 0.17, 0);
  body.quadraticCurveTo(S * 0.16, -S * 0.2, S * 0.11, -S * 0.38);
  body.quadraticCurveTo(S * 0.12, -S * 0.5, S * 0.18, -S * 0.64);
  body.quadraticCurveTo(S * 0.17, -S * 0.7, S * 0.05 + sway, -S * 0.73);
  body.closePath();
  b.fillStyle = skinGrad;
  b.fill(body);
  // grime and markings on the skin
  b.save();
  b.clip(body);
  for (let i = 0; i < 18; i++) {
    const mx = (rand(i + 20) - 0.5) * S * 0.32;
    const my = -S * (0.1 + rand(i + 30) * 0.6);
    const r = S * (0.012 + rand(i + 40) * 0.03);
    b.fillStyle = `rgba(40, 42, 38, ${(0.15 + rand(i) * 0.25).toFixed(3)})`;
    b.beginPath();
    b.ellipse(mx, my, r, r * 0.7, rand(i) * 3, 0, Math.PI * 2);
    b.fill();
  }
  // a sigil circle on the hip
  b.strokeStyle = 'rgba(20, 20, 22, 0.75)';
  b.lineWidth = Math.max(1, S * 0.004);
  b.beginPath();
  b.arc(S * 0.09, -S * 0.12, S * 0.045, 0, Math.PI * 2);
  b.moveTo(S * 0.09, -S * 0.165);
  b.lineTo(S * 0.09, -S * 0.02);
  b.moveTo(S * 0.06, -S * 0.12);
  b.lineTo(S * 0.12, -S * 0.12);
  b.stroke();
  b.restore();
  // the bodice: dark wrappings, bronze plates, a few green crystals
  b.fillStyle = '#1b1c1a';
  b.beginPath();
  b.moveTo(-S * 0.13, -S * 0.62);
  b.quadraticCurveTo(0, -S * 0.55, S * 0.13, -S * 0.62);
  b.lineTo(S * 0.12, -S * 0.44);
  b.quadraticCurveTo(0, -S * 0.4, -S * 0.12, -S * 0.44);
  b.closePath();
  b.fill();
  b.strokeStyle = 'rgba(168, 148, 106, 0.8)';
  b.lineWidth = Math.max(1, S * 0.004);
  for (let k = 0; k < 4; k++) {
    b.beginPath();
    b.moveTo(-S * 0.12 + k * S * 0.02, -S * (0.6 - k * 0.04));
    b.lineTo(S * 0.12 - k * S * 0.02, -S * (0.6 - k * 0.04));
    b.stroke();
  }
  // a skirt of dark tatters hung with crystals
  for (let k = 0; k < 16; k++) {
    const x0 = -S * 0.13 + (k / 15) * S * 0.26;
    b.fillStyle = k % 2 ? '#141413' : '#20211e';
    b.beginPath();
    b.moveTo(x0 - S * 0.012, -S * 0.3);
    b.lineTo(x0 + S * 0.012, -S * 0.3);
    b.lineTo(x0 + S * 0.006 + Math.sin(t + k) * S * 0.004, -S * (0.1 + 0.08 * rand(k)));
    b.lineTo(x0 - S * 0.006 + Math.sin(t + k) * S * 0.004, -S * (0.1 + 0.08 * rand(k)));
    b.closePath();
    b.fill();
    if (k % 3 === 0) {
      b.fillStyle = 'rgba(120, 170, 140, 0.8)';
      b.beginPath();
      b.moveTo(x0, -S * 0.26);
      b.lineTo(x0 + S * 0.008, -S * 0.235);
      b.lineTo(x0, -S * 0.21);
      b.lineTo(x0 - S * 0.008, -S * 0.235);
      b.closePath();
      b.fill();
    }
  }
  b.fillStyle = '#2b2a24';
  b.fillRect(-S * 0.13, -S * 0.33, S * 0.26, S * 0.025);
  // the arms: grey, chained; her hands black to the wrist
  const arm = (side: number, ex: number, ey: number, hx: number, hy: number) => {
    const sx = side * S * 0.165;
    const sy = -S * 0.64;
    b.strokeStyle = SKIN;
    b.lineWidth = S * 0.045;
    b.beginPath();
    b.moveTo(sx, sy);
    b.quadraticCurveTo(ex, ey, hx, hy);
    b.stroke();
    b.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    b.lineWidth = S * 0.012;
    b.beginPath();
    b.moveTo(sx - side * S * 0.01, sy);
    b.quadraticCurveTo(ex - side * S * 0.01, ey, hx, hy);
    b.stroke();
    // armlets and dangling chain on the forearm
    for (let k = 0; k < 3; k++) {
      const u = 0.55 + k * 0.12;
      const ax = (1 - u) * (1 - u) * sx + 2 * (1 - u) * u * ex + u * u * hx;
      const ay = (1 - u) * (1 - u) * sy + 2 * (1 - u) * u * ey + u * u * hy;
      b.strokeStyle = k === 1 ? VERDIGRIS : BRONZE;
      b.lineWidth = Math.max(1, S * 0.008);
      b.beginPath();
      b.ellipse(ax, ay, S * 0.026, S * 0.01, 0.4 * side, 0, Math.PI * 2);
      b.stroke();
    }
  };
  const left = { x: -S * 0.07, y: -S * 0.34 };
  const right = p.hand ? { x: p.hand.x * S, y: p.hand.y * S } : { x: S * 0.07, y: -S * 0.34 };
  arm(-1, -S * 0.24, -S * 0.48, left.x, left.y);
  arm(1, p.hand ? S * 0.3 : S * 0.24, p.hand ? -S * 0.55 : -S * 0.48, right.x, right.y);
  darkHand(b, left.x, left.y, 0.3, S, 0.6);
  darkHand(b, right.x, right.y, p.hand ? -0.6 : Math.PI - 0.3, S, p.hand ? 0.1 : 0.6);
  // the chain swinging between her hands (or hanging from the left when she points)
  const chainEnd = p.hand ? { x: left.x + S * 0.02, y: left.y + S * 0.15 } : right;
  const sag = S * (0.05 + 0.015 * Math.sin(t * 1.4));
  for (let k = 0; k <= 14; k++) {
    const u = k / 14;
    const cx = left.x + (chainEnd.x - left.x) * u + S * 0.03;
    const cy = left.y + (chainEnd.y - left.y) * u + Math.sin(u * Math.PI) * sag + S * 0.01;
    b.strokeStyle = k % 2 ? BRONZE : '#6f6248';
    b.lineWidth = Math.max(0.8, S * 0.003);
    b.beginPath();
    b.ellipse(cx, cy, S * 0.006, S * 0.004, u * 2, 0, Math.PI * 2);
    b.stroke();
  }
  // a light at her raised fingertip
  if (p.hand) {
    const tx = right.x + Math.cos(-0.6) * S * 0.09;
    const ty = right.y + Math.sin(-0.6) * S * 0.09;
    const lg = b.createRadialGradient(tx, ty, 0, tx, ty, S * 0.06);
    lg.addColorStop(0, 'rgba(170, 250, 255, 0.95)');
    lg.addColorStop(1, 'rgba(70, 232, 255, 0)');
    b.fillStyle = lg;
    b.fillRect(tx - S * 0.06, ty - S * 0.06, S * 0.12, S * 0.12);
  }
  // the neck and a choker of beads
  b.fillStyle = SKIN;
  b.fillRect(-S * 0.03 + turn * 0.5, -S * 0.78, S * 0.06, S * 0.07);
  for (let k = 0; k < 3; k++) {
    b.strokeStyle = k === 1 ? VERDIGRIS : BRONZE;
    b.lineWidth = Math.max(1, S * 0.006);
    b.beginPath();
    b.ellipse(turn * 0.5, -S * (0.72 - k * 0.012), S * (0.045 + k * 0.012), S * 0.012, 0, 0, Math.PI);
    b.stroke();
  }
  // the face: a narrow ash-grey oval, a little gaunt
  const fx = turn;
  const fy = -S * 0.86;
  const face = new Path2D();
  face.moveTo(fx, fy - S * 0.1);
  face.bezierCurveTo(fx + S * 0.07, fy - S * 0.1, fx + S * 0.075, fy - S * 0.02, fx + S * 0.065, fy + S * 0.04);
  face.bezierCurveTo(fx + S * 0.05, fy + S * 0.09, fx + S * 0.02, fy + S * 0.11, fx, fy + S * 0.11);
  face.bezierCurveTo(fx - S * 0.02, fy + S * 0.11, fx - S * 0.05, fy + S * 0.09, fx - S * 0.065, fy + S * 0.04);
  face.bezierCurveTo(fx - S * 0.075, fy - S * 0.02, fx - S * 0.07, fy - S * 0.1, fx, fy - S * 0.1);
  face.closePath();
  const fg = b.createRadialGradient(fx + S * 0.01, fy, S * 0.01, fx, fy, S * 0.12);
  fg.addColorStop(0, '#cfd1ca');
  fg.addColorStop(0.6, '#a2a49d');
  fg.addColorStop(1, '#5a5c57');
  b.fillStyle = fg;
  b.fill(face);
  b.save();
  b.clip(face);
  // the black smudge round her eyes, and the eyes, faintly lit
  for (const [side, col] of [
    [-1, CYAN],
    [1, AMBER],
  ] as const) {
    const ex = fx + side * S * 0.03 + p.look * S * 0.006;
    const ey = fy - S * 0.005;
    const sm = b.createRadialGradient(ex, ey, 0, ex, ey, S * 0.04);
    sm.addColorStop(0, 'rgba(10, 10, 12, 0.95)');
    sm.addColorStop(0.6, 'rgba(10, 10, 12, 0.6)');
    sm.addColorStop(1, 'rgba(10, 10, 12, 0)');
    b.fillStyle = sm;
    b.fillRect(ex - S * 0.05, ey - S * 0.05, S * 0.1, S * 0.1);
    const open = (0.35 + 0.65 * p.eyes) * (t % 5.1 < 0.12 ? 0.1 : 1);
    b.fillStyle = '#d9dcd6';
    b.beginPath();
    b.ellipse(ex, ey, S * 0.014, S * 0.007 * open, side * -0.12, 0, Math.PI * 2);
    b.fill();
    b.save();
    b.shadowColor = col;
    b.shadowBlur = S * 0.03 * dpr;
    b.fillStyle = col;
    b.beginPath();
    b.arc(ex + p.look * S * 0.003, ey, S * 0.0045 * Math.max(0.3, open), 0, Math.PI * 2);
    b.fill();
    b.restore();
  }
  // small dark sigils on her brow and cheek
  b.strokeStyle = 'rgba(25, 25, 28, 0.7)';
  b.lineWidth = Math.max(0.8, S * 0.0025);
  b.beginPath();
  b.moveTo(fx - S * 0.012, fy - S * 0.065);
  b.lineTo(fx + S * 0.012, fy - S * 0.065);
  b.moveTo(fx, fy - S * 0.075);
  b.lineTo(fx, fy - S * 0.055);
  b.moveTo(fx + S * 0.035, fy + S * 0.035);
  b.lineTo(fx + S * 0.05, fy + S * 0.03);
  b.lineTo(fx + S * 0.045, fy + S * 0.05);
  b.stroke();
  // the nose's shadow and dark lips, parting a little as she speaks
  b.strokeStyle = 'rgba(60, 60, 58, 0.55)';
  b.lineWidth = Math.max(1, S * 0.004);
  b.beginPath();
  b.moveTo(fx + S * 0.004, fy + S * 0.005);
  b.lineTo(fx + S * 0.008, fy + S * 0.04);
  b.stroke();
  b.fillStyle = '#3b3436';
  b.beginPath();
  b.ellipse(fx, fy + S * 0.068, S * 0.02, S * (0.005 + 0.007 * p.talk), 0, 0, Math.PI * 2);
  b.fill();
  b.restore();
  // locks falling in front of her shoulders and across her face's edges
  for (let i = 0; i < 12; i++) {
    const side = i < 6 ? -1 : 1;
    const k = i % 6;
    const x0 = fx + side * S * (0.05 + k * 0.012);
    const y0 = fy - S * 0.08;
    const len = S * (0.45 + 0.25 * rand(i + 60));
    const w = S * (0.012 + 0.005 * rand(i + 70));
    strand(b, x0, y0, x0 + side * S * (0.06 + k * 0.025) + Math.sin(t * 0.6 + i) * S * 0.012, y0 + len, side * S * 0.05, w, w * 0.55, k % 2 ? HAIR : '#1a191e');
  }
  // the top knot, and the crescent moon rising from it: tarnished bronze, green at the edges
  b.fillStyle = HAIR;
  b.beginPath();
  b.ellipse(fx, fy - S * 0.105, S * 0.04, S * 0.03, 0, 0, Math.PI * 2);
  b.fill();
  const cr = new Path2D();
  cr.arc(fx, fy - S * 0.165, S * 0.055, 0.15 * Math.PI, 0.85 * Math.PI, true);
  cr.arc(fx, fy - S * 0.185, S * 0.04, 0.88 * Math.PI, 0.12 * Math.PI, false);
  cr.closePath();
  const cg = b.createLinearGradient(fx - S * 0.05, 0, fx + S * 0.05, 0);
  cg.addColorStop(0, VERDIGRIS);
  cg.addColorStop(0.5, '#cdb98b');
  cg.addColorStop(1, '#7c6a48');
  b.fillStyle = cg;
  b.fill(cr);
  b.strokeStyle = 'rgba(30, 26, 20, 0.7)';
  b.lineWidth = Math.max(1, S * 0.003);
  b.stroke(cr);
  b.restore();
  // composite: she comes together from slices, and fades in
  g.save();
  g.globalAlpha = Math.min(1, p.form * 1.2);
  sliced(g, kiroBuf, x - bw / 2, y - bh, bw, bh, Math.max(1 - p.form, p.glitch), t, true);
  g.restore();
}

export interface DeathPose {
  t: number;
  /** 0..1 how present he is. */
  form: number;
  /** 0..1 the bony hand rising to point at the viewer. */
  point: number;
  /** 0..1 how much of him breaks into ink and fragments. */
  fragment: number;
  /** 0..1 the embers in his sockets. */
  eyes: number;
}

const BONE = '#ddd5bd';
const INK = '#07060a';

/** Death, the reaper, standing with his base at (x, y), `s` pixels tall to the hood's peak. */
export function drawDeath(g: G, x: number, y: number, s: number, p: DeathPose, screenDpr: number): void {
  if (p.form <= 0.01) return;
  const dpr = screenDpr * 0.75;
  if (!deathBuf) deathBuf = new Buffer();
  const bw = s * 1.2;
  const bh = s * 1.15;
  const b = deathBuf.size(bw, bh, dpr);
  b.save();
  b.translate(bw / 2, bh);
  const S = s;
  const t = p.t;
  b.lineCap = 'round';
  // the scythe: a long dark staff, its blade arcing over his head
  b.strokeStyle = '#1c1612';
  b.lineWidth = S * 0.022;
  b.beginPath();
  b.moveTo(-S * 0.34, -S * 0.02);
  b.lineTo(-S * 0.22, -S * 1.02);
  b.stroke();
  b.strokeStyle = 'rgba(200, 190, 170, 0.25)';
  b.lineWidth = S * 0.005;
  b.beginPath();
  b.moveTo(-S * 0.335, -S * 0.04);
  b.lineTo(-S * 0.218, -S * 1.0);
  b.stroke();
  const blade = new Path2D();
  blade.moveTo(-S * 0.22, -S * 1.02);
  blade.quadraticCurveTo(S * 0.15, -S * 1.18, S * 0.48, -S * 0.82);
  blade.quadraticCurveTo(S * 0.14, -S * 1.06, -S * 0.2, -S * 0.96);
  blade.closePath();
  const bg = b.createLinearGradient(-S * 0.2, -S * 1.1, S * 0.48, -S * 0.82);
  bg.addColorStop(0, '#2a2622');
  bg.addColorStop(0.6, '#5e5a52');
  bg.addColorStop(1, '#c9c3b4');
  b.fillStyle = bg;
  b.fill(blade);
  b.strokeStyle = 'rgba(230, 225, 210, 0.6)';
  b.lineWidth = Math.max(1, S * 0.003);
  b.beginPath();
  b.moveTo(-S * 0.2, -S * 0.96);
  b.quadraticCurveTo(S * 0.14, -S * 1.06, S * 0.48, -S * 0.82);
  b.stroke();
  // the robe and hood: black, heavy, its folds caught in pale ink strokes
  const robe = new Path2D();
  robe.moveTo(0, -S * 0.97);
  robe.bezierCurveTo(S * 0.17, -S * 0.96, S * 0.21, -S * 0.78, S * 0.22, -S * 0.66);
  robe.bezierCurveTo(S * 0.32, -S * 0.5, S * 0.36, -S * 0.25, S * 0.4, 0);
  robe.lineTo(-S * 0.38, 0);
  robe.bezierCurveTo(-S * 0.34, -S * 0.25, -S * 0.3, -S * 0.5, -S * 0.22, -S * 0.66);
  robe.bezierCurveTo(-S * 0.21, -S * 0.78, -S * 0.17, -S * 0.96, 0, -S * 0.97);
  robe.closePath();
  b.fillStyle = INK;
  b.fill(robe);
  b.save();
  b.clip(robe);
  b.strokeStyle = 'rgba(210, 200, 180, 0.22)';
  b.lineWidth = Math.max(1, S * 0.003);
  for (let k = 0; k < 14; k++) {
    const x0 = -S * 0.25 + (k / 13) * S * 0.5;
    b.beginPath();
    b.moveTo(x0 * 0.4, -S * (0.62 + 0.05 * rand(k)));
    b.quadraticCurveTo(x0 + Math.sin(t * 0.5 + k) * S * 0.01, -S * 0.35, x0 * 1.3, -S * (0.02 + 0.1 * rand(k + 3)));
    b.stroke();
  }
  b.strokeStyle = 'rgba(210, 200, 180, 0.3)';
  for (const side of [-1, 1]) {
    b.beginPath();
    b.moveTo(side * S * 0.11, -S * 0.9);
    b.quadraticCurveTo(side * S * 0.16, -S * 0.75, side * S * 0.13, -S * 0.6);
    b.stroke();
  }
  b.restore();
  // ink splatter breaking off the robe's edges, more as he fragments
  for (let k = 0; k < 40 + Math.floor(50 * p.fragment); k++) {
    const side = rand(k) < 0.5 ? -1 : 1;
    const yy = -S * (0.05 + rand(k + 7) * 0.85);
    const edge = S * (0.2 + 0.2 * (1 + yy / S)) * side;
    const dx = edge + side * S * (0.02 + rand(k + 11) * (0.12 + 0.15 * p.fragment));
    const r = S * (0.002 + rand(k + 13) * 0.012);
    b.fillStyle = INK;
    b.beginPath();
    b.ellipse(dx, yy, r, r * (0.6 + rand(k) * 0.8), rand(k + 2) * 3, 0, Math.PI * 2);
    b.fill();
  }
  // the dark inside the hood, and the skull in it
  b.fillStyle = '#000';
  b.beginPath();
  b.ellipse(0, -S * 0.8, S * 0.11, S * 0.13, 0, 0, Math.PI * 2);
  b.fill();
  const skull = new Path2D();
  skull.moveTo(0, -S * 0.9);
  skull.bezierCurveTo(S * 0.075, -S * 0.9, S * 0.085, -S * 0.82, S * 0.072, -S * 0.77);
  skull.bezierCurveTo(S * 0.065, -S * 0.73, S * 0.05, -S * 0.7, S * 0.045, -S * 0.67);
  skull.lineTo(-S * 0.045, -S * 0.67);
  skull.bezierCurveTo(-S * 0.05, -S * 0.7, -S * 0.065, -S * 0.73, -S * 0.072, -S * 0.77);
  skull.bezierCurveTo(-S * 0.085, -S * 0.82, -S * 0.075, -S * 0.9, 0, -S * 0.9);
  skull.closePath();
  const sg = b.createRadialGradient(0, -S * 0.83, S * 0.01, 0, -S * 0.8, S * 0.11);
  sg.addColorStop(0, '#efe8d2');
  sg.addColorStop(0.6, BONE);
  sg.addColorStop(1, '#6d6656');
  b.fillStyle = sg;
  b.fill(skull);
  b.save();
  b.clip(skull);
  // the hood's shadow over the brow
  const shade = b.createLinearGradient(0, -S * 0.92, 0, -S * 0.83);
  shade.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
  shade.addColorStop(1, 'rgba(0, 0, 0, 0)');
  b.fillStyle = shade;
  b.fillRect(-S * 0.1, -S * 0.92, S * 0.2, S * 0.1);
  // sockets, the nasal hole, the cheekbones' shadow
  for (const side of [-1, 1]) {
    b.fillStyle = '#050405';
    b.beginPath();
    b.ellipse(side * S * 0.03, -S * 0.81, S * 0.024, S * 0.02, side * 0.25, 0, Math.PI * 2);
    b.fill();
    b.fillStyle = 'rgba(40, 34, 26, 0.5)';
    b.beginPath();
    b.ellipse(side * S * 0.05, -S * 0.75, S * 0.018, S * 0.01, 0, 0, Math.PI * 2);
    b.fill();
  }
  b.fillStyle = '#050405';
  b.beginPath();
  b.moveTo(0, -S * 0.79);
  b.lineTo(S * 0.012, -S * 0.76);
  b.lineTo(-S * 0.012, -S * 0.76);
  b.closePath();
  b.fill();
  // bared teeth: two rows, cracked
  b.fillStyle = '#1a1612';
  b.fillRect(-S * 0.04, -S * 0.725, S * 0.08, S * 0.035);
  for (let k = 0; k < 8; k++) {
    for (const row of [0, 1]) {
      b.fillStyle = BONE;
      b.fillRect(-S * 0.038 + k * S * 0.0095, -S * (0.723 - row * 0.018), S * 0.008, S * 0.015);
    }
  }
  b.restore();
  // two embers deep in the sockets
  for (const side of [-1, 1]) {
    const ex = side * S * 0.03;
    const ey = -S * 0.81;
    b.save();
    b.shadowColor = side < 0 ? VIOLET : CRIMSON;
    b.shadowBlur = S * 0.04 * dpr * (0.4 + 0.6 * p.eyes);
    b.fillStyle = side < 0 ? VIOLET : CRIMSON;
    b.beginPath();
    b.arc(ex, ey, S * 0.006 * (0.6 + 0.6 * p.eyes), 0, Math.PI * 2);
    b.fill();
    b.restore();
  }
  // the sleeve and the bony hand rising to point at the viewer
  if (p.point > 0.01) {
    const k = p.point;
    const hand = { x: S * (0.24 - 0.16 * k), y: -S * (0.45 + 0.28 * k) };
    b.strokeStyle = INK;
    b.lineWidth = S * 0.07;
    b.beginPath();
    b.moveTo(S * 0.2, -S * 0.6);
    b.quadraticCurveTo(S * 0.32, -S * (0.5 + 0.1 * k), hand.x + S * 0.03, hand.y + S * 0.03);
    b.stroke();
    const sc = 1 + 0.7 * k;
    b.strokeStyle = BONE;
    b.lineWidth = S * 0.008 * sc;
    for (let f = 0; f < 4; f++) {
      const a = -2.2 + f * 0.3;
      const len = S * (f === 1 ? 0.11 : 0.05) * sc;
      const bend = f === 1 ? 0 : 1.1;
      b.beginPath();
      b.moveTo(hand.x, hand.y);
      b.quadraticCurveTo(hand.x + Math.cos(a) * len * 0.6, hand.y + Math.sin(a) * len * 0.6, hand.x + Math.cos(a + bend) * len, hand.y + Math.sin(a + bend) * len);
      b.stroke();
      b.fillStyle = BONE;
      b.beginPath();
      b.arc(hand.x + Math.cos(a) * len * 0.45, hand.y + Math.sin(a) * len * 0.45, S * 0.006 * sc, 0, Math.PI * 2);
      b.fill();
    }
  }
  b.restore();
  // composite: a faint double behind him, then him, breaking into fragments
  g.save();
  g.globalAlpha = Math.min(1, p.form) * 0.22;
  g.drawImage(deathBuf.canvas, x - bw / 2 - s * 0.04 * Math.sin(t * 0.7), y - bh + 2, bw, bh);
  g.globalAlpha = Math.min(1, p.form);
  sliced(g, deathBuf, x - bw / 2, y - bh, bw, bh, p.fragment * 0.6, t, true);
  g.fillStyle = 'rgba(180, 77, 255, 0.5)';
  for (let i = 0; i < Math.floor(30 * p.fragment); i++) {
    const life = (t * 0.3 + rand(i)) % 1;
    const fx = x + (rand(i + 5) - 0.5) * bw * 0.8 + life * s * 0.15;
    const fy = y - bh * (0.2 + 0.7 * rand(i + 8)) - life * s * 0.1;
    g.globalAlpha = (1 - life) * 0.6 * Math.min(1, p.form);
    g.fillRect(fx, fy, s * 0.008, s * 0.008);
  }
  g.restore();
}
