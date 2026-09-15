/**
 * The lock.
 *
 * Everything else in this work was a one-off: a palette derived, art
 * quantised, literals substituted. This is the part that keeps it true. A
 * palette without a test is a convention, and a convention lasts until the
 * first time somebody needs a colour in a hurry.
 *
 * Four checks, because colour enters the game two ways — as pixels in a
 * file, and as a literal in source — and because the two halves of the
 * pipeline (the JSON palette and its generated module, the JSON palette and
 * the art quantised against it) can each drift from the other silently.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { distance, nearestIndex, srgbToOklab } from './lib/colour.mjs';
import { decodePng } from './lib/png.mjs';
import { loadPalette, quantise } from './apply-palette.mjs';

const { colours } = JSON.parse(fs.readFileSync(path.join('art', 'palette.json'), 'utf8'));
const ALLOWED = new Set(colours.map((c) => Number.parseInt(c.hex.slice(1), 16)));
const LAB = colours.map((c) => {
  const n = Number.parseInt(c.hex.slice(1), 16);
  return srgbToOklab((n >> 16) & 255, (n >> 8) & 255, n & 255);
});

/**
 * Colours that are not colour choices, so the palette does not get to veto
 * them.
 *
 *   - `0xffffff` is Phaser's "no tint" identity. `setTint(0xffffff)` leaves a
 *     sprite exactly as drawn, so treating it as a colour choice would be
 *     forcing an instruction to be a pigment.
 *   - `0x000000` here is either an invisible hit-box rectangle (alpha 0, so
 *     no colour ever reaches the screen) or the vignette/energy-hit scrim,
 *     which is a black multiplied over the scene at a low alpha to darken
 *     it — a lighting operation, not a drawn surface.
 */
const UTILITY_TINTS = new Set([0xffffff, 0x000000]);

/**
 * The five villager identity tints.
 *
 * A Phaser tint is a multiplier: what reaches the screen is
 * `spriteColour x tint`, and that product is neither the sprite's palette
 * colour nor the tint itself. Requiring the tint value to already be a
 * palette member is therefore a category error, not a loophole being
 * exploited — the tint is not a colour that gets drawn, it is an operation
 * applied to one that already is (the LPC sheet, which is on-palette).
 *
 * It is also not optional to relax this by picking the *nearest* palette
 * colour instead of allowlisting the exact value. Measured in OkLab, ash's
 * #8fb6e0 (pale blue) and juniper's #9fd9a8 (pale green) both land nearest
 * to the same palette entry, light.6 (#acbfb0, a sage grey roughly
 * equidistant between them). Snapping either tint to its nearest palette
 * colour would make two villagers share a tint and therefore share a look —
 * defeating the one job an identity tint has, which is telling villagers
 * apart at a glance. So these five are named individually rather than
 * matched by distance.
 */
const VILLAGER_TINTS = new Set([
  0x8fb6e0, // ash
  0xb8a06a, // bram
  0x9fd9a8, // juniper
  0xc98a8a, // maeve
  0xe0c27a, // tobias
]);

function nearestName(n) {
  const lab = srgbToOklab((n >> 16) & 255, (n >> 8) & 255, n & 255);
  const i = nearestIndex(lab, LAB);
  return `${colours[i].name} (${colours[i].hex}, d=${distance(lab, LAB[i]).toFixed(3)})`;
}

function walk(dir, match, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, match, found);
    } else if (match.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Strips `//` and `/* *\/` comments before the source scan runs.
 *
 * Dozens of hex literals survive in `createPixelArtTextures.ts`,
 * `itemIcons.ts` and the generator scripts, every one of them inside a
 * comment recording which colour a mapping replaced and why (e.g. "was
 * #7d5633, now soil.4"). Those comments are the documentation that makes the
 * migration legible to the next reader; matching them as live literals would
 * force whoever touches those files next to either mangle the comment or
 * fight the test, and an earlier draft of this test did exactly that to a
 * Task 12 file before this stripping step was added. A hex inside a comment
 * is a citation, not a colour the game draws.
 *
 * This is deliberately crude — no state machine for strings, so a hex typed
 * inside a JS/TS string literal is also stripped if that string happens to
 * look like a comment marker around it. That trade is fine here: this repo
 * does not build colours out of string concatenation, and a crude stripper
 * that occasionally over-strips a comment is far safer than a precise one
 * that under-strips and lets a real literal hide inside `/* ... *\/`.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
}

test('every pixel the game loads is on the palette', () => {
  // art/raw/ is deliberately not walked: it holds the originals as drawn,
  // and being off-palette is its whole job (see art/raw/intent/README.md for
  // the one folder inside it that exists purely to cast a colour vote).
  //
  // plot-*.png IS walked: as of Task 8 it is generated onto the palette like
  // every other file under public/assets/, so it gets no exemption.
  const failures = [];
  for (const file of walk(path.join('public', 'assets'), /\.png$/)) {
    const { width, height, pixels } = decodePng(fs.readFileSync(file));
    const off = new Map();
    for (let i = 0; i < width * height; i += 1) {
      if (pixels[i * 4 + 3] < 8) continue;
      const n = (pixels[i * 4] << 16) | (pixels[i * 4 + 1] << 8) | pixels[i * 4 + 2];
      if (!ALLOWED.has(n)) off.set(n, (off.get(n) ?? 0) + 1);
    }
    if (off.size > 0) {
      const worst = [...off.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      failures.push(
        `${file}: ${off.size} off-palette colours. Worst: ` +
          worst.map(([n, c]) => `#${n.toString(16).padStart(6, '0')} x${c} -> ${nearestName(n)}`).join('; '),
      );
    }
  }
  assert.deepEqual(failures, [], `\n${failures.join('\n')}\n\nRebuild with: npm run palette:apply`);
});

test('no source file names a colour the palette does not have', () => {
  const files = [
    ...walk('src', /\.(ts|tsx|css)$/),
    ...walk('scripts', /\.mjs$/),
  ].filter((f) => !f.includes('palette.generated') && !f.endsWith('.test.mjs') && !f.endsWith('.test.ts'));

  const failures = [];
  for (const file of files) {
    // Comments are stripped first: see stripComments() above for why a hex
    // inside a `//` or `/* */` comment is documentation, not a literal the
    // game draws.
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    for (const match of source.matchAll(/#([0-9a-fA-F]{6})\b|0x([0-9a-fA-F]{6})\b/g)) {
      const n = Number.parseInt(match[1] ?? match[2], 16);
      if (ALLOWED.has(n) || UTILITY_TINTS.has(n) || VILLAGER_TINTS.has(n)) continue;
      const line = source.slice(0, match.index).split('\n').length;
      failures.push(`${file}:${line}  ${match[0]}  -> use ${nearestName(n)}`);
    }
  }
  assert.deepEqual(
    failures,
    [],
    `\n${failures.join('\n')}\n\nImport PALETTE from palette.generated instead of typing a hex.`,
  );
});

test('the generated module matches art/palette.json', () => {
  // The module is generated, so it can silently fall behind the JSON if
  // somebody edits one and forgets to re-run the generator.
  const module = fs.readFileSync(path.join('src', 'game', 'assets', 'palette.generated.ts'), 'utf8');
  for (const colour of colours) {
    assert.ok(
      module.includes(`'${colour.name}': '${colour.hex}'`),
      `${colour.name} is ${colour.hex} in the JSON but not in the module — run "npm run palette:module"`,
    );
  }
});

test('public/assets/lpc/ is what the committed palette quantises art/raw/lpc/ into', () => {
  // The full check would be "art/palette.json is what npm run palette:derive
  // would produce right now" — but derive-palette.mjs runs k-means over every
  // PNG in art/raw/ (LPC sheets and art/raw/intent/ together), and doing that
  // on every `npm test` would make the lock the slowest thing in the suite
  // for a property the other three tests in this file already narrow down:
  // if the *art* matches what the *palette* quantises it to, the two have not
  // silently diverged, regardless of whether the palette itself is still the
  // k-means-optimal 48 for the current art (that question is instead owned by
  // a human decision to re-run palette:derive and review the diff, per its
  // own file header).
  //
  // So this test takes the cheaper of the two options the brief allows: it
  // re-derives nothing, and instead asserts that quantising every committed
  // art/raw/lpc/ source through the committed art/palette.json reproduces
  // public/assets/lpc/ pixel-for-pixel. It reuses quantise() and
  // loadPalette() from apply-palette.mjs — the exact functions
  // `npm run palette:apply` runs — so this is not a re-implementation that
  // could itself drift from the real pipeline; it is the real pipeline, run
  // in memory instead of against disk, with no file written and nothing
  // that needs a second command to set up.
  const palette = loadPalette();
  const rawDir = path.join('art', 'raw', 'lpc');
  const outDir = path.join('public', 'assets', 'lpc');

  const failures = [];
  for (const file of walk(rawDir, /\.png$/)) {
    const name = path.relative(rawDir, file);
    const outFile = path.join(outDir, name);
    if (!fs.existsSync(outFile)) {
      failures.push(`${name}: has a source in art/raw/lpc/ but no matching file in public/assets/lpc/`);
      continue;
    }

    const expected = quantise(decodePng(fs.readFileSync(file)), palette);
    const actual = decodePng(fs.readFileSync(outFile));
    if (expected.width !== actual.width || expected.height !== actual.height) {
      failures.push(
        `${name}: committed file is ${actual.width}x${actual.height}, quantising the raw source gives ` +
          `${expected.width}x${expected.height}`,
      );
      continue;
    }
    if (!Buffer.from(expected.pixels).equals(Buffer.from(actual.pixels))) {
      let diff = 0;
      for (let i = 0; i < expected.pixels.length; i += 4) {
        if (
          expected.pixels[i] !== actual.pixels[i] ||
          expected.pixels[i + 1] !== actual.pixels[i + 1] ||
          expected.pixels[i + 2] !== actual.pixels[i + 2] ||
          expected.pixels[i + 3] !== actual.pixels[i + 3]
        ) {
          diff += 1;
        }
      }
      failures.push(`${name}: ${diff} pixels differ from art/raw/lpc/ quantised through art/palette.json`);
    }
  }
  assert.deepEqual(
    failures,
    [],
    `\n${failures.join('\n')}\n\npublic/assets/lpc/ has drifted from art/raw/lpc/. Rebuild with: npm run palette:apply`,
  );
});
