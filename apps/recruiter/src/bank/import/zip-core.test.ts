// The worker's extraction core (R5-48, ADR-033, E9, E11): streaming unzip with every cap. Fixtures are synthetic zips
// built with fflate's zipSync (tests only); a zip bomb is a small zip whose entry inflates far past the cap.
import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  asFile,
  docxBytes,
  mcqDocxItem,
  mcqRow,
  pngBytes,
  xlsxBytes,
  zipBytes,
} from './fixtures.test-helpers';
import { IMPORT_LIMITS, type ImportLimits } from './limits';
import type { ExtractResult } from './protocol';
import { extractArchive } from './zip-core';

const MIB = 1_048_576;
const small = (over: Partial<ImportLimits>): ImportLimits => ({ ...IMPORT_LIMITS, ...over });

async function ok(file: File, kind: 'xlsx' | 'docx' | 'zip', limits = IMPORT_LIMITS) {
  const result = await extractArchive(file, file.name, kind, limits);
  if (result.type !== 'result') throw new Error(`expected a result, got ${result.code}`);
  return result;
}
async function code(
  file: Blob,
  name: string,
  kind: 'xlsx' | 'docx' | 'zip',
  limits = IMPORT_LIMITS,
) {
  const result = await extractArchive(file, name, kind, limits);
  return result.type === 'error' ? result.code : `result:${result.type}`;
}
const names = (r: ExtractResult) => r.xml.map((p) => p.name).sort();

/** Rewrites the uncompressed size a zip declares, in the local header and the central directory of entry 0. */
function lieAboutSize(bytes: Uint8Array<ArrayBuffer>, declared: number): Uint8Array<ArrayBuffer> {
  const out = bytes.slice();
  const view = new DataView(out.buffer);
  expect(view.getUint32(0, true)).toBe(0x04034b50);
  view.setUint32(22, declared, true);
  for (let i = out.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      const cd = view.getUint32(i + 16, true);
      expect(view.getUint32(cd, true)).toBe(0x02014b50);
      view.setUint32(cd + 24, declared, true);
      return out;
    }
  }
  throw new Error('no end of central directory');
}

describe('extractArchive: what is posted', () => {
  it('an xlsx posts its XML parts as strings and nothing else', async () => {
    const r = await ok(asFile(xlsxBytes([mcqRow(1)]), 'items.xlsx'), 'xlsx');
    expect(names(r)).toEqual([
      '[Content_Types].xml',
      'xl/_rels/workbook.xml.rels',
      'xl/sharedStrings.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    expect(r.images).toEqual([]);
    expect(r.xml.find((p) => p.name === 'xl/sharedStrings.xml')?.text).toContain(
      '[synthetic] Question 1',
    );
  });

  it('stored entries (no compression) are read too', async () => {
    const r = await ok(asFile(xlsxBytes([mcqRow(1)], { level: 0 }), 'items.xlsx'), 'xlsx');
    expect(names(r)).toContain('xl/worksheets/sheet1.xml');
  });

  it('a docx posts document, styles, relationships, content types and its media', async () => {
    const png = pngBytes(1);
    const bytes = docxBytes([mcqDocxItem(1, { image: { file: 'a.png', alt: 'x' } })], {
      images: { 'a.png': png },
    });
    const r = await ok(asFile(bytes, 'items.docx'), 'docx');
    expect(names(r)).toEqual([
      '[Content_Types].xml',
      'word/_rels/document.xml.rels',
      'word/document.xml',
      'word/styles.xml',
    ]);
    expect(r.images.map((i) => i.name)).toEqual(['word/media/a.png']);
    expect([...(r.images[0]?.bytes ?? [])]).toEqual([...png]);
  });

  it('an images zip posts image files and ignores everything else', async () => {
    const bytes = zipBytes({
      'one.png': pngBytes(1),
      'sub/two.PNG': pngBytes(2),
      'notes.txt': strToU8('not an image'),
      '__MACOSX/._one.png': pngBytes(9),
      '.hidden.png': pngBytes(8),
      'dir/': new Uint8Array(0),
    });
    const r = await ok(asFile(bytes, 'pics.zip'), 'zip');
    expect(r.xml).toEqual([]);
    expect(r.images.map((i) => i.name).sort()).toEqual(['one.png', 'sub/two.PNG']);
  });

  it('an image whose declared size is over the per-image cap is named, not posted, and not an error', async () => {
    const bytes = zipBytes({ 'big.png': pngBytes(1, 2 * MIB), 'ok.png': pngBytes(2) });
    const r = await ok(asFile(bytes, 'pics.zip'), 'zip');
    expect(r.images.map((i) => i.name)).toEqual(['ok.png']);
    expect(r.skippedImages).toEqual([{ name: 'big.png', reason: 'too_large' }]);
  });

  it('an image of exactly 1 MiB is posted; one byte more is skipped (E11)', async () => {
    const bytes = zipBytes({
      'edge.png': pngBytes(1, MIB - 16),
      'over.png': pngBytes(2, MIB - 15),
    });
    const r = await ok(asFile(bytes, 'pics.zip'), 'zip');
    expect(r.images.map((i) => i.name)).toEqual(['edge.png']);
    expect(r.skippedImages.map((s) => s.name)).toEqual(['over.png']);
  });
});

describe('extractArchive: refused before reading (R5-48, E9)', () => {
  it('refuses a macro file by extension, a wrong extension, and a kind mismatch', async () => {
    const x = asFile(xlsxBytes([mcqRow(1)]), 'items.xlsm');
    expect(await code(x, 'items.xlsm', 'xlsx')).toBe('macro_file');
    expect(await code(x, 'items.XLSB', 'xlsx')).toBe('macro_file');
    expect(await code(x, 'items.docm', 'docx')).toBe('macro_file');
    expect(await code(x, 'items.xls', 'xlsx')).toBe('bad_extension');
    expect(await code(x, 'items.docx', 'xlsx')).toBe('bad_extension');
    expect(await code(x, 'items', 'zip')).toBe('bad_extension');
  });

  it('checks the picked size first and never reads an over-size file', async () => {
    const blob = new Blob([new Uint8Array(10)]);
    Object.defineProperty(blob, 'size', { value: 10 * MIB + 1 });
    blob.slice = () => {
      throw new Error('the file must not be read');
    };
    blob.arrayBuffer = () => Promise.reject(new Error('the file must not be read'));
    expect(await code(blob, 'items.xlsx', 'xlsx')).toBe('file_too_large');
    const big = new Blob([new Uint8Array(10)]);
    Object.defineProperty(big, 'size', { value: 100 * MIB + 1 });
    big.slice = blob.slice;
    expect(await code(big, 'items.docx', 'docx')).toBe('file_too_large');
    expect(await code(big, 'pics.zip', 'zip')).toBe('file_too_large');
  });

  it('refuses a macro-enabled content type and a vbaProject part (E9)', async () => {
    const byType = xlsxBytes([mcqRow(1)], {
      contentTypesExtra:
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/>',
    });
    expect(await code(asFile(byType, 'items.xlsx'), 'items.xlsx', 'xlsx')).toBe('macro_file');
    const byPart = xlsxBytes([mcqRow(1)], {
      extraEntries: { 'xl/vbaProject.bin': new Uint8Array(4) },
    });
    expect(await code(asFile(byPart, 'items.xlsx'), 'items.xlsx', 'xlsx')).toBe('macro_file');
  });

  it('a formula cell and an external relationship are plain text to the worker (nothing is evaluated or fetched)', async () => {
    const bytes = xlsxBytes([
      mcqRow(1, { stem: { f: 'HYPERLINK("https://example.invalid")', v: 'cached' } }),
    ]);
    const r = await ok(asFile(bytes, 'items.xlsx'), 'xlsx');
    expect(r.xml.find((p) => p.name === 'xl/worksheets/sheet1.xml')?.text).toContain('<f>');
  });
});

describe('extractArchive: zip bombs and caps (E11, R2-19, ADR-033)', () => {
  const bomb = (mib: number) => zipBytes({ 'xl/worksheets/sheet1.xml': new Uint8Array(mib * MIB) });

  it('aborts, with one code, when the declared sizes pass the whole-archive cap', async () => {
    const bytes = bomb(3);
    expect(bytes.length).toBeLessThan(20_000);
    expect(
      await code(asFile(bytes, 'x.xlsx'), 'x.xlsx', 'xlsx', small({ uncompressedBytes: MIB })),
    ).toBe('archive_too_large');
  });

  it('aborts when one XML part is over the per-part cap, though the archive total is not', async () => {
    const bytes = bomb(3);
    expect(
      await code(asFile(bytes, 'x.xlsx'), 'x.xlsx', 'xlsx', small({ xmlPartBytes: MIB })),
    ).toBe('archive_too_large');
  });

  it('aborts when the XML parts together pass the XML total', async () => {
    const bytes = zipBytes({
      'xl/worksheets/sheet1.xml': new Uint8Array(MIB),
      'xl/worksheets/sheet2.xml': new Uint8Array(MIB),
    });
    expect(
      await code(asFile(bytes, 'x.xlsx'), 'x.xlsx', 'xlsx', small({ xmlTotalBytes: MIB + 100 })),
    ).toBe('archive_too_large');
  });

  it('a header that lies about the size still stops at the running counter', async () => {
    const lying = lieAboutSize(bomb(3), 100);
    expect(
      await code(asFile(lying, 'x.xlsx'), 'x.xlsx', 'xlsx', small({ uncompressedBytes: MIB })),
    ).toBe('archive_too_large');
    // Even with generous caps the lie is caught: the stream passes what the directory declared.
    expect(await code(asFile(lying, 'x.xlsx'), 'x.xlsx', 'xlsx')).toBe('archive_too_large');
  });

  it('a lying header on an image stops the whole import, not just the image', async () => {
    const lying = lieAboutSize(zipBytes({ 'a.png': pngBytes(1, 3 * MIB) }), 100);
    expect(await code(asFile(lying, 'p.zip'), 'p.zip', 'zip')).toBe('archive_too_large');
  });

  it('a lie in the other direction (declares more than it holds) is a bad archive', async () => {
    const lying = lieAboutSize(xlsxBytes([mcqRow(1)]), 5000);
    expect(await code(asFile(lying, 'x.xlsx'), 'x.xlsx', 'xlsx')).not.toMatch(/^result/);
  });

  it('stops at too many images and too many entries', async () => {
    const bytes = zipBytes({ 'a.png': pngBytes(1), 'b.png': pngBytes(2), 'c.png': pngBytes(3) });
    expect(await code(asFile(bytes, 'p.zip'), 'p.zip', 'zip', small({ images: 2 }))).toBe(
      'too_many_images',
    );
    expect(await code(asFile(bytes, 'p.zip'), 'p.zip', 'zip', small({ entries: 2 }))).toBe(
      'too_many_entries',
    );
    expect(await code(asFile(bytes, 'p.zip'), 'p.zip', 'zip', small({ images: 3 }))).toBe(
      'result:result',
    );
  });
});

describe('extractArchive: bad archives', () => {
  it('rejects bytes that are not a zip, an empty file and a truncated zip', async () => {
    expect(await code(new File([strToU8('not a zip')], 'x.xlsx'), 'x.xlsx', 'xlsx')).toBe(
      'bad_archive',
    );
    expect(await code(new File([], 'x.xlsx'), 'x.xlsx', 'xlsx')).toBe('bad_archive');
    const whole = xlsxBytes([mcqRow(1)]);
    const cut = whole.slice(0, Math.floor(whole.length / 2));
    expect(await code(new File([cut], 'x.xlsx'), 'x.xlsx', 'xlsx')).toBe('bad_archive');
  });

  it('rejects an encrypted entry and an unknown compression method', async () => {
    const enc = xlsxBytes([mcqRow(1)]).slice();
    const view = new DataView(enc.buffer);
    for (let i = enc.length - 22; i >= 0; i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        const cd = view.getUint32(i + 16, true);
        view.setUint16(cd + 8, view.getUint16(cd + 8, true) | 1, true);
        break;
      }
    }
    expect(await code(new File([enc], 'x.xlsx'), 'x.xlsx', 'xlsx')).toBe('bad_archive');

    const method = xlsxBytes([mcqRow(1)]).slice();
    const mv = new DataView(method.buffer);
    mv.setUint16(8, 14, true); // first local header: LZMA, which no decoder is registered for
    for (let i = method.length - 22; i >= 0; i--) {
      if (mv.getUint32(i, true) === 0x06054b50) {
        mv.setUint16(mv.getUint32(i + 16, true) + 10, 14, true);
        break;
      }
    }
    expect(await code(new File([method], 'x.xlsx'), 'x.xlsx', 'xlsx')).toBe('bad_archive');
  });

  it('rejects a duplicate entry name in the directory', async () => {
    const bytes = zipBytes({ 'aa.png': pngBytes(1), 'bb.png': pngBytes(2) }).slice();
    const view = new DataView(bytes.buffer);
    let end = bytes.length - 22;
    while (view.getUint32(end, true) !== 0x06054b50) end--;
    const first = view.getUint32(end + 16, true) + 46;
    const second = first + 6 + 46;
    bytes.copyWithin(second, first, first + 6); // the second directory entry now says "aa.png" too
    expect(await code(new File([bytes], 'p.zip'), 'p.zip', 'zip')).toBe('bad_archive');
  });
});
