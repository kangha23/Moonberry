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
import { validateSources } from './sources.mjs';

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
