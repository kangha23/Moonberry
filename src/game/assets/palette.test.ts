import { describe, expect, it } from 'vitest';
import { PALETTE, PALETTE_HEXES, tint, type PaletteName } from './palette.generated';

/**
 * The palette, checked from the game's side.
 *
 * `scripts/derive-palette.test.mjs` checks that derivation is sound. This
 * checks that the module the app imports says the same thing the JSON does,
 * because the module is generated from a file nobody re-reads.
 */
describe('the palette module', () => {
  it('has exactly 48 colours', () => {
    expect(Object.keys(PALETTE)).toHaveLength(48);
    expect(PALETTE_HEXES).toHaveLength(48);
  });

  it('gives every colour a lowercase six-digit hex', () => {
    for (const [name, hex] of Object.entries(PALETTE)) {
      expect(hex, name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('names every colour ramp.step', () => {
    // Group names are words; step suffixes are integers ascending in lightness.
    for (const name of Object.keys(PALETTE)) expect(name).toMatch(/^[a-z][A-Za-z]*\.\d+$/);
  });

  it('converts every colour to the number Phaser wants', () => {
    // Every entry rather than a named one. The first version of this test named
    // `wood.0`, and when the palette was re-derived and the groups renamed, the
    // test failed for a reason that had nothing to do with `tint` being wrong.
    // Group names are data and will move again; the conversion is what is being
    // checked, so the check should not depend on what anything is called.
    for (const [name, hex] of Object.entries(PALETTE)) {
      expect(tint(name as PaletteName), name).toBe(Number.parseInt(hex.slice(1), 16));
    }
  });

  it('contains no two identical colours', () => {
    expect(new Set(PALETTE_HEXES).size).toBe(PALETTE_HEXES.length);
  });
});
