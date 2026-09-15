/**
 * The palette, for the build scripts.
 *
 * The app reads `src/game/assets/palette.generated.ts`. Node cannot import
 * that without a TypeScript loader, so the scripts read the JSON the module
 * was generated from. One source, two views — never two tables.
 */
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_FILE = path.join('art', 'palette.json');

/** How the fix for every case below is spelled, since the palette is generated. */
const REGENERATE_HINT = 'Run `npm run palette:derive` to regenerate it.';

/**
 * Reads and validates a `palette.json`-shaped file. The one door.
 *
 * Five different modules used to read `art/palette.json` straight off disk
 * with a bare `JSON.parse`, and only one of them — `apply-palette.mjs`'s own
 * `loadPalette` — checked the result was well-formed before using it. That
 * left four call sites (this module included) exposed to the two ways a
 * malformed palette degrades silently instead of loudly:
 *
 *   - A hex missing its `#` is not rejected by `parseInt` — `hex.slice(1)`
 *     just drops a different character and produces a plausible-but-wrong
 *     colour. No error, wrong colour.
 *   - A hex that fails to parse at all becomes `NaN` in every OkLab
 *     coordinate, and `nearestIndex`'s `d < bestDistance` is always false
 *     against `NaN` — so that entry can never win a comparison, and the
 *     palette is silently one colour short.
 *
 * Every reader now goes through here, so a malformed `art/palette.json`
 * fails at the same place with the same message no matter which script
 * tripped over it first.
 */
export function readPaletteFile(file = DEFAULT_FILE) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const colours = parsed && Array.isArray(parsed.colours) ? parsed.colours : null;
  if (!colours || colours.length === 0) {
    throw new Error(`${file} has no non-empty "colours" array. ${REGENERATE_HINT}`);
  }

  colours.forEach((entry, index) => {
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
  });

  return colours;
}

const colours = readPaletteFile();

/** Every colour as name -> '#rrggbb'. */
export const PALETTE = Object.fromEntries(colours.map((c) => [c.name, c.hex]));

/** The flat list, for anything checking membership. */
export const PALETTE_HEXES = colours.map((c) => c.hex);
