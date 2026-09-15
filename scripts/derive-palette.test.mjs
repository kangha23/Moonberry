/**
 * Tests for palette derivation.
 *
 * The property that matters most is determinism. `art/palette.json` is
 * committed, and a palette that came out differently on each run could never
 * be regenerated and diffed against the committed copy — which would make the
 * lock unenforceable in exactly the situation it exists for.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { distance, hexToOklab, srgbToOklab } from './lib/colour.mjs';
import { encodePng, raster } from './lib/png.mjs';
import {
  allocate, carryNames, derive, excludeNearPinned, familyName, histogram, pinnedRamp,
} from './derive-palette.mjs';

const PALETTE_FILE = path.join('art', 'palette.json');
const RAMPS_FILE = path.join('art', 'ramps.json');

function realRamps() {
  return JSON.parse(fs.readFileSync(RAMPS_FILE, 'utf8')).ramps;
}

function hueAndLightness(hex) {
  const lab = hexToOklab(hex);
  const hue = ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360;
  return { ...lab, hue };
}

function samplePoints() {
  const points = [];
  const seeds = [
    [125, 86, 51], [93, 60, 34], [157, 112, 73], [74, 122, 48], [47, 82, 35],
    [110, 160, 70], [60, 90, 140], [90, 140, 200], [224, 168, 120], [180, 120, 86],
    [138, 138, 146], [200, 204, 212], [220, 180, 70], [190, 60, 60], [30, 24, 18],
  ];
  seeds.forEach((rgb, i) => {
    for (let k = 0; k < 12; k += 1) {
      const jitter = (n) => Math.max(0, Math.min(255, n + ((k * 7 + i * 3) % 11) - 5));
      points.push({ ...srgbToOklab(...rgb.map(jitter)), weight: 10 + k });
    }
  });
  return points;
}

test('allocate hands out exactly the total, however lopsided the weights', () => {
  for (const weights of [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [486, 127, 123, 62, 55, 39, 38, 33, 22, 9, 5],
    [1000, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  ]) {
    const sizes = allocate(weights);
    assert.equal(sizes.reduce((a, b) => a + b, 0), 48, `${weights} summed wrong`);
    for (const size of sizes) assert.ok(size >= 3, `a group got ${size}, below the floor`);
  }
});

test('allocate gives the heavier group more', () => {
  // The whole point: entries follow the art. A family covering half the pixels
  // earns more steps than one covering half a percent.
  const [heavy, light] = allocate([900, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
  assert.ok(heavy > light, `heavy got ${heavy}, light got ${light}`);
});

test('allocate refuses a floor that cannot fit', () => {
  assert.throws(() => allocate([1, 1, 1], 48, 20));
});

test('familyName describes hue and lightness, and never claims meaning', () => {
  assert.equal(familyName(srgbToOklab(20, 20, 22)), 'neutralDark');
  assert.equal(familyName(srgbToOklab(240, 240, 240)), 'neutralLight');
  assert.match(familyName(srgbToOklab(74, 122, 48)), /^green/);
  assert.match(familyName(srgbToOklab(90, 140, 200)), /^(blue|teal)/);
});

test('derive returns 48 colours with unique names', () => {
  const palette = derive(samplePoints());
  assert.equal(palette.length, 48);
  const names = palette.map((entry) => entry.name);
  assert.equal(new Set(names).size, 48, 'names collided');
  for (const entry of palette) {
    assert.match(entry.hex, /^#[0-9a-f]{6}$/, `${entry.name} had hex ${entry.hex}`);
  }
});

test('derive is deterministic', () => {
  const points = samplePoints();
  assert.deepEqual(derive(points), derive(points));
});

test('each group comes out ordered dark to light', () => {
  const palette = derive(samplePoints());
  const groups = new Map();
  for (const entry of palette) {
    const group = entry.name.split('.')[0];
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(hexToOklab(entry.hex).L);
  }
  for (const [group, lightness] of groups) {
    for (let i = 1; i < lightness.length; i += 1) {
      assert.ok(lightness[i] >= lightness[i - 1], `${group} is not ordered at step ${i}`);
    }
  }
});

test('no group is a catch-all and none is starved', () => {
  // The defect this redesign exists to prevent: a hand-placed anchor that was
  // nearest to everything dark took 49% of the art, while another took 0.52%
  // and was handed the largest ramp. Data-drawn groups cannot skew that far.
  const palette = derive(samplePoints());
  const shares = [...new Set(palette.map((entry) => `${entry.name.split('.')[0]}:${entry.share}`))]
    .map((row) => Number(row.split(':')[1]));
  assert.ok(Math.max(...shares) < 0.45, `a group took ${Math.max(...shares)} of the art`);
});

test('no two palette entries are closer than the eye can resolve', () => {
  // The defect this project exists to remove: the codebase had 856 colour pairs
  // closer than anyone could tell apart. A palette that rebuilds that at the dark
  // end has spent entries on differences nobody will ever see. 0.03 is roughly the
  // just-noticeable difference in OkLab.
  //
  // This reads the committed `art/palette.json` rather than either re-deriving
  // from `art/raw` or using `samplePoints()`. `samplePoints()` exists to test
  // determinism, ordering, and the allocate/familyName contracts cheaply, and its
  // 15 hand-picked seeds were never meant to carry enough colour diversity to
  // fill 48 mutually-separated output entries — one seed alone (a near-black
  // brown, jittered by a uniform per-channel delta that leaves its whole 12-point
  // cloud within an OkLab diameter of 0.0435) cannot supply 3 entries 0.03 apart
  // no matter how derive() is written, since 3 points spread across a 0.0435 span
  // have a best-case worst-gap of about half that span. Re-deriving from
  // `art/raw` is closer, but still not the same claim: the file every later task
  // actually consumes is the committed JSON, which can drift from `art/raw` if
  // someone edits the art without re-running `palette:derive`. Reading the file
  // itself is the only way to constrain what ships rather than what the source
  // art would currently produce. (Whether the committed file is stale against
  // `art/raw` is a real, separate question — it belongs to the palette-lock
  // test, not here.)
  const { colours } = JSON.parse(fs.readFileSync(PALETTE_FILE, 'utf8'));
  const lab = colours.map((entry) => hexToOklab(entry.hex));
  for (let i = 0; i < lab.length; i += 1) {
    for (let j = i + 1; j < lab.length; j += 1) {
      const d = distance(lab[i], lab[j]);
      assert.ok(d >= 0.03, `${colours[i].name} and ${colours[j].name} differ by only ${d.toFixed(4)}`);
    }
  }
});

test('derive does not depend on the order its points arrive in', () => {
  // Filesystem order is not a guarantee. k-means++ seeds positionally, so an
  // unsorted readdirSync silently makes the palette a function of the machine
  // it was built on: reversing the input once moved 44 of 48 entries.
  const points = samplePoints();
  const forwards = derive(points);
  const backwards = derive([...points].reverse());
  assert.deepEqual(backwards, forwards);
});

test('carryNames keeps the existing names when structure is unchanged, and updates hexes', () => {
  // The names here (`water`, `grass`) are deliberately not what `familyName`
  // would produce for these centroids (they'd come out `blueMid`, `greenMid`
  // — see the next test). If carryNames silently returned the derived names
  // instead of carrying the existing ones over, this test would still pass
  // by accident unless the fixture makes the two disagree.
  const existing = [
    { name: 'water.0', hex: '#156c98', share: 0.0432 },
    { name: 'water.1', hex: '#726b7e', share: 0.0432 },
    { name: 'grass.0', hex: '#387e06', share: 0.1308 },
  ];
  const derived = [
    { name: 'blueMid.0', hex: '#17709c', share: 0.041 },
    { name: 'blueMid.1', hex: '#736c80', share: 0.041 },
    { name: 'greenMid.0', hex: '#397f07', share: 0.129 },
  ];
  const result = carryNames(existing, derived);
  assert.equal(result.structureChanged, false);
  assert.deepEqual(result.colours.map((c) => c.name), ['water.0', 'water.1', 'grass.0']);
  assert.deepEqual(result.colours.map((c) => c.hex), ['#17709c', '#736c80', '#397f07']);
  assert.deepEqual(result.colours.map((c) => c.share), [0.041, 0.041, 0.129]);
});

test('carryNames does not carry names when a group\'s step count changes', () => {
  const existing = [
    { name: 'water.0', hex: '#156c98', share: 0.5 },
    { name: 'water.1', hex: '#726b7e', share: 0.5 },
  ];
  const derived = [
    { name: 'blueMid.0', hex: '#17709c', share: 0.33 },
    { name: 'blueMid.1', hex: '#736c80', share: 0.33 },
    { name: 'blueMid.2', hex: '#1a97b3', share: 0.34 },
  ];
  const result = carryNames(existing, derived);
  assert.equal(result.structureChanged, true);
  assert.deepEqual(result.colours, derived);
});

test('carryNames does not carry names when the group count changes', () => {
  const existing = [{ name: 'water.0', hex: '#156c98', share: 1 }];
  const derived = [
    { name: 'blueMid.0', hex: '#17709c', share: 0.5 },
    { name: 'greenMid.0', hex: '#397f07', share: 0.5 },
  ];
  const result = carryNames(existing, derived);
  assert.equal(result.structureChanged, true);
  assert.deepEqual(result.colours, derived);
});

test('carryNames reports how far each entry moved in OkLab', () => {
  const existing = [{ name: 'outline.0', hex: '#000000', share: 1 }];
  const derived = [{ name: 'neutralDark.0', hex: '#ffffff', share: 1 }];
  const result = carryNames(existing, derived);
  assert.equal(result.moved.length, 1);
  assert.equal(result.moved[0].name, 'outline.0');
  // Black to white is close to the largest possible OkLab distance (L runs
  // roughly 0 to 1, a and b near 0 for both), so this should read close to 1.
  assert.ok(result.moved[0].distance > 0.9, `expected a large move, got ${result.moved[0].distance}`);
});

test('carryNames carries every field on the existing entry, not just name', () => {
  // The regression this guards: an earlier version of carryNames merged as
  // `{ ...derivedEntry, name: oldEntry.name }` — keep the derived object's
  // own fields, graft one name onto it. That is silently wrong the moment
  // the human copy has a field `derive()` itself never produces, which is
  // exactly the shape of `note` on `art/palette.json`'s `building.0` and
  // `light.0`. This fixture puts a `note` (and a second made-up field, to
  // prove it isn't special-cased) on the existing entry and checks it
  // survives the merge untouched.
  const existing = [
    { name: 'water.0', hex: '#156c98', share: 0.0432, note: 'why this one keeps its name', extra: 'anything' },
  ];
  const derived = [{ name: 'blueMid.0', hex: '#17709c', share: 0.041 }];
  const result = carryNames(existing, derived);
  assert.deepEqual(result.colours, [
    { name: 'water.0', hex: '#17709c', share: 0.041, note: 'why this one keeps its name', extra: 'anything' },
  ]);
});

test('carrying names over the committed palette is a fixed point for every field, not just name', () => {
  // `art/palette.json` itself carries a `note` on `building.0` and `light.0`
  // — see the previous test for why that field is the one a merge bug would
  // drop silently. This is the same claim checked against the real
  // committed file instead of a small fixture, and — importantly — against
  // an honest stand-in for what `derive()` actually hands `carryNames` on a
  // live re-run: `derive()`'s real output only ever has `{name, hex, share}`,
  // never `note` or anything else a human added by hand, so `derived` here
  // strips every field but those three. Passing the committed file as
  // `existing` unchanged and this stripped copy as `derived` is a fixed
  // point exactly when carryNames preserves every field on the existing
  // entry: names, hexes and shares already agree, and structure is
  // identical by construction, so `result.colours` can only fail to equal
  // `existing` byte-for-byte if a field — `note` above all — got dropped in
  // the merge. Deleting either `note` from `existing` here and re-running is
  // the direct demonstration: the assertion still expects the note that
  // `derived` never had, so it fails the moment the merge stops carrying it.
  const { colours: existing } = JSON.parse(fs.readFileSync(PALETTE_FILE, 'utf8'));
  const derived = existing.map(({ name, hex, share }) => ({ name, hex, share }));
  const result = carryNames(existing, derived);
  assert.equal(result.structureChanged, false);
  assert.deepEqual(result.colours, existing);
});

test('pinnedRamp refuses to invent steps beyond what from provides', () => {
  // Before this guard, `steps` greater than `from.length` fell into the
  // `steps >= points.length` branch and quietly returned every point sorted
  // — a ramp shorter than art/ramps.json declared, with nothing anywhere
  // noticing the shortfall. Pinning exists precisely so a ramp is the exact
  // tones an artist chose; silently shipping fewer of them than asked for is
  // the same category of quiet loss `carryNames` was just checked against.
  assert.throws(
    () => pinnedRamp({ name: 'soil', steps: 3, from: ['#111111', '#222222'] }),
    /steps \(3\) exceeds from\.length \(2\)/,
  );
});

test('maxSpacedSubset (via pinnedRamp) refuses a combination count past the sanity limit', () => {
  // C(30, 15) is a little over 155 million — nothing an exhaustive search
  // should ever attempt inside a test run. This proves the guard actually
  // fires before the search starts, rather than merely existing in the
  // source and never being exercised.
  const from = Array.from({ length: 30 }, (_, i) => `#${(i * 823 % 0xffffff).toString(16).padStart(6, '0')}`);
  assert.throws(
    () => pinnedRamp({ name: 'huge', steps: 15, from }),
    /C\(30, 15\) = 155117520 combinations/,
  );
});

test('pinned soil ramp: 7 entries, one hue family, strictly ascending, evenly spaced', () => {
  // `soil` used to be two ramps (`soil`, `soilWet`) because a human could
  // keep dry and wet earth apart by eye. They overlapped in lightness the
  // moment both were pinned independently — wet earth is dark earth, so the
  // two hue-identical ramps interleaved. Merging into one ramp is supposed
  // to guarantee non-overlap by construction: this is the direct check of
  // that guarantee, not just of the two ramps that used to exist.
  //
  // 7, not 9: an exhaustive brute-force search over every subset of the 10
  // source tones found that no selection of 9 (best 0.0195) or even 8 (best
  // 0.0279) of them can reach the 0.030 floor — 7 is the most this exact
  // `from` list supports, at 0.0403. See `soil's ramp size is exactly what
  // its source tones can support` below for the direct check of that
  // ceiling, so a future edit to `from` fails loudly rather than quietly
  // shipping a crowded ramp.
  const palette = derive(samplePoints(), realRamps());
  const soil = palette.filter((entry) => entry.name.startsWith('soil.'));
  assert.equal(soil.length, 7, `expected 7 soil entries, got ${soil.length}`);
  const lab = soil.map((entry) => hueAndLightness(entry.hex));
  for (const point of lab) {
    assert.ok(point.hue >= 48 && point.hue <= 72, `soil hue ${point.hue} outside 48-72`);
  }
  for (let i = 1; i < lab.length; i += 1) {
    assert.ok(lab[i].L > lab[i - 1].L, `soil.${i} is not strictly ascending in lightness`);
    const d = distance(lab[i], lab[i - 1]);
    assert.ok(d >= 0.03, `soil.${i - 1} and soil.${i} are only ${d.toFixed(4)} apart`);
  }
});

test('the pinned soil hexes are exactly the artist\'s declared tones, not near-misses', () => {
  // The whole premise of pinning is that `soil`'s hexes are the exact tones
  // in art/ramps.json's `from`, chosen by `maxSpacedSubset`, never averaged
  // or nudged. A regression that swapped `maxSpacedSubset` for something
  // that merely lands close (kmeans, say, which this file's own header notes
  // was tried and rejected for exactly this reason) would still pass every
  // hue and spacing check above, because a near-miss can be just as
  // well-spaced as the real tone. Only checking membership in `from` catches
  // that a value was invented rather than selected.
  const ramp = realRamps().find((r) => r.name === 'soil');
  const soil = derive(samplePoints(), realRamps()).filter((entry) => entry.name.startsWith('soil.'));
  assert.ok(soil.every((entry) => ramp.from.includes(entry.hex)));
});

test("soil's ramp size is exactly what its source tones can support", () => {
  // The direct regression for the brute-force result: `steps` in
  // art/ramps.json must never exceed what `from` can actually separate at
  // 0.030, in either direction. Exhaustive search confirmed 9 source tones
  // cannot support more than 7 steps at that spacing (the best 9-of-10 and
  // 8-of-10 subsets only reach 0.0195 and 0.0279) and confirmed 7 is
  // achievable (0.0403). If a future edit changes `from` without
  // re-running that check, this fails loudly instead of shipping a ramp
  // that is quietly crowded past what anyone can actually tell apart.
  const ramps = realRamps();
  const soilRamp = ramps.find((r) => r.name === 'soil');
  assert.equal(soilRamp.steps, 7, `soil is declared at ${soilRamp.steps} steps, expected 7`);
  const palette = derive(samplePoints(), ramps);
  const soil = palette.filter((entry) => entry.name.startsWith('soil.'));
  const lab = soil.map((entry) => hueAndLightness(entry.hex));
  for (let i = 1; i < lab.length; i += 1) {
    assert.ok(distance(lab[i], lab[i - 1]) >= 0.03, `soil.${i - 1}/soil.${i} below the 0.030 floor`);
  }
});

test('excludeNearPinned drops points within the radius and keeps points outside it', () => {
  const pinned = pinnedRamp({ name: 'soil', steps: 1, from: ['#5b3c22'] });
  const identical = { ...srgbToOklab(0x5b, 0x3c, 0x22), weight: 5 };
  const nearby = { ...srgbToOklab(0x5c, 0x3d, 0x23), weight: 2 }; // one bit off, well inside 0.03
  const far = { ...srgbToOklab(20, 200, 20), weight: 3 }; // a saturated green, nowhere near a brown
  const result = excludeNearPinned([identical, nearby, far], pinned);
  assert.deepEqual(result, [far], 'only the point far from every pinned colour should survive');
});

test('derive with the real ramps still returns 48 unique, non-duplicate entries', () => {
  const palette = derive(samplePoints(), realRamps());
  assert.equal(palette.length, 48);
  assert.equal(new Set(palette.map((entry) => entry.name)).size, 48, 'names collided');
  const hexes = palette.map((entry) => entry.hex);
  assert.equal(new Set(hexes).size, hexes.length, 'a hex was duplicated');
});

test('pinned ramps do not depend on the order points arrive in', () => {
  // The pinned half never reads `points` at all, so reversing the derived
  // half's input must leave `soil` byte-for-byte identical even though it's
  // free to change the derived groups. (Once two ramps, `soil` and `soilWet`
  // — see the note on the test above — merged into the one `soil` ramp
  // checked here; there is no second pinned ramp left to check.)
  const points = samplePoints();
  const ramps = realRamps();
  const forwards = derive(points, ramps);
  const backwards = derive([...points].reverse(), ramps);
  const pinnedOnly = (palette) => palette.filter((e) => e.name.startsWith('soil'));
  assert.deepEqual(pinnedOnly(backwards), pinnedOnly(forwards));
});

test('histogram skips a named subdirectory when excluded', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'derive-palette-histogram-'));
  try {
    fs.mkdirSync(path.join(dir, 'kept'));
    fs.mkdirSync(path.join(dir, 'skip'));
    const one = raster(1, 1);
    one.set(0, 0, '#112233');
    fs.writeFileSync(path.join(dir, 'kept', 'a.png'), encodePng(1, 1, one.pixels));
    const two = raster(1, 1);
    two.set(0, 0, '#445566');
    fs.writeFileSync(path.join(dir, 'skip', 'b.png'), encodePng(1, 1, two.pixels));

    const everything = histogram(dir);
    const keys = (points) => points.map((p) => `${p.L.toFixed(6)},${p.a.toFixed(6)},${p.b.toFixed(6)}`);
    assert.equal(everything.length, 2, 'both colours should be counted with no exclusion');

    const excluded = histogram(dir, { exclude: ['skip'] });
    assert.equal(excluded.length, 1, 'the excluded folder\'s colour should be gone');
    assert.deepEqual(keys(excluded), keys(everything).slice(0, 1));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
