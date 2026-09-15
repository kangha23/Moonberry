/**
 * Tests for the quantiser.
 *
 * Idempotency is the load-bearing property. `public/assets/lpc/` is rebuilt
 * from `art/raw/lpc/` on demand, and if a second pass moved pixels again, then
 * "rebuild the art" would not be a safe thing to do twice — every run would
 * drift the game a little further from what anyone approved.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { srgbToOklab, distance, nearestIndex } from './lib/colour.mjs';
import { quantise, loadPalette, findOrphans, creditsWithNotice } from './apply-palette.mjs';

/** A scratch `art/palette.json`-shaped file, cleaned up by the caller. */
function paletteFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'palette-'));
  const file = path.join(dir, 'palette.json');
  fs.writeFileSync(file, JSON.stringify(contents));
  return file;
}

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

// --- loadPalette validation ---------------------------------------------------
//
// This script rewrites every piece of art in the game from whatever
// loadPalette returns, so a malformed palette.json must fail loudly rather
// than quietly hand back a wrong or short palette. Each malformed case is
// built as a temporary file rather than a fixture committed to the repo,
// since a broken palette.json has no business living in the tree on
// purpose.

test('a well-formed palette loads without error', () => {
  const file = paletteFile({ colours: [{ name: 'outline.0', hex: '#000000', share: 0.5 }] });
  const loaded = loadPalette(file);
  assert.equal(loaded.length, 1);
  assert.deepEqual(loaded[0].rgb, [0, 0, 0]);
});

test('an empty or missing colours array is rejected', () => {
  assert.throws(() => loadPalette(paletteFile({ colours: [] })), /no non-empty "colours" array/);
  assert.throws(() => loadPalette(paletteFile({})), /no non-empty "colours" array/);
});

test('an entry missing a name or a hex is rejected, naming the entry', () => {
  assert.throws(
    () => loadPalette(paletteFile({ colours: [{ hex: '#123456' }] })),
    /entry 0 is missing a "name" or "hex"/,
  );
  assert.throws(
    () => loadPalette(paletteFile({ colours: [{ name: 'a' }] })),
    /entry 0 is missing a "name" or "hex"/,
  );
});

test('a hex missing its # is rejected rather than silently misparsed', () => {
  // Without this check, hex.slice(1) would drop the first hex digit instead
  // of the '#', quietly producing a plausible-but-wrong colour.
  assert.throws(
    () => loadPalette(paletteFile({ colours: [{ name: 'bad', hex: '123456' }] })),
    /entry 0 \("bad"\) has a malformed hex/,
  );
});

test('a hex with non-hex characters is rejected rather than becoming NaN', () => {
  // Without this check, Number.parseInt would return NaN, and nearestIndex's
  // `d < bestDistance` is always false against NaN — so this entry could
  // never be chosen and the palette would silently become one colour short.
  assert.throws(
    () => loadPalette(paletteFile({ colours: [{ name: 'bad', hex: '#zzzzzz' }] })),
    /entry 0 \("bad"\) has a malformed hex/,
  );
});

test('a hex of the wrong length is rejected', () => {
  assert.throws(
    () => loadPalette(paletteFile({ colours: [{ name: 'bad', hex: '#fff' }] })),
    /entry 0 \("bad"\) has a malformed hex/,
  );
});

test('every error message says how to fix it, since the palette is generated', () => {
  assert.throws(() => loadPalette(paletteFile({ colours: [] })), /npm run palette:derive/);
  assert.throws(
    () => loadPalette(paletteFile({ colours: [{ name: 'bad', hex: '#gggggg' }] })),
    /npm run palette:derive/,
  );
});

// --- stale output files --------------------------------------------------------
//
// The CLI must warn about, never delete, a .png in public/assets/lpc/ with no
// source in art/raw/lpc/ — except the nine files generate-plot-art.mjs writes
// there directly, which look exactly like orphans but are not.

test('a png with a matching source is not an orphan', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpc-out-'));
  fs.writeFileSync(path.join(dir, 'tree.png'), 'x');
  const orphans = findOrphans(dir, new Set(['tree.png']));
  assert.deepEqual(orphans, []);
});

test('a png with no source and no known generator is reported as an orphan', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpc-out-'));
  fs.writeFileSync(path.join(dir, 'renamed-tree.png'), 'x');
  const orphans = findOrphans(dir, new Set(['tree.png']));
  assert.deepEqual(orphans, ['renamed-tree.png']);
});

test('the nine plot-art files generate-plot-art.mjs writes are never reported as orphans', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpc-out-'));
  const names = [
    'plot-tilled.png',
    'plot-tilled-2.png',
    'plot-tilled-3.png',
    'plot-watered.png',
    'plot-watered-2.png',
    'plot-watered-3.png',
    'plot-wild.png',
    'plot-wild-2.png',
    'plot-wild-3.png',
  ];
  for (const name of names) fs.writeFileSync(path.join(dir, name), 'x');
  // None of these has a source in art/raw/lpc/ — that is the whole point.
  const orphans = findOrphans(dir, new Set());
  assert.deepEqual(orphans, []);
});

test('a non-png file is never reported as an orphan', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpc-out-'));
  fs.writeFileSync(path.join(dir, 'CREDITS.md'), 'x');
  const orphans = findOrphans(dir, new Set());
  assert.deepEqual(orphans, []);
});

test('a missing output directory has no orphans', () => {
  const missing = path.join(os.tmpdir(), 'lpc-out-does-not-exist');
  assert.deepEqual(findOrphans(missing, new Set()), []);
});

// --- CREDITS.md and the CC-BY-SA modification notice --------------------------
//
// A bare copy of art/raw/lpc/CREDITS.md, once out the door, was silently
// undoing its own licence compliance: a human appended the notice to the
// output by hand, and the very next `palette:apply` run copied the
// un-notated raw file straight back over it. `creditsWithNotice` is built
// fresh from the raw text on every call instead, so the notice appears
// exactly once by construction rather than by a human remembering.

const RAW_CREDITS = 'Some upstream attribution text.\nMore of it here.\n';

test('the notice is appended to the raw credits, which survive in full', () => {
  const out = creditsWithNotice(RAW_CREDITS);
  assert.match(out, /Some upstream attribution text\.\nMore of it here\./);
  assert.match(out, /## Modification notice/);
  // The upstream attributions are the actual licence obligation; the notice
  // is additional, not a replacement.
  assert.equal(out.indexOf('Some upstream attribution text.') < out.indexOf('## Modification notice'), true);
});

test('running the copy step three times leaves exactly one notice', () => {
  // This is what makes running palette:apply three times safe: the CLI
  // calls creditsWithNotice(rawCredits) fresh on every run — it always
  // reads art/raw/lpc/CREDITS.md, never public/assets/lpc/CREDITS.md — so
  // there is no "previous output" for the notice to accumulate onto. Three
  // independent calls on the same raw input must be byte-identical, each
  // with exactly one notice.
  const runs = [creditsWithNotice(RAW_CREDITS), creditsWithNotice(RAW_CREDITS), creditsWithNotice(RAW_CREDITS)];
  for (const out of runs) {
    assert.equal(out.split('## Modification notice').length - 1, 1);
  }
  assert.equal(runs[0], runs[1]);
  assert.equal(runs[1], runs[2]);
});

test('feeding creditsWithNotice its own output does not add a second notice', () => {
  // Belt-and-braces: even if some future caller broke the "always from raw"
  // rule this script relies on, the notice heading must not be able to
  // appear twice in one file.
  const once = creditsWithNotice(RAW_CREDITS);
  const twice = creditsWithNotice(once);
  assert.equal(twice.split('## Modification notice').length - 1, 1);
});

test('the notice names the palette file, the OkLab method, and the rebuild command', () => {
  const out = creditsWithNotice(RAW_CREDITS);
  assert.match(out, /art\/palette\.json/);
  assert.match(out, /OkLab/);
  assert.match(out, /art\/raw\/lpc\//);
  assert.match(out, /npm run palette:apply/);
});
