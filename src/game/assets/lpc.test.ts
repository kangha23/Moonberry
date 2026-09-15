import { describe, expect, it } from 'vitest';
import { LPC_CROPS, LPC_IMAGES, LPC_SHEETS } from './lpc.generated';
import { NPCS } from '../npcs/definitions';
import { CROP_ORDER } from '../systems/items';

/**
 * The art folder, checked from the game's side.
 *
 * `scripts/lib/png.test.mjs` checks that the files decode and are the right
 * shape. This checks the other half — that the generated manifest still says
 * something the game can use — because the manifest is written by a script
 * from a directory listing, and a directory listing is the one input nobody
 * reviews.
 */
describe('the LPC manifest', () => {
  it('names only crops the game actually grows', () => {
    for (const crop of LPC_CROPS) {
      expect(CROP_ORDER, `crop-${crop}.png has no crop to belong to`).toContain(crop);
    }
  });

  it('keeps the sprout stage every crop shares', () => {
    // This one is not optional the way a ripe crop is: the sprout is drawn for
    // all thirteen crops, so losing it is thirteen regressions rather than one.
    //
    // `crop-seeded` is deliberately absent. The LPC set has no "just sown"
    // frame, and its nearest neighbour — a mound of turned soil — read as a
    // hole once it sat on `plot-tilled`, so that stage falls through to the
    // generated specks in `createPixelArtTextures`, which are drawn at native
    // 32px and therefore cost nothing in consistency.
    expect(LPC_IMAGES.map(([key]) => key)).toContain('crop-sprout');
  });

  it('asks for each texture once, at the url its name implies', () => {
    const keys = LPC_IMAGES.map(([key]) => key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [key, url] of LPC_IMAGES) {
      expect(url).toBe(`/assets/lpc/${key}.png`);
    }
  });

  it('keeps walk sheets out of the plain image list', () => {
    // They load as spritesheets with a frame size. Loading one as a flat image
    // as well would silently win the texture key and freeze everybody who uses
    // it on frame zero.
    for (const [key] of LPC_IMAGES) {
      expect(key.endsWith('-sheet')).toBe(false);
    }
  });

  it('gives every villager a walk sheet that is really there', () => {
    for (const npc of Object.values(NPCS)) {
      expect(LPC_SHEETS, `${npc.id} walks on ${npc.sheet}`).toContain(npc.sheet);
    }
  });

  it('leaves a villager on a borrowed sheet tinted, and one on their own sheet plain', () => {
    // Four of the five are recoloured from two sheets, which is the honest
    // arrangement until somebody exports five. The rule that has to hold is
    // the other way round: a villager with an untinted sprite must not be
    // sharing, or two people walk around as the same person.
    const owners = new Map<string, string[]>();
    for (const npc of Object.values(NPCS)) {
      if (npc.tint !== 0xffffff) continue;
      owners.set(npc.sheet, [...(owners.get(npc.sheet) ?? []), npc.id]);
    }
    for (const [sheet, ids] of owners) {
      expect(ids, `${ids.join(' and ')} are both untinted on ${sheet}`).toHaveLength(1);
    }
  });
});
