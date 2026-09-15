/**
 * Tests for the palette-module generator.
 *
 * Same regression class as `generate-assets.test.mjs`, `generate-plot-art.test.mjs`
 * and `generate-ui.test.mjs`: this file used to run its write at module scope,
 * so merely `import`ing it — to check its own exports, say — would overwrite
 * `src/game/assets/palette.generated.ts` as a side effect, in a test run, with
 * no `npm run palette:module` in sight. This is the one check those three
 * files each got and this one didn't, which is exactly why it stayed
 * unguarded through two earlier rounds of the same fix landing elsewhere.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('the module can be imported without writing to disk', async () => {
  const marker = path.join('src', 'game', 'assets', 'palette.generated.ts');
  const before = fs.existsSync(marker) ? fs.statSync(marker).mtimeMs : null;
  await import('./generate-palette-module.mjs');
  const after = fs.existsSync(marker) ? fs.statSync(marker).mtimeMs : null;
  assert.equal(after, before, 'importing the module should not regenerate palette.generated.ts');
});
