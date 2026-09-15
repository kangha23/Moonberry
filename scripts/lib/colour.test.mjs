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
import { distance, kmeans, nearestIndex, oklabToSrgb, srgbToOklab } from './colour.mjs';

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
