// A5a fix 4: the reader follows the central directory (what Word and Excel read) and never scans for record signatures.
// Each archive here is hand-built so a local header can lie in ways fflate's writer never does: a zip64 marker or an
// id-1 extra field in a local header, a crc that disagrees with the data, a descriptor field that spells a signature.
import { deflateSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
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
const concat = (parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

interface Local {
  name: string;
  flags?: number;
  method: 0 | 8;
  /** What the local header declares (defaults: the honest values, or zero when flag 8 is set). */
  crc?: number;
  csize?: number;
  usize?: number;
  extra?: Uint8Array;
  data: Uint8Array;
  /** Appended after the data. */
  descriptor?: Uint8Array;
}
interface Cen {
  name: string;
  flags: number;
  method: number;
  crc: number;
  csize: number;
  usize: number;
  offset: number;
}

function local(rec: Local): Uint8Array<ArrayBuffer> {
  const name = strToU8(rec.name);
  const extra = rec.extra ?? new Uint8Array(0);
  const head = new Uint8Array(30);
  const v = new DataView(head.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(4, 20, true);
  v.setUint16(6, rec.flags ?? 0, true);
  v.setUint16(8, rec.method, true);
  v.setUint32(14, rec.crc ?? 0, true);
  v.setUint32(18, rec.csize ?? 0, true);
  v.setUint32(22, rec.usize ?? 0, true);
  v.setUint16(26, name.length, true);
  v.setUint16(28, extra.length, true);
  return concat([head, name, extra, rec.data, rec.descriptor ?? new Uint8Array(0)]);
}

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

/** The archive: the records end to end, then a directory made from `cen` (given each record's offset). */
function archive(records: Local[], cen: (offsets: number[]) => Cen[]): Uint8Array<ArrayBuffer> {
  const blocks = records.map(local);
  const offsets: number[] = [];
  let at = 0;
  for (const block of blocks) {
    offsets.push(at);
    at += block.length;
  }
  return concat([...blocks, directory(cen(offsets), at)]);
}

const descriptor = (crc: number, csize: number, usize: number, signed = true): Uint8Array => {
  const d = new Uint8Array(signed ? 16 : 12);
  const v = new DataView(d.buffer);
  let at = 0;
  if (signed) {
    v.setUint32(0, 0x08074b50, true);
    at = 4;
  }
  v.setUint32(at, crc, true);
  v.setUint32(at + 4, csize, true);
  v.setUint32(at + 8, usize, true);
  return d;
};
const u32 = (n: number): Uint8Array => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};
/** One extra-field record: id, declared length, then `body` (which may be shorter than declared). */
const extraField = (id: number, declared: number, body: Uint8Array): Uint8Array => {
  const h = new Uint8Array(4);
  const v = new DataView(h.buffer);
  v.setUint16(0, id, true);
  v.setUint16(2, declared, true);
  return concat([h, body]);
};

const REAL = strToU8('<w:document>GENUINE ROWS HERE</w:document>');
const DECOY = strToU8('<w:document>DECOYED ROWS HERE</w:document>');
const DOC = 'word/document.xml';

async function run(bytes: Uint8Array<ArrayBuffer>) {
  return extractArchive(new File([bytes], 'x.docx'), 'x.docx', 'docx');
}
async function outcome(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const result = await run(bytes);
  return result.type === 'error' ? result.code : `result:${result.type}`;
}
const storedDoc = (data: Uint8Array, over: Partial<Local> = {}): Local => ({
  name: DOC,
  method: 0,
  crc: crc32(data),
  csize: data.length,
  usize: data.length,
  data,
  ...over,
});
const cenOfLocal = (rec: Local, offset: number, raw: Uint8Array): Cen => ({
  name: rec.name,
  flags: rec.flags ?? 0,
  method: rec.method,
  crc: crc32(raw),
  csize: rec.data.length,
  usize: raw.length,
  offset,
});

describe('extractArchive: entries come from the central directory, never from a signature scan', () => {
  it('rejects a local zip64 marker that would make a scanner skip the next record (decoy document)', async () => {
    expect(REAL).toHaveLength(DECOY.length);
    const abcd = strToU8('abcd');
    // A: flag 8, local sizes 0xFFFFFFFF and an id-1 extra (puts a scanner in zip64 mode: it resumes 8 bytes late).
    const a: Local = {
      name: 'word/a.bin',
      flags: 8,
      method: 0,
      csize: 0xffffffff,
      usize: 0xffffffff,
      extra: extraField(1, 8, concat([u32(abcd.length), u32(0)])),
      data: abcd,
      descriptor: descriptor(crc32(abcd), abcd.length, abcd.length),
    };
    // R1: the real deflate stream, then a whole stored local record for the same name holding the decoy.
    const realDeflate = deflateSync(REAL);
    const decoyRecord = local(storedDoc(DECOY));
    const r1: Local = {
      name: DOC,
      method: 8,
      crc: crc32(REAL),
      csize: realDeflate.length + decoyRecord.length,
      usize: REAL.length,
      data: concat([realDeflate, decoyRecord]),
    };
    const bytes = archive([a, r1], (at) => [
      {
        name: a.name,
        flags: 8,
        method: 0,
        crc: crc32(abcd),
        csize: abcd.length,
        usize: abcd.length,
        offset: at[0] ?? 0,
      },
      {
        name: DOC,
        flags: 0,
        method: 8,
        crc: crc32(REAL),
        csize: realDeflate.length + decoyRecord.length,
        usize: REAL.length,
        offset: at[1] ?? 0,
      },
    ]);
    const result = await run(bytes);
    if (result.type === 'result') {
      // Whatever else happens, the decoy must never be the text that is read.
      expect(result.xml.map((p) => p.text).join('')).not.toContain('DECOYED');
    }
    expect(result).toMatchObject({ type: 'error', code: 'bad_archive' });
  });

  it('rejects an id-1 (zip64) extra field in the local header of an entry without a descriptor', async () => {
    const rec = storedDoc(REAL, { extra: extraField(1, 8, new Uint8Array(8)) });
    const bytes = archive([rec], (at) => [cenOfLocal(rec, at[0] ?? 0, REAL)]);
    expect(await outcome(bytes)).toBe('bad_archive');
  });

  it('rejects local sizes of 0xFFFFFFFF even without any extra field', async () => {
    const rec = storedDoc(REAL, { csize: 0xffffffff, usize: 0xffffffff });
    const bytes = archive([rec], (at) => [cenOfLocal(rec, at[0] ?? 0, REAL)]);
    expect(await outcome(bytes)).toBe('bad_archive');
  });

  it('rejects a local extra field whose declared length overruns the extra block', async () => {
    const rec = storedDoc(REAL, { extra: extraField(0x7075, 40, new Uint8Array(4)) });
    const bytes = archive([rec], (at) => [cenOfLocal(rec, at[0] ?? 0, REAL)]);
    expect(await outcome(bytes)).toBe('bad_archive');
  });

  it('accepts a harmless local extra field (not id 1) that fits', async () => {
    const rec = storedDoc(REAL, { extra: extraField(0x7075, 4, new Uint8Array(4)) });
    const bytes = archive([rec], (at) => [cenOfLocal(rec, at[0] ?? 0, REAL)]);
    const result = await run(bytes);
    expect(result).toMatchObject({ type: 'result' });
    if (result.type === 'result') expect(result.xml[0]?.text).toContain('GENUINE');
  });

  it('rejects data whose crc differs from the directory crc (stored)', async () => {
    const wrong = crc32(REAL) ^ 0xdeadbeef;
    const rec = storedDoc(REAL, { crc: wrong });
    const bytes = archive([rec], (at) => [{ ...cenOfLocal(rec, at[0] ?? 0, REAL), crc: wrong }]);
    expect(await outcome(bytes)).toBe('bad_archive');
  });

  it('rejects data whose crc differs from the directory crc (deflate, with a descriptor)', async () => {
    const data = deflateSync(REAL);
    const wrong = crc32(REAL) ^ 1;
    const rec: Local = {
      name: DOC,
      flags: 8,
      method: 8,
      data,
      descriptor: descriptor(wrong, data.length, REAL.length),
    };
    const bytes = archive([rec], (at) => [
      {
        name: DOC,
        flags: 8,
        method: 8,
        crc: wrong,
        csize: data.length,
        usize: REAL.length,
        offset: at[0] ?? 0,
      },
    ]);
    expect(await outcome(bytes)).toBe('bad_archive');
  });

  it('rejects a stored entry whose compressed and uncompressed sizes differ', async () => {
    const rec = storedDoc(REAL, { usize: REAL.length + 1 });
    const bytes = archive([rec], (at) => [
      { ...cenOfLocal(rec, at[0] ?? 0, REAL), usize: REAL.length + 1 },
    ]);
    expect(await outcome(bytes)).toBe('bad_archive');
  });

  it('does not scan the bytes of a signed descriptor: a usize spelling PK\\3\\4 is just a number', async () => {
    const spelled = 0x04034b50; // bytes 50 4b 03 04
    const filler = deflateSync(strToU8('abcd'));
    const a: Local = {
      name: 'word/a.bin',
      flags: 8,
      method: 8,
      data: filler,
      descriptor: descriptor(crc32(strToU8('abcd')), filler.length, spelled),
    };
    const doc: Local = storedDoc(REAL);
    const bytes = archive([a, doc], (at) => [
      {
        name: a.name,
        flags: 8,
        method: 8,
        crc: crc32(strToU8('abcd')),
        csize: filler.length,
        usize: spelled,
        offset: at[0] ?? 0,
      },
      cenOfLocal(doc, at[1] ?? 0, REAL),
    ]);
    const result = await run(bytes);
    expect(result).toMatchObject({ type: 'result' });
    if (result.type === 'result') {
      expect(result.xml.map((p) => p.text)).toEqual([expect.stringContaining('GENUINE')]);
    }
  });

  it('reads the part the directory names when a skipped entry carries record signatures in its data', async () => {
    const carrier = local(storedDoc(DECOY, { name: 'word/inner.xml' }));
    const a: Local = {
      name: 'word/a.bin',
      flags: 8,
      method: 0,
      data: carrier,
      descriptor: descriptor(crc32(carrier), carrier.length, carrier.length),
    };
    const doc: Local = storedDoc(REAL);
    const bytes = archive([a, doc], (at) => [
      {
        name: a.name,
        flags: 8,
        method: 0,
        crc: crc32(carrier),
        csize: carrier.length,
        usize: carrier.length,
        offset: at[0] ?? 0,
      },
      cenOfLocal(doc, at[1] ?? 0, REAL),
    ]);
    const result = await run(bytes);
    expect(result).toMatchObject({ type: 'result' });
    if (result.type === 'result') {
      expect(result.xml).toHaveLength(1);
      expect(result.xml[0]?.text).toContain('GENUINE');
    }
  });
});
