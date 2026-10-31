// X1 (security review): a streaming reader sees the local records, Office reads the central directory. They must be the
// same list: an entry name streamed twice, or listed but never streamed, is a bad archive, so a repeated record can
// neither slip past the image-count pre-check nor replace the part the directory names ("the last one wins").
import { strFromU8, strToU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  docxBytes,
  mcqDocxItem,
  mcqRow,
  pngBytes,
  xlsxBytes,
  zipBytes,
} from './fixtures.test-helpers';
import { IMPORT_LIMITS, type ImportLimits } from './limits';
import { extractArchive } from './zip-core';

const small = (over: Partial<ImportLimits>): ImportLimits => ({ ...IMPORT_LIMITS, ...over });
async function outcome(
  bytes: Uint8Array,
  name: string,
  kind: 'xlsx' | 'docx' | 'zip',
  limits = IMPORT_LIMITS,
) {
  const result = await extractArchive(new File([bytes as BlobPart], name), name, kind, limits);
  return result.type === 'error' ? result.code : `result:${result.type}`;
}

/** The offset of the central directory in a zip made by fflate (no archive comment). */
function directoryOffset(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return view.getUint32(i + 16, true);
  }
  throw new Error('no end of central directory');
}

/**
 * A zip whose streamed local records come from `localsFrom` (in order) and whose central directory and end record are
 * those of `directoryFrom`: what a hand-made archive can do, and what Office reads (the directory) versus what a
 * streaming reader sees (the local records).
 */
function spliceZip(localsFrom: Uint8Array[], directoryFrom: Uint8Array): Uint8Array<ArrayBuffer> {
  const locals = localsFrom.map((zip) => zip.subarray(0, directoryOffset(zip)));
  const tail = directoryFrom.subarray(directoryOffset(directoryFrom));
  const size = locals.reduce((n, l) => n + l.length, 0);
  const out = new Uint8Array(new ArrayBuffer(size + tail.length));
  let at = 0;
  for (const local of locals) {
    out.set(local, at);
    at += local.length;
  }
  out.set(tail, size);
  const view = new DataView(out.buffer);
  for (let i = out.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      view.setUint32(i + 16, size, true); // the directory now starts after the longer run of local records
      break;
    }
  }
  return out;
}

describe('extractArchive: the streamed records must be the directory (X1)', () => {
  it('rejects the same image name streamed twice when the directory lists it once', async () => {
    const one = zipBytes({ 'a.png': pngBytes(1) });
    const two = zipBytes({ 'a.png': pngBytes(2) });
    expect(await outcome(spliceZip([one, two], one), 'p.zip', 'zip')).toBe('bad_archive');
  });

  it('rejects 1,500 local records of one name under one directory entry (not 1,500 images)', async () => {
    const one = zipBytes({ 'a.png': pngBytes(1) });
    const bytes = spliceZip(
      Array.from({ length: 1500 }, () => one),
      one,
    );
    expect(await outcome(bytes, 'p.zip', 'zip')).toBe('bad_archive');
  });

  // The second record has the size the directory declares, so only the repeated name gives it away.
  const sameSizeCopy = (zip: Uint8Array, part: string, from: string, to: string): Uint8Array => {
    expect(to).toHaveLength(from.length);
    const original = unzipSync(zip)[part];
    if (original === undefined) throw new Error(`no ${part}`);
    const changed = strFromU8(original).replace(from, to);
    expect(changed).not.toBe(strFromU8(original));
    return zipBytes({ [part]: strToU8(changed) });
  };

  it('rejects a second word/document.xml: the last record must not win over the directory', async () => {
    const real = docxBytes([mcqDocxItem(1)]);
    const other = sameSizeCopy(real, 'word/document.xml', 'second', 'SECOND');
    expect(await outcome(spliceZip([real, other], real), 'x.docx', 'docx')).toBe('bad_archive');
  });

  it('rejects a second xl/worksheets/sheet1.xml', async () => {
    const real = xlsxBytes([mcqRow(1)]);
    const other = sameSizeCopy(real, 'xl/worksheets/sheet1.xml', '<v>0</v>', '<v>1</v>');
    expect(await outcome(spliceZip([real, other], real), 'x.xlsx', 'xlsx')).toBe('bad_archive');
  });

  it('rejects a directory entry that is never streamed', async () => {
    const both = zipBytes({ 'a.png': pngBytes(1), 'b.png': pngBytes(2) });
    const onlyA = zipBytes({ 'a.png': pngBytes(1) });
    expect(await outcome(spliceZip([onlyA], both), 'p.zip', 'zip')).toBe('bad_archive');
  });

  it('still reads an honest archive, with a skipped oversize image and a folder entry', async () => {
    const honest = zipBytes({
      'pics/': new Uint8Array(0),
      'pics/a.png': pngBytes(1),
      'pics/big.png': pngBytes(2, 300),
      'notes.txt': strToU8('not an image'),
    });
    const result = await extractArchive(
      new File([honest], 'p.zip'),
      'p.zip',
      'zip',
      small({ imageBytes: 100 }),
    );
    expect(result.type).toBe('result');
    if (result.type !== 'result') return;
    expect(result.images.map((i) => i.name)).toEqual(['pics/a.png']);
    expect(result.skippedImages).toEqual([{ name: 'pics/big.png', reason: 'too_large' }]);
  });
});
