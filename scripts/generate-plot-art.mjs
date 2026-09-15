#!/usr/bin/env node
/**
 * The ground a crop grows in.
 *
 * These five tiles cover most of the screen for most of the game, and the
 * versions they replace had four faults that together made a planted field the
 * ugliest thing in the build:
 *
 *   1. The furrows in the tilled soil were drawn in **green**, so a bed read
 *      as striped cloth, or as grass growing through the plough lines.
 *   2. Every tile carried a light edge down its left and right sides, so a
 *      block of twenty tilled tiles read as twenty separate bricks rather than
 *      as one bed. A seam between furrows has to be *darker* than the soil,
 *      never lighter: dark is a trough, light is a border.
 *   3. There was one drawing of each, so a field was the same 32 pixels
 *      repeated forty times — the wallpaper effect, which the eye picks up
 *      long before it can say why the picture looks cheap.
 *   4. The wild tile put an identical leafy clump dead in the centre of every
 *      cell, which turned an unworked field into a pegboard.
 *
 * So: brown furrows, dark seams, and three variants of each that the scene
 * picks between by tile position. Three is enough — the eye stops finding the
 * period once it is longer than a few tiles — and it costs three small files
 * rather than a tileset nobody has drawn.
 *
 * Generated rather than drawn because the furrows have to line up across a tile
 * boundary to the pixel. That is arithmetic, and arithmetic belongs in a script
 * that can be re-run rather than in somebody's steady hand.
 *
 * Run: npm run generate:plots
 */
import fs from 'node:fs';
import path from 'node:path';
import { encodePng, raster } from './lib/png.mjs';
import { PALETTE } from './lib/palette-data.mjs';

const OUT_DIR = path.join('public', 'assets', 'lpc');
const TILE = 32;

/** Deterministic noise, so the grain is the same on every run and in git. */
function hash(x, y, seed = 1) {
  let h = (x * 374761393 + y * 668265263 + seed * 974634211) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/**
 * Soil, in the two states a plot can be in.
 *
 * Four furrows, eight pixels apart, measured from the top of the tile — so the
 * rows line up across a vertical join and a bed four tiles deep reads as
 * sixteen continuous furrows rather than as four tiles of four.
 *
 * Nothing is drawn at the tile's edge. That is the whole of fault 2: the
 * lightest thing in the tile is the crown of a ridge in the middle of it, and
 * the darkest is the trough — so where two tiles meet, two troughs meet, and
 * the join disappears into a furrow instead of announcing itself.
 *
 * The tones are no longer written here. They are ramp positions in
 * `art/palette.json`, so the furrows in a field are the same browns as the
 * planks on the farmhouse and the trunk of a tree, and a change to the ramp
 * moves all three together.
 *
 * `art/palette.json` carries a `soil` group of 7 entries, `soil.0`–`soil.6`
 * ascending in lightness, PINNED rather than clustered: they are the exact
 * seven hexes this table's own dry and wet tones reduce to under
 * maximum-spacing subset selection, recovered from the pre-migration source
 * rather than approximated. That makes this the rare case where nearest
 * colour and hand-tuned colour are the same thing — dry's five tones
 * (`trough`…`crown`) land on `soil.2`–`soil.6` at distances of 0 to 0.02, and
 * wet's five land on `soil.0`–`soil.4` at 0 to 0.028, both computed and
 * checked against `art/palette.json` rather than assumed. The two ramps
 * overlap at `soil.2`/`soil.3`/`soil.4` — dry's `trough`/`low`/`base` are
 * wet's `base`/`high`/`crown` — which is exactly why the group was sized at
 * 7 rather than 10: a five-tone gradient each way, sharing the three tones
 * in the middle, needs no more. `clod` reuses each ramp's `low` entry
 * (mechanically nearest for both dry and wet) rather than taking a sixth
 * slot, since a speckle is not a gradient step.
 *
 * An earlier version of this table used nearest-colour to spread six tones
 * per ramp across a smaller, unpinned palette, found that most of them
 * collapsed onto the same 2-3 entries, and switched to hand-picking distinct
 * entries by lightness instead, accepting worse per-colour distance to keep
 * the gradient readable. That trade is gone along with the palette that
 * forced it: with the real tones present, nearest-colour is correct again,
 * and a comment explaining why to avoid it would now be describing a
 * technique this file no longer uses.
 */
const SOIL = {
  dry: {
    trough: PALETTE['soil.2'],
    low: PALETTE['soil.3'],
    base: PALETTE['soil.4'],
    high: PALETTE['soil.5'],
    crown: PALETTE['soil.6'],
    clod: PALETTE['soil.3'],
  },
  wet: {
    trough: PALETTE['soil.0'],
    low: PALETTE['soil.1'],
    base: PALETTE['soil.2'],
    high: PALETTE['soil.3'],
    crown: PALETTE['soil.4'],
    clod: PALETTE['soil.0'],
  },
};

/**
 * One furrow, top to bottom, as five tones over eight rows.
 *
 * A gradient rather than hard bands, because the first attempt at this drew
 * each row a flat colour and the result read as a **brick wall** — regular
 * horizontal courses with regular breaks in them. What makes a ploughed field
 * look ploughed is a soft shoulder rising out of a sharp trough, so the only
 * hard edge in the profile is the one at the bottom of the furrow.
 */
const PROFILE = ['trough', 'low', 'base', 'high', 'crown', 'high', 'base', 'low'];

function drawSoil(image, wet, variant) {
  const c = wet ? SOIL.wet : SOIL.dry;
  for (let x = 0; x < TILE; x += 1) {
    // The furrow wanders by up to a pixel across the tile, so the rows are not
    // ruled lines. A wave rather than noise: noise per pixel is what produced
    // the mortar-and-brick look, and a hand-dug furrow wanders slowly.
    //
    // Two things about this wave are load-bearing. Its period divides 32
    // exactly, so it closes at the tile edge and a bed reads across a vertical
    // join without a seam. And it is the *same* wave in all three variants,
    // for the same reason: two neighbouring tiles are usually different
    // variants, and furrows that met at slightly different heights would draw
    // the tile grid straight back onto the field the variants exist to hide.
    const wave = Math.round(Math.sin((x * Math.PI * 2 * 2) / TILE) * 0.7);
    for (let y = 0; y < TILE; y += 1) {
      // Modulo on the *unshifted* row, so the cycle still lines up across a
      // vertical join and a four-tile bed is sixteen continuous furrows.
      const phase = ((y + wave) % 8 + 8) % 8;
      image.set(x, y, c[PROFILE[phase]]);
    }
  }

  // Clods, and few of them. Sitting on the shoulder of a ridge rather than in
  // the trough, because that is where turned earth actually ends up.
  for (let i = 0; i < 5; i += 1) {
    const x = 2 + Math.floor(hash(i, 3, variant) * (TILE - 5));
    const y = 2 + Math.floor(hash(i, 17, variant) * (TILE - 5));
    if (y % 8 < 2) continue;
    image.set(x, y, c.clod);
    image.set(x + 1, y, c.clod);
    image.set(x, y + 1, c.trough);
  }

  if (!wet) return;
  // Water lying in the troughs, which is what tells a watered bed from a dry
  // one across a field. In the furrow, never on the crown — water runs down.
  //
  // Neither of these two is nearest to anything in the `water` group: the
  // highlight is closest to `leaf.3`, a muted teal, and the shadow beside it
  // to `building.0`, a grey-purple the farmhouse walls also use. Both sit a
  // little past the 0.05 OkLab flag threshold (0.056 either way). A muted
  // teal-grey puddle glint is not a colour this palette's `water` group
  // actually carries — its four entries are all far more saturated blues and
  // purples than a small still puddle would show — but the nearest entries
  // outside that group are still cool-toned, so the pixels read as a wet
  // glint rather than as an obviously wrong hue.
  const PUDDLE_HIGHLIGHT = PALETTE['leaf.3'];
  const PUDDLE_SHADOW = PALETTE['building.0'];
  for (let i = 0; i < 7; i += 1) {
    const x = 3 + Math.floor(hash(i, 29, variant) * (TILE - 8));
    const row = Math.floor(hash(i, 41, variant) * 4) * 8;
    for (let k = 0; k < 3; k += 1) {
      image.set(x + k, row, k === 1 ? PUDDLE_HIGHLIGHT : PUDDLE_SHADOW);
    }
  }
}

/**
 * Unworked ground that could be worked.
 *
 * It has to say "you may plant here" without saying it forty times in the same
 * voice. Three faults were fixed here, in order: an identical leafy clump
 * dead in the centre of every cell, which made a fallow field a pegboard;
 * the first fix over-correcting into per-pixel noise, which read as
 * **television static**; and the second fix leaving the tile the *same
 * green as ordinary grass*, so a player could no longer see which ground was
 * theirs to plant. So this is drier and yellower than the lawn around it,
 * carries the ghost of an old furrow, and the speckle is computed on a
 * coarse grid with a few tall, off-centre blades rather than per-pixel noise.
 *
 * Every tone is a lookup into `art/palette.json`, named for the nearest
 * palette entry to the hand-picked colour this table used to hold. `grass`
 * and `ridge` both land on `light.0`, and `dark` and `furrow` both land on
 * `leaf.1` — the ridge band meant to sit a shade lighter than the grass
 * around it, and the furrow band meant to sit a shade darker than the dark
 * speckle, both collapse onto the tone next to them, so the ghost furrow's
 * lit shoulder is invisible and only its dark trough side still reads. That
 * is this palette not carrying separate entries for those two pairs, not a
 * bug in the lookup, and it was not part of what this round of the migration
 * was asked to fix.
 *
 * `bright` — the highlight on each grass blade — is the one entry NOT taken
 * from its unrestricted nearest neighbour. That neighbour is `light.6`
 * (`#acbfb0`), a pale sage-grey with almost no chroma; the `light` group is
 * a catch-all for "the light end of several materials at once" (skin, pale
 * foliage, cream — see its note in `art/palette.json`) and for this one tone
 * the catch-all's nearest match is a cream, not a foliage green. That is the
 * same class of mistake an earlier version of this table made by pinning
 * `bright` to a literal skin tone: technically closest in OkLab, visibly
 * wrong on grass. So `bright` is pinned instead to `leaf.2`, the brightest,
 * most saturated entry in `leaf` or `foliage` — a deliberately worse OkLab
 * match (0.168 against 0.118) for a hue that actually reads as a lit blade
 * tip rather than a grey smudge.
 */
const WILD = {
  grass: PALETTE['light.0'],
  dark: PALETTE['leaf.1'],
  light: PALETTE['light.1'],
  ridge: PALETTE['light.0'],
  furrow: PALETTE['leaf.1'],
  blade: PALETTE['leaf.0'],
  bright: PALETTE['leaf.2'],
  soil: PALETTE['soil.6'],
  // The darker fleck beside a turned clod, previously its own literal.
  // Nearest is `soil.5` at d=0.060.
  soilShade: PALETTE['soil.5'],
};

function drawWild(image, variant) {
  for (let y = 0; y < TILE; y += 1) {
    // The ghost of an old furrow, on the same eight-pixel rhythm the tilled
    // soil uses. This is what tells a player which ground is theirs to work,
    // and it does it without a motif stamped on every tile: a *field* of it
    // reads as ridged ground gone fallow, and the moment a hoe touches it the
    // ghost ridges become real ones in exactly the same places.
    const phase = y % 8;
    const band = phase === 0 || phase === 7 ? 'furrow' : phase === 4 ? 'ridge' : null;
    for (let x = 0; x < TILE; x += 1) {
      // Coarse: one draw per 2x2 block, so the grain is patches of grass
      // rather than a snowstorm.
      const n = hash(x >> 1, y >> 1, variant + 5);
      let colour = n > 0.86 ? WILD.light : n < 0.14 ? WILD.dark : WILD.grass;
      if (band && n > 0.2 && n < 0.8) colour = WILD[band];
      image.set(x, y, colour);
    }
  }

  // Three tufts, tall enough to read at a glance and placed off centre.
  for (let i = 0; i < 3; i += 1) {
    const x = 5 + Math.floor(hash(i, 61, variant) * (TILE - 12));
    const y = 8 + Math.floor(hash(i, 83, variant) * (TILE - 18));
    const tall = 5 + Math.floor(hash(i, 97, variant) * 4);
    for (let k = 0; k < tall; k += 1) {
      image.set(x, y + k, WILD.blade);
      image.set(x + 2, y + k + 2, WILD.blade);
      image.set(x + 1, y + k + 1, WILD.bright);
    }
    image.set(x, y - 1, WILD.bright);
    image.set(x + 2, y + 1, WILD.bright);
  }

  // One turned clod, so the tile hints at soil under the grass rather than lawn.
  const cx = 3 + Math.floor(hash(7, 7, variant) * (TILE - 8));
  const cy = 3 + Math.floor(hash(9, 9, variant) * (TILE - 8));
  image.set(cx, cy, WILD.soil);
  image.set(cx + 1, cy, WILD.soil);
  image.set(cx, cy + 1, WILD.soilShade);
}

/** How many drawings of each. See the note at the top of the file. */
export const PLOT_VARIANTS = 3;

/**
 * The three base names this file writes, before the `-2`/`-3` variant suffix.
 *
 * Exported so `apply-palette.mjs`'s orphan check can compute the exact set of
 * filenames this generator owns instead of hand-typing a second copy of this
 * list next to `PLOT_VARIANTS` — see the comment on `GENERATED_PLOT_NAMES`
 * there for why that second copy used to exist.
 */
export const PLOT_BASE_NAMES = ['plot-tilled', 'plot-watered', 'plot-wild'];

function write(name, draw) {
  const image = raster(TILE, TILE);
  draw(image);
  const file = path.join(OUT_DIR, `${name}.png`);
  fs.writeFileSync(file, encodePng(TILE, TILE, image.pixels));
  return file;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const written = [];
  for (let v = 0; v < PLOT_VARIANTS; v += 1) {
    // The first variant keeps the plain name, because that is what every
    // existing loader, test and map already asks for.
    const suffix = v === 0 ? '' : `-${v + 1}`;
    written.push(write(`plot-tilled${suffix}`, (image) => drawSoil(image, false, v)));
    written.push(write(`plot-watered${suffix}`, (image) => drawSoil(image, true, v)));
    written.push(write(`plot-wild${suffix}`, (image) => drawWild(image, v)));
  }
  for (const file of written) process.stdout.write(`${file}\n`);
}

// Guarded, like the repo's other generator scripts, so a test can `import`
// this module and get a plain module — its exports, its source text for
// inspection — rather than a side effect that writes nine PNGs to disk.
// Before this guard existed, nothing *could* import the file, which is also
// why nothing noticed when a palette re-derivation quietly orphaned 14 of
// the 17 `PALETTE[...]` names below: the only way to exercise this file was
// to run it and look at the PNGs it wrote, and 835 passing tests never did
// that. See `generate-plot-art.test.mjs` for the check that now would.
if (process.argv[1] && process.argv[1].endsWith('generate-plot-art.mjs')) {
  main();
}
