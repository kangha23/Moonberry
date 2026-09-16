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
import { validateSources, cutFlags, reconcile, missingCredits } from './sources.mjs';
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

test('rejects a pack missing required metadata: title, page, or licence', () => {
  // Each omitted field makes the pack invalid, because the licence requires
  // crediting the author and the source. A pack with no title cannot be credited
  // by name, a pack with no page loses the canonical source, and a pack with no
  // licence loses the terms that made the use legal.
  assert.throws(
    () =>
      validateSources({
        packs: { 'lpc-crops': { ...pack, title: undefined } },
        cuts: [],
      }),
    /title/,
  );

  assert.throws(
    () =>
      validateSources({
        packs: { 'lpc-crops': { ...pack, page: undefined } },
        cuts: [],
      }),
    /page/,
  );

  assert.throws(
    () =>
      validateSources({
        packs: { 'lpc-crops': { ...pack, licence: undefined } },
        cuts: [],
      }),
    /licence/,
  );
});

test('rejects a pack with no authors or empty authors, because the licence requires attribution', () => {
  const noAuthors = { ...pack, authors: [] };
  assert.throws(() => validateSources({ packs: { 'lpc-crops': noAuthors }, cuts: [] }), /authors/);

  const notAnArray = { ...pack, authors: null };
  assert.throws(() => validateSources({ packs: { 'lpc-crops': notAnArray }, cuts: [] }), /authors/);
});

test('rejects a pack file entry with no source url', () => {
  const badFile = { ...pack, files: { 'crops.png': { sha256: 'a'.repeat(64) } } };
  assert.throws(() => validateSources({ packs: { 'lpc-crops': badFile }, cuts: [] }), /source url/);
});

test('rejects a cut with no target', () => {
  const json = {
    packs: { 'lpc-crops': pack },
    cuts: [{ pack: 'lpc-crops', file: 'crops.png', grid: 32, cell: [1, 1] }],
  };
  assert.throws(() => validateSources(json), /no target/);
});

test('rejects a target that is not a safe path segment', () => {
  // A layered cut's target becomes a directory name under art/sources/ (see
  // layerFolder in art-sync.mjs), which that folder then gets swept clean of
  // anything not in the cut's own layers. "../../../evil" would point that
  // sweep at a real directory outside art/sources/ entirely.
  const json = {
    packs: { 'lpc-crops': pack },
    cuts: [{ target: '../../../evil', pack: 'lpc-crops', file: 'crops.png', grid: 32, cell: [1, 1] }],
  };
  assert.throws(() => validateSources(json), /path/);
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

test('reports art on disk that no cut produced and nothing excuses', () => {
  const { unaccounted } = reconcile({
    rawFiles: ['tile-grass', 'crop-tomato', 'mystery'],
    cuts: [{ target: 'crop-tomato' }],
    notImported: { 'tile-grass': 'imported before this table existed' },
  });
  assert.deepEqual(unaccounted, ['mystery']);
});

test('reports table rows whose file is not on disk', () => {
  const { stale } = reconcile({
    rawFiles: ['crop-tomato'],
    cuts: [{ target: 'crop-tomato' }, { target: 'crop-melon' }],
    notImported: {},
  });
  assert.deepEqual(stale, ['crop-melon']);
});

test('is quiet when the folder and the table agree', () => {
  assert.deepEqual(
    reconcile({ rawFiles: ['crop-tomato'], cuts: [{ target: 'crop-tomato' }], notImported: {} }),
    { unaccounted: [], stale: [] },
  );
});

test('reports a pack used by a cut but missing from the credits', () => {
  const packs = {
    'lpc-crops': { title: '[LPC] Crops' },
    'lpc-fish': { title: '[LPC] Fish' },
  };
  const cuts = [
    { target: 'crop-tomato', pack: 'lpc-crops' },
    { target: 'item-carp', pack: 'lpc-fish' },
  ];
  const credits = '## [LPC] Crops (CC-BY-SA 3.0+)\n\nApplies to: crop-tomato.\n';
  assert.deepEqual(missingCredits({ packs, cuts, credits }), ['lpc-fish']);
});

test('does not demand credits for a pack no cut uses', () => {
  const packs = { 'lpc-fish': { title: '[LPC] Fish' } };
  assert.deepEqual(missingCredits({ packs, cuts: [], credits: '' }), []);
});

test('does not accept a similarly-named pack as credit for this one', () => {
  // `[LPC] Fish` must not be "credited" by a heading for `[LPC] Fishing Rod` —
  // about eight similarly-named LPC packs are coming.
  const packs = { 'lpc-fish': { title: '[LPC] Fish' } };
  const cuts = [{ target: 'item-carp', pack: 'lpc-fish' }];
  const credits = '## [LPC] Fishing Rod (CC-BY-SA 3.0+)\n\nApplies to: item-rod.\n';
  assert.deepEqual(missingCredits({ packs, cuts, credits }), ['lpc-fish']);
});

test('does not accept the title mentioned in prose, only in a heading', () => {
  // A sentence can mention a pack's name while explicitly saying the art did
  // NOT come from it; a substring match would call that a credit.
  const packs = { 'lpc-fish': { title: '[LPC] Fish' } };
  const cuts = [{ target: 'item-carp', pack: 'lpc-fish' }];
  const credits = 'This sprite was not taken from [LPC] Fish, despite the resemblance.\n';
  assert.deepEqual(missingCredits({ packs, cuts, credits }), ['lpc-fish']);
});

const generatorPack = { title: 'g', page: 'p', licence: 'l', authors: ['a'], files: {} };

test('accepts a layered cut whose layer names are numbered and pinned', () => {
  const json = {
    packs: { 'lpc-generator': generatorPack },
    cuts: [
      {
        target: 'maeve-sheet',
        pack: 'lpc-generator',
        walkcycle: true,
        layers: {
          '010 body.png': { from: 'https://example.invalid/b.png', sha256: 'a'.repeat(64) },
          '100 dress.png': { from: 'https://example.invalid/d.png', sha256: 'b'.repeat(64) },
        },
      },
    ],
  };
  assert.equal(validateSources(json), json);
});

test('rejects a layer name with no number, because the number is the stacking order', () => {
  const json = {
    packs: { 'lpc-generator': generatorPack },
    cuts: [
      {
        target: 'maeve-sheet',
        pack: 'lpc-generator',
        walkcycle: true,
        layers: { 'body.png': { from: 'https://example.invalid/b.png', sha256: 'a'.repeat(64) } },
      },
    ],
  };
  assert.throws(() => validateSources(json), /stacking order/);
});

test('rejects two layers claiming the same position', () => {
  const json = {
    packs: { 'lpc-generator': generatorPack },
    cuts: [
      {
        target: 'maeve-sheet',
        pack: 'lpc-generator',
        walkcycle: true,
        layers: {
          '010 body.png': { from: 'https://example.invalid/b.png', sha256: 'a'.repeat(64) },
          '010 head.png': { from: 'https://example.invalid/h.png', sha256: 'b'.repeat(64) },
        },
      },
    ],
  };
  assert.throws(() => validateSources(json), /010/);
});

test('rejects a layer with no sha256, the same guarantee a pack file gets', () => {
  const json = {
    packs: { 'lpc-generator': generatorPack },
    cuts: [
      {
        target: 'maeve-sheet',
        pack: 'lpc-generator',
        walkcycle: true,
        layers: { '010 body.png': { from: 'https://example.invalid/b.png' } },
      },
    ],
  };
  assert.throws(() => validateSources(json), /sha256/);
});

test('rejects a layer with no source url', () => {
  const json = {
    packs: { 'lpc-generator': generatorPack },
    cuts: [
      {
        target: 'maeve-sheet',
        pack: 'lpc-generator',
        walkcycle: true,
        layers: { '010 body.png': { sha256: 'a'.repeat(64) } },
      },
    ],
  };
  assert.throws(() => validateSources(json), /source url/);
});

test('rejects an empty layers, which would sweep the cache folder with nothing to refill it', () => {
  const json = {
    packs: { 'lpc-generator': generatorPack },
    cuts: [{ target: 'maeve-sheet', pack: 'lpc-generator', walkcycle: true, layers: {} }],
  };
  assert.throws(() => validateSources(json), /empty "layers"/);
});

test('rejects a layer name carrying a path separator', () => {
  const json = {
    packs: { 'lpc-generator': generatorPack },
    cuts: [
      {
        target: 'maeve-sheet',
        pack: 'lpc-generator',
        walkcycle: true,
        layers: { '010 ../body.png': { from: 'https://example.invalid/b.png', sha256: 'a'.repeat(64) } },
      },
    ],
  };
  assert.throws(() => validateSources(json), /not a safe file name/);

  const backslash = {
    packs: { 'lpc-generator': generatorPack },
    cuts: [
      {
        target: 'maeve-sheet',
        pack: 'lpc-generator',
        walkcycle: true,
        layers: { '010 body\\evil.png': { from: 'https://example.invalid/b.png', sha256: 'a'.repeat(64) } },
      },
    ],
  };
  assert.throws(() => validateSources(backslash), /not a safe file name/);
});

test('rejects a layer name containing "..", even with no path separator', () => {
  const json = {
    packs: { 'lpc-generator': generatorPack },
    cuts: [
      {
        target: 'maeve-sheet',
        pack: 'lpc-generator',
        walkcycle: true,
        layers: { '010..png': { from: 'https://example.invalid/b.png', sha256: 'a'.repeat(64) } },
      },
    ],
  };
  assert.throws(() => validateSources(json), /not a safe file name/);
});

test('rejects a cut naming both a file and layers, which silently resolves to layers', () => {
  const json = {
    packs: { 'lpc-generator': { ...generatorPack, files: { 'flat.png': { from: 'https://example.invalid/f.png', sha256: 'a'.repeat(64) } } } },
    cuts: [
      {
        target: 'maeve-sheet',
        pack: 'lpc-generator',
        file: 'flat.png',
        walkcycle: true,
        layers: { '010 body.png': { from: 'https://example.invalid/b.png', sha256: 'b'.repeat(64) } },
      },
    ],
  };
  assert.throws(() => validateSources(json), /both "file" and "layers"/);
});

test('rejects a cell that is not a pair of whole numbers', () => {
  const json = {
    packs: { 'lpc-crops': pack },
    cuts: [{ target: 'crop-tomato', pack: 'lpc-crops', file: 'crops.png', grid: 32, cell: 3 }],
  };
  assert.throws(() => validateSources(json), /crop-tomato.*"cell"/s);

  const wrongLength = {
    packs: { 'lpc-crops': pack },
    cuts: [{ target: 'crop-tomato', pack: 'lpc-crops', file: 'crops.png', grid: 32, cell: [1, 2, 3] }],
  };
  assert.throws(() => validateSources(wrongLength), /"cell"/);

  const notWhole = {
    packs: { 'lpc-crops': pack },
    cuts: [{ target: 'crop-tomato', pack: 'lpc-crops', file: 'crops.png', grid: 32, cell: [1.5, 2] }],
  };
  assert.throws(() => validateSources(notWhole), /"cell"/);
});

test('rejects a rect that is not four whole numbers', () => {
  const json = {
    packs: { 'lpc-crops': pack },
    cuts: [{ target: 'tree', pack: 'lpc-crops', file: 'crops.png', rect: [0, 0, 48] }],
  };
  assert.throws(() => validateSources(json), /tree.*"rect"/s);
});

test('accepts a pack file with a safe "extract" member path', () => {
  const zipped = {
    ...pack,
    files: {
      'plants.png': {
        from: 'https://opengameart.org/sites/default/files/lpc-flowers-plants-fungi-wood.zip',
        sha256: 'a'.repeat(64),
        extract: 'lpc-flowers-plants-fungi-wood/plants.png',
      },
    },
  };
  const json = { packs: { 'lpc-plants': zipped }, cuts: [] };
  assert.equal(validateSources(json), json);
});

test('rejects an "extract" that is an absolute path', () => {
  const badExtract = (extract) => ({
    ...pack,
    files: { 'plants.png': { from: 'https://example.invalid/pack.zip', sha256: 'a'.repeat(64), extract } },
  });
  assert.throws(
    () => validateSources({ packs: { 'lpc-plants': badExtract('/etc/passwd') }, cuts: [] }),
    /relative path/,
  );
  // A Windows drive letter is just as absolute as a leading slash here, since
  // this table is edited and this script is run on Windows as much as not.
  assert.throws(
    () => validateSources({ packs: { 'lpc-plants': badExtract('C:/Windows/System32/evil.png') }, cuts: [] }),
    /relative path/,
  );
});

test('rejects an "extract" with a ".." segment', () => {
  const zipped = {
    ...pack,
    files: {
      'plants.png': {
        from: 'https://example.invalid/pack.zip',
        sha256: 'a'.repeat(64),
        extract: '../../../evil.png',
      },
    },
  };
  assert.throws(() => validateSources({ packs: { 'lpc-plants': zipped }, cuts: [] }), /"\.\."/);
});

test('rejects an "extract" containing a backslash', () => {
  const zipped = {
    ...pack,
    files: {
      'plants.png': {
        from: 'https://example.invalid/pack.zip',
        sha256: 'a'.repeat(64),
        extract: 'lpc-flowers-plants-fungi-wood\\plants.png',
      },
    },
  };
  assert.throws(() => validateSources({ packs: { 'lpc-plants': zipped }, cuts: [] }), /backslash/);
});

test('rejects a non-whole-number grid, scale, frame or row', () => {
  const cutWith = (field, value) => ({
    packs: { 'lpc-crops': pack },
    cuts: [
      { target: 'crop-tomato', pack: 'lpc-crops', file: 'crops.png', cell: [0, 0], grid: 32, [field]: value },
    ],
  });
  assert.throws(() => validateSources(cutWith('grid', 32.5)), /"grid"/);
  assert.throws(() => validateSources(cutWith('scale', '2')), /"scale"/);
  assert.throws(() => validateSources(cutWith('frame', 12.25)), /"frame"/);
  assert.throws(() => validateSources(cutWith('row', 1.1)), /"row"/);
});
