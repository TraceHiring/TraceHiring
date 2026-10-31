// The two Trace template files, trace-items-v1.xlsx and trace-items-v1.docx (spec §6.9, M1-9), built in the browser from
// this stream's own template definition (template.ts), so the file offered is exactly the file the parsers read. Each
// holds the fixed layout and one clearly synthetic example row. The only place in the import code that writes a zip
// (source-guards.test.ts allows `zipSync` here and nowhere else); it is the page that calls this, never the worker.
import { strToU8, zipSync } from 'fflate';
import {
  DOCX_META_KEYS,
  ITEM_HEADERS,
  SHEET_NAME,
  TEMPLATE_EXAMPLE,
  TEMPLATE_VERSION,
} from './template';
import type { ItemHeader } from './template';

export type TemplateKind = 'xlsx' | 'docx';

export const TEMPLATE_FILES: Readonly<Record<TemplateKind, string>> = {
  xlsx: `${TEMPLATE_VERSION}.xlsx`,
  docx: `${TEMPLATE_VERSION}.docx`,
};

export const TEMPLATE_MIME: Readonly<Record<TemplateKind, string>> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
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

const rootRels = (target: string): string =>
  `${HEAD}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="${target}"/></Relationships>`;

function columnLetters(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function xlsxFiles(): Record<string, Uint8Array> {
  const text = (ref: string, value: string): string =>
    `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
  const header = ITEM_HEADERS.map((name, i) => text(`${columnLetters(i)}1`, name)).join('');
  const example = ITEM_HEADERS.flatMap((name: ItemHeader, i) => {
    const value = TEMPLATE_EXAMPLE[name];
    if (value === '') return [];
    const ref = `${columnLetters(i)}2`;
    return [name === 'difficulty' ? `<c r="${ref}"><v>${esc(value)}</v></c>` : text(ref, value)];
  }).join('');
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  return {
    '[Content_Types].xml': strToU8(
      `${HEAD}<Types xmlns="${TYPES_NS}"><Default Extension="rels" ContentType="${RELS_CT}"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(rootRels('xl/workbook.xml')),
    'xl/workbook.xml': strToU8(
      `${HEAD}<workbook xmlns="${main}" xmlns:r="${OFFICE_REL}"><sheets><sheet name="${esc(SHEET_NAME)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `${HEAD}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `${HEAD}<worksheet xmlns="${main}"><cols><col min="1" max="${ITEM_HEADERS.length}" width="22" customWidth="1"/></cols><sheetData><row r="1">${header}</row><row r="2">${example}</row></sheetData></worksheet>`,
    ),
  };
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function docxFiles(): Record<string, Uint8Array> {
  const para = (styleId: string | null, value: string): string =>
    `<w:p>${styleId === null ? '' : `<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>`}<w:r><w:t xml:space="preserve">${esc(value)}</w:t></w:r></w:p>`;
  const styleXml = (id: string, name: string, extra = '', custom = true): string =>
    `<w:style w:type="paragraph"${custom ? ' w:customStyle="1"' : ''} w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/>${extra}</w:style>`;
  const meta = DOCX_META_KEYS.flatMap((key) =>
    TEMPLATE_EXAMPLE[key] === '' ? [] : [para('TraceMeta', `${key}: ${TEMPLATE_EXAMPLE[key]}`)],
  );
  const options = (['option_a', 'option_b', 'option_c'] as const).map((key) =>
    para('TraceOption', TEMPLATE_EXAMPLE[key]),
  );
  const body = [
    para(
      null,
      `Trace items template (${TEMPLATE_VERSION}). Each question starts with a Heading 2 paragraph. Under it, use the styles Trace Meta ("key: value" lines: ${DOCX_META_KEYS.join(', ')}), Trace Stem, Trace Option (one paragraph per option, in order) and Trace Correct (the letter of the correct option). Text before the first Heading 2 is not imported. Delete or replace the example below.`,
    ),
    para('Heading2', 'Example item'),
    ...meta,
    para('TraceStem', TEMPLATE_EXAMPLE.stem),
    ...options,
    para('TraceCorrect', TEMPLATE_EXAMPLE.correct),
  ].join('');
  return {
    '[Content_Types].xml': strToU8(
      `${HEAD}<Types xmlns="${TYPES_NS}"><Default Extension="rels" ContentType="${RELS_CT}"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    ),
    '_rels/.rels': strToU8(rootRels('word/document.xml')),
    'word/_rels/document.xml.rels': strToU8(
      `${HEAD}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/styles" Target="styles.xml"/></Relationships>`,
    ),
    'word/document.xml': strToU8(
      `${HEAD}<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`,
    ),
    'word/styles.xml': strToU8(
      `${HEAD}<w:styles xmlns:w="${W_NS}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${styleXml(
        'Heading2',
        'heading 2',
        '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="60"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr>',
        false,
      )}${styleXml('TraceMeta', 'Trace Meta', '<w:rPr><w:color w:val="595959"/></w:rPr>')}${styleXml('TraceStem', 'Trace Stem')}${styleXml('TraceOption', 'Trace Option', '<w:pPr><w:ind w:left="360"/></w:pPr>')}${styleXml('TraceCorrect', 'Trace Correct')}</w:styles>`,
    ),
  };
}

/** One template file as bytes. The same bytes every time: the zip carries a fixed time stamp. */
export function buildTemplateFile(kind: TemplateKind): Uint8Array<ArrayBuffer> {
  const zipped = zipSync(kind === 'xlsx' ? xlsxFiles() : docxFiles(), {
    level: 6,
    mtime: new Date(2026, 0, 1),
  });
  const out = new Uint8Array(new ArrayBuffer(zipped.length));
  out.set(zipped);
  return out;
}
