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
  ANIMAL,
  WALK,
  animalcycle,
  box,
  cut,
  expectationFor,
  parseFlags,
  parseRecolour,
  planImport,
  recolour,
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

    // And nothing empty in between. Checking only the two ends caught a prop
    // hovering over its own shadow and missed the other half of the same
    // mistake: `tree.png` had eight blank rows across its middle, so the crown
    // floated a body's width clear of its own trunk, and at zoom 2 that is a
    // sixteen-pixel hole with grass showing through it. A prop is one object
    // and arrives in one piece; a band of nothing through the middle of it is
    // a cut that took too much, every time.
    for (let y = 1; y < image.height - 1; y += 1) {
      assert.ok(!rowIsEmpty(y), `${file} row ${y} is empty, so the prop is drawn in two halves`);
    }
  }
});

/**
 * The people's sheets. `animal-*-sheet.png` is a sheet too, and a different
 * shape — four frames of whatever that animal needs rather than nine of 64px —
 * so the two are counted apart here the same way the manifest generator counts
 * them apart. A sheet read with the wrong frame size is a texture of slices.
 */
function peopleSheets() {
  return fs
    .readdirSync(ART_DIR)
    .filter((file) => file.endsWith('-sheet.png') && !file.startsWith('animal-'));
}

function animalSheets() {
  return fs
    .readdirSync(ART_DIR)
    .filter((file) => file.startsWith('animal-') && file.endsWith('-sheet.png'));
}

test('every walk sheet in the folder is a whole number of 64px frames, 9 by 4', () => {
  const sheets = peopleSheets();
  assert.ok(sheets.length > 0, 'expected at least one walk sheet');
  for (const file of sheets) {
    const image = decodePng(fs.readFileSync(path.join(ART_DIR, file)));
    assert.equal(image.width, WALK.frames * WALK.frame, `${file} width`);
    assert.equal(image.height, WALK.rows * WALK.frame, `${file} height`);
  }
});

test('every animal sheet divides into sixteen frames with an animal in each', () => {
  const sheets = animalSheets();
  assert.ok(sheets.length > 0, 'expected at least one animal sheet');
  for (const file of sheets) {
    const image = decodePng(fs.readFileSync(path.join(ART_DIR, file)));
    // The game finds a frame by dividing, so a file that does not divide is
    // every frame but the first read off by a pixel.
    assert.equal(image.width % ANIMAL.cols, 0, `${file} width does not divide ${ANIMAL.cols}`);
    assert.equal(image.height % ANIMAL.rows, 0, `${file} height does not divide ${ANIMAL.rows}`);

    // And an animal in every one of them. An empty frame is the cut having
    // taken the wrong rows — the goat's source has a grazing cycle under its
    // walk, and taking four rows from the wrong place is a hole in the amble
    // rather than an error.
    const frameWidth = image.width / ANIMAL.cols;
    const frameHeight = image.height / ANIMAL.rows;
    for (let row = 0; row < ANIMAL.rows; row += 1) {
      for (let col = 0; col < ANIMAL.cols; col += 1) {
        let ink = 0;
        for (let y = 0; y < frameHeight; y += 1) {
          for (let x = 0; x < frameWidth; x += 1) {
            const at = ((row * frameHeight + y) * image.width + col * frameWidth + x) * 4 + 3;
            if (image.pixels[at] > 8) ink += 1;
          }
        }
        assert.ok(ink > 0, `${file} frame ${col} of row ${row} is empty`);
      }
    }
  }
});

test('every animal stands on the bottom edge of its frame, whichever way it faces', () => {
  // The game hangs an animal's shadow and its hunger marker off the sprite's
  // `displayHeight`, which is the frame and not the animal. So a direction
  // with empty pixels under its feet is a direction drawn hovering over its
  // own shadow — and, worse, one that jumps the moment the animal turns to a
  // direction that has none. The cow shipped 23px of nothing under its side
  // views and none under its back view: it flew when walking east and landed
  // when walking north.
  for (const file of animalSheets()) {
    const image = decodePng(fs.readFileSync(path.join(ART_DIR, file)));
    const frameWidth = image.width / ANIMAL.cols;
    const frameHeight = image.height / ANIMAL.rows;
    for (let row = 0; row < ANIMAL.rows; row += 1) {
      let lowest = -1;
      for (let col = 0; col < ANIMAL.cols; col += 1) {
        for (let y = 0; y < frameHeight; y += 1) {
          for (let x = 0; x < frameWidth; x += 1) {
            const at = ((row * frameHeight + y) * image.width + col * frameWidth + x) * 4 + 3;
            if (image.pixels[at] > 8 && y > lowest) lowest = y;
          }
        }
      }
      assert.equal(
        lowest,
        frameHeight - 1,
        `${file} row ${row} leaves ${frameHeight - 1 - lowest}px under its feet, so it floats`,
      );
    }
  }
});

test('an animal cut stands each direction on the floor and centres it', () => {
  // A 4x4 sheet of 8px frames. Three rows draw a 2x2 mark high in the box and
  // one draws a 6x4 mark low in it — which is the shape of the real problem:
  // one direction needs far more of the source box than the others.
  const source = raster(32, 32);
  for (let col = 0; col < 4; col += 1) {
    for (const row of [0, 2, 3]) {
      source.set(col * 8 + 3, row * 8 + 0, '#ff0000');
      source.set(col * 8 + 4, row * 8 + 1, '#ff0000');
    }
    source.set(col * 8 + 1, 8 + 2, '#00ff00');
    source.set(col * 8 + 6, 8 + 5, '#0000ff');
  }
  const sheet = animalcycle({ width: 32, height: 32, pixels: source.pixels }, { frame: 8 });

  // One frame size for the sheet: as wide as the widest direction and as tall
  // as the tallest, so nothing changes size when it turns.
  assert.deepEqual([sheet.width, sheet.height], [4 * 6, 4 * 4]);

  // Every row's lowest drawn pixel is on the frame's bottom edge. This is the
  // property the whole per-row treatment exists for: the game hangs a shadow
  // off the frame, so a direction with air under its feet is drawn hovering.
  for (let row = 0; row < 4; row += 1) {
    let lowest = -1;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 6; x += 1) {
        if (at(sheet, x, row * 4 + y)[3] > 8 && y > lowest) lowest = y;
      }
    }
    assert.equal(lowest, 3, `row ${row} does not stand on the floor`);
  }

  // The short rows are centred across as well as dropped to the floor.
  assert.deepEqual(at(sheet, 2, 2), [255, 0, 0, 255]);
  assert.deepEqual(at(sheet, 3, 3), [255, 0, 0, 255]);
  // The tall row fills its frame, so it moves not at all.
  assert.deepEqual(at(sheet, 0, 4), [0, 255, 0, 255]);
  assert.deepEqual(at(sheet, 5, 7), [0, 0, 255, 255]);
});

test('an animal cut keeps the frames of one row in step with each other', () => {
  // Trimming is per row and never per frame. Per frame would fit each pose to
  // itself, and an animal whose every pose is fitted to itself is one that
  // changes size as its legs move.
  const source = raster(32, 32);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      // A body that stays put, and a foot that swings two pixels across.
      source.set(col * 8 + 2, row * 8 + 2, '#ff0000');
      source.set(col * 8 + 2 + (col % 2), row * 8 + 4, '#0000ff');
    }
  }
  const sheet = animalcycle({ width: 32, height: 32, pixels: source.pixels }, { frame: 8 });
  const frameWidth = sheet.width / 4;
  const frameHeight = sheet.height / 4;

  /** Where in frame `col` of row 0 the pixel of this colour ended up. */
  const find = (col, colour) => {
    for (let y = 0; y < frameHeight; y += 1) {
      for (let x = 0; x < frameWidth; x += 1) {
        const got = at(sheet, col * frameWidth + x, y);
        if (got[3] > 8 && got[0] === colour[0] && got[2] === colour[2]) return [x, y];
      }
    }
    return null;
  };

  const bodies = [0, 1, 2, 3].map((col) => find(col, [255, 0, 0]));
  const feet = [0, 1, 2, 3].map((col) => find(col, [0, 0, 255]));

  // The body is in the same place in all four frames: the row was trimmed as
  // one, so nothing drifted.
  for (const body of bodies) assert.deepEqual(body, bodies[0], 'the body moved between frames');
  // And the foot still swings, which is the animation the trim must not eat.
  assert.deepEqual(feet[0][0], feet[2][0]);
  assert.equal(feet[1][0] - feet[0][0], 1, 'the foot lost its swing');
});

test('an animal cut says so when it was pointed at empty rows', () => {
  const source = raster(32, 32);
  source.set(0, 0, '#ff0000');
  const image = { width: 32, height: 32, pixels: source.pixels };
  // Rows 4..7 of an 8px grid on a 32px source: past the bottom entirely.
  assert.throws(() => animalcycle(image, { frame: 8, startRow: 4 }), /at least 64px tall/);
  // In range, but nothing is drawn there — which is the quiet failure, because
  // a sheet of nothing loads perfectly well and draws nothing at all.
  assert.throws(() => animalcycle(image, { frame: 4, startRow: 4 }), /Row 4 of this cut is empty/);
});

test('a recolour swaps the colours it was given and leaves the rest', () => {
  const source = raster(3, 1);
  source.set(0, 0, '#efe9e7');
  source.set(1, 0, '#cf7b49');
  source.set(2, 0, '#222121');
  const out = recolour({ width: 3, height: 1, pixels: source.pixels }, parseRecolour('efe9e7:9d7049,cf7b49:ff7b3a'));
  assert.deepEqual(at(out, 0, 0), [0x9d, 0x70, 0x49, 255], 'body recoloured');
  assert.deepEqual(at(out, 1, 0), [0xff, 0x7b, 0x3a, 255], 'bill recoloured');
  assert.deepEqual(at(out, 2, 0), [0x22, 0x21, 0x21, 255], 'outline left alone');
});

test('a recolour leaves transparent pixels transparent', () => {
  // Every fully transparent pixel in a PNG this repo writes is black, so a map
  // that mentions black would otherwise paint the empty half of a sprite.
  const source = raster(2, 1);
  source.set(0, 0, '#000000');
  const out = recolour({ width: 2, height: 1, pixels: source.pixels }, parseRecolour('000000:ff0000'));
  assert.deepEqual(at(out, 0, 0), [255, 0, 0, 255], 'the drawn black is recoloured');
  assert.deepEqual(at(out, 1, 0), [0, 0, 0, 0], 'the empty pixel is untouched');
});

test('a recolour rejects anything that is not a pair of colours', () => {
  assert.throws(() => parseRecolour('efe9e7'), /pairs like/);
  assert.throws(() => parseRecolour('efe9e7:nope12'), /pairs like/);
  assert.throws(() => parseRecolour('efe9:112233'), /pairs like/);
});

test('no frame of a walk sheet is a solid block', () => {
  // A person drawn in a 64px box never fills it: there is sky round their
  // head and floor either side of their feet. So a frame with no transparent
  // pixel in it is not a pose at all, and the game will happily animate it —
  // which is exactly what shipped. The ninth column of both sheets was a
  // solid rectangle of one colour, the walk cycle ran through it, and a
  // square of flat dark green sat over the player once per stride.
  //
  // Stated as "no frame is solid" rather than "the frames the scene animates
  // are not solid", because the scene picks its own range and this file
  // cannot see it. The stronger rule needs no agreement between the two.
  const sheets = peopleSheets();
  for (const file of sheets) {
    const image = decodePng(fs.readFileSync(path.join(ART_DIR, file)));
    for (let row = 0; row < WALK.rows; row += 1) {
      for (let column = 0; column < WALK.frames; column += 1) {
        let opaque = 0;
        for (let y = 0; y < WALK.frame; y += 1) {
          for (let x = 0; x < WALK.frame; x += 1) {
            const at = ((row * WALK.frame + y) * image.width + column * WALK.frame + x) * 4;
            if (image.pixels[at + 3] > 8) opaque += 1;
          }
        }
        assert.ok(
          opaque < WALK.frame * WALK.frame,
          `${file} frame ${column} of row ${row} is opaque to the edges, so it is a block and ` +
            'not a pose',
        );
      }
    }
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

// --- --box and --floor -------------------------------------------------------

/** The lowest y with an opaque pixel anywhere in that row, or -1 if none. */
function lowestInkRow(image) {
  let lowest = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (at(image, x, y)[3] > 8) {
        lowest = y;
        break;
      }
    }
  }
  return lowest;
}

test('--box puts the lowest drawn row exactly on --floor', () => {
  const source = raster(4, 4);
  source.set(1, 3, '#ff0000'); // the only ink, on the cut's own bottom row
  const image = { width: 4, height: 4, pixels: source.pixels };
  const out = box(image, { width: 10, height: 20, floor: 15, target: 'test' });
  assert.equal(lowestInkRow(out), 15);
  assert.deepEqual([out.width, out.height], [10, 20]);
});

test('--box without --floor sits the content on the box\'s bottom edge', () => {
  const source = raster(4, 4);
  source.set(1, 1, '#ff0000'); // ink well clear of the cut's own bottom row
  const image = { width: 4, height: 4, pixels: source.pixels };
  const out = box(image, { width: 10, height: 20, target: 'test' });
  assert.equal(lowestInkRow(out), 19);
});

test('--box centres on the drawn pixels, not on the cut rectangle', () => {
  // A 10px-wide cut whose ink is a 2px mark stuck against the left edge, on
  // the cut's own bottom row (row 3 of 4) so the box's bottom-edge default
  // does not also move it vertically — this test isolates the horizontal
  // centring only.
  const source = raster(10, 4);
  source.set(1, 3, '#ff0000');
  source.set(2, 3, '#ff0000');
  const image = { width: 10, height: 4, pixels: source.pixels };
  const out = box(image, { width: 20, height: 4, target: 'test' });

  // Centred on the 2px mark in a 20px box lands it at x 9-10. Centred on the
  // cut's own 10px rectangle instead — the wrong answer this test exists to
  // catch — would have shifted the whole 10px cut by (20-10)/2 = 5 and left
  // the mark at x 6-7.
  assert.deepEqual(at(out, 9, 3), [255, 0, 0, 255]);
  assert.deepEqual(at(out, 10, 3), [255, 0, 0, 255]);
  assert.deepEqual(at(out, 6, 3), [0, 0, 0, 0]);
  assert.deepEqual(at(out, 7, 3), [0, 0, 0, 0]);
});

test('a cut that already fills its box comes out unchanged', () => {
  const source = raster(4, 4);
  // Ink touching every edge, top row and bottom row both full width: there is
  // no padding left for --box to add, so this should be a pure pass-through.
  for (let x = 0; x < 4; x += 1) {
    source.set(x, 0, '#ff0000');
    source.set(x, 3, '#00ff00');
  }
  const image = { width: 4, height: 4, pixels: source.pixels };
  const out = box(image, { width: 4, height: 4, target: 'test' });
  assert.deepEqual([...out.pixels], [...image.pixels]);
});

test('--box refuses a cut too big to fit, naming the target and both sizes', () => {
  const image = { width: 40, height: 50, pixels: new Uint8Array(40 * 50 * 4) };
  assert.throws(() => box(image, { width: 30, height: 50, target: 'weed-1' }), /weed-1/);
  assert.throws(() => box(image, { width: 30, height: 50, target: 'weed-1' }), /40x50/);
  assert.throws(() => box(image, { width: 30, height: 50, target: 'weed-1' }), /30x50/);
});

test('a fully transparent cut does not crash --box, and still gets the empty-cut warning', () => {
  const image = { width: 4, height: 4, pixels: new Uint8Array(4 * 4 * 4) };
  const out = box(image, { width: 10, height: 10, floor: 8, target: 'test' });
  assert.deepEqual([out.width, out.height], [10, 10]);
  assert.ok(out.pixels.every((byte) => byte === 0));

  const plan = planImport(image, 'tree', { box: '10x10', floor: '8' });
  assert.match(plan.warnings[0], /every pixel of this cut is transparent/);
});

test('--floor needs --box', () => {
  const source = { width: 4, height: 4, pixels: new Uint8Array(4 * 4 * 4) };
  assert.throws(() => planImport(source, 'tree', { floor: '74' }), /--floor needs --box/);
});

test('--box applies after --scale, so its WxH is the size actually written', () => {
  // A 16x16 cut doubled by --scale 2 to 32x32, then boxed into 64x64. If
  // --box ran before --scale instead, the 64x64 canvas would itself get
  // doubled to 128x128 — the wrong order this test would catch.
  const sheet = raster(16, 16);
  sheet.set(0, 15, '#ff0000');
  const plan = planImport({ width: 16, height: 16, pixels: sheet.pixels }, 'tree', {
    scale: '2',
    box: '64x64',
    floor: '63',
  });
  assert.deepEqual([plan.image.width, plan.image.height], [64, 64]);
});

test('a too-large --box is refused end to end through planImport', () => {
  const source = { width: 40, height: 50, pixels: new Uint8Array(40 * 50 * 4) };
  assert.throws(() => planImport(source, 'tree', { box: '30x50' }), /tree/);
});
