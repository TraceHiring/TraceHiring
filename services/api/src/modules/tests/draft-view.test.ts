// toDraftView, the editor read-model (spec m1 R5-53 a: TestDraftView answers GET …/tests/:testId, the POST 201s and
// PUT …/draft). On a half-written draft (spec §6.2 "a half-written draft is harmless"; spec review r3a #3) an mcq item
// without its answer key or a written item without its rubric is left out, so GET keeps working and the next save
// replaces the children; publish validates. A published version stays fail-closed (503 unavailable). A D1 section
// (navigation null) round-trips as a D1 section; a pool section carries its pool, draw and strata.
import { TestDraftView } from '@trace/shared/contracts/m1';
import { describe, expect, it } from 'vitest';
import type { Content, ItemRow, SectionRow, TestRow, VersionRow } from './authoring.js';
import { toDraftView } from './draft.js';
import { OrgError } from './org-context.js';

const TEST_ID = '6f1d2c3b-4a59-4e8d-9c7b-1a2b3c4d5e6f';
const ORG_ID = '0b9c8d7e-6f5a-4b3c-8d2e-1f0a9b8c7d6e';
const WS_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const VERSION_ID = '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a';
const MCQ_SECTION = '3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b';
const WRITTEN_SECTION = '4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c';
const POOL_SECTION = '4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8d';
const POOL = '4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8e';
const MCQ_OK = '5a6b7c8d-9e0f-4a1b-8c3d-4e5f6a7b8c9d';
const MCQ_UNFINISHED = '6b7c8d9e-0f1a-4b2c-9d4e-5f6a7b8c9d0e';
const WRITTEN_OK = '7c8d9e0f-1a2b-4c3d-8e5f-6a7b8c9d0e1f';
const WRITTEN_UNFINISHED = '8d9e0f1a-2b3c-4d4e-9f6a-7b8c9d0e1f2a';
const RUBRIC = '9e0f1a2b-3c4d-4e5f-8a7b-8c9d0e1f2a3b';

const test: TestRow = {
  id: TEST_ID,
  org_id: ORG_ID,
  workspace_id: WS_ID,
  name: 'Synthetic Test',
  created_at: '2026-10-19T00:00:00.000Z',
  invitation_seq: 0,
};

const version = (status: VersionRow['status']): VersionRow => ({
  id: VERSION_ID,
  test_id: TEST_ID,
  version_no: 1,
  status,
  total_time_seconds: 1500,
  quality_cutoff: 40,
  ruleset_version_id: null,
  content_sha256: null,
  published_at: status === 'draft' ? null : '2026-10-19T00:00:00.000Z',
});

const section = (
  id: string,
  position: number,
  format: SectionRow['format'],
  patch: Partial<SectionRow> = {},
): SectionRow => ({
  id,
  test_version_id: VERSION_ID,
  position,
  name: format.toUpperCase(),
  format,
  weight: 50,
  time_limit_seconds: null,
  pool_id: null,
  draw_count: null,
  shuffle_items: false,
  shuffle_options: false,
  navigation: null,
  paste_rule: null,
  blueprint: null,
  ...patch,
});

const item = (
  id: string,
  sectionId: string,
  format: ItemRow['format'],
  position: number,
  rubric: string | null = null,
): ItemRow => ({
  id,
  item_id: id,
  test_version_id: VERSION_ID,
  section_id: sectionId,
  format,
  position,
  stem: `Synthetic prompt ${position}`,
  options:
    format === 'mcq'
      ? [
          { id: 'a', text: 'Option A' },
          { id: 'b', text: 'Option B' },
        ]
      : null,
  rubric_version_id: rubric,
  media: null,
  skill_key: null,
  difficulty: null,
  is_parameterised: false,
});

const halfWritten = (): Content => ({
  sections: [section(MCQ_SECTION, 1, 'mcq'), section(WRITTEN_SECTION, 2, 'written')],
  items: [
    item(MCQ_OK, MCQ_SECTION, 'mcq', 1),
    item(MCQ_UNFINISHED, MCQ_SECTION, 'mcq', 2),
    item(WRITTEN_OK, WRITTEN_SECTION, 'written', 1, RUBRIC),
    item(WRITTEN_UNFINISHED, WRITTEN_SECTION, 'written', 2, null),
  ],
  keys: new Map([[MCQ_OK, 'a']]),
  rubrics: new Map([
    [RUBRIC, [{ id: 'c1', label: 'Clarity', max_points: 2, anchors: ['clear'], min_hits: 1 }]],
  ]),
});

describe('toDraftView on a half-written draft (spec review r3a #3)', () => {
  it('leaves out an mcq item without a key and a written item without a rubric', () => {
    const view = TestDraftView.parse(toDraftView(test, version('draft'), halfWritten()));
    const ids = view.version.sections.flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toEqual([MCQ_OK, WRITTEN_OK]);
    expect(view.test).toEqual({
      id: TEST_ID,
      workspaceId: WS_ID,
      name: 'Synthetic Test',
      createdAt: '2026-10-19T00:00:00.000Z',
    });
  });

  it('a written item whose rubric version id points at no stored rubric is left out too', () => {
    const content = halfWritten();
    content.rubrics = new Map();
    const view = toDraftView(test, version('draft'), content);
    const ids = view.version.sections.flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toEqual([MCQ_OK]);
  });

  it('a published version with an incomplete item stays fail-closed (503 unavailable)', () => {
    for (const status of ['published', 'retired'] as const) {
      expect(() => toDraftView(test, version(status), halfWritten())).toThrow(OrgError);
      expect(() => toDraftView(test, version(status), halfWritten())).toThrow('unavailable');
    }
  });
});

describe('toDraftView sections', () => {
  it('a D1 section reads back as a D1 section: inline, navigation null, unshuffled, no paste rule', () => {
    const view = TestDraftView.parse(toDraftView(test, version('draft'), halfWritten()));
    expect(view.version.sections[0]).toMatchObject({
      mode: 'inline',
      navigation: null,
      shuffleItems: false,
      shuffleOptions: false,
      weight: 50,
    });
    expect(view.version.sections[0]).not.toHaveProperty('pasteRule');
    expect(view.version.sections[0]).not.toHaveProperty('poolId');
  });

  it('a pool section carries its pool, draw count, strata, time limit and paste rule; an inline v2 section its flags', () => {
    const content: Content = {
      sections: [
        section(MCQ_SECTION, 1, 'mcq', {
          navigation: 'free',
          shuffle_items: true,
          shuffle_options: true,
          time_limit_seconds: 600,
        }),
        section(POOL_SECTION, 2, 'written', {
          pool_id: POOL,
          draw_count: 2,
          navigation: 'forward_only',
          paste_rule: 'allowed_logged',
          time_limit_seconds: 900,
          blueprint: {
            strata: [{ skillKey: 'written_communication', difficultyBand: 2, count: 2 }],
          },
        }),
      ],
      items: [item(MCQ_OK, MCQ_SECTION, 'mcq', 1)],
      keys: new Map([[MCQ_OK, 'a']]),
      rubrics: new Map(),
    };
    const view = TestDraftView.parse(toDraftView(test, version('draft'), content));
    expect(view.version.sections[0]).toMatchObject({
      mode: 'inline',
      navigation: 'free',
      shuffleItems: true,
      shuffleOptions: true,
      timeLimitSeconds: 600,
    });
    expect(view.version.sections[1]).toMatchObject({
      mode: 'pool',
      poolId: POOL,
      drawCount: 2,
      navigation: 'forward_only',
      pasteRule: 'allowed_logged',
      timeLimitSeconds: 900,
      blueprint: { strata: [{ skillKey: 'written_communication', difficultyBand: 2, count: 2 }] },
      items: [],
    });
  });

  it('a stored blueprint that does not fit the contract is 503 unavailable, never echoed', () => {
    const content = halfWritten();
    content.sections = [
      section(POOL_SECTION, 1, 'mcq', {
        pool_id: POOL,
        draw_count: 1,
        navigation: 'free',
        blueprint: { strata: 'nope' },
      }),
    ];
    content.items = [];
    expect(() => toDraftView(test, version('draft'), content)).toThrow('unavailable');
  });
});
