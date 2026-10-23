// A5a re-review (Low): the central directory's local-header offsets and compressed sizes must describe exactly the
// records a streaming reader walks, in order, with no gap or overlap. Otherwise a STORED entry the directory points into
// can hide the real part that Word/Excel read while the streamed decoy (same name, same size) is what the browser imports.
import { deflateSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { pngBytes } from './fixtures.test-helpers';
import { extractArchive } from './zip-core';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (data: Uint8Array): number => {
  let c = 0xffffffff;
  for (const b of data) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

interface Rec {
  name: string;
  /** The bytes as stored in the archive (already deflated when method is 8). */
  data: Uint8Array;
  raw: Uint8Array;
  method: 0 | 8;
  descriptor?: 'sig' | 'nosig';
}
interface Cen {
  name: string;
  method: number;
  flags: number;
  crc: number;
  csize: number;
  usize: number;
  offset: number;
}

const concat = (parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

const stored = (name: string, data: Uint8Array): Rec => ({ name, data, raw: data, method: 0 });
const deflated = (name: string, raw: Uint8Array, descriptor?: Rec['descriptor']): Rec => ({
  name,
  data: deflateSync(raw),
  raw,
  method: 8,
  ...(descriptor === undefined ? {} : { descriptor }),
});

function local(rec: Rec): Uint8Array<ArrayBuffer> {
  const name = strToU8(rec.name);
  const head = new Uint8Array(30);
  const v = new DataView(head.buffer);
  const dd = rec.descriptor !== undefined;
  const crc = crc32(rec.raw);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(4, 20, true);
  v.setUint16(6, dd ? 8 : 0, true);
  v.setUint16(8, rec.method, true);
  if (!dd) {
    v.setUint32(14, crc, true);
    v.setUint32(18, rec.data.length, true);
    v.setUint32(22, rec.raw.length, true);
  }
  v.setUint16(26, name.length, true);
  const parts = [head, name, rec.data];
  if (rec.descriptor !== undefined) {
    const d = new Uint8Array(rec.descriptor === 'sig' ? 16 : 12);
    const dv = new DataView(d.buffer);
    let at = 0;
    if (rec.descriptor === 'sig') {
      dv.setUint32(0, 0x08074b50, true);
      at = 4;
    }
    dv.setUint32(at, crc, true);
    dv.setUint32(at + 4, rec.data.length, true);
    dv.setUint32(at + 8, rec.raw.length, true);
    parts.push(d);
  }
  return concat(parts);
}

/** The directory entry an honest writer would produce for `rec` stored at `offset`. */
const cenOf = (rec: Rec, offset: number): Cen => ({
  name: rec.name,
  method: rec.method,
  flags: rec.descriptor === undefined ? 0 : 8,
  crc: crc32(rec.raw),
  csize: rec.data.length,
  usize: rec.raw.length,
  offset,
});

function directory(entries: Cen[], dirOffset: number): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  let size = 0;
  for (const e of entries) {
    const name = strToU8(e.name);
    const h = new Uint8Array(46);
    const v = new DataView(h.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 20, true);
    v.setUint16(8, e.flags, true);
    v.setUint16(10, e.method, true);
    v.setUint32(16, e.crc, true);
    v.setUint32(20, e.csize, true);
    v.setUint32(24, e.usize, true);
    v.setUint16(28, name.length, true);
    v.setUint32(42, e.offset, true);
    parts.push(h, name);
    size += h.length + name.length;
  }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, dirOffset, true);
  parts.push(end);
  return concat(parts);
}

/** Records laid end to end, with optional junk bytes before record i, and a directory that is honest unless overridden. */
function build(
  recs: Rec[],
  opts: {
    padBefore?: Record<number, number>;
    tailPad?: number;
    cen?: (honest: Cen[]) => Cen[];
  } = {},
): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  const honest: Cen[] = [];
  let at = 0;
  recs.forEach((rec, i) => {
    const pad = opts.padBefore?.[i] ?? 0;
    if (pad > 0) {
      parts.push(new Uint8Array(pad));
      at += pad;
    }
    const bytes = local(rec);
    honest.push(cenOf(rec, at));
    parts.push(bytes);
    at += bytes.length;
  });
  const tail = opts.tailPad ?? 0;
  if (tail > 0) parts.push(new Uint8Array(tail));
  const dirAt = at + tail;
  return concat([...parts, directory(opts.cen ? opts.cen(honest) : honest, dirAt)]);
}

async function outcome(bytes: Uint8Array<ArrayBuffer>, name: string, kind: 'docx' | 'zip') {
  const result = await extractArchive(new File([bytes], name), name, kind);
  return result.type === 'error' ? result.code : `result:${result.type}`;
}

const REAL = strToU8('<w:document>REAL ROWS HERE</w:document>');
const DECOY = strToU8('<w:document>DECOY ROWS HERE</w:document>');
const at = (list: Cen[], i: number): Cen => {
  const entry = list[i];
  if (entry === undefined) throw new Error(`no entry ${i}`);
  return entry;
};

describe('extractArchive: the directory must describe the streamed layout', () => {
  it('rejects a STORED skipped entry that hides the real part the directory points into', async () => {
    expect(REAL).toHaveLength(DECOY.length);
    const carrier = stored('word/other.bin', local(stored('word/document.xml', REAL)));
    const decoy = stored('word/document.xml', DECOY);
    const bytes = build([carrier, decoy], {
      // Office follows the second entry into the carrier's data; the streamed record after the carrier is the decoy.
      cen: (honest) => [
        at(honest, 0),
        cenOf(stored('word/document.xml', REAL), 30 + strToU8(carrier.name).length),
      ],
    });
    expect(await outcome(bytes, 'x.docx', 'docx')).toBe('bad_archive');
  });

  it('rejects a gap between two records', async () => {
    const bytes = build(
      [stored('word/document.xml', REAL), stored('word/styles.xml', strToU8('<s/>'))],
      { padBefore: { 1: 7 } },
    );
    expect(await outcome(bytes, 'x.docx', 'docx')).toBe('bad_archive');
  });

  it('rejects junk between the last record and the directory', async () => {
    const bytes = build([stored('word/document.xml', REAL)], { tailPad: 5 });
    expect(await outcome(bytes, 'x.docx', 'docx')).toBe('bad_archive');
  });

  it('rejects junk before the first record', async () => {
    const bytes = build([stored('word/document.xml', REAL)], { padBefore: { 0: 3 } });
    expect(await outcome(bytes, 'x.docx', 'docx')).toBe('bad_archive');
  });

  it('rejects overlapping records (a compressed size that runs into the next record)', async () => {
    const bytes = build(
      [stored('word/styles.xml', strToU8('<s/>')), stored('word/document.xml', REAL)],
      {
        cen: (honest) => [{ ...at(honest, 0), csize: at(honest, 0).csize + 10 }, at(honest, 1)],
      },
    );
    expect(await outcome(bytes, 'x.docx', 'docx')).toBe('bad_archive');
  });

  it('rejects a directory entry whose local header name differs', async () => {
    const bytes = build([stored('word/document.xml', REAL), stored('word/styles.xml', REAL)], {
      cen: (honest) => [{ ...at(honest, 0), name: 'word/documentXxml' }, at(honest, 1)],
    });
    expect(await outcome(bytes, 'x.docx', 'docx')).toBe('bad_archive');
  });

  it('rejects a directory offset that is not a local header', async () => {
    const bytes = build([stored('word/document.xml', REAL)], {
      cen: (honest) => [{ ...at(honest, 0), offset: 4 }],
    });
    expect(await outcome(bytes, 'x.docx', 'docx')).toBe('bad_archive');
  });

  it('still reads honest archives: stored, deflated, and both kinds of data descriptor', async () => {
    const png = pngBytes(1, 400);
    const docx = build([
      stored('[Content_Types].xml', strToU8('<Types/>')),
      deflated('word/document.xml', REAL, 'sig'),
      deflated('word/styles.xml', strToU8(`<w:styles>${'x'.repeat(200)}</w:styles>`), 'nosig'),
      stored('word/media/a.png', png),
    ]);
    const result = await extractArchive(new File([docx], 'x.docx'), 'x.docx', 'docx');
    expect(result.type).toBe('result');
    if (result.type === 'result') {
      expect(result.xml.map((p) => p.name).sort()).toEqual([
        '[Content_Types].xml',
        'word/document.xml',
        'word/styles.xml',
      ]);
      expect(result.images.map((i) => i.name)).toEqual(['word/media/a.png']);
    }
    const pics = build([
      stored('pics/', new Uint8Array(0)),
      deflated('a.png', png, 'nosig'),
      deflated('pics/b.png', pngBytes(2, 300), 'sig'),
    ]);
    const zipResult = await extractArchive(new File([pics], 'p.zip'), 'p.zip', 'zip');
    expect(zipResult).toMatchObject({ type: 'result' });
    if (zipResult.type === 'result') expect(zipResult.images).toHaveLength(2);
  });
});
