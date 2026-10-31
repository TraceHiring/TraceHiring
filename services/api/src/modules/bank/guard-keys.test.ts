// The A2a guard refusals and their answers (A2b re-review Note 4; spec m1 §5, §6.11): each M1-a/M1-c guard text below
// was mapped to a key in org-context.ts but still fell through to 404. A state refusal is 409 `conflict`; a permission
// refusal of a request the caller may see is 403 `forbidden`. The guard text is never returned.
import { describe, expect, it } from 'vitest';
import {
  guardKeyOf,
  handleOrg,
  pathId,
  RestError,
  restErrorCode,
  type GuardKey,
} from '../tests/org-context.js';

const CASES: [text: string, key: GuardKey, code: string, status: number][] = [
  ['an item version is frozen once it leaves draft', 'item_frozen', 'conflict', 409],
  ['the item version is frozen', 'item_frozen', 'conflict', 409],
  ['item status change not allowed', 'item_status_change', 'conflict', 409],
  ['an approver role in the item workspace is required', 'approver_required', 'forbidden', 403],
  ['an archived pool takes no items', 'pool_archived', 'conflict', 409],
  ['the import job is not open', 'import_not_open', 'conflict', 409],
  ['only approved library items can be copied', 'library_not_approved', 'conflict', 409],
  // A2a database review D5 (R5-64 b): readiness refusals of submit and approve are a draft that is not complete.
  ['a multiple-choice item needs its answer key', 'mcq_key_missing', 'draft_incomplete', 422],
  ['a written item needs its rubric', 'rubric_missing', 'draft_incomplete', 422],
  ['a parameterised item needs its variants', 'variants_missing', 'draft_incomplete', 422],
  ['every variant needs its answer key', 'variant_key_missing', 'draft_incomplete', 422],
  ['variants are numbered 1 to n', 'variants_numbering', 'draft_incomplete', 422],
  ['a pool holds approved bank items of its format', 'pool_item_ineligible', 'conflict', 409],
  // R5-64 h: the library expert review (ABH-6, SEC-M1-4).
  [
    'a library item needs a reviewer and a key reviewer other than its author',
    'library_reviewers',
    'conflict',
    409,
  ],
  ['the key review is recorded in its own update', 'key_review_own_update', 'conflict', 409],
  ['a library item is approved by an expert review', 'library_expert_review', 'conflict', 409],
  ['the key reviewer is an active library member', 'key_reviewer_member', 'forbidden', 403],
  ['the key reviewer records their own review', 'key_reviewer_self', 'forbidden', 403],
  // Spec review Note 6: a settled invite is a state refusal, never a 404.
  ['a settled invite is final', 'invite_settled', 'conflict', 409],
  // R5-71 (R5-70 re-review Low 1): D1's shape re-checked inside save_test_draft under its row lock.
  ['the draft has sections the D1 editor cannot save', 'd1_shape', 'conflict', 409],
];

describe('A2a guard keys', () => {
  for (const [text, key, code, status] of CASES) {
    it(`${key}: '${text}' answers ${String(status)} ${code}`, async () => {
      expect(guardKeyOf(`TRACE_GUARD: ${text}`)).toBe(key);
      const err = new RestError(403, '42501', guardKeyOf(`TRACE_GUARD: ${text}`));
      expect(restErrorCode(err)).toBe(code);
      const res = await handleOrg(async () => {
        throw err;
      });
      expect(res.status).toBe(status);
      const body = await res.text();
      expect(body).toBe(`{"error":{"code":"${code}"}}`);
      expect(body).not.toContain(text);
    });
  }

  it('pathId lower-cases a path uuid (A2a security S1, R5-64 n) and still refuses a malformed one', async () => {
    expect(pathId('A1000000-0000-4000-8000-00000000000F')).toBe(
      'a1000000-0000-4000-8000-00000000000f',
    );
    expect(pathId('a1000000-0000-4000-8000-00000000000f')).toBe(
      'a1000000-0000-4000-8000-00000000000f',
    );
    const res = await handleOrg(async () => {
      pathId('not-a-uuid');
      return new Response(null, { status: 204 });
    });
    expect(res.status).toBe(404);
  });

  it('an unknown guard text still answers 404 (nothing widened)', () => {
    expect(restErrorCode(new RestError(403, '42501', 'other'))).toBe('not_found');
  });
});
