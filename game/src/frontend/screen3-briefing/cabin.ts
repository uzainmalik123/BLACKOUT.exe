// Screen 3's scene, as data (D-184): a weathered wooden cabin at night in a dark forest, seen from a still camera
// and lit by a camera flash, after the team's reference photo. "DO YOU WANT A HUG? COME IN" is sprayed on its wall
// left of the open doorway, two camping chairs stand in front, empty bottles lie on the ground between them, a pale
// lichen-covered trunk stands on the right and thin trunks fill the dark behind. Everything is placed in units of
// the screen's height (y down, 0 at the top), with x running 0..aspect, so nothing stretches with the window. The
// cabin keeps to the right, clear of the logo and the buttons on the left.

import { clamp, mulberry32 } from '../shared/math';

export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface Chair {
  /** Centre across, and where its feet meet the ground. */
  x: number;
  ground: number;
  /** Height of the backrest's top above the ground. */
  h: number;
  fabric: 'green' | 'tan';
}

export interface Bottle {
  /** Base of the bottle. */
  x: number;
  y: number;
  /** Radians from upright: 0 stands, about ±π/2 lies on its side. */
  angle: number;
  /** Height of the whole bottle. */
  h: number;
  glass: 'green' | 'brown';
  label: boolean;
}

export interface Trunk {
  x: number;
  w: number;
  /** 0 near .. 1 far: how much of the flash reaches it. */
  depth: number;
}

export interface Cabin {
  aspect: number;
  centre: number;
  /** The front wall, from the eaves down to the ground. */
  wall: Rect;
  /** The roof's peak, over the middle of the wall. */
  apex: { x: number; y: number };
  /** How far the roof reaches past each wall. */
  overhang: number;
  /** The open doorway, right of centre. */
  door: Rect;
  /** Where the eyes sit in the doorway. */
  eyes: { x: number; y: number; gap: number };
  /** The top-left of the sprayed words, and the words, a line each. */
  graffiti: { x: number; y: number; lines: readonly string[] };
  chairs: Chair[];
  bottles: Bottle[];
  /** Thin trunks in the dark behind the cabin, far ones first. */
  trunks: Trunk[];
  /** The big pale trunk in front on the right. */
  tree: { x: number; w: number };
  /** A ghost's severed head lying on its side in front of the bottles (D-187): its centre and size. */
  head: { x: number; y: number; r: number };
  /** Where the forest floor fades into the dark. */
  horizon: number;
}

export const GRAFFITI = ['DO YOU', 'WANT A', 'HUG?', 'COME IN'] as const;

export function buildCabin(aspect: number, seed = 0x5eed): Cabin {
  const a = Math.max(1, aspect);
  const rnd = mulberry32(seed);
  // on a narrower screen the cabin is drawn narrower, so it stays clear of the words on the left
  const k = clamp((a - 0.75) / 1.03, 0.72, 1);
  const centre = a - 0.52 * k;
  const half = 0.42 * k;
  const ground = 0.7;
  const eave = 0.35;
  const wall: Rect = { x0: centre - half, x1: centre + half, y0: eave, y1: ground };
  const door: Rect = { x0: centre + 0.07 * k, x1: centre + 0.23 * k, y0: 0.405, y1: ground };
  const eyes = { x: (door.x0 + door.x1) / 2, y: door.y0 + 0.1, gap: 0.026 };

  const chairs: Chair[] = [
    { x: centre - 0.2 * k, ground: 0.83, h: 0.17, fabric: 'green' },
    { x: centre + 0.33 * k, ground: 0.82, h: 0.165, fabric: 'tan' },
  ];

  const at = (dx: number) => centre + dx * k;
  const bottles: Bottle[] = [
    { x: at(-0.05), y: 0.865, angle: 0, h: 0.095, glass: 'green', label: true },
    { x: at(-0.015), y: 0.875, angle: 0.06, h: 0.09, glass: 'green', label: true },
    { x: at(0.03), y: 0.86, angle: -0.04, h: 0.092, glass: 'brown', label: true },
    { x: at(0.055), y: 0.885, angle: 0, h: 0.088, glass: 'brown', label: false },
    { x: at(-0.13), y: 0.905, angle: -1.45, h: 0.09, glass: 'green', label: false },
    { x: at(0.17), y: 0.9, angle: 1.38, h: 0.09, glass: 'green', label: true },
    { x: at(0.24), y: 0.94, angle: 1.5, h: 0.095, glass: 'green', label: true },
  ];

  // thin, straight trunks across the whole width, far ones first so near ones are drawn over them
  const trunks: Trunk[] = [];
  for (let n = 0; n < 46; n++) {
    const depth = 0.25 + rnd() * 0.75;
    const near = 1 - depth;
    trunks.push({ x: rnd() * (a + 0.1) - 0.05, w: 0.006 + near * 0.03 + rnd() * 0.006, depth });
  }
  trunks.sort((p, q) => q.depth - p.depth);

  return {
    aspect: a,
    centre,
    wall,
    apex: { x: centre, y: 0.13 },
    overhang: 0.05 * k,
    door,
    eyes,
    graffiti: { x: wall.x0 + 0.04 * k, y: 0.375, lines: GRAFFITI },
    chairs,
    bottles,
    trunks,
    tree: { x: a - 0.05 * k, w: 0.1 * k },
    head: { x: centre - 0.075 * k, y: 0.945, r: 0.038 },
    horizon: 0.58,
  };
}

/** The roof's lower edge at x: the gable's two slopes, or the eaves beyond the walls. */
export function roofLine(c: Cabin, x: number): number {
  const dx = Math.abs(x - c.apex.x);
  const span = c.wall.x1 - c.apex.x + c.overhang;
  return c.apex.y + (dx / span) * (c.wall.y0 + 0.03 - c.apex.y);
}
