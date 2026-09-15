/**
 * Tests for the colour maths the palette is built on.
 *
 * OkLab is here rather than RGB because nearest-colour in RGB pulls dark
 * shades toward each other: on a character sprite that is exactly the range
 * carrying the shading, so an RGB palette lock would flatten faces while
 * leaving bright grass alone. These tests pin the two properties that matter —
 * the transform round-trips, and "nearest" agrees with the eye.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  distance, hexToOklab, hexToRgb, kmeans, nearestIndex, oklabToHex, oklabToSrgb, srgbToOklab, unpackRgb,
} from './colour.mjs';

test('sRGB survives a round trip through OkLab', () => {
  for (const rgb of [[0, 0, 0], [255, 255, 255], [125, 86, 51], [74, 122, 48], [31, 23, 16]]) {
    const back = oklabToSrgb(srgbToOklab(...rgb));
    assert.deepEqual(back, rgb, `${rgb} came back as ${back}`);
  }
});

test('white is lighter than black and grey sits between', () => {
  const black = srgbToOklab(0, 0, 0).L;
  const grey = srgbToOklab(128, 128, 128).L;
  const white = srgbToOklab(255, 255, 255).L;
  assert.ok(black < grey && grey < white);
});

test('a neutral grey has almost no chroma', () => {
  const { a, b } = srgbToOklab(128, 128, 128);
  assert.ok(Math.hypot(a, b) < 0.001, `grey had chroma ${Math.hypot(a, b)}`);
});

test('nearestIndex picks the perceptually closer of two candidates', () => {
  // Two browns and one green. A mid brown must land on a brown, and the point
  // of doing this in OkLab is that it still does when the greens are closer in
  // raw RGB arithmetic.
  const palette = [[125, 86, 51], [93, 60, 34], [74, 122, 48]].map((c) => srgbToOklab(...c));
  assert.equal(nearestIndex(srgbToOklab(120, 84, 50), palette), 0);
  assert.equal(nearestIndex(srgbToOklab(95, 62, 36), palette), 1);
  assert.equal(nearestIndex(srgbToOklab(70, 118, 45), palette), 2);
});

test('distance is zero for a colour against itself', () => {
  const lab = srgbToOklab(125, 86, 51);
  assert.equal(distance(lab, lab), 0);
});

test('kmeans is deterministic for a given seed', () => {
  const points = [];
  for (let i = 0; i < 200; i += 1) {
    const rgb = [(i * 37) % 256, (i * 91) % 256, (i * 13) % 256];
    points.push({ ...srgbToOklab(...rgb), weight: 1 + (i % 5) });
  }
  const first = kmeans(points, 8, 1234);
  const second = kmeans(points, 8, 1234);
  assert.deepEqual(first, second);
});

test('kmeans returns exactly k centroids', () => {
  const points = [];
  for (let i = 0; i < 50; i += 1) {
    points.push({ ...srgbToOklab(i * 5, 200 - i * 3, 100), weight: 1 });
  }
  assert.equal(kmeans(points, 6, 7).length, 6);
});

test('kmeans weights pull a centroid toward the heavy colour', () => {
  // One colour used 1000 times and one used once must not average evenly: a
  // palette that ignores pixel counts spends entries on colours nobody sees.
  const heavy = { ...srgbToOklab(200, 40, 40), weight: 1000 };
  const light = { ...srgbToOklab(40, 40, 200), weight: 1 };
  const [centroid] = kmeans([heavy, light], 1, 3);
  assert.ok(distance(centroid, heavy) < distance(centroid, light));
});

test('kmeans returns sorted input when fewer points than k', () => {
  // When a colour bucket holds fewer distinct colours than its ramp has steps,
  // kmeans returns what there is, sorted by lightness. This is not hypothetical:
  // palette derivation (Task 3) runs kmeans with k = ramp size, and a bucket can
  // genuinely hold fewer colours than steps. Callers name entries by position, so
  // an unsorted result would come out light-to-dark in the middle of a palette
  // that is dark-to-light everywhere else. The ordering is essential.
  // Use intentionally reverse-ordered input: bright, medium, dark. The sort must
  // reorder to dark, medium, bright or the test does not catch the defect.
  const points = [
    { ...srgbToOklab(255, 255, 255), weight: 1 }, // white, brightest
    { ...srgbToOklab(128, 128, 128), weight: 1 }, // grey, medium
    { ...srgbToOklab(0, 0, 0), weight: 1 },       // black, darkest
  ];
  const result = kmeans(points, 6, 42);
  assert.equal(result.length, 3, 'returned count equals input count, not k');
  // Verify ordering by lightness: result[0] must be darkest, result[2] brightest.
  // If the sort were missing, result would be [white, grey, black] instead of
  // [black, grey, white], and this check would fail.
  assert.ok(result[0].L <= result[1].L, 'first entry darker than second');
  assert.ok(result[1].L <= result[2].L, 'second entry darker than third');
});

test('unpackRgb splits a packed 24-bit int into its three bytes', () => {
  assert.deepEqual(unpackRgb(0x7d5633), [0x7d, 0x56, 0x33]);
  assert.deepEqual(unpackRgb(0x000000), [0, 0, 0]);
  assert.deepEqual(unpackRgb(0xffffff), [255, 255, 255]);
});

test('hexToRgb parses the same shape unpackRgb needs, from a "#rrggbb" string', () => {
  assert.deepEqual(hexToRgb('#7d5633'), [0x7d, 0x56, 0x33]);
});

test('hexToOklab and oklabToHex are exact inverses of each other', () => {
  for (const hex of ['#000000', '#ffffff', '#7d5633', '#4a90d9']) {
    assert.equal(oklabToHex(hexToOklab(hex)), hex, `${hex} did not round-trip`);
  }
});

test('hexToOklab agrees with srgbToOklab on the same colour', () => {
  assert.deepEqual(hexToOklab('#7d5633'), srgbToOklab(0x7d, 0x56, 0x33));
});
