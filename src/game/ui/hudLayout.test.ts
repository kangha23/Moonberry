import { describe, expect, it } from 'vitest';
import { HUD, hudLayout, hudZones } from './hudLayout';
import { HOTBAR_SIZE } from '../systems/inventory';

/** Every window worth caring about, plus a few nobody should have to. */
const SIZES: Array<[number, number]> = [
  [400, 700],
  [640, 400],
  [1024, 640],
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
  [320, 240],
];

describe('hudLayout', () => {
  /**
   * The regression the whole visual pass was written for.
   *
   * The hotbar used to sit at a y measured from a 640px-tall canvas that was
   * then placed 300px down a scrolling page: on a 1440x900 screen a player had
   * to scroll to see what they were holding. There is no page to scroll now,
   * and this is the assertion that keeps it that way.
   */
  it('keeps the hotbar on screen at every size', () => {
    for (const [width, height] of SIZES) {
      const { hotbar, prompt } = hudLayout(width, height);

      expect(hotbar.x).toBeGreaterThanOrEqual(0);
      expect(hotbar.x + hotbar.width).toBeLessThanOrEqual(width);
      expect(hotbar.y - hotbar.cell / 2).toBeGreaterThanOrEqual(0);
      expect(hotbar.y + hotbar.cell / 2).toBeLessThanOrEqual(height);
      // And above the prompt bar rather than under it.
      expect(hotbar.y + hotbar.cell / 2).toBeLessThanOrEqual(prompt.y);
    }
  });

  it('keeps every plate inside the canvas', () => {
    for (const [width, height] of SIZES) {
      const layout = hudLayout(width, height);
      for (const box of [layout.prompt, layout.clock, layout.quest, layout.energy]) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y + box.height).toBeLessThanOrEqual(height);
      }
    }
  });

  it('centres the hotbar', () => {
    const { hotbar } = hudLayout(1440, 900);
    expect(Math.abs(hotbar.x - (1440 - hotbar.width - hotbar.x))).toBeLessThanOrEqual(1);
  });

  it('always draws twelve cells, shrinking them rather than dropping any', () => {
    for (const [width, height] of SIZES) {
      const { hotbar } = hudLayout(width, height);
      expect(hotbar.width).toBe(HOTBAR_SIZE * (hotbar.cell + hotbar.gap) - hotbar.gap);
      expect(hotbar.cell).toBeGreaterThanOrEqual(HUD.cellMin);
      expect(hotbar.cell).toBeLessThanOrEqual(HUD.cell);
    }
  });

  it('never grows the cells past their design size on a huge screen', () => {
    expect(hudLayout(3840, 2160).hotbar.cell).toBe(HUD.cell);
  });

  it('gives the energy tube a height even when there is no room for one', () => {
    const { energy } = hudLayout(640, 400);
    expect(energy.height).toBeGreaterThanOrEqual(HUD.energy.minHeight);
  });

  it('leaves the middle of the screen free of HUD', () => {
    const layout = hudLayout(1440, 900);
    const middle = { x: 720, y: 450 };
    for (const zone of hudZones(layout)) {
      const inside =
        middle.x >= zone.x &&
        middle.x <= zone.x + zone.width &&
        middle.y >= zone.y &&
        middle.y <= zone.y + zone.height;
      expect(inside).toBe(false);
    }
  });

  it('claims the hotbar and the prompt bar for the HUD', () => {
    const layout = hudLayout(1440, 900);
    const zones = hudZones(layout);
    const covers = (x: number, y: number) =>
      zones.some((z) => x >= z.x && x <= z.x + z.width && y >= z.y && y <= z.y + z.height);

    expect(covers(layout.hotbar.x + 4, layout.hotbar.y)).toBe(true);
    expect(covers(layout.prompt.x + 20, layout.prompt.y + 10)).toBe(true);
    expect(covers(layout.clock.x + 10, layout.clock.y + 10)).toBe(true);
  });
});
