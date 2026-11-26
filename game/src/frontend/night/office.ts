// The night-shift office (UI-10, D-223), painted 2.5D in code: flat painted cards and quads placed in a 3D room and
// seen through one pinhole camera, so walking, turning and sitting down all come from moving that camera. A ground-
// floor security office at 3 AM: floor-to-ceiling glass on the far wall, the rain outside, a wet street with cars and
// sodium lamps, the city's lit windows beyond, fluorescent tubes, desks and chairs, a server rack on the dark side of
// the room, a clock at three. Kiro is drawn by the briefing's own painter (characters.ts). Also the two close-ups that
// are not the room: Death's eyes in the dark, and the hands meeting in the handshake.
//
// Units are metres. X runs right, Y up, Z into the room (the windows are at Z = 12). The camera starts near Z = 0.

import { drawDeath, drawKiro, type KiroPose } from '../screen3-briefing/cinema/characters';

type G = CanvasRenderingContext2D;
type V3 = readonly [number, number, number];

export interface Cam {
  x: number;
  y: number;
  z: number;
  /** Radians, positive looks right. */
  yaw: number;
  /** Radians, positive looks up. */
  pitch: number;
}

export interface OfficeView {
  /** Seconds since the night began (drives the rain, the cars, the flicker). */
  t: number;
  cam: Cam;
  /** 0..1 how much of the room has faded in from the dark. */
  fade: number;
  /** 0..1 the fluorescent tubes (the stage-3 beat dims them). */
  lights: number;
  /** 0..1 the room turned crimson (stage 6). */
  crimson: number;
  /** 0..1 the cold of the harvest (stage 4): bluer, darker. */
  cold: number;
  /** 0..1 how hard it rains. */
  rain: number;
  /** 0..1 a lightning flash now. */
  flash: number;
  /** Where the bolt strikes, radians of azimuth. */
  bolt: number;
  /** 0..1 dawn coming up (a handover ending). */
  dawn: number;
  /** 0..1 the player's monitors powered. */
  monitors: number;
  /** 0..1 every monitor in the room red with the alarm. */
  alarm: number;
  /** The game clock on the wall, minutes past midnight. */
  clockMin: number;
  /** The DOM monitors cover the player's three: don't paint them. */
  hideDesk: boolean;
  kiro: { x: number; z: number; pose: KiroPose } | null;
  /** A tall shape crossing outside the glass, 0..1 along its way (stage 1), or null. */
  shadow: number | null;
  /** Death standing in the room (the endings), or null. */
  death: { x: number; z: number; form: number; fragment: number; point: number } | null;
}

// ------------------------------------------------------------------ the room's layout

const ROOM = { left: -6, right: 6, back: 12, front: -3, ceil: 3.2 };
const WIN = { left: -5.6, right: 5.6, bottom: 0.08, top: 2.85, mullion: 1.4 };
/** The player's workstation: a desk facing the windows, three monitors on it. */
export const DESK = { x: 1.6, z: 6.8, depth: 0.8, width: 2.3, height: 0.75 };
/** Where the chair waits, pulled out. */
export const CHAIR = { x: 1.6, z: 6.1 };

/** The camera's places: where the night starts, the walk to the desk, standing at the chair, seated. */
export const CAMS = {
  start: { x: -0.4, y: 1.66, z: 0.4, yaw: 0, pitch: 0 },
  chair: { x: 1.55, y: 1.66, z: 4.9, yaw: 0.02, pitch: -0.12 },
  seated: { x: 1.6, y: 1.24, z: 6.25, yaw: 0, pitch: -0.07 },
} as const satisfies Record<string, Cam>;

export const FOCAL = 0.95; // focal length in screen heights

// ------------------------------------------------------------------ projection

const NEAR = 0.06;

class Lens {
  readonly cy: number;
  readonly cx: number;
  readonly f: number;
  private readonly cs: number;
  private readonly sn: number;
  private readonly cp: number;
  private readonly sp: number;
  constructor(
    readonly c: Cam,
    w: number,
    h: number,
  ) {
    this.cx = w / 2;
    this.cy = h / 2;
    this.f = h * FOCAL;
    this.cs = Math.cos(c.yaw);
    this.sn = Math.sin(c.yaw);
    this.cp = Math.cos(c.pitch);
    this.sp = Math.sin(c.pitch);
  }
  /** World to camera space: x right, y up, z ahead. */
  cam(X: number, Y: number, Z: number): [number, number, number] {
    const dx = X - this.c.x;
    const dy = Y - this.c.y;
    const dz = Z - this.c.z;
    const x1 = dx * this.cs - dz * this.sn;
    const z1 = dx * this.sn + dz * this.cs;
    const y2 = dy * this.cp - z1 * this.sp;
    const z2 = dy * this.sp + z1 * this.cp;
    return [x1, y2, z2];
  }
  /** A world point on screen, with pixels per metre there; null behind the camera. */
  at(X: number, Y: number, Z: number): { x: number; y: number; k: number; d: number } | null {
    const [x, y, z] = this.cam(X, Y, Z);
    if (z < NEAR) return null;
    const k = this.f / z;
    return { x: this.cx + x * k, y: this.cy - y * k, k, d: z };
  }
  /** A polygon's path on screen, clipped at the near plane. False when nothing of it is in front. */
  path(g: G, pts: readonly V3[]): boolean {
    const cs = pts.map((p) => this.cam(p[0], p[1], p[2]));
    const out: Array<[number, number, number]> = [];
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i]!;
      const b = cs[(i + 1) % cs.length]!;
      const ain = a[2] >= NEAR;
      const bin = b[2] >= NEAR;
      if (ain) out.push(a);
      if (ain !== bin) {
        const u = (NEAR - a[2]) / (b[2] - a[2]);
        out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, NEAR]);
      }
    }
    if (out.length < 3) return false;
    g.beginPath();
    out.forEach(([x, y, z], i) => {
      const k = this.f / z;
      const sx = this.cx + x * k;
      const sy = this.cy - y * k;
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    });
    g.closePath();
    return true;
  }
  fill(g: G, pts: readonly V3[], style: string | CanvasGradient): void {
    if (!this.path(g, pts)) return;
    g.fillStyle = style;
    g.fill();
  }
  /** A gradient between two world points (or a flat colour if one is behind the camera). */
  grad(g: G, a: V3, b: V3, stops: ReadonlyArray<readonly [number, string]>): CanvasGradient | string {
    const p = this.at(a[0], a[1], a[2]);
    const q = this.at(b[0], b[1], b[2]);
    if (!p || !q) return stops[Math.floor(stops.length / 2)]![1];
    const gr = g.createLinearGradient(p.x, p.y, q.x, q.y);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    return gr;
  }
  /** Screen position of a direction at infinity (azimuth, elevation in radians). */
  sky(az: number, el: number): { x: number; y: number } {
    return { x: this.cx + this.f * Math.tan(az - this.c.yaw), y: this.cy - this.f * Math.tan(el - this.c.pitch) };
  }
}

/** A deterministic 0..1 for an index. */
const rand = (i: number): number => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v));
const mix = (a: number, b: number, u: number): number => a + (b - a) * u;

// ------------------------------------------------------------------ the city beyond the street (cached per size)

interface CityCache {
  key: string;
  img: HTMLCanvasElement;
  /** Pixels per radian, and the image's azimuth and elevation at its top-left. */
  ppr: number;
  az0: number;
  el0: number;
}
let city: CityCache | null = null;

const CITY_AZ = 1.25; // ± radians of city painted
const CITY_TOP = 0.62;
const CITY_BOTTOM = -0.08;

function cityImage(h: number, dpr: number): CityCache {
  const res = Math.min(1.25, dpr) * 0.8;
  const ppr = h * FOCAL * res;
  const key = `${Math.round(ppr)}`;
  if (city?.key === key) return city;
  const W = Math.ceil(CITY_AZ * 2 * ppr);
  const H = Math.ceil((CITY_TOP - CITY_BOTTOM) * ppr);
  const img = document.createElement('canvas');
  img.width = W;
  img.height = H;
  const c = img.getContext('2d')!;
  const yOf = (el: number) => (CITY_TOP - el) * ppr;
  // the sky: black-blue above, the city's sodium glow bleeding into the low cloud
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#070a14');
  sky.addColorStop(0.45, '#141c33');
  sky.addColorStop(0.75, '#3a2c44');
  sky.addColorStop(1, '#5a3a3a');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H);
  // low cloud, lit from below
  for (let i = 0; i < 26; i++) {
    const x = rand(i) * W;
    const y = yOf(0.22 + rand(i + 50) * 0.3);
    const r = ppr * (0.15 + rand(i + 9) * 0.25);
    const gr = c.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(70, 60, 80, 0.16)');
    gr.addColorStop(1, 'rgba(70, 60, 80, 0)');
    c.fillStyle = gr;
    c.fillRect(x - r, y - r * 0.5, r * 2, r);
  }
  // three bands of buildings, the far ones paler in the haze
  const bands = [
    { top: 0.2, base: 0.0, haze: 0.55, lit: 0.18, step: 0.05 },
    { top: 0.3, base: -0.02, haze: 0.3, lit: 0.26, step: 0.07 },
    { top: 0.46, base: -0.08, haze: 0.0, lit: 0.34, step: 0.11 },
  ];
  bands.forEach((band, bi) => {
    let az = -CITY_AZ;
    let i = bi * 1000;
    while (az < CITY_AZ) {
      const wid = band.step * (0.6 + rand(i) * 0.9);
      const top = band.base + 0.04 + (band.top - band.base) * Math.pow(rand(i + 3), 1.6);
      const x0 = (az + CITY_AZ) * ppr;
      const x1 = x0 + wid * ppr;
      const y0 = yOf(top);
      const y1 = yOf(band.base - 0.04);
      const shade = Math.round(10 + band.haze * 40);
      c.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 8})`;
      c.fillRect(x0, y0, x1 - x0 - 1, y1 - y0);
      // a stepped crown now and then
      if (rand(i + 7) > 0.65) c.fillRect(x0 + (x1 - x0) * 0.25, y0 - ppr * 0.02, (x1 - x0) * 0.5, ppr * 0.02);
      // lit windows
      const cw = Math.max(1.5, ppr * 0.004 * (bi + 1));
      const ch = Math.max(1.5, ppr * 0.005 * (bi + 1));
      for (let y = y0 + ch * 2; y < y1 - ch; y += ch * 2.4) {
        for (let x = x0 + cw; x < x1 - cw * 2; x += cw * 2.2) {
          const r = rand(x * 0.37 + y * 1.91 + i);
          if (r > band.lit) continue;
          const warm = r < band.lit * 0.7;
          const a = (0.35 + 0.6 * rand(x + y)) * (1 - band.haze * 0.6);
          c.fillStyle = warm ? `rgba(255, 196, 120, ${a.toFixed(2)})` : `rgba(170, 210, 255, ${(a * 0.8).toFixed(2)})`;
          c.fillRect(x, y, cw, ch);
        }
      }
      az += wid + band.step * 0.05;
      i++;
    }
  });
  // the haze at street level
  const fog = c.createLinearGradient(0, yOf(0.1), 0, H);
  fog.addColorStop(0, 'rgba(60, 48, 52, 0)');
  fog.addColorStop(1, 'rgba(60, 48, 52, 0.55)');
  c.fillStyle = fog;
  c.fillRect(0, yOf(0.1), W, H - yOf(0.1));
  city = { key, img, ppr, az0: -CITY_AZ, el0: CITY_TOP };
  return city;
}

// ------------------------------------------------------------------ outside: the city, the street, the rain

const STREET_Y = -0.35;
const LAMPS = [-27, -18, -9, 0, 9, 18, 27];
const TREES = [-22.5, -13.5, -4.5, 4.5, 13.5, 22.5];
const CARS = 7;

function paintOutside(g: G, L: Lens, v: OfficeView, w: number, h: number, dpr: number): void {
  const t = v.t;
  // the far city, at infinity: it moves only as the head turns
  const cc = cityImage(h, dpr);
  const scale = L.f / cc.ppr;
  // the image is linear in angle: put its centre (azimuth 0) where the camera's yaw puts it, its horizon at the pitch
  const x0 = L.cx - L.f * L.c.yaw - CITY_AZ * L.f;
  const y0 = L.cy + L.f * L.c.pitch - CITY_TOP * L.f;
  g.drawImage(cc.img, x0, y0, cc.img.width * scale, cc.img.height * scale);
  // the aviation lights, blinking
  for (let i = 0; i < 5; i++) {
    if (Math.sin(t * 2 + i * 1.7) < 0.7) continue;
    const p = L.sky(-1 + i * 0.5 + rand(i) * 0.2, 0.3 + rand(i + 3) * 0.14);
    glow(g, p.x, p.y, h * 0.006, 'rgba(255, 50, 50, 0.9)');
  }
  // dawn lightens the sky (a handover)
  if (v.dawn > 0) {
    const top = L.sky(0, 0.6).y;
    const bot = L.sky(0, 0).y;
    const d = g.createLinearGradient(0, top, 0, bot);
    d.addColorStop(0, `rgba(70, 90, 130, ${(0.5 * v.dawn).toFixed(3)})`);
    d.addColorStop(1, `rgba(210, 150, 130, ${(0.55 * v.dawn).toFixed(3)})`);
    g.fillStyle = d;
    g.fillRect(0, top, w, bot - top);
  }
  // the street: pavement, kerb, the wet road
  L.fill(g, [[-80, -0.12, 12.4], [80, -0.12, 12.4], [80, -0.12, 15], [-80, -0.12, 15]], '#17171b');
  L.fill(g, [[-80, -0.12, 15], [80, -0.12, 15], [80, STREET_Y, 15.05], [-80, STREET_Y, 15.05]], '#232229');
  L.fill(g, [[-80, STREET_Y, 15.05], [80, STREET_Y, 15.05], [80, STREET_Y, 26], [-80, STREET_Y, 26]], L.grad(g, [0, STREET_Y, 15], [0, STREET_Y, 26], [[0, '#101014'], [1, '#1b1a20']]));
  // far pavement and the buildings' feet across the road
  L.fill(g, [[-80, STREET_Y, 26], [80, STREET_Y, 26], [80, STREET_Y, 29], [-80, STREET_Y, 29]], '#141317');
  // lane dashes
  g.fillStyle = 'rgba(200, 190, 160, 0.22)';
  for (let x = -60; x < 60; x += 6) L.fill(g, [[x, STREET_Y, 20.4], [x + 3, STREET_Y, 20.4], [x + 3, STREET_Y, 20.6], [x, STREET_Y, 20.6]], 'rgba(200, 190, 160, 0.2)');
  // street lamps: poles, sodium heads, their long reflections on the wet road
  for (const lx of LAMPS) {
    const top = L.at(lx, 5.6, 14.4);
    const foot = L.at(lx, -0.12, 14.4);
    if (!top || !foot) continue;
    g.strokeStyle = '#0b0b0d';
    g.lineWidth = Math.max(1, top.k * 0.14);
    g.beginPath();
    g.moveTo(foot.x, foot.y);
    g.lineTo(top.x, top.y);
    g.lineTo(top.x + top.k * 1.1, top.y + top.k * 0.1);
    g.stroke();
    const head = L.at(lx + 1.1, 5.5, 14.4);
    if (!head) continue;
    glow(g, head.x, head.y, head.k * 1.6, 'rgba(255, 170, 80, 0.55)');
    glow(g, head.x, head.y, head.k * 0.35, 'rgba(255, 220, 160, 0.95)');
    // the reflection: a tall smear on the road toward the eye
    const r0 = L.at(lx + 1.1, STREET_Y, 16);
    const r1 = L.at(lx + 1.1, STREET_Y, 24);
    if (r0 && r1) {
      const rg = g.createLinearGradient(0, r1.y, 0, r0.y + (r0.y - r1.y) * 0.3);
      rg.addColorStop(0, 'rgba(255, 160, 70, 0)');
      rg.addColorStop(0.5, 'rgba(255, 160, 70, 0.22)');
      rg.addColorStop(1, 'rgba(255, 160, 70, 0)');
      g.fillStyle = rg;
      const ww = r0.k * 0.5;
      g.fillRect(r0.x - ww / 2, r1.y, ww, (r0.y - r1.y) * 1.3);
    }
  }
  // the trees on the pavement, swaying in the wind
  for (let i = 0; i < TREES.length; i++) {
    const p = L.at(TREES[i]!, -0.12, 13.9);
    if (!p) continue;
    const sway = Math.sin(t * 0.9 + i * 1.3) * 0.12 + Math.sin(t * 2.3 + i) * 0.04;
    tree(g, p.x, p.y, p.k, sway, i);
  }
  // cars: two lanes, headlights, tail lights and their wet reflections
  for (let i = 0; i < CARS; i++) {
    const lane = i % 2;
    const speed = 9 + rand(i) * 6;
    const span = 150;
    const raw = (t * speed + rand(i + 20) * span) % span;
    const x = lane === 0 ? -75 + raw : 75 - raw;
    const z = lane === 0 ? 18.2 : 22.6;
    const p = L.at(x, STREET_Y, z);
    if (!p || p.x < -w * 0.3 || p.x > w * 1.3) continue;
    car(g, p.x, p.y, p.k, lane === 0 ? 1 : -1, i);
  }
  // rain, outside the glass: long thin streaks
  rainStreaks(g, w, h, t, v.rain);
  // lightning
  if (v.flash > 0.02) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = `rgba(170, 190, 255, ${(0.35 * v.flash).toFixed(3)})`;
    g.fillRect(0, 0, w, h);
    if (v.flash > 0.5) bolt(g, L, v.bolt, v.flash, t);
    g.restore();
  }
}

function glow(g: G, x: number, y: number, r: number, c: string): void {
  if (r <= 0.5) return;
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, c);
  gr.addColorStop(1, c.replace(/[\d.]+\)$/, '0)'));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

function tree(g: G, x: number, y: number, k: number, sway: number, i: number): void {
  g.save();
  g.translate(x, y);
  g.fillStyle = '#060607';
  g.fillRect(-k * 0.12, -k * 2.6, k * 0.24, k * 2.6);
  g.translate(0, -k * 2.4);
  g.rotate(sway * 0.3);
  for (let j = 0; j < 28; j++) {
    const a = rand(i * 31 + j) * Math.PI * 2;
    const r = k * (0.3 + 1.1 * Math.sqrt(rand(i * 17 + j)));
    const cx = Math.cos(a) * r * 0.9 + sway * k * 0.3 * (r / k);
    const cy = Math.sin(a) * r * 0.55 - k * 0.7;
    g.beginPath();
    g.ellipse(cx, cy, k * (0.22 + 0.2 * rand(j + i)), k * (0.16 + 0.14 * rand(j * 3 + i)), a, 0, Math.PI * 2);
    g.fillStyle = j % 3 ? 'rgba(6, 10, 9, 0.72)' : 'rgba(12, 18, 15, 0.6)';
    g.fill();
  }
  g.restore();
}

function car(g: G, x: number, y: number, k: number, dir: 1 | -1, i: number): void {
  const L = 4.4 * k;
  const H = 1.4 * k;
  g.save();
  g.translate(x, y);
  // the reflection under it on the wet road
  const ref = g.createLinearGradient(0, 0, 0, H * 1.4);
  ref.addColorStop(0, 'rgba(255, 240, 210, 0.16)');
  ref.addColorStop(1, 'rgba(255, 240, 210, 0)');
  g.fillStyle = ref;
  g.fillRect(dir * L * 0.4, 0, dir * L * 0.25, H * 1.4);
  const tail = g.createLinearGradient(0, 0, 0, H * 1.2);
  tail.addColorStop(0, 'rgba(255, 40, 40, 0.25)');
  tail.addColorStop(1, 'rgba(255, 40, 40, 0)');
  g.fillStyle = tail;
  g.fillRect(-dir * L * 0.5, 0, dir * L * 0.12, H * 1.2);
  // the body in silhouette, a wet sheen on the roof
  g.scale(dir, 1);
  g.beginPath();
  g.moveTo(-L * 0.5, -H * 0.18);
  g.lineTo(-L * 0.5, -H * 0.55);
  g.quadraticCurveTo(-L * 0.42, -H * 0.62, -L * 0.25, -H * 0.62);
  g.lineTo(-L * 0.14, -H * 0.98);
  g.lineTo(L * 0.18, -H * 0.98);
  g.lineTo(L * 0.32, -H * 0.62);
  g.quadraticCurveTo(L * 0.48, -H * 0.58, L * 0.5, -H * 0.4);
  g.lineTo(L * 0.5, -H * 0.18);
  g.closePath();
  g.fillStyle = ['#0e0f13', '#131014', '#0d1114'][i % 3]!;
  g.fill();
  g.fillStyle = 'rgba(120, 140, 170, 0.12)';
  g.fillRect(-L * 0.12, -H * 0.96, L * 0.28, H * 0.05);
  // windows faintly lit by the dash
  g.fillStyle = 'rgba(60, 80, 100, 0.35)';
  g.beginPath();
  g.moveTo(-L * 0.11, -H * 0.9);
  g.lineTo(L * 0.16, -H * 0.9);
  g.lineTo(L * 0.27, -H * 0.64);
  g.lineTo(-L * 0.2, -H * 0.64);
  g.closePath();
  g.fill();
  // wheels
  g.fillStyle = '#050505';
  for (const wx of [-0.3, 0.32]) {
    g.beginPath();
    g.arc(wx * L, -H * 0.16, H * 0.2, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
  // lights in screen orientation: headlights ahead with a cone, tail lights behind
  const hx = x + dir * L * 0.5;
  const tx = x - dir * L * 0.5;
  const ly = y - H * 0.38;
  glow(g, hx, ly, k * 0.9, 'rgba(255, 245, 220, 0.85)');
  g.save();
  g.globalCompositeOperation = 'lighter';
  const cone = g.createLinearGradient(hx, ly, hx + dir * k * 9, ly);
  cone.addColorStop(0, 'rgba(255, 240, 210, 0.22)');
  cone.addColorStop(1, 'rgba(255, 240, 210, 0)');
  g.fillStyle = cone;
  g.beginPath();
  g.moveTo(hx, ly - k * 0.1);
  g.lineTo(hx + dir * k * 9, ly - k * 0.6);
  g.lineTo(hx + dir * k * 9, ly + k * 0.9);
  g.lineTo(hx, ly + k * 0.15);
  g.closePath();
  g.fill();
  g.restore();
  glow(g, tx, ly, k * 0.55, 'rgba(255, 30, 30, 0.85)');
}

function rainStreaks(g: G, w: number, h: number, t: number, rain: number): void {
  const n = Math.round(90 + 260 * rain);
  g.strokeStyle = `rgba(190, 205, 230, ${(0.1 + 0.14 * rain).toFixed(3)})`;
  g.lineWidth = Math.max(0.6, h * 0.0011);
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const sp = 1.6 + rand(i) * 1.1;
    const x0 = rand(i + 0.5) * (w + 200) - 100;
    const y = ((t * sp + rand(i + 9)) % 1) * (h + 120) - 60;
    const len = h * (0.03 + rand(i + 3) * 0.05);
    g.moveTo(x0 + (y / h) * 40, y);
    g.lineTo(x0 + (y / h) * 40 - len * 0.12, y + len);
  }
  g.stroke();
}

function bolt(g: G, L: Lens, az: number, k: number, t: number): void {
  let p = L.sky(az, 0.55);
  const end = L.sky(az + 0.05, 0.05);
  g.strokeStyle = `rgba(235, 240, 255, ${(0.9 * k).toFixed(3)})`;
  g.lineWidth = 2;
  g.shadowColor = 'rgba(170, 190, 255, 0.9)';
  g.shadowBlur = 12;
  g.beginPath();
  g.moveTo(p.x, p.y);
  const steps = 9;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    const jitter = (rand(i + Math.floor(t * 3) * 13) - 0.5) * (end.y - p.y) * 0.18;
    const x = mix(L.sky(az, 0.55).x, end.x, u) + jitter;
    const y = mix(L.sky(az, 0.55).y, end.y, u);
    g.lineTo(x, y);
    p = { x, y };
  }
  g.stroke();
  g.shadowBlur = 0;
}

// ------------------------------------------------------------------ the room

/** The back wall around the glass, the mullions, and the droplets running down the glass. */
function paintWindowWall(g: G, L: Lens, v: OfficeView, h: number): void {
  const Z = ROOM.back;
  const wall = '#0b0c11';
  // above the glass and the frame edges
  L.fill(g, [[ROOM.left, WIN.top, Z], [ROOM.right, WIN.top, Z], [ROOM.right, ROOM.ceil, Z], [ROOM.left, ROOM.ceil, Z]], wall);
  L.fill(g, [[ROOM.left, 0, Z], [WIN.left, 0, Z], [WIN.left, ROOM.ceil, Z], [ROOM.left, ROOM.ceil, Z]], wall);
  L.fill(g, [[WIN.right, 0, Z], [ROOM.right, 0, Z], [ROOM.right, ROOM.ceil, Z], [WIN.right, ROOM.ceil, Z]], wall);
  L.fill(g, [[WIN.left, 0, Z], [WIN.right, 0, Z], [WIN.right, WIN.bottom, Z], [WIN.left, WIN.bottom, Z]], '#08090c');
  // mullions and the transom
  for (let x = WIN.left; x <= WIN.right + 0.01; x += WIN.mullion) {
    L.fill(g, [[x - 0.05, 0, Z - 0.02], [x + 0.05, 0, Z - 0.02], [x + 0.05, WIN.top, Z - 0.02], [x - 0.05, WIN.top, Z - 0.02]], '#101117');
  }
  L.fill(g, [[WIN.left, 2.2, Z - 0.02], [WIN.right, 2.2, Z - 0.02], [WIN.right, 2.25, Z - 0.02], [WIN.left, 2.25, Z - 0.02]], '#101117');
  // droplets on the glass, catching the street's light
  const n = Math.round(40 + 70 * v.rain);
  for (let i = 0; i < n; i++) {
    const x = WIN.left + rand(i * 3) * (WIN.right - WIN.left);
    const speed = 0.05 + rand(i * 3 + 1) * 0.25;
    const yy = WIN.top - ((v.t * speed + rand(i * 3 + 2) * 3) % (WIN.top - WIN.bottom));
    const p = L.at(x, yy, Z - 0.03);
    if (!p) continue;
    const r = p.k * (0.008 + rand(i) * 0.01);
    if (r < 0.4) continue;
    // the trail it left
    g.strokeStyle = 'rgba(160, 180, 210, 0.08)';
    g.lineWidth = r * 0.6;
    g.beginPath();
    g.moveTo(p.x, p.y);
    g.lineTo(p.x + Math.sin(i) * r, p.y - p.k * 0.12 * (0.5 + rand(i + 5)));
    g.stroke();
    g.fillStyle = 'rgba(15, 18, 26, 0.55)';
    g.beginPath();
    g.arc(p.x, p.y, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255, 210, 160, 0.55)';
    g.beginPath();
    g.arc(p.x - r * 0.3, p.y + r * 0.35, r * 0.35, 0, Math.PI * 2);
    g.fill();
  }
  // the clock above the glass: three in the morning
  const c = L.at(-2.1, 2.55, Z - 0.05);
  if (c) clock(g, c.x, c.y, c.k * 0.26, v.clockMin, v.lights);
  void h;
}

function clock(g: G, x: number, y: number, r: number, minutes: number, lights: number): void {
  g.save();
  g.translate(x, y);
  g.fillStyle = '#1b1c20';
  g.beginPath();
  g.arc(0, 0, r * 1.08, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = `rgba(214, 208, 190, ${(0.35 + 0.45 * lights).toFixed(3)})`;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#151515';
  g.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.lineWidth = r * (i % 3 ? 0.03 : 0.06);
    g.beginPath();
    g.moveTo(Math.sin(a) * r * 0.8, -Math.cos(a) * r * 0.8);
    g.lineTo(Math.sin(a) * r * 0.92, -Math.cos(a) * r * 0.92);
    g.stroke();
  }
  const hr = ((minutes / 60) % 12) / 12;
  const mn = (minutes % 60) / 60;
  g.lineWidth = r * 0.08;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(Math.sin(hr * Math.PI * 2) * r * 0.5, -Math.cos(hr * Math.PI * 2) * r * 0.5);
  g.stroke();
  g.lineWidth = r * 0.05;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(Math.sin(mn * Math.PI * 2) * r * 0.78, -Math.cos(mn * Math.PI * 2) * r * 0.78);
  g.stroke();
  g.restore();
}

/** Ceiling, floor and side walls, the tubes, the light pools and their reflections in the polished floor. */
function paintShell(g: G, L: Lens, v: OfficeView): void {
  const { left, right, back, front, ceil } = ROOM;
  const lit = v.lights;
  L.fill(g, [[left, ceil, front], [right, ceil, front], [right, ceil, back], [left, ceil, back]], L.grad(g, [0, ceil, front], [0, ceil, back], [[0, '#07080b'], [1, '#0d0e13']]));
  L.fill(g, [[left, 0, front], [right, 0, front], [right, 0, back], [left, 0, back]], L.grad(g, [0, 0, front + 3], [0, 0, back], [[0, '#0a0b0f'], [1, '#14151b']]));
  L.fill(g, [[left, 0, front], [left, 0, back], [left, ceil, back], [left, ceil, front]], L.grad(g, [left, 1, front + 3], [left, 1, back], [[0, '#050507'], [1, '#0b0c10']]));
  L.fill(g, [[right, 0, front], [right, 0, back], [right, ceil, back], [right, ceil, front]], L.grad(g, [right, 1, front + 3], [right, 1, back], [[0, '#06070a'], [1, '#0e0f14']]));
  // carpet tiles' seams, faint, for depth
  g.strokeStyle = 'rgba(255, 255, 255, 0.025)';
  g.lineWidth = 1;
  for (let z = 1; z < back; z += 1.5) {
    if (L.path(g, [[left, 0.001, z], [right, 0.001, z], [right, 0.001, z + 0.01], [left, 0.001, z + 0.01]])) g.stroke();
  }
  // the tubes: three rows, one dead, one flickering; the crimson stage turns them red
  const tubeCol = v.crimson > 0.5 ? [255, 50, 60] : [220, 235, 255];
  for (const z of [3, 6.2, 9.4]) {
    for (const x of [-3.4, 0, 3.4]) {
      const id = x * 7 + z;
      const dead = id === 0 + 9.4;
      const flick = id === -3.4 * 7 + 6.2 ? (Math.sin(v.t * 37) > 0.2 && Math.sin(v.t * 3.1) > -0.6 ? 1 : 0.15) : 1;
      const on = dead ? 0.05 : lit * flick;
      L.fill(g, [[x - 0.7, ceil - 0.01, z - 0.12], [x + 0.7, ceil - 0.01, z - 0.12], [x + 0.7, ceil - 0.01, z + 0.12], [x - 0.7, ceil - 0.01, z + 0.12]], '#17181c');
      const a = (0.2 + 0.8 * on).toFixed(3);
      L.fill(g, [[x - 0.62, ceil - 0.02, z - 0.05], [x + 0.62, ceil - 0.02, z - 0.05], [x + 0.62, ceil - 0.02, z + 0.05], [x - 0.62, ceil - 0.02, z + 0.05]], `rgba(${tubeCol[0]}, ${tubeCol[1]}, ${tubeCol[2]}, ${a})`);
      if (on < 0.1) continue;
      const p = L.at(x, ceil - 0.05, z);
      if (p) glow(g, p.x, p.y, p.k * 1.4, `rgba(${tubeCol[0]}, ${tubeCol[1]}, ${tubeCol[2]}, ${(0.12 * on).toFixed(3)})`);
      // the pool on the floor, and its streak in the polish
      const f = L.at(x, 0, z);
      if (f) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.translate(f.x, f.y);
        g.scale(1, 0.32);
        glow(g, 0, 0, f.k * 2.2, `rgba(${tubeCol[0]}, ${tubeCol[1]}, ${tubeCol[2]}, ${(0.07 * on).toFixed(3)})`);
        g.restore();
        // the tube's reflection in the polished floor: a soft streak, not a box (only for tubes well ahead)
        if (f.d > 3.5) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        g.translate(f.x, f.y);
        g.scale(0.25, 1);
        glow(g, 0, 0, f.k * 1.2, `rgba(${tubeCol[0]}, ${tubeCol[1]}, ${tubeCol[2]}, ${(0.05 * on).toFixed(3)})`);
        g.restore();
        }
        // a faint cone of light down through the haze
        const top = L.at(x, ceil - 0.05, z);
        if (top && top.d > 3.5) {
          // only for tubes well ahead: one overhead would fill the frame with a wedge
          const cone = g.createLinearGradient(0, top.y, 0, f.y);
          cone.addColorStop(0, `rgba(${tubeCol[0]}, ${tubeCol[1]}, ${tubeCol[2]}, ${(0.035 * on).toFixed(3)})`);
          cone.addColorStop(1, `rgba(${tubeCol[0]}, ${tubeCol[1]}, ${tubeCol[2]}, 0)`);
          g.fillStyle = cone;
          g.beginPath();
          g.moveTo(top.x - top.k * 0.6, top.y);
          g.lineTo(top.x + top.k * 0.6, top.y);
          g.lineTo(f.x + f.k * 0.9, f.y);
          g.lineTo(f.x - f.k * 0.9, f.y);
          g.closePath();
          g.fill();
        }
      }
    }
  }
}

/** The exit sign over the far door on the left wall, red in the dark, and its spill on the wall. */
function exitSign(g: G, L: Lens, t: number, lights: number): void {
  const p = L.at(-5.98, 2.45, 5.2);
  if (!p) return;
  const k = p.k;
  const flick = Math.sin(t * 31) > 0.95 ? 0.5 : 1;
  glow(g, p.x, p.y, k * 1.4, `rgba(255, 40, 50, ${(0.22 * flick).toFixed(3)})`);
  L.fill(g, [[-5.97, 2.32, 4.85], [-5.97, 2.32, 5.55], [-5.97, 2.58, 5.55], [-5.97, 2.58, 4.85]], `rgba(${Math.round(160 + 60 * flick)}, 20, 30, 0.95)`);
  g.fillStyle = `rgba(255, 220, 220, ${(0.85 * flick).toFixed(3)})`;
  g.font = `700 ${Math.max(6, k * 0.13)}px "Share Tech Mono", monospace`;
  g.textAlign = 'center';
  g.fillText('EXIT', p.x, p.y + k * 0.05);
  // the door under it, a darker rectangle
  L.fill(g, [[-5.99, 0, 4.7], [-5.99, 0, 5.7], [-5.99, 2.2, 5.7], [-5.99, 2.2, 4.7]], `rgba(4, 4, 6, ${(0.6 + 0.2 * lights).toFixed(2)})`);
}

/** The server rack on the dark side of the room, its LEDs. */
function paintRack(g: G, L: Lens, t: number): void {
  const x0 = -5.95;
  const x1 = -5.25;
  L.fill(g, [[x1, 0, 8.6], [x1, 0, 9.4], [x1, 2.1, 9.4], [x1, 2.1, 8.6]], '#0a0a0d');
  L.fill(g, [[x0, 2.1, 8.6], [x1, 2.1, 8.6], [x1, 2.1, 9.4], [x0, 2.1, 9.4]], '#111216');
  for (let i = 0; i < 22; i++) {
    const y = 0.2 + (i % 11) * 0.17;
    const z = 8.7 + Math.floor(i / 11) * 0.35 + 0.1;
    const on = Math.sin(t * (2 + rand(i) * 6) + i) > 0.1;
    if (!on) continue;
    const p = L.at(x1 + 0.01, y, z);
    if (p) glow(g, p.x, p.y, p.k * 0.05, rand(i + 4) > 0.8 ? 'rgba(255, 170, 60, 0.95)' : 'rgba(80, 255, 160, 0.9)');
  }
}

/** A box from its corners: the visible faces (top, front, the near side). */
function box(g: G, L: Lens, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, top: string, front: string, side: string): void {
  const sideX = L.c.x < x0 ? x0 : L.c.x > x1 ? x1 : null;
  if (sideX !== null) L.fill(g, [[sideX, y0, z0], [sideX, y0, z1], [sideX, y1, z1], [sideX, y1, z0]], side);
  if (L.c.y > y1) L.fill(g, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], top);
  L.fill(g, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], front);
}

interface DeskSpec {
  x: number;
  z: number;
  w: number;
  monitors: number;
  seed: number;
}
const OTHER_DESKS: DeskSpec[] = [
  { x: -3.4, z: 9.6, w: 1.8, monitors: 1, seed: 1 },
  { x: -0.8, z: 9.6, w: 1.8, monitors: 2, seed: 2 },
  { x: 4.2, z: 9.6, w: 1.8, monitors: 1, seed: 3 },
  { x: -2.8, z: 5.2, w: 1.9, monitors: 2, seed: 4 },
];

function screenColour(v: OfficeView, seed: number): [number, number, number, number] {
  if (v.alarm > 0) {
    const pulse = 0.6 + 0.4 * Math.sin(v.t * 6 + seed);
    return [mix(40, 255, v.alarm), mix(80, 30, v.alarm), mix(120, 50, v.alarm), 0.5 + 0.4 * pulse * v.alarm];
  }
  return seed % 2 ? [40, 110, 150, 0.55] : [70, 60, 140, 0.5];
}

function monitor(g: G, L: Lens, cx: number, z: number, wid: number, hgt: number, base: number, rgba: [number, number, number, number], angle = 0, content?: (g: G, w: number, h: number) => void): void {
  const dx = (Math.cos(angle) * wid) / 2;
  const dz = (Math.sin(angle) * wid) / 2;
  const y0 = base;
  const y1 = base + hgt;
  // stand
  L.fill(g, [[cx - 0.03, base - 0.12, z + 0.06], [cx + 0.03, base - 0.12, z + 0.06], [cx + 0.03, base, z + 0.06], [cx - 0.03, base, z + 0.06]], '#0c0c0f');
  // bezel
  L.fill(g, [[cx - dx - 0.02, y0 - 0.02, z - dz], [cx + dx + 0.02, y0 - 0.02, z + dz], [cx + dx + 0.02, y1 + 0.02, z + dz], [cx - dx - 0.02, y1 + 0.02, z - dz]], '#08080a');
  const [r, gg, b, a] = rgba;
  const scr = L.grad(g, [cx, y1, z], [cx, y0, z], [[0, `rgba(${r}, ${gg}, ${b}, ${(a * 0.7).toFixed(3)})`], [1, `rgba(${r * 0.5}, ${gg * 0.5}, ${b * 0.5}, ${a.toFixed(3)})`]]);
  L.fill(g, [[cx - dx, y0, z - dz - 0.005], [cx + dx, y0, z + dz - 0.005], [cx + dx, y1, z + dz - 0.005], [cx - dx, y1, z - dz - 0.005]], scr);
  const c = L.at(cx, (y0 + y1) / 2, z - 0.01);
  if (!c) return;
  if (content) {
    g.save();
    g.translate(c.x, c.y);
    content(g, wid * c.k * Math.cos(angle), hgt * c.k);
    g.restore();
  }
  // the glow it throws on the desk and the air, and a pool on the floor in front
  glow(g, c.x, c.y, c.k * wid * 0.9, `rgba(${r}, ${gg}, ${b}, ${(0.12 * a).toFixed(3)})`);
  const fl = L.at(cx, 0, z - 0.9);
  if (fl) {
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.translate(fl.x, fl.y);
    g.scale(1, 0.3);
    glow(g, 0, 0, fl.k * 1.1, `rgba(${r}, ${gg}, ${b}, ${(0.06 * a).toFixed(3)})`);
    g.restore();
  }
}

function chair(g: G, L: Lens, x: number, z: number, turn: number, lights: number): void {
  const p = L.at(x, 0, z);
  if (!p) return;
  const k = p.k;
  g.save();
  g.translate(p.x, p.y);
  g.fillStyle = '#07070a';
  // five-star base
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + turn;
    g.beginPath();
    g.moveTo(0, -k * 0.08);
    g.lineTo(Math.cos(a) * k * 0.32, -k * 0.04 + Math.sin(a) * k * 0.06);
    g.lineWidth = k * 0.035;
    g.strokeStyle = '#07070a';
    g.stroke();
  }
  g.fillRect(-k * 0.025, -k * 0.48, k * 0.05, k * 0.42);
  // seat and back
  g.beginPath();
  g.ellipse(0, -k * 0.5, k * 0.27, k * 0.07, 0, 0, Math.PI * 2);
  g.fillStyle = '#0d0d11';
  g.fill();
  g.beginPath();
  const bw = k * 0.24 * (0.6 + 0.4 * Math.abs(Math.cos(turn)));
  g.moveTo(-bw, -k * 0.58);
  g.quadraticCurveTo(-bw * 1.1, -k * 1.05, -bw * 0.7, -k * 1.15);
  g.quadraticCurveTo(0, -k * 1.22, bw * 0.7, -k * 1.15);
  g.quadraticCurveTo(bw * 1.1, -k * 1.05, bw, -k * 0.58);
  g.closePath();
  g.fillStyle = '#0b0b0f';
  g.fill();
  g.strokeStyle = `rgba(140, 170, 220, ${(0.08 + 0.1 * lights).toFixed(3)})`;
  g.lineWidth = Math.max(1, k * 0.008);
  g.stroke();
  g.restore();
}

function paintDesk(g: G, L: Lens, d: DeskSpec, v: OfficeView): void {
  const x0 = d.x - d.w / 2;
  const x1 = d.x + d.w / 2;
  box(g, L, x0, x1, 0.72, 0.75, d.z, d.z + 0.8, '#17181d', '#0d0e12', '#0b0c10');
  box(g, L, x0 + 0.05, x0 + 0.5, 0, 0.72, d.z + 0.05, d.z + 0.75, '#101116', '#0a0a0e', '#08080b');
  // a low partition behind it
  L.fill(g, [[x0, 0, d.z + 0.82], [x1, 0, d.z + 0.82], [x1, 1.25, d.z + 0.82], [x0, 1.25, d.z + 0.82]], '#0f1016');
  for (let i = 0; i < d.monitors; i++) {
    const mx = d.x + (i - (d.monitors - 1) / 2) * 0.6;
    monitor(g, L, mx, d.z + 0.55, 0.52, 0.32, 0.88, screenColour(v, d.seed + i), 0, (c, w, h) => screensaver(c, w, h, v, d.seed + i));
  }
  // a coffee cup, papers
  const cup = L.at(x1 - 0.25, 0.75, d.z + 0.25);
  if (cup) {
    g.fillStyle = '#1d1a18';
    g.fillRect(cup.x - cup.k * 0.04, cup.y - cup.k * 0.1, cup.k * 0.08, cup.k * 0.1);
  }
  L.fill(g, [[x0 + 0.6, 0.751, d.z + 0.15], [x0 + 0.9, 0.751, d.z + 0.1], [x0 + 0.95, 0.751, d.z + 0.4], [x0 + 0.65, 0.751, d.z + 0.45]], 'rgba(190, 185, 170, 0.22)');
  chair(g, L, d.x + 0.2, d.z - 0.45, rand(d.seed) * 2, v.lights);
}

function screensaver(g: G, w: number, h: number, v: OfficeView, seed: number): void {
  if (w < 8) return;
  g.save();
  g.beginPath();
  g.rect(-w / 2, -h / 2, w, h);
  g.clip();
  if (v.alarm > 0.3) {
    g.fillStyle = `rgba(255, 220, 220, ${(0.7 * v.alarm).toFixed(3)})`;
    g.font = `700 ${Math.max(6, h * 0.14)}px "Share Tech Mono", monospace`;
    g.textAlign = 'center';
    if (Math.sin(v.t * 5 + seed) > -0.3) g.fillText('WARNING', 0, h * 0.05);
  } else {
    // a slow sweep of log lines
    g.fillStyle = 'rgba(200, 230, 255, 0.25)';
    for (let i = 0; i < 9; i++) {
      const y = -h / 2 + ((i / 9 + v.t * 0.05 + seed * 0.1) % 1) * h;
      g.fillRect(-w * 0.42, y, w * (0.3 + 0.5 * rand(i + seed * 7)), Math.max(1, h * 0.025));
    }
  }
  g.restore();
}

/** The player's workstation: desk, three monitors (unless the real ones cover them), keyboard, mouse, a cold coffee. */
function paintWorkstation(g: G, L: Lens, v: OfficeView): void {
  const { x, z, depth, width } = DESK;
  const x0 = x - width / 2;
  const x1 = x + width / 2;
  box(g, L, x0, x1, 0.72, 0.75, z, z + depth, '#1a1b21', '#0e0f13', '#0c0d11');
  box(g, L, x1 - 0.5, x1 - 0.05, 0, 0.72, z + 0.05, z + depth - 0.05, '#101116', '#0a0a0e', '#08080b');
  L.fill(g, [[x0 - 0.1, 0, z + depth + 0.02], [x1 + 0.1, 0, z + depth + 0.02], [x1 + 0.1, 1.35, z + depth + 0.02], [x0 - 0.1, 1.35, z + depth + 0.02]], '#0f1016');
  const on = v.monitors;
  if (!v.hideDesk) {
    const col = (seed: number): [number, number, number, number] => {
      if (v.alarm > 0) return screenColour(v, seed);
      return [mix(10, 50, on), mix(12, 170, on), mix(16, 210, on), mix(0.25, 0.75, on)];
    };
    monitor(g, L, x - 0.69, z + 0.5, 0.6, 0.42, 0.85, col(1), -0.38, (c, w, h) => deskScreen(c, w, h, v, 0));
    monitor(g, L, x, z + 0.55, 0.66, 0.46, 0.85, col(2), 0, (c, w, h) => deskScreen(c, w, h, v, 1));
    monitor(g, L, x + 0.69, z + 0.5, 0.6, 0.42, 0.85, col(3), 0.38, (c, w, h) => deskScreen(c, w, h, v, 2));
  }
  // keyboard and mouse, lit by the screens
  const kb = mix(0.05, 0.35, on);
  L.fill(g, [[x - 0.24, 0.755, z + 0.12], [x + 0.24, 0.755, z + 0.12], [x + 0.24, 0.755, z + 0.3], [x - 0.24, 0.755, z + 0.3]], `rgba(30, 32, 40, 1)`);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 14; c++) {
      const kx = x - 0.22 + c * 0.032;
      const kz = z + 0.14 + r * 0.038;
      L.fill(g, [[kx, 0.762, kz], [kx + 0.026, 0.762, kz], [kx + 0.026, 0.762, kz + 0.03], [kx, 0.762, kz + 0.03]], `rgba(${Math.round(60 + 80 * kb)}, ${Math.round(70 + 120 * kb)}, ${Math.round(90 + 140 * kb)}, ${(0.35 + kb).toFixed(2)})`);
    }
  }
  L.fill(g, [[x + 0.36, 0.756, z + 0.16], [x + 0.42, 0.756, z + 0.16], [x + 0.42, 0.756, z + 0.26], [x + 0.36, 0.756, z + 0.26]], '#202128');
  const cup = L.at(x0 + 0.3, 0.75, z + 0.2);
  if (cup) {
    g.fillStyle = '#e8e2d6';
    g.globalAlpha = 0.25 + 0.3 * on;
    g.fillRect(cup.x - cup.k * 0.045, cup.y - cup.k * 0.11, cup.k * 0.09, cup.k * 0.11);
    g.globalAlpha = 1;
  }
  L.fill(g, [[x0 + 0.08, 0.751, z + 0.08], [x0 + 0.42, 0.751, z + 0.05], [x0 + 0.46, 0.751, z + 0.4], [x0 + 0.12, 0.751, z + 0.44]], 'rgba(210, 205, 190, 0.18)');
  L.fill(g, [[x0 + 0.14, 0.752, z + 0.12], [x0 + 0.44, 0.752, z + 0.14], [x0 + 0.42, 0.752, z + 0.46], [x0 + 0.1, 0.752, z + 0.44]], 'rgba(210, 205, 190, 0.14)');
}

function deskScreen(g: G, w: number, h: number, v: OfficeView, i: number): void {
  if (w < 10 || v.monitors < 0.3) return;
  g.save();
  g.beginPath();
  g.rect(-w / 2, -h / 2, w, h);
  g.clip();
  if (v.alarm > 0.3) {
    g.fillStyle = `rgba(255, 230, 230, ${(0.8 * v.alarm).toFixed(3)})`;
    g.font = `700 ${Math.max(6, h * 0.08)}px "Share Tech Mono", monospace`;
    g.textAlign = 'center';
    if (Math.sin(v.t * 6 + i) > -0.4) g.fillText('SUSPICIOUS ACTIVITY', 0, 0);
  } else {
    g.fillStyle = `rgba(200, 240, 255, ${(0.35 * v.monitors).toFixed(3)})`;
    g.font = `600 ${Math.max(5, h * 0.06)}px "Share Tech Mono", monospace`;
    g.textAlign = 'center';
    g.fillText(['ACCESS LOG', 'BLACKOUT.exe', 'CONSOLES'][i]!, 0, -h * 0.3);
    for (let r = 0; r < 8; r++) g.fillRect(-w * 0.4, -h * 0.18 + r * h * 0.07, w * (0.3 + 0.5 * rand(r + i * 9)), Math.max(1, h * 0.02));
  }
  g.restore();
}

// ------------------------------------------------------------------ the whole room

/** Paints the office as the camera sees it. `g` is scaled to CSS pixels. */
export function paintOffice(g: G, w: number, h: number, dpr: number, v: OfficeView): void {
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  if (v.fade <= 0.001) return;
  const L = new Lens(v.cam, w, h);
  // outside, seen only through the glass
  g.save();
  if (L.path(g, [[WIN.left, WIN.bottom, ROOM.back], [WIN.right, WIN.bottom, ROOM.back], [WIN.right, WIN.top, ROOM.back], [WIN.left, WIN.top, ROOM.back]])) {
    g.clip();
    paintOutside(g, L, v, w, h, dpr);
    // the shape outside the glass (stage 1)
    if (v.shadow !== null) {
      const x = mix(-6, 6, v.shadow);
      const p = L.at(x, -0.1, 13.4);
      if (p) {
        g.globalAlpha = Math.sin(Math.PI * v.shadow) * 0.85;
        drawDeath(g, p.x, p.y, p.k * 2.6, { t: v.t, form: 1, point: 0, fragment: 0.1, eyes: 0.5 }, dpr);
        g.globalAlpha = 1;
      }
    }
  }
  g.restore();
  paintWindowWall(g, L, v, h);
  paintShell(g, L, v);
  exitSign(g, L, v.t, v.lights);
  paintRack(g, L, v.t);
  // furniture and people, far to near
  const items: Array<{ z: number; draw: () => void }> = [];
  for (const d of OTHER_DESKS) items.push({ z: d.z, draw: () => paintDesk(g, L, d, v) });
  items.push({ z: DESK.z, draw: () => paintWorkstation(g, L, v) });
  items.push({ z: CHAIR.z, draw: () => chair(g, L, CHAIR.x, CHAIR.z, 0.35, v.lights) });
  if (v.kiro) {
    const k = v.kiro;
    items.push({
      z: k.z,
      draw: () => {
        const p = L.at(k.x, 0, k.z);
        if (!p) return;
        drawKiro(g, p.x, p.y, p.k * 1.78, k.pose, dpr);
      },
    });
  }
  if (v.death) {
    const d = v.death;
    items.push({
      z: d.z,
      draw: () => {
        const p = L.at(d.x, 0, d.z);
        if (!p) return;
        drawDeath(g, p.x, p.y, p.k * 2.2, { t: v.t, form: d.form, point: d.point, fragment: d.fragment, eyes: 1 }, dpr);
      },
    });
  }
  items.sort((a, b) => b.z - a.z);
  for (const it of items) it.draw();
  // the room's light: darker as the tubes dim, colder in the harvest, red in the strike, white in the flash
  const dark = 0.45 * (1 - v.lights) + 0.25 * v.cold;
  if (dark > 0.01) {
    g.fillStyle = `rgba(0, 0, 4, ${dark.toFixed(3)})`;
    g.fillRect(0, 0, w, h);
  }
  if (v.cold > 0.01) {
    g.save();
    g.globalCompositeOperation = 'color';
    g.fillStyle = `rgba(40, 70, 110, ${(0.35 * v.cold).toFixed(3)})`;
    g.fillRect(0, 0, w, h);
    g.restore();
  }
  if (v.crimson > 0.01) {
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = `rgba(255, ${Math.round(255 - 190 * v.crimson)}, ${Math.round(255 - 180 * v.crimson)}, 1)`;
    g.fillRect(0, 0, w, h);
    g.restore();
  }
  if (v.flash > 0.02) {
    g.fillStyle = `rgba(160, 180, 230, ${(0.12 * v.flash).toFixed(3)})`;
    g.fillRect(0, 0, w, h);
  }
  // vignette
  const vg = g.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.62);
  vg.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vg.addColorStop(1, 'rgba(0, 0, 0, 0.78)');
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
  if (v.fade < 1) {
    g.fillStyle = `rgba(0, 0, 0, ${(1 - v.fade).toFixed(3)})`;
    g.fillRect(0, 0, w, h);
  }
}

/** Where a world point lands on screen for this camera (for prompts that sit over things). */
export function onScreen(cam: Cam, w: number, h: number, X: number, Y: number, Z: number): { x: number; y: number } | null {
  const p = new Lens(cam, w, h).at(X, Y, Z);
  return p ? { x: p.x, y: p.y } : null;
}

// ------------------------------------------------------------------ camera moves

const ease = (u: number): number => u * u * (3 - 2 * u);

export function lerpCam(a: Cam, b: Cam, u: number): Cam {
  const e = ease(clamp(u));
  return { x: mix(a.x, b.x, e), y: mix(a.y, b.y, e), z: mix(a.z, b.z, e), yaw: mix(a.yaw, b.yaw, e), pitch: mix(a.pitch, b.pitch, e) };
}

/** The walk from where the night starts to the chair, as the player presses W (0..1), along a gentle curve. */
export function walkCam(walked: number): Cam {
  const u = clamp(walked);
  const a = CAMS.start;
  const b = CAMS.chair;
  const e = ease(u);
  return { x: mix(a.x, b.x, e * e), y: a.y, z: mix(a.z, b.z, e), yaw: Math.sin(u * Math.PI) * 0.18 + mix(a.yaw, b.yaw, e), pitch: mix(a.pitch, b.pitch, e) };
}

// ------------------------------------------------------------------ the close-ups

/** Death's eyes in the dark: crimson, slit-pupilled, following the mouse (look in -1..1). */
export function paintEyes(g: G, w: number, h: number, t: number, open: number, look: { x: number; y: number }): void {
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  if (open <= 0.01) return;
  const cx = w / 2;
  const cy = h * 0.46;
  const gap = h * 0.13;
  const ew = h * 0.085;
  const blink = t % 4.3 > 4.15 ? 0.08 : 1;
  const o = open * blink;
  for (const side of [-1, 1]) {
    const x = cx + side * gap;
    const tilt = side * 0.16;
    g.save();
    g.translate(x, cy);
    g.rotate(tilt);
    // the glow round the socket
    glow(g, 0, 0, ew * 2.4, `rgba(160, 0, 20, ${(0.25 * o).toFixed(3)})`);
    // the almond
    g.beginPath();
    g.moveTo(-ew, 0);
    g.quadraticCurveTo(0, -ew * 0.62 * o, ew, side * ew * 0.08);
    g.quadraticCurveTo(0, ew * 0.5 * o, -ew, 0);
    g.closePath();
    const sclera = g.createRadialGradient(0, 0, 0, 0, 0, ew);
    sclera.addColorStop(0, '#ff4a3a');
    sclera.addColorStop(0.55, '#b0101e');
    sclera.addColorStop(1, '#3a0008');
    g.fillStyle = sclera;
    g.save();
    g.shadowColor = 'rgba(255, 30, 40, 0.9)';
    g.shadowBlur = ew * 0.5;
    g.fill();
    g.restore();
    g.save();
    g.clip();
    // veins
    g.strokeStyle = 'rgba(60, 0, 6, 0.6)';
    g.lineWidth = Math.max(0.6, ew * 0.012);
    for (let i = 0; i < 7; i++) {
      const a = rand(i + side * 10) * Math.PI * 2;
      g.beginPath();
      g.moveTo(Math.cos(a) * ew, Math.sin(a) * ew * 0.5);
      g.quadraticCurveTo(Math.cos(a + 0.4) * ew * 0.6, Math.sin(a + 0.3) * ew * 0.3, Math.cos(a) * ew * 0.35, Math.sin(a) * ew * 0.15);
      g.stroke();
    }
    // the iris, following the mouse, and the slit
    const ix = look.x * ew * 0.38;
    const iy = look.y * ew * 0.16;
    const iris = g.createRadialGradient(ix, iy, 0, ix, iy, ew * 0.4);
    iris.addColorStop(0, '#ffd27a');
    iris.addColorStop(0.5, '#ff7a1a');
    iris.addColorStop(1, '#7a0a00');
    g.fillStyle = iris;
    g.beginPath();
    g.arc(ix, iy, ew * 0.4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#050000';
    g.beginPath();
    g.ellipse(ix, iy, ew * 0.06 * (1 + 0.3 * Math.sin(t * 0.7)), ew * 0.36, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    g.restore();
  }
}

/**
 * The handshake, close (D-224): the player's right hand reaching from the lower right in a dark jacket (a red light
 * on the cuff), Kiro's hand from the left, stained black to the wrist, silver rings and a chain at the wrist. The hands
 * are built with volume (shaded palms, knuckles, three-jointed fingers with nails, a shadow where they meet) and
 * layered so that her fingers close over the back of the player's hand and the player's thumb lies over hers.
 * `reach` brings them together, `grip` closes the fingers, `pump` (0..1) shakes them twice, `release` opens them.
 */
export function paintHands(g: G, w: number, h: number, t: number, reach: number, grip: number, pump: number, release: number, shoulder?: { x: number; y: number }): void {
  const r = ease(clamp(reach)) * (1 - 0.35 * ease(clamp(release)));
  const close = clamp(grip) * (1 - ease(clamp(release)));
  const bob = pump > 0 ? Math.sin(pump * Math.PI * 4) * h * 0.022 : 0;
  const tilt = pump > 0 ? Math.sin(pump * Math.PI * 4) * 0.05 : 0;
  const S = h * 0.42;
  const mx = w * 0.53;
  const my = h * 0.66 + bob;
  // her arm starts at her own shoulder (projected from the room); her hand rises from her side to the meeting point
  const sh = shoulder ?? { x: w * 0.4, y: h * 0.62 };
  const her = { x: mix(sh.x + S * 0.02, mx - S * 0.12, r), y: mix(sh.y + S * 0.5, my - S * 0.02, r) };
  const you = { x: mix(w + S * 0.5, mx + S * 0.12, r), y: mix(h + S * 0.6, my + S * 0.02, r) };
  // the darkness round the meeting, so the hands read against the room
  const pool = g.createRadialGradient(mx, my, S * 0.1, mx, my, S * 1.6);
  pool.addColorStop(0, `rgba(0, 0, 0, ${(0.35 * r).toFixed(3)})`);
  pool.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = pool;
  g.fillRect(mx - S * 1.6, my - S * 1.6, S * 3.2, S * 3.2);

  // ---- Kiro's arm: shoulder, a bent elbow below the line, the forearm reaching toward the camera (wider as it nears)
  const wrist = { x: her.x - S * 0.2, y: her.y + S * 0.01 };
  const elbow = { x: mix(sh.x, wrist.x, 0.45) - S * 0.04, y: Math.max(sh.y, wrist.y) + S * (0.16 - 0.08 * r) };
  const limb = (a: { x: number; y: number }, b: { x: number; y: number }, wa: number, wb: number, fill: string | CanvasGradient) => {
    const ang = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(a.x + ca * wa, a.y + sa * wa);
    g.lineTo(b.x + ca * wb, b.y + sa * wb);
    g.arc(b.x, b.y, wb, ang, ang + Math.PI);
    g.lineTo(a.x - ca * wa, a.y - sa * wa);
    g.arc(a.x, a.y, wa, ang + Math.PI, ang);
    g.closePath();
    g.fill();
  };
  const skin = g.createLinearGradient(sh.x, sh.y, wrist.x, wrist.y);
  skin.addColorStop(0, '#7c7e78');
  skin.addColorStop(0.6, '#5d5f5a');
  skin.addColorStop(0.85, '#2c2a28');
  skin.addColorStop(1, '#141211');
  limb(sh, elbow, S * 0.038, S * 0.046, skin);
  limb(elbow, wrist, S * 0.046, S * 0.07, skin);
  // the light from the monitors along the top of her arm
  g.strokeStyle = 'rgba(150, 220, 235, 0.25)';
  g.lineWidth = Math.max(1, S * 0.005);
  g.beginPath();
  g.moveTo(sh.x, sh.y - S * 0.036);
  g.quadraticCurveTo(elbow.x, elbow.y - S * 0.05, wrist.x, wrist.y - S * 0.068);
  g.stroke();
  // chain bands round the forearm, as in her portrait
  for (const u of [0.35, 0.62]) {
    const px = mix(elbow.x, wrist.x, u);
    const py = mix(elbow.y, wrist.y, u);
    const wd = S * (0.046 + 0.024 * u);
    g.strokeStyle = 'rgba(170, 160, 130, 0.8)';
    g.lineWidth = Math.max(1, S * 0.007);
    g.setLineDash([S * 0.012, S * 0.007]);
    g.beginPath();
    g.ellipse(px, py, wd * 0.35, wd * 1.02, Math.atan2(wrist.y - elbow.y, wrist.x - elbow.x), 0, Math.PI * 2);
    g.stroke();
  }
  g.setLineDash([]);

  // ---- her hand (behind the player's fingers)
  g.save();
  g.translate(her.x, her.y);
  g.rotate(0.12 + tilt);
  // a chain bracelet at the wrist
  for (let i = 0; i < 2; i++) {
    g.strokeStyle = `rgba(200, 200, 210, ${0.45 - i * 0.12})`;
    g.lineWidth = Math.max(1, S * 0.008);
    g.setLineDash([S * 0.018, S * 0.01]);
    g.beginPath();
    g.moveTo(-S * (0.2 + i * 0.05), -S * 0.1);
    g.quadraticCurveTo(-S * (0.17 + i * 0.05), S * 0.02, -S * (0.2 + i * 0.05), S * 0.11);
    g.stroke();
  }
  g.setLineDash([]);
  // the back of her hand: ash skin darkening to black at the fingers
  const back = g.createLinearGradient(-S * 0.2, 0, S * 0.15, 0);
  back.addColorStop(0, '#5f5d58');
  back.addColorStop(0.55, '#2a2826');
  back.addColorStop(1, '#141211');
  g.fillStyle = back;
  g.beginPath();
  g.moveTo(-S * 0.22, -S * 0.1);
  g.quadraticCurveTo(-S * 0.02, -S * 0.15, S * 0.12, -S * 0.08);
  g.quadraticCurveTo(S * 0.17, S * 0.02, S * 0.12, S * 0.1);
  g.quadraticCurveTo(-S * 0.02, S * 0.15, -S * 0.22, S * 0.1);
  g.closePath();
  g.fill();
  // tendons and sigils, faint
  g.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  g.lineWidth = Math.max(0.8, S * 0.004);
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.moveTo(-S * 0.16, -S * 0.05 + i * S * 0.03);
    g.lineTo(S * 0.08, -S * 0.07 + i * S * 0.045);
    g.stroke();
  }
  g.restore();

  // ---- the player's arm and hand
  g.save();
  g.translate(you.x, you.y);
  g.rotate(-0.08 - tilt);
  // the jacket sleeve, foreshortened toward the eye, a red light on the cuff
  const js = g.createLinearGradient(S * 1.6, S * 1.2, S * 0.1, 0);
  js.addColorStop(0, '#05070b');
  js.addColorStop(1, '#151b25');
  g.fillStyle = js;
  g.beginPath();
  g.moveTo(S * 0.2, -S * 0.16);
  g.quadraticCurveTo(S * 0.9, -S * 0.05, S * 2.1, S * 0.6);
  g.lineTo(S * 1.5, S * 1.5);
  g.quadraticCurveTo(S * 0.7, S * 0.5, S * 0.16, S * 0.15);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(70, 180, 220, 0.18)';
  g.lineWidth = Math.max(1, S * 0.006);
  g.stroke();
  glow(g, S * 0.36, S * 0.16, S * 0.05, 'rgba(255, 30, 40, 0.9)');
  g.fillStyle = '#ff4050';
  g.beginPath();
  g.arc(S * 0.36, S * 0.16, S * 0.008, 0, Math.PI * 2);
  g.fill();
  // the palm side, turned for a handshake: warm skin, lit cyan from the monitors on its edge
  const palm = g.createRadialGradient(-S * 0.02, -S * 0.04, S * 0.02, 0, 0, S * 0.2);
  palm.addColorStop(0, '#c99c7f');
  palm.addColorStop(0.7, '#9a6e56');
  palm.addColorStop(1, '#5e3f30');
  g.fillStyle = palm;
  g.beginPath();
  g.moveTo(S * 0.2, -S * 0.12);
  g.quadraticCurveTo(S * 0.02, -S * 0.17, -S * 0.1, -S * 0.1);
  g.quadraticCurveTo(-S * 0.15, 0, -S * 0.1, S * 0.1);
  g.quadraticCurveTo(S * 0.04, S * 0.15, S * 0.2, S * 0.12);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(70, 232, 255, 0.35)';
  g.lineWidth = Math.max(1, S * 0.006);
  g.beginPath();
  g.moveTo(S * 0.18, -S * 0.125);
  g.quadraticCurveTo(S * 0.02, -S * 0.17, -S * 0.09, -S * 0.105);
  g.stroke();
  g.restore();

  // ---- fingers: hers wrap the back of the player's hand, the player's wrap hers
  const finger = (x0: number, y0: number, ang: number, len: number, wid: number, curl: number, skin: [string, string], nail: string) => {
    // three segments, each bending by `curl`
    let x = x0;
    let y = y0;
    let a = ang;
    const segs = [0.45, 0.32, 0.23];
    for (let i = 0; i < 3; i++) {
      const l = len * segs[i]!;
      const nx = x + Math.cos(a) * l;
      const ny = y + Math.sin(a) * l;
      const wd = wid * (1 - i * 0.12);
      const gr = g.createLinearGradient(x, y - wd, x, y + wd);
      gr.addColorStop(0, skin[0]);
      gr.addColorStop(1, skin[1]);
      g.strokeStyle = gr;
      g.lineWidth = wd;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(nx, ny);
      g.stroke();
      // a knuckle crease
      g.strokeStyle = 'rgba(0, 0, 0, 0.25)';
      g.lineWidth = Math.max(0.6, wd * 0.12);
      g.beginPath();
      g.moveTo(nx - Math.sin(a) * wd * 0.35, ny + Math.cos(a) * wd * 0.35);
      g.lineTo(nx + Math.sin(a) * wd * 0.35, ny - Math.cos(a) * wd * 0.35);
      g.stroke();
      x = nx;
      y = ny;
      a += curl * (0.75 - i * 0.1);
    }
    g.fillStyle = nail;
    g.beginPath();
    g.ellipse(x - Math.cos(a) * wid * 0.15, y - Math.sin(a) * wid * 0.15, wid * 0.32, wid * 0.22, a, 0, Math.PI * 2);
    g.fill();
  };
  // the player's fingers, reaching left; curl downward round her palm
  for (let i = 0; i < 4; i++) {
    const y0 = you.y - S * 0.09 + i * S * 0.05;
    finger(you.x - S * 0.08, y0, Math.PI + 0.12 - i * 0.05 - tilt, S * (0.36 - i * 0.03), S * 0.046, -close * 0.9, ['#c49478', '#8a5e48'], 'rgba(235, 210, 195, 0.7)');
  }
  // the contact shadow her hand throws on the player's
  if (close > 0.1) {
    g.fillStyle = `rgba(0, 0, 0, ${(0.35 * close).toFixed(3)})`;
    g.beginPath();
    g.ellipse(mx, my + S * 0.03, S * 0.16, S * 0.07, -0.1, 0, Math.PI * 2);
    g.fill();
  }
  // her fingers, reaching right, closing over the back of the player's hand; long dark nails
  for (let i = 0; i < 4; i++) {
    const y0 = her.y - S * 0.07 + i * S * 0.045;
    finger(her.x + S * 0.1, y0, 0.05 + i * 0.04 + tilt, S * (0.38 - i * 0.03), S * 0.04, close * 1.0, ['#2b2826', '#0f0d0c'], 'rgba(20, 18, 22, 0.95)');
  }
  // her rings, catching the light
  for (const [i, c] of [
    [0, '#c9cdd2'],
    [2, '#a8946a'],
  ] as const) {
    const y0 = her.y - S * 0.07 + i * S * 0.045;
    g.strokeStyle = c;
    g.lineWidth = Math.max(1, S * 0.012);
    g.beginPath();
    g.ellipse(her.x + S * 0.17, y0, S * 0.012, S * 0.024, 0.1, 0, Math.PI * 2);
    g.stroke();
  }
  // the player's thumb, over the back of her hand
  g.save();
  g.lineCap = 'round';
  const th = g.createLinearGradient(you.x, you.y - S * 0.2, you.x, you.y);
  th.addColorStop(0, '#d0a184');
  th.addColorStop(1, '#93654f');
  g.strokeStyle = th;
  g.lineWidth = S * 0.055;
  g.beginPath();
  g.moveTo(you.x - S * 0.02, you.y - S * 0.12);
  g.quadraticCurveTo(you.x - S * 0.12, you.y - S * (0.2 + 0.03 * close), you.x - S * (0.2 + 0.07 * close), you.y - S * (0.16 + 0.02 * close));
  g.stroke();
  g.fillStyle = 'rgba(240, 215, 200, 0.6)';
  g.beginPath();
  g.ellipse(you.x - S * (0.2 + 0.07 * close), you.y - S * (0.16 + 0.02 * close), S * 0.017, S * 0.012, -0.3, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // cyan motes round her fingers
  for (let i = 0; i < 12; i++) {
    const life = (t * 0.4 + rand(i)) % 1;
    glow(g, her.x + S * 0.1 + Math.sin(t + i) * S * 0.18, her.y - life * S * 0.4 + rand(i + 3) * S * 0.15, S * 0.018, `rgba(70, 232, 255, ${(0.45 * Math.sin(life * Math.PI) * r).toFixed(3)})`);
  }
}

export type { KiroPose };
