import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalNoticeText, noticeSha256 } from './canonical-notice.js';

// The v1 notice seeded by migration 3 (private.seed_org); its template_sha256 is SHA-256 of these UTF-8 bytes.
const SEEDED =
  'Synthetic D1 candidate notice, version 1. This assessment records an Answer Quality score and, ' +
  'separately, integrity signals with evidence. No decision is made automatically. You may respond to any ' +
  'integrity flag before a decision is made.';

describe('canonicalNoticeText (AT-D8)', () => {
  it('leaves the seeded template unchanged, so the rendered hash equals the stored template hash', async () => {
    expect(canonicalNoticeText(SEEDED, {})).toBe(SEEDED);
    expect(await noticeSha256(canonicalNoticeText(SEEDED, {}))).toBe(
      createHash('sha256').update(SEEDED, 'utf8').digest('hex'),
    );
  });

  it('fills {{name}} placeholders and refuses a missing or an unused value', () => {
    expect(
      canonicalNoticeText('Test {{testTitle}} by {{orgName}}.', { testTitle: 'T', orgName: 'O' }),
    ).toBe('Test T by O.');
    expect(() => canonicalNoticeText('Test {{testTitle}}.', {})).toThrow();
    expect(() => canonicalNoticeText('Plain.', { orgName: 'O' })).toThrow();
  });

  it('does not re-expand a placeholder that appears inside a value', () => {
    expect(canonicalNoticeText('A {{a}} B {{b}}', { a: '{{b}}', b: 'x' })).toBe('A {{b}} B x');
  });

  it('normalises line endings, trailing spaces, trailing newlines and Unicode form', () => {
    expect(canonicalNoticeText('One  \r\nTwo\t\rThree\n\n\n', {})).toBe('One\nTwo\nThree');
    expect(canonicalNoticeText('Café', {})).toBe('Café');
  });

  it('gives the same text, and so the same hash, for equivalent inputs', async () => {
    const a = canonicalNoticeText('Line one\r\nLine two  \n', {});
    const b = canonicalNoticeText('Line one\nLine two', {});
    expect(a).toBe(b);
    expect(await noticeSha256(a)).toBe(await noticeSha256(b));
    expect(await noticeSha256(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
