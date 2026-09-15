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
 */
const SOIL = {
  dry: {
    trough: '#5b3c22',
    low: '#6d4a2b',
    base: '#7d5633',
    high: '#8f6540',
    crown: '#9d7049',
    clod: '#6a4626',
  },
  wet: {
    trough: '#3a2718',
    low: '#48331f',
    base: '#553d27',
    high: '#63492f',
    crown: '#6f5336',
    clod: '#402c1b',
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
  for (let i = 0; i < 7; i += 1) {
    const x = 3 + Math.floor(hash(i, 29, variant) * (TILE - 8));
    const row = Math.floor(hash(i, 41, variant) * 4) * 8;
    for (let k = 0; k < 3; k += 1) image.set(x + k, row, k === 1 ? '#5f8b97' : '#4b6d78');
  }
}

/**
 * Unworked ground that could be worked.
 *
 * It has to say "you may plant here" without saying it forty times in the same
 * voice. Two faults were fixed here rather than one. The version this replaces
 * put an identical leafy clump dead in the centre of every cell, which made a
 * fallow field a pegboard; the first attempt at a fix over-corrected into
 * per-pixel noise, which read as **television static**. Grass is neither. It
 * is patches — so the speckle is computed on a coarse grid and the blades are
 * few, tall and off-centre.
 */
/**
 * Unworked ground that could be worked.
 *
 * Three faults were fixed here rather than one. The version this replaces put
 * an identical leafy clump dead in the centre of every cell, which made a
 * fallow field a pegboard. The first attempt at a fix over-corrected into
 * per-pixel noise, which read as television static. The second fixed that but
 * left the tile the *same green as ordinary grass*, so a player could no
 * longer see which ground was theirs to plant — which traded an ugly
 * affordance for no affordance at all.
 *
 * So this is drier and yellower than the lawn around it, and carries the ghost
 * of an old furrow. The signal lives at the scale of the field rather than of
 * the tile, which is where it belongs.
 */
const WILD = {
  grass: '#6e9a45',
  dark: '#5b8038',
  light: '#8ab857',
  ridge: '#7ba44e',
  furrow: '#5e8639',
  blade: '#46702f',
  bright: '#9ccc63',
  soil: '#8a8244',
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
  image.set(cx, cy + 1, '#6f6a34');
}

/** How many drawings of each. See the note at the top of the file. */
export const PLOT_VARIANTS = 3;

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

main();
