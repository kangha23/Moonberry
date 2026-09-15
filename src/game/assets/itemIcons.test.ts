import { describe, expect, it } from 'vitest';
import { CROP_ORDER, seedIdFor } from '../systems/items';
import { ITEM_ICONS } from './itemIcons';
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
