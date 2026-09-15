#!/usr/bin/env node
/**
 * Rebuilds `public/assets/lpc/` from `art/raw/lpc/`, on the palette.
 *
 * Nearest-colour, with no dithering. Dithering is the usual answer to losing
 * shades, and it is the wrong one here: it works by scattering two palette
 * colours in a pattern the eye blends, which at a 32px tile magnified three
 * times reads as noise rather than as a third colour. Pixel art holds up under
 * magnification precisely because it does not do that.
 *
 * Run: npm run palette:apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { nearestIndex, srgbToOklab } from './lib/colour.mjs';
import { decodePng, encodeImage } from './lib/png.mjs';

const IN_DIR = path.join('art', 'raw', 'lpc');
const OUT_DIR = path.join('public', 'assets', 'lpc');
const PALETTE_FILE = path.join('art', 'palette.json');

/** Below this a pixel is invisible, so its colour is not worth moving. */
const ALPHA_FLOOR = 8;

export function quantise(image, palette) {
  const pixels = Uint8Array.from(image.pixels);
  // Distinct colours are few and pixels are many, so the lookup is cached.
  const cache = new Map();

  for (let i = 0; i < image.width * image.height; i += 1) {
    const at = i * 4;
    if (pixels[at + 3] < ALPHA_FLOOR) continue;

    const key = (pixels[at] << 16) | (pixels[at + 1] << 8) | pixels[at + 2];
    let rgb = cache.get(key);
    if (rgb === undefined) {
      const lab = srgbToOklab(pixels[at], pixels[at + 1], pixels[at + 2]);
      rgb = palette[nearestIndex(lab, palette)].rgb;
      cache.set(key, rgb);
    }

    pixels[at] = rgb[0];
    pixels[at + 1] = rgb[1];
    pixels[at + 2] = rgb[2];
    // pixels[at + 3] is deliberately left alone.
  }

  return { width: image.width, height: image.height, pixels };
}

/** How the fix for every case below is spelled, since the palette is generated. */
const REGENERATE_HINT = 'Run `npm run palette:derive` to regenerate it.';

/**
 * Loads and validates `art/palette.json`.
 *
 * This script rewrites every piece of art in the game from whatever this
 * function returns, so a malformed entry has to fail loudly here rather than
 * degrade quietly downstream. Two ways it degrades matter enough to guard
 * against by name:
 *
 *   - A hex missing its `#` (or otherwise off-shape) is not rejected by
 *     `parseInt` — `hex.slice(1)` just drops a different character and
 *     produces a plausible-but-wrong RGB triple. No error, wrong colour.
 *   - A hex that fails to parse at all becomes `NaN` in every OkLab
 *     coordinate. In `nearestIndex` (`./lib/colour.mjs`), `d < bestDistance`
 *     is always false when `d` is `NaN`, so that entry can never win a
 *     comparison — not an error, just a palette that is silently one colour
 *     short, with every pixel that should have snapped to it landing on its
 *     nearest surviving neighbour instead.
 *
 * Deliberately not folded into `nearestIndex` or anything in `colour.mjs`:
 * that module is pure arithmetic with no notion of a JSON file on disk, and
 * "is this palette file well-formed" is this loader's concern, not its.
 */
export function loadPalette(file = PALETTE_FILE) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const colours = parsed && Array.isArray(parsed.colours) ? parsed.colours : null;
  if (!colours || colours.length === 0) {
    throw new Error(`${file} has no non-empty "colours" array. ${REGENERATE_HINT}`);
  }

  return colours.map((entry, index) => {
    const { name, hex } = entry ?? {};
    if (!name || !hex) {
      throw new Error(
        `${file}: entry ${index} is missing a "name" or "hex" (got ${JSON.stringify(entry)}). ` +
          REGENERATE_HINT,
      );
    }
    if (!/^#[0-9a-f]{6}$/.test(hex)) {
      throw new Error(
        `${file}: entry ${index} ("${name}") has a malformed hex "${hex}" — expected ` +
          `"#rrggbb" in lowercase hex. ${REGENERATE_HINT}`,
      );
    }

    const n = Number.parseInt(hex.slice(1), 16);
    const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    for (const channel of rgb) {
      if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
        throw new Error(
          `${file}: entry ${index} ("${name}") has hex "${hex}", which does not decode to a ` +
            `valid 0-255 RGB triple. ${REGENERATE_HINT}`,
        );
      }
    }

    return { ...srgbToOklab(...rgb), rgb };
  });
}

/**
 * Files this quantiser must never call stale, even though they have no
 * source in `art/raw/lpc/`.
 *
 * `scripts/generate-plot-art.mjs` writes these nine PNGs straight into
 * `public/assets/lpc/` — that is precisely why they were kept out of
 * `art/raw/` in the first place (see task 2's brief): a path with two
 * producers would have whichever ran last silently reverting the other. An
 * orphan check that did not know about them would flag Task 8's migration as
 * broken every single run.
 *
 * Not imported from `generate-plot-art.mjs` itself, on purpose: that module
 * calls its own `main()` unconditionally at the bottom of the file, with no
 * `argv`-based guard the way this script has. Importing it — even just to
 * read its exported `PLOT_VARIANTS` — would run `main()` as a side effect and
 * regenerate every plot tile every time this script (or its tests) load.
 * `scripts/generate-plot-art.mjs` remains the source of truth for what it
 * writes; keep this list in sync with it by hand.
 */
const GENERATED_PLOT_NAMES = new Set(
  ['plot-tilled', 'plot-watered', 'plot-wild'].flatMap((base) =>
    [0, 1, 2].map((variant) => `${base}${variant === 0 ? '' : `-${variant + 1}`}.png`),
  ),
);

/**
 * `.png` files sitting in `dir` with no source and no known generator.
 *
 * Reported, never deleted: deleting on a guess is exactly the mistake the
 * `GENERATED_PLOT_NAMES` list above exists to prevent from happening again by
 * a different route. A human who sees the warning can tell a genuine rename
 * casualty from a file some other generator is still responsible for; an
 * automatic deleter cannot.
 */
export function findOrphans(dir, sourceNames) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.png') && !sourceNames.has(name) && !GENERATED_PLOT_NAMES.has(name));
}

/**
 * The CC-BY-SA modification notice this script owes the LPC art it rewrites.
 *
 * A licence review confirmed CC-BY-SA requires stating that the art has been
 * modified, how, and where the unmodified originals live. Kept as a constant
 * here — rather than, say, duplicated into a doc — so the notice text and the
 * script that performs the modification cannot drift apart.
 */
const NOTICE_HEADING = '## Modification notice';

const MODIFICATION_NOTICE = `${NOTICE_HEADING}

Every PNG in this folder has been colour-reduced to the 48-colour palette in
\`art/palette.json\`. No shape, frame or layout was altered — only the colour of
individual pixels, by nearest-neighbour matching in OkLab. The unmodified
originals are kept in \`art/raw/lpc/\` and are what the CC-BY-SA attributions
above describe. Rebuild this folder with \`npm run palette:apply\`.
`;

/**
 * The credits this script writes to `public/assets/lpc/`, built from the raw
 * file rather than copied verbatim.
 *
 * The bare `fs.copyFileSync` this replaced quietly undid its own compliance:
 * a human appended the notice below to the output by hand once, and the next
 * `palette:apply` run copied the un-notated raw file straight over it. That
 * made "rebuild the art" and "stay licence-compliant" mutually exclusive,
 * which is backwards — the quantiser is the thing performing the
 * modification, so the quantiser is what has to say so, every time it runs,
 * not just the time someone remembered to say it by hand.
 *
 * `art/raw/lpc/CREDITS.md` itself is never touched: it describes the
 * unmodified originals, and the licence review confirmed that file is
 * correct to leave the notice off.
 *
 * Idempotent primarily by construction: the CLI always calls this with
 * `art/raw/lpc/CREDITS.md`'s own content, never with the file this function
 * previously wrote, so there is normally no existing notice to double up on.
 * It also strips anything from a pre-existing notice heading onward before
 * appending a fresh one, so a second notice cannot appear even if that
 * assumption were ever broken — belt, and braces.
 */
export function creditsWithNotice(rawText) {
  const noticeAt = rawText.indexOf(NOTICE_HEADING);
  const withoutOldNotice = noticeAt === -1 ? rawText : rawText.slice(0, noticeAt);
  const trimmed = withoutOldNotice.replace(/\s+$/, '');
  return `${trimmed}\n\n${MODIFICATION_NOTICE}`;
}

// --- CLI ---------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('apply-palette.mjs')) {
  const palette = loadPalette();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const sourceNames = new Set(fs.readdirSync(IN_DIR).filter((name) => name.endsWith('.png')));

  let changed = 0;
  for (const name of sourceNames) {
    const image = decodePng(fs.readFileSync(path.join(IN_DIR, name)));
    const out = encodeImage(quantise(image, palette));
    const target = path.join(OUT_DIR, name);
    const before = fs.existsSync(target) ? fs.readFileSync(target) : null;
    if (before === null || !before.equals(out)) changed += 1;
    fs.writeFileSync(target, out);
  }

  // CREDITS travels with the art it describes, plus the modification notice
  // CC-BY-SA requires for the colour-reduction this script itself performs.
  const rawCredits = fs.readFileSync(path.join(IN_DIR, 'CREDITS.md'), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'CREDITS.md'), creditsWithNotice(rawCredits));
  console.log(`quantised ${IN_DIR} -> ${OUT_DIR}; ${changed} files changed`);

  const orphans = findOrphans(OUT_DIR, sourceNames);
  if (orphans.length > 0) {
    console.warn(
      `warning: ${OUT_DIR} has ${orphans.length} PNG(s) with no source in ${IN_DIR} and no known ` +
        `generator — they may be stale and worth checking by hand: ${orphans.join(', ')}`,
    );
  }
}
