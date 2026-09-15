#!/usr/bin/env node
/**
 * The wooden frame, drawn once and used by both layers.
 *
 * The panels used to be a web app's idea of a panel — 22px corners, a blurred
 * backdrop, a soft gradient — sitting on top of a pixel-art game. Two visual
 * languages arguing with each other. These are the replacement: square
 * corners, no blur, and a border that is a picture of a plank.
 *
 * They are files rather than canvas drawings because the stylesheet needs one
 * (`border-image`) and the canvas needs one (`this.add.nineslice`), and the
 * point of the exercise is that those two are the same picture.
 */
import fs from 'node:fs';
import path from 'node:path';
import { encodePng, raster } from './lib/png.mjs';
import { PALETTE } from './lib/palette-data.mjs';

const OUT_DIR = path.join('public', 'assets', 'ui');

/** Deterministic noise, so the grain is the same on every run and in git. */
function hash(x, y, seed = 3) {
  let h = (x * 374761393 + y * 668265263 + seed * 974634211) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/**
 * The wood ramp, now named palette positions rather than literals.
 *
 * `edge` through `rim` form one continuous lightness ramp (the border walks
 * outward-to-inward through edge, dark, plankShade, plank, plankLit,
 * rimShade, up to the bright highlight rim), and per-colour nearest-neighbour
 * is the wrong tool for a ramp like this for the same reason it was wrong for
 * the soil ramp in `generate-plot-art.mjs`: it minimises each step's own
 * error with no notion that neighbouring steps have to stay apart from each
 * other visually.
 *
 * Two steps needed a deliberate push away from their unrestricted nearest
 * entry to avoid exactly that collapse:
 *
 * - `rimShade` (`#8a5a2e`) is nearest to `soil.4` (d=0.0281) — but `plankLit`
 *   (`#7d5231`) is *also* nearest to `soil.4` (d=0.0106), and the two are
 *   directly adjacent where the plank's lit face meets the rim's shaded
 *   corner. Snapping both to `soil.4` would erase that seam — the last step
 *   before the highlight rim disappears into the plank behind it. Moved
 *   `rimShade` to `soil.5` instead (d=0.0330, a cost of +0.0049), the next
 *   step up the same `soil` ramp, which keeps the six wood/rim steps at six
 *   distinct colours in the order the eye expects: `soil.0` < `soil.2` <
 *   `soil.3` < `soil.4` < `soil.5` < `light.2`.
 * - `fill` (`#2b1f18`, `frame-wood.png`'s panel interior) is nearest to
 *   `shadow.0` (d=0.0402) — the same entry `inner` (the border's innermost
 *   ring, directly touching that fill) is nearest to (d=0.0384). Losing that
 *   seam would mean `frame-wood.png` loses its innermost border line against
 *   the panel it borders — the one place in this file where the original
 *   hexes still carried a real (if modest, d=0.0239 in the original colours)
 *   intentional step. Moved `fill` to `shadow.2` instead (d=0.0426, a cost of
 *   +0.0024), which keeps that seam visible for a negligible accuracy loss.
 *
 * `plateFill`, the third frame's interior (see the `files` table below), is
 * the one case where doing nothing was correct: its original hex (`#241a14`)
 * and `inner`'s (`#241a13`) differ by one unit in a single channel — the
 * artist made them the same colour on purpose, so both being nearest to
 * `shadow.0` is a faithful result, not a collapse to fix.
 */
const WOOD = {
  edge: PALETTE['outline.0'],
  dark: PALETTE['soil.0'],
  plank: PALETTE['soil.3'],
  plankLit: PALETTE['soil.4'],
  plankShade: PALETTE['soil.2'],
  rim: PALETTE['light.2'],
  // Overridden — see the block comment above. Unrestricted nearest is
  // `soil.4` (d=0.0281), which duplicates `plankLit`.
  rimShade: PALETTE['soil.5'],
  inner: PALETTE['shadow.0'],
  // Overridden — see the block comment above. Unrestricted nearest is
  // `shadow.0` (d=0.0402), which duplicates `inner`.
  fill: PALETTE['shadow.2'],
};

/**
 * One frame image.
 *
 * `border` is the slice width, and the whole thing is `border * 3` square so
 * the middle slice is a full `border` wide — a one-pixel middle slice is what
 * makes a nine-slice shimmer when the panel it is stretched across is an odd
 * number of pixels wide.
 */
function frame(border, fill) {
  const size = border * 3;
  const { pixels, set } = raster(size, size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const depth = Math.min(x, y, size - 1 - x, size - 1 - y);

      if (depth >= border) {
        set(x, y, fill);
        continue;
      }
      if (depth === 0) {
        set(x, y, WOOD.edge);
        continue;
      }
      if (depth === 1) {
        set(x, y, WOOD.dark);
        continue;
      }
      if (depth === border - 1) {
        set(x, y, WOOD.inner);
        continue;
      }
      if (depth === border - 2) {
        // The lit rim sits one pixel in from the panel, which is what stops
        // the border reading as a flat brown rectangle.
        set(x, y, x < border || y < border ? WOOD.rim : WOOD.rimShade);
        continue;
      }

      // The plank itself: lit towards the top-left, shaded towards the
      // bottom-right, with a grain that runs along the board.
      const lit = x + y < size - 1;
      const grain = hash(Math.floor(x / 2), y) > 0.78 || hash(x, Math.floor(y / 2), 9) > 0.86;
      set(x, y, grain ? WOOD.plankShade : lit ? WOOD.plankLit : WOOD.plank);
    }
  }

  // Corner pegs. Small, and the only thing in the border that is not a plank,
  // so the corners read as joined rather than mitred.
  //
  // Only on the wide frames. On a narrow one the peg would not fit inside the
  // corner slice, and the part of it that spilled into the middle slice would
  // be stretched the length of whatever the frame is wrapped around — a peg
  // smeared into a stripe across an empty inventory cell.
  const peg = Math.max(2, Math.floor(border / 4));
  if (border < 8) return encodePng(size, size, pixels);
  for (const [cx, cy] of [
    [3, 3],
    [size - 3 - peg, 3],
    [3, size - 3 - peg],
    [size - 3 - peg, size - 3 - peg],
  ]) {
    for (let y = 0; y < peg; y += 1) {
      for (let x = 0; x < peg; x += 1) {
        set(cx + x, cy + y, x === 0 || y === 0 ? WOOD.rim : WOOD.rimShade);
      }
    }
  }

  return encodePng(size, size, pixels);
}

const files = {
  // Panels: the satchel, the stall, the forge, the morning summary.
  'frame-wood.png': frame(12, WOOD.fill),
  // Cells: one hotbar slot, one inventory slot. Same wood, a quarter the trim.
  // Nearest to the original `#1f1710` is `outline.3` (d=0.0429) — already
  // distinct from `inner`'s `shadow.0`, so no override needed here the way
  // `fill` above needed one: this frame's border-to-interior seam survives
  // nearest-neighbour on its own.
  'frame-slot.png': frame(4, PALETTE['outline.3']),
  // Bars and readouts that sit directly on the world and must not swallow it.
  // Reuses `inner`'s `shadow.0` on purpose — see the `plateFill` note in the
  // `WOOD` comment above: the original `#241a14` and `inner`'s `#241a13`
  // were already the same colour to the eye, so matching them here is
  // faithful, not a missed override.
  'frame-plate.png': frame(6, PALETTE['shadow.0']),
};

/**
 * Guarded the same way `generate-plot-art.mjs` is, and for the same reason:
 * before this guard, the whole module ran its file-writing side effects the
 * moment anything imported it, so nothing could `import` this file to check
 * its `PALETTE[...]` references without also regenerating three PNGs and a
 * README as a side effect. See `generate-ui.test.mjs` for the check that
 * guard now makes possible.
 */
function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [file, data] of Object.entries(files)) {
    fs.writeFileSync(path.join(OUT_DIR, file), data);
    console.log(`wrote ${path.join(OUT_DIR, file)} (${data.length} bytes)`);
  }

  fs.writeFileSync(
    path.join(OUT_DIR, 'README.md'),
    `# Interface frames

Generated by \`scripts/generate-ui.mjs\` — run \`npm run generate:ui\` after editing it.

Original work, drawn from code, no third-party source. Licensed with the repository.

Each file is a nine-slice: a square image whose border is one third of its width.
The stylesheet slices it with \`border-image\`, the canvas with \`this.add.nineslice\`,
and they are the same file on purpose — a border drawn twice is a border that
drifts.

| File | Slice | Used for |
| --- | --- | --- |
| \`frame-wood.png\` | 12px | Panels: satchel, market stall, forge, morning summary |
| \`frame-slot.png\` | 4px | One inventory or hotbar cell |
| \`frame-plate.png\` | 6px | Readouts laid over the world: clock, prompt bar, quest |
`,
  );
  console.log(`wrote ${path.join(OUT_DIR, 'README.md')}`);
}

if (process.argv[1] && process.argv[1].endsWith('generate-ui.mjs')) {
  main();
}
