// Death on the play screen (D-254): what he is doing and where he stands, from the engine's events only, so his
// appearances mean something. He is away in the calm; when an attack begins he comes back out of the dark and
// approaches the gate it goes through; when it lands he strikes, leaning in, a hand toward the player; when the
// player's fix stops it he recoils and tears into the dark, and stays away until another attack of his is running;
// when the business is close to failing he becomes a looming, critical presence over the shop. Each time he
// appears he takes a new place (controlled variation), preferring one beside a window or panel and never
// one hidden behind them: he is drawn under every window, so he can never cover text, and he is placed where he can
// be seen. Pure, so it is tested.

import type { GameEvent } from '../../engine/log';

export type Mode = 'away' | 'returning' | 'watching' | 'approaching' | 'striking' | 'recoiling' | 'critical';

export interface Presence {
  mode: Mode;
  /** Seconds (the screen's own clock) when this mode began. */
  since: number;
  /** How many times he has appeared: each appearance picks its place afresh. */
  visit: number;
  /** The move his current attack is, if one (its gate is where he goes). */
  move?: string;
  /** He came back after banishment: straight in, close (his `return` event). */
  sudden?: boolean;
}

export const startPresence = (): Presence => ({ mode: 'away', since: 0, visit: 0 });

/** How long the passing modes last, in seconds; how long he stays away before he may come back. */
export const HOLD = { returning: 1.2, approaching: 5, striking: 2.6, recoiling: 1.4, away: 3 } as const;

export interface PresenceInput {
  /** Seconds, the screen's clock. */
  t: number;
  /** The engine's events since the last step. */
  events: readonly GameEvent[];
  /** His attacks the player's fixes froze since the last step (D-45 holds a stopped move before cutting it). */
  frozen: number;
  /** 0..3, how close the business is to failing (judge.danger). */
  danger: number;
  /** His attacks running now and not held (results.liveAttacks). */
  live: number;
}

const appear = (p: Presence, t: number, move?: string): Presence => ({ mode: 'returning', since: t, visit: p.visit + 1, move: move ?? p.move });

/** One step of his presence: the events first (in order), then the time. */
export function presenceStep(p: Presence, i: PresenceInput): Presence {
  let s = p;
  const here = () => s.mode !== 'away' && s.mode !== 'recoiling';
  for (const e of i.events) {
    switch (e.kind) {
      case 'return':
        s = { ...appear(s, i.t), sudden: true };
        break;
      case 'move-started':
        if (!here()) s = appear(s, i.t, e.move);
        else if (s.mode !== 'striking') s = { ...s, mode: 'approaching', since: i.t, move: e.move };
        break;
      case 'move-landed':
        s = { mode: 'striking', since: i.t, visit: here() ? s.visit : s.visit + 1, move: e.move };
        break;
      case 'move-cut':
      case 'door-shut':
        if (here()) s = { ...s, mode: 'recoiling', since: i.t, sudden: false };
        break;
      case 'banished':
        if (here()) s = { ...s, mode: 'recoiling', since: i.t };
        break;
      default:
        break;
    }
  }
  if (i.frozen > 0 && here()) s = { ...s, mode: 'recoiling', since: i.t, sudden: false };
  const e = i.t - s.since + 1e-9; // a hold of 1.2 s ends at 1.2 s, rounding or not
  switch (s.mode) {
    case 'returning':
      if (e >= HOLD.returning) s = { ...s, mode: i.live > 0 ? 'approaching' : 'watching', since: i.t };
      break;
    case 'approaching':
      if (e >= HOLD.approaching) s = { ...s, mode: 'watching', since: i.t };
      break;
    case 'striking':
      if (e >= HOLD.striking) s = { ...s, mode: 'watching', since: i.t };
      break;
    case 'recoiling':
      if (e >= HOLD.recoiling) s = { ...s, mode: 'away', since: i.t };
      break;
    case 'away':
      // another attack of his is running: he may come back (after long enough for the recoil to read)
      if (i.live > 0 && e >= HOLD.away) s = appear(s, i.t);
      break;
    default:
      break;
  }
  if (s.mode === 'watching' && i.danger >= 2) s = { ...s, mode: 'critical', since: i.t };
  else if (s.mode === 'critical' && i.danger < 2) s = { ...s, mode: 'watching', since: i.t };
  return s;
}

// ------------------------------------------------------------------ where he stands

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where he stands: the hem's centre (x, y), his height `s`, his lean; `seen` is how much of him is in view (0..1). */
export interface Spot {
  x: number;
  y: number;
  s: number;
  lean: number;
  seen: number;
}

const hash = (n: number) => {
  const x = Math.sin(n * 91.7 + 17.3) * 43758.5453;
  return x - Math.floor(x);
};

/** His outline's box for a spot (the blade reaches out to his right, our left). */
export const boxOf = (x: number, y: number, s: number): Rect => ({ x: x - 0.55 * s, y: y - 1.02 * s, w: 0.85 * s, h: 1.02 * s });

/** How much of a box is inside the field and not under anything that covers it (0..1). */
export function visibleShare(box: Rect, field: { w: number; h: number }, cover: readonly Rect[]): number {
  let seen = 0;
  const n = 8;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const px = box.x + ((i + 0.5) / n) * box.w;
      const py = box.y + ((j + 0.5) / n) * box.h;
      if (px < 0 || py < 0 || px > field.w || py > field.h) continue;
      if (cover.some((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h)) continue;
      seen++;
    }
  return seen / (n * n);
}

/** How close a box is to the edge of something on screen (0 touching .. 1 far): he likes to stand beside a monitor. */
function beside(box: Rect, cover: readonly Rect[], w: number): number {
  let best = 1;
  for (const r of cover) {
    const dx = Math.max(0, r.x - (box.x + box.w), box.x - (r.x + r.w));
    const dy = Math.max(0, r.y - (box.y + box.h), box.y - (r.y + r.h));
    best = Math.min(best, Math.hypot(dx, dy) / (w * 0.2));
  }
  return Math.min(1, best);
}

/**
 * Where he stands for a mode. `visit` varies the choice among the best places, so he does not reappear in the
 * same spot; `gate` is the gate his attack goes through, `shop` the shop's centre (battlefield pixels).
 */
export function placeDeath(mode: Mode, visit: number, field: { w: number; h: number }, cover: readonly Rect[], at: { shop: { x: number; y: number }; gate?: { x: number; y: number } }): Spot {
  const { w, h } = field;
  const fit = (x: number, s: number) => Math.max(0.56 * s, Math.min(w - 0.32 * s, x));
  const spot = (x: number, y: number, s: number, lean: number): Spot => {
    const fx = fit(x, s);
    return { x: fx, y, s, lean, seen: visibleShare(boxOf(fx, y, s), field, cover) };
  };
  // near the gate (or the shop): slide toward the edges until enough of him shows
  const near = (x0: number, y: number, s: number, lean: number, need: number): Spot => {
    let best = spot(x0, y, s, lean);
    for (let k = 1; k <= 12 && best.seen < need; k++) {
      for (const dir of [1, -1]) {
        const c = spot(x0 + dir * k * w * 0.05, y, s, lean);
        if (c.seen > best.seen) best = c;
      }
    }
    return best;
  };
  const gate = at.gate ?? { x: at.shop.x + w * 0.2, y: at.shop.y };
  switch (mode) {
    case 'approaching':
      return near(gate.x + w * 0.1, Math.min(h * 0.99, gate.y + h * 0.32), h * 0.5, -0.25, 0.45);
    case 'striking':
      return near(gate.x + w * 0.06, Math.min(h * 0.99, gate.y + h * 0.34), h * 0.6, -0.6, 0.4);
    case 'critical':
      return near(at.shop.x + w * 0.22, h * 0.99, h * 0.74, -0.5, 0.35);
    default: {
      // watching, returning: a quiet place beside a window or at the field's edge, a new one each visit; smaller
      // when there is little room (the field is a map: he may stand anywhere on it)
      const all: Array<Spot & { score: number }> = [];
      for (const s of [h * 0.4, h * 0.3, h * 0.22])
        for (let i = 0; i <= 14; i++)
          for (const fy of [0.99, 0.9, 0.7, 0.5, 0.32]) {
            const c = spot(w * (0.08 + (0.84 * i) / 14), h * fy, s, 0);
            if (c.seen < 0.3) continue;
            // a small nudge of the visit's own: places nearly as good take turns (controlled variation)
            const nudge = 0.18 * hash(visit * 131 + all.length * 7.3);
            all.push({ ...c, score: c.seen + 0.35 * (1 - beside(boxOf(c.x, c.y, s), cover, w)) + 0.15 * (s / (h * 0.4)) + nudge });
          }
      if (!all.length) return spot(w * 0.88, h * 0.99, h * 0.4, 0);
      all.sort((a, b) => b.score - a.score);
      const pick = all[0]!;
      return { x: pick.x, y: pick.y, s: pick.s, lean: pick.x > w * 0.5 ? -0.15 : 0.15, seen: pick.seen };
    }
  }
}
