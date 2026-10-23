// Tiny synthetic xlsx / docx / zip builders for the import tests. Tests only: `zipSync` is used here to make fixtures
// and never in production code (ADR-033; source-guards.test.ts scans the non-test files). Every value is synthetic.
import { strToU8, zipSync, type Zippable } from 'fflate';
import { ITEM_HEADERS } from './template';
import type { CreateWorker, WorkerLike } from './worker-client';
import { handleWorkerMessage } from './worker-handler';

export type Cell = string | number | null | { f: string; v: string | number };
export type SheetRow = Cell[];

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const esc = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

export function columnLetters(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export interface XlsxOptions {
  /** Row 1; defaults to the template header. */
  headers?: readonly string[];
  sheetName?: string;
  /** Write strings inline (`t="inlineStr"`) instead of as shared strings. */
  inlineStrings?: boolean;
  /** Extra zip entries (for example a macro part) as name -> text or bytes. */
  extraEntries?: Record<string, string | Uint8Array>;
  /** Appended inside [Content_Types].xml. */
  contentTypesExtra?: string;
  /** A sheet XML written first, before the Items sheet, so the Items sheet is `sheet2.xml`. */
  decoySheet?: boolean;
  /** Level 0 stores entries; the default deflates them. */
  level?: 0 | 6;
}

export function xlsxEntries(rows: SheetRow[], options: XlsxOptions = {}): Zippable {
  const headers = options.headers ?? ITEM_HEADERS;
  const shared: string[] = [];
  const sharedIndex = (s: string): number => {
    const found = shared.indexOf(s);
    if (found >= 0) return found;
    shared.push(s);
    return shared.length - 1;
  };
  const cellXml = (ref: string, cell: Cell): string => {
    if (cell === null) return '';
    if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`;
    if (typeof cell === 'object') {
      const t = typeof cell.v === 'number' ? '' : ' t="str"';
      return `<c r="${ref}"${t}><f>${esc(cell.f)}</f><v>${esc(String(cell.v))}</v></c>`;
    }
    if (options.inlineStrings === true) {
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(cell)}</t></is></c>`;
    }
    return `<c r="${ref}" t="s"><v>${sharedIndex(cell)}</v></c>`;
  };
  const all: SheetRow[] = [[...headers], ...rows];
  const sheetRows = all
    .map((row, r) => {
      const cells = row.map((cell, c) => cellXml(`${columnLetters(c)}${r + 1}`, cell)).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const name = options.sheetName ?? 'Items';
  const sheetFile = options.decoySheet === true ? 'sheet2.xml' : 'sheet1.xml';
  const sheets =
    options.decoySheet === true
      ? `<sheet name="Notes" sheetId="1" r:id="rId9"/><sheet name="${esc(name)}" sheetId="2" r:id="rId1"/>`
      : `<sheet name="${esc(name)}" sheetId="1" r:id="rId1"/>`;
  const rels =
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${sheetFile}"/>` +
    (options.decoySheet === true
      ? '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      : '') +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/x" TargetMode="External"/>';
  const out: Zippable = {
    '[Content_Types].xml': strToU8(
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${options.contentTypesExtra ?? ''}</Types>`,
    ),
    'xl/workbook.xml': strToU8(
      `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`,
    ),
    [`xl/worksheets/${sheetFile}`]: strToU8(
      `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    ),
  };
  if (options.decoySheet === true) {
    out['xl/worksheets/sheet1.xml'] = strToU8(
      `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>notes</t></is></c></row></sheetData></worksheet>`,
    );
  }
  out['xl/sharedStrings.xml'] = strToU8(
    `${XML_HEAD}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared
      .map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`)
      .join('')}</sst>`,
  );
  for (const [entryName, content] of Object.entries(options.extraEntries ?? {})) {
    out[entryName] = typeof content === 'string' ? strToU8(content) : content;
  }
  return out;
}

export function xlsxBytes(rows: SheetRow[], options: XlsxOptions = {}): Uint8Array<ArrayBuffer> {
  return zipBytes(xlsxEntries(rows, options), options.level);
}

export function zipBytes(entries: Zippable, level: 0 | 6 = 6): Uint8Array<ArrayBuffer> {
  const bytes = zipSync(entries, { level });
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes);
  return out;
}

/** A row of the Items sheet in header order from named values (everything else blank). */
export function itemRow(values: Partial<Record<(typeof ITEM_HEADERS)[number], Cell>>): SheetRow {
  return ITEM_HEADERS.map((h) => values[h] ?? null);
}

/** A valid multiple-choice row. */
export function mcqRow(
  n: number,
  extra: Partial<Record<(typeof ITEM_HEADERS)[number], Cell>> = {},
): SheetRow {
  return itemRow({
    format: 'mcq',
    skill: 'quant',
    difficulty: 0.5,
    stem: `[synthetic] Question ${n}: pick the second option.`,
    option_a: `[synthetic] first ${n}`,
    option_b: `[synthetic] second ${n}`,
    option_c: `[synthetic] third ${n}`,
    correct: 'b',
    ...extra,
  });
}

export function writtenRow(
  n: number,
  extra: Partial<Record<(typeof ITEM_HEADERS)[number], Cell>> = {},
): SheetRow {
  return itemRow({
    format: 'written',
    skill: 'writing',
    difficulty: 0.4,
    stem: `[synthetic] Describe topic ${n} in two sentences.`,
    rubric_key: 'clarity-v1',
    ...extra,
  });
}

// ---- images ---------------------------------------------------------------------------------------------------------

/** A few bytes that pass the PNG magic check; `seed` makes distinct content. */
export function pngBytes(seed: number, extraBytes = 0): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(16 + extraBytes));
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  out[8] = seed & 0xff;
  out[9] = (seed >> 8) & 0xff;
  return out;
}
export function jpegBytes(seed: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(16));
  out.set([0xff, 0xd8, 0xff, 0xe0]);
  out[4] = seed & 0xff;
  return out;
}
export function webpBytes(seed: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(16));
  out.set([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  out[12] = seed & 0xff;
  return out;
}

// ---- docx ----------------------------------------------------------------------------------------------------------

export interface DocxItem {
  title?: string;
  meta?: string[];
  stem?: string[];
  options?: string[];
  correct?: string;
  /** Names an entry of `images` (word/media/<name>) placed inline in the item, with this alt text (docPr descr). */
  image?: { file: string; alt?: string | undefined }; // file '@external': an embed pointing outside the file
  /** Paragraphs in a style that is not part of the template. */
  other?: string[];
}

export interface DocxOptions {
  images?: Record<string, Uint8Array>;
  extraEntries?: Record<string, string | Uint8Array>;
  contentTypesExtra?: string;
  /** Drop the styles part (a malformed template). */
  noStyles?: boolean;
}

const W_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';

const para = (styleId: string, text: string): string =>
  `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

export function docxEntries(items: DocxItem[], options: DocxOptions = {}): Zippable {
  const rels: string[] = [];
  const imageNames = Object.keys(options.images ?? {});
  imageNames.forEach((name, i) => {
    rels.push(
      `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`,
    );
  });
  rels.push(
    '<Relationship Id="rIdExt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/pic.png" TargetMode="External"/>',
  );
  const body = items
    .map((item, n) => {
      const parts = [para('Heading2', item.title ?? `[synthetic] item ${n + 1}`)];
      for (const meta of item.meta ?? []) parts.push(para('TraceMeta', meta));
      for (const s of item.stem ?? []) parts.push(para('TraceStem', s));
      if (item.image !== undefined) {
        const idx = imageNames.indexOf(item.image.file);
        const rid =
          item.image.file === '@external' ? 'rIdExt' : idx >= 0 ? `rIdImg${idx + 1}` : 'rIdMissing';
        const descr = item.image.alt === undefined ? '' : ` descr="${esc(item.image.alt)}"`;
        parts.push(
          `<w:p><w:r><w:drawing><wp:inline><wp:docPr id="${n + 1}" name="Picture"${descr}/><a:graphic><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="${rid}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
        );
      }
      for (const o of item.options ?? []) parts.push(para('TraceOption', o));
      if (item.correct !== undefined) parts.push(para('TraceCorrect', item.correct));
      for (const o of item.other ?? []) parts.push(para('Normal', o));
      return parts.join('');
    })
    .join('');
  const out: Zippable = {
    '[Content_Types].xml': strToU8(
      `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${options.contentTypesExtra ?? ''}</Types>`,
    ),
    'word/document.xml': strToU8(
      `${XML_HEAD}<w:document ${W_NS}><w:body><w:p><w:r><w:t>[synthetic] preface, not an item</w:t></w:r></w:p>${body}</w:body></w:document>`,
    ),
    'word/_rels/document.xml.rels': strToU8(
      `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`,
    ),
  };
  if (options.noStyles !== true) {
    const style = (id: string, name: string): string =>
      `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/></w:style>`;
    out['word/styles.xml'] = strToU8(
      `${XML_HEAD}<w:styles ${W_NS}>${style('Normal', 'Normal')}${style('Heading2', 'heading 2')}${style('TraceStem', 'Trace Stem')}${style('TraceOption', 'Trace Option')}${style('TraceCorrect', 'Trace Correct')}${style('TraceMeta', 'Trace Meta')}</w:styles>`,
    );
  }
  for (const [name, bytes] of Object.entries(options.images ?? {})) {
    out[`word/media/${name}`] = bytes;
  }
  for (const [entryName, content] of Object.entries(options.extraEntries ?? {})) {
    out[entryName] = typeof content === 'string' ? strToU8(content) : content;
  }
  return out;
}

export function docxBytes(items: DocxItem[], options: DocxOptions = {}): Uint8Array<ArrayBuffer> {
  return zipBytes(docxEntries(items, options));
}

export function mcqDocxItem(n: number, extra: Partial<DocxItem> = {}): DocxItem {
  return {
    meta: ['format: mcq', 'skill: quant', 'difficulty: 0.5'],
    stem: [`[synthetic] Question ${n}: pick the second option.`],
    options: [`[synthetic] first ${n}`, `[synthetic] second ${n}`, `[synthetic] third ${n}`],
    correct: 'b',
    ...extra,
  };
}

export const asFile = (bytes: Uint8Array<ArrayBuffer>, name: string): File =>
  new File([bytes], name);

// ---- an in-process worker ------------------------------------------------------------------------------------------

/** A Worker stand-in that runs the real handler (worker-handler.ts) in this process, with the real protocol. */
export const inProcessWorker: CreateWorker = () => {
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(message) {
      void handleWorkerMessage(message).then((reply) => {
        worker.onmessage?.({ data: reply.answer });
      });
    },
    terminate() {},
  };
  return worker;
};
