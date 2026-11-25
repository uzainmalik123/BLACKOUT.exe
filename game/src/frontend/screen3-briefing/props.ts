// The things in front of the cabin (D-187), painted at full screen resolution so they read clearly over the
// character scene: two folding camping chairs, beer bottles standing and lying, and a ghost's severed head on its
// side in a pool of blood. Each draws in screen pixels from the cabin's layout (units of the screen's height) and is
// painted once per window size onto an offscreen canvas that the scene lays over its picture.

import type { Bottle, Chair } from './cabin';

type G = CanvasRenderingContext2D;

const FABRIC = {
  green: { light: '#6f9a5f', mid: '#46703d', dark: '#26401f', pipe: '#a9c79a' },
  tan: { light: '#d6b48a', mid: '#a9835a', dark: '#6a4c31', pipe: '#efd7b5' },
} as const;

/** A soft shadow on the ground. */
function shadow(g: G, x: number, y: number, rx: number, ry: number, a = 0.55): void {
  const s = g.createRadialGradient(x, y, 0, x, y, rx);
  s.addColorStop(0, `rgba(10, 6, 4, ${a})`);
  s.addColorStop(1, 'rgba(10, 6, 4, 0)');
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  g.translate(-x, -y);
  g.fillStyle = s;
  g.beginPath();
  g.arc(x, y, rx, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** An aluminium tube from a to b, with a dark edge and a bright highlight. */
function tube(g: G, ax: number, ay: number, bx: number, by: number, w: number): void {
  g.lineCap = 'round';
  g.strokeStyle = '#3a3f47';
  g.lineWidth = w + 2;
  g.beginPath();
  g.moveTo(ax, ay);
  g.lineTo(bx, by);
  g.stroke();
  g.strokeStyle = '#a9b2bd';
  g.lineWidth = w;
  g.stroke();
  g.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  g.lineWidth = Math.max(1, w * 0.3);
  g.beginPath();
  g.moveTo(ax - w * 0.2, ay);
  g.lineTo(bx - w * 0.2, by);
  g.stroke();
}

/** A folding camping chair, seen from the front: back posts, fabric back and seat, armrests, legs crossed. */
export function drawChair(g: G, c: Chair, H: number): void {
  const x = c.x * H;
  const y = c.ground * H;
  const h = c.h * H;
  const f = FABRIC[c.fabric];
  const tw = Math.max(2.5, h * 0.028);
  shadow(g, x, y + h * 0.02, h * 0.55, h * 0.1);
  // back legs and posts, behind everything
  tube(g, x - h * 0.33, y - h * 0.06, x - h * 0.31, y - h, tw);
  tube(g, x + h * 0.33, y - h * 0.06, x + h * 0.31, y - h, tw);
  // the fabric back, sagging a little, with piping round it and a seam down the middle
  const bt = y - h * 0.98;
  const bb = y - h * 0.52;
  const bw = h * 0.3;
  const back = new Path2D();
  back.moveTo(x - bw, bt);
  back.quadraticCurveTo(x, bt + h * 0.03, x + bw, bt);
  back.lineTo(x + bw, bb);
  back.quadraticCurveTo(x, bb + h * 0.05, x - bw, bb);
  back.closePath();
  const fb = g.createLinearGradient(x - bw, 0, x + bw, 0);
  fb.addColorStop(0, f.dark);
  fb.addColorStop(0.45, f.light);
  fb.addColorStop(1, f.mid);
  g.fillStyle = fb;
  g.fill(back);
  g.strokeStyle = f.pipe;
  g.lineWidth = Math.max(1.5, h * 0.02);
  g.stroke(back);
  g.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  g.lineWidth = Math.max(1, h * 0.012);
  g.beginPath();
  g.moveTo(x, bt + h * 0.02);
  g.lineTo(x, bb + h * 0.03);
  g.stroke();
  // a fold of shadow across the back where it sags
  const fold = g.createLinearGradient(0, bt, 0, bb);
  fold.addColorStop(0, 'rgba(0, 0, 0, 0)');
  fold.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
  g.fillStyle = fold;
  g.fill(back);
  // the seat, sagging, its front edge lit
  const st = y - h * 0.5;
  const sf = y - h * 0.41;
  const sw = h * 0.36;
  const seat = new Path2D();
  seat.moveTo(x - sw * 0.85, st);
  seat.lineTo(x + sw * 0.85, st);
  seat.lineTo(x + sw, sf);
  seat.quadraticCurveTo(x, sf + h * 0.06, x - sw, sf);
  seat.closePath();
  const fs = g.createLinearGradient(0, st, 0, sf + h * 0.05);
  fs.addColorStop(0, f.dark);
  fs.addColorStop(1, f.mid);
  g.fillStyle = fs;
  g.fill(seat);
  g.strokeStyle = f.pipe;
  g.lineWidth = Math.max(1.5, h * 0.02);
  g.beginPath();
  g.moveTo(x + sw, sf);
  g.quadraticCurveTo(x, sf + h * 0.06, x - sw, sf);
  g.stroke();
  // front legs crossed under the seat, the front posts up to the armrests
  tube(g, x - h * 0.42, y, x + h * 0.38, y - h * 0.43, tw);
  tube(g, x + h * 0.42, y, x - h * 0.38, y - h * 0.43, tw);
  tube(g, x - h * 0.42, y, x - h * 0.42, y - h * 0.6, tw);
  tube(g, x + h * 0.42, y, x + h * 0.42, y - h * 0.6, tw);
  // little feet
  g.fillStyle = '#22252a';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(x + s * h * 0.42, y, tw * 1.4, tw * 0.7, 0, 0, Math.PI * 2);
    g.fill();
  }
  // padded armrests, lit on top, a cup holder in the right one
  for (const s of [-1, 1]) {
    const ax = x + s * h * 0.36;
    const ay = y - h * 0.62;
    const aw = h * 0.14;
    const ah = h * 0.06;
    const r = ah / 2;
    g.beginPath();
    g.roundRect(ax - aw / 2, ay, aw, ah, r);
    const fa = g.createLinearGradient(0, ay, 0, ay + ah);
    fa.addColorStop(0, f.light);
    fa.addColorStop(1, f.dark);
    g.fillStyle = fa;
    g.fill();
    g.strokeStyle = 'rgba(0, 0, 0, 0.5)';
    g.lineWidth = 1;
    g.stroke();
  }
  g.fillStyle = 'rgba(10, 10, 10, 0.75)';
  g.beginPath();
  g.ellipse(x + h * 0.38, y - h * 0.6, h * 0.035, h * 0.015, 0, 0, Math.PI * 2);
  g.fill();
}

/** A beer bottle, standing or lying: tinted glass with a bright highlight, a pale label, a neck and a cap. */
export function drawBottle(g: G, b: Bottle, H: number): void {
  const x = b.x * H;
  const y = b.y * H;
  const h = b.h * H;
  const w = h * 0.27;
  const glass = b.glass === 'green' ? ['#2c8a3e', '#145a24', '#7fe39a'] : ['#a3591d', '#5c2c0c', '#f0b070'];
  const standing = Math.abs(b.angle) < 0.3;
  shadow(g, x + (standing ? 0 : Math.sin(b.angle) * h * 0.5), y + 2, standing ? w * 0.9 : h * 0.55, w * 0.35, 0.6);
  g.save();
  g.translate(x, y);
  g.rotate(b.angle);
  // in the bottle's own frame: base at 0, up is -y
  const body = new Path2D();
  const nw = w * 0.36;
  body.moveTo(-w / 2, -h * 0.04);
  body.lineTo(-w / 2, -h * 0.56);
  body.bezierCurveTo(-w / 2, -h * 0.68, -nw / 2, -h * 0.7, -nw / 2, -h * 0.78);
  body.lineTo(-nw / 2, -h * 0.95);
  body.lineTo(nw / 2, -h * 0.95);
  body.lineTo(nw / 2, -h * 0.78);
  body.bezierCurveTo(nw / 2, -h * 0.7, w / 2, -h * 0.68, w / 2, -h * 0.56);
  body.lineTo(w / 2, -h * 0.04);
  body.quadraticCurveTo(w / 2, 0, w / 2 - 2, 0);
  body.lineTo(-w / 2 + 2, 0);
  body.quadraticCurveTo(-w / 2, 0, -w / 2, -h * 0.04);
  body.closePath();
  const gg = g.createLinearGradient(-w / 2, 0, w / 2, 0);
  gg.addColorStop(0, glass[1]!);
  gg.addColorStop(0.35, glass[0]!);
  gg.addColorStop(1, glass[1]!);
  g.fillStyle = gg;
  g.fill(body);
  g.strokeStyle = 'rgba(0, 0, 0, 0.6)';
  g.lineWidth = 1.2;
  g.stroke(body);
  if (b.label) {
    g.fillStyle = '#efe6cf';
    g.fillRect(-w / 2 + 0.5, -h * 0.44, w - 1, h * 0.26);
    g.fillStyle = b.glass === 'green' ? '#b3261e' : '#1d3b6b';
    g.beginPath();
    g.ellipse(0, -h * 0.31, w * 0.26, h * 0.06, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(40, 30, 20, 0.55)';
    g.fillRect(-w * 0.3, -h * 0.215, w * 0.6, Math.max(1, h * 0.015));
  }
  // the neck label and the cap
  g.fillStyle = '#e8dcc0';
  g.fillRect(-nw / 2, -h * 0.84, nw, h * 0.05);
  g.fillStyle = '#c9ccd2';
  g.fillRect(-nw / 2 - 1, -h * 1.0, nw + 2, h * 0.06);
  // the glass catching the flash
  g.fillStyle = 'rgba(255, 255, 255, 0.55)';
  g.fillRect(-w * 0.32, -h * 0.6, Math.max(1.5, w * 0.12), h * 0.5);
  g.fillStyle = glass[2]!;
  g.globalAlpha = 0.5;
  g.fillRect(w * 0.22, -h * 0.55, Math.max(1, w * 0.06), h * 0.4);
  g.globalAlpha = 1;
  g.restore();
}

/**
 * A ghost's severed head lying on its right side in a pool of its blood: pale and gaunt, one eye rolled white in its
 * socket, the other socket empty and black, the mouth hanging open, a ragged neck with the blood still running.
 */
export function drawHead(g: G, cx: number, cy: number, r: number): void {
  // the pool, spreading out from the neck, glossy
  const px = cx + r * 0.9;
  const py = cy + r * 0.55;
  const pool = new Path2D();
  pool.moveTo(px - r * 1.6, py);
  pool.bezierCurveTo(px - r * 1.7, py - r * 0.45, px - r * 0.2, py - r * 0.55, px + r * 0.6, py - r * 0.35);
  pool.bezierCurveTo(px + r * 1.6, py - r * 0.3, px + r * 2.2, py + r * 0.05, px + r * 1.7, py + r * 0.35);
  pool.bezierCurveTo(px + r * 1.1, py + r * 0.6, px - r * 1.2, py + r * 0.55, px - r * 1.6, py);
  pool.closePath();
  const pg = g.createRadialGradient(px, py, r * 0.1, px, py, r * 2);
  pg.addColorStop(0, '#7a0710');
  pg.addColorStop(0.7, '#4a0309');
  pg.addColorStop(1, '#2a0205');
  g.fillStyle = pg;
  g.fill(pool);
  g.fillStyle = 'rgba(255, 120, 120, 0.25)';
  g.beginPath();
  g.ellipse(px + r * 0.5, py - r * 0.18, r * 0.5, r * 0.07, -0.08, 0, Math.PI * 2);
  g.fill();
  // drops flung a little further
  g.fillStyle = '#5a040b';
  for (const [dx, dy, s] of [
    [2.6, 0.1, 0.12],
    [2.9, -0.15, 0.08],
    [-2.0, 0.2, 0.1],
    [3.2, 0.25, 0.06],
  ] as const) {
    g.beginPath();
    g.ellipse(px + dx * r, py + dy * r, s * r, s * r * 0.55, 0, 0, Math.PI * 2);
    g.fill();
  }

  g.save();
  g.translate(cx, cy);
  // lying on its side, the crown toward the left, the face toward us
  g.rotate(-1.35);
  // the skull: long and gaunt
  const head = new Path2D();
  head.moveTo(0, -r * 1.05);
  head.bezierCurveTo(r * 0.75, -r * 1.05, r * 0.95, -r * 0.4, r * 0.9, r * 0.05);
  head.bezierCurveTo(r * 0.85, r * 0.55, r * 0.45, r * 0.95, 0, r * 1.05);
  head.bezierCurveTo(-r * 0.45, r * 0.95, -r * 0.85, r * 0.55, -r * 0.9, r * 0.05);
  head.bezierCurveTo(-r * 0.95, -r * 0.4, -r * 0.75, -r * 1.05, 0, -r * 1.05);
  head.closePath();
  const skin = g.createRadialGradient(-r * 0.15, -r * 0.2, r * 0.1, 0, 0, r * 1.15);
  skin.addColorStop(0, '#e6e8f2');
  skin.addColorStop(0.55, '#a8abc4');
  skin.addColorStop(1, '#4b4866');
  g.save();
  g.shadowColor = 'rgba(170, 150, 255, 0.55)';
  g.shadowBlur = r * 0.5;
  g.fillStyle = skin;
  g.fill(head);
  g.restore();
  g.save();
  g.clip(head);
  // cheek hollows and the shadow under the brow
  for (const s of [-1, 1]) {
    const ch = g.createRadialGradient(s * r * 0.48, r * 0.35, 1, s * r * 0.48, r * 0.35, r * 0.45);
    ch.addColorStop(0, 'rgba(30, 24, 50, 0.7)');
    ch.addColorStop(1, 'rgba(30, 24, 50, 0)');
    g.fillStyle = ch;
    g.fillRect(-r, -r, r * 2, r * 2);
  }
  // the sockets: one with an eye rolled up white, one empty
  for (const s of [-1, 1]) {
    const ex = s * r * 0.36;
    const ey = -r * 0.12;
    const so = g.createRadialGradient(ex, ey, 1, ex, ey, r * 0.38);
    so.addColorStop(0, 'rgba(0, 0, 0, 0.95)');
    so.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = so;
    g.fillRect(ex - r * 0.4, ey - r * 0.4, r * 0.8, r * 0.8);
    g.fillStyle = '#000';
    g.beginPath();
    g.ellipse(ex, ey, r * 0.2, r * 0.24, s * 0.3, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#d9d6cf';
  g.beginPath();
  g.ellipse(-r * 0.36, -r * 0.1, r * 0.13, r * 0.15, -0.3, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(160, 30, 40, 0.6)';
  g.fillRect(-r * 0.44, -r * 0.04, r * 0.16, r * 0.02);
  // nostril slits
  g.fillStyle = 'rgba(0, 0, 0, 0.8)';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(s * r * 0.07, r * 0.28, r * 0.03, r * 0.08, s * 0.3, 0, Math.PI * 2);
    g.fill();
  }
  // the mouth hanging open
  const mouth = g.createRadialGradient(0, r * 0.62, 1, 0, r * 0.62, r * 0.3);
  mouth.addColorStop(0, '#000');
  mouth.addColorStop(1, '#16101f');
  g.fillStyle = mouth;
  g.beginPath();
  g.ellipse(0, r * 0.62, r * 0.17, r * 0.26, 0, 0, Math.PI * 2);
  g.fill();
  // blood from the mouth and the sockets
  g.strokeStyle = 'rgba(120, 8, 18, 0.85)';
  g.lineWidth = Math.max(1, r * 0.05);
  g.beginPath();
  g.moveTo(r * 0.1, r * 0.82);
  g.quadraticCurveTo(r * 0.3, r * 0.9, r * 0.45, r * 0.85);
  g.moveTo(r * 0.36, r * 0.08);
  g.quadraticCurveTo(r * 0.55, r * 0.15, r * 0.7, r * 0.12);
  g.stroke();
  g.restore();
  // the ragged neck, wet and red, where it was cut
  const neck = new Path2D();
  neck.moveTo(-r * 0.45, r * 0.9);
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    neck.lineTo(-r * 0.45 + u * r * 0.9, r * (1.05 + (i % 2 ? 0.14 : 0.02)));
  }
  neck.lineTo(r * 0.45, r * 0.9);
  neck.closePath();
  g.fillStyle = '#8e0c18';
  g.fill(neck);
  g.fillStyle = '#c22a35';
  g.beginPath();
  g.ellipse(0, r * 1.02, r * 0.3, r * 0.07, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#e8d6cc';
  g.beginPath();
  g.arc(r * 0.05, r * 1.02, r * 0.06, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Ectoplasm rising from the head, drawn each frame over the painted props. */
export function drawWisps(g: G, cx: number, cy: number, r: number, t: number, alpha: number): void {
  for (let i = 0; i < 3; i++) {
    const life = (t * 0.18 + i / 3) % 1;
    const x = cx + (i - 1) * r * 0.5 + Math.sin(t * 0.9 + i * 2) * r * 0.3;
    const y = cy - r * 0.6 - life * r * 3.2;
    const a = Math.sin(life * Math.PI) * 0.22 * alpha;
    const w = g.createRadialGradient(x, y, 0, x, y, r * 0.6);
    w.addColorStop(0, `rgba(200, 186, 255, ${a.toFixed(3)})`);
    w.addColorStop(1, 'rgba(200, 186, 255, 0)');
    g.fillStyle = w;
    g.fillRect(x - r * 0.6, y - r * 0.6, r * 1.2, r * 1.2);
  }
}
