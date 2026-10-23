// Reads trace-items-v1.docx from the XML strings the worker posted (spec §6.9). One item per `Heading 2` block. Inside
// a block, by paragraph style: `Trace Meta` ("key: value" lines: format, skill, difficulty, rubric_key, image_alt,
// param_spec_json), `Trace Stem` (joined with new lines), `Trace Option` (in order, a to f) and `Trace Correct` (the
// letter). An inline picture belongs to its item. Paragraphs in any other style, and text before the first Heading 2,
// are not part of an item. External relationships are never followed. Row numbers start at 2 (the first item), so a
// docx row number means the same thing in the errors table as an xlsx one.
import type { XmlPart } from './protocol';
import { resolvePart, type SheetFailure } from './xlsx';
import {
  DOCX_META_KEYS,
  OPTION_HEADERS,
  emptyValues,
  type ItemHeader,
  type RawRow,
} from './template';
import { attr, descendants, kids, nameOf, parseXml } from './xml';

export type DocxOutcome = { ok: true; rows: RawRow[] } | { ok: false; code: SheetFailure };

const fail = (code: SheetFailure): DocxOutcome => ({ ok: false, code });
const LAST_ROW_NO = 2001;
const SKIPPED_IN_TEXT = new Set([
  'delText',
  'instrText',
  'drawing',
  'pict',
  'object',
  'pPr',
  'rPr',
  'Fallback',
]);

/** A style name without case or spaces: "Heading 2" and "heading 2" are both "heading2". */
const styleKey = (name: string): string => name.toLowerCase().replace(/\s+/g, '');

function paragraphText(p: Element): string {
  let out = '';
  const walk = (el: Element): void => {
    for (const child of Array.from(el.children)) {
      const name = nameOf(child);
      if (name === 't') out += child.textContent ?? '';
      else if (name === 'tab') out += '\t';
      else if (name === 'br' || name === 'cr') out += '\n';
      else if (!SKIPPED_IN_TEXT.has(name)) walk(child);
    }
  };
  walk(p);
  return out;
}

interface Block {
  meta: Map<ItemHeader, string>;
  extraProblems: RawRow['extraProblems'];
  stem: string[];
  options: string[];
  correct: string;
  blips: { embed: string | null; link: string | null }[];
  docPrAlt: string;
}

const newBlock = (): Block => ({
  meta: new Map(),
  extraProblems: [],
  stem: [],
  options: [],
  correct: '',
  blips: [],
  docPrAlt: '',
});

export function readDocxRows(parts: readonly XmlPart[], maxRows: number): DocxOutcome {
  const byName = new Map(parts.map((p) => [p.name, p]));
  const types = byName.get('[Content_Types].xml');
  if (types !== undefined && /macroEnabled/i.test(types.text)) return fail('macro_file');
  const documentPart = byName.get('word/document.xml');
  const stylesPart = byName.get('word/styles.xml');
  const relsPart = byName.get('word/_rels/document.xml.rels');
  if (documentPart === undefined || stylesPart === undefined) return fail('bad_template');
  const document = parseXml(documentPart.text);
  const styles = parseXml(stylesPart.text);
  const rels = relsPart === undefined ? null : parseXml(relsPart.text);
  if (document === null || styles === null || (relsPart !== undefined && rels === null)) {
    return fail('bad_xml');
  }

  const styleNames = new Map<string, string>();
  for (const style of descendants(styles, 'style')) {
    const id = attr(style, 'styleId');
    const nameEl = kids(style, 'name')[0];
    const name = nameEl === undefined ? null : attr(nameEl, 'val');
    if (id !== null && name !== null) styleNames.set(id, styleKey(name));
  }
  const images = new Map<string, string>();
  if (rels !== null) {
    for (const rel of descendants(rels, 'Relationship')) {
      const id = attr(rel, 'Id');
      const target = attr(rel, 'Target');
      if (id === null || target === null || attr(rel, 'TargetMode') === 'External') continue;
      images.set(id, resolvePart('word/document.xml', target));
    }
  }

  const blocks: Block[] = [];
  let current: Block | null = null;
  const body = descendants(document, 'body')[0];
  if (body === undefined) return fail('bad_template');
  for (const p of descendants(body, 'p')) {
    const pStyle = descendants(p, 'pStyle')[0];
    const styleId = pStyle === undefined ? null : attr(pStyle, 'val');
    const key = styleId === null ? '' : (styleNames.get(styleId) ?? styleKey(styleId));
    if (key === 'heading2') {
      if (blocks.length >= maxRows || blocks.length + 2 > LAST_ROW_NO) return fail('row_limit');
      current = newBlock();
      blocks.push(current);
      continue;
    }
    if (current === null) continue;
    for (const blip of descendants(p, 'blip')) {
      current.blips.push({ embed: attr(blip, 'embed'), link: attr(blip, 'link') });
    }
    const docPr = descendants(p, 'docPr')[0];
    if (docPr !== undefined && current.docPrAlt === '') {
      current.docPrAlt = (attr(docPr, 'descr') ?? '').trim();
    }
    const text = paragraphText(p).trim();
    if (key === 'tracemeta') {
      for (const line of text.split('\n')) {
        const colon = line.indexOf(':');
        if (colon < 0) {
          if (line.trim() !== '') current.extraProblems.push({ field: 'row', code: 'bad_format' });
          continue;
        }
        const name = line.slice(0, colon).trim().toLowerCase();
        const known = DOCX_META_KEYS.find((k) => k === name);
        if (known === undefined) current.extraProblems.push({ field: 'row', code: 'bad_format' });
        else current.meta.set(known, line.slice(colon + 1).trim());
      }
    } else if (key === 'tracestem') {
      if (text !== '') current.stem.push(text);
    } else if (key === 'traceoption') {
      current.options.push(text);
    } else if (key === 'tracecorrect') {
      if (current.correct === '') current.correct = text;
    }
  }
  if (blocks.length === 0) return fail('no_rows');

  const rows: RawRow[] = blocks.map((block, index) => {
    const values = emptyValues();
    for (const [name, value] of block.meta) values[name] = value;
    values.stem = block.stem.join('\n');
    values.correct = block.correct;
    const extra = [...block.extraProblems];
    block.options.forEach((option, i) => {
      const column = OPTION_HEADERS[i];
      if (column === undefined) {
        if (!extra.some((e) => e.field === 'options')) {
          extra.push({ field: 'options', code: 'bad_options' });
        }
      } else {
        values[column] = option;
      }
    });
    if (values.image_alt === '') values.image_alt = block.docPrAlt;
    let inlineImage: RawRow['inlineImage'] = null;
    const [first, ...more] = block.blips;
    if (first !== undefined) {
      const target = first.embed === null ? undefined : images.get(first.embed);
      inlineImage = target === undefined ? { kind: 'unresolved' } : { kind: 'part', name: target };
      if (more.length > 0) extra.push({ field: 'image_file', code: 'bad_image_ref' });
    }
    return { rowNo: index + 2, values, extraProblems: extra, inlineImage };
  });
  return { ok: true, rows };
}
