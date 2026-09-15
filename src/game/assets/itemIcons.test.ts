import { describe, expect, it } from 'vitest';
import { CROP_ORDER, FORAGE_DEFS, seedIdFor } from '../systems/items';
import { CROP_PALETTES, ITEM_ICONS, foragePalette } from './itemIcons';
import { PALETTE } from './palette.generated';

/**
 * The seed packet guard.
 *
 * `seedPacket(accent)` draws a fixed envelope with one rect — the window —
 * left free for the crop's own colour. If that colour is left unset (or
 * happens to match another crop's), two different items become one icon:
 * a blank envelope, or the same envelope twice. Task 12's audit found both —
 * strawberry and tomato shared `building.3`, clover and melon shared
 * `light.0` — invisible until someone looked at two inventory rows side by
 * side. This is the test that would have caught it.
 */
describe('seed packet icons', () => {
  it('never leaves the accent window matching the envelope body', () => {
    for (const crop of CROP_ORDER) {
      const accent = ITEM_ICONS[seedIdFor(crop)][3][0];
      expect(accent, crop).not.toBe(PALETTE['light.7']);
    }
  });

  it('never draws two crops the same seed packet', () => {
    const seen = new Map<string, string>();
    for (const crop of CROP_ORDER) {
      const icon = JSON.stringify(ITEM_ICONS[seedIdFor(crop)]);
      expect(seen.get(icon), `${crop} matches ${seen.get(icon)}`).toBeUndefined();
      seen.set(icon, crop);
    }
  });
});

/**
 * The flat-produce guard.
 *
 * `produceIcon` draws every form's `light` field as a small highlight strip
 * on top of its `body` fill (see the 'root' case: `[body, ...]` then
 * `[light, ...]` over part of the same rectangle). When a CropPalette sets
 * `light` to the same colour as `body`, that highlight vanishes into the
 * fill it sits on and the crop renders as one flat colour with no shading at
 * all — a defect that is invisible from the data alone unless you actually
 * check `body` against `light`, which is exactly what nobody had done for
 * turnip, wild-daisy or snow-yam (this fix wave found and corrected all
 * three; see the comments on each entry below and in CROP_PALETTES). This
 * test is what would have caught all three at once, and stops a fourth from
 * being added the same way.
 */
describe('produce icon flatness', () => {
  it('never draws a produce icon whose highlight matches its body', () => {
    for (const crop of CROP_ORDER) {
      const palette = CROP_PALETTES[crop];
      expect(palette.light, crop).not.toBe(palette.body);
    }
    for (const forage of FORAGE_DEFS) {
      const palette = foragePalette(forage.id);
      if (!palette) continue;
      expect(palette.light, forage.id).not.toBe(palette.body);
    }
  });
});
