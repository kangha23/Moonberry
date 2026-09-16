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
 * Geometry field checks, so a mistyped `"cell": 3` dies here naming the row
 * that is wrong, rather than three files away inside `cutFlags`' `cut.cell.join(',')`
 * as a `TypeError` naming nothing. A mistyped number is the most likely
 * mistake across 182 hand-written rows, and it is exactly the kind of error
 * this module's own docstring says "invalid sources.json" fails to help with.
 */
function wantWholeNumber(target, field, value) {
  if (!Number.isInteger(value)) {
    throw new Error(`Cut "${target}" has a non-whole-number "${field}": ${JSON.stringify(value)}.`);
  }
}

function wantWholeNumberArray(target, field, value, length) {
  if (!Array.isArray(value) || value.length !== length || !value.every(Number.isInteger)) {
    throw new Error(
      `Cut "${target}" has an invalid "${field}": expected an array of ${length} whole numbers, got ` +
        `${JSON.stringify(value)}.`,
    );
  }
}

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

    if (cut.file && cut.layers) {
      throw new Error(
        `Cut "${target}" names both "file" and "layers"; a cut is one flat file or a layered stack, ` +
          'never both, and writing both silently resolves to "layers" while the "file" is ignored.',
      );
    }
    if (!cut.layers && !pack.files?.[cut.file]) {
      throw new Error(`Cut "${target}" names file "${cut.file}", which pack "${cut.pack}" does not list.`);
    }

    if (cut.layers) {
      const positions = new Map();
      for (const [name, entry] of Object.entries(cut.layers)) {
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

        // Each layer is its own download, and the same pin the pack files get:
        // six villager sheets at ten to twenty layers each is sixty to a
        // hundred and twenty fetches per sync, and without a digest not one of
        // them is verified — `--verify` on a layered cut would be meaningless.
        if (!entry?.from) throw new Error(`Cut "${target}" layer "${name}" has no source url.`);
        if (!SHA256.test(entry.sha256 ?? '')) {
          throw new Error(
            `Cut "${target}" layer "${name}" has no sha256. An unpinned download is not ` +
              'reproducible: upstream can change the file and nobody would know.',
          );
        }
      }
    }

    if (cut.cell !== undefined) wantWholeNumberArray(target, 'cell', cut.cell, 2);
    if (cut.rect !== undefined) wantWholeNumberArray(target, 'rect', cut.rect, 4);
    if (cut.grid !== undefined) wantWholeNumber(target, 'grid', cut.grid);
    if (cut.scale !== undefined) wantWholeNumber(target, 'scale', cut.scale);
    if (cut.frame !== undefined) wantWholeNumber(target, 'frame', cut.frame);
    if (cut.row !== undefined) wantWholeNumber(target, 'row', cut.row);
  }

  return json;
}

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
 * Matched against markdown heading lines only, not any occurrence of the
 * title anywhere in the file. A bare substring match lets `[LPC] Fish` be
 * "credited" by a file that only mentions `[LPC] Fishing Rod` in passing, or
 * by a sentence saying the art was *not* taken from that pack — and with
 * around eight similarly-named LPC packs in the table, that is not a
 * hypothetical. A heading is what a reader actually looks for when checking
 * whether a pack is credited, so it is what this checks for too.
 *
 * Only packs a cut actually uses are required: declaring a pack and not using
 * it yet is a legitimate half-finished state, and shipping its art without
 * credit is not.
 */
/** A literal string as a regex, so `[LPC] Fish` searches for those characters and not a class. */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether a heading credits this exact title, not a longer one that happens
 * to start with it.
 *
 * `[LPC] Fish` is a literal prefix of `[LPC] Fishing Rod` — the two packs this
 * fix was written to tell apart — so `heading.includes(title)` alone still
 * matches the wrong one. Requiring that the character right after the title
 * is not a letter rejects that: `[LPC] Fishing Rod` fails because `h` follows
 * immediately, while `[LPC] Fish (CC-BY-SA 3.0)` passes because a space does.
 */
function creditsTitle(heading, title) {
  return new RegExp(`${escapeRegExp(title)}(?![A-Za-z])`).test(heading);
}

export function missingCredits({ packs, cuts, credits }) {
  const used = new Set(cuts.map((cut) => cut.pack));
  const headings = credits.split('\n').filter((line) => /^#{1,6}\s/.test(line));
  return [...used]
    .filter((name) => {
      const title = packs[name]?.title;
      return !title || !headings.some((line) => creditsTitle(line, title));
    })
    .sort();
}
