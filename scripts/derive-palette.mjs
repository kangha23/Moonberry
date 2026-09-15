#!/usr/bin/env node
/**
 * Builds the palette the whole game draws from.
 *
 * The palette is derived from the art already in `art/raw/` rather than taken
 * off the shelf, and that is deliberate. A ready-made palette such as DB32 is
 * better designed than anything k-means will find, but adopting one moves
 * every hand-drawn sprite somewhere new. Deriving from the art the game ships
 * means the generated tiles move toward the characters instead — the tiles are
 * the part nobody drew, so they are the part that should give way.
 *
 * Run: npm run palette:derive
 *
 * This is not a CI step. It writes `art/palette.json`, which is committed and
 * reviewed by a human, and re-running it is a deliberate act.
 */
import fs from 'node:fs';
import path from 'node:path';
import { kmeans, nearestIndex, oklabToSrgb, srgbToOklab } from './lib/colour.mjs';
import { decodePng } from './lib/png.mjs';

const RAW_DIR = path.join('art', 'raw');
const OUT_FILE = path.join('art', 'palette.json');
const SEED = 20260915;

/**
 * The ramps, their sizes, and the colour each one claims territory around.
 *
 * An anchor is not a palette entry — it is a flag planted in OkLab space that
 * says "pixels nearest here are soil". Every pixel in the art is assigned to
 * the nearest anchor, then k-means runs inside each bucket at that ramp's
 * size. That is what makes the output both exactly 48 and namable: a global
 * k-means gives 48 anonymous centroids and no way to say which is soil.
 *
 * The anchors for soil, wood and skin are deliberately separated in lightness
 * as well as hue. All three are brown, and anchors that differed only in hue
 * would let one bucket swallow another's pixels.
 */
export const RAMPS = [
  { name: 'soil', anchor: [125, 86, 51], steps: ['trough', 'low', 'base', 'high', 'crown'] },
  { name: 'grass', anchor: [74, 122, 48], steps: ['deep', 'shade', 'base', 'lit', 'bleached'] },
  { name: 'foliage', anchor: [47, 82, 35], steps: ['deep', 'shade', 'base', 'lit'] },
  { name: 'wood', anchor: [78, 53, 36], steps: ['deep', 'shade', 'base', 'lit'] },
  { name: 'stone', anchor: [138, 138, 146], steps: ['deep', 'shade', 'base', 'lit'] },
  { name: 'water', anchor: [60, 110, 160], steps: ['deep', 'shade', 'base', 'lit'] },
  { name: 'skin', anchor: [224, 168, 120], steps: ['deep', 'shade', 'base', 'lit'] },
  { name: 'clothWarm', anchor: [190, 90, 60], steps: ['deep', 'shade', 'base', 'lit'] },
  { name: 'clothCool', anchor: [80, 90, 150], steps: ['deep', 'shade', 'base', 'lit'] },
  { name: 'metal', anchor: [200, 204, 212], steps: ['deep', 'shade', 'base', 'lit'] },
  { name: 'accent', anchor: [220, 180, 70], steps: ['gold', 'berry', 'bloom', 'sky', 'ember', 'bone'] },
];

function hex([r, g, b]) {
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Every opaque colour in a folder tree, with the number of pixels using it.
 *
 * A histogram rather than a pixel list because the art is ~60k pixels and only
 * ~320 distinct colours: clustering the distinct colours with their counts as
 * weights is the same computation, three orders of magnitude cheaper.
 *
 * Pixels below alpha 8 are skipped entirely. A fully transparent pixel still
 * carries RGB in the file — usually black — and counting it would hand a
 * palette entry to a colour nobody has ever seen.
 */
export function histogram(dir) {
  const counts = new Map();
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.png')) {
        const { width, height, pixels } = decodePng(fs.readFileSync(full));
        for (let i = 0; i < width * height; i += 1) {
          if (pixels[i * 4 + 3] < 8) continue;
          const key = (pixels[i * 4] << 16) | (pixels[i * 4 + 1] << 8) | pixels[i * 4 + 2];
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
    }
  };
  walk(dir);

  return [...counts.entries()].map(([key, weight]) => ({
    ...srgbToOklab((key >> 16) & 255, (key >> 8) & 255, key & 255),
    weight,
  }));
}

/**
 * Points to a named palette: bucket by anchor, cluster inside each bucket.
 *
 * A bucket can come out smaller than its ramp — the art may simply contain
 * fewer than four distinct purples. `kmeans` returns what it has in that case,
 * and the shortfall is padded by repeating the lightest entry, so the ramp
 * keeps its declared length and downstream code can rely on `soil.crown`
 * existing. A padded ramp is visible in the JSON as duplicate hex values,
 * which is the signal for a human to pick something better by hand.
 */
export function derive(points) {
  const anchors = RAMPS.map((ramp) => srgbToOklab(...ramp.anchor));
  const buckets = RAMPS.map(() => []);
  for (const point of points) buckets[nearestIndex(point, anchors)].push(point);

  const palette = [];
  RAMPS.forEach((ramp, index) => {
    const centroids = kmeans(buckets[index], ramp.steps.length, SEED + index);
    ramp.steps.forEach((step, position) => {
      const centroid = centroids[Math.min(position, centroids.length - 1)];
      palette.push({
        name: `${ramp.name}.${step}`,
        hex: centroid ? hex(oklabToSrgb(centroid)) : hex(ramp.anchor),
      });
    });
  });
  return palette;
}

// --- CLI ---------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('derive-palette.mjs')) {
  const points = histogram(RAW_DIR);
  const colours = derive(points);
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(
    OUT_FILE,
    `${JSON.stringify({ generated: new Date().toISOString(), colours }, null, 2)}\n`,
  );
  console.log(`wrote ${OUT_FILE} — ${colours.length} colours from ${points.length} distinct`);

  const duplicates = colours.filter((c, i) => colours.findIndex((o) => o.hex === c.hex) !== i);
  if (duplicates.length > 0) {
    console.warn(`\n${duplicates.length} padded entries — pick these by hand:`);
    for (const d of duplicates) console.warn(`  ${d.name}  ${d.hex}`);
  }
}
