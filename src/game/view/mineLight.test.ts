import { describe, expect, it } from 'vitest';
import { MAX_DEPTH } from '../systems/mine';
import { DARKNESS_BOTTOM, DARKNESS_TOP, flicker, lightRadius, mineDarkness } from './mineLight';

describe('mineDarkness', () => {
  it('gets darker every floor, from the top to the bottom, and is never black', () => {
    expect(mineDarkness(1)).toBe(DARKNESS_TOP);
    expect(mineDarkness(MAX_DEPTH)).toBeCloseTo(DARKNESS_BOTTOM);
    for (let depth = 2; depth <= MAX_DEPTH; depth += 1) {
      expect(mineDarkness(depth)).toBeGreaterThan(mineDarkness(depth - 1));
    }
    expect(DARKNESS_BOTTOM).toBeLessThan(1);
    expect(mineDarkness(35)).toBeGreaterThan(mineDarkness(3));
  });

  it('clamps depths outside the mine', () => {
    expect(mineDarkness(0)).toBe(DARKNESS_TOP);
    expect(mineDarkness(99)).toBeCloseTo(DARKNESS_BOTTOM);
  });
});

describe('lightRadius', () => {
  it('lets a torch see further than bare hands', () => {
    expect(lightRadius(true)).toBeGreaterThan(lightRadius(false));
  });

  it('flickers by a few percent at most', () => {
    for (let t = 0; t < 10; t += 0.37) {
      expect(Math.abs(flicker(t) - 1)).toBeLessThanOrEqual(0.05);
    }
  });
});
