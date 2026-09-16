import { describe, expect, it } from 'vitest';
import { createPixelArtTextures, fringeSpans } from './createPixelArtTextures';
import { fakeScene } from './fakeScene';

/**
 * The fringe geometry, which is what stops a dirt path being a rectangle cut
 * out of a lawn.
 *
 * Tested apart from the painting because jsdom has no 2D canvas context, and
 * because the interesting property here is not a colour: it is that the depth
 * wobbles, that it is the same wobble every boot, and that a mask only ever
 * draws on the sides it names.
 */
describe('fringe spans', () => {
  it('draws nothing for an empty mask', () => {
    expect(fringeSpans(0, 3)).toEqual([]);
  });

  it('stays inside the tile on every mask and seed', () => {
    for (let mask = 1; mask <= 15; mask += 1) {
      for (const seed of [3, 20, 37]) {
        for (const span of fringeSpans(mask, seed)) {
          expect(span.x, `mask ${mask}`).toBeGreaterThanOrEqual(0);
          expect(span.y, `mask ${mask}`).toBeGreaterThanOrEqual(0);
          expect(span.x + span.w, `mask ${mask}`).toBeLessThanOrEqual(32);
          expect(span.y + span.h, `mask ${mask}`).toBeLessThanOrEqual(32);
        }
      }
    }
  });

  it('is the same every time, so a field does not shimmer between boots', () => {
    expect(fringeSpans(7, 3)).toEqual(fringeSpans(7, 3));
  });

  it('gives a different shape to a different seed, so three boundaries do not repeat', () => {
    expect(fringeSpans(15, 3)).not.toEqual(fringeSpans(15, 20));
  });

  it('touches the top edge only when the mask names north', () => {
    const north = (spans: ReturnType<typeof fringeSpans>) => spans.some((span) => span.y === 0);
    expect(north(fringeSpans(1, 3))).toBe(true);
    expect(north(fringeSpans(4, 3))).toBe(false);
  });

  it('wobbles rather than drawing a second straight line beside the first', () => {
    // A fringe of even depth is what the dithering exists to avoid.
    const depths = new Set(
      fringeSpans(1, 3)
        .filter((span) => span.role === 'body' && span.y === 0)
        .map((span) => span.h),
    );
    expect(depths.size).toBeGreaterThan(1);
  });
});

describe('edge textures', () => {
  it('cuts each fringe out of the tile it is made of', () => {
    const fake = fakeScene();
    createPixelArtTextures(fake.scene);

    // The fringe is now the real grass and the real path, sampled. If this
    // stops happening the edges silently go back to being flat colour, which
    // is exactly the regression nobody notices in a diff.
    expect(fake.sampled).toContain('tile-grass');
    expect(fake.sampled).toContain('tile-path');
    expect(fake.drawImageCalls).toBeGreaterThanOrEqual(45);
  });

  it('still builds all 45 overlays, plus 15 for grass over a dug bed', () => {
    const fake = fakeScene();
    createPixelArtTextures(fake.scene);
    const edges = fake.keys.filter((key) => key.startsWith('edge-'));
    expect(edges.length).toBe(60);
    expect(edges.filter((key) => key.startsWith('edge-grass-on-soil-')).length).toBe(15);
  });
});
