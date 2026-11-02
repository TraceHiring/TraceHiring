// SEC-7 (lead decision): the answer textarea turns the browser's spell check off, so answer text is never offered to
// a browser vendor's enhanced (server-side) spelling service; autocomplete is off too. maxLength is the item's limit.
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnswerEditor } from './AnswerEditor';

describe('AnswerEditor', () => {
  const html = renderToString(
    <AnswerEditor value="draft" maxChars={2000} disabled={false} onChange={() => undefined} />,
  );
  const textarea = /<textarea[^>]*>/.exec(html)?.[0] ?? '';

  it('has spell check and autocomplete off (SEC-7)', () => {
    expect(textarea).toMatch(/\sspellCheck="false"|\sspellcheck="false"/);
    expect(textarea).toMatch(/\sautoComplete="off"|\sautocomplete="off"/);
  });

  it('is labelled, limited to maxChars and described by its character count', () => {
    expect(textarea).toMatch(/\smaxLength="2000"|\smaxlength="2000"/);
    const id = /\sid="([^"]+)"/.exec(textarea)?.[1];
    expect(html).toContain(`for="${id}"`);
    expect(html).toContain('5 of 2000 characters');
  });
});
