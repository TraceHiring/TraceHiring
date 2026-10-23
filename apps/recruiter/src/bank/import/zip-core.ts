// The extraction core of the import worker (R5-48, ADR-033, spec §6.9, E9, E11). The ONLY file that imports fflate, and
// it uses only `UnzipInflate`, fflate's non-scanning streaming inflate: no whole-buffer inflate, no callback-style async
// helper, and no `Unzip` (source-guards.test.ts pins all three). Order of work:
//   1. extension, then the picked file's size, before any byte is read;
//   2. the zip directory (read from the end of the file): entry count, every declared size, macro parts;
//   3. the records, located from the directory and nothing else: every central entry's local header is read at the
//      central offset and must agree with it, and the records must tile the file from offset 0 to the directory;
//   4. for each wanted entry, exactly `central csize` bytes after its local header are inflated (or taken as stored)
//      in 16 KiB feeds with running inflated-byte counters per entry and for the whole file that abort at the cap, and
//      the output must match the directory's size and crc32.
// Nothing here scans for record signatures. Office reads the central directory, so this reads the central directory:
// a decoy record hidden in an entry's data is bytes of that entry and nothing more. (Three rounds of patching a
// signature-scanning reader each found a new way to make it disagree with Office; AUTOPILOT §3.5.)
// It decodes XML parts as UTF-8 text and returns them (and images up to the per-image cap); it never parses XML.
import { UnzipInflate } from 'fflate';
import { FEED_CHUNK_BYTES, IMPORT_LIMITS, type ImportLimits } from './limits';
import type {
  ExtractErrorCode,
  ExtractFailure,
  ExtractKind,
  ExtractResult,
  ImagePart,
  SkippedImage,
  XmlPart,
} from './protocol';

const READ_BLOCK_BYTES = 1_048_576;
const EOCD_MAX = 22 + 0xffff;
const DIRECTORY_MAX_BYTES = 8 * 1_048_576;
const MACRO_EXTENSIONS = ['.xlsm', '.xltm', '.xlsb', '.docm', '.dotm'];
const KIND_EXTENSION: Record<ExtractKind, string> = { xlsx: '.xlsx', docx: '.docx', zip: '.zip' };
const IMAGE_LIKE = /\.(?:png|jpe?g|webp|gif|bmp|svg|tiff?)$/i;

const XLSX_XML = new Set([
  '[Content_Types].xml',
  'xl/workbook.xml',
  'xl/_rels/workbook.xml.rels',
  'xl/sharedStrings.xml',
]);
const DOCX_XML = new Set([
  '[Content_Types].xml',
  'word/document.xml',
  'word/styles.xml',
  'word/_rels/document.xml.rels',
]);

type Role = 'xml' | 'image' | 'skip';

/** What the importer wants from an entry of this kind of file; everything else is never inflated. */
export function classifyEntry(kind: ExtractKind, name: string): Role {
  if (name.endsWith('/')) return 'skip';
  if (kind === 'xlsx') {
    if (XLSX_XML.has(name) || /^xl\/worksheets\/[^/]+\.xml$/.test(name)) return 'xml';
    return 'skip';
  }
  if (kind === 'docx') {
    if (DOCX_XML.has(name)) return 'xml';
    if (/^word\/media\/[^/]+$/.test(name) && IMAGE_LIKE.test(name)) return 'image';
    return 'skip';
  }
  const base = name.slice(name.lastIndexOf('/') + 1);
  if (name.startsWith('__MACOSX/') || base.startsWith('.')) return 'skip';
  return IMAGE_LIKE.test(base) ? 'image' : 'skip';
}

interface DirectoryEntry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  size: number;
  /** Where the directory says this entry's local record starts, how long its data is, and its raw name bytes. */
  offset: number;
  compressed: number;
  nameBytes: Uint8Array;
  /** Where its data starts: set by `locateRecords` once the local header has been checked against the directory. */
  dataStart: number;
}

const fail = (code: ExtractErrorCode): ExtractFailure => ({ type: 'error', code });

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** Running CRC-32 (the zip one): feed the running value (start 0) and each chunk in turn. */
function crc32Update(crc: number, chunk: Uint8Array): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < chunk.length; i++) {
    c = (CRC_TABLE[(c ^ (chunk[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return ~c >>> 0;
}

/** The local header's extra block must parse to its end, with no field running past it and no zip64 field (id 1). */
function extraIsPlain(extra: Uint8Array): boolean {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let at = 0;
  while (at < extra.length) {
    if (at + 4 > extra.length) return false;
    const id = view.getUint16(at, true);
    const size = view.getUint16(at + 2, true);
    if (id === 1 || at + 4 + size > extra.length) return false;
    at += 4 + size;
  }
  return true;
}

/**
 * The records are the ones the directory names: contiguous from offset 0 in directory order, each starting with a local
 * header that agrees with its directory entry (name, method, and without a descriptor the crc and both sizes), carrying
 * no zip64 marker and no malformed extra field, followed by exactly the directory's compressed size of data, then (flag
 * bit 3) a descriptor repeating the directory's crc and sizes; the last record ends where the directory starts. So the
 * archive Office reads through the directory is exactly the one imported, with no gap or overlap to hide a part in.
 * Sets `dataStart` on every entry. Nothing is scanned: a signature inside an entry's data is just data.
 */
async function locateRecords(
  blob: Blob,
  entries: DirectoryEntry[],
  dirOffset: number,
): Promise<boolean> {
  let expected = 0;
  for (const entry of entries) {
    if (entry.offset !== expected || entry.offset + 30 + entry.nameBytes.length > dirOffset) {
      return false;
    }
    const head = new Uint8Array(
      await blob.slice(entry.offset, entry.offset + 30 + entry.nameBytes.length).arrayBuffer(),
    );
    if (head.length < 30 + entry.nameBytes.length) return false;
    const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    if (hv.getUint32(0, true) !== 0x04034b50) return false;
    const localFlags = hv.getUint16(6, true);
    if ((localFlags & 0x41) !== 0) return false; // encrypted
    const descriptor = (entry.flags & 8) !== 0;
    if (descriptor !== ((localFlags & 8) !== 0)) return false;
    if (hv.getUint16(8, true) !== entry.method) return false;
    const localCrc = hv.getUint32(14, true);
    const localCompressed = hv.getUint32(18, true);
    const localSize = hv.getUint32(22, true);
    if (localCompressed === 0xffffffff || localSize === 0xffffffff) return false; // a zip64 marker
    if (
      !descriptor &&
      (localCrc !== entry.crc || localCompressed !== entry.compressed || localSize !== entry.size)
    ) {
      return false;
    }
    const nameLength = hv.getUint16(26, true);
    if (nameLength !== entry.nameBytes.length) return false;
    for (let i = 0; i < nameLength; i++) {
      if (head[30 + i] !== entry.nameBytes[i]) return false;
    }
    const extraLength = hv.getUint16(28, true);
    const extraStart = entry.offset + 30 + nameLength;
    if (extraStart + extraLength > dirOffset) return false;
    if (extraLength > 0) {
      const extra = new Uint8Array(
        await blob.slice(extraStart, extraStart + extraLength).arrayBuffer(),
      );
      if (extra.length !== extraLength || !extraIsPlain(extra)) return false;
    }
    entry.dataStart = extraStart + extraLength;
    const dataEnd = entry.dataStart + entry.compressed;
    if (dataEnd > dirOffset) return false;
    expected = dataEnd;
    if (descriptor) {
      if (dataEnd + 12 > dirOffset) return false;
      const tail = new Uint8Array(await blob.slice(dataEnd, dataEnd + 16).arrayBuffer());
      const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
      const repeats = (at: number): boolean =>
        tv.getUint32(at, true) === entry.crc &&
        tv.getUint32(at + 4, true) === entry.compressed &&
        tv.getUint32(at + 8, true) === entry.size;
      if (tail.length >= 16 && tv.getUint32(0, true) === 0x08074b50 && repeats(4)) {
        expected += 16;
      } else if (repeats(0)) {
        expected += 12;
      } else {
        return false;
      }
      if (expected > dirOffset) return false;
    }
  }
  return expected === dirOffset;
}

/** Latin-1 or UTF-8 exactly as fflate decodes the local header name (flag bit 11), so the two always agree. */
function entryName(bytes: Uint8Array, flags: number): string {
  if ((flags & 0x800) !== 0) return new TextDecoder('utf-8').decode(bytes);
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

async function readDirectory(
  blob: Blob,
  limits: ImportLimits,
): Promise<DirectoryEntry[] | ExtractFailure> {
  const tailLength = Math.min(blob.size, EOCD_MAX);
  if (tailLength < 22) return fail('bad_archive');
  const tail = new Uint8Array(await blob.slice(blob.size - tailLength).arrayBuffer());
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (
      tv.getUint32(i, true) === 0x06054b50 &&
      i + 22 + tv.getUint16(i + 20, true) <= tail.length
    ) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return fail('bad_archive');
  const count = tv.getUint16(eocd + 10, true);
  const dirSize = tv.getUint32(eocd + 12, true);
  const dirOffset = tv.getUint32(eocd + 16, true);
  if (tv.getUint16(eocd + 4, true) !== 0 || tv.getUint16(eocd + 6, true) !== 0) {
    return fail('bad_archive'); // a multi-part archive
  }
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) {
    return fail(count > limits.entries ? 'too_many_entries' : 'archive_too_large');
  }
  if (count > limits.entries) return fail('too_many_entries');
  if (dirSize > DIRECTORY_MAX_BYTES || dirOffset + dirSize > blob.size) return fail('bad_archive');
  const dir = new Uint8Array(await blob.slice(dirOffset, dirOffset + dirSize).arrayBuffer());
  const dv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const entries: DirectoryEntry[] = [];
  const seen = new Set<string>();
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > dir.length || dv.getUint32(p, true) !== 0x02014b50) return fail('bad_archive');
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const compressed = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLength = dv.getUint16(p + 28, true);
    const next = p + 46 + nameLength + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    if (next > dir.length) return fail('bad_archive');
    const name = entryName(dir.subarray(p + 46, p + 46 + nameLength), flags);
    if ((flags & 1) !== 0 || name.includes('\u0000') || seen.has(name)) return fail('bad_archive');
    if (compressed === 0xffffffff || size === 0xffffffff) {
      return fail('archive_too_large'); // zip64 sizes: 4 GiB or more
    }
    seen.add(name);
    const nameBytes = dir.subarray(p + 46, p + 46 + nameLength);
    entries.push({
      name,
      flags,
      method,
      crc,
      size,
      offset: dv.getUint32(p + 42, true),
      compressed,
      nameBytes,
      dataStart: 0,
    });
    p = next;
  }
  if (!(await locateRecords(blob, entries, dirOffset))) return fail('bad_archive');
  return entries;
}

/** The decoded text of an XML part, or null when it is not valid UTF-8. */
function decodeXml(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function joinBytes(chunks: Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * The bytes of one wanted entry, or the code of the cap it crossed. The data is exactly `compressed` bytes after the
 * checked local header: taken as is when stored, otherwise inflated in 16 KiB feeds with the running counters checked
 * after every feed. The output must be exactly the directory's size and crc32. A bad stream throws or fails the checks.
 */
async function readEntry(
  blob: Blob,
  entry: DirectoryEntry,
  entryCap: number,
  isXml: boolean,
  limits: ImportLimits,
  counters: { total: number; xmlTotal: number },
): Promise<Uint8Array | ExtractErrorCode> {
  const end = entry.dataStart + entry.compressed;
  /** Counts `length` more inflated bytes (`entryTotal` so far in this entry, including them) against every cap. */
  const account = (length: number, entryTotal: number): ExtractErrorCode | null => {
    counters.total += length;
    if (isXml) counters.xmlTotal += length;
    return counters.total > limits.uncompressedBytes ||
      counters.xmlTotal > limits.xmlTotalBytes ||
      entryTotal > entryCap
      ? 'archive_too_large'
      : null;
  };
  if (entry.method === 0) {
    if (entry.compressed !== entry.size) return 'bad_archive';
    const over = account(entry.size, entry.size);
    if (over !== null) return over;
    const stored = new Uint8Array(await blob.slice(entry.dataStart, end).arrayBuffer());
    if (stored.length !== entry.size || crc32Update(0, stored) !== entry.crc) return 'bad_archive';
    return stored;
  }
  if (entry.compressed === 0) return 'bad_archive';
  const chunks: Uint8Array[] = [];
  let entryBytes = 0;
  let crc = 0;
  const state: { failure: ExtractErrorCode | null } = { failure: null };
  const inflate = new UnzipInflate();
  inflate.ondata = (err, chunk) => {
    if (state.failure !== null) return;
    if (err !== null) {
      state.failure = 'bad_archive';
      return;
    }
    entryBytes += chunk.length;
    const over = account(chunk.length, entryBytes);
    if (over !== null || entryBytes > entry.size) {
      state.failure = over ?? 'archive_too_large';
      return;
    }
    crc = crc32Update(crc, chunk);
    chunks.push(chunk);
  };
  // Feeding stops at the first failure or once the output is as long as the directory says: bytes after that point are
  // never handed to the inflater, so trailing junk after the deflate stream is neither parsed nor buffered.
  const feeding = (): boolean => state.failure === null && entryBytes < entry.size;
  for (let at = entry.dataStart; at < end && feeding(); at += READ_BLOCK_BYTES) {
    const stop = Math.min(at + READ_BLOCK_BYTES, end);
    const block = new Uint8Array(await blob.slice(at, stop).arrayBuffer());
    if (block.length !== stop - at) return 'bad_archive';
    for (let i = 0; i < block.length && feeding(); i += FEED_CHUNK_BYTES) {
      const last = stop === end && i + FEED_CHUNK_BYTES >= block.length;
      inflate.push(block.subarray(i, i + FEED_CHUNK_BYTES), last);
    }
  }
  if (state.failure !== null) return state.failure;
  if (entryBytes !== entry.size || crc !== entry.crc) return 'bad_archive';
  return joinBytes(chunks, entryBytes);
}

/**
 * Extracts the parts the importer needs from the picked file, or says in one code why it stopped. `name` is the
 * picked file's name; `blob` is read in blocks (never whole) and only after the size check.
 */
export async function extractArchive(
  blob: Blob,
  name: string,
  kind: ExtractKind,
  limits: ImportLimits = IMPORT_LIMITS,
): Promise<ExtractResult | ExtractFailure> {
  const lower = name.toLowerCase();
  if (MACRO_EXTENSIONS.some((ext) => lower.endsWith(ext))) return fail('macro_file');
  if (!lower.endsWith(KIND_EXTENSION[kind])) return fail('bad_extension');
  const cap = kind === 'xlsx' ? limits.sheetFileBytes : limits.archiveFileBytes;
  if (blob.size > cap) return fail('file_too_large');

  let directory: DirectoryEntry[] | ExtractFailure;
  try {
    directory = await readDirectory(blob, limits);
  } catch {
    return fail('bad_archive');
  }
  if (!Array.isArray(directory)) return directory;

  // Declared sizes are a pre-check only; the inflate below counts the bytes it really produces.
  let declaredTotal = 0;
  let declaredXml = 0;
  let imageCount = 0;
  const skipped: SkippedImage[] = [];
  for (const entry of directory) {
    if (/(?:^|\/)vbaProject\.bin$/i.test(entry.name)) return fail('macro_file');
    declaredTotal += entry.size;
    if (declaredTotal > limits.uncompressedBytes) return fail('archive_too_large');
    const role = classifyEntry(kind, entry.name);
    if (role === 'xml') {
      declaredXml += entry.size;
      if (entry.size > limits.xmlPartBytes || declaredXml > limits.xmlTotalBytes) {
        return fail('archive_too_large');
      }
    } else if (role === 'image') {
      imageCount += 1;
      if (imageCount > limits.images) return fail('too_many_images');
      if (entry.size > limits.imageBytes) skipped.push({ name: entry.name, reason: 'too_large' });
    }
  }

  const xml: XmlPart[] = [];
  const images: ImagePart[] = [];
  const counters = { total: 0, xmlTotal: 0 };
  for (const entry of directory) {
    const role = classifyEntry(kind, entry.name);
    if (role === 'skip') continue;
    if (role === 'image' && entry.size > limits.imageBytes) continue;
    if (entry.method !== 0 && entry.method !== 8) return fail('bad_archive');
    const entryCap = role === 'xml' ? limits.xmlPartBytes : limits.imageBytes;
    let bytes: Uint8Array | ExtractErrorCode;
    try {
      bytes = await readEntry(blob, entry, entryCap, role === 'xml', limits, counters);
    } catch {
      return fail('bad_archive');
    }
    if (typeof bytes === 'string') return fail(bytes);
    if (role === 'image') {
      images.push({ name: entry.name, bytes });
      continue;
    }
    const text = decodeXml(bytes);
    if (text === null) return fail('bad_archive');
    xml.push({ name: entry.name, text });
  }

  const contentTypes = xml.find((part) => part.name === '[Content_Types].xml');
  if (contentTypes !== undefined && /macroEnabled/i.test(contentTypes.text)) {
    return fail('macro_file');
  }
  return { type: 'result', kind, xml, images, skippedImages: skipped };
}
