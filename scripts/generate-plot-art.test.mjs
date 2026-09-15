/**
 * Tests for the plot art generator.
 *
 * The one property that matters here is that every `PALETTE['<name>']` this
 * file writes actually resolves. `art/palette.json` is re-derived from time
 * to time — groups get renamed, resized, or replaced by a pinned ramp — and
 * this generator has no type system watching its string keys: a renamed
 * group turns `PALETTE['wood.0']` into `undefined` silently, and `undefined`
 * is a perfectly legal argument to `image.set`, so the PNGs still write.
 * They just come out with every affected pixel fully transparent black,
 * which nothing before this test would have noticed — `main()` used to run
 * unconditionally at module load, so nothing could `import` this file to
 * check it without also regenerating nine PNGs as a side effect. That is
 * exactly what happened once already: a palette re-derivation between two
 * rounds of this file's own migration orphaned 14 of its then-17 palette
 * references, and 835 other passing tests did not catch it because none of
 * them so much as loaded this module.
 *
 * The check below reads this file's own source text rather than importing
 * `SOIL`/`WILD` as data, so it needs no export the generator would not
 * otherwise want, and it catches a bad name anywhere in the file — inside
 * `SOIL`, `WILD`, or a one-off lookup like the puddle colours — not just in
 * whichever tables happen to be exported today.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const SOURCE_FILE = path.join('scripts', 'generate-plot-art.mjs');
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
  // Regression guard for the fault above: `main()` used to run unconditionally
  // at module scope, so merely importing this file wrote nine PNGs. If that
  // ever comes back, this import throws (OUT_DIR may not exist yet in a
  // fresh checkout) or, worse, silently writes — either way this test is
  // where that would first show up.
  const before = fs.existsSync(path.join('public', 'assets', 'lpc', 'plot-tilled.png'))
    ? fs.statSync(path.join('public', 'assets', 'lpc', 'plot-tilled.png')).mtimeMs
    : null;
  await import('./generate-plot-art.mjs');
  const after = fs.existsSync(path.join('public', 'assets', 'lpc', 'plot-tilled.png'))
    ? fs.statSync(path.join('public', 'assets', 'lpc', 'plot-tilled.png')).mtimeMs
    : null;
  assert.equal(after, before, 'importing the module should not regenerate the plot PNGs');
});
