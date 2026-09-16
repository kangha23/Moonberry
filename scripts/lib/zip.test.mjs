/**
 * Tests for the zip reader.
 *
 * Run by `node --test` alongside `png.test.mjs`: this is build tooling, and it
 * never goes through the app's TypeScript project.
 *
 * There is no sample archive checked into the repo to read — every test
 * builds its own zip byte-for-byte with `buildZip` below, including the
 * malformed ones, because a "known-bad" fixture file is just as easy to lose
 * track of as a known-good one, and a reader for a format nobody but this
 * script parses is worth pinning down at the byte level.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';
import { extractZipMember } from './zip.mjs';

// --- building zips extractZipMember cannot make itself ----------------------

/**
 * A minimal zip archive: one local header + data per entry, followed by one
 * central directory, followed by one end-of-central-directory record.
 *
 * `entries` is `{ name, data, method }[]`, `method` one of `'stored'` (the
 * default) or `'deflate'`. Per-entry `flags`, and per-entry
 * `centralCompressedSize` / `centralUncompressedSize` / `centralLocalOffset`
 * overrides of what the *central directory* copy of that entry says (as
 * opposed to what is really there), exist so the corrupt-archive tests can
 * lie about exactly one field without hand-assembling the whole record.
 *
 * The crc32 field is always written as zero. `extractZipMember` does not
 * check it — see the comment in `zip.mjs` explaining why — so no test here
 * needs a working crc32 implementation to build a byte-exact archive.
 */
function buildZip(entries, eocdOverrides = {}) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = Buffer.from(entry.data ?? '', 'utf8');
    const method = entry.method === 'deflate' ? 8 : entry.method === undefined ? 0 : entry.method;
    const compressed = entry.method === 'deflate' ? zlib.deflateRawSync(dataBuf) : dataBuf;
    const flags = entry.flags ?? 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14); // crc32, unchecked
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(0, 16); // crc32, unchecked
    central.writeUInt32LE(entry.centralCompressedSize ?? compressed.length, 20);
    central.writeUInt32LE(entry.centralUncompressedSize ?? dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(entry.centralLocalOffset ?? offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const localSection = Buffer.concat(localParts);
  const centralSection = Buffer.concat(centralParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(eocdOverrides.totalEntries ?? entries.length, 8);
  eocd.writeUInt16LE(eocdOverrides.totalEntries ?? entries.length, 10);
  eocd.writeUInt32LE(eocdOverrides.centralDirectorySize ?? centralSection.length, 12);
  eocd.writeUInt32LE(eocdOverrides.centralDirectoryOffset ?? localSection.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localSection, centralSection, eocd]);
}

// --- happy path ---------------------------------------------------------------

test('reads a stored (uncompressed) member', () => {
  const zip = buildZip([{ name: 'plants.png', data: 'not really a png, just bytes' }]);
  const member = extractZipMember(zip, 'plants.png', 'test.zip');
  assert.equal(member.toString('utf8'), 'not really a png, just bytes');
});

test('reads a deflated member', () => {
  const data = 'x'.repeat(500) + 'some varying tail to make deflate do real work';
  const zip = buildZip([{ name: 'plants.png', data, method: 'deflate' }]);
  const member = extractZipMember(zip, 'plants.png', 'test.zip');
  assert.equal(member.toString('utf8'), data);
});

test('finds the right member among several, regardless of order', () => {
  const zip = buildZip([
    { name: 'readme.txt', data: 'ignore me' },
    { name: 'sub/plants.png', data: 'the one wanted', method: 'deflate' },
    { name: 'sub/other.png', data: 'ignore me too' },
  ]);
  const member = extractZipMember(zip, 'sub/plants.png', 'test.zip');
  assert.equal(member.toString('utf8'), 'the one wanted');
});

// --- refusals -------------------------------------------------------------

test('refuses a buffer with no end-of-central-directory record', () => {
  assert.throws(
    () => extractZipMember(Buffer.from('not a zip at all'), 'plants.png', 'test.zip'),
    /test\.zip is not a zip file/,
  );
});

test('refuses a member that is not in the archive, naming the archive and the member', () => {
  const zip = buildZip([{ name: 'plants.png', data: 'x' }]);
  assert.throws(
    () => extractZipMember(zip, 'missing.png', 'lpc-flowers-plants-fungi-wood.zip'),
    /lpc-flowers-plants-fungi-wood\.zip.*"missing\.png"/s,
  );
});

test('refuses an encrypted member', () => {
  const zip = buildZip([{ name: 'plants.png', data: 'x', flags: 0x0001 }]);
  assert.throws(() => extractZipMember(zip, 'plants.png', 'test.zip'), /"plants\.png" is encrypted/);
});

test('refuses an archive whose end-of-central-directory record claims zip64', () => {
  const zip = buildZip([{ name: 'plants.png', data: 'x' }], { totalEntries: 0xffff });
  assert.throws(() => extractZipMember(zip, 'plants.png', 'test.zip'), /test\.zip is a zip64 archive/);
});

test('refuses a member whose central directory record has a zip64 sentinel size', () => {
  const zip = buildZip([{ name: 'plants.png', data: 'x', centralUncompressedSize: 0xffffffff }]);
  assert.throws(() => extractZipMember(zip, 'plants.png', 'test.zip'), /"plants\.png" has a zip64/);
});

test('refuses an unsupported compression method', () => {
  // Method 12 is bzip2 in the zip spec's registry. Nothing here needs to name
  // every method zip allows — only stored and deflate are ever produced by the
  // archives this script downloads, and this is the fallback for anything else.
  const zip = buildZip([{ name: 'plants.png', data: 'x', method: 12 }]);
  assert.throws(() => extractZipMember(zip, 'plants.png', 'test.zip'), /compression method 12/);
});

test('refuses a member whose inflated size does not match what the central directory promised', () => {
  const zip = buildZip([{ name: 'plants.png', data: 'x', centralUncompressedSize: 999 }]);
  assert.throws(() => extractZipMember(zip, 'plants.png', 'test.zip'), /inflated to 1 bytes.*says 999/s);
});
