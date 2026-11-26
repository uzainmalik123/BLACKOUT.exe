// Kiro (UI-13, D-250): the white ghost of the Kiro logo, painted on a canvas each frame wherever she appears (the
// briefing film and its guide, the office prologue and the handshake, the play screen, the last chance, the report).
//
// Her outline is traced from the team's reference (the 148 px logo: a rounded body, two black oval eyes right of
// centre, a small flipper low on the left, two rounded lobes below) and smoothed, so at rest she is the logo. She is
// lit for the dark (white shading to lavender, a purple rim and glow, translucent lower edges) and moves from a few
// numbers per mood (an `Expression`): floating, swaying, a breathing squash, the lower edge flowing, blinking,
// looking around, a small mouth only while she speaks, her arms. The motion, the blink and the talk level are pure
// functions of time, so they are tested; reduced motion keeps the moods and drops the movement.

type G = CanvasRenderingContext2D;
type P = readonly [number, number];
export type RGB = readonly [number, number, number];

export type Mood = 'calm' | 'concern' | 'alarm' | 'happy' | 'oops' | 'sad' | 'shock';
export const MOODS: readonly Mood[] = ['calm', 'concern', 'alarm', 'happy', 'oops', 'sad', 'shock'];

/** The brand purple (the logo's ground). */
export const KIRO_PURPLE = '#9046ff';
const PURPLE: RGB = [144, 70, 255];

/** The logo's outline in its own pixels (148 px reference), clockwise from the top of the head. */
const TRACE: readonly P[] = [
  [77.5, 25.8], [84, 26.2], [90, 27.6], [95.5, 30], [99.5, 33], [102.5, 36], [105.5, 39.5], [107.5, 43], [109.5, 47.5],
  [111, 52], [112, 57.5], [112.8, 63], [113.2, 70], [113.2, 78], [112.6, 85], [111.4, 90.5], [109.6, 96], [107.6, 101.5],
  [104.8, 107], [101.5, 111.5], [98.8, 114.5], [95.5, 117.5], [92, 120], [88, 122.4], [84.8, 123.2], [81.8, 122.4],
  [79.3, 120.3], [77.6, 117.6], [76.2, 115.2], [74.6, 116.6], [71.8, 118.5], [67.8, 120.3], [62, 122.3], [58.5, 123.2],
  [55, 122.6], [51.2, 120.4], [48.8, 117.8], [47.4, 114], [47, 110], [47.3, 106], [48.3, 103.6], [46.4, 101.8],
  [43.4, 103.1], [39.6, 103.3], [36.6, 102], [34.8, 99.8], [34, 96], [34.4, 92], [35.8, 88.5], [37.5, 84.5], [39.4, 80],
  [40.6, 75], [41.6, 70], [42.4, 64], [43.2, 58], [44.4, 52.5], [46, 47.5], [48.2, 43], [50.6, 39.5], [53.5, 35.8],
  [57, 32.5], [61, 29.8], [66, 27.6], [71.5, 26.2],
];
const CX = 73.6;
const CY = 74.5;
const UNIT = 97.4;
const unit = ([x, y]: P): P => [(x - CX) / UNIT, (y - CY) / UNIT];

/** The logo's outline in body units: height 1, (0, 0) the centre of its bounding box, y down. */
export const OUTLINE: readonly P[] = TRACE.map(unit);
/** Her eyes as in the logo (body units): centres and radii. */
export const EYES = { left: unit([78, 59.5]), right: unit([95, 59.5]), rx: 4.6 / UNIT, ry: 7 / UNIT } as const;
/** Where her flipper (the logo's arm, her right hand) leaves the body, and where her other arm would. */
export const ARM_ROOT = { flipper: unit([37, 88]), other: unit([111, 72]) } as const;

// the flipper's points move with it: weighted by their distance from where it leaves the body
const FLIP_PIVOT = unit([46, 95]);
const FLIPPER: ReadonlyArray<{ i: number; w: number; tuck: P }> = (() => {
  const tip = unit([36.6, 102]);
  const reach = Math.hypot(tip[0] - FLIP_PIVOT[0], tip[1] - FLIP_PIVOT[1]);
  // tucked: pressed onto the line of the body's side, from (36, 88) to (48, 104)
  const a = unit([36, 88]);
  const b = unit([48, 104]);
  const out: Array<{ i: number; w: number; tuck: P }> = [];
  TRACE.forEach(([x, y], i) => {
    if (!(x < 47 && y > 89 && y < 104.5)) return;
    const p = OUTLINE[i]!;
    const w = Math.min(1, Math.hypot(p[0] - FLIP_PIVOT[0], p[1] - FLIP_PIVOT[1]) / reach);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    out.push({ i, w, tuck: [a[0] + dx * u + 0.012, a[1] + dy * u] });
  });
  return out;
})();

/** An SVG path of the logo's outline in its own pixels (viewBox "30 22 88 106"), for icons. */
export const LOGO_PATH = smoothPath(TRACE);

/** A closed curve through every point (Catmull-Rom as cubic Béziers), as SVG path data. */
export function smoothPath(pts: readonly P[]): string {
  const n = pts.length;
  const f = (v: number) => v.toFixed(2);
  let d = `M${f(pts[0]![0])} ${f(pts[0]![1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const p3 = pts[(i + 2) % n]!;
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}

function tracePath(g: G, pts: readonly P[]): void {
  const n = pts.length;
  g.beginPath();
  g.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % n]!;
    const p3 = pts[(i + 2) % n]!;
    g.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
  }
  g.closePath();
}

// ------------------------------------------------------------------ moods

/** How a mood shows: her eyes, her glow and how she moves. Moods blend number by number. */
export interface Expression {
  /** Eye size against the logo's. */
  eyeW: number;
  eyeH: number;
  /** Eyes moved down (body units). */
  eyeY: number;
  /** Eyes leaning in at the top (worry, sadness). */
  tilt: number;
  /** 0..1 eyes closed into happy arcs. */
  arcs: number;
  /** 0..1 eyes squeezed shut (a wince). */
  squint: number;
  /** 0..1 pink under the eyes. */
  blush: number;
  /** 0..1 how strong her glow is, and its colour. */
  glow: number;
  hue: RGB;
  /** Float, its speed, and the sway. */
  bob: number;
  pace: number;
  sway: number;
  /** A quick tremble (urgency, fright) and a side-to-side shake (a wince). */
  jitter: number;
  shake: number;
  /** 0..1 sinking and hunching. */
  droop: number;
  /** 0..1 hopping. */
  bounce: number;
  /** 0..1 both arms up. */
  armsUp: number;
  /** The flipper's angle at rest (radians, up is positive). */
  flipper: number;
}

export const EXPRESSIONS: Readonly<Record<Mood, Expression>> = {
  calm: { eyeW: 1, eyeH: 1, eyeY: 0, tilt: 0, arcs: 0, squint: 0, blush: 0, glow: 0.55, hue: PURPLE, bob: 1, pace: 1, sway: 1, jitter: 0, shake: 0, droop: 0, bounce: 0, armsUp: 0, flipper: 0 },
  concern: { eyeW: 0.96, eyeH: 0.92, eyeY: 0.008, tilt: 0.22, arcs: 0, squint: 0, blush: 0, glow: 0.45, hue: [168, 104, 255], bob: 0.7, pace: 1.2, sway: 0.8, jitter: 0, shake: 0, droop: 0.3, bounce: 0, armsUp: 0, flipper: -0.15 },
  alarm: { eyeW: 1.3, eyeH: 1.24, eyeY: -0.01, tilt: -0.04, arcs: 0, squint: 0, blush: 0, glow: 0.75, hue: [255, 64, 128], bob: 0.55, pace: 2.1, sway: 0.6, jitter: 1, shake: 0, droop: 0, bounce: 0, armsUp: 0.4, flipper: 0.35 },
  happy: { eyeW: 1, eyeH: 1, eyeY: 0, tilt: 0, arcs: 1, squint: 0, blush: 0.8, glow: 0.85, hue: [178, 122, 255], bob: 1.1, pace: 1.3, sway: 1, jitter: 0, shake: 0, droop: 0, bounce: 1, armsUp: 1, flipper: 0.55 },
  oops: { eyeW: 1, eyeH: 0.9, eyeY: 0.006, tilt: 0.15, arcs: 0, squint: 1, blush: 0, glow: 0.42, hue: [255, 168, 92], bob: 0.6, pace: 1.2, sway: 0.6, jitter: 0, shake: 1, droop: 0.25, bounce: 0, armsUp: 0, flipper: -0.25 },
  sad: { eyeW: 0.9, eyeH: 0.74, eyeY: 0.024, tilt: 0.36, arcs: 0, squint: 0, blush: 0, glow: 0.22, hue: [110, 92, 196], bob: 0.4, pace: 0.6, sway: 0.5, jitter: 0, shake: 0, droop: 1, bounce: 0, armsUp: 0, flipper: -0.45 },
  shock: { eyeW: 1.5, eyeH: 1.36, eyeY: -0.016, tilt: 0, arcs: 0, squint: 0, blush: 0, glow: 0.8, hue: [255, 44, 84], bob: 0.3, pace: 1, sway: 0.3, jitter: 1.4, shake: 0, droop: 0, bounce: 0, armsUp: 1, flipper: 0.95 },
};

const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

/** `a` moved toward `b` by `k` (0..1), number by number. */
export function blendExpression(a: Expression, b: Expression, k: number): Expression {
  if (k >= 1) return b;
  if (k <= 0) return a;
  const out = {} as Record<keyof Expression, unknown>;
  for (const key of Object.keys(b) as Array<keyof Expression>) {
    const x = a[key];
    const y = b[key];
    out[key] = Array.isArray(x) && Array.isArray(y) ? ([mix(x[0], y[0], k), mix(x[1], y[1], k), mix(x[2], y[2], k)] as const) : mix(x as number, y as number, k);
  }
  return out as unknown as Expression;
}

// ------------------------------------------------------------------ motion

const rand = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** How open her eyes are at `t` (1 open, 0 shut): a blink of 0.16 s somewhere in every 3.4 s, now and then twice. */
export function blinkAt(t: number): number {
  const win = Math.floor(t / 3.4);
  const at = win * 3.4 + 0.2 + rand(win) * 2.8;
  const one = (x: number) => (x >= 0 && x < 0.16 ? Math.abs(x - 0.08) / 0.08 : 1);
  return Math.min(one(t - at), rand(win + 77) < 0.2 ? one(t - at - 0.3) : 1);
}

/** Where her eyes wander when nothing holds them (-1..1): a new glance every 2.7 s, eased, sometimes straight ahead. */
export function wanderAt(t: number): { x: number; y: number } {
  const seg = Math.floor(t / 2.7);
  const target = (k: number) => (rand(k * 3.1) < 0.35 ? { x: 0, y: 0 } : { x: (rand(k) - 0.5) * 1.4, y: (rand(k + 9) - 0.5) * 0.8 });
  const a = target(seg - 1);
  const b = target(seg);
  const u = clamp((t - seg * 2.7) / 0.35);
  const e = u * u * (3 - 2 * u);
  return { x: mix(a.x, b.x, e), y: mix(a.y, b.y, e) };
}

export interface Motion {
  /** Offset of her centre and her turn (body units, radians). */
  dx: number;
  dy: number;
  rot: number;
  /** Squash and stretch. */
  sx: number;
  sy: number;
  /** 0..1 eyes open. */
  blink: number;
  /** Where she looks (-1..1). */
  lookX: number;
  lookY: number;
  /** The lower edge's wave (body units) and the arms' wiggle (radians). */
  flow: number;
  wiggle: number;
}

/** Her movement at `t` for an expression: all of it zero under reduced motion, except blinking and her gaze. */
export function motionAt(t: number, e: Expression, o: { reduce?: boolean; look?: number; lookUp?: number; wander?: number } = {}): Motion {
  const reduce = !!o.reduce;
  const look = o.look ?? 0;
  const wander = reduce ? 0 : (o.wander ?? 1) * (1 - Math.min(1, Math.abs(look)));
  const w = wanderAt(t);
  const lookX = clamp(look + wander * w.x, -1, 1);
  const lookY = clamp((o.lookUp ?? 0) + wander * w.y * 0.6, -1, 1);
  const blink = e.arcs > 0.9 || e.squint > 0.9 ? 1 : blinkAt(t);
  if (reduce) return { dx: 0, dy: e.droop * 0.04, rot: lookX * 0.03, sx: 1, sy: 1 - e.droop * 0.03, blink, lookX, lookY, flow: 0, wiggle: 0 };
  const ph = t * e.pace;
  const bob = Math.sin(ph * 1.6) * 0.03 * e.bob;
  const hop = -Math.abs(Math.sin(t * 5.2)) * 0.055 * e.bounce;
  const tremble = (Math.sin(t * 31) * 0.006 + Math.sin(t * 23.7 + 1) * 0.004) * e.jitter;
  const shake = Math.sin(t * 9) * 0.03 * e.shake;
  const breathe = Math.sin(ph * 1.6 + 0.8) * 0.018 + (e.bounce > 0 ? Math.sin(t * 10.4) * 0.025 * e.bounce : 0);
  const sy = 1 + breathe - e.droop * 0.04;
  return {
    dx: tremble + shake * 0.4,
    dy: bob + hop + e.droop * 0.05 + tremble * 0.6,
    rot: Math.sin(ph * 0.9) * 0.035 * e.sway + lookX * 0.05 + shake + e.droop * 0.06,
    sx: 1 / Math.sqrt(sy),
    sy,
    blink,
    lookX,
    lookY,
    flow: 1,
    wiggle: Math.sin(t * 7.5) * 0.18,
  };
}

/** Her glow's strength at `t`: a slow breath, under one cycle a second, so it never flashes. */
export function glowAt(t: number, e: Expression, reduce = false): number {
  return clamp(e.glow * (1 + (reduce ? 0 : 0.12 * Math.sin(t * 2 * Math.PI * 0.6))));
}

/** A line she is saying, on the caller's clock (seconds); `word` is when the voice last reached a word, or -1. */
export interface Speech {
  from: number;
  until: number;
  word: number;
}

/** How open her mouth is at `now` (0 shut): syllable-like while she speaks, a pulse on each word; held half open under reduced motion. */
export function talkLevel(s: Speech | null, now: number, reduce = false): number {
  if (!s || now < s.from || now > s.until) return 0;
  const env = clamp(Math.min((now - s.from) / 0.08, (s.until - now) / 0.12));
  if (reduce) return 0.45 * env;
  const syllables = Math.abs(Math.sin(now * 10.7)) * (0.55 + 0.45 * Math.abs(Math.sin(now * 3.1 + 0.7)));
  const word = s.word >= 0 && now >= s.word ? Math.exp(-(now - s.word) * 6) : 0;
  return clamp(Math.max(syllables * (s.word >= 0 ? 0.6 : 1), word) * env);
}

// ------------------------------------------------------------------ painting

export interface GhostPose {
  /** Seconds (drives the float, the blink, the glances). */
  t: number;
  /** 0..1 how much of her has come together (fades and rises in). */
  form?: number;
  mood?: Mood;
  /** Overrides `mood` (a blend in progress). */
  expr?: Expression;
  /** 0..1 how open her mouth is now (`talkLevel`). */
  talk?: number;
  /** Where she looks (-1..1), and how much her eyes wander on their own (0..1, default 1). */
  look?: number;
  lookUp?: number;
  wander?: number;
  /** Her flipper reaching to (x, y) in body units from her centre; 'out' when the handshake paints it. */
  arm?: { x: number; y: number } | 'out' | null;
  /** 0..1 waving her flipper. */
  wave?: number;
  /** 0..1 her other arm out to her side (our right), pointing at something. */
  point?: number;
  /** Extra lift (body units, up is negative), e.g. with each shake of the hands. */
  lift?: number;
  glitch?: number;
  /** Her eyes lit this colour (the handshake's moment, D-223). */
  eyeTint?: string;
  /** The scene's light on her far side, "r, g, b". */
  rim?: string;
  reduce?: boolean;
  /** Overall opacity (a reflection). */
  alpha?: number;
}

/** A canvas reused between frames: she is drawn into it, then onto the scene (in slices while she forms or glitches). */
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
let nextBuffer = 0;

/** The outline as she moves: the lower edge flowing, the flipper raised, lowered or tucked away. */
export function shapeAt(m: Pick<Motion, 'flow'>, t: number, pace: number, flipperAngle: number, tuck: number): P[] {
  const pts: P[] = OUTLINE.map(([x, y]) => {
    const wv = m.flow * clamp((y - 0.2) / 0.28);
    if (wv <= 0) return [x, y];
    return [x + Math.sin(t * 2.4 * pace - y * 9 + x * 3) * 0.02 * wv, y + Math.sin(t * 3 * pace + x * 7) * 0.012 * wv];
  });
  const c = Math.cos(flipperAngle);
  const s = Math.sin(flipperAngle);
  for (const f of FLIPPER) {
    const [x, y] = pts[f.i]!;
    // raise about the pivot, weighted toward the tip: a positive angle swings the tip (left of the pivot) up
    const rx = x - FLIP_PIVOT[0];
    const ry = y - FLIP_PIVOT[1];
    const ang = flipperAngle * f.w;
    const ca = f.w === 1 ? c : Math.cos(ang);
    const sa = f.w === 1 ? s : Math.sin(ang);
    const p: P = [FLIP_PIVOT[0] + rx * ca - ry * sa, FLIP_PIVOT[1] + rx * sa + ry * ca];
    pts[f.i] = tuck > 0 ? [mix(p[0], f.tuck[0], tuck), mix(p[1], f.tuck[1], tuck)] : p;
  }
  return pts;
}

/** A soft, tapered arm's outline from a to c (body units), rounded at both ends, bulging a little at the hand. */
function limbPath(b: G, a: P, c: P, w0: number, w1: number): void {
  const ang = Math.atan2(c[1] - a[1], c[0] - a[0]) + Math.PI / 2;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const mx = (a[0] + c[0]) / 2;
  const my = (a[1] + c[1]) / 2;
  const wm = (w0 + w1) / 2;
  b.beginPath();
  b.moveTo(a[0] + ca * w0, a[1] + sa * w0);
  b.quadraticCurveTo(mx + ca * wm * 0.92, my + sa * wm * 0.92, c[0] + ca * w1, c[1] + sa * w1);
  // each end rounds outward: through the tip's far side, then round the root's back
  b.arc(c[0], c[1], w1, ang, ang + Math.PI, true);
  b.quadraticCurveTo(mx - ca * wm * 0.92, my - sa * wm * 0.92, a[0] - ca * w0, a[1] - sa * w0);
  b.arc(a[0], a[1], w0, ang + Math.PI, ang, true);
  b.closePath();
}

/** An arm behind her body: only its hand shows past her edge, shaded like her. */
function limb(b: G, a: P, c: P, w0: number, w1: number, fill: string | CanvasGradient): void {
  limbPath(b, a, c, w0, w1);
  b.fillStyle = fill;
  b.fill();
}

/**
 * Her hand reaching toward the viewer, seen from in front: a short arm and a soft round hand at `c` (body units), lit
 * from the upper left, lavender where it turns away, with its shadow on her body.
 */
function frontLimb(b: G, a: P, c: P, w0: number, r: number): void {
  b.save();
  b.fillStyle = 'rgba(96, 60, 170, 0.24)';
  b.beginPath();
  b.ellipse(c[0] + 0.018, c[1] + 0.045, r * 1.05, r * 0.82, 0, 0, Math.PI * 2);
  b.fill();
  const ang = Math.atan2(c[1] - a[1], c[0] - a[0]);
  const nx = -Math.sin(ang);
  const ny = Math.cos(ang);
  const across = b.createLinearGradient(c[0] - nx * r, c[1] - ny * r, c[0] + nx * r, c[1] + ny * r);
  across.addColorStop(0, '#fdfbff');
  across.addColorStop(0.6, '#ebe4fa');
  across.addColorStop(1, '#b8a5ea');
  limbPath(b, a, c, w0, r * 0.8);
  b.fillStyle = across;
  b.fill();
  const hand = b.createRadialGradient(c[0] - r * 0.35, c[1] - r * 0.4, r * 0.05, c[0], c[1], r);
  hand.addColorStop(0, '#ffffff');
  hand.addColorStop(0.6, '#f3eefc');
  hand.addColorStop(1, '#b9a7ea');
  b.fillStyle = hand;
  b.beginPath();
  b.ellipse(c[0], c[1], r, r * 0.92, 0, 0, Math.PI * 2);
  b.fill();
  b.strokeStyle = 'rgba(130, 96, 210, 0.35)';
  b.lineWidth = 0.006;
  b.stroke();
  b.restore();
}

/**
 * Kiro with the centre of her body at (cx, cy), `s` pixels tall. Her glow is painted round her on `g`; her body is
 * drawn into a buffer first so it can come together in slices.
 */
export function drawGhost(g: G, cx: number, cy: number, s: number, p: GhostPose, dpr: number): void {
  const form = clamp(p.form ?? 1);
  if (form <= 0.01 || s < 3) return;
  const reduce = !!p.reduce;
  const e = p.expr ?? EXPRESSIONS[p.mood ?? 'calm'];
  const m = motionAt(p.t, e, { reduce, look: p.look, lookUp: p.lookUp, wander: p.wander });
  const S = s * (0.88 + 0.12 * form);
  const x = cx + m.dx * S;
  const y = cy + (m.dy + (p.lift ?? 0) + (1 - form) * 0.1) * S;
  const alpha = (p.alpha ?? 1) * clamp(form * 1.25);

  // her glow, round her on the scene
  const glow = glowAt(p.t, e, reduce) * alpha;
  if (glow > 0.01) {
    const [r, gg, b] = e.hue.map((v) => Math.round(v));
    const outer = g.createRadialGradient(x, y, S * 0.1, x, y, S * 1.15);
    outer.addColorStop(0, `rgba(${r}, ${gg}, ${b}, ${(0.32 * glow).toFixed(3)})`);
    outer.addColorStop(0.45, `rgba(${r}, ${gg}, ${b}, ${(0.12 * glow).toFixed(3)})`);
    outer.addColorStop(1, `rgba(${r}, ${gg}, ${b}, 0)`);
    g.fillStyle = outer;
    g.fillRect(x - S * 1.15, y - S * 1.15, S * 2.3, S * 2.3);
  }

  // her body, into a buffer
  const bw = S * 2.3;
  const bh = S * 2;
  const i = nextBuffer++ % 4;
  const buf = (buffers[i] ??= new Buffer());
  const bd = Math.min(2, dpr);
  const b = buf.size(bw, bh, bd);
  b.save();
  b.translate(bw / 2, bh / 2);
  b.rotate(m.rot);
  b.scale(S * m.sx, S * m.sy);
  b.lineJoin = 'round';
  b.lineCap = 'round';

  const fill = b.createRadialGradient(-0.14, -0.3, 0.02, -0.06, -0.12, 0.95);
  fill.addColorStop(0, '#ffffff');
  fill.addColorStop(0.42, '#fbf9ff');
  fill.addColorStop(0.72, '#e8e1f8');
  fill.addColorStop(0.92, '#cbbcef');
  fill.addColorStop(1, '#b29ee6');

  // the flipper: a wave, a reach, or her rest angle; tucked into the body while a separate arm is drawn
  const reach = p.arm && p.arm !== 'out' ? p.arm : null;
  const waving = reduce ? 0 : (p.wave ?? 0);
  const armsUp = e.armsUp;
  const wig = m.wiggle * (armsUp > 0.5 ? 1 : 0.3);
  const restAngle = e.flipper + wig * 0.4 + (reduce ? 0 : Math.sin(p.t * 1.6 * e.pace + 1.2) * 0.06);
  const lifted = reach || waving > 0.02 || armsUp > 0.3;
  const tuck = p.arm === 'out' ? 1 : lifted ? 1 : 0;
  const pts = shapeAt(m, p.t, e.pace, tuck > 0 ? 0 : restAngle, tuck);

  // arms point along a direction from their root (y down): up and out from her sides
  const along = (root: P, a: number, len: number): P => [root[0] + Math.cos(a) * len, root[1] + Math.sin(a) * len];
  // her other arm, behind her: up with both arms, or out to her side pointing at something
  const pointing = clamp(p.point ?? 0);
  if (armsUp > 0.05 || pointing > 0.05) {
    const root = ARM_ROOT.other;
    const point = pointing > armsUp;
    const a = point ? -0.1 + wig * 0.2 : -0.15 - 0.6 * armsUp - wig;
    limb(b, [root[0] - 0.08, root[1]], along(root, a, point ? 0.1 + 0.14 * pointing : 0.13 + 0.06 * armsUp), 0.095, 0.075, fill);
  }
  // the flipper as an arm: out to the side behind her (a wave, a cheer, held out to shake), or toward the viewer
  let front: (() => void) | null = null;
  if (lifted && p.arm !== 'out') {
    const root = ARM_ROOT.flipper;
    if (reach && reach.x > root[0] + 0.1) front = () => frontLimb(b, [root[0] + 0.05, root[1] - 0.02], [reach.x, reach.y], 0.08, 0.115);
    else if (reach) limb(b, [root[0] + 0.08, root[1]], [reach.x, reach.y], 0.095, 0.088, fill);
    else {
      const a = waving > 0.02 ? Math.PI + 0.95 + Math.sin(p.t * 9) * 0.35 * waving : Math.PI + 0.15 + 0.6 * armsUp + wig;
      limb(b, [root[0] + 0.08, root[1]], along(root, a, waving > 0.02 ? 0.2 : 0.13 + 0.06 * armsUp), 0.095, 0.075, fill);
    }
  }

  // the body
  tracePath(b, pts);
  b.fillStyle = fill;
  b.fill();
  b.save();
  tracePath(b, pts);
  b.clip();
  // the purple light from below, and the room's light and her own on the rim
  const under = b.createLinearGradient(0, 0.02, 0, 0.52);
  under.addColorStop(0, 'rgba(144, 70, 255, 0)');
  under.addColorStop(1, 'rgba(144, 70, 255, 0.24)');
  b.fillStyle = under;
  b.fillRect(-0.6, -0.6, 1.2, 1.2);
  const rim = b.createLinearGradient(-0.45, 0, 0.4, 0);
  rim.addColorStop(0, `rgba(${p.rim ?? '150, 196, 255'}, 0.55)`);
  rim.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
  rim.addColorStop(1, 'rgba(144, 70, 255, 0.6)');
  b.strokeStyle = rim;
  b.lineWidth = 0.075;
  tracePath(b, pts);
  b.stroke();
  // a soft highlight on the crown
  const hl = b.createRadialGradient(-0.12, -0.36, 0, -0.12, -0.36, 0.17);
  hl.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  hl.addColorStop(1, 'rgba(255, 255, 255, 0)');
  b.fillStyle = hl;
  b.fillRect(-0.3, -0.55, 0.36, 0.36);
  // her face
  face(b, e, m, p);
  // the lower edges fade, as a ghost's do
  b.globalCompositeOperation = 'destination-out';
  const fade = b.createLinearGradient(0, 0.3, 0, 0.52);
  fade.addColorStop(0, 'rgba(0, 0, 0, 0)');
  fade.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
  b.fillStyle = fade;
  b.fillRect(-0.6, 0.3, 1.2, 0.3);
  b.restore();
  front?.();
  b.restore();

  // onto the scene: in slices while she forms or glitches
  const amount = reduce ? 0 : Math.max(1 - form, p.glitch ?? 0);
  g.save();
  g.globalAlpha *= alpha;
  const ox = x - bw / 2;
  const oy = y - bh / 2;
  if (amount <= 0.01) g.drawImage(buf.canvas, ox, oy, bw, bh);
  else {
    const bands = 22;
    const step = Math.floor(p.t * 12);
    const sw = buf.canvas.width;
    const sh = buf.canvas.height;
    for (let k = 0; k < bands; k++) {
      const r = rand(k * 13.7 + step * 3.1);
      const shift = r < 0.4 * amount ? (rand(k + step) - 0.5) * bw * 0.16 * amount : 0;
      g.drawImage(buf.canvas, 0, (k / bands) * sh, sw, sh / bands, ox + shift, oy + (k / bands) * bh, bw, bh / bands + 0.5);
    }
  }
  g.restore();
}

/** Her eyes, the blush and, while she speaks, her mouth (body units, clipped to her body). */
function face(b: G, e: Expression, m: Motion, p: GhostPose): void {
  const lx = m.lookX * 0.05;
  const ly = m.lookY * 0.03 + e.eyeY;
  const rx = EYES.rx * e.eyeW;
  const ry = EYES.ry * e.eyeH;
  const ink = '#0e0a16';
  if (e.blush > 0.02) {
    for (const [ex, ey] of [EYES.left, EYES.right]) {
      const bg = b.createRadialGradient(ex + lx, ey + ly + 0.075, 0, ex + lx, ey + ly + 0.075, 0.05);
      bg.addColorStop(0, `rgba(255, 120, 178, ${(0.42 * e.blush).toFixed(3)})`);
      bg.addColorStop(1, 'rgba(255, 120, 178, 0)');
      b.fillStyle = bg;
      b.fillRect(ex + lx - 0.06, ey + ly + 0.02, 0.12, 0.11);
    }
  }
  const oval = (1 - e.arcs) * (1 - e.squint);
  [EYES.left, EYES.right].forEach(([ex0, ey0], side) => {
    const ex = ex0 + lx;
    const ey = ey0 + ly;
    const lean = (side === 0 ? 1 : -1) * e.tilt;
    if (oval > 0.02) {
      b.save();
      b.globalAlpha = oval;
      b.translate(ex, ey);
      b.rotate(lean);
      b.fillStyle = p.eyeTint ?? ink;
      b.beginPath();
      b.ellipse(0, 0, rx, Math.max(0.004, ry * m.blink), 0, 0, Math.PI * 2);
      b.fill();
      if (p.eyeTint) {
        const tg = b.createRadialGradient(0, 0, 0, 0, 0, rx * 2.6);
        tg.addColorStop(0, 'rgba(255, 60, 80, 0.55)');
        tg.addColorStop(1, 'rgba(255, 60, 80, 0)');
        b.fillStyle = tg;
        b.fillRect(-rx * 2.6, -rx * 2.6, rx * 5.2, rx * 5.2);
      } else if (m.blink > 0.5) {
        b.fillStyle = 'rgba(255, 255, 255, 0.85)';
        b.beginPath();
        b.ellipse(rx * 0.32, -ry * 0.42, rx * 0.28, rx * 0.3, 0, 0, Math.PI * 2);
        b.fill();
      }
      b.restore();
    }
    b.strokeStyle = ink;
    b.lineWidth = rx * 0.8;
    if (e.arcs > 0.02) {
      // happy: closed in arcs, ^ ^
      b.globalAlpha = e.arcs;
      b.beginPath();
      b.moveTo(ex - rx * 1.15, ey + ry * 0.3);
      b.quadraticCurveTo(ex, ey - ry * 0.9, ex + rx * 1.15, ey + ry * 0.3);
      b.stroke();
      b.globalAlpha = 1;
    }
    if (e.squint > 0.02) {
      // a wince: > <
      const d = side === 0 ? 1 : -1;
      b.globalAlpha = e.squint;
      b.beginPath();
      b.moveTo(ex - d * rx, ey - ry * 0.55);
      b.lineTo(ex + d * rx * 0.9, ey);
      b.lineTo(ex - d * rx, ey + ry * 0.55);
      b.stroke();
      b.globalAlpha = 1;
    }
  });
  const talk = clamp(p.talk ?? 0);
  if (talk > 0.02) {
    const mx = (EYES.left[0] + EYES.right[0]) / 2 + lx * 0.85;
    const my = EYES.left[1] + 0.13 + ly;
    b.fillStyle = '#1c1026';
    b.beginPath();
    b.ellipse(mx, my, 0.03 + 0.008 * talk, 0.006 + 0.032 * talk, 0, 0, Math.PI * 2);
    b.fill();
    if (talk > 0.3) {
      b.fillStyle = 'rgba(214, 120, 170, 0.8)';
      b.beginPath();
      b.ellipse(mx, my + 0.02 * talk, 0.018, 0.009 * talk, 0, 0, Math.PI * 2);
      b.fill();
    }
  }
}

/**
 * Her flipper reaching toward the camera (the handshake, D-250): a soft tapered arm from `root` to `tip` in screen
 * pixels, `w0` and `w1` its half-widths there, ending in a rounded tip that gives (`squash` 0..1) in the player's grip.
 * Lit like her: white, lavender at the edges, purple underneath.
 */
export function drawGhostArm(g: G, root: { x: number; y: number }, tip: { x: number; y: number }, w0: number, w1: number, squash: number, alpha = 1): void {
  const ang = Math.atan2(tip.y - root.y, tip.x - root.x);
  const len = Math.hypot(tip.x - root.x, tip.y - root.y);
  g.save();
  g.globalAlpha *= alpha;
  g.translate(root.x, root.y);
  g.rotate(ang);
  const side = g.createLinearGradient(0, -w1 * 1.1, 0, w1 * 1.1);
  side.addColorStop(0, '#d9cff5');
  side.addColorStop(0.28, '#ffffff');
  side.addColorStop(0.62, '#efe9fb');
  side.addColorStop(0.9, '#b8a5ea');
  side.addColorStop(1, '#9d84e0');
  // the arm, one shape: narrow where it leaves her, wide where it nears the camera, its rounded tip giving a little
  // in the grip
  const hw = w1 * (1 - 0.25 * squash);
  const cap = w1 * (0.95 - 0.2 * squash);
  g.beginPath();
  g.moveTo(0, -w0);
  g.bezierCurveTo(len * 0.45, -w0 * 1.05, len * 0.7, -w1, len, -hw);
  g.ellipse(len, 0, cap, hw, 0, -Math.PI / 2, Math.PI / 2);
  g.bezierCurveTo(len * 0.7, w1, len * 0.45, w0 * 1.05, 0, w0);
  g.arc(0, 0, w0, Math.PI / 2, -Math.PI / 2);
  g.closePath();
  g.fillStyle = side;
  g.fill();
  g.clip();
  // purple light underneath, a highlight along the top
  const under = g.createLinearGradient(0, 0, 0, w1);
  under.addColorStop(0, 'rgba(144, 70, 255, 0)');
  under.addColorStop(1, 'rgba(144, 70, 255, 0.3)');
  g.fillStyle = under;
  g.fillRect(-w0, 0, len + w1 + w0, w1);
  g.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  g.lineWidth = Math.max(1, w1 * 0.12);
  g.beginPath();
  g.moveTo(len * 0.15, -w0 * 0.55);
  g.quadraticCurveTo(len * 0.6, -w1 * 0.7, len * 0.95, -w1 * 0.62);
  g.stroke();
  g.restore();
}
