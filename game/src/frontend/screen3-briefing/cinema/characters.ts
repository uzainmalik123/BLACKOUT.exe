// The cinematic's Death (D-189, D-221), painted on canvas each frame as an original illustration. Kiro is the Kiro
// logo's ghost and has her own painter (`frontend/shared/ghost.ts`, D-250).
//
// Death is the grim reaper, drawn in ink: a hooded black robe whose edges break into splatter and speckle, a skull
// in the hood's dark with deep sockets and bared teeth, two faint embers for eyes, a scythe whose long blade arcs
// over his head, and a bony hand that rises to point at the viewer.
//
// He is drawn into a reusable buffer first (at three-quarter resolution), so the fragmenting can slice the whole
// figure.

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
