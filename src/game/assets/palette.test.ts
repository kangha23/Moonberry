import { describe, expect, it } from 'vitest';
import { PALETTE, PALETTE_HEXES, tint } from './palette.generated';

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

  it('converts a colour to the number Phaser wants', () => {
    expect(tint('wood.0')).toBe(Number.parseInt(PALETTE['wood.0'].slice(1), 16));
  });

  it('contains no two identical colours', () => {
    expect(new Set(PALETTE_HEXES).size).toBe(PALETTE_HEXES.length);
  });
});
