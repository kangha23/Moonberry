import { describe, expect, it } from 'vitest';
import { AVATAR_DEPTH_BASE, propDepth } from './shared';

describe('propDepth', () => {
  it('leaves a prop that lies flat at the depth the map gave it', () => {
    expect(propDepth({ y: 320, height: 32, depth: 10 }, 32, 32)).toBe(10);
    expect(propDepth({ y: 320, height: 64, depth: 10 }, 48, 32)).toBe(10);
  });

  it('sorts a prop that stands up with the avatars, by the row its feet are on', () => {
    // A two-tile-square tree at rows 5-6, drawn 90px tall: feet on row 6.
    expect(propDepth({ y: 160, height: 64, depth: 16 }, 90, 32)).toBe(6 + AVATAR_DEPTH_BASE);
  });

  it('puts a rock one row north of the trunk behind the canopy, and a player south of it in front', () => {
    const tree = propDepth({ y: 160, height: 64, depth: 16 }, 90, 32);
    expect(5 + AVATAR_DEPTH_BASE).toBeLessThan(tree);
    expect(7 + AVATAR_DEPTH_BASE).toBeGreaterThan(tree);
  });
});
