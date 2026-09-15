/**
 * Tests for the quantiser.
 *
 * Idempotency is the load-bearing property. `public/assets/lpc/` is rebuilt
 * from `art/raw/lpc/` on demand, and if a second pass moved pixels again, then
 * "rebuild the art" would not be a safe thing to do twice — every run would
 * drift the game a little further from what anyone approved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { srgbToOklab, distance, nearestIndex } from './lib/colour.mjs';
import { quantise, loadPalette } from './apply-palette.mjs';

function palette(colours) {
  return colours.map((rgb) => ({ ...srgbToOklab(...rgb), rgb }));
}

function image(pixels) {
  return { width: pixels.length / 4, height: 1, pixels: Uint8Array.from(pixels) };
}

const SOIL = palette([[125, 86, 51], [74, 122, 48], [255, 255, 255], [0, 0, 0]]);

test('an off-palette colour snaps to the nearest entry', () => {
  const out = quantise(image([123, 84, 49, 255]), SOIL);
  assert.deepEqual([...out.pixels], [125, 86, 51, 255]);
});

test('a colour already on the palette does not move', () => {
  const out = quantise(image([74, 122, 48, 255]), SOIL);
  assert.deepEqual([...out.pixels], [74, 122, 48, 255]);
});

test('quantising twice changes nothing the second time', () => {
  const once = quantise(image([123, 84, 49, 255, 70, 118, 45, 200]), SOIL);
  const twice = quantise(once, SOIL);
  assert.deepEqual([...twice.pixels], [...once.pixels]);
});

test('alpha passes through untouched', () => {
  // tree.png is 2.9% semi-transparent and grass-tuft.png 10.8%. Snapping alpha
  // would harden every soft edge in the game.
  const out = quantise(image([123, 84, 49, 137]), SOIL);
  assert.equal(out.pixels[3], 137);
});

test('a fully transparent pixel keeps its rgb and its alpha', () => {
  // Below the alpha floor nothing is visible, so moving the rgb would only
  // churn the file on disk for no visible gain.
  const out = quantise(image([9, 9, 9, 0]), SOIL);
  assert.deepEqual([...out.pixels], [9, 9, 9, 0]);
});

test('dimensions survive', () => {
  const out = quantise(image([1, 2, 3, 255, 4, 5, 6, 255]), SOIL);
  assert.equal(out.width, 2);
  assert.equal(out.height, 1);
});

// Idempotency (above) holds only because every palette entry's own nearest
// neighbour is itself. That is true precisely when the palette has no two
// entries closer to each other than to some third colour that would win
// instead — in the simplest and only case that matters here, no two entries
// occupying the exact same point in OkLab. A duplicate would make quantise
// pick whichever of the two sorts first as "nearest" to the other, which is
// still stable under a second pass, but it would silently waste one of the
// 48 slots the palette is supposed to be spending on distinct colours. This
// test fails loudly instead of letting that slip in unnoticed.
test('the real palette has no duplicate entries, which is what makes every colour its own nearest neighbour', () => {
  const real = loadPalette();
  for (let i = 0; i < real.length; i += 1) {
    for (let j = i + 1; j < real.length; j += 1) {
      assert.notEqual(
        distance(real[i], real[j]),
        0,
        `palette entries ${i} and ${j} are identical colours (${real[i].rgb} / ${real[j].rgb})`,
      );
    }
  }
});

test('every palette colour is its own nearest match, which is exactly what idempotency requires', () => {
  const real = loadPalette();
  for (let i = 0; i < real.length; i += 1) {
    assert.equal(
      nearestIndex(real[i], real),
      i,
      `palette entry ${i} (${real[i].rgb}) is not its own nearest neighbour`,
    );
  }
});
