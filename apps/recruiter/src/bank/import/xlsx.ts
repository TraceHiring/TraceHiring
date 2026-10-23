// Reads the Items sheet of trace-items-v1.xlsx from the XML strings the worker posted (spec §6.9, E9). A formula cell
// contributes its cached value only; relationships marked External are never followed; nothing is evaluated.
import type { XmlPart } from './protocol';
import { ITEM_HEADERS, SHEET_NAME, emptyValues, type ItemHeader, type RawRow } from './template';
import { attr, descendants, kid, kids, nameOf, parseXml } from './xml';

export type SheetFailure = 'bad_template' | 'bad_xml' | 'macro_file' | 'row_limit' | 'no_rows';
export type SheetOutcome = { ok: true; rows: RawRow[] } | { ok: false; code: SheetFailure };

/** Row 1 is the header and a job holds at most 2,000 rows, so no data row may sit below sheet row 2001. */
const LAST_ROW_NO = 2001;

const fail = (code: SheetFailure): SheetOutcome => ({ ok: false, code });

/** Joins `base` and a relationship target into a part name (no leading slash, `..` resolved). */
export function resolvePart(base: string, target: string): string {
  const parts = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const seg of target.replace(/^\//, '').split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

/** The text of a rich-text container: its `t` runs, in order, without phonetic guides. */
function richText(el: Element): string {
  let out = '';
  for (const child of Array.from(el.children)) {
    const name = nameOf(child);
    if (name === 't') out += child.textContent ?? '';
    else if (name === 'r') out += richText(child);
  }
  return out;
}

function sharedStrings(part: XmlPart | undefined): string[] | null {
  if (part === undefined) return [];
  const root = parseXml(part.text);
  if (root === null) return null;
  return kids(root, 'si').map((si) => richText(si));
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

function cellValue(cell: Element, strings: readonly string[]): string {
  const type = attr(cell, 't');
  if (type === 'inlineStr') {
    const inline = kid(cell, 'is');
    return inline === null ? '' : richText(inline);
  }
  const raw = kid(cell, 'v')?.textContent ?? '';
  if (type === 's') return strings[Number.parseInt(raw, 10)] ?? '';
  if (type === 'e') return '';
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
  return raw; // numbers, and the cached result of a formula (t="str" or none)
}

export function readXlsxRows(parts: readonly XmlPart[], maxRows: number): SheetOutcome {
  const byName = new Map(parts.map((p) => [p.name, p]));
  const types = byName.get('[Content_Types].xml');
  if (types !== undefined && /macroEnabled/i.test(types.text)) return fail('macro_file');
  const workbookPart = byName.get('xl/workbook.xml');
  const relsPart = byName.get('xl/_rels/workbook.xml.rels');
  if (workbookPart === undefined || relsPart === undefined) return fail('bad_template');
  const workbook = parseXml(workbookPart.text);
  const rels = parseXml(relsPart.text);
  if (workbook === null || rels === null) return fail('bad_xml');

  const sheet = descendants(workbook, 'sheet').find(
    (s) => attr(s, 'name')?.toLowerCase() === SHEET_NAME.toLowerCase(),
  );
  const relId = sheet === undefined ? null : attr(sheet, 'id');
  const rel = descendants(rels, 'Relationship').find(
    (r) => attr(r, 'Id') === relId && attr(r, 'TargetMode') !== 'External',
  );
  const target = rel === undefined ? null : attr(rel, 'Target');
  if (target === null) return fail('bad_template');
  const sheetPart = byName.get(resolvePart('xl/workbook.xml', target));
  if (sheetPart === undefined) return fail('bad_template');

  const strings = sharedStrings(byName.get('xl/sharedStrings.xml'));
  const root = parseXml(sheetPart.text);
  if (strings === null || root === null) return fail('bad_xml');
  const data = descendants(root, 'sheetData')[0];
  if (data === undefined) return fail('bad_template');

  let headerCols: Map<ItemHeader, number> | null = null;
  const rows: RawRow[] = [];
  let lastRowNo = 0;
  for (const row of kids(data, 'row')) {
    const given = Number.parseInt(attr(row, 'r') ?? '', 10);
    const rowNo = Number.isInteger(given) && given > 0 ? given : lastRowNo + 1;
    lastRowNo = rowNo;
    const cells = new Map<number, string>();
    let nextCol = 0;
    for (const cell of kids(row, 'c')) {
      const ref = attr(cell, 'r');
      const col = ref === null ? nextCol : columnIndex(ref);
      nextCol = col + 1;
      cells.set(col, cellValue(cell, strings).trim());
    }
    if (headerCols === null) {
      const found = new Map<ItemHeader, number>();
      for (const [col, text] of cells) {
        const name = ITEM_HEADERS.find((h) => h === text.toLowerCase());
        if (name !== undefined && !found.has(name)) found.set(name, col);
      }
      if (ITEM_HEADERS.some((h) => !found.has(h))) return fail('bad_template');
      headerCols = found;
      continue;
    }
    const values = emptyValues();
    let any = false;
    for (const [name, col] of headerCols) {
      const text = cells.get(col) ?? '';
      values[name] = text;
      if (text !== '') any = true;
    }
    if (!any) continue;
    if (rowNo > LAST_ROW_NO || rows.length >= maxRows) return fail('row_limit');
    rows.push({ rowNo, values, extraProblems: [], inlineImage: null });
  }
  if (headerCols === null) return fail('bad_template');
  if (rows.length === 0) return fail('no_rows');
  return { ok: true, rows };
}
