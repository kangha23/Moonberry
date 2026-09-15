/**
 * Tests for the UI frame generator.
 *
 * Same shape as `generate-plot-art.test.mjs`, for the same reason: this file
 * names palette entries by string key (`PALETTE['soil.4']`), and nothing
 * checks that a key still resolves once `art/palette.json` is regenerated
 * and a group is renamed, resized, or removed. A dangling key silently
 * becomes `undefined`, and `undefined` is a legal (if useless) argument to
 * `raster().set` — the PNGs still write, every affected pixel fully
 * transparent, and nothing before this test would notice short of opening
 * the file. `generate-plot-art.mjs` hit exactly this after Task 8's palette
 * was re-derived; this test exists so the same fault in this file would be
 * caught instead of shipped.
 *
 * The check scans this file's own source text rather than importing `WOOD`
 * as data, so it catches a bad name anywhere in the file — inside `WOOD`,
 * or in the `files` table's inline `PALETTE[...]` lookups — not just
 * whichever table happens to be exported.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const SOURCE_FILE = path.join('scripts', 'generate-ui.mjs');
const PALETTE_FILE = path.join('art', 'palette.json');

/** Every `PALETTE['x.y']` (or `"x.y"`) key this file's source text looks up. */
function paletteNamesReferencedBy(source) {
  const names = new Set();
  const pattern = /PALETTE\[\s*['"]([^'"]+)['"]\s*\]/g;
  for (const match of source.matchAll(pattern)) names.add(match[1]);
  return names;
}

test('every PALETTE name this file references exists in art/palette.json', () => {
  const source = fs.readFileSync(SOURCE_FILE, 'utf8');
  const referenced = paletteNamesReferencedBy(source);

  // A change to this file that stops naming any colours through PALETTE
  // would make the rest of this test vacuously pass, which would hide a
  // regression rather than catch one — so insist there is something to check.
  assert.ok(referenced.size > 0, 'expected this file to reference PALETTE names');

  const { colours } = JSON.parse(fs.readFileSync(PALETTE_FILE, 'utf8'));
  const known = new Set(colours.map((c) => c.name));

  const dangling = [...referenced].filter((name) => !known.has(name)).sort();
  assert.deepEqual(
    dangling,
    [],
    `these PALETTE names are not in ${PALETTE_FILE}: ${dangling.join(', ')}`,
  );
});

test('the module can be imported without writing to disk', async () => {
  // Regression guard: this file used to run its writes unconditionally at
  // module scope, so merely importing it wrote three PNGs and a README. If
  // that ever comes back, this import either throws (OUT_DIR may not exist
  // yet in a fresh checkout) or, worse, silently writes — either way this
  // test is where that would first show up.
  const marker = path.join('public', 'assets', 'ui', 'frame-wood.png');
  const before = fs.existsSync(marker) ? fs.statSync(marker).mtimeMs : null;
  await import('./generate-ui.mjs');
  const after = fs.existsSync(marker) ? fs.statSync(marker).mtimeMs : null;
  assert.equal(after, before, 'importing the module should not regenerate the UI frame PNGs');
});
