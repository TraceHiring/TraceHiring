// toDetail on a half-written draft (spec §6.2 PUT "a half-written draft is harmless"; spec review r3a #3).
// A failed PUT can leave an mcq item without its answer key or a written item without its rubric. The
// editor view of a draft leaves such an item out, so GET keeps working and the next PUT replaces the
// children; publish validates the draft. A published version stays fail-closed (503 unavailable).
import { TestDetailResponse } from '@trace/shared/contracts/d1';
import { describe, expect, it } from 'vitest';
import {
  toDetail,
  type Content,
  type ItemRow,
  type TestRow,
  type VersionRow,
} from './authoring.js';
import { OrgError } from './org-context.js';

const TEST_ID = '6f1d2c3b-4a59-4e8d-9c7b-1a2b3c4d5e6f';
const ORG_ID = '0b9c8d7e-6f5a-4b3c-8d2e-1f0a9b8c7d6e';
const WS_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const VERSION_ID = '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a';
const MCQ_SECTION = '3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b';
const WRITTEN_SECTION = '4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c';
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

const version = (status: VersionRow['status']): VersionRow =>
  ({
    id: VERSION_ID,
    test_id: TEST_ID,
    version_no: 1,
    status,
    total_time_seconds: 1500,
    quality_cutoff: 40,
    ruleset_version_id: null,
    published_at: status === 'draft' ? null : '2026-10-19T00:00:00.000Z',
  }) as VersionRow;

const item = (
  id: string,
  section: string,
  format: ItemRow['format'],
  position: number,
  rubric: string | null = null,
): ItemRow => ({
  id,
  test_version_id: VERSION_ID,
  section_id: section,
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
});

const halfWritten = (): Content => ({
  sections: [
    {
      id: MCQ_SECTION,
      test_version_id: VERSION_ID,
      position: 1,
      name: 'MCQ',
      format: 'mcq',
      weight: 1,
    },
    {
      id: WRITTEN_SECTION,
      test_version_id: VERSION_ID,
      position: 2,
      name: 'Written',
      format: 'written',
      weight: 1,
    },
  ],
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

describe('toDetail on a half-written draft (spec review r3a #3)', () => {
  it('leaves out an mcq item without a key and a written item without a rubric', () => {
    const detail = TestDetailResponse.parse(toDetail(test, version('draft'), halfWritten()));
    const ids = detail.version.sections.flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toEqual([MCQ_OK, WRITTEN_OK]);
  });

  it('a written item whose rubric version id points at no stored rubric is left out too', () => {
    const content = halfWritten();
    content.rubrics = new Map();
    const detail = toDetail(test, version('draft'), content);
    const ids = detail.version.sections.flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toEqual([MCQ_OK]);
  });

  it('a published version with an incomplete item stays fail-closed (503 unavailable)', () => {
    for (const status of ['published', 'retired'] as const) {
      expect(() => toDetail(test, version(status), halfWritten())).toThrow(OrgError);
      expect(() => toDetail(test, version(status), halfWritten())).toThrow('unavailable');
    }
  });
});
