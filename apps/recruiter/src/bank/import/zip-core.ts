// The extraction core of the import worker (R5-48, ADR-033, spec §6.9, E9, E11). The ONLY file that imports fflate, and
// it uses only the streaming `Unzip` with `UnzipInflate`: no whole-buffer inflate, no callback-style async helper
// (source-guards.test.ts pins both). Order of work:
//   1. extension, then the picked file's size, before any byte is read;
//   2. the zip directory (read from the end of the file): entry count, every declared size, macro parts;
//   3. a streaming pass that inflates only the parts we want, in 16 KiB feeds, with a running inflated-byte counter
//      per entry and for the whole file that aborts at the cap. A header that lies stops at the counter.
// It decodes XML parts as UTF-8 text and returns them (and images up to the per-image cap); it never parses XML.
import { Unzip, UnzipInflate } from 'fflate';
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
}

const fail = (code: ExtractErrorCode): ExtractFailure => ({ type: 'error', code });

/**
 * True when a record signature fflate's `Unzip` acts on (local header, data descriptor, central header) starts at any
 * byte offset in [from, to). It never aligns, so neither can we. Reads in bounded blocks that overlap by three bytes, so
 * memory stays flat and a signature straddling a block or the end of the range is still seen.
 */
async function hasRecordSignature(blob: Blob, from: number, to: number): Promise<boolean> {
  for (let at = from; at < to; at += READ_BLOCK_BYTES) {
    const stop = Math.min(at + READ_BLOCK_BYTES, to);
    const bytes = new Uint8Array(await blob.slice(at, stop + 3).arrayBuffer());
    for (let i = 0; i < stop - at && i + 3 < bytes.length; i++) {
      if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b) continue;
      const a = bytes[i + 2];
      const b = bytes[i + 3];
      if ((a === 3 && b === 4) || (a === 7 && b === 8) || (a === 1 && b === 2)) return true;
    }
  }
  return false;
}

/**
 * The directory must describe exactly the records the streaming pass walks: contiguous from offset 0 in directory order,
 * each starting with a local header of the same name and method, the last one ending where the directory starts.
 * Otherwise a stored entry could carry the part Office reads while a decoy of the same name and size is the one streamed
 * (re-review). An entry with a data descriptor (flag bit 3) is delimited by fflate scanning its data for record
 * signatures, not by the sizes, so its data must hold none and its descriptor must repeat the directory's crc and sizes.
 */
async function layoutMatches(
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
    const descriptor = (entry.flags & 8) !== 0;
    if (descriptor !== ((hv.getUint16(6, true) & 8) !== 0)) return false;
    if (hv.getUint16(8, true) !== entry.method) return false;
    if (!descriptor && hv.getUint32(18, true) !== entry.compressed) return false;
    const nameLength = hv.getUint16(26, true);
    if (nameLength !== entry.nameBytes.length) return false;
    for (let i = 0; i < nameLength; i++) {
      if (head[30 + i] !== entry.nameBytes[i]) return false;
    }
    const dataStart = entry.offset + 30 + nameLength + hv.getUint16(28, true);
    const dataEnd = dataStart + entry.compressed;
    expected = dataEnd;
    if (descriptor) {
      if (dataEnd + 12 > dirOffset) return false;
      const tail = new Uint8Array(await blob.slice(dataEnd, dataEnd + 16).arrayBuffer());
      const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
      const repeats = (at: number): boolean =>
        tv.getUint32(at, true) === entry.crc &&
        tv.getUint32(at + 4, true) === entry.compressed &&
        tv.getUint32(at + 8, true) === entry.size;
      let scanEnd = dataEnd;
      if (tail.length >= 16 && tv.getUint32(0, true) === 0x08074b50 && repeats(4)) {
        expected += 16;
      } else if (repeats(0)) {
        expected += 12;
        scanEnd += 12; // an unsigned descriptor's own bytes are scanned as data too
      } else {
        return false;
      }
      if (expected > dirOffset) return false;
      if (await hasRecordSignature(blob, dataStart, scanEnd)) return false;
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
    });
    p = next;
  }
  if (!(await layoutMatches(blob, entries, dirOffset))) return fail('bad_archive');
  return entries;
}

/** The decoded text of an XML part, or null when it is not valid UTF-8. */
function decodeXml(chunks: Uint8Array[], length: number): string | null {
  const joined = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.length;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(joined);
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

  // Declared sizes are a pre-check only; the streaming pass below does not trust them.
  const declared = new Map<string, DirectoryEntry>();
  let declaredTotal = 0;
  let declaredXml = 0;
  let imageCount = 0;
  const skipped: SkippedImage[] = [];
  /** The entries the streaming pass must inflate, each exactly once (see the end of the pass). */
  const expected: string[] = [];
  for (const entry of directory) {
    if (/(?:^|\/)vbaProject\.bin$/i.test(entry.name)) return fail('macro_file');
    declared.set(entry.name, entry);
    declaredTotal += entry.size;
    if (declaredTotal > limits.uncompressedBytes) return fail('archive_too_large');
    const role = classifyEntry(kind, entry.name);
    if (role === 'xml') {
      declaredXml += entry.size;
      if (entry.size > limits.xmlPartBytes || declaredXml > limits.xmlTotalBytes) {
        return fail('archive_too_large');
      }
      expected.push(entry.name);
    } else if (role === 'image') {
      imageCount += 1;
      if (imageCount > limits.images) return fail('too_many_images');
      if (entry.size > limits.imageBytes) skipped.push({ name: entry.name, reason: 'too_large' });
      else expected.push(entry.name);
    }
  }

  const xml: XmlPart[] = [];
  const images: ImagePart[] = [];
  const state: { failure: ExtractErrorCode | null } = { failure: null };
  let total = 0;
  let xmlTotal = 0;
  let open = 0;
  // Office reads the central directory; this pass reads the local records. They must be one list: a name streamed twice
  // (another record could replace the part the directory names, or slip past the image count above) is refused (X1).
  const seenLocal = new Set<string>();
  let startedImages = 0;
  const stop = (code: ExtractErrorCode): void => {
    state.failure ??= code;
  };

  const unzip = new Unzip((file) => {
    if (state.failure !== null) return;
    if (seenLocal.has(file.name)) return stop('bad_archive');
    seenLocal.add(file.name);
    const entry = declared.get(file.name);
    if (entry === undefined) return stop('bad_archive');
    const role = classifyEntry(kind, file.name);
    if (role === 'skip') return;
    if (role === 'image' && entry.size > limits.imageBytes) return;
    if (file.compression !== 0 && file.compression !== 8) return stop('bad_archive');
    if (role === 'image') {
      startedImages += 1;
      if (startedImages > limits.images) return stop('too_many_images');
    }
    const chunks: Uint8Array[] = [];
    let entryBytes = 0;
    const entryCap = role === 'xml' ? limits.xmlPartBytes : limits.imageBytes;
    open += 1;
    file.ondata = (err, chunk, final) => {
      if (state.failure !== null) return;
      if (err !== null) return stop('bad_archive');
      entryBytes += chunk.length;
      total += chunk.length;
      if (role === 'xml') xmlTotal += chunk.length;
      if (
        total > limits.uncompressedBytes ||
        xmlTotal > limits.xmlTotalBytes ||
        entryBytes > entryCap ||
        entryBytes > entry.size
      ) {
        file.terminate();
        return stop('archive_too_large');
      }
      chunks.push(chunk);
      if (!final) return;
      open -= 1;
      if (entryBytes !== entry.size) return stop('bad_archive');
      if (role === 'image') {
        images.push({ name: file.name, bytes: joinBytes(chunks, entryBytes) });
        return;
      }
      const text = decodeXml(chunks, entryBytes);
      if (text === null) return stop('bad_archive');
      xml.push({ name: file.name, text });
    };
    try {
      file.start();
    } catch {
      stop('bad_archive');
    }
  });
  unzip.register(UnzipInflate);

  try {
    for (let at = 0; at < blob.size && state.failure === null; at += READ_BLOCK_BYTES) {
      const block = new Uint8Array(await blob.slice(at, at + READ_BLOCK_BYTES).arrayBuffer());
      for (let i = 0; i < block.length && state.failure === null; i += FEED_CHUNK_BYTES) {
        unzip.push(block.subarray(i, i + FEED_CHUNK_BYTES), false);
      }
    }
    if (state.failure === null) unzip.push(new Uint8Array(0), true);
  } catch {
    stop('bad_archive');
  }
  if (state.failure === null && open !== 0) stop('bad_archive');
  if (state.failure === null && expected.some((name) => !seenLocal.has(name))) stop('bad_archive');
  if (state.failure !== null) return fail(state.failure);

  const contentTypes = xml.find((part) => part.name === '[Content_Types].xml');
  if (contentTypes !== undefined && /macroEnabled/i.test(contentTypes.text)) {
    return fail('macro_file');
  }
  return { type: 'result', kind, xml, images, skippedImages: skipped };
}
