/**
 * Tests for the art source table.
 *
 * Run by `node --test` alongside `png.test.mjs`: this is build tooling, and it
 * never goes through the app's TypeScript project.
 *
 * The validation is worth testing because the table is the one file in this
 * repo that is pure data about somebody else's files. A typo in a pack name
 * would otherwise surface as a download of `undefined`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSources, cutFlags } from './sources.mjs';
import { planImport } from '../import-lpc.mjs';

const pack = {
  title: '[LPC] Crops',
  page: 'https://opengameart.org/content/lpc-crops',
  licence: 'CC-BY-SA 3.0+ / GPL 3.0+',
  authors: ['bluecarrot16'],
  files: { 'crops.png': { from: 'https://example.invalid/crops.png', sha256: 'a'.repeat(64) } },
};

test('accepts a table whose cuts all name a pack and a file that exist', () => {
  const json = {
    packs: { 'lpc-crops': pack },
    notImported: {},
    cuts: [{ target: 'crop-tomato', pack: 'lpc-crops', file: 'crops.png', grid: 32, cell: [12, 6] }],
  };
  assert.equal(validateSources(json), json);
});

test('rejects a cut naming a pack that is not declared', () => {
  const json = {
    packs: { 'lpc-crops': pack },
    cuts: [{ target: 'crop-tomato', pack: 'lpc-crop', file: 'crops.png', grid: 32, cell: [1, 1] }],
  };
  assert.throws(() => validateSources(json), /crop-tomato.*lpc-crop/s);
});

test('rejects a cut naming a file the pack does not list', () => {
  const json = {
    packs: { 'lpc-crops': pack },
    cuts: [{ target: 'crop-tomato', pack: 'lpc-crops', file: 'plants.png', grid: 32, cell: [1, 1] }],
  };
  assert.throws(() => validateSources(json), /plants\.png/);
});

test('rejects two cuts writing the same target', () => {
  const json = {
    packs: { 'lpc-crops': pack },
    cuts: [
      { target: 'crop-tomato', pack: 'lpc-crops', file: 'crops.png', grid: 32, cell: [1, 1] },
      { target: 'crop-tomato', pack: 'lpc-crops', file: 'crops.png', grid: 32, cell: [2, 2] },
    ],
  };
  assert.throws(() => validateSources(json), /crop-tomato/);
});

test('rejects a pack file with no sha256, because an unpinned download is not reproducible', () => {
  const loose = { ...pack, files: { 'crops.png': { from: 'https://example.invalid/crops.png' } } };
  const json = { packs: { 'lpc-crops': loose }, cuts: [] };
  assert.throws(() => validateSources(json), /sha256/);
});

test('rejects a target that is also listed as not imported', () => {
  const json = {
    packs: { 'lpc-crops': pack },
    notImported: { 'crop-tomato': 'drawn by hand' },
    cuts: [{ target: 'crop-tomato', pack: 'lpc-crops', file: 'crops.png', grid: 32, cell: [1, 1] }],
  };
  assert.throws(() => validateSources(json), /both/);
});

test('rejects a notImported entry with no reason', () => {
  const json = { packs: {}, notImported: { 'tile-grass': '' }, cuts: [] };
  assert.throws(() => validateSources(json), /reason/);
});

test('turns a grid cell into the flags the importer already understands', () => {
  assert.deepEqual(cutFlags({ target: 'crop-tomato', grid: 32, cell: [12, 6] }), {
    grid: '32',
    cell: '12,6',
  });
});

test('passes a rect, a scale, a flip and a recolour straight through', () => {
  assert.deepEqual(
    cutFlags({ target: 'tree', rect: [0, 0, 48, 64], scale: 2, flip: 'x', recolour: { efe9e7: '9d7049' } }),
    { rect: '0,0,48,64', scale: '2', flip: 'x', recolour: 'efe9e7:9d7049' },
  );
});

test('turns a walk cycle and an animal cycle into their own flags', () => {
  assert.deepEqual(cutFlags({ target: 'maeve-sheet', walkcycle: true, row: 0 }), {
    walkcycle: true,
    row: '0',
  });
  assert.deepEqual(cutFlags({ target: 'animal-cow-sheet', animals: true, frame: 128 }), {
    animals: true,
    frame: '128',
  });
});

test('never emits --force, because a cut that is the wrong size is a cut to fix', () => {
  assert.equal('force' in cutFlags({ target: 'tile-path', force: true, grid: 32, cell: [0, 0] }), false);
});

test('produces flags planImport accepts, end to end', () => {
  // A 64x64 source read as a grid of 32px cells: cell 1,1 is its bottom-right
  // quarter, which is exactly the shape a world tile wants.
  //
  // Built as a literal rather than with `raster()`, which returns a writer
  // (`{ pixels, set }`) and not the `{ width, height, pixels }` shape the rest
  // of png.mjs passes around.
  const source = { width: 64, height: 64, pixels: new Uint8Array(64 * 64 * 4) };
  const { image } = planImport(source, 'tile-path', cutFlags({ target: 'tile-path', grid: 32, cell: [1, 1] }));
  assert.equal(image.width, 32);
  assert.equal(image.height, 32);
});
