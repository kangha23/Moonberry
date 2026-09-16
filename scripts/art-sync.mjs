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
import path from 'node:path';
import { OUT_DIR, planImport, readSource } from './import-lpc.mjs';
import { encodeImage } from './lib/png.mjs';
import { cutFlags, missingCredits, reconcile, validateSources } from './lib/sources.mjs';

const SOURCES_FILE = path.join('art', 'sources.json');
const CACHE_DIR = path.join('art', 'sources');
// The hand-written file, not `public/assets/lpc/CREDITS.md`. That copy is
// *generated* by `apply-palette.mjs` from this one plus a modification
// notice, so crediting a new pack here and running `--check` before
// `palette:apply` would fail naming a file nobody is meant to edit — and
// editing the generated copy directly would build green today and vanish
// silently the next time someone runs `palette:apply`.
const CREDITS_FILE = path.join('art', 'raw', 'lpc', 'CREDITS.md');

function readSources() {
  if (!fs.existsSync(SOURCES_FILE)) throw new Error(`No ${SOURCES_FILE}.`);
  return validateSources(JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8')));
}

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * One file on disk, downloaded if it is not there yet, under `subDir` when
 * given.
 *
 * The digest is checked every time, not only after a download. A cached file
 * that has been edited by hand is exactly the situation the pin is for.
 */
async function packFile(packName, fileName, entry, subDir = '') {
  const target = path.join(CACHE_DIR, packName, subDir, fileName);
  if (!fs.existsSync(target)) {
    process.stdout.write(`downloading ${packName}/${subDir ? `${subDir}/` : ''}${fileName}\n`);
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

/**
 * A layered cut's folder: every layer cached and digest-verified exactly the
 * way `packFile` treats a plain pack file, under `art/sources/<pack>/<target>/`.
 *
 * This used to fetch every layer fresh on every run, unpinned, into a
 * `mkdtempSync` folder nothing ever removed — meaningless for `--verify`, and
 * expensive for the six villager sheets `layers` was invented for (ten to
 * twenty layers each). Caching under the pack directory removes the need for
 * a temp directory at all: the cache directory *is* the folder `readSource`
 * wants, and it survives between runs the same way a pack file's cache does.
 *
 * Stale entries are swept first — a layer dropped from the table (a hairstyle
 * changed, say) must not stay in the folder and get composited anyway, which
 * a bare cache-and-verify loop would silently allow.
 */
async function layerFolder(cut) {
  const dir = path.join(CACHE_DIR, cut.pack, cut.target);
  fs.mkdirSync(dir, { recursive: true });
  const wanted = new Set(Object.keys(cut.layers));
  for (const existing of fs.readdirSync(dir)) {
    if (!wanted.has(existing)) fs.rmSync(path.join(dir, existing));
  }
  for (const [name, entry] of Object.entries(cut.layers)) {
    await packFile(cut.pack, name, entry, cut.target);
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
