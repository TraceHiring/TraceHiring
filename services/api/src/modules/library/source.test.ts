// LibrarySource over ApiDb (spec m1 R3-7, R5-57 b, AT-M1-22): only the verified viewer (sub, aal, amr) and the filters
// reach `private.library_browse` as bound values, the keyset's `created_at` text round-trips unchanged, and nothing
// but the card fields leaves (a stray key column is dropped; a row that does not fit is 503). Synthetic data only.
import { describe, expect, it } from 'vitest';
import { callerOf, ORG } from '../bank/a2a.test-helpers.js';
import type { ApiDb } from '../candidate/api-db.js';
import { OrgError } from '../tests/org-context.js';
import { cardsOf, libraryFromApiDb } from './source.js';

const V1 = 'c7000000-0000-4000-8000-000000000001';
const row = (patch: Record<string, unknown> = {}) => ({
  library_item_version_id: V1,
  format: 'mcq',
  skill_key: 'verbal',
  difficulty: '0.40',
  stem: '[synthetic] Library stem',
  options: ['One', 'Two'],
  is_parameterised: false,
  created_at: '2026-10-23T08:00:00.123456+00:00',
  ...patch,
});

describe('libraryFromApiDb', () => {
  it('binds the viewer and the filters, and keeps the created_at text', async () => {
    const seen: { text: string; params: readonly unknown[] }[] = [];
    const db: ApiDb = {
      withOrg: async (orgId, fn) => {
        expect(orgId).toBe(ORG);
        return fn({
          query: async <R extends object>(text: string, params: readonly unknown[] = []) => {
            seen.push({ text, params });
            return [row({ key: { option_id: 'a' } })] as unknown as R[];
          },
        });
      },
    };
    const caller = callerOf({ amr: ['otp'] });
    const after = { createdAt: '2026-10-23T07:00:00.000001+00:00', id: V1 };
    const out = await libraryFromApiDb(db).browse(caller, ORG, {
      skillKey: 'verbal',
      difficultyMax: 0.5,
      after,
      limit: 51,
    });
    expect(seen[0]?.text).toContain('private.library_browse(');
    expect(seen[0]?.params).toEqual([
      caller.userId,
      'aal1',
      '["otp"]',
      'verbal',
      null,
      null,
      0.5,
      after.createdAt,
      V1,
      51,
    ]);
    expect(out).toEqual([
      {
        card: {
          libraryItemVersionId: V1,
          format: 'mcq',
          skillKey: 'verbal',
          difficulty: 0.4,
          stem: '[synthetic] Library stem',
          options: ['One', 'Two'],
          isParameterised: false,
        },
        createdAt: '2026-10-23T08:00:00.123456+00:00',
      },
    ]);
  });

  it('answers 503 for a row that does not fit a card', () => {
    expect(() => cardsOf([row({ difficulty: '7' })])).toThrow(OrgError);
    expect(() => cardsOf([row({ format: 'written', options: null })])).not.toThrow();
  });
});
