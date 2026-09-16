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

/** A colour in a recolour map: six hex digits, no hash. */
const HEX6 = /^[0-9a-fA-F]{6}$/;

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
 * Checks that a path naming a file to be written to disk cannot land outside
 * the directory it is written into.
 *
 * Used for a pack file's `extract`: `art-sync.mjs` inflates the named archive
 * member and writes it under `art/sources/<pack>/`, so an absolute path (POSIX
 * or a Windows drive letter — this repo is developed on both) or a ".."
 * segment in that name would write somewhere else entirely. Slashes are
 * otherwise fine and expected: an archive member is a path inside the zip
 * (`lpc-flowers-plants-fungi-wood/plants.png`), not a bare file name, which is
 * why this is its own check rather than reusing the layer-name one above —
 * that one forbids any slash at all, because a layer name is not a path.
 */
function wantSafePath(context, field, value) {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${context} has an invalid "${field}": expected a non-empty path.`);
  }
  if (value.includes('\\')) {
    throw new Error(`${context} has an invalid "${field}" "${value}": it must not contain a backslash.`);
  }
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new Error(`${context} has an invalid "${field}" "${value}": it must be a relative path.`);
  }
  if (value.split('/').includes('..')) {
    throw new Error(`${context} has an invalid "${field}" "${value}": it must not contain a ".." segment.`);
  }
}

/**
 * Checks the table over, and hands it back so callers can chain.
 *
 * Every failure names the entry that caused it. A validator that says "invalid
 * sources.json" about a 182-row table has not helped anybody.
 */
/**
 * A cut assembled from rectangles of one or more sheets.
 *
 * Its `pack` is still required and still has to be credited: it names the
 * pack the drawing is mostly made of. Every other pack a piece is taken from
 * is credited too — see `packsUsed`.
 *
 * Exclusive with every other way of choosing a region, because a cut that
 * named both `pieces` and a `rect` would have to pick one of them silently.
 */
function validatePieces(target, cut, packs) {
  if (!Array.isArray(cut.pieces) || cut.pieces.length === 0) {
    throw new Error(`Cut "${target}" has an empty "pieces"; a pieced cut needs at least one piece.`);
  }
  for (const other of ['file', 'layers', 'rect', 'grid', 'cell', 'walkcycle', 'animals']) {
    if (cut[other] !== undefined) {
      throw new Error(`Cut "${target}" names both "pieces" and "${other}"; a cut chooses its pixels one way.`);
    }
  }
  wantWholeNumberArray(target, 'size', cut.size, 2);
  cut.pieces.forEach((piece, index) => {
    const label = `${target} piece ${index}`;
    const from = packs[piece?.pack];
    if (!from) throw new Error(`Cut "${label}" names pack "${piece?.pack}", which is not declared.`);
    if (!from.files?.[piece.file]) {
      throw new Error(`Cut "${label}" names file "${piece.file}", which pack "${piece.pack}" does not list.`);
    }
    wantWholeNumberArray(label, 'rect', piece.rect, 4);
    wantWholeNumberArray(label, 'at', piece.at, 2);
  });
}

/** Every pack a cut takes pixels from: its own, and each of its pieces'. */
export function packsUsed(cut) {
  return [cut.pack, ...(cut.pieces ?? []).map((piece) => piece.pack)];
}

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
      // `extract` names a member inside the downloaded archive; the sha256
      // above pins the archive itself, since that is the thing upstream can
      // change, not the member path, which is this table's own claim.
      if (entry.extract !== undefined) {
        wantSafePath(`Pack "${name}" file "${file}"`, 'extract', entry.extract);
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
    // The same rule `planImport` in import-lpc.mjs already enforces on a
    // target, for the same reason plus one: a layered cut's target becomes a
    // directory name under art/sources/ (see layerFolder in art-sync.mjs),
    // and that directory gets swept of anything not in the cut's current
    // layers. An unvalidated target of e.g. "../../../evil" would point that
    // sweep at a real directory outside art/sources/ entirely and delete
    // whatever it finds there.
    if (!/^[a-z0-9-]+$/.test(target)) {
      throw new Error(
        `Cut target "${target}" must be lower-case letters, digits and dashes, with no extension, ` +
          'path separator or "..". It is used to build a filesystem path under art/sources/.',
      );
    }
    if (seen.has(target)) throw new Error(`Two cuts both write "${target}".`);
    seen.add(target);

    if (target in notImported) {
      throw new Error(`"${target}" is both a cut and listed as not imported; it cannot be both.`);
    }

    const pack = packs[cut.pack];
    if (!pack) throw new Error(`Cut "${target}" names pack "${cut.pack}", which is not declared.`);

    if (cut.pieces !== undefined) validatePieces(target, cut, packs);

    if (cut.file && cut.layers) {
      throw new Error(
        `Cut "${target}" names both "file" and "layers"; a cut is one flat file or a layered stack, ` +
          'never both, and writing both silently resolves to "layers" while the "file" is ignored.',
      );
    }
    if (!cut.layers && !cut.pieces && !pack.files?.[cut.file]) {
      throw new Error(`Cut "${target}" names file "${cut.file}", which pack "${cut.pack}" does not list.`);
    }

    if (cut.layers) {
      // An empty `layers: {}` is a truthy object, so it would otherwise sail
      // through every check below having named zero layers — and then
      // layerFolder would sweep the cut's cache directory clean, with
      // nothing in the table to write back into it.
      if (Object.keys(cut.layers).length === 0) {
        throw new Error(
          `Cut "${target}" has an empty "layers". A layered cut needs at least one layer to ` +
            'composite; remove "layers" entirely if this cut is not ready yet.',
        );
      }

      const positions = new Map();
      for (const [name, entry] of Object.entries(cut.layers)) {
        // Layer names are written as files inside a directory built from the
        // cut's target (see layerFolder in art-sync.mjs), so a name carrying
        // a path separator or ".." can write or delete outside it. Unlike the
        // target above, a layer name legitimately contains a space and a dot
        // ("010 body.png"), so it gets its own, narrower rule rather than the
        // target's `[a-z0-9-]+`.
        if (/[\\/]/.test(name) || name.includes('..')) {
          throw new Error(
            `Cut "${target}" layer "${name}" is not a safe file name: it must not contain a path ` +
              'separator or "..".',
          );
        }

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

        // A layer's own colours, swapped before it is stacked. The generator
        // ships one drawing per item in a base palette and recolours it at
        // runtime, and a skin and a shirt can share a base colour — so a
        // recolour applied to the finished stack could not tell the two apart.
        if (entry?.recolour !== undefined) {
          const pairs = entry.recolour && typeof entry.recolour === 'object' ? Object.entries(entry.recolour) : null;
          if (!pairs || pairs.length === 0 || !pairs.every(([a, b]) => HEX6.test(a) && HEX6.test(b))) {
            throw new Error(
              `Cut "${target}" layer "${name}" has an invalid "recolour": expected a non-empty map of ` +
                'six-digit hex colours, like { "cc8665": "7f4c31" }.',
            );
          }
        }

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
    if (cut.box !== undefined) wantWholeNumberArray(target, 'box', cut.box, 2);
    if (cut.floor !== undefined) wantWholeNumber(target, 'floor', cut.floor);
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
  if (cut.dropstand) flags.dropstand = true;
  if (cut.animals) flags.animals = true;
  if (cut.frame !== undefined) flags.frame = String(cut.frame);
  if (cut.row !== undefined) flags.row = String(cut.row);
  if (cut.box !== undefined) flags.box = cut.box.join('x');
  if (cut.floor !== undefined) flags.floor = String(cut.floor);
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
  const used = new Set(cuts.flatMap(packsUsed));
  const headings = credits.split('\n').filter((line) => /^#{1,6}\s/.test(line));
  return [...used]
    .filter((name) => {
      const title = packs[name]?.title;
      return !title || !headings.some((line) => creditsTitle(line, title));
    })
    .sort();
}
