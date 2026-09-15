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
import { composite, decodePng, encodeImage, flip, rgba, sliceRect, upscale } from './lib/png.mjs';

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
/**
 * An animal walk cycle's shape.
 *
 * Four frames a direction rather than the nine a person gets, and four rows in
 * the same order. The frame size is not here because there is no one answer:
 * the LPC farm animals are drawn in 128px boxes and the chicken in a 32px one,
 * and what this importer writes is neither — see `animalcycle`.
 */
export const ANIMAL = { cols: 4, rows: 4 };

export const EXPECTED = [
  { match: /^tile-/, size: [32, 32], note: 'a world tile' },
  { match: /^plot-/, size: [32, 32], note: 'a soil state' },
  { match: /^crop-/, size: [32, 32], note: 'a crop stage or a ripe crop' },
  { match: /^grass-tuft$/, size: [32, 32], note: 'ground decoration' },
  {
    // Animal sheets come first: `animal-cow-sheet` ends in `-sheet` too, and
    // the people rule below would hold it to a person's frame size.
    match: /^animal-[a-z0-9-]+-sheet$/,
    divisible: [ANIMAL.cols, ANIMAL.rows],
    note: 'an animal walk cycle: 4 frames across, 4 directions down',
  },
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

/**
 * The smallest box holding every drawn pixel of one row of frames.
 *
 * One box per row rather than one per frame. Per frame would trim each pose to
 * itself, and a cow trimmed pose by pose is a cow that changes size as its
 * legs move; the row's box is what that whole direction needs, and every frame
 * in it keeps its place inside that box.
 */
export function rowInkBounds(source, { frame, cols, row }) {
  let left = frame;
  let top = frame;
  let right = -1;
  let bottom = -1;
  for (let col = 0; col < cols; col += 1) {
    const originX = col * frame;
    const originY = row * frame;
    for (let y = 0; y < frame; y += 1) {
      for (let x = 0; x < frame; x += 1) {
        const at = ((originY + y) * source.width + originX + x) * 4 + 3;
        if (source.pixels[at] <= 8) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (right < 0) throw new Error(`Row ${row} of this cut is empty; check --frame and --row.`);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/**
 * Builds an animal sheet out of a downloaded one.
 *
 * Two things happen here, and the second is the point. The first is the same
 * cut `walkcycle` makes: four rows of four frames, in the LPC row order.
 *
 * The second is trimming. The LPC farm animals are drawn one to a 128px box
 * because that is the size of the largest of them rearing up, and a cow only
 * uses seventy pixels of it. Loaded as-is, every cow on the farm would carry
 * three times its own area in empty space — which costs nothing to draw, but
 * costs everything downstream: `displayHeight` is where the game hangs an
 * animal's shadow and its hunger marker, and on a padded frame that is a
 * measurement of the padding. So the frames are trimmed to one box that fits
 * the whole cycle, and what the game loads is an animal rather than an animal
 * in a crate.
 *
 * The box is grown to an even width and height so that the middle of a frame
 * is a whole pixel: these are drawn centred, and half a pixel of offset on a
 * nearest-neighbour sprite is a seam down the animal.
 */
export function animalcycle(source, { frame, startRow = 0 }) {
  const { cols, rows } = ANIMAL;
  if (source.width < cols * frame) {
    throw new Error(
      `--animals wants ${cols} frames of ${frame}px, which needs a source at least ` +
        `${cols * frame}px wide; this one is ${source.width}px.`,
    );
  }
  const needed = (startRow + rows) * frame;
  if (source.height < needed) {
    throw new Error(
      `--animals wants ${rows} rows of ${frame}px starting at row ${startRow}, which needs a ` +
        `source at least ${needed}px tall; this one is ${source.height}px.`,
    );
  }

  const boxes = [];
  for (let row = 0; row < rows; row += 1) {
    boxes.push(rowInkBounds(source, { frame, cols, row: startRow + row }));
  }

  // One frame size for the sheet, big enough for the widest and the tallest
  // direction. Even, so the middle of a frame is a whole pixel — these are
  // drawn centred, and half a pixel on a nearest-neighbour sprite is a seam.
  const widest = Math.max(...boxes.map((box) => box.width));
  const tallest = Math.max(...boxes.map((box) => box.height));
  const width = widest + (widest % 2);
  const height = tallest + (tallest % 2);

  const pixels = new Uint8Array(cols * width * rows * height * 4);
  const out = { width: cols * width, height: rows * height, pixels };
  for (let row = 0; row < rows; row += 1) {
    const box = boxes[row];
    // Centred across, and standing on the bottom edge.
    //
    // The bottom-alignment is the whole reason this is done per row. A cow
    // seen from behind fills a 72px box and the same cow seen from the side
    // fills 45 of it, so one box for all four directions left the side views
    // floating 23px above the frame's bottom edge — and the game hangs an
    // animal's shadow off `displayHeight`, which is the frame. The cow drifted
    // over its own shadow, and jumped 23px the moment it turned to face you.
    // Feet on the floor in every direction is the property that fixes both.
    const offsetX = Math.floor((width - box.width) / 2);
    const offsetY = height - box.height;
    for (let col = 0; col < cols; col += 1) {
      for (let y = 0; y < box.height; y += 1) {
        for (let x = 0; x < box.width; x += 1) {
          const from = (((startRow + row) * frame + box.top + y) * source.width + col * frame + box.left + x) * 4;
          const to = ((row * height + offsetY + y) * out.width + col * width + offsetX + x) * 4;
          pixels[to] = source.pixels[from];
          pixels[to + 1] = source.pixels[from + 1];
          pixels[to + 2] = source.pixels[from + 2];
          pixels[to + 3] = source.pixels[from + 3];
        }
      }
    }
  }
  return out;
}

/**
 * Swaps one set of colours for another, pixel for pixel.
 *
 * The LPC animal set has one bird in it, and this farm keeps two. A duck is
 * therefore a chicken in different feathers — which is not a fudge so much as
 * what a spritesheet recolour has always been, and it is what this repo
 * already does to put five villagers on two walk sheets. Doing it here rather
 * than with `setTint` at draw time is the difference between a bird with brown
 * feathers and an orange bill, and a bird with brown everything: a tint is one
 * multiply over the whole sprite, and a map is a decision per colour.
 *
 * Unlisted colours are left alone, so a partial map is a legal map: recolouring
 * a comb and leaving the body is a sentence you can write.
 */
export function recolour(image, map) {
  const from = new Map();
  for (const [a, b] of Object.entries(map)) from.set(a.toLowerCase(), rgba(b));
  const pixels = new Uint8Array(image.pixels);
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 8) continue;
    const key = [0, 1, 2].map((c) => pixels[i + c].toString(16).padStart(2, '0')).join('');
    const to = from.get(key);
    if (!to) continue;
    pixels[i] = to[0];
    pixels[i + 1] = to[1];
    pixels[i + 2] = to[2];
  }
  return { width: image.width, height: image.height, pixels };
}

/** `aabbcc:ddeeff,...` as an object, with every colour checked. */
export function parseRecolour(value) {
  const map = {};
  for (const pair of String(value).split(',')) {
    const [from, to] = pair.split(':');
    if (!/^#?[0-9a-fA-F]{6}$/.test(from ?? '') || !/^#?[0-9a-fA-F]{6}$/.test(to ?? '')) {
      throw new Error(
        `--recolour wants pairs like "efe9e7:9d7049" separated by commas, got "${pair}".`,
      );
    }
    map[from.replace('#', '').toLowerCase()] = `#${to.replace('#', '')}`;
  }
  return map;
}

/** The region of the source the flags select, before any scaling. */
export function cut(source, flags) {
  if (flags.walkcycle) {
    const startRow = flags.row === undefined ? WALK.defaultRow : numbers(flags.row, 1, 'row')[0];
    return walkcycle(source, startRow);
  }
  if (flags.animals) {
    if (flags.frame === undefined) {
      throw new Error('--animals needs --frame N, the size of one frame in the source sheet.');
    }
    const frame = numbers(flags.frame, 1, 'frame')[0];
    if (!Number.isInteger(frame) || frame < 1) throw new Error('--frame wants a whole number of pixels.');
    const startRow = flags.row === undefined ? 0 : numbers(flags.row, 1, 'row')[0];
    return animalcycle(source, { frame, startRow });
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
  if (!expected || flags.walkcycle || flags.animals) return 1;
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

  if (flags.recolour !== undefined) region = recolour(region, parseRecolour(flags.recolour));

  const image = upscale(region, scaleFor(region, expected, flags));
  const warnings = [];

  if (expected?.size) {
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

  // An animal sheet has no one right size — a chicken is smaller than a cow and
  // the sheet is trimmed to whatever the animal needs. What the game does rely
  // on is the grid: it divides the file by four each way to find a frame, so a
  // file that does not divide evenly is read off by a pixel on every frame but
  // the first.
  if (expected?.divisible) {
    const [byX, byY] = expected.divisible;
    if (image.width % byX !== 0 || image.height % byY !== 0) {
      const message =
        `${target} is ${expected.note}, so the game divides it ${byX} by ${byY} to find one ` +
        `frame — but ${image.width}x${image.height} does not divide evenly.`;
      if (!flags.force) throw new Error(`${message}
Use --animals, which cuts a sheet that does.`);
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
  animal-<kind>-sheet                          any size divisible by 4
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
  --animals        take ${ANIMAL.rows} rows of ${ANIMAL.cols} frames out of an animal sheet and trim
                   the empty space off every frame at once. Needs --frame.
  --frame N        the size of one frame in the source, for --animals. The LPC
                   farm animals are 128px; the chicken is 32px.
  --row N          which row the cycle starts at. Default ${WALK.defaultRow} with --walkcycle,
                   0 with --animals.
  --recolour A:B,C:D
                   swap colours, as six-digit hex pairs. Anything not listed is
                   left as it is. Applied after the cut and before any scaling.
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

  # A cow from the LPC farm animal set: 128px frames, walk rows first.
  node scripts/import-lpc.mjs downloads/cow_walk.png animal-cow-sheet --animals --frame 128

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
//
// `process.argv[1].endsWith('import-lpc.mjs')`, matching the idiom every
// other generator in this directory uses, not the exact-path comparison this
// used to be. `import.meta.filename === path.resolve(process.argv[1])` is
// prefix-blind in the wrong direction from `endsWith`: it looks precise, but
// it breaks under anything that changes how the entry path resolves —
// a symlinked checkout, a different working directory, `node --experimental-*`
// changing what `argv[1]` holds — where `endsWith` degrades gracefully.
// Standardising on one idiom also means there is only one guard pattern to
// audit for the "does importing this file run main()?" question this file's
// own comment above is answering.
if (process.argv[1] && process.argv[1].endsWith('import-lpc.mjs')) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`import-lpc: ${error.message}`);
    process.exit(1);
  }
}
