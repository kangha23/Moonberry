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
 * How many colour groups the art is split into before fine clustering.
 *
 * Eleven because that is roughly how many distinguishable colour families a
 * small pixel-art game has — ground, foliage, wood, water, skin, cloth, metal,
 * and a few accents. The number is a judgement; where the eleven *sit* is not,
 * and that is the whole change from the first attempt.
 */
const GROUPS = 11;

/** Entries in the finished palette. */
const TOTAL = 48;

/** The fewest entries any group gets, however little of the art it covers. */
const MIN_STEPS = 3;

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
 * Splits `total` entries across groups by how much of the art each covers.
 *
 * Largest-remainder, so the parts sum to exactly `total` rather than to
 * whatever rounding happens to leave. The floor matters as much as the
 * proportion: a group holding two percent of the pixels still needs enough
 * steps to read as a ramp rather than as three unrelated colours.
 */
export function allocate(weights, total = TOTAL, floor = MIN_STEPS) {
  const spare = total - floor * weights.length;
  if (spare < 0) {
    throw new Error(`${weights.length} groups do not fit in ${total} at a floor of ${floor}`);
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (spare * w) / sum);
  const counts = exact.map((e) => Math.floor(e));
  const short = spare - counts.reduce((a, b) => a + b, 0);
  const byRemainder = exact
    .map((e, i) => ({ i, fraction: e - Math.floor(e) }))
    .sort((p, q) => q.fraction - p.fraction || p.i - q.i);
  for (let k = 0; k < short; k += 1) counts[byRemainder[k].i] += 1;
  return counts.map((c) => c + floor);
}

/**
 * A provisional name for a group, from where it actually sits in OkLab.
 *
 * Descriptive, not semantic — `warmDark` claims only what can be measured,
 * where `wood` claims a meaning no measurement supports. The first attempt at
 * this file named groups semantically from anchors chosen by hand, and the
 * names came out lying: a bucket called `accent.sky` held orange, because
 * nothing had checked that the art contained a sky blue at all.
 *
 * A human replaces these with semantic names in the next task, once there is a
 * swatch sheet to look at. Until then the names are honest about being guesses.
 */
export function familyName({ L, a, b }) {
  const tone = L < 0.35 ? 'Dark' : L < 0.62 ? 'Mid' : 'Light';
  if (Math.hypot(a, b) < 0.035) return `neutral${tone}`;
  const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  const families = [
    [20, 'red'], [50, 'orange'], [95, 'yellow'], [160, 'green'],
    [200, 'teal'], [260, 'blue'], [320, 'purple'], [360, 'red'],
  ];
  return `${families.find(([limit]) => hue < limit)[1]}${tone}`;
}

/** Two groups can land in the same family; names still have to be unique. */
function uniqueNames(names) {
  const seen = new Map();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name}${count}`;
  });
}

/**
 * Points to a named palette, with the groups taken from the art.
 *
 * Two passes. The coarse one asks the art where its colours actually are — a
 * weighted k-means for `GROUPS` centroids, which become the bucket centres.
 * The fine one clusters within each bucket at the size `allocate` gave it.
 *
 * The first version of this function planted eleven anchors by hand and
 * assigned pixels to the nearest one. Measured against the real art, one
 * anchor — a dark desaturated brown called `wood` — turned out to be nearest
 * to *everything dark* and swallowed 104 of 299 colours and 49% of all pixels,
 * while `accent` held 0.52% of the pixels and was handed the largest ramp.
 * Anchors drawn from the data cannot fail that way: a catch-all region is
 * exactly what a k-means centroid splits.
 */
export function derive(points) {
  const anchors = kmeans(points, GROUPS, SEED);

  const buckets = anchors.map(() => []);
  const weights = anchors.map(() => 0);
  for (const point of points) {
    const index = nearestIndex(point, anchors);
    buckets[index].push(point);
    weights[index] += point.weight;
  }

  const sizes = allocate(weights);
  const names = uniqueNames(anchors.map(familyName));

  const palette = [];
  anchors.forEach((_, index) => {
    const centroids = kmeans(buckets[index], sizes[index], SEED + index + 1);
    for (let step = 0; step < sizes[index]; step += 1) {
      const centroid = centroids[Math.min(step, centroids.length - 1)];
      palette.push({
        name: `${names[index]}.${step}`,
        hex: centroid ? hex(oklabToSrgb(centroid)) : hex([0, 0, 0]),
        share: Number((weights[index] / points.reduce((s, p) => s + p.weight, 0)).toFixed(4)),
      });
    }
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
