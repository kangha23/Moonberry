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
import {
  distance, hexToOklab, kmeans, nearestIndex, oklabToHex, srgbToOklab, unpackRgb,
} from './lib/colour.mjs';
import { readPaletteFile } from './lib/palette-data.mjs';
import { decodePng } from './lib/png.mjs';

const RAW_DIR = path.join('art', 'raw');
const RAMPS_FILE = path.join('art', 'ramps.json');
const OUT_FILE = path.join('art', 'palette.json');
const SEED = 20260915;

/**
 * How many colour groups the DERIVED half of the art is split into before
 * fine clustering.
 *
 * Was eleven, back when clustering was asked to produce every ramp, soil
 * included. Soil is pinned now (see `pinnedRamp`), so eleven groups over
 * the remaining art spread each group thinner than it needs to be.
 *
 * 9 is not the winner of a metric. Mean per-group spread (each group's own
 * weighted mean distance from its centroid) falls monotonically as the group
 * count rises — more groups always means smaller, tighter groups — so by
 * that measure alone the "best" value is however many groups the budget can
 * afford, and the metric cannot tell 9 from 10 from 20 in any way that
 * matters: it prefers all of them over 9, equally uselessly. 9 was chosen
 * because a human looked at the swatch sheet it produced at 39 and again at
 * 41 derived entries and accepted it — the actual gate this project uses for
 * a judgment call clustering cannot make on its own (see Task 4's naming
 * review). If this number ever needs revisiting, re-run derivation at a few
 * candidate values and look at the output; do not reach for a spread number
 * to justify the choice, because it will always point at "more."
 */
const GROUPS = 9;

/** Entries in the finished palette. */
const TOTAL = 48;

/** The fewest entries any derived group gets, however little art it covers. */
const MIN_STEPS = 3;

/**
 * How close a histogram point has to be to a pinned colour, in OkLab, before
 * it is treated as already served by that colour and dropped from the
 * derived half's input.
 *
 * Without this, the derived clustering has no idea a pinned ramp exists: it
 * independently found real soil-adjacent browns elsewhere in the art (wood,
 * bark) and built a group right on top of `soil`, because nothing told it
 * that territory was already spoken for. 0.030 matches the JND floor this
 * file's own output is held to — a pixel this close to a pinned colour would
 * fail that floor anyway if the derived half spent a second entry on it.
 */
const PIN_EXCLUSION_RADIUS = 0.03;

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
 *
 * `readdirSync` makes no ordering promise — it reflects whatever the
 * filesystem happens to hand back, which can differ by OS or even by run.
 * That would be harmless on its own, except `kmeans`'s k-means++ seeding
 * picks its first centroid *positionally* from the points array, so an
 * unsorted walk quietly makes the palette a function of the machine that
 * built it rather than of the art. Sorting directory entries by name at
 * every level, and sorting the finished histogram by colour key before
 * handing it out, pins that order down at the source. `derive` below sorts
 * its input again for the same reason, so this isn't the only line of
 * defence — but fixing it here as well means a directory walk can never be
 * the thing that introduces the nondeterminism in the first place.
 *
 * `exclude` skips a named subdirectory entirely, wherever it occurs in the
 * walk. The one caller that uses this excludes `art/raw/intent/`: those
 * PNGs exist so `soil` and `soilWet`'s tones vote when this file is read by
 * a human, not so their pixels get counted twice — the pinned ramps already
 * take those exact tones from `art/ramps.json`, so counting them again here
 * would hand the clustering pass credit for colours it did not choose.
 */
export function histogram(dir, { exclude = [] } = {}) {
  const counts = new Map();
  const walk = (current) => {
    const entries = [...fs.readdirSync(current, { withFileTypes: true })].sort((a, b) => (
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    ));
    for (const entry of entries) {
      if (entry.isDirectory() && exclude.includes(entry.name)) continue;
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

  return [...counts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([key, weight]) => ({
      ...srgbToOklab(...unpackRgb(key)),
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

/**
 * `C(n, k)`, the exact count `maxSpacedSubset` would have to visit.
 *
 * Computed the boring iterative way (never build the full numerator/
 * denominator as separate factorials) so it stays exact and doesn't
 * overflow for the modest `n` this is ever called with — the guard below
 * only needs this to be right, not fast.
 */
function combinations(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < Math.min(k, n - k); i += 1) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}

/**
 * The most combinations `maxSpacedSubset` is allowed to walk before it
 * refuses instead of hanging.
 *
 * `C(10, 7)` — soil's own ramp today — is 120. `C(30, 15)`, a ramp merely
 * twice as long picking half its length, is a little over 155 million. There
 * is no rebalancing that saves an exhaustive search from that curve; the
 * only fix is a smaller ramp or a smaller `from` list. Five million is
 * comfortably above every combination this repo's ramps currently need
 * (the largest, `C(10, 7)`, is 120) and comfortably below the point where a
 * `node --test` run would sit unresponsive with no indication why.
 */
const MAX_SPACED_SUBSET_COMBINATIONS = 5_000_000;

/**
 * The size-`count` subset of `points` (any order) whose sorted-by-lightness
 * form has the largest possible minimum gap between neighbours.
 *
 * Exhaustive over every C(points.length, count) combination — a ramp's
 * `from` list is a hand-typed set of a handful to a few dozen tones, not a
 * histogram, so exact search is cheap and there is no reason to settle for
 * an approximation. Ties (more than one subset sharing the best minimum
 * gap) resolve to the combination found first in index order, which is
 * deterministic given a fixed `from` list — the same tiebreak every run.
 *
 * Cheap today is not cheap forever: this is unguarded exhaustive search, and
 * nothing about `art/ramps.json` limits how long a future `from` list or how
 * large a future `steps` could get. Refusing past `MAX_SPACED_SUBSET_
 * COMBINATIONS` turns "the test suite hangs and nobody knows why" into a
 * thrown error naming the exact numbers responsible.
 */
function maxSpacedSubset(points, count) {
  const combinationCount = combinations(points.length, count);
  if (combinationCount > MAX_SPACED_SUBSET_COMBINATIONS) {
    throw new Error(
      `maxSpacedSubset: choosing ${count} of ${points.length} tones is C(${points.length}, ${count}) = ` +
        `${combinationCount} combinations, past the ${MAX_SPACED_SUBSET_COMBINATIONS} sanity limit. ` +
        'Exhaustive search is only appropriate for a hand-typed ramp of a few dozen tones at most — ' +
        'shrink `from` or `steps` in art/ramps.json, or give this function a real approximation.',
    );
  }

  const sorted = [...points].sort((a, b) => a.L - b.L || a.a - b.a || a.b - b.b);
  const indices = sorted.map((_, i) => i);
  let best = null;
  let bestMinGap = -Infinity;
  const combo = [];
  const choose = (start) => {
    if (combo.length === count) {
      let minGap = Infinity;
      for (let i = 1; i < combo.length; i += 1) {
        minGap = Math.min(minGap, distance(sorted[combo[i]], sorted[combo[i - 1]]));
      }
      if (minGap > bestMinGap) {
        bestMinGap = minGap;
        best = [...combo];
      }
      return;
    }
    for (let i = start; i <= indices.length - (count - combo.length); i += 1) {
      combo.push(i);
      choose(i + 1);
      combo.pop();
    }
  };
  choose(0);
  return best.map((i) => sorted[i]);
}

/**
 * Turns a declared ramp's fixed `from` hexes into `steps` entries.
 *
 * Clustering optimises for coverage: it puts a centroid where pixels are
 * dense, which is exactly wrong for a ramp that needs resolution in a narrow
 * band and needs to stay in one hue family. Soil's browns sit perceptually
 * next to wood, skin and bark, so asking the coarse clustering below to find
 * soil on its own let it split the same six tones across three different
 * buckets at every group count from 9 to 15 tried — no allocation rule fixes
 * a conflict of objectives. So soil is not discovered; it is declared, in
 * `art/ramps.json`, and pinned here before the derived half runs at all.
 *
 * Selecting which `steps` of `from` to keep is `maxSpacedSubset`, not
 * `kmeans` — that distinction mattered in practice, not just in theory.
 * `kmeans` minimises within-cluster variance, which is a different target
 * from "keep the sorted output evenly spaced": asked for 7 of `soil`'s 10
 * source tones, it produced a minimum gap of 0.0272, below the 0.030 floor
 * this file's output is held to, even though an exhaustive search over
 * every 7-of-10 subset proved 0.0403 achievable. `kmeans` also averages —
 * a centroid it returns is rarely one of the original tones — which fights
 * the same design choice a second way: these colours were designed, not
 * measured, so blending two of them into a shade nobody drew is not an
 * improvement, it's a fabrication. Keeping the exact subset that maximises
 * spacing serves both problems: the gap the criteria check, and the design
 * intent `pinnedRamp` already existed to protect.
 *
 * `steps` strictly greater than `from.length` throws rather than quietly
 * shipping a ramp shorter than declared. The alternative — falling through
 * to "return everything there is" the way `steps === from.length` already
 * does — reads at a glance like a reasonable degradation, but it isn't: the
 * whole point of pinning is that `from` is the artist's exact tones, not a
 * budget clustering can be trusted to fill in the gaps of. A ramp that is
 * quietly two steps short of what `art/ramps.json` declares is a silent
 * loss of resolution nobody asked for and nothing else in this file would
 * ever catch, because every other test measures spacing and hue, not count.
 */
export function pinnedRamp({ name, steps, from }) {
  if (steps > from.length) {
    throw new Error(
      `pinnedRamp("${name}"): steps (${steps}) exceeds from.length (${from.length}) — ` +
        'a pinned ramp can only select among the tones it was given, never invent extra ones. ' +
        'Lower steps or add more tones to `from` in art/ramps.json.',
    );
  }
  const points = from.map((h) => ({ ...hexToOklab(h), weight: 1 }));
  const chosen = steps === points.length
    ? [...points].sort((a, b) => a.L - b.L || a.a - b.a || a.b - b.b)
    : maxSpacedSubset(points, steps);
  return chosen.map((point, step) => ({
    name: `${name}.${step}`,
    hex: oklabToHex(point),
    // Not a pixel proportion — these colours were declared, not measured, so
    // there is no share of the art to report. 0 says "not applicable" rather
    // than inventing a number the ramp was never given.
    share: 0,
  }));
}

/**
 * Drops any point already served by a pinned colour, before the derived
 * half's clustering ever sees it.
 *
 * This filters `points`, not the finished derived palette, and that
 * direction matters: a centroid computed after the fact, then nudged or
 * discarded because it turned out too close to a pinned colour, is no
 * longer the centroid of anything — it stops meaning "the middle of this
 * bucket's pixels" and starts meaning "the middle of this bucket's pixels,
 * except we changed our mind afterwards." Removing the pixels first means
 * every centroid the derived half produces is still an honest centroid of
 * whatever pixels remain.
 */
export function excludeNearPinned(points, pinned, radius = PIN_EXCLUSION_RADIUS) {
  const pinnedLab = pinned.map((entry) => hexToOklab(entry.hex));
  return points.filter((point) => !pinnedLab.some((pin) => distance(point, pin) <= radius));
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
 * Splits a flat, ordered `colours` array back into its groups.
 *
 * `derive` always emits one contiguous run per group, in group order, steps
 * in order within the group — that's how both a freshly-derived palette and
 * a previously-written `art/palette.json` are shaped, so grouping by run
 * rather than by a Map keyed on name is what lets position (not name) be the
 * thing `carryNames` compares two palettes by.
 */
function groupRuns(colours) {
  const runs = [];
  for (const entry of colours) {
    const group = entry.name.slice(0, entry.name.lastIndexOf('.'));
    if (runs.length === 0 || runs[runs.length - 1].group !== group) {
      runs.push({ group, entries: [] });
    }
    runs[runs.length - 1].entries.push(entry);
  }
  return runs;
}

/**
 * Carries a human's names on `art/palette.json` forward across a re-run.
 *
 * `derive` knows nothing about names that already exist — it always names a
 * group from where its centroid measures, because that's the only thing it
 * has. The very first re-run after Task 4's naming gate would otherwise
 * silently throw the human naming away and replace it with `familyName`'s
 * descriptive guesses again, which is a defect this project already made
 * once (the RAMPS-anchor names that turned out to lie) and cannot afford to
 * make a second time to its own output.
 *
 * Structure — the number of groups and the step count within each, in order —
 * is what's compared, not the names or the colours themselves: names are
 * exactly the thing being carried, so they can't also be the key, and hexes
 * are expected to drift a little as the art changes. When structure holds,
 * each existing name is kept and paired with the newly derived colour at the
 * same position; when it doesn't, guessing a mapping between an old group and
 * a new one would be inventing meaning from position alone, so the fresh
 * descriptive names are written instead and the caller is expected to shout
 * about it.
 *
 * Kept out of `derive` deliberately: `derive` is pure and tested as pure, and
 * reading `art/palette.json` from inside it would mean a function with no
 * file-reading in its contract quietly grew one. This is exported instead so
 * the merge itself — not just the CLI wrapper around it — has a test.
 *
 * The merge is `{ ...oldEntry, hex: derivedEntry.hex, share: derivedEntry.share }`
 * — every field the human wrote, with only the two fields derivation computes
 * overwritten — and not `{ ...derivedEntry, name: oldEntry.name }`. The two
 * look interchangeable when `derived` entries only ever have `name`, `hex`
 * and `share`, and for a long time that was true. It stopped being true the
 * day `art/palette.json` grew a `note` field on `building.0` and `light.0`
 * recording *why* those two groups keep descriptive rather than semantic
 * names — the direction the merge spreads in decides whether a field only
 * the human copy has survives at all. `{ ...derivedEntry, name: ... }` keeps
 * exactly the derived object's own fields and grafts one name onto it, so
 * `note` (and anything else added to the human copy later that `derive`
 * itself doesn't produce) is silently dropped on every re-run. This is the
 * same defect already fixed once for `name` — the reason this function
 * exists at all — returning through a field added after that fix landed.
 */
export function carryNames(existing, derived) {
  if (!existing) {
    return { colours: derived, structureChanged: false, moved: [] };
  }

  const existingRuns = groupRuns(existing);
  const derivedRuns = groupRuns(derived);
  const structureChanged = existingRuns.length !== derivedRuns.length
    || existingRuns.some((run, i) => run.entries.length !== derivedRuns[i].entries.length);

  if (structureChanged) {
    return { colours: derived, structureChanged: true, moved: [] };
  }

  const colours = [];
  const moved = [];
  derivedRuns.forEach((derivedRun, g) => {
    const existingGroup = existingRuns[g].entries;
    derivedRun.entries.forEach((derivedEntry, s) => {
      const oldEntry = existingGroup[s];
      colours.push({ ...oldEntry, hex: derivedEntry.hex, share: derivedEntry.share });

      const oldLab = hexToOklab(oldEntry.hex);
      const newLab = hexToOklab(derivedEntry.hex);
      moved.push({
        name: oldEntry.name,
        from: oldEntry.hex,
        to: derivedEntry.hex,
        distance: distance(oldLab, newLab),
      });
    });
  });

  return { colours, structureChanged: false, moved };
}

/**
 * Points to a named palette: a few pinned ramps, then the rest derived.
 *
 * `ramps` (from `art/ramps.json`) are placed first, verbatim per
 * `pinnedRamp`, and take no part in anything below — they are not
 * candidates the coarse clustering can win or lose, because clustering was
 * the thing that lost them: soil's browns sit perceptually next to wood,
 * skin and bark, so a coarse pass asked to find "soil" on its own happily
 * split it across three buckets no matter how many groups it was given.
 * That is a conflict between what clustering optimises for (coverage —
 * put a centroid where pixels are dense) and what a gradient needs
 * (resolution in a narrow band, held to one hue family). No allocation rule
 * fixes a conflict of objectives, so this stops asking clustering to solve
 * it and declares the ramp instead.
 *
 * The rest of the budget (`TOTAL` minus what the pinned ramps spent) is
 * still found the way the whole palette used to be: a coarse, weighted
 * k-means for `GROUPS` centroids, then a fine k-means inside each bucket at
 * the size `allocate` gives it, sized by `sqrt(share) * spread` so a large
 * family still outscores a tiny one without volume alone buying steps that
 * spend themselves on differences nobody will ever see. `points` is
 * expected to have already excluded `art/raw/intent/` (see `histogram`'s
 * `exclude` option) — those pixels already paid for the pinned ramps, and
 * letting them vote again here would double their weight for free.
 *
 * The points are sorted by (L, a, b, weight) before anything else touches
 * them. `kmeans`'s k-means++ seeding picks its first centroid positionally
 * from whatever order the points array arrives in, so an unsorted caller —
 * `histogram`'s directory walk is one, but not the only possible one — makes
 * the palette a function of incidental ordering rather than of the art
 * itself. Reversing an unsorted input once moved most of the derived output.
 * Sorting here, at the one place every caller passes through, protects the
 * guarantee regardless of where the points came from. `weight` is the
 * tiebreak: two distinct colours never collide on (L, a, b), but a
 * comparator that stops at `b` would let two points that do coincide there
 * keep whatever relative order they arrived in, which is exactly the
 * dependency this exists to remove. `ramps` needs no such protection: it
 * never touches `points`, so its output cannot depend on their order.
 *
 * Before any of that, `points` is filtered through `excludeNearPinned`. A
 * pixel within `PIN_EXCLUSION_RADIUS` of a pinned colour is already served
 * by the palette; letting it vote again is how a derived group ended up
 * built right on top of `soil` the first time this ran — the coarse
 * clustering had no way to know soil-adjacent browns elsewhere in the art
 * (wood, bark) were already spoken for. Filtering the input, rather than
 * discarding or nudging a centroid afterwards, keeps every centroid the
 * derived half produces an honest centroid of the pixels that remain.
 */
export function derive(points, ramps = []) {
  const pinned = ramps.flatMap(pinnedRamp);
  const budget = TOTAL - pinned.length;

  const eligible = excludeNearPinned(points, pinned);
  const sorted = [...eligible].sort((p, q) => (
    p.L - q.L || p.a - q.a || p.b - q.b || p.weight - q.weight
  ));
  const anchors = kmeans(sorted, GROUPS, SEED);

  const buckets = anchors.map(() => []);
  const weights = anchors.map(() => 0);
  for (const point of sorted) {
    const index = nearestIndex(point, anchors);
    buckets[index].push(point);
    weights[index] += point.weight;
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const spread = buckets.map((bucket, i) => {
    const bucketWeight = bucket.reduce((sum, p) => sum + p.weight, 0) || 1;
    return bucket.reduce((sum, p) => sum + distance(p, anchors[i]) * p.weight, 0) / bucketWeight;
  });
  const scores = weights.map((w, i) => Math.sqrt(w / totalWeight) * spread[i]);

  const sizes = allocate(scores, budget);
  const names = uniqueNames(anchors.map(familyName));

  const derived = [];
  anchors.forEach((_, index) => {
    const centroids = kmeans(buckets[index], sizes[index], SEED + index + 1);
    for (let step = 0; step < sizes[index]; step += 1) {
      const centroid = centroids[Math.min(step, centroids.length - 1)];
      derived.push({
        name: `${names[index]}.${step}`,
        hex: centroid ? oklabToHex(centroid) : '#000000',
        share: Number((weights[index] / totalWeight).toFixed(4)),
      });
    }
  });
  return [...pinned, ...derived];
}

// --- CLI ---------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('derive-palette.mjs')) {
  const { ramps } = JSON.parse(fs.readFileSync(RAMPS_FILE, 'utf8'));
  const points = histogram(RAW_DIR, { exclude: ['intent'] });
  const derived = derive(points, ramps);

  const pinned = ramps.flatMap(pinnedRamp);
  const eligible = excludeNearPinned(points, pinned);
  console.log(
    `pin exclusion — ${points.length - eligible.length} of ${points.length} histogram points `
    + `dropped (within ${PIN_EXCLUSION_RADIUS} of a pinned colour), ${eligible.length} left to cluster`,
  );

  // readPaletteFile, not a bare JSON.parse: this is re-reading this file's
  // own prior output, so it should be held to the same "fail loudly on a
  // malformed palette" standard as every other reader rather than a
  // shortcut just because the writer and reader happen to be the same file.
  const existing = fs.existsSync(OUT_FILE) ? readPaletteFile(OUT_FILE) : null;
  const { colours, structureChanged, moved } = carryNames(existing, derived);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(
    OUT_FILE,
    `${JSON.stringify({ colours }, null, 2)}\n`,
  );
  console.log(`wrote ${OUT_FILE} — ${colours.length} colours from ${points.length} distinct`);

  const duplicates = colours.filter((c, i) => colours.findIndex((o) => o.hex === c.hex) !== i);
  if (duplicates.length > 0) {
    console.warn(`\n${duplicates.length} padded entries — pick these by hand:`);
    for (const d of duplicates) console.warn(`  ${d.name}  ${d.hex}`);
  }

  if (existing && structureChanged) {
    console.warn(
      '\n!! STRUCTURE CHANGED — the existing names in art/palette.json no longer line up '
      + 'with the freshly derived groups (a group gained or lost steps, or the number of '
      + 'groups changed), so this run wrote fresh descriptive names instead of guessing a '
      + 'mapping.\n'
      + `   previous: ${groupRuns(existing).map((r) => `${r.group}(${r.entries.length})`).join(', ')}\n`
      + `   now:      ${groupRuns(derived).map((r) => `${r.group}(${r.entries.length})`).join(', ')}\n`
      + '   The previous human naming was DISCARDED. It must be reassigned by hand.',
    );
  } else if (existing && moved.length > 0) {
    const width = Math.max(...moved.map((m) => m.name.split('.')[0].length));
    console.log('\ncentroid movement (existing names carried over, hexes updated):');
    for (const m of moved) {
      const [group, step] = m.name.split('.');
      const flag = m.distance > 0.05 ? '  <-- re-check by eye' : '';
      console.log(
        `  ${group.padEnd(width)}.${step} ${m.from} -> ${m.to}   (moved ${m.distance.toFixed(4)})${flag}`,
      );
    }
    const worthChecking = moved.filter((m) => m.distance > 0.05);
    if (worthChecking.length > 0) {
      console.warn(
        `\n${worthChecking.length} entries moved more than 0.05 in OkLab — a name assigned to `
        + 'one set of swatches may not describe the new ones:',
      );
      for (const m of worthChecking) console.warn(`  ${m.name}  moved ${m.distance.toFixed(4)}`);
    }
  }
}
