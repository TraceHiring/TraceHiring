// @vitest-environment happy-dom
// X3 (security review): the docx reader handles each paragraph's own content once. Deeply nested paragraphs with many
// runs must not cost depth times nodes: a few hundred levels of w:p around twenty thousand runs reads in a fixed budget.
import { strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readDocxRows } from './docx';
import type { XmlPart } from './protocol';

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const styles = (): XmlPart => ({
  name: 'word/styles.xml',
  text: text(
    strToU8(
      `<w:styles ${NS}>` +
        [
          ['Heading2', 'heading 2'],
          ['TraceStem', 'Trace Stem'],
          ['TraceOption', 'Trace Option'],
          ['TraceCorrect', 'Trace Correct'],
          ['TraceMeta', 'Trace Meta'],
        ]
          .map(
            ([id, name]) =>
              `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/></w:style>`,
          )
          .join('') +
        '</w:styles>',
    ),
  ),
});
const document = (body: string): XmlPart => ({
  name: 'word/document.xml',
  text: `<w:document ${NS}><w:body>${body}</w:body></w:document>`,
});
const para = (style: string, inner: string) =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${inner}</w:p>`;
const run = (t: string) => `<w:r><w:t>${t}</w:t></w:r>`;

describe('readDocxRows with nested paragraphs (X3)', () => {
  it('reads 200 levels of nested paragraphs around 20,000 runs within the budget', () => {
    const depth = 200;
    const runs = run('x').repeat(20_000);
    const nested = `${'<w:p>'.repeat(depth)}${runs}${'</w:p>'.repeat(depth)}`;
    const body =
      para('Heading2', run('item')) +
      para('TraceMeta', run('format: written')) +
      para('TraceStem', run('A stem')) +
      nested;
    const started = performance.now();
    const outcome = readDocxRows([styles(), document(body)], 2000);
    const spent = performance.now() - started;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.values.stem).toBe('A stem');
    // About 0.4 s alone and 2.3 s on a loaded CI runner; the quadratic walk took about 16 s. 8 s keeps that apart.
    expect(spent).toBeLessThan(8000);
  });

  it('gives a nested paragraph its own text and leaves the outer text as it was', () => {
    const body =
      para('Heading2', run('item')) +
      `<w:p><w:pPr><w:pStyle w:val="TraceStem"/></w:pPr>${run('outer')}<w:r><w:pict><w:p>${run('inside')}</w:p></w:pict></w:r></w:p>`;
    const outcome = readDocxRows([styles(), document(body)], 2000);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rows[0]?.values.stem).toBe('outer');
  });
});
