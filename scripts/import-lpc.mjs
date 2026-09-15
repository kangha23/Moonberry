#!/usr/bin/env node
/**
 * Cuts downloaded art into the files this game actually asks for.
 *
 * Nobody ships a sprite sheet shaped like somebody else's game. LPC terrain
 * comes as one big atlas, the character generator exports a 21-row sheet of
 * which four rows are a walk cycle, and CC0 crop packs are 16x16 grids where
 * this farm draws at 32. Every one of those is the same three operations —
 * take a rectangle, scale it by a whole number, save it under the name the
 * loader expects — and doing them by hand in an image editor is how a folder
 * ends up with one tile that is two pixels off.
 *
 * So: the operations, plus a table of the sizes the game requires, so a wrong
 * cut fails here rather than as a sprite that looks fine until it is standing
 * next to another sprite.
 *
 *   node scripts/import-lpc.mjs <source.png> <target> [options]
 *
 * Run with no arguments for the full help. Everything above the CLI at the
 * bottom is pure and exported, which is what `png.test.mjs` exercises.
 */
import fs from 'node:fs';
import path from 'node:path';
import { composite, decodePng, encodeImage, flip, sliceRect, upscale } from './lib/png.mjs';

/**
 * Where an import lands — the *source* folder, not the one the game loads.
 *
 * `public/assets/lpc/` is generated from here by `npm run palette:apply`, so
 * an import that wrote straight to it would be overwritten by the next
 * quantiser run, and the original would be gone. Imports land here; the game
 * reads what the quantiser produces.
 */
export const OUT_DIR = path.join('art', 'raw', 'lpc');

/**
 * What the game requires of each kind of file.
 *
 * Taken from the loader in `src/game/scenes/FarmScene.ts`, not invented here.
 * The world is drawn on 32px tiles and the walk sheets are read as 64px frames
 * nine across and four down, so those two numbers are not preferences.
 */
export const EXPECTED = [
  { match: /^tile-/, size: [32, 32], note: 'a world tile' },
  { match: /^plot-/, size: [32, 32], note: 'a soil state' },
  { match: /^crop-/, size: [32, 32], note: 'a crop stage or a ripe crop' },
  { match: /^grass-tuft$/, size: [32, 32], note: 'ground decoration' },
  {
    match: /-sheet$/,
    size: [576, 256],
    note: 'a walk cycle: 9 frames across, 4 directions down, 64px each',
  },
];

/** The walk cycle's shape, and where it sits in a generator export. */
export const WALK = { frame: 64, frames: 9, rows: 4, defaultRow: 8 };

/** The size rule for a target name, or null when the game does not care. */
export function expectationFor(target) {
  return EXPECTED.find((rule) => rule.match.test(target)) ?? null;
}

/** Flags, as `--name value` or `--name` for the booleans. */
export function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument "${arg}".`);
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[name] = true;
    else {
      flags[name] = next;
      i += 1;
    }
  }
  return flags;
}

function numbers(value, count, flag) {
  const parts = String(value)
    .split(',')
    .map((part) => Number(part.trim()));
  if (parts.length !== count || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`--${flag} wants ${count} number(s) separated by commas, got "${value}".`);
  }
  return parts;
}

/**
 * Builds the sheet the game reads out of a character-generator export.
 *
 * The generator emits every animation it knows — spellcast, thrust, walk,
 * slash, shoot — and this game only animates walking. Rather than load a sheet
 * that is five sixths frames nothing plays, the four walk rows are lifted out
 * here into exactly the 576x256 the loader's frame maths assumes.
 *
 * Row order is the LPC convention, and the game's `WALK_ROW` agrees with it:
 * up, left, down, right.
 */
export function walkcycle(source, startRow = WALK.defaultRow) {
  const { frame, frames, rows } = WALK;
  const needed = (startRow + rows) * frame;
  if (source.height < needed) {
    throw new Error(
      `--walkcycle wants ${rows} rows of ${frame}px starting at row ${startRow}, which needs a ` +
        `source at least ${needed}px tall; this one is ${source.height}px. Pass --row if the ` +
        'walk cycle sits somewhere else in the sheet.',
    );
  }
  if (source.width < frames * frame) {
    throw new Error(
      `--walkcycle wants ${frames} frames of ${frame}px, which needs a source at least ` +
        `${frames * frame}px wide; this one is ${source.width}px.`,
    );
  }
  return sliceRect(source, 0, startRow * frame, frames * frame, rows * frame);
}

/** The region of the source the flags select, before any scaling. */
export function cut(source, flags) {
  if (flags.walkcycle) {
    const startRow = flags.row === undefined ? WALK.defaultRow : numbers(flags.row, 1, 'row')[0];
    return walkcycle(source, startRow);
  }
  if (flags.rect) {
    const [x, y, w, h] = numbers(flags.rect, 4, 'rect');
    if (w < 1 || h < 1) throw new Error('--rect wants a width and height of at least 1.');
    return sliceRect(source, x, y, w, h);
  }
  if (flags.grid) {
    const [size] = numbers(flags.grid, 1, 'grid');
    if (size < 1) throw new Error('--grid wants a cell size of at least 1.');
    const [cx, cy] = flags.cell ? numbers(flags.cell, 2, 'cell') : [0, 0];
    return sliceRect(source, cx * size, cy * size, size, size);
  }
  return source;
}

/**
 * The scale you did not ask for.
 *
 * If the cut is a whole-number fraction of the size the game wants, that
 * factor is the only one that can be meant — and getting it wrong is the most
 * common way a 16x16 pack lands in a 32px world looking like a postage stamp.
 * An explicit `--scale` always wins, and a walk cycle is never scaled: it came
 * out at 64px a frame because that is what the generator draws.
 */
export function scaleFor(image, expected, flags) {
  if (flags.scale !== undefined) return numbers(flags.scale, 1, 'scale')[0];
  if (!expected || flags.walkcycle) return 1;
  const [wantW, wantH] = expected.size;
  const factor = wantW / image.width;
  if (Number.isInteger(factor) && factor >= 1 && image.height * factor === wantH) return factor;
  return 1;
}

/**
 * Everything between "here is a decoded source" and "here are bytes to write".
 *
 * Pure, so the interesting half of this script is testable without a
 * filesystem and without a real download to hand.
 */
export function planImport(source, target, flags = {}) {
  if (!/^[a-z0-9-]+$/.test(target)) {
    throw new Error(
      `Target "${target}" must be lower-case letters, digits and dashes, with no extension.`,
    );
  }
  const expected = expectationFor(target);
  let region = cut(source, flags);

  if (flags.flip !== undefined) {
    const axes = String(flags.flip).toLowerCase();
    if (!/^(x|y|xy|yx)$/.test(axes)) {
      throw new Error(`--flip wants x, y or xy, got "${flags.flip}".`);
    }
    region = flip(region, { x: axes.includes('x'), y: axes.includes('y') });
  }

  const image = upscale(region, scaleFor(region, expected, flags));
  const warnings = [];

  if (expected) {
    const [wantW, wantH] = expected.size;
    if (image.width !== wantW || image.height !== wantH) {
      const message =
        `${target} is ${expected.note} and the game reads it as ${wantW}x${wantH}, ` +
        `but this cut is ${image.width}x${image.height}.`;
      if (!flags.force) {
        throw new Error(
          `${message}\nCut a different region with --rect or --grid/--cell, set --scale, or pass ` +
            '--force if you have changed the loader to match.',
        );
      }
      warnings.push(`${message} Writing anyway because of --force.`);
    }
  }

  // A cut that landed entirely off the edge of the source is the quiet failure
  // this script exists to prevent: --cell 9,9 on a four-column sheet writes a
  // perfectly valid PNG of nothing at all, and the game then draws nothing at
  // all, and the search starts in the renderer. Say it here instead.
  if (image.pixels.every((byte, i) => i % 4 !== 3 || byte === 0)) {
    warnings.push(
      'every pixel of this cut is transparent — the region is probably outside the source, ' +
        `which is ${source.width}x${source.height}. Check --cell, --grid and --rect.`,
    );
  }

  return { image, expected, warnings };
}

/**
 * Reads a source that may be one PNG or a folder of layers.
 *
 * The character generator exports a folder per animation holding one PNG per
 * layer — `010 body_color.png`, `100 human_male.png`, `101 neutral.png` — and
 * the leading numbers are the stacking order, which is why sorting the names
 * is the right way to stack them rather than a lucky coincidence.
 */
export function readSource(sourcePath) {
  if (!fs.existsSync(sourcePath)) throw new Error(`No such file or folder: ${sourcePath}`);

  if (!fs.statSync(sourcePath).isDirectory()) {
    return { image: decodePng(fs.readFileSync(sourcePath)), layers: [path.basename(sourcePath)] };
  }

  const layers = fs
    .readdirSync(sourcePath)
    .filter((file) => file.toLowerCase().endsWith('.png'))
    .sort();
  if (!layers.length) throw new Error(`No PNGs in ${sourcePath}.`);

  const image = composite(layers.map((file) => decodePng(fs.readFileSync(path.join(sourcePath, file)))));
  return { image, layers };
}

// --- the command line -------------------------------------------------------

function usage() {
  console.log(`Cut downloaded art into ${OUT_DIR}.

  node scripts/import-lpc.mjs <source> <target> [options]

<source> is a PNG, or a folder of PNGs to stack in file-name order — which is
what the LPC character generator exports, one file per layer, numbered so that
sorting them is the stacking order.

<target> is the file name without its extension, and it is what the game looks
for. The names the loader knows:

  tile-grass, tile-grass-2, tile-grass-3, tile-path,
  tile-water, tile-water-2, tile-water-3       32x32
  plot-wild, plot-tilled, plot-watered         32x32
  crop-seeded, crop-sprout, crop-<crop id>     32x32
  grass-tuft                                   32x32
  <name>-sheet                                 576x256
  tree, farmhouse                              any size

Options:
  --rect X,Y,W,H   the region of the source to take. Default: the whole image.
  --grid N         read the source as a grid of NxN cells.
  --cell CX,CY     which cell to take, in grid coordinates. Needs --grid.
  --scale N        upscale by a whole number, nearest neighbour. Default: the
                   factor that lands on the required size, or 1.
  --flip x|y|xy    mirror the cut. A tiling texture mirrored is the same art
                   with its pattern somewhere else, which is the cheapest way
                   to stop a field showing its 32px grid.
  --walkcycle      take the four walk rows out of a character-generator export
                   (${WALK.frames} frames of ${WALK.frame}px, starting at row ${WALK.defaultRow}) and write a
                   576x256 sheet. Overrides --rect.
  --row N          which row the walk cycle starts at. Default ${WALK.defaultRow}.
  --force          write even when the result is not the size the game wants.
  --dry-run        report what it would write, and write nothing.

Examples:

  # One 16x16 cell from a CC0 crop pack, doubled to this farm's 32px tile.
  node scripts/import-lpc.mjs downloads/crops.png crop-tomato --grid 16 --cell 3,0

  # A villager from the character generator's layered export. Its walk folder
  # is already just the walk animation, so the rows start at zero.
  node scripts/import-lpc.mjs downloads/maeve/standard/walk maeve-sheet --walkcycle --row 0

  # The same character as one flat sheet of every animation, walk at row 8.
  node scripts/import-lpc.mjs downloads/maeve.png maeve-sheet --walkcycle

  # A tile from an LPC atlas that is already at 32px.
  node scripts/import-lpc.mjs downloads/terrain.png tile-path --grid 32 --cell 5,2

The art in this folder is not MIT. Whatever you import, add it to
${path.join(OUT_DIR, 'CREDITS.md')} with its author and its licence.`);
}

function main(argv) {
  if (argv.length < 2 || argv.includes('--help') || argv.includes('-h')) {
    usage();
    return argv.length < 2 ? 1 : 0;
  }

  const [sourcePath, target] = argv;
  const flags = parseFlags(argv.slice(2));

  const { image: source, layers } = readSource(sourcePath);
  if (layers.length > 1) console.log(`composited ${layers.length} layers: ${layers.join(', ')}`);

  const { image, warnings } = planImport(source, target, flags);
  warnings.forEach((warning) => console.warn(`warning: ${warning}`));

  const outPath = path.join(OUT_DIR, `${target}.png`);
  const size = `${image.width}x${image.height}`;

  if (flags['dry-run']) {
    console.log(`would write ${outPath} (${size}, from ${sourcePath})`);
    return 0;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const existed = fs.existsSync(outPath);
  fs.writeFileSync(outPath, encodeImage(image));
  console.log(`${existed ? 'replaced' : 'wrote'} ${outPath} (${size}, from ${sourcePath})`);
  console.log(`next: npm run lpc:manifest, then credit the source in ${path.join(OUT_DIR, 'CREDITS.md')}`);
  return 0;
}

// Only when run as a command. Imported — by the tests — this file is just the
// functions above.
if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`import-lpc: ${error.message}`);
    process.exit(1);
  }
}
