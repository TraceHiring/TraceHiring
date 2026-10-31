// The fixed failure texts (specs/d1-demo-slice.md §6.2; specs/m1-test-authoring.md R5-69 f): the v2 publish refusals
// `pool_too_small` and `package_too_large` have their own plain-language sentence, never the generic one and never
// the server's text; an unknown code falls back to the generic sentence.
import { describe, expect, it } from 'vitest';
import { GENERIC_ERROR, errorText } from './messages';

describe('errorText', () => {
  it('explains a pool that is too small for its draw (R5-69 f)', () => {
    expect(errorText('pool_too_small')).toBe(
      'A pool has fewer approved items than its section draws. Add approved items to the pool, or draw fewer questions.',
    );
  });

  it('explains a test too large to publish (R5-69 f)', () => {
    expect(errorText('package_too_large')).toBe(
      'The test is too large to publish (at most 5,000 questions across its pools). Use smaller pools.',
    );
  });

  it('explains a refused integrity setting', () => {
    expect(errorText('setting_locked')).toBe(
      'An integrity setting is locked by an admin, or the integrity settings are not saved yet.',
    );
  });

  it('keeps the D1 texts and the generic fallback', () => {
    expect(errorText('conflict')).toBe('That change is no longer possible. Reload the page.');
    expect(errorText('not_a_code')).toBe(GENERIC_ERROR);
  });

  it('no text uses a word the recruiter guards ban', () => {
    for (const code of ['pool_too_small', 'package_too_large', 'setting_locked']) {
      expect(errorText(code)).not.toMatch(
        /\b(?:reject\w*|decline\w*|shortlist\w*|decision\w*|confirm\w*|overturn\w*|notice\w*|appeal\w*|overall|combined|total)\b/i,
      );
    }
  });
});
