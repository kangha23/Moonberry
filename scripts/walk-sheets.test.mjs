#!/usr/bin/env node
/**
 * Every person's walk sheet, checked for the columns the game actually plays.
 *
 * `WALK_FRAMES` in `src/game/scenes/FarmScene.ts` was cut from 9 to 8 after a
 * commit found column 8 of `player-sheet.png` and `rowan-sheet.png` fully
 * transparent — a blank frame flickering into the walk cycle once per stride.
 * Nothing enforced that finding beyond those two files: `import-lpc.mjs`
 * still cuts nine columns for every walk sheet, and the batches after this one
 * add six new character-generator exports nobody has looked at column by
 * column. If one of them inks all nine columns, the game silently drops a
 * real pose it could have played; if its blank column lands anywhere but the
 * last, the game plays a hole in the middle of the stride instead of the one
 * frame it already knows to skip.
 *
 * This decodes every walk sheet on disk and checks, for each of the four
 * directions, which of its nine columns carry a non-transparent pixel.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { decodePng } from './lib/png.mjs';
import { WALK } from './import-lpc.mjs';

const ART_DIR = path.join('public', 'assets', 'lpc');

/**
 * How many of each row's nine frames the game actually plays.
 *
 * Must agree with `WALK_FRAMES` in `src/game/scenes/FarmScene.ts`. The number
 * is written twice rather than shared, because that file is game code
 * compiled through Vite for the browser and this one is plain Node tooling —
 * there is no third place both sides could import it from without dragging
 * one runtime into the other. Each copy carries a comment pointing at the
 * other, so a change to one is a change a reader of the other will notice.
 */
const WALK_FRAMES = 8;

/** Alpha at or below this counts as "not really there" — same threshold `rowInkBounds` in import-lpc.mjs uses. */
const INK_THRESHOLD = 8;

/** Which of a sheet's nine columns have a lit pixel in any of its four rows. */
function inkedColumns(image) {
  const { frame, frames, rows } = WALK;
  const inked = new Array(frames).fill(false);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < frames; col += 1) {
      if (inked[col]) continue;
      findInk: for (let y = 0; y < frame; y += 1) {
        for (let x = 0; x < frame; x += 1) {
          const at = ((row * frame + y) * image.width + col * frame + x) * 4 + 3;
          if (image.pixels[at] > INK_THRESHOLD) {
            inked[col] = true;
            break findInk;
          }
        }
      }
    }
  }
  return inked;
}

/**
 * A person's walk sheet, as opposed to an animal's.
 *
 * Matches the same naming rule `generate-lpc-manifest.mjs` uses to split the
 * two: an animal sheet is `animal-<kind>-sheet` and everything else ending in
 * `-sheet` is a person, read as nine 64px frames across and four down. An
 * animal sheet is a different shape per animal (see `animalcycle` in
 * import-lpc.mjs) and has no ninth-column question to ask.
 */
function isPersonWalkSheet(file) {
  return file.endsWith('-sheet.png') && !file.startsWith('animal-');
}

const files = fs.existsSync(ART_DIR) ? fs.readdirSync(ART_DIR).filter(isPersonWalkSheet) : [];

test('at least one walk sheet is on disk to check', () => {
  assert.ok(files.length > 0, `no *-sheet.png in ${ART_DIR} that is not an animal sheet`);
});

for (const file of files) {
  test(`${file} inks exactly the ${WALK_FRAMES} columns the game plays`, () => {
    const image = decodePng(fs.readFileSync(path.join(ART_DIR, file)));
    const wantShape = `${WALK.frame * WALK.frames}x${WALK.frame * WALK.rows}`;
    assert.equal(
      `${image.width}x${image.height}`,
      wantShape,
      `${file} is ${image.width}x${image.height}, not ${wantShape} — it is not a walk sheet shape ` +
        'import-lpc.mjs would even let through, so it cannot be checked as one.',
    );

    const inked = inkedColumns(image);
    const want = inked.map((_, col) => col < WALK_FRAMES);
    const inkedList = inked.flatMap((lit, col) => (lit ? [col] : []));
    assert.deepEqual(
      inked,
      want,
      `${file} inks columns [${inkedList.join(', ')}], but WALK_FRAMES in FarmScene.ts plays ` +
        `frames 0..${WALK_FRAMES - 1} of every row. A sheet whose inked columns are not exactly ` +
        'that contiguous range either drops a real pose or animates through a blank one.',
    );
  });
}
