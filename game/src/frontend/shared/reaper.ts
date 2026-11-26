// Death (D-253): the cute grim reaper of the team's reference, painted on a canvas each frame wherever he appears
// (the title, the briefing film, the office, the hauntings, the battlefield, the endings).
//
// Short and round: a big dark-brown hood and a bell of a robe, a large ivory skull with two oversized black eyes, a
// tiny nose, a small smile and three teeth, small bony hands, a wooden scythe with a pale curved blade. He stays cute;
// what he does is not: he holds unnaturally still, then his head snaps to a tilt; he leans in; as his menace grows the
// glints in his eyes go out and two tiny red points take their place. No particles, no floating symbols, no glow that
// hides his outline: a ground shadow, a cool rim of the room's light, a robe that moves a little. He comes apart by
// tearing from the hem up into the dark, and comes back the same way.
//
// Proportions are measured from the reference (700 px: the figure 550 px tall from the hood's top to the hem).

type G = CanvasRenderingContext2D;
type P = readonly [number, number];

export interface DeathPose {
  t: number;
  /** 0..1 how present he is: he rises out of the dark. */
  form: number;
  /** 0..1 his free hand raised toward the viewer. */
  point: number;
  /** 0..1 coming apart: torn into the dark from the hem up (a recoil, banishment). */
  fragment: number;
  /** 0..1 how much the points in his eyes burn (his menace when `menace` is not given). */
  eyes: number;
  /** -1..1 leaning (positive: to our right). */
  lean?: number;
  /** -1..1 where the points in his eyes look. */
  look?: number;
  /** 0..1 his threat: the glints go out, the points turn red, the hood's shadow deepens. */
  menace?: number;
  /** The room's light on his edge, "r, g, b". */
  rim?: string;
  reduce?: boolean;
}

const ROBE = '#504038';
const ROBE_LIGHT = '#63503f';
const ROBE_DARK = '#372c27';
const LINE = '#16110f';
const BONE = '#f8f0e6';
const BONE_SHADE = '#d8ceb6';
const WOOD = '#905830';
const WOOD_DARK = '#5e3a1f';
const BLADE = '#f1eadb';
const BLADE_SHADE = '#c9c0ac';
const EYE = '#0b0908';

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const rand = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** His head's tilt at `t` (radians): still for a while, then a quick snap to one side, held, and slowly back. */
export function tiltAt(t: number): number {
  const win = Math.floor(t / 3.7);
  const start = win * 3.7 + 0.4 + rand(win) * 1.6;
  const e = t - start;
  const amount = (rand(win + 31) < 0.5 ? -1 : 1) * (0.08 + 0.1 * rand(win + 7));
  if (rand(win + 13) < 0.3 || e < 0) return 0; // some windows he stays perfectly still
  if (e < 0.14) return amount * (e / 0.14);
  if (e < 1.4) return amount;
  if (e < 1.8) return amount * (1 - (e - 1.4) / 0.4);
  return 0;
}

/** His idle motion at `t`: a slow breath, the robe's hem moving a little, the head's tilt. Zero under reduced motion. */
export function idleAt(t: number, reduce = false): { breathe: number; hem: number; tilt: number } {
  if (reduce) return { breathe: 0, hem: 0, tilt: 0 };
  return { breathe: Math.sin(t * 1.4) * 0.008, hem: 1, tilt: tiltAt(t) };
}

/** What his eyes show at a menace (0..1): cute glints that go out, and red points that come in. */
export function eyesAt(menace: number): { glint: number; points: number; red: number } {
  const m = clamp(menace);
  return { glint: clamp(1 - m * 1.6), points: clamp((m - 0.25) / 0.5), red: clamp((m - 0.4) / 0.4) };
}

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
    } else {
      this.g.setTransform(1, 0, 0, 1, 0, 0);
      this.g.clearRect(0, 0, W, H);
    }
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return this.g;
  }
}
const buffers: Buffer[] = [];
let next = 0;

function path(b: G, pts: readonly P[]): void {
  b.beginPath();
  b.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i++) b.lineTo(pts[i]![0], pts[i]![1]);
  b.closePath();
}

/** A small bony hand at (x, y) (units), fingers toward `ang`; `open` spreads them (pointing). */
function hand(b: G, x: number, y: number, ang: number, size: number, open: number): void {
  b.save();
  b.translate(x, y);
  b.rotate(ang);
  b.fillStyle = BONE;
  b.strokeStyle = LINE;
  b.lineWidth = 0.006;
  b.beginPath();
  b.ellipse(0, 0, size * 0.55, size * 0.45, 0, 0, Math.PI * 2);
  b.fill();
  b.stroke();
  b.lineCap = 'round';
  for (let f = 0; f < 4; f++) {
    const spread = (f - 1.5) * (0.22 + 0.25 * open);
    const len = size * (f === 1 && open > 0.5 ? 1.15 : 0.75);
    b.strokeStyle = LINE;
    b.lineWidth = size * 0.3;
    b.beginPath();
    b.moveTo(size * 0.3, (f - 1.5) * size * 0.2);
    b.lineTo(size * 0.3 + Math.cos(spread) * len, (f - 1.5) * size * 0.2 + Math.sin(spread) * len);
    b.stroke();
    b.strokeStyle = BONE;
    b.lineWidth = size * 0.2;
    b.stroke();
  }
  b.restore();
}

/**
 * Death with the hem of his robe at (x, y), `s` pixels from the hem to the top of his hood (the scythe's blade
 * reaches a little above and to his right, our left).
 */
export function drawDeath(g: G, x: number, y: number, s: number, p: DeathPose, screenDpr: number): void {
  const form = clamp(p.form);
  if (form <= 0.01 || s < 4) return;
  const reduce = !!p.reduce;
  const idle = idleAt(p.t, reduce);
  const menace = clamp(p.menace ?? p.eyes);
  const fragment = clamp(p.fragment);
  const t = p.t;

  // the ground shadow, on the scene
  g.save();
  g.globalAlpha *= form * (1 - fragment * 0.8);
  const sh = g.createRadialGradient(x, y, 0, x, y, s * 0.36);
  sh.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
  sh.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = sh;
  g.save();
  g.translate(x, y);
  g.scale(1, 0.18);
  g.translate(-x, -y);
  g.fillRect(x - s * 0.36, y - s * 0.36, s * 0.72, s * 0.72);
  g.restore();
  g.restore();

  // the figure, into a buffer: origin at the hem's centre, units of his height, y up negative
  const bw = s * 1.4;
  const bh = s * 1.16;
  const buf = (buffers[next % 4] ??= new Buffer());
  next++;
  const b = buf.size(bw, bh, Math.min(2, screenDpr));
  b.save();
  b.translate(bw * 0.6, bh * 0.97);
  b.scale(s, s);
  b.rotate((p.lean ?? 0) * 0.1);
  b.scale(1, 1 + idle.breathe);
  b.lineJoin = 'round';
  b.lineCap = 'round';

  // ---- the scythe: the staff beside him, the pale blade curving out at its top
  const staffTop: P = [-0.285, -0.97];
  const staffFoot: P = [-0.335, -0.03];
  const wood = b.createLinearGradient(-0.33, 0, -0.27, 0);
  wood.addColorStop(0, '#a86a36');
  wood.addColorStop(0.5, WOOD);
  wood.addColorStop(1, WOOD_DARK);
  b.strokeStyle = LINE;
  b.lineWidth = 0.056;
  b.beginPath();
  b.moveTo(staffTop[0], staffTop[1]);
  b.lineTo(staffFoot[0], staffFoot[1]);
  b.stroke();
  b.strokeStyle = wood;
  b.lineWidth = 0.042;
  b.stroke();
  const blade = new Path2D();
  blade.moveTo(-0.27, -0.965);
  blade.bezierCurveTo(-0.36, -1.03, -0.52, -0.96, -0.545, -0.69);
  blade.bezierCurveTo(-0.47, -0.84, -0.38, -0.9, -0.29, -0.885);
  blade.closePath();
  const bg = b.createLinearGradient(-0.5, -1.0, -0.4, -0.8);
  bg.addColorStop(0, BLADE);
  bg.addColorStop(1, BLADE_SHADE);
  b.fillStyle = bg;
  b.fill(blade);
  b.strokeStyle = LINE;
  b.lineWidth = 0.008;
  b.stroke(blade);
  b.fillStyle = BLADE;
  b.fillRect(-0.302, -0.99, 0.034, 0.05);
  b.strokeRect(-0.302, -0.99, 0.034, 0.05);

  // ---- the robe: a bell from the shoulders to a hem that moves a little
  const hem: P[] = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    const hx = -0.27 + u * 0.56;
    const wave = idle.hem * Math.sin(t * 1.3 + u * 7) * 0.006 + Math.sin(u * Math.PI * 3) * 0.012;
    hem.push([hx, -0.02 + wave]);
  }
  const robe: P[] = [[-0.19, -0.5], [-0.22, -0.32], [-0.255, -0.12], ...hem, [0.255, -0.14], [0.225, -0.34], [0.21, -0.5]];
  path(b, robe);
  const rg = b.createLinearGradient(-0.25, -0.5, 0.28, -0.02);
  rg.addColorStop(0, ROBE_LIGHT);
  rg.addColorStop(0.55, ROBE);
  rg.addColorStop(1, ROBE_DARK);
  b.fillStyle = rg;
  b.fill();
  b.strokeStyle = LINE;
  b.lineWidth = 0.009;
  b.stroke();
  // folds
  b.strokeStyle = 'rgba(30, 22, 18, 0.55)';
  b.lineWidth = 0.006;
  for (const [fx, top] of [
    [-0.08, -0.4],
    [0.06, -0.36],
    [0.16, -0.3],
  ] as const) {
    b.beginPath();
    b.moveTo(fx, top);
    b.quadraticCurveTo(fx + 0.02, -0.2, fx - 0.01 + idle.hem * Math.sin(t * 1.3 + fx * 9) * 0.004, -0.05);
    b.stroke();
  }

  // ---- his hands: the left on the staff (our left), the right low at the robe, or raised to point at us
  b.fillStyle = ROBE;
  b.strokeStyle = LINE;
  b.lineWidth = 0.008;
  b.beginPath();
  b.moveTo(-0.17, -0.48);
  b.quadraticCurveTo(-0.27, -0.47, -0.29, -0.43);
  b.lineTo(-0.27, -0.38);
  b.quadraticCurveTo(-0.2, -0.38, -0.15, -0.4);
  b.closePath();
  b.fill();
  b.stroke();
  // his bony fingers closed round the staff, toward his body
  hand(b, -0.335, -0.418, 0.12, 0.05, 0);
  const point = clamp(p.point);
  if (point > 0.05) {
    const hx = 0.2 + 0.13 * point;
    const hy = -0.3 - 0.16 * point;
    b.fillStyle = ROBE;
    b.beginPath();
    b.moveTo(0.14, -0.44);
    b.quadraticCurveTo(hx - 0.02, hy - 0.04, hx, hy - 0.02);
    b.lineTo(hx + 0.005, hy + 0.04);
    b.quadraticCurveTo(0.17, -0.32, 0.12, -0.34);
    b.closePath();
    b.fill();
    b.stroke();
    hand(b, hx + 0.03, hy + 0.01, -0.35, 0.06, point);
  } else hand(b, 0.165, -0.2, 0.35, 0.05, 0);

  // ---- the head: the hood's dome, its dark opening, the skull; it tilts on its own
  b.save();
  b.translate(-0.02, -0.5);
  b.rotate(idle.tilt + (p.look ?? 0) * 0.04);
  b.translate(0.02, 0.5);
  const hood = new Path2D();
  hood.moveTo(-0.235, -0.48);
  hood.bezierCurveTo(-0.32, -0.66, -0.25, -0.98, -0.01, -1.0);
  hood.bezierCurveTo(0.2, -1.0, 0.3, -0.86, 0.275, -0.74);
  hood.quadraticCurveTo(0.27, -0.7, 0.255, -0.69);
  hood.bezierCurveTo(0.29, -0.6, 0.26, -0.52, 0.23, -0.47);
  hood.quadraticCurveTo(0, -0.43, -0.235, -0.48);
  hood.closePath();
  const hg = b.createRadialGradient(-0.12, -0.88, 0.02, -0.02, -0.74, 0.34);
  hg.addColorStop(0, ROBE_LIGHT);
  hg.addColorStop(0.6, ROBE);
  hg.addColorStop(1, ROBE_DARK);
  b.fillStyle = hg;
  b.fill(hood);
  b.strokeStyle = LINE;
  b.lineWidth = 0.01;
  b.stroke(hood);
  // the opening: deep shadow
  b.fillStyle = '#120d0b';
  b.beginPath();
  b.ellipse(-0.032, -0.7, 0.205, 0.198, 0, 0, Math.PI * 2);
  b.fill();
  // the skull: one outline, a round cranium whose lower edge is three rounded teeth (as in the reference)
  const skull = new Path2D();
  const sk = { x: -0.032, y: -0.72, rx: 0.185, ry: 0.165 };
  const a0 = (62 * Math.PI) / 180;
  const a1 = (118 * Math.PI) / 180;
  const jawY = sk.y + sk.ry * Math.sin(a0);
  const right = sk.x + sk.rx * Math.cos(a0);
  const left = sk.x + sk.rx * Math.cos(a1);
  skull.moveTo(left, jawY);
  skull.ellipse(sk.x, sk.y, sk.rx, sk.ry, 0, a1, a0 + Math.PI * 2);
  const tooth = (right - left) / 3;
  for (let k = 0; k < 3; k++) {
    const cx = right - tooth * (k + 0.5);
    skull.arc(cx, jawY, tooth / 2, 0, Math.PI, false);
  }
  skull.closePath();
  const sg = b.createRadialGradient(-0.09, -0.8, 0.02, -0.03, -0.7, 0.2);
  sg.addColorStop(0, '#fffcf4');
  sg.addColorStop(0.6, BONE);
  sg.addColorStop(1, BONE_SHADE);
  b.fillStyle = sg;
  b.fill(skull);
  // the lines between his teeth
  b.strokeStyle = 'rgba(22, 17, 15, 0.7)';
  b.lineWidth = 0.005;
  for (let k = 1; k < 3; k++) {
    const tx = right - tooth * k;
    b.beginPath();
    b.moveTo(tx, jawY - 0.012);
    b.lineTo(tx, jawY + tooth * 0.3);
    b.stroke();
  }
  // the hood's shadow over the top of his skull, deeper with menace
  b.save();
  b.clip(skull);
  const over = b.createLinearGradient(0, -0.9, 0, -0.74);
  over.addColorStop(0, `rgba(18, 13, 11, ${(0.55 + 0.3 * menace).toFixed(3)})`);
  over.addColorStop(1, 'rgba(18, 13, 11, 0)');
  b.fillStyle = over;
  b.fillRect(-0.25, -0.92, 0.45, 0.2);
  b.restore();
  b.strokeStyle = LINE;
  b.lineWidth = 0.008;
  b.stroke(skull);
  // the eyes: oversized and black; cute glints that go out with his menace, two red points that come in
  const eyes = eyesAt(menace);
  const look = (p.look ?? 0) * 0.014;
  for (const ex of [-0.135, 0.066]) {
    b.fillStyle = EYE;
    b.beginPath();
    b.ellipse(ex, -0.69, 0.058, 0.07, 0, 0, Math.PI * 2);
    b.fill();
    if (eyes.glint > 0.02) {
      b.fillStyle = `rgba(255, 255, 255, ${(0.9 * eyes.glint).toFixed(3)})`;
      b.beginPath();
      b.arc(ex - 0.02, -0.715, 0.013, 0, Math.PI * 2);
      b.fill();
    }
    if (eyes.points > 0.02) {
      const r = Math.round(255);
      const gch = Math.round(255 - 200 * eyes.red);
      b.fillStyle = `rgba(${r}, ${gch}, ${gch}, ${(eyes.points * (0.6 + 0.4 * clamp(p.eyes))).toFixed(3)})`;
      b.beginPath();
      b.arc(ex + look, -0.685, 0.008, 0, Math.PI * 2);
      b.fill();
    }
  }
  // the tiny nose and the small smile
  b.fillStyle = LINE;
  b.beginPath();
  b.moveTo(-0.046, -0.638);
  b.lineTo(-0.034, -0.622);
  b.lineTo(-0.022, -0.638);
  b.quadraticCurveTo(-0.034, -0.644, -0.046, -0.638);
  b.fill();
  b.strokeStyle = LINE;
  b.lineWidth = 0.006;
  b.beginPath();
  const smile = 0.016 + 0.01 * menace;
  b.moveTo(-0.034 - smile, -0.606);
  b.quadraticCurveTo(-0.034, -0.594 + 0.004 * menace, -0.034 + smile, -0.606);
  b.stroke();
  // the hood's rim, over the top of the opening
  b.strokeStyle = ROBE_DARK;
  b.lineWidth = 0.03;
  b.beginPath();
  b.ellipse(-0.032, -0.7, 0.21, 0.205, 0, Math.PI * 1.08, Math.PI * 1.92);
  b.stroke();
  b.restore();

  // the room's light on his far edge
  if (p.rim) {
    b.save();
    b.globalCompositeOperation = 'source-atop';
    const rim = b.createLinearGradient(0.1, 0, 0.3, 0);
    rim.addColorStop(0, `rgba(${p.rim}, 0)`);
    rim.addColorStop(1, `rgba(${p.rim}, 0.35)`);
    b.fillStyle = rim;
    b.fillRect(0.1, -1.05, 0.25, 1.1);
    b.restore();
  }
  // out of the dark: until he is fully here, darkness lies over him
  if (form < 1) {
    b.save();
    b.globalCompositeOperation = 'source-atop';
    b.fillStyle = `rgba(4, 3, 3, ${(0.9 * (1 - form)).toFixed(3)})`;
    b.fillRect(-0.7, -1.1, 1.4, 1.2);
    b.restore();
  }
  // coming apart: the dark eats him from the hem up
  if (fragment > 0.01) {
    b.save();
    b.globalCompositeOperation = 'destination-out';
    const edge = -fragment * 1.15;
    const eat = b.createLinearGradient(0, edge + 0.2, 0, edge - 0.05);
    eat.addColorStop(0, 'rgba(0, 0, 0, 1)');
    eat.addColorStop(1, 'rgba(0, 0, 0, 0)');
    b.fillStyle = eat;
    b.fillRect(-0.7, edge - 0.05, 1.4, 1.3);
    b.restore();
  }
  b.restore();

  // onto the scene: torn into horizontal bands while he comes apart (never under reduced motion)
  const ox = x - bw * 0.6;
  const oy = y - bh * 0.97;
  g.save();
  g.globalAlpha *= clamp(form * 1.4) * (1 - 0.5 * fragment);
  const tear = reduce ? 0 : fragment;
  if (tear <= 0.02) g.drawImage(buf.canvas, ox, oy, bw, bh);
  else {
    const bands = 18;
    const step = Math.floor(t * 8);
    const sw = buf.canvas.width;
    const shh = buf.canvas.height;
    for (let k = 0; k < bands; k++) {
      const shift = rand(k * 7.3 + step) < 0.5 * tear ? (rand(k + step * 3) - 0.5) * bw * 0.12 * tear : 0;
      g.drawImage(buf.canvas, 0, (k / bands) * shh, sw, shh / bands, ox + shift, oy + (k / bands) * bh, bw, bh / bands + 0.5);
    }
  }
  g.restore();
}
