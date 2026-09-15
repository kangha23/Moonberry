# Real Art Migration — Tooling and Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the declarative art-import tool, and make the three code changes that let real art take over from the generated drawings, so that every later batch is data entry rather than engineering.

**Architecture:** A pure core in `scripts/lib/sources.mjs` (validate the manifest, translate a cut into importer flags, reconcile the folder against the table) with a thin I/O shell in `scripts/art-sync.mjs` that downloads, verifies digests, and calls the existing `planImport()`. Separately, three edits in the game: the tile fringes sample the real tile beside them instead of three flat colours, the React icon component reads a PNG when the manifest has one, and a test makes a blank item impossible.

**Tech Stack:** Node ESM build scripts tested with `node --test`; the app in TypeScript, React 19 and Phaser 4, tested with Vitest and Testing Library. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-09-16-real-art-migration-design.md`](../specs/2026-09-16-real-art-migration-design.md)

## Global Constraints

- **Every art file is native 32px.** Nothing is made of 2x2 blocks. This is the single rule holding the look together; `planImport` enforces the sizes and must not be bypassed with `--force`.
- **The 48-colour palette lock stays.** `art/palette.json` is the only source of colour. Every hex written in code must come from `PALETTE[...]`; `scripts/palette-lock.test.mjs` fails the build otherwise, and it now reads inside `rgb()`/`rgba()` too.
- **The generated drawings are never deleted.** They are the fallback. No task in this plan removes a `withTexture` call from `createPixelArtTextures.ts`.
- **Effects and HUD chrome stay generated.** The 16 particle/shadow textures and the 12 `icon-*`/`clock-*` textures are out of scope.
- **Art is not MIT.** Imports are CC-BY-SA 3.0 / GPL or CC-BY 3.0, adaptations stay under the same licence, and every pack must appear in `public/assets/lpc/CREDITS.md`.
- **Nothing overwrites committed art without being asked.** `art:sync` writes only files its table produces, and `--verify` must be used to compare before a first real write.

---

### Task 1: The manifest schema, validated

**Files:**
- Create: `scripts/lib/sources.mjs`
- Test: `scripts/lib/sources.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `validateSources(json) -> json` — throws `Error` with a message naming the offending entry. Later tasks call it before anything else.

- [ ] **Step 1: Write the failing test**

Create `scripts/lib/sources.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/lib/sources.test.mjs`
Expected: FAIL — `Cannot find module './sources.mjs'`.

- [ ] **Step 3: Write the minimal implementation**

Create `scripts/lib/sources.mjs`:

```js
/**
 * The art source table: what it may say, and what it means.
 *
 * `art/sources.json` is the record of where every imported PNG came from and
 * which rectangle of it was taken. It exists because 182 cuts made by hand are
 * 182 things nobody can check, and because the licences here require
 * attribution — a file whose origin was never written down cannot be credited.
 *
 * Everything in this module is pure. The downloading and the writing live in
 * `scripts/art-sync.mjs`, so the interesting half can be tested without a
 * network or a filesystem.
 */

/** A digest is 64 hex characters, and anything else is a typo, not a digest. */
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Checks the table over, and hands it back so callers can chain.
 *
 * Every failure names the entry that caused it. A validator that says "invalid
 * sources.json" about a 182-row table has not helped anybody.
 */
export function validateSources(json) {
  const packs = json.packs ?? {};
  const cuts = json.cuts ?? [];
  const notImported = json.notImported ?? {};

  for (const [name, pack] of Object.entries(packs)) {
    for (const field of ['title', 'page', 'licence']) {
      if (!pack?.[field]) throw new Error(`Pack "${name}" has no ${field}.`);
    }
    if (!Array.isArray(pack.authors) || pack.authors.length === 0) {
      throw new Error(`Pack "${name}" has no authors, and the licence requires them.`);
    }
    for (const [file, entry] of Object.entries(pack.files ?? {})) {
      if (!entry?.from) throw new Error(`Pack "${name}" file "${file}" has no source url.`);
      if (!SHA256.test(entry.sha256 ?? '')) {
        throw new Error(
          `Pack "${name}" file "${file}" has no sha256. An unpinned download is not ` +
            'reproducible: upstream can change the file and nobody would know.',
        );
      }
    }
  }

  for (const [target, reason] of Object.entries(notImported)) {
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new Error(`"${target}" is listed as not imported with no reason given.`);
    }
  }

  const seen = new Set();
  for (const cut of cuts) {
    const { target } = cut;
    if (!target) throw new Error('A cut has no target.');
    if (seen.has(target)) throw new Error(`Two cuts both write "${target}".`);
    seen.add(target);

    if (target in notImported) {
      throw new Error(`"${target}" is both a cut and listed as not imported; it cannot be both.`);
    }

    const pack = packs[cut.pack];
    if (!pack) throw new Error(`Cut "${target}" names pack "${cut.pack}", which is not declared.`);
    if (!cut.layers && !pack.files?.[cut.file]) {
      throw new Error(`Cut "${target}" names file "${cut.file}", which pack "${cut.pack}" does not list.`);
    }
  }

  return json;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/lib/sources.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/sources.mjs scripts/lib/sources.test.mjs
git commit -m "feat(art): validate the art source table"
```

---

### Task 2: Translating a cut into importer flags

**Files:**
- Modify: `scripts/lib/sources.mjs`
- Test: `scripts/lib/sources.test.mjs`

**Interfaces:**
- Consumes: `validateSources` from Task 1.
- Produces: `cutFlags(cut) -> object` — the flags object handed to `planImport(source, target, flags)` from `scripts/import-lpc.mjs`. Values are strings because `import-lpc`'s `numbers()` parses `String(value).split(',')`.

- [ ] **Step 1: Write the failing test**

Append to `scripts/lib/sources.test.mjs`:

```js
import { cutFlags } from './sources.mjs';
import { planImport } from '../import-lpc.mjs';

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/lib/sources.test.mjs`
Expected: FAIL — `cutFlags is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Append to `scripts/lib/sources.mjs`:

```js
/**
 * A table row as the flags `planImport` already takes.
 *
 * This is the whole reason the table is worth having: every geometry rule the
 * game depends on — 32x32 for a tile, 576x256 for a walk cycle, divisible by
 * four for an animal sheet — lives in `import-lpc.mjs` and is tested there. A
 * second implementation here would be a second set of rules to keep in step.
 *
 * Values come out as strings because that is what the importer's own flag
 * parser reads: it splits `String(value)` on commas, so `[12, 6]` and `'12,6'`
 * are the same argument and the string is the honest one.
 *
 * `--force` is deliberately not reachable from the table. It exists for a
 * human who has just changed the loader and knows why the size is different;
 * a data file asking for it is a cut that should have been fixed instead.
 */
export function cutFlags(cut) {
  const flags = {};
  if (cut.grid !== undefined) flags.grid = String(cut.grid);
  if (cut.cell !== undefined) flags.cell = cut.cell.join(',');
  if (cut.rect !== undefined) flags.rect = cut.rect.join(',');
  if (cut.scale !== undefined) flags.scale = String(cut.scale);
  if (cut.flip !== undefined) flags.flip = String(cut.flip);
  if (cut.recolour !== undefined) {
    flags.recolour = Object.entries(cut.recolour)
      .map(([from, to]) => `${from.replace('#', '')}:${to.replace('#', '')}`)
      .join(',');
  }
  if (cut.walkcycle) flags.walkcycle = true;
  if (cut.animals) flags.animals = true;
  if (cut.frame !== undefined) flags.frame = String(cut.frame);
  if (cut.row !== undefined) flags.row = String(cut.row);
  return flags;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/lib/sources.test.mjs`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/sources.mjs scripts/lib/sources.test.mjs
git commit -m "feat(art): translate a source table row into importer flags"
```

---

### Task 3: Reconciling the folder and the credits

**Files:**
- Modify: `scripts/lib/sources.mjs`
- Test: `scripts/lib/sources.test.mjs`

**Interfaces:**
- Consumes: `validateSources`, `cutFlags`.
- Produces:
  - `reconcile({ rawFiles, cuts, notImported }) -> { unaccounted: string[], stale: string[] }`
  - `missingCredits({ packs, cuts, credits }) -> string[]` (pack names, sorted)

- [ ] **Step 1: Write the failing test**

Append to `scripts/lib/sources.test.mjs`:

```js
import { missingCredits, reconcile } from './sources.mjs';

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/lib/sources.test.mjs`
Expected: FAIL — `reconcile is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Append to `scripts/lib/sources.mjs`:

```js
/**
 * The folder against the table, both ways.
 *
 * `unaccounted` is art on disk that no cut produced and no `notImported` entry
 * excuses. That is the failure worth catching: a PNG whose origin nobody wrote
 * down cannot be credited, and the licences here make attribution a condition.
 *
 * `stale` is the opposite — a row describing a file that is not there, which
 * usually means a rename that only happened on one side.
 */
export function reconcile({ rawFiles, cuts, notImported = {} }) {
  const produced = new Set(cuts.map((cut) => cut.target));
  const excused = new Set(Object.keys(notImported));
  return {
    unaccounted: rawFiles.filter((name) => !produced.has(name) && !excused.has(name)).sort(),
    stale: [...produced].filter((name) => !rawFiles.includes(name)).sort(),
  };
}

/**
 * Packs that art is taken from but that the credits do not mention.
 *
 * Matched on the pack's title appearing in the file, because that is what a
 * reader looks for — a heading with the pack's name on it. Only packs a cut
 * actually uses are required: declaring a pack and not using it yet is a
 * legitimate half-finished state, and shipping its art without credit is not.
 */
export function missingCredits({ packs, cuts, credits }) {
  const used = new Set(cuts.map((cut) => cut.pack));
  return [...used]
    .filter((name) => {
      const title = packs[name]?.title;
      return !title || !credits.includes(title);
    })
    .sort();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/lib/sources.test.mjs`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/sources.mjs scripts/lib/sources.test.mjs
git commit -m "feat(art): reconcile the art folder against its source table"
```

---

### Task 4: The `art:sync` command

**Files:**
- Create: `scripts/art-sync.mjs`
- Modify: `package.json` (scripts section), `.gitignore`

**Interfaces:**
- Consumes: `validateSources`, `cutFlags`, `reconcile`, `missingCredits` from Tasks 1-3; `planImport`, `readSource`, `OUT_DIR` from `scripts/import-lpc.mjs`; `decodePng`, `encodeImage` from `scripts/lib/png.mjs`.
- Produces: the CLI. Modes: default (write), `--check`, `--verify`, `--dry-run`, `--only <target>`.

**Why `--verify` exists:** batch 0 backfills rows describing art that is already committed. Writing those rows straight out would overwrite real files with a guess. `--verify` cuts everything and *compares*, reporting which targets match byte for byte and which do not, without touching the folder. A row that does not match is a row that is wrong, and it goes to `notImported` rather than into the folder.

- [ ] **Step 1: Write `scripts/art-sync.mjs`**

```js
#!/usr/bin/env node
/**
 * Rebuilds `art/raw/lpc/` from `art/sources.json`.
 *
 * `import-lpc.mjs` cuts one file when a person runs it, and the record of what
 * they did is a shell command in somebody's history. That was fine for forty
 * files. For two hundred it is not: a cut that is one cell off is invisible
 * until the sprite is on screen, and by then the command that made it is gone.
 *
 * So the cuts live in a table, and this replays them. The geometry is still
 * `planImport`'s — nothing here knows how big a tile is — which keeps one set
 * of size rules with one set of tests behind it.
 *
 *   npm run art:sync                 download what is missing, write every cut
 *   npm run art:sync -- --only X     just that target
 *   npm run art:sync -- --verify     cut everything, compare, write nothing
 *   npm run art:sync -- --check      folder and credits agree with the table
 *   npm run art:sync -- --dry-run    say what would be written
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OUT_DIR, planImport, readSource } from './import-lpc.mjs';
import { encodeImage } from './lib/png.mjs';
import { cutFlags, missingCredits, reconcile, validateSources } from './lib/sources.mjs';

const SOURCES_FILE = path.join('art', 'sources.json');
const CACHE_DIR = path.join('art', 'sources');
const CREDITS_FILE = path.join('public', 'assets', 'lpc', 'CREDITS.md');

function readSources() {
  if (!fs.existsSync(SOURCES_FILE)) throw new Error(`No ${SOURCES_FILE}.`);
  return validateSources(JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8')));
}

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * One pack file on disk, downloaded if it is not there yet.
 *
 * The digest is checked every time, not only after a download. A cached file
 * that has been edited by hand is exactly the situation the pin is for.
 */
async function packFile(packName, fileName, entry) {
  const target = path.join(CACHE_DIR, packName, fileName);
  if (!fs.existsSync(target)) {
    process.stdout.write(`downloading ${packName}/${fileName}\n`);
    const response = await fetch(entry.from);
    if (!response.ok) throw new Error(`${entry.from} returned ${response.status}.`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  }
  const found = digest(fs.readFileSync(target));
  if (found !== entry.sha256) {
    throw new Error(
      `${target} hashes to ${found}, but the table pins ${entry.sha256}.\n` +
        'Upstream changed the file, or the cache is stale. Delete the file to re-download; ' +
        'if upstream really did change, look at the new file before updating the pin.',
    );
  }
  return target;
}

/** A layered cut: each url written under its declared name, stacked by name. */
async function layerFolder(cut) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lpc-${cut.target}-`));
  for (const [name, url] of Object.entries(cut.layers)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} returned ${response.status}.`);
    fs.writeFileSync(path.join(dir, name), Buffer.from(await response.arrayBuffer()));
  }
  return dir;
}

async function bytesFor(json, cut) {
  const source = cut.layers
    ? readSource(await layerFolder(cut))
    : readSource(await packFile(cut.pack, cut.file, json.packs[cut.pack].files[cut.file]));
  const { image, warnings } = planImport(source.image, cut.target, cutFlags(cut));
  for (const warning of warnings) console.warn(`warning: ${cut.target}: ${warning}`);
  return encodeImage(image);
}

function check(json) {
  const rawFiles = fs
    .readdirSync(OUT_DIR)
    .filter((file) => file.endsWith('.png'))
    .map((file) => file.slice(0, -4));

  const { unaccounted, stale } = reconcile({
    rawFiles,
    cuts: json.cuts ?? [],
    notImported: json.notImported ?? {},
  });
  const uncredited = missingCredits({
    packs: json.packs ?? {},
    cuts: json.cuts ?? [],
    credits: fs.readFileSync(CREDITS_FILE, 'utf8'),
  });

  const problems = [];
  if (unaccounted.length) {
    problems.push(
      `Art with no recorded source: ${unaccounted.join(', ')}.\n` +
        `Add a cut to ${SOURCES_FILE}, or a "notImported" entry saying why it has none.`,
    );
  }
  if (stale.length) problems.push(`Cuts with no file on disk: ${stale.join(', ')}.`);
  if (uncredited.length) {
    problems.push(
      `Packs used but not credited in ${CREDITS_FILE}: ${uncredited.join(', ')}.\n` +
        'These licences require attribution. Add a section with the authors, the licence and the url.',
    );
  }
  if (problems.length) throw new Error(problems.join('\n\n'));
  console.log(`ok: ${rawFiles.length} files, all accounted for and credited`);
}

async function main(argv) {
  const json = readSources();
  if (argv.includes('--check')) {
    check(json);
    return 0;
  }

  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
  const verify = argv.includes('--verify');
  const dryRun = argv.includes('--dry-run');
  const cuts = (json.cuts ?? []).filter((cut) => !only || cut.target === only);
  if (only && !cuts.length) throw new Error(`No cut writes "${only}".`);

  let same = 0;
  let different = 0;
  for (const cut of cuts) {
    const bytes = await bytesFor(json, cut);
    const file = path.join(OUT_DIR, `${cut.target}.png`);

    if (verify) {
      const existing = fs.existsSync(file) ? fs.readFileSync(file) : null;
      const matches = existing !== null && existing.equals(bytes);
      if (matches) same += 1;
      else {
        different += 1;
        console.log(`differs: ${cut.target}${existing ? '' : ' (not on disk)'}`);
      }
      continue;
    }

    if (dryRun) {
      console.log(`would write ${file}`);
      continue;
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(file, bytes);
    console.log(`wrote ${file}`);
  }

  if (verify) {
    console.log(`${same} identical, ${different} different`);
    return different === 0 ? 0 : 1;
  }
  if (!dryRun && cuts.length) {
    console.log('now run: npm run palette:apply && npm run lpc:manifest');
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (error) => {
    console.error(error.message);
    process.exit(1);
  },
);
```

- [ ] **Step 2: Add the npm script**

In `package.json`, beside the other `lpc:` scripts:

```json
"art:sync": "node scripts/art-sync.mjs",
```

- [ ] **Step 3: Ignore the download cache**

Append to `.gitignore`:

```
# Downloaded upstream art packs. art/sources.json pins each file by sha256, so
# this folder is a cache rather than a record; the whole packs are not
# redistributed from this repo.
art/sources/
```

- [ ] **Step 4: Verify the command runs and reports a missing table**

Run: `npm run art:sync -- --check`
Expected: exits 1 with `No art/sources.json.` — the table arrives in Task 5.

- [ ] **Step 5: Commit**

```bash
git add scripts/art-sync.mjs package.json .gitignore
git commit -m "feat(art): add art:sync, which replays the source table"
```

---

### Task 5: Backfill the table for the art already committed

**Files:**
- Create: `art/sources.json`
- Modify: `package.json` (the `test:scripts` script)

**Interfaces:**
- Consumes: the CLI from Task 4.
- Produces: `art/sources.json` covering all 46 files in `art/raw/lpc/`, each either as a cut or as a `notImported` entry.

**What this task is and is not.** The job is to make every existing file *accounted for*, not to make every existing file reproducible. `CREDITS.md` records exact coordinates for the crops pack ("band 1 column 10 row 7") and the plants pack; it does not for the terrain tiles, the tree, the farmhouse or the walk sheets. Those go to `notImported` with that as their reason.

- [ ] **Step 1: List what is in the folder**

Run: `ls art/raw/lpc/*.png | wc -l` and `ls art/raw/lpc/`
Expected: 46 files. Keep the list — every name must appear in the table by the end of this task.

- [ ] **Step 2: Write the skeleton with everything excused**

Generate it rather than typing 46 near-identical lines — the reason string has
to be the same on every one, and a hand-typed set of 46 will not be:

```bash
node -e '
const fs = require("node:fs");
const reason = "imported before this table existed; source coordinates were not recorded";
const notImported = Object.fromEntries(
  fs.readdirSync("art/raw/lpc")
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => [f.slice(0, -4), reason]),
);
fs.writeFileSync("art/sources.json", JSON.stringify({ packs: {}, notImported, cuts: [] }, null, 2) + "\n");
'
```

Expected: `art/sources.json` with 46 `notImported` entries, an empty `packs`
and an empty `cuts`. Every later step in this task moves entries *out* of
`notImported` and into `cuts`.

- [ ] **Step 3: Run the check and watch it pass**

Run: `npm run art:sync -- --check`
Expected: `ok: 46 files, all accounted for and credited`

- [ ] **Step 4: Promote the crops pack to real cuts**

`CREDITS.md` says `crops.png` is 1024x1024 of native 32x32 cells, three bands of ten rows, ripe on row 7 of a band, and gives `crop-turnip` as band 1 column 10 row 7. Find the file url on <https://opengameart.org/content/lpc-crops>, download it once, and take its digest:

```bash
curl -sL '<file url>' -o /tmp/crops.png && sha256sum /tmp/crops.png
```

Add the pack and one cut per crop that `CREDITS.md` documents, moving each target out of `notImported`:

```json
"lpc-crops": {
  "title": "[LPC] Crops",
  "page": "https://opengameart.org/content/lpc-crops",
  "licence": "CC-BY-SA 3.0+ or GPL 3.0+",
  "authors": ["bluecarrot16", "Daniel Eddeland (daneeklu)", "Joshua Taylor", "Richard Kettering (Jetrel)"],
  "files": { "crops.png": { "from": "<file url>", "sha256": "<digest>" } }
}
```

with cuts shaped `{ "target": "crop-turnip", "pack": "lpc-crops", "file": "crops.png", "grid": 32, "cell": [9, 6] }` — column 10 and row 7 of the credits are one-based, so the zero-based cell is `[9, 6]`.

- [ ] **Step 5: Verify those cuts reproduce the committed files exactly**

Run: `npm run art:sync -- --verify`
Expected: every promoted target reported identical.

**If a target reports `differs`:** the coordinates are wrong or the file was edited after import. Do not write it. Move that one target back to `notImported` with the reason `"recorded coordinates do not reproduce the committed file"` and carry on. A table that lies is worse than a table with a gap in it.

- [ ] **Step 6: Repeat steps 4 and 5 for the plants pack**

`CREDITS.md` gives `crop-sunflower` (column 4, row 6), `crop-frostcap` (column 5, row 22), `bush` (8, 22), `tuft-tall` (9, 22), `flowers-red` (8, 5), `flowers-gold` (9, 5), `flowers-white` (8, 10), `stump` (0, 24), `log` (3, 24), `stump-flowers` (5, 24), from <https://opengameart.org/content/lpc-flowers-plants-fungi-wood>.

- [ ] **Step 7: Wire `--check` into the test run**

In `package.json`:

```json
"test:scripts": "node --test \"scripts/**/*.test.mjs\" && node scripts/art-sync.mjs --check",
```

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS, ending with `ok: 46 files, all accounted for and credited`.

- [ ] **Step 9: Commit**

```bash
git add art/sources.json package.json
git commit -m "feat(art): record where the committed art came from"
```

---

### Task 6: Layered cuts, for villager sheets

**Files:**
- Modify: `scripts/lib/sources.mjs`
- Test: `scripts/lib/sources.test.mjs`

**Interfaces:**
- Consumes: `validateSources` from Task 1.
- Produces: validation rules for a `layers` cut. The download half already exists in `layerFolder` from Task 4.

**Why it needs its own rules:** `readSource()` composites a folder of PNGs in file-name order, and the LPC character generator numbers its exports (`010 body_color.png`, `100 human_male.png`) precisely so that sorting is the stacking order. A layer map whose keys are not numbered stacks in whatever order the names happen to sort, which is a villager wearing their shirt under their skin.

- [ ] **Step 1: Write the failing test**

Append to `scripts/lib/sources.test.mjs`:

```js
test('accepts a layered cut whose layer names are numbered', () => {
  const json = {
    packs: { 'lpc-generator': { title: 'g', page: 'p', licence: 'l', authors: ['a'], files: {} } },
    cuts: [
      {
        target: 'maeve-sheet',
        pack: 'lpc-generator',
        walkcycle: true,
        layers: { '010 body.png': 'https://example.invalid/b.png', '100 dress.png': 'https://example.invalid/d.png' },
      },
    ],
  };
  assert.equal(validateSources(json), json);
});

test('rejects a layer name with no number, because the number is the stacking order', () => {
  const json = {
    packs: { 'lpc-generator': { title: 'g', page: 'p', licence: 'l', authors: ['a'], files: {} } },
    cuts: [
      {
        target: 'maeve-sheet',
        pack: 'lpc-generator',
        walkcycle: true,
        layers: { 'body.png': 'https://example.invalid/b.png' },
      },
    ],
  };
  assert.throws(() => validateSources(json), /stacking order/);
});

test('rejects two layers claiming the same position', () => {
  const json = {
    packs: { 'lpc-generator': { title: 'g', page: 'p', licence: 'l', authors: ['a'], files: {} } },
    cuts: [
      {
        target: 'maeve-sheet',
        pack: 'lpc-generator',
        walkcycle: true,
        layers: {
          '010 body.png': 'https://example.invalid/b.png',
          '010 head.png': 'https://example.invalid/h.png',
        },
      },
    ],
  };
  assert.throws(() => validateSources(json), /010/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/lib/sources.test.mjs`
Expected: FAIL — the unnumbered layer is accepted.

- [ ] **Step 3: Write the minimal implementation**

In `validateSources`, inside the `for (const cut of cuts)` loop, after the pack lookup:

```js
    if (cut.layers) {
      const positions = new Map();
      for (const name of Object.keys(cut.layers)) {
        const numbered = name.match(/^(\d+)\s/);
        if (!numbered) {
          throw new Error(
            `Cut "${target}" layer "${name}" does not start with a number. The number is the ` +
              'stacking order: readSource composites a folder in file-name order, so an ' +
              'unnumbered layer stacks wherever its name happens to sort.',
          );
        }
        const at = numbered[1];
        if (positions.has(at)) {
          throw new Error(`Cut "${target}" has two layers at position ${at}: "${positions.get(at)}" and "${name}".`);
        }
        positions.set(at, name);
      }
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/lib/sources.test.mjs`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/sources.mjs scripts/lib/sources.test.mjs
git commit -m "feat(art): validate layered cuts for character sheets"
```

---

### Task 7: Make the fringe geometry pure

**Files:**
- Modify: `src/game/assets/createPixelArtTextures.ts:1503-1600`
- Test: `src/game/assets/fringe.test.ts` (create)

**Interfaces:**
- Consumes: `hash` (already in the file).
- Produces: `export function fringeSpans(mask: number, seed: number): FringeSpan[]` and `export interface FringeSpan { x: number; y: number; w: number; h: number; role: 'body' | 'dark' | 'light' }`. Task 8 consumes both.

**Why this comes first:** Task 8 changes what the fringe is *made of*. Separating the geometry from the painting means Task 8 touches four lines and the wobble logic — the part that stops the map looking like a spreadsheet — is covered by tests that do not need a canvas. jsdom has no 2D context, so a test of `drawFringe` as it stands today could not run at all.

This task is a refactor: **no pixel changes.**

- [ ] **Step 1: Write the failing test**

Create `src/game/assets/fringe.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fringeSpans } from './createPixelArtTextures';

/**
 * The fringe geometry, which is what stops a dirt path being a rectangle cut
 * out of a lawn.
 *
 * Tested apart from the painting because jsdom has no 2D canvas context, and
 * because the interesting property here is not a colour: it is that the depth
 * wobbles, that it is the same wobble every boot, and that a mask only ever
 * draws on the sides it names.
 */
describe('fringe spans', () => {
  it('draws nothing for an empty mask', () => {
    expect(fringeSpans(0, 3)).toEqual([]);
  });

  it('stays inside the tile on every mask and seed', () => {
    for (let mask = 1; mask <= 15; mask += 1) {
      for (const seed of [3, 20, 37]) {
        for (const span of fringeSpans(mask, seed)) {
          expect(span.x, `mask ${mask}`).toBeGreaterThanOrEqual(0);
          expect(span.y, `mask ${mask}`).toBeGreaterThanOrEqual(0);
          expect(span.x + span.w, `mask ${mask}`).toBeLessThanOrEqual(32);
          expect(span.y + span.h, `mask ${mask}`).toBeLessThanOrEqual(32);
        }
      }
    }
  });

  it('is the same every time, so a field does not shimmer between boots', () => {
    expect(fringeSpans(7, 3)).toEqual(fringeSpans(7, 3));
  });

  it('gives a different shape to a different seed, so three boundaries do not repeat', () => {
    expect(fringeSpans(15, 3)).not.toEqual(fringeSpans(15, 20));
  });

  it('touches the top edge only when the mask names north', () => {
    const north = (spans: ReturnType<typeof fringeSpans>) => spans.some((span) => span.y === 0);
    expect(north(fringeSpans(1, 3))).toBe(true);
    expect(north(fringeSpans(4, 3))).toBe(false);
  });

  it('wobbles rather than drawing a second straight line beside the first', () => {
    // A fringe of even depth is what the dithering exists to avoid.
    const depths = new Set(
      fringeSpans(1, 3)
        .filter((span) => span.role === 'body' && span.y === 0)
        .map((span) => span.h),
    );
    expect(depths.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/game/assets/fringe.test.ts`
Expected: FAIL — `fringeSpans is not exported`.

- [ ] **Step 3: Extract the geometry**

In `createPixelArtTextures.ts`, replace the body of `drawFringe` with a call to a new exported function that returns the same rectangles it used to fill. Keep the numbers exactly as they are.

```ts
/** One rectangle of a fringe, and what it is for. */
export interface FringeSpan {
  x: number;
  y: number;
  w: number;
  h: number;
  role: 'body' | 'dark' | 'light';
}

/**
 * The shape of one fringe, without the colours.
 *
 * The depth wobbles pixel by pixel and the leading edge is dithered, which is
 * the entire trick — a fringe of even depth is a second straight line drawn
 * beside the first, and the map still looks like a spreadsheet. None of that
 * depends on what the fringe is made of, so it lives here where it can be
 * tested without a canvas.
 */
export function fringeSpans(mask: number, seed: number): FringeSpan[] {
  const spans: FringeSpan[] = [];
  const body = (x: number, y: number, w: number, h: number) => spans.push({ x, y, w, h, role: 'body' });
  const dot = (role: 'body' | 'dark' | 'light', x: number, y: number) => spans.push({ x, y, w: 1, h: 1, role });
  const depthAt = (i: number, side: number) => 3 + Math.floor(hash(i, side, seed) * 5);

  if (mask & 1) {
    for (let x = 0; x < TILE; x += 1) {
      const d = depthAt(x, 1);
      body(x, 0, 1, d);
      dot('dark', x, d - 1);
      if (hash(x, 31, seed) > 0.66) dot('body', x, d);
      if (hash(x, 57, seed) > 0.82) dot('light', x, Math.max(0, d - 3));
    }
  }
  if (mask & 2) {
    for (let y = 0; y < TILE; y += 1) {
      const d = depthAt(y, 2);
      body(TILE - d, y, d, 1);
      dot('dark', TILE - d, y);
      if (hash(y, 41, seed) > 0.66) dot('body', TILE - d - 1, y);
      if (hash(y, 67, seed) > 0.82) dot('light', TILE - Math.max(1, d - 2), y);
    }
  }
  if (mask & 4) {
    for (let x = 0; x < TILE; x += 1) {
      const d = depthAt(x, 4);
      body(x, TILE - d, 1, d);
      dot('dark', x, TILE - d);
      if (hash(x, 53, seed) > 0.66) dot('body', x, TILE - d - 1);
      if (hash(x, 79, seed) > 0.82) dot('light', x, TILE - Math.max(1, d - 2));
    }
  }
  if (mask & 8) {
    for (let y = 0; y < TILE; y += 1) {
      const d = depthAt(y, 8);
      body(0, y, d, 1);
      dot('dark', d - 1, y);
      if (hash(y, 61, seed) > 0.66) dot('body', d, y);
      if (hash(y, 83, seed) > 0.82) dot('light', Math.max(0, d - 3), y);
    }
  }
  return spans;
}

function drawFringe(
  ctx: CanvasRenderingContext2D,
  mask: number,
  palette: { body: string; dark: string; light: string },
  seed: number,
) {
  ctx.clearRect(0, 0, TILE, TILE);
  for (const span of fringeSpans(mask, seed)) {
    rect(ctx, palette[span.role], span.x, span.y, span.w, span.h);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/game/assets/fringe.test.ts && npm run lint`
Expected: PASS, 6 tests; lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/game/assets/createPixelArtTextures.ts src/game/assets/fringe.test.ts
git commit -m "refactor(art): separate the fringe geometry from its colours"
```

---

### Task 8: Fringes made of the real tile

**Files:**
- Modify: `src/game/assets/createPixelArtTextures.ts` (`drawFringe`, `createEdgeTextures`, delete `FRINGE_PALETTES`)
- Create: `src/game/assets/fakeScene.ts`
- Test: `src/game/assets/fringe.test.ts` (extend)

**Interfaces:**
- Consumes: `fringeSpans`, `FringeSpan` from Task 7.
- Produces: `drawFringe(ctx, mask, seed, tile: CanvasImageSource)` — note the changed signature; `palette` is gone and `tile` is new.

- [ ] **Step 1: Write the failing test**

Create `src/game/assets/fakeScene.ts` — a stand-in Phaser scene that records which
textures were built and what was drawn into them. jsdom has no 2D context, so
the context is a proxy that answers every call with another proxy and remembers
nothing except what the harness asks it to.

```ts
/**
 * Enough of a Phaser scene to run `createPixelArtTextures` in a test.
 *
 * jsdom has no 2D canvas context, so there is no real drawing to inspect. What
 * there is, and what the tests here care about, is the shape of the
 * conversation: which texture keys get built, and which existing textures get
 * read while building them.
 */
export interface FakeScene {
  keys: string[];
  /** Texture keys whose source image was read, e.g. by the fringe builder. */
  sampled: string[];
  drawImageCalls: number;
  scene: never;
}

export function fakeScene(existing: string[] = []): FakeScene {
  const keys: string[] = [];
  const sampled: string[] = [];
  const state = { drawImageCalls: 0 };

  const ctx = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'canvas') return { width: 1, height: 1 };
          if (prop === 'drawImage') {
            return () => {
              state.drawImageCalls += 1;
            };
          }
          return () => ctx();
        },
        set: () => true,
      },
    );

  const scene = {
    textures: {
      exists: (key: string) => existing.includes(key) || keys.includes(key),
      get: (key: string) => ({
        getSourceImage: () => {
          sampled.push(key);
          return { width: 32, height: 32 };
        },
      }),
      createCanvas: (key: string) => {
        keys.push(key);
        return { getContext: () => ctx(), refresh: () => undefined };
      },
    },
  };

  return {
    keys,
    sampled,
    get drawImageCalls() {
      return state.drawImageCalls;
    },
    scene: scene as never,
  };
}
```

Append to `src/game/assets/fringe.test.ts`:

```ts
import { createPixelArtTextures } from './createPixelArtTextures';
import { fakeScene } from './fakeScene';

describe('edge textures', () => {
  it('cuts each fringe out of the tile it is made of', () => {
    const fake = fakeScene();
    createPixelArtTextures(fake.scene);

    // The fringe is now the real grass and the real path, sampled. If this
    // stops happening the edges silently go back to being flat colour, which
    // is exactly the regression nobody notices in a diff.
    expect(fake.sampled).toContain('tile-grass');
    expect(fake.sampled).toContain('tile-path');
    expect(fake.drawImageCalls).toBeGreaterThanOrEqual(45);
  });

  it('still builds all 45 overlays', () => {
    const fake = fakeScene();
    createPixelArtTextures(fake.scene);
    expect(fake.keys.filter((key) => key.startsWith('edge-')).length).toBe(45);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/game/assets/fringe.test.ts`
Expected: FAIL — `expected [] to contain 'tile-grass'`, because today's `drawFringe` reads `FRINGE_PALETTES` and never touches a texture. The 45-overlay test passes already; it is the guard that Step 3 does not lose any.

- [ ] **Step 3: Paint the fringe with the tile beside it**

Replace `drawFringe` and `createEdgeTextures`, and delete `FRINGE_PALETTES`:

```ts
/**
 * One fringe: the material of a neighbouring tile, drawn over this one.
 *
 * The fringe used to be three flat colours standing in for grass. It is now
 * cut out of the grass — the mask is drawn, the composite is switched to
 * `source-in`, and the real tile is painted through it. Grass spilling over a
 * path is now literally the pixels of the grass beside it, which is one fewer
 * place for a hand-picked green to disagree with the art.
 *
 * It still works under the fallback, because it samples whatever `tile-grass`
 * currently is rather than a file it hopes is there.
 */
function drawFringe(
  ctx: CanvasRenderingContext2D,
  mask: number,
  seed: number,
  tile: CanvasImageSource,
) {
  ctx.clearRect(0, 0, TILE, TILE);
  const spans = fringeSpans(mask, seed);

  // Any opaque colour: only the alpha of this pass survives the composite.
  for (const span of spans) {
    if (span.role !== 'dark') rect(ctx, PALETTE['light.0'], span.x, span.y, span.w, span.h);
  }

  ctx.globalCompositeOperation = 'source-in';
  ctx.drawImage(tile, 0, 0, TILE, TILE);
  ctx.globalCompositeOperation = 'source-over';

  // The leading edge and the highlight go on top of the real pixels. Both are
  // translucent, so they shade the tile rather than replacing it — a fringe
  // that is only the tile has no edge, and the map goes back to looking flat.
  for (const span of spans) {
    if (span.role === 'dark') {
      rect(ctx, withAlpha(PALETTE['shadow.1'], 0.35), span.x, span.y, span.w, span.h);
    } else if (span.role === 'light') {
      rect(ctx, withAlpha(PALETTE['light.1'], 0.45), span.x, span.y, span.w, span.h);
    }
  }
}

function createEdgeTextures(scene: Phaser.Scene) {
  FRINGE_BOUNDARIES.forEach(({ over, under }, index) => {
    const tile = scene.textures.get(`tile-${over}`)?.getSourceImage() as CanvasImageSource | undefined;
    if (!tile) continue;
    for (let mask = 1; mask <= 15; mask += 1) {
      withTexture(scene, fringeTexture(over, under, mask), TILE, TILE, (ctx) =>
        drawFringe(ctx, mask, index * 17 + 3, tile),
      );
    }
  });
}
```

Note `createEdgeTextures` must be called *after* the tile textures exist. It already is: `createPixelArtTextures` builds `tile-grass` and `tile-path` at the top and calls `createEdgeTextures` near the end, and the scene loads the real PNGs before either.

`forEach` cannot `continue`; change the loop to `for (const [index, { over, under }] of FRINGE_BOUNDARIES.entries())`.

- [ ] **Step 4: Run the tests and the palette lock**

Run: `npm run lint && npx vitest run src/game/assets && node --test scripts/palette-lock.test.mjs`
Expected: PASS. The palette lock matters here because two new `withAlpha` colours were introduced; both come from `PALETTE`, so it should be clean.

- [ ] **Step 5: Look at it**

Run: `npm run dev`, open the farm, and find a path meeting grass and a shore meeting water.
Expected: the fringe now carries the grass's speckle rather than a flat green, and the boundary still has a dark leading edge.

- [ ] **Step 6: Commit**

```bash
git add src/game/assets/createPixelArtTextures.ts src/game/assets/fringe.test.ts src/game/assets/fakeScene.ts
git commit -m "feat(art): cut tile fringes out of the tile beside them"
```

---

### Task 9: A url lookup in the generated manifest

**Files:**
- Modify: `scripts/generate-lpc-manifest.mjs`
- Modify (generated): `src/game/assets/lpc.generated.ts`
- Test: `src/game/assets/lpc.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export const LPC_URL_BY_KEY: Readonly<Record<string, string>>` in `lpc.generated.ts`. Task 10 and Task 11 consume it.

- [ ] **Step 1: Write the failing test**

Append to `src/game/assets/lpc.test.ts`, inside the existing `describe('the LPC manifest', ...)`:

```ts
  it('offers the same images as a lookup, for the panels React draws', () => {
    // The Phaser side asks for a texture by key; the inventory grid is React
    // and has only the url. Both have to come from the same generated list, or
    // an item's icon and its field sprite drift apart again.
    expect(Object.keys(LPC_URL_BY_KEY).sort()).toEqual(LPC_IMAGES.map(([key]) => key).sort());
    for (const [key, url] of LPC_IMAGES) {
      expect(LPC_URL_BY_KEY[key]).toBe(url);
    }
  });
```

Add `LPC_URL_BY_KEY` to the import at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/game/assets/lpc.test.ts`
Expected: FAIL — `LPC_URL_BY_KEY` is not exported.

- [ ] **Step 3: Emit it from the generator**

In `scripts/generate-lpc-manifest.mjs`, append to the `body` template, after the `LPC_IMAGES` block:

```js
/**
 * The same images, by key.
 *
 * \`LPC_IMAGES\` is a list because the loader walks it once at boot.
 * \`ItemIcon\` in the React panels has the opposite question — "is there a
 * drawing for this one item, and where is it" — and asking that of a list is
 * a scan per cell of the inventory grid.
 */
export const LPC_URL_BY_KEY: Readonly<Record<string, string>> = {
${images.map((name) => `  '${name}': '/assets/lpc/${name}.png',`).join('\n')}
};
```

- [ ] **Step 4: Regenerate and run the tests**

Run: `npm run lpc:manifest && npx vitest run src/game/assets/lpc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-lpc-manifest.mjs src/game/assets/lpc.generated.ts src/game/assets/lpc.test.ts
git commit -m "feat(art): expose the art manifest as a key lookup"
```

---

### Task 10: React icons read the PNG when there is one

**Files:**
- Modify: `src/components/ItemIcon.tsx`
- Modify: `src/styles.css`
- Test: `src/components/ItemIcon.test.tsx` (create)

**Interfaces:**
- Consumes: `LPC_URL_BY_KEY` from Task 9; `ITEMS` from `src/game/systems/items`.
- Produces: no new exports. `ItemIcon` keeps its `{ item, size }` props.

- [ ] **Step 1: Write the failing test**

Create `src/components/ItemIcon.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/**
 * The satchel icon, which has two possible sources.
 *
 * Every item used to be rectangles replayed from `itemIcons`. As real art
 * arrives one item at a time, each one has to switch over on its own without
 * anybody editing this component — so the test is that the manifest decides,
 * not a list in here.
 */
vi.mock('../game/assets/lpc.generated', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../game/assets/lpc.generated')>()),
  LPC_URL_BY_KEY: { 'item-turnip': '/assets/lpc/item-turnip.png' },
}));

const { default: ItemIcon } = await import('./ItemIcon');

describe('ItemIcon', () => {
  it('draws the PNG when the manifest has one', () => {
    const { container } = render(<ItemIcon item="turnip" size={32} />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/assets/lpc/item-turnip.png');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('falls back to the generated rectangles when it does not', () => {
    const { container } = render(<ItemIcon item="wood" size={32} />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('honours the requested size either way', () => {
    const png = render(<ItemIcon item="turnip" size={48} />).container.querySelector('img');
    expect(png?.getAttribute('width')).toBe('48');
    const svg = render(<ItemIcon item="wood" size={48} />).container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('48');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/ItemIcon.test.tsx`
Expected: FAIL — no `img` is rendered.

- [ ] **Step 3: Branch on the manifest**

Replace the body of `src/components/ItemIcon.tsx`:

```tsx
import { ICON_SIZE, iconFor } from '../game/assets/itemIcons';
import { LPC_URL_BY_KEY } from '../game/assets/lpc.generated';
import { ITEMS, type ItemId } from '../game/systems/items';

/**
 * One item's art: the drawing if there is one, the rectangles if there is not.
 *
 * The rectangles are the same ones the Phaser hotbar fills onto a canvas, so a
 * turnip in the grid is the turnip in the hotbar. When real art arrives for an
 * item, both sides switch together — Phaser because `withTexture` yields to a
 * loaded image, and this because the key is in the manifest — which is what
 * closes the old gap where a field sprite and a satchel icon agreed on colour
 * but not on shape.
 */
export default function ItemIcon({ item, size = 32 }: { item: ItemId; size?: number }) {
  const url = LPC_URL_BY_KEY[ITEMS[item].texture];
  if (url) {
    return <img className="item-icon" src={url} width={size} height={size} alt="" aria-hidden="true" />;
  }

  const shapes = iconFor(item);
  return (
    <svg
      className="item-icon"
      width={size}
      height={size}
      viewBox={`0 0 ${ICON_SIZE} ${ICON_SIZE}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {shapes.map(([color, x, y, w, h], index) => (
        <rect key={index} fill={color} x={x} y={y} width={w} height={h} />
      ))}
    </svg>
  );
}
```

- [ ] **Step 4: Keep the pixels square**

Add to `src/styles.css`, beside the other `.item-icon` rules:

```css
/* A 32px sprite shown at 48 has to stay a 32px sprite. Without this the
   browser smooths it, and one icon in a grid of crisp ones reads as blurry
   rather than as larger. */
img.item-icon {
  image-rendering: pixelated;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/components/ItemIcon.test.tsx && npm run lint`
Expected: PASS, 3 tests; lint clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/ItemIcon.tsx src/components/ItemIcon.test.tsx src/styles.css
git commit -m "feat(art): let the satchel show a drawing when there is one"
```

---

### Task 11: No item can render blank

**Files:**
- Test: `src/game/assets/itemIcons.test.ts` (extend)

**Interfaces:**
- Consumes: `LPC_URL_BY_KEY` from Task 9; `ITEMS`, `iconFor`.
- Produces: nothing.

**Why this is the guard that matters:** from here on, art arrives one file at a time and the manifest is generated from a directory listing. The failure mode is an item whose texture key matches neither a PNG nor a generated icon — it does not throw, it ships, and it is an empty square in the hotbar.

- [ ] **Step 1: Write the failing test**

Append to `src/game/assets/itemIcons.test.ts`:

```ts
import { ITEMS, type ItemId } from '../systems/items';
import { LPC_URL_BY_KEY } from './lpc.generated';
import { iconFor } from './itemIcons';

describe('every item has something to draw', () => {
  it('resolves to a PNG or to rectangles, never to nothing', () => {
    for (const id of Object.keys(ITEMS) as ItemId[]) {
      const key = ITEMS[id].texture;
      const drawn = Boolean(LPC_URL_BY_KEY[key]) || iconFor(id).length > 0;
      expect(drawn, `${id} (texture "${key}") would render blank`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/game/assets/itemIcons.test.ts`
Expected: PASS today — every item currently has generated rectangles. It is a guard for the batches to come, and if it fails now that is a real bug found early.

- [ ] **Step 3: Run everything**

Run: `npm run quality:fast`
Expected: lint clean, all tests pass, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/game/assets/itemIcons.test.ts
git commit -m "test(art): no item may render as an empty square"
```

---

## What this plan does not cover

Batches 2 through 7 of the spec — the 182 actual imports. Those are table rows, and their coordinates cannot be written before the packs are on disk and have been looked at. Each gets its own plan, written against the real files, and each follows the same loop:

1. Add the pack to `art/sources.json` with its digest.
2. Add cuts, one per target.
3. `npm run art:sync -- --verify` to see what lands, then `npm run art:sync` to write.
4. `npm run palette:apply && npm run lpc:manifest`.
5. Add a section to `CREDITS.md` with authors, licence and url — `--check` fails the build until it is there.
6. `npm run quality:fast`, then look at the farm.

Batch 2 carries one extra step, from the spec's risk section: measure the mean OkLab distance between each new file and its quantised output, and stop if it is out of tolerance, because widening the palette is its own spec.
