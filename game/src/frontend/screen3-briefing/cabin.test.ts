import { describe, expect, it } from 'vitest';
import { buildCabin, roofLine } from './cabin';

describe('screen 3: the cabin in the woods (D-184)', () => {
  const c = buildCabin(16 / 9);

  it('is the same picture every time for the same window shape', () => {
    expect(buildCabin(16 / 9)).toEqual(c);
  });

  it('keeps the cabin right of the buttons, and on the screen at every desktop shape', () => {
    for (const a of [4 / 3, 3 / 2, 16 / 10, 16 / 9, 21 / 9]) {
      const k = buildCabin(a);
      expect(k.wall.x1 + k.overhang, String(a)).toBeLessThanOrEqual(a);
      expect(k.tree.x + k.tree.w / 2, String(a)).toBeLessThanOrEqual(a + 1e-9);
      // the left of the screen is clear for the logo, the scenario and the buttons
      expect(k.wall.x0 - k.overhang, String(a)).toBeGreaterThan(a * 0.4);
      // the words have room between the corner and the door
      expect(k.door.x0 - 0.025 - k.graffiti.x, String(a)).toBeGreaterThan(0.28);
    }
  });

  it('has its open door right of centre, the eyes inside it, and the words left of it', () => {
    const { wall, door, eyes, graffiti } = c;
    expect(door.x0).toBeGreaterThan(c.centre);
    expect(door.x1).toBeLessThan(wall.x1);
    expect(door.y1).toBe(wall.y1);
    expect(eyes.x).toBeGreaterThan(door.x0);
    expect(eyes.x).toBeLessThan(door.x1);
    expect(eyes.y).toBeGreaterThan(door.y0);
    expect(eyes.y).toBeLessThan(door.y1);
    expect(graffiti.x).toBeGreaterThan(wall.x0);
    expect(graffiti.x).toBeLessThan(door.x0);
    expect(graffiti.lines).toEqual(['DO YOU', 'WANT A', 'HUG?', 'COME IN']);
  });

  it('puts the roof peak over the middle, falling to the eaves', () => {
    expect(roofLine(c, c.apex.x)).toBeCloseTo(c.apex.y, 6);
    expect(roofLine(c, c.wall.x0)).toBeGreaterThan(roofLine(c, c.centre - 0.1));
    expect(roofLine(c, c.wall.x1)).toBeCloseTo(roofLine(c, c.wall.x0), 6);
    expect(roofLine(c, c.wall.x1)).toBeLessThan(c.wall.y0 + 0.04);
  });

  it('stands a chair either side of the door and the bottles on the ground in front', () => {
    const [left, right] = c.chairs;
    expect(left!.x).toBeLessThan(c.door.x0);
    expect(right!.x).toBeGreaterThan(c.door.x1);
    for (const ch of c.chairs) expect(ch.ground).toBeGreaterThan(c.wall.y1);
    expect(c.bottles.length).toBeGreaterThanOrEqual(5);
    for (const b of c.bottles) {
      expect(b.y).toBeGreaterThan(c.wall.y1);
      expect(b.y).toBeLessThan(1);
    }
    expect(c.bottles.some((b) => Math.abs(b.angle) > 1)).toBe(true);
  });

  it('lays the severed head on the ground in front of the bottles, clear of the chairs (D-187)', () => {
    for (const a of [4 / 3, 16 / 10, 16 / 9, 21 / 9]) {
      const k = buildCabin(a);
      const { head } = k;
      expect(head.y - head.r, String(a)).toBeGreaterThan(Math.max(...k.bottles.filter((b) => b.angle === 0).map((b) => b.y)) - 0.02);
      expect(head.y + head.r, String(a)).toBeLessThan(1.01);
      // in front of the chairs: below where their feet stand
      for (const ch of k.chairs) expect(head.y - head.r, String(a)).toBeGreaterThan(ch.ground + 0.03);
    }
  });

  it('fills the dark with trunks, far ones first', () => {
    expect(c.trunks.length).toBeGreaterThan(30);
    for (let i = 1; i < c.trunks.length; i++) expect(c.trunks[i]!.depth).toBeLessThanOrEqual(c.trunks[i - 1]!.depth);
  });
});
