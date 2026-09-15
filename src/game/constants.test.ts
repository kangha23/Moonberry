import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_VIEW_HEIGHT, MIN_VIEW_WIDTH, zoomFor } from './constants';

/**
 * The one testable thing in the framing work.
 *
 * Everything else about how the game looks is a matter for eyes. This is
 * arithmetic, and getting it wrong is either a blank screen or a shimmering
 * one, so it is worth pinning down.
 */
describe('zoomFor', () => {
  it('always returns a whole number', () => {
    for (let width = 320; width <= 3840; width += 37) {
      for (let height = 240; height <= 2160; height += 53) {
        expect(Number.isInteger(zoomFor(width, height))).toBe(true);
      }
    }
  });

  it('stays between 1 and the cap, whatever it is handed', () => {
    const sizes: Array<[number, number]> = [
      [0, 0],
      [1, 1],
      [-100, -100],
      [320, 240],
      [1366, 768],
      [1440, 900],
      [1920, 1080],
      [7680, 4320],
      [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ];
    for (const [width, height] of sizes) {
      const zoom = zoomFor(width, height);
      expect(zoom).toBeGreaterThanOrEqual(1);
      expect(zoom).toBeLessThanOrEqual(MAX_ZOOM);
    }
  });

  it('never returns zero, even mid-drag when the window is a sliver', () => {
    expect(zoomFor(0, 0)).toBe(1);
    expect(zoomFor(2, 800)).toBe(1);
    expect(zoomFor(800, 2)).toBe(1);
    expect(zoomFor(Number.NaN, Number.NaN)).toBe(1);
  });

  it('takes the tighter of the two axes', () => {
    // Wide and short: the height decides, and one screen of height is one zoom.
    expect(zoomFor(MIN_VIEW_WIDTH * 4, MIN_VIEW_HEIGHT)).toBe(1);
    expect(zoomFor(MIN_VIEW_WIDTH, MIN_VIEW_HEIGHT * 4)).toBe(1);
  });

  it('shows at least the minimum view at every size', () => {
    for (const [width, height] of [
      [640, 400],
      [1024, 640],
      [1366, 768],
      [1440, 900],
      [1920, 1080],
      [2560, 1440],
    ] as Array<[number, number]>) {
      const zoom = zoomFor(width, height);
      expect(width / zoom).toBeGreaterThanOrEqual(MIN_VIEW_WIDTH);
      expect(height / zoom).toBeGreaterThanOrEqual(MIN_VIEW_HEIGHT);
    }
  });

  it('doubles once the window has room for twice the minimum view', () => {
    expect(zoomFor(1280, 800)).toBe(2);
    expect(zoomFor(1279, 800)).toBe(1);
    expect(zoomFor(1280, 799)).toBe(1);
    expect(zoomFor(2560, 1600)).toBe(4);
  });
});
