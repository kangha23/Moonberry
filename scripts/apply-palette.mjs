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

export function loadPalette(file = PALETTE_FILE) {
  const { colours } = JSON.parse(fs.readFileSync(file, 'utf8'));
  return colours.map(({ hex }) => {
    const n = Number.parseInt(hex.slice(1), 16);
    const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return { ...srgbToOklab(...rgb), rgb };
  });
}

// --- CLI ---------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('apply-palette.mjs')) {
  const palette = loadPalette();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let changed = 0;
  for (const name of fs.readdirSync(IN_DIR)) {
    if (!name.endsWith('.png')) continue;
    const image = decodePng(fs.readFileSync(path.join(IN_DIR, name)));
    const out = encodeImage(quantise(image, palette));
    const target = path.join(OUT_DIR, name);
    const before = fs.existsSync(target) ? fs.readFileSync(target) : null;
    if (before === null || !before.equals(out)) changed += 1;
    fs.writeFileSync(target, out);
  }

  // CREDITS travels with the art it describes.
  fs.copyFileSync(path.join(IN_DIR, 'CREDITS.md'), path.join(OUT_DIR, 'CREDITS.md'));
  console.log(`quantised ${IN_DIR} -> ${OUT_DIR}; ${changed} files changed`);
}
