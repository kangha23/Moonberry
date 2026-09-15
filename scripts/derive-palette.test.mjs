/**
 * Tests for palette derivation.
 *
 * The property that matters most is determinism. `art/palette.json` is
 * committed, and a palette that came out differently on each run could never
 * be regenerated and diffed against the committed copy — which would make the
 * lock unenforceable in exactly the situation it exists for.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { srgbToOklab } from './lib/colour.mjs';
import { RAMPS, derive } from './derive-palette.mjs';

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

test('the ramp table sums to exactly 48', () => {
  const total = RAMPS.reduce((sum, ramp) => sum + ramp.steps.length, 0);
  assert.equal(total, 48, `ramps declare ${total} colours`);
});

test('every ramp name is unique', () => {
  const names = RAMPS.flatMap((ramp) => ramp.steps.map((step) => `${ramp.name}.${step}`));
  assert.equal(new Set(names).size, names.length);
});

test('derive returns 48 named colours', () => {
  const palette = derive(samplePoints());
  assert.equal(palette.length, 48);
  for (const entry of palette) {
    assert.match(entry.hex, /^#[0-9a-f]{6}$/, `${entry.name} had hex ${entry.hex}`);
    assert.ok(entry.name.includes('.'), `${entry.name} is not a ramp.step name`);
  }
});

test('derive is deterministic', () => {
  const points = samplePoints();
  assert.deepEqual(derive(points), derive(points));
});

test('each ramp comes out ordered dark to light', () => {
  const palette = derive(samplePoints());
  for (const ramp of RAMPS) {
    const entries = palette.filter((e) => e.name.startsWith(`${ramp.name}.`));
    assert.equal(entries.length, ramp.steps.length);
    const lightness = entries.map((e) => {
      const n = parseInt(e.hex.slice(1), 16);
      return srgbToOklab((n >> 16) & 255, (n >> 8) & 255, n & 255).L;
    });
    for (let i = 1; i < lightness.length; i += 1) {
      assert.ok(lightness[i] >= lightness[i - 1], `${ramp.name} is not ordered at step ${i}`);
    }
  }
});
