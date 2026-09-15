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
import { distance, hexToOklab, nearestIndex, srgbToOklab, unpackRgb } from './lib/colour.mjs';
import { decodePng } from './lib/png.mjs';
import { findOrphans, loadPalette, quantise } from './apply-palette.mjs';

const { colours } = JSON.parse(fs.readFileSync(path.join('art', 'palette.json'), 'utf8'));
const ALLOWED = new Set(colours.map((c) => Number.parseInt(c.hex.slice(1), 16)));
const LAB = colours.map((c) => hexToOklab(c.hex));

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
 *
 * This same Set is reused, unchanged, for `rgb()`/`rgba()` channel triples
 * (see RGB_FUNCTION below): `rgba(0,0,0,0.24)` is the same drop-shadow scrim
 * as `0x000000` and `rgba(255,255,255,0.85)` is the same wash as `0xffffff`,
 * just spelled with the alpha inline instead of set separately. Giving the
 * rgb() form its own allowlist would be inventing a second exemption for the
 * one rationale above, which is exactly the kind of drift a lock is supposed
 * to prevent.
 */
const UTILITY_TINTS = new Set([0xffffff, 0x000000]);

/**
 * `rgb()` / `rgba()` with numeric channels — the hole that let a hand-typed
 * translucent colour walk straight past this test.
 *
 * The hex/`0x` regex a few lines down cannot see inside `rgba(18, 52, 86,
 * 0.5)`: there is no `#` and no `0x` anywhere in it, so a channel triple
 * naming an off-palette colour was invisible to "no source file names a
 * colour the palette does not have" no matter how off-palette it was. A
 * reviewer proved this by appending `.zz-probe { color: rgba(18, 52, 86,
 * 0.5); }` to src/styles.css and watching all four tests in this file pass.
 *
 * Only the classic, comma-separated, integer-channel form is parsed —
 * `rgb(r, g, b)` / `rgba(r, g, b, a)` with 0-255 integers for r/g/b and a
 * plain numeric alpha. Two things are deliberately handled differently:
 *
 *   - Space-separated channels (`rgb(18 52 86 / 50%)`) and percentage
 *     channels (`rgb(7% 20% 34%)`) are legal CSS Color 4 syntax that nothing
 *     in this codebase currently writes. Rather than silently fail to match
 *     them — which is exactly the bug this whole extension exists to fix,
 *     just for a different syntax — RGB_CLASSIC below fails to match them
 *     too, and that mismatch is treated as its own failure (see
 *     "unsupported" below) rather than as "no colour found here". Parsing
 *     every CSS Color 4 permutation correctly would buy precision for a form
 *     nobody has reached for, at the cost of a hand-rolled colour parser this
 *     file would then have to keep correct forever; rejecting the form
 *     outright and pointing at the palette custom property to use instead is
 *     the cheaper, equally safe option, and it is the one taken here.
 *   - Anything with no digit in it at all is not a colour literal and is
 *     skipped rather than flagged. Two idioms this codebase actually uses
 *     rely on that: `withAlpha()` in createPixelArtTextures.ts builds its
 *     return value as the template literal `` `rgba(${r},${g},${b},${alpha})`
 *     `` — the word "rgba(" is right there in the source, but every channel
 *     is a placeholder, not a number, so the text between the parens has no
 *     digit in it. And `color-mix(in srgb, var(--pal-cream) 62%, transparent)`
 *     in styles.css never contains the substring "rgb(" or "rgba(" at all
 *     (the "srgb" in "in srgb" is followed by a comma, not a paren, so the
 *     regex below does not even reach it). Neither idiom needs special-casing
 *     to pass — they were checked by hand against this exact implementation
 *     before it was trusted, and by the probes in fix-c-report.md — so if a
 *     later change to this function starts flagging either one, that is a
 *     regression in the change, not a gap this comment forgot to close.
 */
const RGB_FUNCTION = /\brgba?\(([^()]*)\)/g;
const RGB_CLASSIC =
  /^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[01]?(?:\.\d+)?\s*)?$/;

/**
 * Returns the packed 0xRRGGBB for a classic `rgb()`/`rgba()` body, the string
 * `'unsupported'` for one that names actual channel data in a form this test
 * does not parse (see RGB_FUNCTION above), or `null` when there is no digit
 * in it at all, meaning it is not a colour literal in the first place.
 */
function parseRgbBody(inside) {
  if (!/\d/.test(inside)) return null;
  const m = inside.match(RGB_CLASSIC);
  if (!m) return 'unsupported';
  const [r, g, b] = [m[1], m[2], m[3]].map(Number);
  if (r > 255 || g > 255 || b > 255) return 'unsupported';
  return (r << 16) | (g << 8) | b;
}

/**
 * The five villager identity tints.
 *
 * This is NOT exempt because a Phaser tint is a multiplier (`spriteColour x
 * tint`) rather than a drawn colour. That argument proves too much: it is
 * true of every tint in the codebase, verbatim, and Task 12 spent a whole
 * pass converting 28 of the other 33 tints in `src/` to `tint('group.N')`
 * precisely because being a multiplier did not stop *them* from having to
 * name a palette member. An argument that would justify exempting all 33
 * cannot be the reason only 5 are exempt — so it isn't the real reason, and
 * an unfalsifiable "category error" claim was worse than no reason at all.
 *
 * The real, falsifiable reason: this palette has no pale blue and no pale
 * green, so it cannot express five mutually distinguishable villager
 * identities, and an identity tint that isn't distinguishable has failed at
 * its one job. Measured in OkLab, ash's `#8fb6e0` (pale blue) and juniper's
 * `#9fd9a8` (pale green) both land nearest to the same palette entry,
 * `light.6` (`#acbfb0`, a sage grey roughly equidistant between them) —
 * snapping either to its nearest palette colour, or to any single shared
 * substitute, would make two villagers share a tint and therefore share a
 * look. That is a fact about the current 48 colours, not about what a
 * Phaser tint fundamentally is, and it comes with its own expiry: if the
 * palette ever gains a genuine pale blue and pale green (a re-derivation
 * that widens the `light` group, say), this exemption should end and all
 * five villagers should convert to `tint('group.N')` like every other
 * sprite. Until then, the five exact values are allowlisted rather than
 * matched by distance, because snapping to nearest is exactly the move that
 * collapses two of them onto `light.6`.
 *
 * Kept in sync with `src/game/npcs/villagers/*.ts` by the assertion right
 * below this list, not by hand alone: a retint that changes a villager's
 * `tint:` value without updating this list would otherwise leave a stale
 * entry here that nothing ever objects to.
 */
const VILLAGER_TINTS = new Set([
  0x8fb6e0, // ash
  0xb8a06a, // bram
  0x9fd9a8, // juniper
  0xc98a8a, // maeve
  0xe0c27a, // tobias
]);

function nearestName(n) {
  const lab = srgbToOklab(...unpackRgb(n));
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
 *
 * The line-comment branch is `(?<![:\w])\/\/.*$`, not a bare `\/\/.*$`. A bare
 * one has a live hole: `scripts/generate-assets.mjs` builds two SVGs whose
 * opening tag is `<svg xmlns="http://www.w3.org/2000/svg" ...>`, and `//` in
 * `http://` reads as a line comment to a stripper that doesn't know URLs
 * exist — every character after it on that line, `fill="..."` included were
 * one added there, vanishes before the scan below ever sees it. That is not
 * hypothetical: a reviewer appended `fill="#123456"` right after the URL on
 * that exact line and this test passed. The negative lookbehind excludes a
 * `//` immediately preceded by `:` (the URL scheme separator) or any word
 * character, which covers `http://` and `https://` without touching a real
 * `// comment`, which is always preceded by whitespace or line-start.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|(?<![:\w])\/\/.*$/gm, '');
}

/**
 * Every value in `VILLAGER_TINTS` is still somebody's `tint:` in
 * `src/game/npcs/villagers/`.
 *
 * The allowlist above is a second source of truth for those five hexes, with
 * nothing structural tying it to the villager files themselves — a retint
 * that changes one file's `tint:` value has no way to make the Set above
 * notice its old entry is now unused. Checked once, at module load, so a
 * stale entry (one that widens the exemption past what any villager actually
 * needs) fails immediately instead of sitting there forever.
 */
{
  const villagerSource = walk(path.join('src', 'game', 'npcs', 'villagers'), /\.ts$/)
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  const staleTints = [...VILLAGER_TINTS].filter(
    (n) => !villagerSource.includes(`0x${n.toString(16)}`),
  );
  assert.deepEqual(
    staleTints.map((n) => `#${n.toString(16).padStart(6, '0')}`),
    [],
    'VILLAGER_TINTS in scripts/palette-lock.test.mjs has an entry no villager file uses any more — ' +
      'remove it, since a stale exemption only widens what the lock lets through.',
  );
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

  // .svg is text, not pixels, so it cannot go through decodePng — but it is
  // still a committed asset under public/assets/, and a hex literal in one
  // is exactly as much a colour the game draws as a PNG pixel is. Before
  // this, .png was the only extension the walk matched, so
  // `public/assets/pixel/*.svg` (written by generate-assets.mjs) was
  // unscanned by both the pixel check here and the source-literal check
  // below — neither one owned it. This closes that gap from the pixel side.
  for (const file of walk(path.join('public', 'assets'), /\.svg$/)) {
    const source = fs.readFileSync(file, 'utf8');
    const off = new Map();
    for (const match of source.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
      const n = Number.parseInt(match[1], 16);
      if (!ALLOWED.has(n) && !UTILITY_TINTS.has(n)) off.set(match[0], (off.get(match[0]) ?? 0) + 1);
    }
    if (off.size > 0) {
      failures.push(
        `${file}: ${off.size} off-palette hex literal(s): ` +
          [...off.keys()].map((h) => `${h} -> ${nearestName(Number.parseInt(h.slice(1), 16))}`).join('; '),
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
      // A sixth villager needing an identity tint hits this exact failure,
      // and "use light.6" — the message every other file gets — is precisely
      // the fix VILLAGER_TINTS exists to reject: light.6 is where both the
      // pale blue and the pale green villager tints already collide. Point
      // at the allowlist and its reasoning instead of at a nearest-colour
      // suggestion that would silently recreate the bug it was added to fix.
      const isVillagerFile = file.split(path.sep).join('/').includes('npcs/villagers/');
      failures.push(
        isVillagerFile
          ? `${file}:${line}  ${match[0]}  -> not on the palette and not in VILLAGER_TINTS. If this is a ` +
            'new or changed identity tint, read the comment on VILLAGER_TINTS in ' +
            'scripts/palette-lock.test.mjs before picking a replacement — "use the nearest palette ' +
            'colour" is the exact mistake that comment exists to prevent.'
          : `${file}:${line}  ${match[0]}  -> use ${nearestName(n)}`,
      );
    }

    // The rgb()/rgba() half of the same check — see RGB_FUNCTION's own
    // comment for what is and is not matched, and why.
    for (const match of source.matchAll(RGB_FUNCTION)) {
      const parsed = parseRgbBody(match[1]);
      if (parsed === null) continue; // no digit in it: not a colour literal (e.g. withAlpha's own template)
      const line = source.slice(0, match.index).split('\n').length;
      if (parsed === 'unsupported') {
        failures.push(
          `${file}:${line}  ${match[0]}  -> rgb()/rgba() with space-separated or percentage channels is ` +
            'not recognised by this lock (see the RGB_FUNCTION comment in scripts/palette-lock.test.mjs). ' +
            "Use a palette custom property instead: color-mix(in srgb, var(--pal-x) N%, transparent) in " +
            "CSS, or withAlpha(PALETTE['x'], alpha) in canvas code.",
        );
        continue;
      }
      if (ALLOWED.has(parsed) || UTILITY_TINTS.has(parsed)) continue;
      failures.push(`${file}:${line}  ${match[0]}  -> use ${nearestName(parsed)}`);
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
  const sourceNames = new Set();
  for (const file of walk(rawDir, /\.png$/)) {
    const name = path.relative(rawDir, file);
    sourceNames.add(name);
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

  // The converse of the loop above. That loop walks art/raw/lpc/ and asks
  // "does every source have an output" — it says nothing about a file
  // sitting in public/assets/lpc/ with no source at all. A rename in
  // art/raw/lpc/ (tree.png -> oak-tree.png, say) leaves exactly that: an
  // orphaned, still-on-palette output that quantises nothing anymore and
  // that the loop above has no way to notice, because it never looks at
  // outDir except to check a name it already expects to find. findOrphans
  // (from apply-palette.mjs, the same function `npm run palette:apply` warns
  // with) already knows how to tell a genuine orphan from one of the nine
  // plot-*.png files generate-plot-art.mjs writes with no raw source by
  // design — reusing it here means this check can't drift from what the CLI
  // itself considers stale.
  for (const orphan of findOrphans(outDir, sourceNames)) {
    failures.push(`${orphan}: sits in public/assets/lpc/ with no source in art/raw/lpc/ (a rename left it behind?)`);
  }

  assert.deepEqual(
    failures,
    [],
    `\n${failures.join('\n')}\n\npublic/assets/lpc/ has drifted from art/raw/lpc/. Rebuild with: npm run palette:apply`,
  );
});
