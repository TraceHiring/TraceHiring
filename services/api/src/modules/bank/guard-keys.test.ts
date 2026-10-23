// The A2a guard refusals and their answers (A2b re-review Note 4; spec m1 §5, §6.11): each M1-a/M1-c guard text below
// was mapped to a key in org-context.ts but still fell through to 404. A state refusal is 409 `conflict`; a permission
// refusal of a request the caller may see is 403 `forbidden`. The guard text is never returned.
import { describe, expect, it } from 'vitest';
import {
  guardKeyOf,
  handleOrg,
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

  it('an unknown guard text still answers 404 (nothing widened)', () => {
    expect(restErrorCode(new RestError(403, '42501', 'other'))).toBe('not_found');
  });
});
