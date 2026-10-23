// The bank and library filter forms (specs/m1-test-authoring.md §6.2, BankItemListQuery): empty fields are left out,
// difficulties are decimal text 0 to 1, and a bad value is named before any request is made.
import { LibraryBrowseQuery } from '@trace/shared/contracts/m1';
import { describe, expect, it } from 'vitest';
import { cursorFor, uid } from './testing/fixtures.test-helpers';
import { EMPTY_FILTERS, bankQuery, libraryQuery } from './filters';

describe('bankQuery', () => {
  it('leaves out every empty field', () => {
    expect(bankQuery(EMPTY_FILTERS)).toEqual({ ok: true, query: {} });
  });

  it('carries each filled field as text and trims the skill', () => {
    const result = bankQuery({
      format: 'mcq',
      skillKey: ' quant ',
      difficultyMin: '0.2',
      difficultyMax: '0.8',
      status: 'in_review',
      origin: 'ai_draft',
      poolId: uid(5),
    });
    expect(result).toEqual({
      ok: true,
      query: {
        format: 'mcq',
        skillKey: 'quant',
        difficultyMin: '0.2',
        difficultyMax: '0.8',
        status: 'in_review',
        origin: 'ai_draft',
        poolId: uid(5),
      },
    });
  });

  it('adds the cursor when given one', () => {
    const result = bankQuery(EMPTY_FILTERS, cursorFor(3));
    expect(result).toEqual({ ok: true, query: { cursor: cursorFor(3) } });
  });

  it.each([
    ['difficultyMin', '1.5', 'Difficulty must be a number from 0 to 1.'],
    ['difficultyMax', 'abc', 'Difficulty must be a number from 0 to 1.'],
    ['skillKey', 'Not A Key', 'A skill is lower-case letters, digits and underscores.'],
    ['poolId', 'not-an-id', 'A pool id looks like 00000000-0000-4000-8000-000000000001.'],
  ] as const)('refuses a bad %s (%s) with a fixed sentence', (field, value, message) => {
    expect(bankQuery({ ...EMPTY_FILTERS, [field]: value })).toEqual({ ok: false, message });
  });

  it('refuses a minimum above the maximum', () => {
    expect(bankQuery({ ...EMPTY_FILTERS, difficultyMin: '0.9', difficultyMax: '0.1' })).toEqual({
      ok: false,
      message: 'The minimum difficulty cannot be above the maximum.',
    });
  });
});

describe('libraryQuery', () => {
  it('builds only the fields the library accepts and passes its contract', () => {
    const result = libraryQuery({ ...EMPTY_FILTERS, skillKey: 'verbal', format: 'mcq' });
    expect(result).toEqual({ ok: true, query: { skillKey: 'verbal', format: 'mcq' } });
    if (result.ok) expect(LibraryBrowseQuery.safeParse(result.query).success).toBe(true);
  });

  it('drops status, origin and pool, which the library has no filter for', () => {
    const result = libraryQuery({
      ...EMPTY_FILTERS,
      status: 'approved',
      origin: 'human',
      poolId: uid(1),
    });
    expect(result).toEqual({ ok: true, query: {} });
  });
});
