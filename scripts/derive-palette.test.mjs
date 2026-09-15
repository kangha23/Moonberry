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
import path from 'node:path';
import test from 'node:test';
import { distance, srgbToOklab } from './lib/colour.mjs';
import { allocate, derive, familyName } from './derive-palette.mjs';

const PALETTE_FILE = path.join('art', 'palette.json');

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
    const n = Number.parseInt(entry.hex.slice(1), 16);
    groups.get(group).push(srgbToOklab((n >> 16) & 255, (n >> 8) & 255, n & 255).L);
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
  const lab = colours.map((entry) => {
    const n = Number.parseInt(entry.hex.slice(1), 16);
    return srgbToOklab((n >> 16) & 255, (n >> 8) & 255, n & 255);
  });
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
