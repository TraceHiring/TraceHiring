// The §6.4 output checks of the AI drafting job (specs/m1-test-authoring.md §6.4, §7 E20, R5-56 e): zod shape, readability,
// placeholders, exact and near duplicates, the room cap, and written drafts discarded (no rubric yet). Synthetic text only.
import { MockLlmDrafter } from '@trace/vendors';
import { describe, expect, it } from 'vitest';
import {
  DRAFT_LIMITS,
  contentCheck,
  fleschReadingEase,
  jaccard,
  normaliseText,
  parseDraftedItem,
  screenDrafts,
  shingles,
} from './checks.js';

const STEM =
  '[synthetic] Case 101. A small team has 4 tasks and 3 days left. Which plan is the best choice?';
const mcq = (patch: Record<string, unknown> = {}) => ({
  format: 'mcq',
  stem: STEM,
  options: [
    { id: 'a', text: 'Do the most urgent task first' },
    { id: 'b', text: 'Wait until the last day to start' },
    { id: 'c', text: 'Ignore the deadline' },
  ],
  correctOptionId: 'a',
  ...patch,
});

describe('parseDraftedItem (zod, E20)', () => {
  it('accepts a well-formed mcq and written draft', () => {
    expect(parseDraftedItem(mcq())).not.toBeNull();
    expect(parseDraftedItem({ format: 'written', stem: STEM })).not.toBeNull();
  });

  it.each([
    ['not an object', 'text'],
    ['null', null],
    ['an unknown format', { ...mcq(), format: 'essay' }],
    ['an extra field', { ...mcq(), approved: true }],
    ['a key outside its options', mcq({ correctOptionId: 'z' })],
    ['one option', mcq({ options: [{ id: 'a', text: 'Only' }] })],
    [
      'seven options',
      mcq({ options: Array.from({ length: 7 }, (_, i) => ({ id: `o${i}`, text: `Option ${i}` })) }),
    ],
    [
      'duplicate option ids',
      mcq({
        options: [
          { id: 'a', text: 'One' },
          { id: 'a', text: 'Two' },
        ],
      }),
    ],
    [
      'an option id over 64 chars',
      mcq({
        options: [
          { id: 'x'.repeat(65), text: 'One' },
          { id: 'b', text: 'Two' },
        ],
      }),
    ],
    ['a written draft with options', { format: 'written', stem: STEM, options: [] }],
    ['a stem that is not text', { format: 'written', stem: 42 }],
  ])('rejects %s', (_label, raw) => {
    expect(parseDraftedItem(raw)).toBeNull();
  });
});

describe('contentCheck (readability and placeholders, §6.4)', () => {
  const ok = parseDraftedItem(mcq());

  it('passes a plain synthetic draft', () => {
    expect(ok).not.toBeNull();
    expect(contentCheck(ok!)).toBeNull();
  });

  it('refuses a stem under 20 or over 1,200 characters', () => {
    expect(contentCheck(parseDraftedItem(mcq({ stem: 'Too short a stem.' }))!)).toBe('stem_length');
    const long = `${'A cat sat on a mat. '.repeat(61)}`.trim();
    expect(long.length).toBeGreaterThan(DRAFT_LIMITS.stemMax);
    expect(contentCheck(parseDraftedItem(mcq({ stem: long }))!)).toBe('stem_length');
  });

  it('refuses an option over 200 characters or a blank option', () => {
    const longOpt = mcq({
      options: [
        { id: 'a', text: 'x '.repeat(101) },
        { id: 'b', text: 'Two' },
      ],
    });
    expect(contentCheck(parseDraftedItem(longOpt)!)).toBe('option_length');
    const blank = mcq({
      options: [
        { id: 'a', text: '   ' },
        { id: 'b', text: 'Two' },
      ],
    });
    expect(contentCheck(parseDraftedItem(blank)!)).toBe('option_length');
  });

  it('refuses an option equal to the stem (after normalising)', () => {
    const same = mcq({
      options: [
        { id: 'a', text: STEM.toUpperCase().replace(/ /g, '  ') },
        { id: 'b', text: 'Two' },
      ],
    });
    expect(contentCheck(parseDraftedItem(same)!)).toBe('option_equals_stem');
  });

  it('refuses a candidate-facing placeholder in the stem or an option', () => {
    expect(contentCheck(parseDraftedItem(mcq({ stem: `${STEM} {{name}}` }))!)).toBe('placeholder');
    const opt = mcq({
      options: [
        { id: 'a', text: 'Pick {{x}}' },
        { id: 'b', text: 'Two' },
      ],
    });
    expect(contentCheck(parseDraftedItem(opt)!)).toBe('placeholder');
  });

  it('refuses text under Flesch reading ease 30', () => {
    const dense =
      'Organisational interdependencies notwithstanding, institutional accountability considerations necessitate comprehensive prioritisation methodologies.';
    expect(fleschReadingEase(dense)).toBeLessThan(DRAFT_LIMITS.fleschMin);
    expect(contentCheck(parseDraftedItem(mcq({ stem: dense }))!)).toBe('readability');
  });
});

describe('text helpers', () => {
  it('normaliseText lowercases and collapses ASCII whitespace', () => {
    expect(normaliseText('  A  b\t\nC  ')).toBe('a b c');
  });

  it('fleschReadingEase is high for short plain words', () => {
    expect(fleschReadingEase('The cat sat on the mat. It was a good day.')).toBeGreaterThan(90);
  });

  it('shingles are word 5-grams; short text is one shingle', () => {
    expect(shingles('one two three four five six').size).toBe(2);
    expect(shingles('one two three').size).toBe(1);
    expect(jaccard(shingles('a b c d e f g'), shingles('a b c d e f g'))).toBe(1);
    expect(jaccard(shingles('a b c d e'), shingles('v w x y z'))).toBe(0);
  });
});

describe('screenDrafts (duplicates, room, written discard)', () => {
  const base = { format: 'mcq' as const, existing: new Set<string>(), approved: [], room: 10 };

  it('accepts distinct passing drafts in order and counts nothing discarded', () => {
    const r = screenDrafts([mcq(), mcq({ stem: `${STEM} Say why.`.replace('101', '202') })], base);
    expect(r.accepted).toHaveLength(2);
    expect(r.discarded).toBe(0);
  });

  it('discards malformed, wrong-format and failing drafts and counts them (E20)', () => {
    const r = screenDrafts(
      [{ junk: true }, { format: 'written', stem: STEM }, mcq({ stem: 'short' }), mcq()],
      base,
    );
    expect(r.accepted).toHaveLength(1);
    expect(r.discarded).toBe(3);
  });

  it('discards an exact duplicate of an org version or of an earlier draft in the batch', () => {
    const r1 = screenDrafts([mcq()], { ...base, existing: new Set([normaliseText(STEM)]) });
    expect(r1.accepted).toHaveLength(0);
    expect(r1.discarded).toBe(1);
    const r2 = screenDrafts([mcq(), mcq({ stem: `  ${STEM.toLowerCase()} ` })], base);
    expect(r2.accepted).toHaveLength(1);
    expect(r2.discarded).toBe(1);
  });

  it('discards a near duplicate (5-shingle Jaccard >= 0.8) of an approved item of the skill', () => {
    const near = `${STEM} Now.`;
    expect(jaccard(shingles(near), shingles(STEM))).toBeGreaterThanOrEqual(0.8);
    const r = screenDrafts([mcq({ stem: near })], { ...base, approved: [STEM] });
    expect(r.accepted).toHaveLength(0);
    expect(r.discarded).toBe(1);
  });

  it('compares each draft with at most 2,000 approved items', () => {
    const approved = [
      ...Array.from({ length: 2000 }, (_, i) => `Other text number ${i} here ok`),
      STEM,
    ];
    const r = screenDrafts([mcq()], { ...base, approved });
    expect(r.accepted).toHaveLength(1);
  });

  it('stops at the room left: drafts past the cap are neither stored nor counted', () => {
    const r = screenDrafts(
      [mcq(), mcq({ stem: STEM.replace('101', '303') }), mcq({ stem: STEM.replace('101', '404') })],
      { ...base, room: 2 },
    );
    expect(r.accepted).toHaveLength(2);
    expect(r.discarded).toBe(0);
  });

  it('R5-56 e: discards every written draft (no rubric can be stored by the job)', () => {
    const r = screenDrafts(
      [
        { format: 'written', stem: STEM },
        { format: 'written', stem: STEM.replace('101', '202') },
      ],
      { ...base, format: 'written' },
    );
    expect(r.accepted).toHaveLength(0);
    expect(r.discarded).toBe(2);
  });

  it('every MockLlmDrafter mcq item passes the checks at each difficulty', async () => {
    for (const difficulty of [0, 0.5, 0.9, 1]) {
      for (const seed of [1, 7, 123456789]) {
        const out = await new MockLlmDrafter('dev', { seed }).draft({
          format: 'mcq',
          skill: 'logical',
          difficulty,
          count: 10,
          topic: '[synthetic]',
        });
        const r = screenDrafts(out.items, base);
        expect(r.discarded).toBe(0);
        expect(r.accepted).toHaveLength(10);
      }
    }
  });
});
