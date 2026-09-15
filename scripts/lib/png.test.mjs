/**
 * Tests for the PNG reader and the cutting the importer does with it.
 *
 * Run by `node --test`, not vitest: these cover build scripts, which are plain
 * ESM that never goes through the app's TypeScript project. The app's own
 * tests stay where they are.
 *
 * The decoder is worth this much attention because it is the one piece of this
 * repo that reads a file somebody else wrote. A sprite decoded slightly wrong
 * does not throw — it ships, and it looks like bad art.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import {
  composite,
  decodePng,
  encodeImage,
  encodePng,
  flip,
  raster,
  sliceRect,
  upscale,
} from './png.mjs';
import {
  WALK,
  cut,
  expectationFor,
  parseFlags,
  planImport,
  readSource,
  scaleFor,
  walkcycle,
} from '../import-lpc.mjs';

const ART_DIR = path.join('public', 'assets', 'lpc');

// --- building PNGs the encoder cannot make ----------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * A PNG of whatever shape the test needs.
 *
 * `lines` is the already-filtered scanline data, each entry `[filterType,
 * bytes]`, so a test can hand the decoder a file that uses a filter the
 * encoder in this repo never emits.
 */
function buildPng({ width, height, depth = 8, colour = 6, lines, palette, alphas }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = colour;
  const chunks = [chunk('IHDR', header)];
  if (palette) chunks.push(chunk('PLTE', Buffer.from(palette)));
  if (alphas) chunks.push(chunk('tRNS', Buffer.from(alphas)));
  const raw = Buffer.concat(lines.map(([filter, bytes]) => Buffer.concat([Buffer.from([filter]), Buffer.from(bytes)])));
  chunks.push(chunk('IDAT', zlib.deflateSync(raw)));
  chunks.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
}

/** The pixel at (x, y), as the four numbers, so failures read as colours. */
function at(image, x, y) {
  const i = (y * image.width + x) * 4;
  return [...image.pixels.slice(i, i + 4)];
}

/** A small image with a different colour in every corner. */
function corners() {
  const sheet = raster(4, 4);
  sheet.set(0, 0, '#ff0000');
  sheet.set(3, 0, '#00ff00');
  sheet.set(0, 3, '#0000ff');
  sheet.set(3, 3, '#ffffff80');
  return { width: 4, height: 4, pixels: sheet.pixels };
}

// --- the decoder ------------------------------------------------------------

test('decodes what the encoder wrote, pixel for pixel', () => {
  const original = corners();
  const decoded = decodePng(encodeImage(original));
  assert.equal(decoded.width, 4);
  assert.equal(decoded.height, 4);
  assert.deepEqual([...decoded.pixels], [...original.pixels]);
});

test('reads every PNG already in the art folder at the size the game wants', () => {
  const sizes = {
    'tile-grass.png': [32, 32],
    'plot-tilled.png': [32, 32],
    'crop-turnip.png': [32, 32],
    'player-sheet.png': [576, 256],
    'rowan-sheet.png': [576, 256],
    'tree.png': [96, 136],
    'farmhouse.png': [160, 109],
  };
  for (const [file, [width, height]] of Object.entries(sizes)) {
    const image = decodePng(fs.readFileSync(path.join(ART_DIR, file)));
    assert.deepEqual([image.width, image.height], [width, height], file);
    assert.equal(image.pixels.length, width * height * 4, file);
  }
});

test('the free-size props have no empty rows to float them off the ground', () => {
  // A prop is drawn to the width of its Tiled footprint and stands on the
  // footprint's bottom edge, so an empty row at the bottom of the PNG is a gap
  // between the building and its own shadow. `farmhouse.png` was cut out of a
  // 160x160 window with a tile of nothing under it, and the house hovered a
  // tile above the road for it.
  //
  // Only the props the importer lets be any size are checked. A 32px prop is
  // one tile of art placed as one tile, and where it sits inside that tile is
  // the drawing's business.
  for (const file of ['tree.png', 'farmhouse.png']) {
    const image = decodePng(fs.readFileSync(path.join(ART_DIR, file)));
    const rowIsEmpty = (y) => {
      for (let x = 0; x < image.width; x += 1) {
        if (image.pixels[(y * image.width + x) * 4 + 3] > 8) return false;
      }
      return true;
    };
    assert.ok(!rowIsEmpty(image.height - 1), `${file} ends in a transparent row, so it will float`);
    assert.ok(!rowIsEmpty(0), `${file} starts with a transparent row`);
  }
});

test('every walk sheet in the folder is a whole number of 64px frames, 9 by 4', () => {
  const sheets = fs.readdirSync(ART_DIR).filter((file) => file.endsWith('-sheet.png'));
  assert.ok(sheets.length > 0, 'expected at least one walk sheet');
  for (const file of sheets) {
    const image = decodePng(fs.readFileSync(path.join(ART_DIR, file)));
    assert.equal(image.width, WALK.frames * WALK.frame, `${file} width`);
    assert.equal(image.height, WALK.rows * WALK.frame, `${file} height`);
  }
});

test('undoes all five scanline filters', () => {
  // Two rows of two RGBA pixels, chosen so every filter's predictor differs.
  const rows = [
    [10, 20, 30, 255, 40, 60, 80, 255],
    [50, 70, 90, 255, 200, 150, 100, 255],
  ];
  const bpp = 4;
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
  };
  const encode = (filter, row, prior) =>
    row.map((value, i) => {
      const left = i >= bpp ? row[i - bpp] : 0;
      const up = prior[i];
      const upLeft = i >= bpp ? prior[i - bpp] : 0;
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
      return (value - predictor) & 0xff;
    });

  for (let filter = 0; filter <= 4; filter += 1) {
    const buffer = buildPng({
      width: 2,
      height: 2,
      lines: [
        [filter, encode(filter, rows[0], new Array(8).fill(0))],
        [filter, encode(filter, rows[1], rows[0])],
      ],
    });
    const image = decodePng(buffer);
    assert.deepEqual([...image.pixels], [...rows[0], ...rows[1]], `filter ${filter}`);
  }
});

test('reads indexed colour, including transparency from tRNS', () => {
  const buffer = buildPng({
    width: 2,
    height: 1,
    depth: 8,
    colour: 3,
    palette: [255, 0, 0, 0, 0, 255],
    alphas: [0], // index 0 is fully transparent; index 1 has no entry, so opaque
    lines: [[0, [0, 1]]],
  });
  const image = decodePng(buffer);
  assert.deepEqual(at(image, 0, 0), [255, 0, 0, 0]);
  assert.deepEqual(at(image, 1, 0), [0, 0, 255, 255]);
});

test('reads sub-byte indexed colour, where two pixels share a byte', () => {
  const buffer = buildPng({
    width: 4,
    height: 1,
    depth: 2,
    colour: 3,
    palette: [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255],
    // 0b00_01_10_11 — one byte holding indices 0, 1, 2, 3.
    lines: [[0, [0b00011011]]],
  });
  const image = decodePng(buffer);
  assert.deepEqual(at(image, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(at(image, 1, 0), [255, 0, 0, 255]);
  assert.deepEqual(at(image, 2, 0), [0, 255, 0, 255]);
  assert.deepEqual(at(image, 3, 0), [0, 0, 255, 255]);
});

test('reads greyscale, with and without an alpha channel', () => {
  const grey = decodePng(buildPng({ width: 2, height: 1, colour: 0, lines: [[0, [0, 255]]] }));
  assert.deepEqual(at(grey, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(at(grey, 1, 0), [255, 255, 255, 255]);

  const alpha = decodePng(buildPng({ width: 2, height: 1, colour: 4, lines: [[0, [128, 0, 128, 255]]] }));
  assert.deepEqual(at(alpha, 0, 0), [128, 128, 128, 0]);
  assert.deepEqual(at(alpha, 1, 0), [128, 128, 128, 255]);
});

test('reads RGB without alpha as fully opaque', () => {
  const image = decodePng(buildPng({ width: 1, height: 1, colour: 2, lines: [[0, [12, 34, 56]]] }));
  assert.deepEqual(at(image, 0, 0), [12, 34, 56, 255]);
});

test('keeps the high byte of 16-bit samples', () => {
  const image = decodePng(
    buildPng({ width: 1, height: 1, depth: 16, colour: 6, lines: [[0, [0x12, 0xff, 0x34, 0x00, 0x56, 0x99, 0xff, 0xff]]] }),
  );
  assert.deepEqual(at(image, 0, 0), [0x12, 0x34, 0x56, 0xff]);
});

test('refuses files it would otherwise garble', () => {
  assert.throws(() => decodePng(Buffer.from('not a png at all, really')), /Not a PNG/);

  const interlaced = buildPng({ width: 1, height: 1, lines: [[0, [0, 0, 0, 255]]] });
  // The interlace byte is the last of IHDR's thirteen: 8 signature + 8 chunk
  // header + 12 into the data.
  interlaced[8 + 8 + 12] = 1;
  const fixed = Buffer.concat([
    interlaced.subarray(0, 8),
    chunk('IHDR', interlaced.subarray(16, 29)),
    interlaced.subarray(33),
  ]);
  assert.throws(() => decodePng(fixed), /Interlaced/);
});

// --- cutting ----------------------------------------------------------------

test('slices the region asked for', () => {
  const image = sliceRect(corners(), 3, 0, 1, 1);
  assert.deepEqual([image.width, image.height], [1, 1]);
  assert.deepEqual(at(image, 0, 0), [0, 255, 0, 255]);
});

test('slices past the edge as transparent rather than failing', () => {
  const image = sliceRect(corners(), 3, 3, 2, 2);
  assert.deepEqual(at(image, 0, 0), [255, 255, 255, 0x80]);
  assert.deepEqual(at(image, 1, 0), [0, 0, 0, 0]);
  assert.deepEqual(at(image, 1, 1), [0, 0, 0, 0]);
});

test('upscales by repeating pixels, never by blending them', () => {
  const image = upscale(corners(), 2);
  assert.deepEqual([image.width, image.height], [8, 8]);
  // The red corner becomes a 2x2 block of exactly red — no halfway colours.
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    assert.deepEqual(at(image, x, y), [255, 0, 0, 255], `${x},${y}`);
  }
  assert.deepEqual(at(image, 7, 0), [0, 255, 0, 255]);
});

test('upscaling by one is the image itself, and fractions are refused', () => {
  const image = corners();
  assert.equal(upscale(image, 1), image);
  assert.throws(() => upscale(image, 1.5), /whole number/);
  assert.throws(() => upscale(image, 0), /whole number/);
});

test('the encoder still rejects a pixel buffer of the wrong length', () => {
  assert.throws(() => encodePng(2, 2, new Uint8Array(4)), /Expected 16 bytes/);
});

// --- stacking layers --------------------------------------------------------

test('stacks layers first to last, so the head lands on the body', () => {
  const body = raster(1, 1);
  body.set(0, 0, '#ff0000');
  const head = raster(1, 1);
  head.set(0, 0, '#00ff00');
  const stacked = composite([
    { width: 1, height: 1, pixels: body.pixels },
    { width: 1, height: 1, pixels: head.pixels },
  ]);
  assert.deepEqual(at(stacked, 0, 0), [0, 255, 0, 255]);
});

test('lets a transparent part of a layer show what is underneath', () => {
  const under = raster(2, 1);
  under.set(0, 0, '#ff0000');
  under.set(1, 0, '#ff0000');
  const over = raster(2, 1);
  over.set(0, 0, '#0000ff'); // covers the left pixel; the right one is left empty
  const stacked = composite([
    { width: 2, height: 1, pixels: under.pixels },
    { width: 2, height: 1, pixels: over.pixels },
  ]);
  assert.deepEqual(at(stacked, 0, 0), [0, 0, 255, 255]);
  assert.deepEqual(at(stacked, 1, 0), [255, 0, 0, 255]);
});

test('blends a half-transparent layer rather than replacing what is under it', () => {
  const under = raster(1, 1);
  under.set(0, 0, '#000000');
  const over = raster(1, 1);
  over.set(0, 0, '#ffffff80');
  const stacked = composite([
    { width: 1, height: 1, pixels: under.pixels },
    { width: 1, height: 1, pixels: over.pixels },
  ]);
  const [r, g, b, a] = at(stacked, 0, 0);
  assert.equal(a, 255);
  // Halfway between black and white, give or take the rounding.
  for (const channel of [r, g, b]) assert.ok(Math.abs(channel - 128) <= 1, `got ${channel}`);
});

test('refuses to stack layers that are not the same size', () => {
  const a = { width: 2, height: 2, pixels: new Uint8Array(16) };
  const b = { width: 3, height: 2, pixels: new Uint8Array(24) };
  assert.throws(() => composite([a, b]), /same size/);
  assert.throws(() => composite([]), /Nothing to composite/);
});

test('reads a folder of layers in file-name order, which is the generator z-order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lpc-layers-'));
  try {
    // The character generator's own naming: a numeric prefix that sorts into
    // the order the layers are meant to be drawn in.
    const layer = (hex) => {
      const sheet = raster(1, 1);
      sheet.set(0, 0, hex);
      return encodeImage({ width: 1, height: 1, pixels: sheet.pixels });
    };
    fs.writeFileSync(path.join(dir, '010 body_color__light_.png'), layer('#ff0000'));
    fs.writeFileSync(path.join(dir, '100 human_male__light_.png'), layer('#00ff00'));
    fs.writeFileSync(path.join(dir, '101 neutral__light_.png'), layer('#0000ff'));
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');

    const { image, layers } = readSource(dir);
    assert.equal(layers.length, 3, 'the .txt should not be treated as a layer');
    assert.equal(layers[0], '010 body_color__light_.png');
    assert.deepEqual(at(image, 0, 0), [0, 0, 255, 255], 'the last layer is on top');

    // A single file is still a single file.
    const one = readSource(path.join(dir, '010 body_color__light_.png'));
    assert.deepEqual(one.layers, ['010 body_color__light_.png']);
    assert.deepEqual(at(one.image, 0, 0), [255, 0, 0, 255]);

    fs.rmSync(path.join(dir, '010 body_color__light_.png'));
    fs.rmSync(path.join(dir, '100 human_male__light_.png'));
    fs.rmSync(path.join(dir, '101 neutral__light_.png'));
    assert.throws(() => readSource(dir), /No PNGs/);
    assert.throws(() => readSource(path.join(dir, 'gone.png')), /No such file or folder/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mirrors an image without changing a single colour', () => {
  const image = corners();
  const mirrored = flip(image, { x: true });
  // The red corner was top-left; mirrored it is top-right.
  assert.deepEqual(at(mirrored, 3, 0), [255, 0, 0, 255]);
  assert.deepEqual(at(mirrored, 0, 0), [0, 255, 0, 255]);

  const flipped = flip(image, { y: true });
  assert.deepEqual(at(flipped, 0, 3), [255, 0, 0, 255]);

  const both = flip(image, { x: true, y: true });
  assert.deepEqual(at(both, 3, 3), [255, 0, 0, 255]);

  // The whole point of mirroring a tile is that the palette is untouched, so
  // anything drawn to match the original still matches the mirror.
  const tally = (img) => [...img.pixels].join(',').length && [...img.pixels].reduce((n, b) => n + b, 0);
  assert.equal(tally(mirrored), tally(image));
  assert.equal(tally(both), tally(image));
});

test('flipping on no axis is the image itself, and a bad axis is refused', () => {
  const image = corners();
  assert.equal(flip(image), image);
  assert.equal(flip(image, {}), image);
  assert.throws(() => planImport(image, 'tile-grass-x', { flip: 'z' }), /--flip wants x, y or xy/);
});

test('--flip mirrors what the importer writes', () => {
  const sheet = raster(32, 32);
  sheet.set(0, 0, '#ff0000');
  const source = { width: 32, height: 32, pixels: sheet.pixels };
  const plain = planImport(source, 'tile-grass-a');
  const mirrored = planImport(source, 'tile-grass-b', { flip: 'x' });
  assert.deepEqual(at(plain.image, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(at(mirrored.image, 31, 0), [255, 0, 0, 255]);
  assert.deepEqual(at(mirrored.image, 0, 0), [0, 0, 0, 0]);
});

// --- the importer's decisions ----------------------------------------------

test('reads flags with and without values', () => {
  assert.deepEqual(parseFlags(['--grid', '16', '--cell', '2,3', '--walkcycle']), {
    grid: '16',
    cell: '2,3',
    walkcycle: true,
  });
  assert.throws(() => parseFlags(['grid']), /Unexpected argument/);
});

test('knows the size the game needs for each kind of name', () => {
  assert.deepEqual(expectationFor('tile-path').size, [32, 32]);
  assert.deepEqual(expectationFor('crop-tomato').size, [32, 32]);
  assert.deepEqual(expectationFor('maeve-sheet').size, [576, 256]);
  assert.equal(expectationFor('tree'), null);
  assert.equal(expectationFor('farmhouse'), null);
});

test('--grid and --cell pick the cell, counting from zero', () => {
  const sheet = raster(4, 4);
  sheet.set(2, 2, '#ff0000');
  const source = { width: 4, height: 4, pixels: sheet.pixels };
  const image = cut(source, { grid: '2', cell: '1,1' });
  assert.deepEqual([image.width, image.height], [2, 2]);
  assert.deepEqual(at(image, 0, 0), [255, 0, 0, 255]);
});

test('a 16px cell is doubled to the 32px tile the world is drawn on', () => {
  const source = { width: 16, height: 16, pixels: new Uint8Array(16 * 16 * 4) };
  assert.equal(scaleFor(source, expectationFor('crop-tomato'), {}), 2);
  // An explicit scale always wins over the guess.
  assert.equal(scaleFor(source, expectationFor('crop-tomato'), { scale: '3' }), 3);
  // Already the right size, so leave it alone.
  const big = { width: 32, height: 32, pixels: new Uint8Array(32 * 32 * 4) };
  assert.equal(scaleFor(big, expectationFor('crop-tomato'), {}), 1);
});

test('lifts the four walk rows out of a character-generator export', () => {
  // The generator's layout: 13 columns, 21 rows, walking at rows 8 to 11.
  const width = 13 * WALK.frame;
  const height = 21 * WALK.frame;
  const pixels = new Uint8Array(width * height * 4);
  // Mark the first pixel of the first walk row, which is what should survive.
  const mark = (8 * WALK.frame * width + 0) * 4;
  pixels[mark] = 255;
  pixels[mark + 3] = 255;

  const sheet = walkcycle({ width, height, pixels });
  assert.deepEqual([sheet.width, sheet.height], [576, 256]);
  assert.deepEqual(at(sheet, 0, 0), [255, 0, 0, 255]);
});

test('says which way the source is too small for a walk cycle', () => {
  const short = { width: 832, height: 256, pixels: new Uint8Array(832 * 256 * 4) };
  assert.throws(() => walkcycle(short), /at least 768px tall/);
  const narrow = { width: 256, height: 1344, pixels: new Uint8Array(256 * 1344 * 4) };
  assert.throws(() => walkcycle(narrow), /at least 576px wide/);
});

test('refuses a cut that is not the size the game reads, and says how to fix it', () => {
  const source = { width: 24, height: 24, pixels: new Uint8Array(24 * 24 * 4) };
  assert.throws(() => planImport(source, 'tile-path'), /the game reads it as 32x32, but this cut is 24x24/);
  assert.throws(() => planImport(source, 'tile-path'), /--scale/);

  // --force is the escape hatch, and it warns rather than going quiet.
  const forced = planImport(source, 'tile-path', { force: true });
  assert.deepEqual([forced.image.width, forced.image.height], [24, 24]);
  assert.match(forced.warnings[0], /--force/);
});

test('warns when the cut landed entirely off the source', () => {
  const sheet = raster(64, 32);
  sheet.set(0, 0, '#ff0000');
  const source = { width: 64, height: 32, pixels: sheet.pixels };

  // Cell 9,9 of a 4x2 sheet: a valid PNG of nothing, which is the failure
  // that otherwise only shows up as a crop that never appears.
  const missed = planImport(source, 'crop-tomato', { grid: '16', cell: '9,9' });
  assert.match(missed.warnings[0], /entirely transparent|every pixel/);
  assert.match(missed.warnings[0], /64x32/);

  // And a cell that is really there says nothing.
  assert.deepEqual(planImport(source, 'crop-tomato', { grid: '16', cell: '0,0' }).warnings, []);
});

test('lets through the names the game has no size rule for', () => {
  const sheet = raster(96, 136);
  sheet.set(0, 0, '#2f6b2f');
  const plan = planImport({ width: 96, height: 136, pixels: sheet.pixels }, 'tree');
  assert.deepEqual([plan.image.width, plan.image.height], [96, 136]);
  assert.deepEqual(plan.warnings, []);
});

test('rejects target names that are not file names', () => {
  const source = corners();
  for (const bad of ['Tile-Path', 'tile path', 'tile-path.png', '../escape']) {
    assert.throws(() => planImport(source, bad), /lower-case letters/, bad);
  }
});

test('a 16x16 crop pack cell survives the whole trip to a file on disk', () => {
  const sheet = raster(16, 16);
  sheet.set(0, 0, '#c0ffee');
  const plan = planImport({ width: 16, height: 16, pixels: sheet.pixels }, 'crop-tomato');
  const written = decodePng(encodeImage(plan.image));
  assert.deepEqual([written.width, written.height], [32, 32]);
  // One source pixel became a 2x2 block of exactly the same colour.
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    assert.deepEqual(at(written, x, y), [0xc0, 0xff, 0xee, 255], `${x},${y}`);
  }
});
