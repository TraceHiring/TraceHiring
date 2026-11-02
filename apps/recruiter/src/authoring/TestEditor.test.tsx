// The editor's rendered form (specs/d1-demo-slice.md §6.1): mandatory cutoff field, no paste-policy control,
// at most 10 items, read-only once published, and the Q20 freeze copy in the publish dialog.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DraftFormView } from './DraftFormView';
import { addMcqItem, addWrittenItem, emptyDraft, type DraftForm } from './editor-model';
import { FREEZE_COPY, PublishDialog } from './TestEditorPage';

const noop = () => undefined;
const view = (form: DraftForm, readOnly = false) =>
  renderToString(<DraftFormView form={form} readOnly={readOnly} onChange={noop} />);
const plain = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('DraftFormView', () => {
  const out = view(emptyDraft('Synthetic test'));

  it('has a required cutoff field from 0 to 100 that starts at 40', () => {
    const input = /<input[^>]*min="0"[^>]*max="100"[^>]*>/.exec(out)?.[0] ?? '';
    expect(input).toContain('required');
    expect(input).toContain('value="40"');
    expect(plain(out)).toContain('Answer Quality cutoff (0 to 100)');
    expect(plain(out)).toContain('it cannot be cleared');
  });

  it('has one multiple choice section and one written section, and no paste-policy control', () => {
    expect(out).toContain('aria-label="Multiple choice section"');
    expect(out).toContain('aria-label="Written section"');
    expect(plain(out)).not.toMatch(/paste|clipboard|drop/i);
  });

  it('disables "Add question" at 10 items', () => {
    let form = emptyDraft('x');
    for (let i = 0; i < 10; i += 1) form = i % 2 === 0 ? addMcqItem(form) : addWrittenItem(form);
    const buttons = [...view(form).matchAll(/<button\b[^>]*>Add question<\/button>/g)].map(
      (m) => m[0],
    );
    expect(buttons).toHaveLength(2);
    for (const b of buttons) expect(b).toContain('disabled');
    const fewer = [...out.matchAll(/<button\b[^>]*>Add question<\/button>/g)].map((m) => m[0]);
    for (const b of fewer) expect(b).not.toContain('disabled');
  });

  it('is fully read-only once published: no add or remove controls, every input disabled', () => {
    let form = addMcqItem(emptyDraft('x'));
    form = addWrittenItem(form);
    const ro = view(form, true);
    expect(ro).not.toMatch(/>Add |>Remove /);
    for (const tag of ro.matchAll(/<(?:input|textarea)\b[^>]*>/g))
      expect(tag[0]).toContain('disabled');
  });
});

describe('PublishDialog', () => {
  it('shows the freeze copy with Publish and Cancel only', () => {
    const out = renderToString(<PublishDialog busy={false} onPublish={noop} onCancel={noop} />);
    expect(plain(out)).toContain(FREEZE_COPY);
    expect(FREEZE_COPY).toBe(
      'Settings freeze when you publish, including the cutoff; later changes create a new version',
    );
    const labels = [...out.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)].map((m) => m[1]);
    expect(labels).toEqual(['Publish test', 'Cancel']);
    expect(out).toContain('role="dialog"');
  });
});
