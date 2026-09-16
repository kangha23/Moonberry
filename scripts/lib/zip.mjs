/**
 * A zip reader, because OpenGameArt ships LPC packs as zips and this repo
 * only ever wants one member out of one.
 *
 * Written by hand for the same reason `png.mjs` decodes PNG by hand:
 * `node:zlib` does the only hard part — inflating deflate data — and a
 * build-time dependency for reading a directory format is not a trade worth
 * making for a script that runs a handful of times a year.
 *
 * This reads exactly as much of the zip format as `art-sync.mjs` needs and
 * refuses the rest. An archive that is zip64 (a file or an offset needing more
 * than 32 bits, or more than 65535 entries), or a member that is encrypted, is
 * refused with a named reason rather than read wrong — a pixel-art pack is a
 * few megabytes and a handful of files, so hitting either of those means
 * something is already unusual about the download, and guessing is worse than
 * stopping.
 */
import zlib from 'node:zlib';

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

/** What a zip writes into a 32-bit size or offset field when the real value needs zip64 instead. */
const ZIP64_SENTINEL = 0xffffffff;

/**
 * Finds the end-of-central-directory record.
 *
 * It is not at a fixed offset from the end of the file: the record's fixed
 * part is the last 22 bytes, but it can be followed by a comment of up to
 * 65535 bytes, so the signature is searched for backwards over that whole
 * span. Nothing earlier in a well-formed archive has a reason to contain
 * this exact four bytes, so the first match scanning backwards is the record.
 */
function findEndOfCentralDirectory(buffer, archiveLabel) {
  const earliest = Math.max(0, buffer.length - 22 - 0xffff);
  for (let pos = buffer.length - 22; pos >= earliest; pos -= 1) {
    if (buffer.readUInt32LE(pos) === END_OF_CENTRAL_DIRECTORY) return pos;
  }
  throw new Error(`${archiveLabel} is not a zip file: no end-of-central-directory record found.`);
}

/**
 * Reads one member's bytes out of a zip archive already sitting in memory.
 *
 * `buffer` is the whole archive — the same bytes `art-sync.mjs` has already
 * digest-verified against the pin in `art/sources.json`, which is what makes
 * this safe to trust: an archive that hashes right cannot have had its
 * central directory tampered with independently of its data. `archiveLabel`
 * is never parsed, only quoted back in errors, so a cache path or a URL both
 * work.
 */
export function extractZipMember(buffer, memberPath, archiveLabel) {
  const eocd = findEndOfCentralDirectory(buffer, archiveLabel);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocd + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocd + 16);

  if (
    totalEntries === 0xffff ||
    centralDirectorySize === ZIP64_SENTINEL ||
    centralDirectoryOffset === ZIP64_SENTINEL
  ) {
    throw new Error(
      `${archiveLabel} is a zip64 archive, which is not supported. An LPC pack is a few megabytes ` +
        'and a handful of files, well under what forces zip64 — check the download is not truncated ' +
        'or corrupted before assuming this reader needs to grow that support.',
    );
  }

  let pos = centralDirectoryOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== CENTRAL_DIRECTORY_HEADER) {
      throw new Error(`${archiveLabel} has a corrupt central directory: entry ${i} has the wrong signature.`);
    }
    const flags = buffer.readUInt16LE(pos + 8);
    const method = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const uncompressedSize = buffer.readUInt32LE(pos + 24);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    const localHeaderOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.toString('utf8', pos + 46, pos + 46 + nameLength);

    if (name === memberPath) {
      return readMember(buffer, archiveLabel, memberPath, {
        flags,
        method,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });
    }
    pos += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`${archiveLabel} has no member named "${memberPath}".`);
}

/**
 * Turns one central-directory record, once its name has matched, into bytes.
 *
 * Sizes and the compression method are trusted from the *central* directory,
 * not the local header that precedes the data: the central directory is the
 * one index that is always complete, even for an entry a zip writer streamed
 * with a trailing data descriptor and zeroed sizes in its local header. The
 * local header is only consulted for its own name and extra-field lengths, to
 * find where the data actually starts — those can differ in size from the
 * central directory's copy even when both describe the same file.
 */
function readMember(buffer, archiveLabel, memberPath, { flags, method, compressedSize, uncompressedSize, localHeaderOffset }) {
  if (flags & 0x0001) {
    throw new Error(`${archiveLabel}: "${memberPath}" is encrypted, which is not supported.`);
  }
  if (
    compressedSize === ZIP64_SENTINEL ||
    uncompressedSize === ZIP64_SENTINEL ||
    localHeaderOffset === ZIP64_SENTINEL
  ) {
    throw new Error(`${archiveLabel}: "${memberPath}" has a zip64 size or offset, which is not supported.`);
  }

  if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER) {
    throw new Error(`${archiveLabel}: "${memberPath}" has a corrupt local file header.`);
  }
  const nameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

  let data;
  if (method === 0) data = Buffer.from(compressed);
  else if (method === 8) data = zlib.inflateRawSync(compressed);
  else {
    throw new Error(
      `${archiveLabel}: "${memberPath}" uses zip compression method ${method}, which is not supported ` +
        '(only 0 = stored and 8 = deflate are).',
    );
  }

  // Not a crc32 check: the archive's own sha256, already verified by the
  // caller before this module ever sees the bytes, already guarantees the
  // compressed data is exactly what upstream shipped. What this catches
  // instead is a bug in the offsets above — a wrong dataStart would inflate
  // to garbage of some other length far more often than it would inflate
  // to a plausible one.
  if (data.length !== uncompressedSize) {
    throw new Error(
      `${archiveLabel}: "${memberPath}" inflated to ${data.length} bytes, but the central directory ` +
        `says ${uncompressedSize}. Either the archive is corrupt or this reader found the wrong bytes.`,
    );
  }
  return data;
}
