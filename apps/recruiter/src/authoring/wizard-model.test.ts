// Which editor a draft gets (specs/m1-test-authoring.md R5-69 b): a draft is D1-shaped iff D1's editor can save it
// unchanged and its integrity settings are not stored; otherwise it is a v2 draft. A D1-shaped draft is never turned
// into a v2 one by loading it: the v2 form gets the integrity values only when they are stored. Inline items convert
// between the save request's shape and D1's item form (R5-69 d). Synthetic data only.
import {
  INTEGRITY_CATALOG_VERSION,
  IntegritySettingsView,
  TestDraftView,
} from '@trace/shared/contracts/m1';
import { renderCandidateSummary } from '@trace/shared';
import { describe, expect, it } from 'vitest';
import { INTEGRITY_PRESETS } from '../settings/integrity-model';
import { isPackageV2, toSaveTestDraftRequest } from './editor-v2-model';
import {
  draftItemOf,
  inlineItemCount,
  integrityStored,
  isD1Shaped,
  itemFormOf,
  v2FormOf,
} from './wizard-model';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AT = '2026-10-23T10:00:00.000Z';

const mcq = {
  id: ID(20),
  position: 1,
  format: 'mcq' as const,
  prompt: 'Synthetic question?',
  options: [
    { id: 'a', text: 'First' },
    { id: 'b', text: 'Second' },
  ],
  correctOptionId: 'b',
};
const written = {
  id: ID(21),
  position: 1,
  format: 'written' as const,
  prompt: 'Describe a synthetic situation.',
  rubric: {
    criteria: [
      { id: 'c1', label: 'Clarity', maxPoints: 10, anchors: ['clear steps', 'order'], minHits: 1 },
    ],
  },
};
const d1Sections = [
  {
    id: ID(10),
    position: 1,
    mode: 'inline',
    format: 'mcq',
    name: 'Multiple choice',
    weight: 40,
    items: [mcq],
    shuffleItems: false,
    shuffleOptions: false,
    navigation: null,
  },
  {
    id: ID(11),
    position: 2,
    mode: 'inline',
    format: 'written',
    name: 'Written answers',
    weight: 60,
    items: [written],
    shuffleItems: false,
    shuffleOptions: false,
    navigation: null,
  },
];
const view = (sections: unknown[]) =>
  TestDraftView.parse({
    test: { id: ID(1), workspaceId: ID(2), name: 'Synthetic test', createdAt: AT },
    version: {
      id: ID(3),
      versionNo: 1,
      status: 'draft',
      durationMinutes: 30,
      qualityCutoff: 40,
      publishedAt: null,
      sections,
    },
  });
const integrity = (
  presetKey: 'standard' | 'strict' | null,
  values = presetKey === 'strict' ? INTEGRITY_PRESETS.strict : INTEGRITY_PRESETS.standard,
) =>
  IntegritySettingsView.parse({
    presetKey,
    values,
    locked: {
      integrity_review_scope: 'always',
      accommodations: 'always',
      id_verification: 'always',
    },
    candidateSummary: renderCandidateSummary(values, INTEGRITY_CATALOG_VERSION).lines,
  });
/** The api's answer for a draft without stored settings: D1's equivalent values, preset null. */
const unstored = integrity(null, { ...INTEGRITY_PRESETS.standard, paste_written: 'blocked' });

const withSettings = d1Sections.map((s) =>
  s.format === 'mcq'
    ? { ...s, navigation: 'free' }
    : { ...s, navigation: 'forward_only', pasteRule: 'allowed_logged' },
);
const poolSection = {
  id: ID(12),
  position: 3,
  mode: 'pool',
  format: 'mcq',
  name: 'Verbal',
  weight: 10,
  items: [],
  poolId: ID(50),
  drawCount: 10,
  shuffleItems: false,
  shuffleOptions: false,
  navigation: 'free',
};

describe('integrityStored and isD1Shaped (R5-69 b)', () => {
  it('a D1 draft whose settings are not stored is D1-shaped', () => {
    expect(integrityStored(view(d1Sections), unstored)).toBe(false);
    expect(isD1Shaped(view(d1Sections), unstored)).toBe(true);
    // The integrity read failed: the sections alone decide.
    expect(isD1Shaped(view(d1Sections), null)).toBe(true);
    expect(isD1Shaped(view([]), unstored)).toBe(true);
  });

  it('a named preset is stored: the draft is v2 even with D1 sections', () => {
    expect(integrityStored(view(d1Sections), integrity('standard'))).toBe(true);
    expect(isD1Shaped(view(d1Sections), integrity('standard'))).toBe(false);
  });

  it('custom settings (preset null) are told apart by the sections the api rewrote when they were saved', () => {
    // PUT …/integrity gives every section a navigation and every written one the paste rule (R5-63 b, DB-M1-1).
    expect(integrityStored(view(withSettings), integrity(null))).toBe(true);
    expect(isD1Shaped(view(withSettings), integrity(null))).toBe(false);
    expect(isD1Shaped(view(withSettings), null)).toBe(false);
  });

  it('any section D1 cannot save makes a v2 draft', () => {
    expect(isD1Shaped(view([...d1Sections, poolSection]), unstored)).toBe(false);
  });
});

describe('v2FormOf (R5-69 b: never saved as v2 by merely loading it)', () => {
  it('passes the integrity values only when they are stored', () => {
    const d1 = v2FormOf(view(d1Sections), unstored);
    expect(d1.pasteWritten).toBeNull();
    expect(isPackageV2(d1)).toBe(false);
    const built = toSaveTestDraftRequest(d1);
    expect(built.ok && built.request.sections.map((s) => s.navigation)).toEqual([null, null]);

    const stored = v2FormOf(view(d1Sections), integrity('strict'));
    expect(stored.pasteWritten).toBe('blocked');
    expect(isPackageV2(stored)).toBe(true);
    const custom = v2FormOf(view(withSettings), integrity(null, INTEGRITY_PRESETS.standard));
    expect(custom.pasteWritten).toBe('allowed_logged');
  });
});

describe('inline items in D1 form (R5-69 d)', () => {
  it('round-trips an mcq and a written item', () => {
    const mcqItem = {
      format: mcq.format,
      prompt: mcq.prompt,
      options: mcq.options,
      correctOptionId: mcq.correctOptionId,
    };
    const writtenItem = { format: written.format, prompt: written.prompt, rubric: written.rubric };
    expect(draftItemOf(itemFormOf(mcqItem))).toEqual(mcqItem);
    expect(draftItemOf(itemFormOf(writtenItem))).toEqual(writtenItem);
    expect(itemFormOf(writtenItem)).toMatchObject({
      format: 'written',
      criteria: [{ id: 'c1', maxPoints: '10', anchors: 'clear steps, order', minHits: '1' }],
    });
  });

  it('trims text and drops empty anchors, as D1 does', () => {
    expect(
      draftItemOf({
        format: 'written',
        prompt: '  Describe.  ',
        criteria: [{ id: 'c1', label: ' L ', maxPoints: '5', anchors: 'a, , b,', minHits: '2' }],
      }),
    ).toEqual({
      format: 'written',
      prompt: 'Describe.',
      rubric: {
        criteria: [{ id: 'c1', label: 'L', maxPoints: 5, anchors: ['a', 'b'], minHits: 2 }],
      },
    });
  });

  it('counts the inline items of the whole test (D1 limit: 10 in all)', () => {
    expect(inlineItemCount(v2FormOf(view(d1Sections), unstored))).toBe(2);
  });
});
