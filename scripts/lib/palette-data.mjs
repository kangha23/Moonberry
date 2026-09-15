/**
 * The palette, for the build scripts.
 *
 * The app reads `src/game/assets/palette.generated.ts`. Node cannot import
 * that without a TypeScript loader, so the scripts read the JSON the module
 * was generated from. One source, two views — never two tables.
 */
import fs from 'node:fs';
import path from 'node:path';

const { colours } = JSON.parse(
  fs.readFileSync(path.join('art', 'palette.json'), 'utf8'),
);

/** Every colour as name -> '#rrggbb'. */
export const PALETTE = Object.fromEntries(colours.map((c) => [c.name, c.hex]));

/** The flat list, for anything checking membership. */
export const PALETTE_HEXES = colours.map((c) => c.hex);
