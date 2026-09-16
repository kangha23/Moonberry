/**
 * A PNG writer, because the frame has to be a file.
 *
 * The wooden frame is one image used twice — `border-image` in the stylesheet
 * and a nine-slice in the canvas — and that only works if it is a real file
 * rather than something each side draws for itself. Two drawings of the same
 * border is exactly the split this repo has been closing.
 *
 * Written by hand rather than with a library: `node:zlib` does the only hard
 * part, and a build-time dependency for forty lines of chunk framing is not a
 * trade worth making.
 */
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
 * Encodes 8-bit RGBA pixels as a PNG.
 *
 * Every scanline uses filter 0. Filtering is for photographs; these are flat
 * blocks of colour a few dozen pixels across, where deflate alone already
 * gets them down to nothing.
 */
export function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) {
    throw new Error(`Expected ${width * height * 4} bytes of RGBA, got ${rgba.length}.`);
  }

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** `#rrggbb` or `#rrggbbaa` to the four bytes the raster wants. */
export function rgba(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 6 ? `${value}ff` : value;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
    parseInt(full.slice(6, 8), 16),
  ];
}

/** A blank raster and a setter, so the drawing code reads like drawing code. */
export function raster(width, height) {
  const pixels = new Uint8Array(width * height * 4);
  return {
    pixels,
    set(x, y, hex) {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const [r, g, b, a] = rgba(hex);
      const at = (y * width + x) * 4;
      pixels[at] = r;
      pixels[at + 1] = g;
      pixels[at + 2] = b;
      pixels[at + 3] = a;
    },
  };
}

// --- reading ----------------------------------------------------------------

/**
 * The other direction, because importing art means reading somebody else's PNG.
 *
 * The encoder above only ever has to write one shape of file: 8-bit RGBA, no
 * filtering, no palette. A decoder gets no such luxury — LPC sheets come off
 * OpenGameArt and the character generator as indexed colour as often as not,
 * and a downloaded tileset is whatever the artist's editor felt like emitting.
 * So this handles the whole of the non-interlaced format: every bit depth,
 * every colour type, all five filters, and `tRNS` for the indexed files where
 * the transparency lives outside the palette.
 *
 * Interlaced files are refused rather than half-supported. Adam7 is a page of
 * code to read a format nobody exports pixel art in, and a clear error beats a
 * subtly scrambled sprite.
 */

/** How many samples a pixel has, per colour type. */
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Paeth, straight from the spec. The one filter that is not obvious. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Undoes one scanline's filter, in place, against the line above it. */
function unfilter(type, line, prior, bpp) {
  switch (type) {
    case 0:
      return;
    case 1:
      for (let i = bpp; i < line.length; i += 1) line[i] = (line[i] + line[i - bpp]) & 0xff;
      return;
    case 2:
      for (let i = 0; i < line.length; i += 1) line[i] = (line[i] + prior[i]) & 0xff;
      return;
    case 3:
      for (let i = 0; i < line.length; i += 1) {
        const left = i >= bpp ? line[i - bpp] : 0;
        line[i] = (line[i] + ((left + prior[i]) >> 1)) & 0xff;
      }
      return;
    case 4:
      for (let i = 0; i < line.length; i += 1) {
        const left = i >= bpp ? line[i - bpp] : 0;
        const upLeft = i >= bpp ? prior[i - bpp] : 0;
        line[i] = (line[i] + paeth(left, prior[i], upLeft)) & 0xff;
      }
      return;
    default:
      throw new Error(`Unknown PNG filter type ${type}.`);
  }
}

/**
 * Pulls one scanline apart into samples.
 *
 * Sub-byte depths are bit-packed left to right; 16-bit samples keep only their
 * high byte, which is the whole of the precision a pixel-art pipeline can use.
 */
function readSamples(line, count, depth) {
  const out = new Uint8Array(count);
  if (depth === 8) {
    out.set(line.subarray(0, count));
    return out;
  }
  if (depth === 16) {
    for (let i = 0; i < count; i += 1) out[i] = line[i * 2];
    return out;
  }
  const mask = (1 << depth) - 1;
  for (let i = 0; i < count; i += 1) {
    const bit = i * depth;
    out[i] = (line[bit >> 3] >> (8 - depth - (bit & 7))) & mask;
  }
  return out;
}

/**
 * Decodes a PNG to the same `{ width, height, pixels }` shape `raster` makes,
 * so a decoded image and a drawn one are the same thing to everything below.
 */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG file.');

  let header = null;
  let palette = null;
  let alphas = null;
  const parts = [];

  for (let pos = 8; pos + 8 <= buffer.length; ) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString('ascii', pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    pos += 12 + length;
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colour: data[9],
        interlace: data[12],
      };
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') alphas = Buffer.from(data);
    else if (type === 'IDAT') parts.push(data);
    else if (type === 'IEND') break;
  }

  if (!header) throw new Error('PNG has no IHDR chunk.');
  const { width, height, depth, colour, interlace } = header;
  if (interlace !== 0) {
    throw new Error('Interlaced PNGs are not supported. Re-save the file without interlacing.');
  }
  const channels = CHANNELS[colour];
  if (!channels) throw new Error(`Unknown PNG colour type ${colour}.`);
  if (colour === 3 && !palette) throw new Error('Indexed PNG has no PLTE chunk.');

  const raw = zlib.inflateSync(Buffer.concat(parts));
  const bpp = Math.max(1, Math.ceil((channels * depth) / 8));
  const stride = Math.ceil((width * channels * depth) / 8);
  const pixels = new Uint8Array(width * height * 4);
  // The spec's "previous scanline is all zero for row one", allocated once.
  let prior = new Uint8Array(stride);
  // Sub-byte greyscale is a fraction of full white, not an index into one.
  const spread = depth < 8 && colour !== 3 ? 255 / ((1 << depth) - 1) : 1;

  for (let y = 0; y < height; y += 1) {
    const at = y * (stride + 1);
    if (at + 1 + stride > raw.length) {
      throw new Error('PNG pixel data is shorter than its header claims.');
    }
    const line = new Uint8Array(raw.subarray(at + 1, at + 1 + stride));
    unfilter(raw[at], line, prior, bpp);
    prior = line;

    const samples = readSamples(line, width * channels, depth);
    for (let x = 0; x < width; x += 1) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      if (colour === 3) {
        const index = samples[from];
        pixels[to] = palette[index * 3];
        pixels[to + 1] = palette[index * 3 + 1];
        pixels[to + 2] = palette[index * 3 + 2];
        pixels[to + 3] = alphas && index < alphas.length ? alphas[index] : 255;
      } else if (colour === 0 || colour === 4) {
        const grey = Math.round(samples[from] * spread);
        pixels[to] = grey;
        pixels[to + 1] = grey;
        pixels[to + 2] = grey;
        pixels[to + 3] = colour === 4 ? samples[from + 1] : 255;
      } else {
        pixels[to] = Math.round(samples[from] * spread);
        pixels[to + 1] = Math.round(samples[from + 1] * spread);
        pixels[to + 2] = Math.round(samples[from + 2] * spread);
        pixels[to + 3] = colour === 6 ? samples[from + 3] : 255;
      }
    }
  }

  return { width, height, pixels };
}

// --- cutting ----------------------------------------------------------------

/**
 * Takes a rectangle out of an image.
 *
 * Out-of-bounds reads come back transparent rather than throwing, because the
 * last cell of a tileset row is routinely a few pixels short of the grid the
 * sheet claims to be on, and refusing to import it helps nobody.
 */
export function sliceRect(image, x, y, width, height) {
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceY = y + row;
    if (sourceY < 0 || sourceY >= image.height) continue;
    for (let col = 0; col < width; col += 1) {
      const sourceX = x + col;
      if (sourceX < 0 || sourceX >= image.width) continue;
      const from = (sourceY * image.width + sourceX) * 4;
      const to = (row * width + col) * 4;
      pixels[to] = image.pixels[from];
      pixels[to + 1] = image.pixels[from + 1];
      pixels[to + 2] = image.pixels[from + 2];
      pixels[to + 3] = image.pixels[from + 3];
    }
  }
  return { width, height, pixels };
}

/**
 * Nearest-neighbour upscale by a whole number.
 *
 * Nearest neighbour is not a compromise here — it is the only correct answer.
 * Every other filter invents colours between the ones the artist chose, and a
 * 16x16 turnip smoothed up to 32x32 stops being pixel art.
 */
export function upscale(image, factor) {
  if (!Number.isInteger(factor) || factor < 1) {
    throw new Error(`Scale must be a whole number of at least 1, got ${factor}.`);
  }
  if (factor === 1) return image;
  const width = image.width * factor;
  const height = image.height * factor;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (Math.floor(y / factor) * image.width + Math.floor(x / factor)) * 4;
      const to = (y * width + x) * 4;
      pixels[to] = image.pixels[from];
      pixels[to + 1] = image.pixels[from + 1];
      pixels[to + 2] = image.pixels[from + 2];
      pixels[to + 3] = image.pixels[from + 3];
    }
  }
  return { width, height, pixels };
}

/**
 * Scale3x (AdvMAME3x): triples an image, rounding diagonal edges instead of
 * turning each pixel into a 3x3 block.
 *
 * Like `upscale`, it never blends: every output pixel is a copy of one of the
 * source pixel's neighbours, so no colour appears that the artist did not
 * choose. The difference is that a one-pixel diagonal (a tool handle) stays a
 * diagonal line rather than becoming a staircase of squares.
 */
export function scale3x(image) {
  const { width, height } = image;
  const out = { width: width * 3, height: height * 3, pixels: new Uint8Array(width * height * 36) };
  const at = (x, y) => (Math.min(Math.max(y, 0), height - 1) * width + Math.min(Math.max(x, 0), width - 1)) * 4;
  const same = (a, b) =>
    image.pixels[a] === image.pixels[b] &&
    image.pixels[a + 1] === image.pixels[b + 1] &&
    image.pixels[a + 2] === image.pixels[b + 2] &&
    image.pixels[a + 3] === image.pixels[b + 3];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [A, B, C, D, E, F, G, H, I] = [
        at(x - 1, y - 1), at(x, y - 1), at(x + 1, y - 1),
        at(x - 1, y), at(x, y), at(x + 1, y),
        at(x - 1, y + 1), at(x, y + 1), at(x + 1, y + 1),
      ];
      const cells = [E, E, E, E, E, E, E, E, E];
      if (!same(B, H) && !same(D, F)) {
        if (same(D, B)) cells[0] = D;
        if ((same(D, B) && !same(E, C)) || (same(B, F) && !same(E, A))) cells[1] = B;
        if (same(B, F)) cells[2] = F;
        if ((same(D, B) && !same(E, G)) || (same(D, H) && !same(E, A))) cells[3] = D;
        if ((same(B, F) && !same(E, I)) || (same(H, F) && !same(E, C))) cells[5] = F;
        if (same(D, H)) cells[6] = D;
        if ((same(D, H) && !same(E, I)) || (same(H, F) && !same(E, G))) cells[7] = H;
        if (same(H, F)) cells[8] = F;
      }
      for (let i = 0; i < 9; i += 1) {
        const to = ((y * 3 + Math.floor(i / 3)) * out.width + x * 3 + (i % 3)) * 4;
        out.pixels.set(image.pixels.subarray(cells[i], cells[i] + 4), to);
      }
    }
  }
  return out;
}

/**
 * Scales by a factor that is not a whole number, for art drawn a size too small.
 *
 * `upscale` only takes whole numbers, and a 24px icon in a 32px slot needs
 * about 1.4. Nearest neighbour straight to 1.4 doubles every second or third
 * row and column, which shows as uneven lines. Going through `scale3x` first
 * and then sampling down keeps edges smooth, and still never blends: the
 * result holds only colours from the source.
 */
export function smoothScale(image, factor) {
  if (!(factor > 1 && factor <= 3)) {
    throw new Error(`A smooth scale must be above 1 and at most 3, got ${factor}.`);
  }
  const big = scale3x(image);
  const width = Math.round(image.width * factor);
  const height = Math.round(image.height * factor);
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const fromY = Math.min(big.height - 1, Math.floor(((y + 0.5) * big.height) / height));
    for (let x = 0; x < width; x += 1) {
      const fromX = Math.min(big.width - 1, Math.floor(((x + 0.5) * big.width) / width));
      const from = (fromY * big.width + fromX) * 4;
      pixels.set(big.pixels.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { width, height, pixels };
}

/** `encodePng`, but taking the image shape everything above passes around. */
export function encodeImage(image) {
  return encodePng(image.width, image.height, image.pixels);
}

/**
 * Stacks images, first at the bottom, using ordinary source-over alpha.
 *
 * The character generator does not export a finished sprite. It exports one
 * PNG per layer — body, head, face, and whatever clothes and hair were picked
 * — and encodes the stacking order in the file names, which is why they begin
 * with numbers. Compositing them is therefore not an extra feature on top of
 * importing: for that export format it is the import.
 *
 * Straight alpha in, straight alpha out, so a half-transparent shadow over a
 * half-transparent shadow behaves the way the artist drew it.
 */
export function composite(images) {
  if (!images.length) throw new Error('Nothing to composite.');
  const [{ width, height }] = images;
  for (const image of images) {
    if (image.width !== width || image.height !== height) {
      throw new Error(
        `Layers must all be the same size: expected ${width}x${height}, got ${image.width}x${image.height}.`,
      );
    }
  }

  const pixels = new Uint8Array(images[0].pixels);
  for (const layer of images.slice(1)) {
    for (let i = 0; i < pixels.length; i += 4) {
      const sourceAlpha = layer.pixels[i + 3] / 255;
      if (sourceAlpha === 0) continue;
      if (sourceAlpha === 1) {
        pixels[i] = layer.pixels[i];
        pixels[i + 1] = layer.pixels[i + 1];
        pixels[i + 2] = layer.pixels[i + 2];
        pixels[i + 3] = 255;
        continue;
      }
      const destAlpha = pixels[i + 3] / 255;
      const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
      for (let c = 0; c < 3; c += 1) {
        pixels[i + c] = Math.round(
          (layer.pixels[i + c] * sourceAlpha + pixels[i + c] * destAlpha * (1 - sourceAlpha)) / outAlpha,
        );
      }
      pixels[i + 3] = Math.round(outAlpha * 255);
    }
  }
  return { width, height, pixels };
}

/**
 * Lays pieces out on a blank canvas, first at the bottom, by the same
 * source-over rule `composite` uses.
 *
 * `composite` stacks whole sheets that already line up. A building in a
 * modular pack does not come that way: a wall, a roof and a door are three
 * rectangles in three places on the sheet, and the drawing only exists once
 * each has been put where it goes. So each piece is first copied onto a
 * transparent layer the size of the canvas, at its own offset, and the layers
 * are stacked — which keeps one blending rule rather than two.
 *
 * A piece that hangs past the canvas edge is clipped rather than refused, for
 * the same reason `sliceRect` reads past a sheet's edge as transparent.
 */
export function arrange(width, height, pieces) {
  const layers = [{ width, height, pixels: new Uint8Array(width * height * 4) }];
  for (const { image, x: atX, y: atY } of pieces) {
    const pixels = new Uint8Array(width * height * 4);
    for (let row = 0; row < image.height; row += 1) {
      const toY = atY + row;
      if (toY < 0 || toY >= height) continue;
      for (let col = 0; col < image.width; col += 1) {
        const toX = atX + col;
        if (toX < 0 || toX >= width) continue;
        const from = (row * image.width + col) * 4;
        const to = (toY * width + toX) * 4;
        pixels[to] = image.pixels[from];
        pixels[to + 1] = image.pixels[from + 1];
        pixels[to + 2] = image.pixels[from + 2];
        pixels[to + 3] = image.pixels[from + 3];
      }
    }
    layers.push({ width, height, pixels });
  }
  return composite(layers);
}

/**
 * Mirrors an image horizontally, vertically, or both.
 *
 * The cheapest way there is to break up a tiling pattern. A speckled grass
 * tile has no light direction in it, so its mirror is the same tile as far as
 * the eye is concerned — the same colours, the same density, the same art —
 * but the specks land somewhere else, and a field stops showing its grid.
 */
export function flip(image, { x = false, y = false } = {}) {
  if (!x && !y) return image;
  const { width, height } = image;
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const from = ((y ? height - 1 - row : row) * width + (x ? width - 1 - col : col)) * 4;
      const to = (row * width + col) * 4;
      pixels[to] = image.pixels[from];
      pixels[to + 1] = image.pixels[from + 1];
      pixels[to + 2] = image.pixels[from + 2];
      pixels[to + 3] = image.pixels[from + 3];
    }
  }
  return { width, height, pixels };
}
