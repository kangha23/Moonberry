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
