// Fixture builders for the M1 import specs (specs/m1-test-authoring.md §6.9, R2-19, AT-M1-10): a `trace-items-v1.xlsx`
// and an images `.zip`, built at run time from node built-ins only (no dependency). Pure functions: no file, network or
// browser; the specs write the bytes into the test's output dir, never into git. Synthetic data only.
//
// The xlsx has the parts apps/recruiter/src/bank/import/template-files.ts writes for the downloadable template
// (inline-string cells, sheet `Items`, the fifteen headers of apps/recruiter/src/bank/import/template.ts:10-26), so
// the recruiter app's own reader (xlsx.ts) reads it. Every zip entry carries its sizes in the local header (no data
// descriptor), as the app's streaming reader needs, and its CRC-32 from `node:zlib`.
import { createHash } from 'node:crypto';
import { crc32, deflateRawSync, deflateSync, inflateRawSync } from 'node:zlib';

// ---- zip ----------------------------------------------------------------------------------------------------------

export interface ZipEntry {
  /** Forward slashes, no leading slash. */
  name: string;
  data: Uint8Array;
  /** `store` for data that does not compress (images); `deflate` for text. */
  method: 'store' | 'deflate';
}

/** 2026-01-01 00:00:00 in MS-DOS date and time fields: the same bytes every time. */
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;
const UTF8_FLAG = 0x0800;

/** A zip archive (no zip64: under 4 GiB and 65,535 entries, which every fixture here is). */
export const zipOf = (entries: readonly ZipEntry[]): Buffer => {
  if (entries.length > 0xfffe) throw new Error('zip: too many entries');
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
    const body = entry.method === 'deflate' ? deflateRawSync(raw, { level: 6 }) : raw;
    const method = entry.method === 'deflate' ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    name.copy(local, 30);
    locals.push(local, body);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    // extra length, comment length, disk number, internal and external attributes: all zero
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
};

export interface ReadEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  data: Buffer;
}

/**
 * A minimal reader for the archives `zipOf` writes (central directory, store and deflate, CRC-32 checked). It exists so
 * a script can prove a fixture is a well-formed zip before a browser meets it; it is not a general zip reader.
 */
export const readZip = (zip: Uint8Array): ReadEntry[] => {
  const buf = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: no end record');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: ReadEntry[] = [];
  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: bad directory entry');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const skip = buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const localAt = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength);
    if (buf.readUInt32LE(localAt) !== 0x04034b50) throw new Error('zip: bad local header');
    const start = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    const stored = buf.subarray(start, start + compressedSize);
    const data = method === 8 ? inflateRawSync(stored) : Buffer.from(stored);
    if (data.length !== size || crc32(data) !== crc) throw new Error('zip: entry does not check');
    out.push({ name, method, compressedSize, size, data });
    p += 46 + nameLength + skip;
  }
  return out;
};

// ---- xlsx ---------------------------------------------------------------------------------------------------------

/** The fixed header row of trace-items-v1.xlsx (apps/recruiter/src/bank/import/template.ts:10-26). */
export const ITEMS_HEADERS = [
  'format',
  'skill',
  'difficulty',
  'stem',
  'option_a',
  'option_b',
  'option_c',
  'option_d',
  'option_e',
  'option_f',
  'correct',
  'rubric_key',
  'image_file',
  'image_alt',
  'param_spec_json',
] as const;

export interface ItemsRow {
  format: 'mcq' | 'written';
  skill: string;
  /** 0 to 1, two decimals at most. */
  difficulty: number;
  stem: string;
  /** mcq: 2 to 6 option texts, in order a to f. */
  options?: readonly string[];
  /** mcq: the letter of the correct option. */
  correct?: 'a' | 'b' | 'c' | 'd' | 'e' | 'f';
  /** written: the key of an org rubric. */
  rubricKey?: string;
  imageFile?: string;
  imageAlt?: string;
}

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const RELS_CT = 'application/vnd.openxmlformats-package.relationships+xml';

const esc = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** Column letters of a zero-based index (A to Z is all the fifteen columns need; the loop is general). */
const columnLetters = (index: number): string => {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
};

const textCell = (ref: string, value: string): string =>
  `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;

const cellsOf = (rowNo: number, values: Record<(typeof ITEMS_HEADERS)[number], string>): string =>
  ITEMS_HEADERS.flatMap((name, i) => {
    const value = values[name];
    if (value === '') return [];
    const ref = `${columnLetters(i)}${rowNo}`;
    return [
      name === 'difficulty' ? `<c r="${ref}"><v>${esc(value)}</v></c>` : textCell(ref, value),
    ];
  }).join('');

/** The sheet row `rowNo` (2 and up; row 1 is the header) of an item. */
const valuesOf = (row: ItemsRow): Record<(typeof ITEMS_HEADERS)[number], string> => {
  const option = (i: number) => row.options?.[i] ?? '';
  return {
    format: row.format,
    skill: row.skill,
    difficulty: String(row.difficulty),
    stem: row.stem,
    option_a: option(0),
    option_b: option(1),
    option_c: option(2),
    option_d: option(3),
    option_e: option(4),
    option_f: option(5),
    correct: row.correct ?? '',
    rubric_key: row.rubricKey ?? '',
    image_file: row.imageFile ?? '',
    image_alt: row.imageAlt ?? '',
    param_spec_json: '',
  };
};

/** `trace-items-v1.xlsx`: sheet `Items`, the fixed header in row 1, one item per row from row 2. */
export const buildItemsXlsx = (rows: readonly ItemsRow[]): Buffer => {
  if (rows.length === 0 || rows.length > 2000) throw new Error('xlsx: 1 to 2,000 rows');
  const header = ITEMS_HEADERS.map((name, i) => textCell(`${columnLetters(i)}1`, name)).join('');
  const body = rows
    .map((row, i) => `<row r="${i + 2}">${cellsOf(i + 2, valuesOf(row))}</row>`)
    .join('');
  const text = (s: string): Uint8Array => Buffer.from(s, 'utf8');
  return zipOf([
    {
      name: '[Content_Types].xml',
      method: 'deflate',
      data: text(
        `${HEAD}<Types xmlns="${TYPES_NS}"><Default Extension="rels" ContentType="${RELS_CT}"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
      ),
    },
    {
      name: '_rels/.rels',
      method: 'deflate',
      data: text(
        `${HEAD}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/workbook.xml',
      method: 'deflate',
      data: text(
        `${HEAD}<workbook xmlns="${MAIN_NS}" xmlns:r="${OFFICE_REL}"><sheets><sheet name="Items" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      method: 'deflate',
      data: text(
        `${HEAD}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      method: 'deflate',
      data: text(
        `${HEAD}<worksheet xmlns="${MAIN_NS}"><sheetData><row r="1">${header}</row>${body}</sheetData></worksheet>`,
      ),
    },
  ]);
};

// ---- images -------------------------------------------------------------------------------------------------------

/** A seeded 32-bit stream (xorshift32): the same seed gives the same bytes, a different seed different bytes. */
const streamOf = (seed: number): (() => number) => {
  let x = seed >>> 0 || 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x;
  };
};

/** A 32-bit seed from text (the first four bytes of its SHA-256), so `${runTag}:${index}` seeds one image. */
export const seedOf = (text: string): number =>
  createHash('sha256').update(text).digest().readUInt32LE(0);

const pngChunk = (type: string, data: Uint8Array): Buffer => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
};

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** The side of the square RGB PNG whose file is about `targetBytes` long: noise does not compress, so the size follows. */
export const pngSideFor = (targetBytes: number): number =>
  Math.max(8, Math.min(4096, Math.round((-1 + Math.sqrt(1 + 12 * targetBytes)) / 6)));

/**
 * A valid square RGB PNG of noise from `seed` (a real zlib stream and chunk CRCs, so a decoder opens it). The noise does
 * not compress, so the file is about `targetBytes` long (141 x 141 pixels is about 60 KB). Two seeds give two
 * different files, hence two different SHA-256 values.
 */
export const syntheticPng = (seed: number, targetBytes = 60_000): Buffer => {
  const side = pngSideFor(targetBytes);
  const next = streamOf(seed);
  const stride = side * 3 + 1;
  const raw = Buffer.alloc(stride * side);
  for (let y = 0; y < side; y += 1) {
    const rowStart = y * stride; // the filter byte stays 0 (none)
    for (let x = 1; x < stride; x += 4) {
      const word = next();
      for (let k = 0; k < 4 && x + k < stride; k += 1) {
        raw[rowStart + x + k] = (word >>> (8 * k)) & 0xff;
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 1 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};

/** Width and height from a PNG header (what the api reads, services/api/src/modules/imports/media.ts). */
export const pngSize = (png: Uint8Array): { width: number; height: number } => {
  const buf = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE) || buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('png: not a PNG');
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
};

// ---- the 500-item import fixture (AT-M1-10) -------------------------------------------------------------------------

export interface ImportFixture {
  xlsx: Buffer;
  imagesZip: Buffer;
  rows: number;
  images: number;
  /** SHA-256 of every image, in row order. */
  imageSha256: string[];
  /** The smallest and the largest image, in bytes. */
  imageBytes: { min: number; max: number };
  /** The longest side of any image, in pixels (read back from the PNG headers). */
  imageMaxSide: number;
}

/** The skills of the wedge taxonomy (supabase/migrations/20261023010000_m1_bank.sql:207-221) the rows rotate through. */
const SKILLS = ['quant', 'logical', 'verbal', 'reading', 'computer_basics'] as const;

export interface ImportFixtureOptions {
  /** Makes the stems and the image bytes unique to one run (lower-case letters and digits). */
  runTag: string;
  rows?: number;
  imageTargetBytes?: number;
}

/**
 * `rows` multiple-choice items (default 500), each with its own image: an xlsx whose `image_file` names `img-NNNN.png`
 * and an images zip holding those files. Every image differs from every other, each is about `imageTargetBytes`
 * (default 60,000) and far under the 1 MiB and 4096 px caps (R2-19).
 */
export const buildImportFixture = (options: ImportFixtureOptions): ImportFixture => {
  const rows = options.rows ?? 500;
  const target = options.imageTargetBytes ?? 60_000;
  const items: ItemsRow[] = [];
  const entries: ZipEntry[] = [];
  const hashes: string[] = [];
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  let maxSide = 0;
  for (let i = 0; i < rows; i += 1) {
    const no = String(i + 1).padStart(4, '0');
    const file = `img-${no}.png`;
    const png = syntheticPng(seedOf(`${options.runTag}:${no}`), target);
    hashes.push(createHash('sha256').update(png).digest('hex'));
    min = Math.min(min, png.length);
    max = Math.max(max, png.length);
    const size = pngSize(png);
    maxSide = Math.max(maxSide, size.width, size.height);
    entries.push({ name: file, data: png, method: 'store' });
    items.push({
      format: 'mcq',
      skill: SKILLS[i % SKILLS.length] ?? 'quant',
      difficulty: Math.round(((i % 9) + 1) * 10) / 100,
      stem: `[synthetic] ${options.runTag} import item ${no}: which option is marked correct?`,
      options: ['The marked option', 'A different option', 'Another different option'],
      correct: 'a',
      imageFile: file,
      imageAlt: `[synthetic] picture ${no}`,
    });
  }
  return {
    xlsx: buildItemsXlsx(items),
    imagesZip: zipOf(entries),
    rows,
    images: rows,
    imageSha256: hashes,
    imageBytes: { min, max },
    imageMaxSide: maxSide,
  };
};
