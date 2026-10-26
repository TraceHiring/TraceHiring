// M1 authoring contracts (specs/m1-test-authoring.md §5, §4.3-§4.5, §6.6; R5-22, R5-29). Synthetic values only.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as M1 from './contracts-m1.js';
import {
  AiDraftJobStatus,
  AiDraftJobView,
  AiDraftRequest,
  ALWAYS_LOCKED_SETTINGS,
  ApproveItemRequest,
  BankItemDetail,
  BankItemDraft,
  BankItemSummary,
  BlueprintProposal,
  BlueprintProposeRequest,
  BlueprintProposeResponse,
  CreateTestFromTemplateRequest,
  Difficulty,
  IMPORT_ERROR_CODES,
  ImportErrorCode,
  ImportImagePutResponse,
  ImportJobCreateRequest,
  ImportJobStatus,
  ImportRow,
  ImportRowsRequest,
  ImportRowsResponse,
  INTEGRITY_CATALOG_VERSION,
  INTEGRITY_SETTING_VALUES,
  IntegritySettingsRequest,
  IntegritySettingsView,
  ItemMedia,
  ItemOrigin,
  ItemStatus,
  LibraryBrowseQuery,
  LibraryItemCard,
  MemberInviteRequest,
  MemberInviteStatus,
  ParamSpec,
  PoolDetail,
  PoolRequest,
  PresetKey,
  RoleTemplateSummary,
  SaveTestDraftRequest,
  SectionDraft,
  SettingKey,
  SkillKey,
} from './contracts-m1.js';
import {
  allObjectsStrict,
  keysMatching,
  schemaKeys,
  schemaNodes,
} from './contracts-schema-walk.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = '2026-10-23T10:00:00.000Z';
const HEX = 'b'.repeat(64);
const ok = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;

// ---- Database value lists (supabase/migrations/20261023010000_m1_bank.sql; spec §3.2, §4.3-§4.5, §6.6) ------------

describe('value lists match the database', () => {
  it('ItemStatus is public.item_status: not_approved, never rejected (R5-22)', () => {
    expect(ItemStatus.options).toEqual([
      'draft',
      'in_review',
      'approved',
      'not_approved',
      'retired',
    ]);
    expect(ok(ItemStatus, 'rejected')).toBe(false);
  });
  it('ItemOrigin is the item_versions.origin CHECK (R5-28)', () => {
    expect(ItemOrigin.options).toEqual(['human', 'import', 'ai_draft', 'library']);
    expect(ok(ItemOrigin, 'ai')).toBe(false);
  });
  it('import, ai-draft and invite statuses are the table CHECKs', () => {
    expect(ImportJobStatus.options).toEqual([
      'open',
      'validating',
      'completed',
      'cancelled',
      'failed',
    ]);
    expect(AiDraftJobStatus.options).toEqual(['queued', 'running', 'completed', 'failed']);
    expect(MemberInviteStatus.options).toEqual(['pending', 'provisioned', 'failed', 'cancelled']);
  });
  it('import error codes are exactly the §4.3 list', () => {
    expect([...IMPORT_ERROR_CODES]).toEqual([
      'missing_field',
      'bad_format',
      'bad_skill',
      'bad_difficulty',
      'bad_options',
      'bad_key',
      'too_long',
      'bad_image_ref',
      'image_missing',
      'image_too_large',
      'image_bad_type',
      'duplicate_in_file',
      'duplicate_in_bank',
      'bad_param_spec',
      'variant_generation_failed',
      'row_limit',
    ]);
    expect(ok(ImportErrorCode, 'bad_cell')).toBe(false);
  });
  it('the settings catalog is m1-settings-v1 with the 13 §6.6 settings and their values', () => {
    expect(INTEGRITY_CATALOG_VERSION).toBe('m1-settings-v1');
    // The same string rls_m1_settings pins for integrity_setting_defs (key|allowed values), sorted by key.
    const rows = Object.entries(INTEGRITY_SETTING_VALUES)
      .map(([key, values]) => `${key}|{${values.join(',')}}`)
      .sort()
      .join('; ');
    expect(rows).toBe(
      'accommodations|{on}; burst_after_tab|{on,off}; calibration_warmup|{on,off}; ' +
        'camera_face_presence|{on,off}; explain_probe|{on,off}; ' +
        'fullscreen_tab_focus|{off,warn_first,on}; id_verification|{off}; ' +
        'integrity_review_scope|{shortlist_only}; mic_speech_presence|{on,off}; ' +
        'paste_written|{blocked,allowed_logged}; question_copy|{on,off}; single_screen|{on,off}; ' +
        'typing_provenance|{on,off}',
    );
    expect([...ALWAYS_LOCKED_SETTINGS].sort()).toEqual([
      'accommodations',
      'id_verification',
      'integrity_review_scope',
    ]);
    expect([...SettingKey.options].sort()).toEqual(Object.keys(INTEGRITY_SETTING_VALUES).sort());
    expect(PresetKey.options).toEqual(['strict', 'standard', 'open_book']);
  });
});

// ---- Scalars ---------------------------------------------------------------------------------------------------

describe('SkillKey and Difficulty', () => {
  it('SkillKey is lower snake case, 2-41 characters', () => {
    for (const good of ['quant', 'customer_service_sjt', 'a1', `a${'b'.repeat(40)}`]) {
      expect(ok(SkillKey, good), good).toBe(true);
    }
    for (const bad of ['a', 'Quant', '1quant', 'quant-x', `a${'b'.repeat(41)}`, '']) {
      expect(ok(SkillKey, bad), bad).toBe(false);
    }
  });
  it('Difficulty is a multiple of 0.01 from 0 to 1', () => {
    for (let n = 0; n <= 100; n += 1) expect(ok(Difficulty, n / 100), String(n)).toBe(true);
    for (const bad of [-0.01, 1.01, 0.075, 0.333, Number.NaN, '0.5']) {
      expect(ok(Difficulty, bad), String(bad)).toBe(false);
    }
  });
  it('ItemMedia is a content-addressed key and a required alt text', () => {
    const media = { key: `item-media/${id(1)}/${HEX}.png`, alt: 'A bar chart' };
    expect(ItemMedia.parse(media)).toEqual(media);
    expect(ok(ItemMedia, { ...media, key: `item-media/${id(1)}/${HEX}.webp` })).toBe(true);
    expect(ok(ItemMedia, { ...media, key: `item-media/${id(1)}/${HEX}.gif` })).toBe(false);
    expect(ok(ItemMedia, { ...media, key: `item-media/${id(1)}/${HEX}.png?x=1` })).toBe(false);
    expect(ok(ItemMedia, { ...media, key: `other/${id(1)}/${HEX}.png` })).toBe(false);
    expect(ok(ItemMedia, { ...media, alt: '' })).toBe(false);
    expect(ok(ItemMedia, { ...media, alt: 'a'.repeat(301) })).toBe(false);
    expect(ok(ItemMedia, { key: media.key })).toBe(false);
  });
});

// ---- Parameterised variants (§6.3) -----------------------------------------------------------------------------

const paramSpec = {
  params: {
    a: { kind: 'int', min: 2, max: 9, step: 1 },
    unit: { kind: 'choice', values: ['kg', 'g'] },
  },
  derived: { total: 'a * 2' },
  constraints: ['a > 1'],
  stem: '[synthetic] What is {{a}} doubled, in {{unit}}?',
  options: [
    { id: 'a', text: '{{total}}' },
    { id: 'b', text: '{{a}}' },
  ],
  correctOptionId: 'a',
  count: 5,
};

describe('ParamSpec', () => {
  it('accepts a valid spec', () => {
    expect(ParamSpec.parse(paramSpec)).toEqual(paramSpec);
    expect(ok(ParamSpec, { ...paramSpec, derived: {}, constraints: [] })).toBe(true);
  });
  it.each([
    ['no params', { params: {} }],
    [
      '9 params',
      {
        params: Object.fromEntries(
          Array.from({ length: 9 }, (_v, i) => [`p${i}`, { kind: 'int', min: 0, max: 1, step: 1 }]),
        ),
      },
    ],
    ['a bad param name', { params: { A: { kind: 'int', min: 0, max: 1, step: 1 } } }],
    ['min above max', { params: { a: { kind: 'int', min: 3, max: 2, step: 1 } } }],
    ['step 0', { params: { a: { kind: 'int', min: 0, max: 2, step: 0 } } }],
    ['a decimal bound', { params: { a: { kind: 'int', min: 0.5, max: 2, step: 1 } } }],
    ['an empty choice', { params: { a: { kind: 'choice', values: [] } } }],
    [
      '21 choices',
      { params: { a: { kind: 'choice', values: Array.from({ length: 21 }, (_v, i) => i) } } },
    ],
    ['an unknown param kind', { params: { a: { kind: 'float', min: 0, max: 1 } } }],
    [
      '9 derived values',
      { derived: Object.fromEntries(Array.from({ length: 9 }, (_v, i) => [`d${i}`, '1'])) },
    ],
    ['a derived name equal to a param', { derived: { a: '1' } }],
    ['an expression over 200', { constraints: ['1'.repeat(201)] }],
    ['9 constraints', { constraints: Array.from({ length: 9 }, () => 'a > 1') }],
    ['a stem over 4000', { stem: 's'.repeat(4001) }],
    ['one option', { options: [{ id: 'a', text: 'x' }] }],
    [
      'duplicate option ids',
      {
        options: [
          { id: 'a', text: 'x' },
          { id: 'a', text: 'y' },
        ],
      },
    ],
    ['a key outside the options', { correctOptionId: 'z' }],
    ['count 4', { count: 4 }],
    ['count 201', { count: 201 }],
    ['an extra key', { seed: 1 }],
  ])('rejects %s', (_label, patch) => {
    expect(ok(ParamSpec, { ...paramSpec, ...patch })).toBe(false);
  });
});

// ---- Bank items (§5, §6.2) -------------------------------------------------------------------------------------

const mcqDraft = {
  format: 'mcq',
  stem: '[synthetic] Pick the even number',
  options: [
    { id: 'a', text: '3' },
    { id: 'b', text: '4' },
  ],
  key: { optionId: 'b' },
  skillKey: 'quant',
  difficulty: 0.35,
};
const writtenDraft = {
  format: 'written',
  stem: '[synthetic] Write a short reply to a customer',
  rubricVersionId: id(5),
  skillKey: 'written_communication',
  difficulty: 0.5,
};

describe('BankItemDraft (discriminated on format)', () => {
  it('accepts mcq (with media and a param spec) and written drafts', () => {
    expect(BankItemDraft.parse(mcqDraft)).toEqual(mcqDraft);
    expect(BankItemDraft.parse(writtenDraft)).toEqual(writtenDraft);
    const full = {
      ...mcqDraft,
      media: [{ key: `item-media/${id(1)}/${HEX}.jpg`, alt: 'A table' }],
      paramSpec,
      workspaceId: id(9),
    };
    expect(ok(BankItemDraft, full)).toBe(true);
  });
  it.each([
    ['an unknown format', { ...mcqDraft, format: 'voice' }],
    ['a key outside the options', { ...mcqDraft, key: { optionId: 'z' } }],
    [
      'duplicate option ids',
      {
        ...mcqDraft,
        options: [
          { id: 'a', text: '1' },
          { id: 'a', text: '2' },
        ],
      },
    ],
    ['7 options', { ...mcqDraft, options: 'abcdefg'.split('').map((o) => ({ id: o, text: o })) }],
    ['no key', { ...mcqDraft, key: undefined }],
    ['a bad skill key', { ...mcqDraft, skillKey: 'Quant' }],
    ['a difficulty off the grid', { ...mcqDraft, difficulty: 0.355 }],
    [
      '5 media',
      {
        ...mcqDraft,
        media: Array.from({ length: 5 }, () => ({
          key: `item-media/${id(1)}/${HEX}.png`,
          alt: 'x',
        })),
      },
    ],
    ['a written draft with options', { ...writtenDraft, options: mcqDraft.options }],
    ['a written draft with a key', { ...writtenDraft, key: { optionId: 'a' } }],
    ['a written draft with a param spec', { ...writtenDraft, paramSpec }],
    ['a written draft without a rubric', { ...writtenDraft, rubricVersionId: undefined }],
    ['an extra key', { ...mcqDraft, status: 'approved' }],
    ['a client-chosen origin', { ...mcqDraft, origin: 'human' }],
  ])('rejects %s', (_label, value) => {
    expect(ok(BankItemDraft, value)).toBe(false);
  });
});

const summary = {
  itemId: id(10),
  itemVersionId: id(11),
  versionNo: 1,
  workspaceId: id(9),
  format: 'mcq',
  skillKey: 'quant',
  difficulty: 0.35,
  status: 'in_review',
  origin: 'ai_draft',
  stemPreview: '[synthetic] Pick the even number',
  isParameterised: false,
  exposureCount: 0,
  createdAt: T0,
};

describe('BankItemSummary (list row, no key)', () => {
  it('accepts a row and has no key-like field at any depth', () => {
    expect(BankItemSummary.parse(summary)).toEqual(summary);
    expect(ok(BankItemSummary, { ...summary, difficulty: null })).toBe(true);
    expect(keysMatching(BankItemSummary, /^key$|answer|correct|rubric/i)).toEqual([]);
  });
  it.each([
    ['a key', { key: { optionId: 'a' } }],
    ['status rejected', { status: 'rejected' }],
    ['a negative exposure', { exposureCount: -1 }],
    ['a preview over 300', { stemPreview: 's'.repeat(301) }],
    ['version 0', { versionNo: 0 }],
  ])('rejects %s', (_label, patch) => {
    expect(ok(BankItemSummary, { ...summary, ...patch })).toBe(false);
  });
});

const detail = {
  itemId: id(10),
  itemVersionId: id(11),
  versionNo: 1,
  workspaceId: id(9),
  status: 'approved',
  origin: 'human',
  isParameterised: false,
  librarySourced: false,
  createdBy: id(20),
  approvedBy: id(21),
  approvedAt: T0,
  exposureCount: 3,
  content: { ...mcqDraft },
};

describe('BankItemDetail (key only when readable and not library-sourced)', () => {
  it('accepts an own item with its key, and one without (reviewer may not read it)', () => {
    expect(BankItemDetail.parse(detail)).toEqual(detail);
    const noKey = { ...detail, content: { ...mcqDraft, key: undefined } };
    expect(ok(BankItemDetail, noKey)).toBe(true);
    expect(ok(BankItemDetail, { ...detail, content: writtenDraft })).toBe(true);
  });
  it('a library-sourced item never carries its key or param spec (I-M1-5)', () => {
    const lib = { ...detail, origin: 'library', librarySourced: true };
    expect(ok(BankItemDetail, lib)).toBe(false);
    const libNoKey = { ...lib, content: { ...mcqDraft, key: undefined } };
    expect(ok(BankItemDetail, libNoKey)).toBe(true);
    const libParam = { ...lib, content: { ...mcqDraft, key: undefined, paramSpec } };
    expect(ok(BankItemDetail, libParam)).toBe(false);
  });
  it.each([
    ['approvedAt without approvedBy', { approvedBy: null }],
    ['a draft with an approval', { status: 'draft' }],
    ['an extra key', { librarySource: true }],
  ])('rejects %s', (_label, patch) => {
    expect(ok(BankItemDetail, { ...detail, ...patch })).toBe(false);
  });
  it('accepts a draft with no approval', () => {
    expect(
      ok(BankItemDetail, { ...detail, status: 'draft', approvedBy: null, approvedAt: null }),
    ).toBe(true);
  });
});

describe('KeyReviewItemRequest (R5-64 h, SEC-M1-4)', () => {
  it('names the version and nothing else (the reviewer is the caller)', () => {
    expect(M1.KeyReviewItemRequest.parse({ itemVersionId: id(11) })).toBeTruthy();
    expect(ok(M1.KeyReviewItemRequest, { itemVersionId: 'x' })).toBe(false);
    expect(ok(M1.KeyReviewItemRequest, {})).toBe(false);
    expect(ok(M1.KeyReviewItemRequest, { itemVersionId: id(11), keyReviewedBy: id(12) })).toBe(
      false,
    );
  });
});

describe('ApproveItemRequest (R5-22)', () => {
  it('decides approve or not_approved, nothing else', () => {
    expect(ApproveItemRequest.parse({ itemVersionId: id(11), decision: 'approve' })).toBeTruthy();
    expect(ok(ApproveItemRequest, { itemVersionId: id(11), decision: 'not_approved' })).toBe(true);
    for (const decision of ['reject', 'rejected', 'decline', 'approved', '']) {
      expect(ok(ApproveItemRequest, { itemVersionId: id(11), decision }), decision).toBe(false);
    }
    expect(ok(ApproveItemRequest, { itemVersionId: 'x', decision: 'approve' })).toBe(false);
    expect(ok(ApproveItemRequest, { itemVersionId: id(11), decision: 'approve', note: 'x' })).toBe(
      false,
    );
  });
});

// ---- Pools and sections (§5, §6.5) -----------------------------------------------------------------------------

describe('PoolRequest and PoolDetail', () => {
  it('accepts valid shapes', () => {
    expect(ok(PoolRequest, { name: 'Quant pool', format: 'mcq' })).toBe(true);
    expect(
      ok(PoolRequest, { name: 'Quant pool', format: 'mcq', skillKey: 'quant', workspaceId: id(9) }),
    ).toBe(true);
    const pool = {
      id: id(30),
      name: 'Quant pool',
      format: 'mcq',
      skillKey: null,
      status: 'active',
      itemCount: 12,
      approvedCount: 10,
      usedByDraws: [{ testId: id(31), drawCount: 5 }],
      usedByDrawsTotal: 1,
    };
    expect(PoolDetail.parse(pool)).toEqual(pool);
    expect(ok(PoolDetail, { ...pool, status: 'deleted' })).toBe(false);
    expect(ok(PoolDetail, { ...pool, approvedCount: 13 })).toBe(false);
    expect(ok(PoolDetail, { ...pool, usedByDraws: [{ testId: id(31), drawCount: 0 }] })).toBe(
      false,
    );
  });
  it.each([
    ['an empty name', { name: '', format: 'mcq' }],
    ['a name over 120', { name: 'n'.repeat(121), format: 'mcq' }],
    ['an unknown format', { name: 'P', format: 'typing' }],
    ['a status', { name: 'P', format: 'mcq', status: 'archived' }],
  ])('PoolRequest rejects %s', (_label, value) => {
    expect(ok(PoolRequest, value)).toBe(false);
  });
});

const inlineSection = {
  mode: 'inline',
  format: 'mcq',
  name: 'Reasoning',
  weight: 50,
  items: [
    {
      format: 'mcq',
      prompt: '[synthetic] Pick one',
      options: [
        { id: 'a', text: 'One' },
        { id: 'b', text: 'Two' },
      ],
      correctOptionId: 'a',
    },
  ],
  shuffleItems: false,
  shuffleOptions: true,
  navigation: 'free',
};
const poolSection = {
  mode: 'pool',
  format: 'written',
  name: 'Writing',
  weight: 50,
  items: [],
  poolId: id(30),
  drawCount: 1,
  shuffleItems: false,
  shuffleOptions: false,
  navigation: 'forward_only',
  pasteRule: 'allowed_logged',
  timeLimitSeconds: 600,
};

describe('SectionDraft', () => {
  it('accepts an inline and a pool section', () => {
    expect(SectionDraft.parse(inlineSection)).toEqual(inlineSection);
    expect(SectionDraft.parse(poolSection)).toEqual(poolSection);
    const strata = {
      ...poolSection,
      format: 'mcq',
      navigation: 'free',
      pasteRule: undefined,
      drawCount: 5,
      blueprint: {
        strata: [
          { skillKey: 'quant', difficultyBand: 1, count: 3 },
          { skillKey: 'logical', difficultyBand: 4, count: 2 },
        ],
      },
    };
    expect(ok(SectionDraft, strata)).toBe(true);
  });
  it.each([
    ['an inline section with a pool', { ...inlineSection, poolId: id(30) }],
    ['an inline section with a draw count', { ...inlineSection, drawCount: 2 }],
    ['a pool section without a pool', { ...poolSection, poolId: undefined }],
    ['a pool section without a draw count', { ...poolSection, drawCount: undefined }],
    [
      'a pool section with inline items',
      {
        ...poolSection,
        format: 'mcq',
        navigation: 'free',
        pasteRule: undefined,
        items: inlineSection.items,
      },
    ],
    ['a written section that is free to navigate', { ...poolSection, navigation: 'free' }],
    ['a paste rule on an mcq section', { ...inlineSection, pasteRule: 'blocked' }],
    [
      'an item of another format',
      { ...inlineSection, format: 'written', navigation: 'forward_only' },
    ],
    ['draw count 0', { ...poolSection, drawCount: 0 }],
    ['draw count 101', { ...poolSection, drawCount: 101 }],
    ['a 59 s timer', { ...poolSection, timeLimitSeconds: 59 }],
    ['an unknown navigation', { ...inlineSection, navigation: 'back_only' }],
    ['an unknown paste rule', { ...poolSection, pasteRule: 'allowed' }],
    [
      'a blueprint on an inline section',
      {
        ...inlineSection,
        blueprint: { strata: [{ skillKey: 'quant', difficultyBand: 0, count: 1 }] },
      },
    ],
    [
      'strata that do not sum to the draw',
      {
        ...poolSection,
        blueprint: { strata: [{ skillKey: 'written_communication', difficultyBand: 2, count: 2 }] },
      },
    ],
    [
      'a difficulty band of 5',
      {
        ...poolSection,
        blueprint: { strata: [{ skillKey: 'written_communication', difficultyBand: 5, count: 1 }] },
      },
    ],
    ['a weight of 0', { ...inlineSection, weight: 0 }],
    ['an extra key', { ...inlineSection, seed: 1 }],
    [
      'a repeated (skillKey, difficultyBand) stratum',
      {
        ...poolSection,
        drawCount: 2,
        blueprint: {
          strata: [
            { skillKey: 'written_communication', difficultyBand: 2, count: 1 },
            { skillKey: 'written_communication', difficultyBand: 2, count: 1 },
          ],
        },
      },
    ],
  ])('rejects %s', (_label, value) => {
    expect(ok(SectionDraft, value)).toBe(false);
  });
});

describe('SaveTestDraftRequest', () => {
  const draft = {
    name: 'Support screen',
    durationMinutes: 40,
    qualityCutoff: 40,
    sections: [inlineSection, poolSection],
  };
  const many = (n: number) => Array.from({ length: n }, () => inlineSection.items[0]);
  it('accepts a draft, an empty draft and the D1 limits lifted to 10 sections and 200 inline items', () => {
    expect(SaveTestDraftRequest.parse(draft)).toEqual(draft);
    expect(ok(SaveTestDraftRequest, { ...draft, sections: [] })).toBe(true);
    const ten = Array.from({ length: 10 }, () => ({ ...inlineSection, items: many(20) }));
    expect(ok(SaveTestDraftRequest, { ...draft, sections: ten })).toBe(true);
  });
  it.each([
    ['11 sections', { sections: Array.from({ length: 11 }, () => inlineSection) }],
    [
      '201 inline items',
      {
        sections: [
          { ...inlineSection, items: many(101) },
          { ...inlineSection, items: many(100) },
        ],
      },
    ],
    ['no cutoff (D1 L-15)', { qualityCutoff: undefined }],
    ['a null cutoff', { qualityCutoff: null }],
    ['a cutoff of 101', { qualityCutoff: 101 }],
    ['a 4-minute test', { durationMinutes: 4 }],
    ['an extra key', { integritySettings: {} }],
  ])('rejects %s', (_label, patch) => {
    expect(ok(SaveTestDraftRequest, { ...draft, ...patch })).toBe(false);
  });
});

// ---- Integrity settings (§6.6, screen 04) ---------------------------------------------------------------------

const standard = {
  calibration_warmup: 'on',
  typing_provenance: 'on',
  burst_after_tab: 'on',
  fullscreen_tab_focus: 'warn_first',
  single_screen: 'off',
  camera_face_presence: 'on',
  mic_speech_presence: 'off',
  explain_probe: 'off',
  question_copy: 'on',
  paste_written: 'allowed_logged',
  integrity_review_scope: 'shortlist_only',
  accommodations: 'on',
  id_verification: 'off',
};

describe('IntegritySettingsRequest and IntegritySettingsView', () => {
  it('accepts the Standard preset values', () => {
    expect(
      IntegritySettingsRequest.parse({ presetKey: 'standard', values: standard }),
    ).toBeTruthy();
  });
  it('custom settings have no preset (ruleset_versions.preset_key null)', () => {
    const custom = { presetKey: null, values: { ...standard, single_screen: 'on' } };
    expect(IntegritySettingsRequest.parse(custom)).toEqual(custom);
    expect(ok(IntegritySettingsRequest, { values: standard })).toBe(false); // null, never absent
  });
  it.each([
    ['an unknown preset', { presetKey: 'lenient', values: standard }],
    [
      'a value outside the setting list',
      { presetKey: 'standard', values: { ...standard, paste_written: 'on' } },
    ],
    [
      'warn_first on an on/off setting',
      { presetKey: 'standard', values: { ...standard, single_screen: 'warn_first' } },
    ],
    [
      'an always-locked setting changed',
      { presetKey: 'standard', values: { ...standard, integrity_review_scope: 'all' } },
    ],
    [
      'id verification on (Phase 2)',
      { presetKey: 'standard', values: { ...standard, id_verification: 'on' } },
    ],
    [
      'a missing setting',
      { presetKey: 'standard', values: { ...standard, explain_probe: undefined } },
    ],
    ['an unknown setting', { presetKey: 'standard', values: { ...standard, gaze_tracking: 'on' } }],
  ])('rejects %s', (_label, value) => {
    expect(ok(IntegritySettingsRequest, value)).toBe(false);
  });
  const view = {
    presetKey: 'standard',
    values: standard,
    locked: {
      paste_written: 'admin',
      integrity_review_scope: 'always',
      accommodations: 'always',
      id_verification: 'always',
    },
    candidateSummary: ['Pasting into written answers is recorded.'],
    stored: true,
  };
  it('the view says whether the version has stored settings (R5-70 d)', () => {
    expect(ok(IntegritySettingsView, { ...view, presetKey: null, stored: false })).toBe(true);
    const without: Partial<typeof view> = { ...view };
    delete without.stored;
    expect(ok(IntegritySettingsView, without)).toBe(false);
    expect(ok(IntegritySettingsView, { ...view, stored: 'yes' })).toBe(false);
  });
  it('the view marks every always-locked setting as always and the rest as admin at most', () => {
    expect(IntegritySettingsView.parse(view)).toEqual(view);
    expect(ok(IntegritySettingsView, { ...view, presetKey: null })).toBe(true);
    const missingAlways = { ...view.locked, id_verification: undefined };
    expect(ok(IntegritySettingsView, { ...view, locked: missingAlways })).toBe(false);
    expect(
      ok(IntegritySettingsView, { ...view, locked: { ...view.locked, paste_written: 'always' } }),
    ).toBe(false);
    expect(
      ok(IntegritySettingsView, { ...view, locked: { ...view.locked, accommodations: 'admin' } }),
    ).toBe(false);
    expect(ok(IntegritySettingsView, { ...view, candidateSummary: [''] })).toBe(false);
  });
});

// ---- Role templates and blueprints (§6.1; R5-29) ---------------------------------------------------------------

const proposal = {
  templateKey: 'customer_support',
  version: 1,
  matchPermille: 420,
  sections: [
    { title: 'Verbal', format: 'mcq', skillKey: 'verbal', drawCount: 10, available: true },
    { title: 'Typing', format: 'typing', skillKey: 'typing', drawCount: 1, available: false },
  ],
};

describe('role templates and blueprints', () => {
  it('BlueprintProposal carries matchPermille 0-1000 and no score, band, grade or outcome field (R5-29)', () => {
    expect(BlueprintProposal.parse(proposal)).toEqual(proposal);
    expect(ok(BlueprintProposal, { ...proposal, matchPermille: 0 })).toBe(true);
    expect(ok(BlueprintProposal, { ...proposal, matchPermille: 1000 })).toBe(true);
    expect(ok(BlueprintProposal, { ...proposal, matchPermille: 1001 })).toBe(false);
    expect(ok(BlueprintProposal, { ...proposal, matchPermille: 0.42 })).toBe(false);
    expect(ok(BlueprintProposal, { ...proposal, matchScore: 0.42 })).toBe(false);
    expect(keysMatching(BlueprintProposal, /score|band|grade|outcome/i)).toEqual([]);
    expect(keysMatching(BlueprintProposeResponse, /score|band|grade|outcome|jd/i)).toEqual([]);
  });
  it('only mcq and written sections can be available in M1 (M1-16)', () => {
    const voice = {
      title: 'Voice',
      format: 'voice',
      skillKey: 'spoken_english',
      drawCount: 1,
      available: true,
    };
    expect(ok(BlueprintProposal, { ...proposal, sections: [voice] })).toBe(false);
    expect(ok(BlueprintProposal, { ...proposal, sections: [{ ...voice, available: false }] })).toBe(
      true,
    );
    expect(ok(BlueprintProposal, { ...proposal, sections: [] })).toBe(false);
    expect(
      ok(BlueprintProposal, {
        ...proposal,
        sections: [{ ...voice, drawCount: 101, available: false }],
      }),
    ).toBe(false);
  });
  it('the propose response may carry no proposal ("Pick a template")', () => {
    expect(ok(BlueprintProposeResponse, { proposal: null })).toBe(true);
    expect(ok(BlueprintProposeResponse, { proposal })).toBe(true);
    expect(ok(BlueprintProposeRequest, { jdText: 'x'.repeat(50000) })).toBe(true);
    expect(ok(BlueprintProposeRequest, { jdText: 'x'.repeat(50001) })).toBe(false);
    expect(ok(BlueprintProposeRequest, { jdText: '' })).toBe(false);
  });
  it('RoleTemplateSummary and CreateTestFromTemplateRequest', () => {
    const tpl = { templateKey: 'bpo_voice', version: 2, name: 'BPO Voice', presetKey: 'standard' };
    expect(RoleTemplateSummary.parse(tpl)).toEqual(tpl);
    expect(ok(RoleTemplateSummary, { ...tpl, templateKey: 'BPO' })).toBe(false);
    expect(ok(RoleTemplateSummary, { ...tpl, keywords: ['x'] })).toBe(false);
    const create = { jobTitle: 'Support associate', templateKey: 'bpo_voice', templateVersion: 2 };
    expect(ok(CreateTestFromTemplateRequest, create)).toBe(true);
    expect(
      ok(CreateTestFromTemplateRequest, {
        ...create,
        jdText: 'j'.repeat(50000),
        workspaceId: id(9),
      }),
    ).toBe(true);
    expect(ok(CreateTestFromTemplateRequest, { ...create, jdText: 'j'.repeat(50001) })).toBe(false);
    expect(ok(CreateTestFromTemplateRequest, { ...create, jobTitle: '' })).toBe(false);
    expect(ok(CreateTestFromTemplateRequest, { ...create, templateVersion: 0 })).toBe(false);
  });
});

// ---- Import (§4.3, §6.9) ---------------------------------------------------------------------------------------

const mcqRow = {
  rowNo: 2,
  format: 'mcq',
  skillKey: 'quant',
  difficulty: 0.4,
  stem: '[synthetic] 2 + 2 = ?',
  options: ['3', '4', '5'],
  correct: 'b',
};
const writtenRow = {
  rowNo: 3,
  format: 'written',
  skillKey: 'written_communication',
  difficulty: 0.6,
  stem: '[synthetic] Describe your last shift',
  rubricKey: 'reply_quality_v1',
};

describe('ImportRow and the import requests', () => {
  it('accepts mcq (with an image and a param spec) and written rows', () => {
    expect(ImportRow.parse(mcqRow)).toEqual(mcqRow);
    expect(ImportRow.parse(writtenRow)).toEqual(writtenRow);
    expect(ok(ImportRow, { ...mcqRow, imageSha256: HEX, imageAlt: 'A chart', paramSpec })).toBe(
      true,
    );
  });
  it.each([
    ['row 1 (the header)', { ...mcqRow, rowNo: 1 }],
    ['a correct letter beyond the options', { ...mcqRow, correct: 'd' }],
    ['a correct letter g', { ...mcqRow, correct: 'g' }],
    ['no correct letter', { ...mcqRow, correct: undefined }],
    ['one option', { ...mcqRow, options: ['3'] }],
    ['7 options', { ...mcqRow, options: ['1', '2', '3', '4', '5', '6', '7'] }],
    ['an image without alt text', { ...mcqRow, imageSha256: HEX }],
    ['alt text without an image', { ...mcqRow, imageAlt: 'A chart' }],
    ['a bad image hash', { ...mcqRow, imageSha256: 'B'.repeat(64), imageAlt: 'x' }],
    ['a written row with options', { ...writtenRow, options: ['a', 'b'] }],
    ['a written row with a key', { ...writtenRow, correct: 'a' }],
    ['a written row without a rubric', { ...writtenRow, rubricKey: undefined }],
    ['a written row with a param spec', { ...writtenRow, paramSpec }],
    ['an unknown format', { ...mcqRow, format: 'voice' }],
    ['an extra cell', { ...mcqRow, notes: 'x' }],
  ])('rejects %s', (_label, value) => {
    expect(ok(ImportRow, value)).toBe(false);
  });
  it('ImportRowsRequest holds 1-100 rows with distinct row numbers', () => {
    const rows = (n: number) => Array.from({ length: n }, (_v, i) => ({ ...mcqRow, rowNo: i + 2 }));
    expect(ok(ImportRowsRequest, { rows: rows(1) })).toBe(true);
    expect(ok(ImportRowsRequest, { rows: rows(100) })).toBe(true);
    expect(ok(ImportRowsRequest, { rows: [] })).toBe(false);
    expect(ok(ImportRowsRequest, { rows: rows(101) })).toBe(false);
    expect(ok(ImportRowsRequest, { rows: [mcqRow, mcqRow] })).toBe(false);
  });
  it('ImportRowsResponse errors are {rowNo, field, code} with a §4.3 code, never a cell value', () => {
    const res = { accepted: 1, errors: [{ rowNo: 3, field: 'option_c', code: 'bad_options' }] };
    expect(ImportRowsResponse.parse(res)).toEqual(res);
    expect(ok(ImportRowsResponse, { accepted: 0, errors: [] })).toBe(true);
    expect(
      ok(ImportRowsResponse, { ...res, errors: [{ rowNo: 3, field: 'stem', code: 'bad_cell' }] }),
    ).toBe(false);
    expect(
      ok(ImportRowsResponse, {
        ...res,
        errors: [{ rowNo: 3, field: 'Stem text', code: 'too_long' }],
      }),
    ).toBe(false);
    expect(
      ok(ImportRowsResponse, {
        ...res,
        errors: [{ rowNo: 3, field: 'stem', code: 'too_long', value: 'x' }],
      }),
    ).toBe(false);
    expect(ok(ImportRowsResponse, { ...res, accepted: -1 })).toBe(false);
    expect(keysMatching(ImportRowsResponse, /value|text|cell|message/i)).toEqual([]);
  });
  it('ImportJobCreateRequest and ImportImagePutResponse', () => {
    expect(
      ok(ImportJobCreateRequest, { sourceKind: 'xlsx', templateVersion: 'trace-items-v1' }),
    ).toBe(true);
    expect(
      ok(ImportJobCreateRequest, {
        sourceKind: 'docx',
        templateVersion: 'trace-items-v1',
        workspaceId: id(9),
      }),
    ).toBe(true);
    expect(
      ok(ImportJobCreateRequest, { sourceKind: 'xlsm', templateVersion: 'trace-items-v1' }),
    ).toBe(false);
    expect(ok(ImportJobCreateRequest, { sourceKind: 'xlsx', templateVersion: 'v9' })).toBe(false);
    const key = `item-media/${id(1)}/${HEX}.png`;
    expect(ImportImagePutResponse.parse({ key })).toEqual({ key });
    expect(ok(ImportImagePutResponse, { key: 'item-media/x.png' })).toBe(false);
  });
});

// ---- AI drafting (§6.4) ----------------------------------------------------------------------------------------

describe('AiDraftRequest and AiDraftJobView', () => {
  const req = { format: 'mcq', skillKey: 'quant', difficulty: 0.3, count: 5, topic: 'percentages' };
  it('accepts a request with 1-10 drafts and a topic up to 500', () => {
    expect(AiDraftRequest.parse(req)).toEqual(req);
    expect(ok(AiDraftRequest, { ...req, count: 1, topic: 't'.repeat(500) })).toBe(true);
  });
  it.each([
    ['count 0', { count: 0 }],
    ['count 11', { count: 11 }],
    ['a topic over 500', { topic: 't'.repeat(501) }],
    ['an empty topic', { topic: '' }],
    ['a NUL in the topic', { topic: 'a\u0000b' }],
    ['format voice', { format: 'voice' }],
    ['a model choice', { modelId: 'x' }],
  ])('rejects %s', (_label, patch) => {
    expect(ok(AiDraftRequest, { ...req, ...patch })).toBe(false);
  });
  it('the job view carries counts and a constant error code only', () => {
    const view = {
      id: id(40),
      status: 'failed',
      format: 'mcq',
      skillKey: 'quant',
      difficulty: 0.3,
      count: 5,
      draftsCreated: 0,
      errorCode: 'drafter_error',
    };
    expect(AiDraftJobView.parse(view)).toEqual(view);
    expect(
      ok(AiDraftJobView, { ...view, status: 'completed', draftsCreated: 5, errorCode: undefined }),
    ).toBe(true);
    expect(ok(AiDraftJobView, { ...view, draftsCreated: 6 })).toBe(false);
    expect(ok(AiDraftJobView, { ...view, errorCode: 'Model said: no' })).toBe(false);
    expect(ok(AiDraftJobView, { ...view, topic: 'x' })).toBe(false);
  });
});

// ---- Library (§6.2; AT-M1-22) ----------------------------------------------------------------------------------

describe('LibraryBrowseQuery and LibraryItemCard', () => {
  it('parses a query string object (numbers arrive as text)', () => {
    expect(
      LibraryBrowseQuery.parse({
        skillKey: 'quant',
        format: 'mcq',
        difficultyMin: '0.2',
        difficultyMax: '0.6',
      }),
    ).toEqual({
      skillKey: 'quant',
      format: 'mcq',
      difficultyMin: 0.2,
      difficultyMax: 0.6,
    });
    expect(ok(LibraryBrowseQuery, {})).toBe(true);
    // A page cursor is base64url of the canonical keyset {createdAt, id} (review fix 6); a hand-made string is not.
    const cursor = Buffer.from(`{"createdAt":"${T0}","id":"${id(1)}"}`).toString('base64url');
    expect(ok(LibraryBrowseQuery, { cursor })).toBe(true);
    expect(ok(LibraryBrowseQuery, { cursor: 'abc_DEF-123' })).toBe(false);
    expect(ok(LibraryBrowseQuery, { difficultyMin: '0.7', difficultyMax: '0.2' })).toBe(false);
    expect(ok(LibraryBrowseQuery, { difficultyMin: 'x' })).toBe(false);
    expect(ok(LibraryBrowseQuery, { cursor: 'a b' })).toBe(false);
    expect(ok(LibraryBrowseQuery, { orgId: id(1) })).toBe(false);
  });
  const card = {
    libraryItemVersionId: id(50),
    format: 'mcq',
    skillKey: 'quant',
    difficulty: 0.4,
    stem: '[synthetic] Library stem',
    options: ['One', 'Two'],
    isParameterised: false,
  };
  it('accepts a card; options are text only and belong to mcq cards', () => {
    expect(LibraryItemCard.parse(card)).toEqual(card);
    expect(ok(LibraryItemCard, { ...card, format: 'written', options: undefined })).toBe(true);
    expect(ok(LibraryItemCard, { ...card, format: 'written' })).toBe(false);
    expect(
      ok(LibraryItemCard, {
        ...card,
        options: [
          { id: 'a', text: 'One' },
          { id: 'b', text: 'Two' },
        ],
      }),
    ).toBe(false);
  });
  it('AT-M1-22: no key field exists anywhere in the type (schema walk)', () => {
    expect(schemaKeys(LibraryItemCard)).toEqual([
      'difficulty',
      'format',
      'isParameterised',
      'libraryItemVersionId',
      'options',
      'skillKey',
      'stem',
    ]);
    expect(
      keysMatching(LibraryItemCard, /^key$|answer|correct|rubric|solution|paramSpec/i),
    ).toEqual([]);
    for (const extra of ['key', 'correctOptionId', 'answerKey', 'paramSpec', 'rubric']) {
      expect(ok(LibraryItemCard, { ...card, [extra]: 'a' }), extra).toBe(false);
    }
  });
});

// ---- Members (§4.5) ---------------------------------------------------------------------------------------------

describe('MemberInviteRequest', () => {
  const invite = {
    email: 'new-recruiter@example.test',
    roles: ['recruiter'],
    displayName: 'Recruiter Two',
  };
  it('accepts an invite with or without a workspace', () => {
    expect(MemberInviteRequest.parse(invite)).toEqual(invite);
    expect(
      ok(MemberInviteRequest, { ...invite, workspaceId: id(9), roles: ['reviewer', 'recruiter'] }),
    ).toBe(true);
  });
  it.each([
    ['a bad email', { email: 'not-an-email' }],
    ['no roles', { roles: [] }],
    ['a duplicate role', { roles: ['admin', 'admin'] }],
    ['an unknown role', { roles: ['candidate'] }],
    ['no display name', { displayName: '' }],
    ['a status', { status: 'active' }],
  ])('rejects %s', (_label, patch) => {
    expect(ok(MemberInviteRequest, { ...invite, ...patch })).toBe(false);
  });
});

// ---- Sweeps over every export ----------------------------------------------------------------------------------

/** Exported schemas with no object node (enums and formats). They are checked to be object-free instead. */
const SCALAR_EXPORTS = [
  'ItemStatus',
  'ItemOrigin',
  'ItemFormat',
  'SkillKey',
  'Difficulty',
  'PresetKey',
  'SettingKey',
  'ImportErrorCode',
  'ImportJobStatus',
  'AiDraftJobStatus',
  'MemberInviteStatus',
  'ImportField',
  'ImportJobErrorCode',
  'AiDraftErrorCode',
];
const m1Exports = (Object.entries(M1) as [string, unknown][]).filter(
  (entry): entry is [string, z.ZodType] => entry[1] instanceof z.ZodType,
);
const m1ObjectExports = m1Exports.filter(([name]) => !SCALAR_EXPORTS.includes(name));

describe('every M1 schema export', () => {
  it('the sweep sees the §5 contracts', () => {
    const names = m1Exports.map(([name]) => name);
    for (const name of [
      'BankItemDraft',
      'BankItemSummary',
      'BankItemDetail',
      'ApproveItemRequest',
      'PoolRequest',
      'PoolDetail',
      'SectionDraft',
      'SaveTestDraftRequest',
      'IntegritySettingsRequest',
      'IntegritySettingsView',
      'RoleTemplateSummary',
      'BlueprintProposal',
      'CreateTestFromTemplateRequest',
      'ImportRow',
      'ImportJobCreateRequest',
      'ImportRowsRequest',
      'ImportRowsResponse',
      'ImportImagePutResponse',
      'AiDraftRequest',
      'AiDraftJobView',
      'LibraryBrowseQuery',
      'LibraryItemCard',
      'MemberInviteRequest',
      'ItemMedia',
      'ParamSpec',
      ...SCALAR_EXPORTS,
    ]) {
      expect(names, name).toContain(name);
    }
  });
  it('the scalar exports really are object-free', () => {
    for (const name of SCALAR_EXPORTS) {
      const schema = M1[name as keyof typeof M1] as z.ZodType;
      expect(allObjectsStrict(schema), name).toBe(false);
      expect(schemaNodes(schema).size, name).toBeGreaterThan(0);
    }
  });
  it.each(m1ObjectExports)('%s: strict at every depth', (_name, schema) => {
    expect(allObjectsStrict(schema)).toBe(true);
  });
  it.each(m1Exports)('%s: no combined-result key (rule 1)', (_name, schema) => {
    expect(
      keysMatching(schema, /overall|combined|trust|honesty|composite|integrity_?score/i),
    ).toEqual([]);
  });
  // `difficultyBand` (§5 SectionDraft strata: a difficulty stratum 0-4) is the one name allowed to contain "band".
  it.each(m1Exports)(
    '%s: no score, band, grade or outcome field (R5-29, I-M1-9)',
    (_name, schema) => {
      expect(
        keysMatching(schema, /score|band|grade|outcome/i).filter((key) => key !== 'difficultyBand'),
      ).toEqual([]);
    },
  );
  it.each(m1Exports)('%s: nothing from the never-build list (rule 7)', (_name, schema) => {
    expect(
      keysMatching(
        schema,
        /emotion|stress|personality|gaze|ai_?likeness|voiceprint|faceMatch|face_template|asn$/i,
      ),
    ).toEqual([]);
  });
});
