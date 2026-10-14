// D1 org-endpoint contracts (specs/d1-demo-slice.md §6.2) and the card rows the api reads (migration 3).
// Rule 1 (AT-D3): two results, never blended. Rule 7: nothing of the never-build list. Synthetic values only.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as D1 from './contracts-d1.js';
import {
  ApiError,
  AssignmentListResponse,
  CreateAssignmentRequest,
  CreateInvitationRequest,
  CreateInvitationResponse,
  CreateTestRequest,
  IntegrityCard,
  IntegrityCardRow,
  IntegrityTimelineEntryRow,
  InvitationListResponse,
  MediaLinkResponse,
  OutboxListResponse,
  PublishTestRequest,
  PublishTestResponse,
  QualityCard,
  QualityCardRow,
  ReportMetaResponse,
  ResultRow,
  ResultsListResponse,
  ReviewQueueResponse,
  TestDetailResponse,
  TestListResponse,
  UpdateTestDraftRequest,
} from './contracts-d1.js';
import {
  allObjectsStrict,
  keysMatching,
  schemaKeys,
  sharedNodes,
} from './contracts-schema-walk.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = '2026-10-14T10:00:00.000Z';
const T1 = '2026-10-14T10:31:00+00:00'; // PostgREST timestamptz form
const HEX = 'b'.repeat(64);

const ok = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success;

// ---- Authoring ----------------------------------------------------------------------------------------------------

const mcqItem = {
  format: 'mcq',
  prompt: 'Pick one',
  options: [
    { id: 'a', text: 'First' },
    { id: 'b', text: 'Second' },
  ],
  correctOptionId: 'a',
};
const writtenItem = {
  format: 'written',
  prompt: 'Explain',
  rubric: {
    criteria: [
      { id: 'c1', label: 'Clarity', maxPoints: 5, anchors: ['clear', 'simple'], minHits: 2 },
    ],
  },
};
const draft = {
  name: 'Sample test',
  durationMinutes: 30,
  qualityCutoff: 40,
  sections: [
    { format: 'mcq', name: 'Part A', weight: 1, items: [mcqItem] },
    { format: 'written', name: 'Part B', weight: 2, items: [writtenItem] },
  ],
};

describe('test list, create and detail', () => {
  it('TestListResponse', () => {
    const list = {
      tests: [
        {
          id: id(1),
          name: 'Sample test',
          status: 'draft',
          versionNo: 1,
          invitationCount: 0,
          createdAt: T0,
        },
        {
          id: id(2),
          name: 'Other test',
          status: 'published',
          versionNo: 2,
          invitationCount: 5,
          createdAt: T0,
        },
      ],
    };
    expect(TestListResponse.parse(list)).toEqual(list);
    expect(ok(TestListResponse, { tests: [{ ...list.tests[0], status: 'archived' }] })).toBe(false);
    expect(ok(TestListResponse, { tests: [{ ...list.tests[0], invitationCount: -1 }] })).toBe(
      false,
    );
    expect(ok(TestListResponse, { tests: [{ ...list.tests[0], extra: 1 }] })).toBe(false);
    expect(ok(TestListResponse, { tests: [], extra: 1 })).toBe(false);
  });
  it('CreateTestRequest', () => {
    expect(ok(CreateTestRequest, { name: 'Sample test' })).toBe(true);
    expect(ok(CreateTestRequest, { name: 'Sample test', durationMinutes: 45 })).toBe(true);
    expect(ok(CreateTestRequest, { name: '' })).toBe(false);
    expect(ok(CreateTestRequest, { name: 'n'.repeat(201) })).toBe(false);
    expect(ok(CreateTestRequest, { name: 'x', durationMinutes: 4 })).toBe(false);
    expect(ok(CreateTestRequest, { name: 'x', qualityCutoff: 40 })).toBe(false); // the draft starts at the default
    expect(ok(CreateTestRequest, { name: 'x', orgId: id(1) })).toBe(false);
    // A workspace-scoped recruiter names its workspace; RLS decides (lead, Wave 0 contracts).
    expect(ok(CreateTestRequest, { name: 'x', workspaceId: id(2) })).toBe(true);
    expect(ok(CreateTestRequest, { name: 'x', workspaceId: 'ws-a' })).toBe(false);
  });
  it('TestDetailResponse', () => {
    const detail = {
      test: { id: id(1), name: 'Sample test', createdAt: T0 },
      version: {
        id: id(3),
        versionNo: 1,
        status: 'draft',
        durationMinutes: 30,
        qualityCutoff: 40,
        publishedAt: null,
        sections: [
          {
            id: id(4),
            position: 1,
            name: 'Part A',
            format: 'mcq',
            weight: 1,
            items: [{ id: id(5), position: 1, ...mcqItem }],
          },
          {
            id: id(6),
            position: 2,
            name: 'Part B',
            format: 'written',
            weight: 2,
            items: [{ id: id(7), position: 1, ...writtenItem }],
          },
        ],
      },
    };
    expect(TestDetailResponse.parse(detail)).toEqual(detail);
    expect(
      ok(TestDetailResponse, { ...detail, version: { ...detail.version, qualityCutoff: null } }),
    ).toBe(false);
    expect(
      ok(TestDetailResponse, { ...detail, version: { ...detail.version, status: 'published' } }),
    ).toBe(false); // needs publishedAt
    expect(
      ok(TestDetailResponse, {
        ...detail,
        version: { ...detail.version, status: 'published', publishedAt: T0 },
      }),
    ).toBe(true);
    expect(ok(TestDetailResponse, { ...detail, extra: 1 })).toBe(false);
  });
});

describe('UpdateTestDraftRequest', () => {
  it('accepts a full draft and a half-written one', () => {
    expect(UpdateTestDraftRequest.parse(draft)).toEqual(draft);
    expect(ok(UpdateTestDraftRequest, { ...draft, sections: [] })).toBe(true);
    expect(
      ok(UpdateTestDraftRequest, {
        ...draft,
        sections: [{ format: 'mcq', name: 'A', weight: 1, items: [] }],
      }),
    ).toBe(true);
  });
  it('qualityCutoff is required, an integer, 0..100 (L-15, AT-D15)', () => {
    const without: Record<string, unknown> = { ...draft };
    delete without.qualityCutoff;
    expect(ok(UpdateTestDraftRequest, without)).toBe(false);
    for (const bad of [null, undefined, -1, 101, 40.5, '40', Number.NaN]) {
      expect(ok(UpdateTestDraftRequest, { ...draft, qualityCutoff: bad }), String(bad)).toBe(false);
    }
    for (const good of [0, 1, 40, 100]) {
      expect(ok(UpdateTestDraftRequest, { ...draft, qualityCutoff: good }), String(good)).toBe(
        true,
      );
    }
  });
  it.each([
    ['empty name', { name: '' }],
    ['name over 200', { name: 'n'.repeat(201) }],
    ['duration under 5 minutes', { durationMinutes: 4 }],
    ['duration over 120 minutes', { durationMinutes: 121 }],
    ['fractional duration', { durationMinutes: 30.5 }],
    ['extra key', { paste: 'allowed' }], // there is no paste-policy control (D1-6)
    ['an identity key', { orgId: id(1) }],
    ['three sections', { sections: [...draft.sections, draft.sections[0]] }],
    ['two sections of one format', { sections: [draft.sections[0], draft.sections[0]] }],
  ])('rejects %s', (_label, patch) => {
    expect(ok(UpdateTestDraftRequest, { ...draft, ...patch })).toBe(false);
  });
  it('validates sections and items', () => {
    const withSection = (section: object) => ({ ...draft, sections: [section] });
    const mcqSection = (items: unknown[], extra: object = {}) => ({
      format: 'mcq',
      name: 'Part A',
      weight: 1,
      items,
      ...extra,
    });
    expect(ok(UpdateTestDraftRequest, withSection(mcqSection([mcqItem], { weight: 0 })))).toBe(
      false,
    );
    expect(ok(UpdateTestDraftRequest, withSection(mcqSection([mcqItem], { weight: 1.5 })))).toBe(
      false,
    );
    expect(ok(UpdateTestDraftRequest, withSection(mcqSection([mcqItem], { name: '' })))).toBe(
      false,
    );
    expect(ok(UpdateTestDraftRequest, withSection(mcqSection([writtenItem])))).toBe(false); // format mismatch
    expect(
      ok(UpdateTestDraftRequest, withSection(mcqSection([{ ...mcqItem, correctOptionId: 'z' }]))),
    ).toBe(false);
    expect(
      ok(
        UpdateTestDraftRequest,
        withSection(mcqSection([{ ...mcqItem, options: [mcqItem.options[0]] }])),
      ),
    ).toBe(false);
    const seven = Array.from({ length: 7 }, (_v, i) => ({ id: `o${i}`, text: 't' }));
    expect(
      ok(
        UpdateTestDraftRequest,
        withSection(mcqSection([{ ...mcqItem, options: seven, correctOptionId: 'o0' }])),
      ),
    ).toBe(false);
    const dup = [
      { id: 'a', text: 'x' },
      { id: 'a', text: 'y' },
    ];
    expect(
      ok(UpdateTestDraftRequest, withSection(mcqSection([{ ...mcqItem, options: dup }]))),
    ).toBe(false);
    expect(ok(UpdateTestDraftRequest, withSection(mcqSection([{ ...mcqItem, extra: 1 }])))).toBe(
      false,
    );
    expect(ok(UpdateTestDraftRequest, withSection(mcqSection([{ ...mcqItem, prompt: '' }])))).toBe(
      false,
    );
  });
  it('allows at most 10 items in the whole test', () => {
    const items = (n: number) => Array.from({ length: n }, () => mcqItem);
    const sectionOf = (n: number) => [{ format: 'mcq', name: 'A', weight: 1, items: items(n) }];
    expect(ok(UpdateTestDraftRequest, { ...draft, sections: sectionOf(10) })).toBe(true);
    expect(ok(UpdateTestDraftRequest, { ...draft, sections: sectionOf(11) })).toBe(false);
    const split = [
      { format: 'mcq', name: 'A', weight: 1, items: items(6) },
      {
        format: 'written',
        name: 'B',
        weight: 1,
        items: Array.from({ length: 5 }, () => writtenItem),
      },
    ];
    expect(ok(UpdateTestDraftRequest, { ...draft, sections: split })).toBe(false);
  });
  it('validates rubric criteria', () => {
    const crit = writtenItem.rubric.criteria[0];
    const withCriteria = (criteria: unknown[]) => ({
      ...draft,
      sections: [
        {
          format: 'written',
          name: 'B',
          weight: 1,
          items: [{ ...writtenItem, rubric: { criteria } }],
        },
      ],
    });
    expect(ok(UpdateTestDraftRequest, withCriteria([crit]))).toBe(true);
    expect(ok(UpdateTestDraftRequest, withCriteria([]))).toBe(false);
    expect(
      ok(
        UpdateTestDraftRequest,
        withCriteria(Array.from({ length: 9 }, (_v, i) => ({ ...crit, id: `c${i}` }))),
      ),
    ).toBe(false);
    expect(ok(UpdateTestDraftRequest, withCriteria([{ ...crit, maxPoints: 0 }]))).toBe(false);
    expect(ok(UpdateTestDraftRequest, withCriteria([{ ...crit, anchors: [] }]))).toBe(false);
    expect(ok(UpdateTestDraftRequest, withCriteria([{ ...crit, minHits: 3 }]))).toBe(false); // more hits than anchors
    expect(ok(UpdateTestDraftRequest, withCriteria([{ ...crit, minHits: 0 }]))).toBe(false);
    expect(ok(UpdateTestDraftRequest, withCriteria([crit, crit]))).toBe(false); // duplicate criterion id
  });
});

describe('publish, assignments, invitations', () => {
  it('PublishTestRequest names the draft version and nothing else (L-9)', () => {
    expect(PublishTestRequest.parse({ testVersionId: id(3) })).toEqual({ testVersionId: id(3) });
    expect(ok(PublishTestRequest, { testVersionId: id(3), expectedRevision: 1 })).toBe(false);
    expect(ok(PublishTestRequest, { testVersionId: id(3), qualityCutoff: 40 })).toBe(false);
    expect(ok(PublishTestRequest, {})).toBe(false);
    const res = {
      testVersionId: id(3),
      versionNo: 1,
      status: 'published',
      publishedAt: T0,
      contentSha256: HEX,
      qualityCutoff: 40,
    };
    expect(PublishTestResponse.parse(res)).toEqual(res);
    expect(ok(PublishTestResponse, { ...res, status: 'draft' })).toBe(false);
    expect(ok(PublishTestResponse, { ...res, contentSha256: 'abc' })).toBe(false);
  });
  it('assignments', () => {
    expect(CreateAssignmentRequest.parse({ membershipId: id(8), asRole: 'reviewer' })).toEqual({
      membershipId: id(8),
      asRole: 'reviewer',
    });
    expect(ok(CreateAssignmentRequest, { membershipId: id(8), asRole: 'hiring_manager' })).toBe(
      false,
    );
    expect(
      ok(CreateAssignmentRequest, { membershipId: id(8), asRole: 'reviewer', testId: id(1) }),
    ).toBe(false);
    const list = {
      assignments: [
        {
          id: id(9),
          membershipId: id(8),
          asRole: 'reviewer',
          displayName: 'Reviewer One',
          createdAt: T0,
        },
      ],
    };
    expect(AssignmentListResponse.parse(list)).toEqual(list);
    expect(
      ok(AssignmentListResponse, { assignments: [{ ...list.assignments[0], extra: 1 }] }),
    ).toBe(false);
  });
  it('CreateInvitationRequest: synthetic address, inviter age answer present but nullable', () => {
    const req = { contactEmail: 'cand.one+a@example.test', adultConfirmedByInviter: true };
    expect(CreateInvitationRequest.parse(req)).toEqual(req);
    expect(ok(CreateInvitationRequest, { ...req, adultConfirmedByInviter: null })).toBe(true);
    expect(ok(CreateInvitationRequest, { ...req, adultConfirmedByInviter: false })).toBe(true);
    expect(ok(CreateInvitationRequest, { contactEmail: req.contactEmail })).toBe(false);
    for (const bad of [
      'a@example.com',
      'A@example.test',
      'a@sub.example.test',
      `${'a'.repeat(65)}@example.test`,
      'a b@example.test',
    ]) {
      expect(ok(CreateInvitationRequest, { ...req, contactEmail: bad }), bad).toBe(false);
    }
    expect(ok(CreateInvitationRequest, { ...req, name: 'Someone' })).toBe(false); // no name or phone field exists (D1-1)
    expect(ok(CreateInvitationRequest, { ...req, phone: '1' })).toBe(false);
  });
  it('CreateInvitationResponse: a link unless blocked_age (rule 9)', () => {
    const res = {
      invitationId: id(10),
      label: 'Candidate 1',
      status: 'sent',
      inviteUrl: 'https://candidate.example.test/i#' + 'L'.repeat(43),
    };
    expect(CreateInvitationResponse.parse(res)).toEqual(res);
    expect(ok(CreateInvitationResponse, { ...res, status: 'blocked_age', inviteUrl: null })).toBe(
      true,
    );
    expect(ok(CreateInvitationResponse, { ...res, status: 'blocked_age' })).toBe(false); // blocked gets no link
    expect(ok(CreateInvitationResponse, { ...res, inviteUrl: null })).toBe(false); // a live invitation needs its link
    expect(ok(CreateInvitationResponse, { ...res, label: 'Alice' })).toBe(false);
    expect(ok(CreateInvitationResponse, { ...res, status: 'rejected' })).toBe(false);
  });
  it('InvitationListResponse carries no contact field', () => {
    const list = {
      invitations: [
        { id: id(10), label: 'Candidate 1', status: 'sent', createdAt: T0, expiresAt: T1 },
      ],
    };
    expect(InvitationListResponse.parse(list)).toEqual(list);
    expect(
      ok(InvitationListResponse, {
        invitations: [{ ...list.invitations[0], contactEmail: 'a@example.test' }],
      }),
    ).toBe(false);
    expect(
      keysMatching(InvitationListResponse, /email|contact|phone|name|address|token|url|hash/i),
    ).toEqual([]);
  });
});

// ---- Results, report, cards ---------------------------------------------------------------------------------------

const qualityReady = { state: 'ready', score: 72, belowCutoff: false };
const row = { reportId: id(20), label: 'Candidate 1', submittedAt: T0, quality: qualityReady };

describe('results list and review queue: Answer Quality only', () => {
  it('ResultRow: pending or ready; belowCutoff is a boolean, never null', () => {
    expect(ResultRow.parse(row)).toEqual(row);
    expect(ok(ResultRow, { ...row, quality: { state: 'pending' } })).toBe(true);
    expect(ok(ResultRow, { ...row, quality: { ...qualityReady, belowCutoff: true } })).toBe(true);
    expect(ok(ResultRow, { ...row, quality: { ...qualityReady, belowCutoff: null } })).toBe(false);
    expect(ok(ResultRow, { ...row, quality: { state: 'ready', score: 72 } })).toBe(false);
    expect(ok(ResultRow, { ...row, quality: { state: 'ready', belowCutoff: false } })).toBe(false);
    expect(ok(ResultRow, { ...row, quality: { state: 'pending', score: 1 } })).toBe(false);
    expect(ok(ResultRow, { ...row, quality: { ...qualityReady, score: 101 } })).toBe(false);
    expect(ok(ResultRow, { ...row, quality: { ...qualityReady, score: 72.5 } })).toBe(false);
    expect(ok(ResultRow, { ...row, quality: { state: 'failed' } })).toBe(false);
  });
  it('ResultRow has no integrity field in any form', () => {
    expect(
      keysMatching(
        ResultRow,
        /integrity|band|flag|signal|coverage|evidence|review|timeline|photo/i,
      ),
    ).toEqual([]);
    for (const key of ['integrity', 'band', 'flags', 'integrityState']) {
      expect(ok(ResultRow, { ...row, [key]: 'clear' }), key).toBe(false);
    }
    expect(schemaKeys(ResultRow)).toEqual([
      'belowCutoff',
      'label',
      'quality',
      'reportId',
      'score',
      'state',
      'submittedAt',
    ]);
  });
  it('ResultsListResponse: the pinned cutoff plus rows', () => {
    const list = { cutoff: 40, rows: [row] };
    expect(ResultsListResponse.parse(list)).toEqual(list);
    expect(ok(ResultsListResponse, { ...list, cutoff: null })).toBe(false);
    expect(ok(ResultsListResponse, { ...list, cutoff: 101 })).toBe(false);
    expect(ok(ResultsListResponse, { ...list, selected: [] })).toBe(false); // no row selection or bulk action
  });
  it('ReviewQueueResponse rows are quality only', () => {
    const queue = {
      reports: [{ ...row, testId: id(1), testName: 'Sample test' }],
    };
    expect(ReviewQueueResponse.parse(queue)).toEqual(queue);
    expect(ok(ReviewQueueResponse, { reports: [{ ...row, band: 'review' }] })).toBe(false);
    expect(
      keysMatching(
        ReviewQueueResponse,
        /integrity|band|flag|signal|coverage|evidence|timeline|photo/i,
      ),
    ).toEqual([]);
  });
});

describe('ReportMetaResponse (§6.2): metadata and versions only', () => {
  const meta = {
    report: {
      id: id(20),
      label: 'Candidate 1',
      testName: 'Sample test',
      testVersion: 1,
      submittedAt: T0,
      receiptRefPrefix: 'ABCD',
      noticeHashPrefix: 'bbbbbbbb',
    },
    versions: {
      quality: { rubricVersion: 'rubric-v1', scoringVersion: 'd1-scoring-v1' },
      integrity: { rulesetVersion: 'ruleset-v1' },
    },
  };
  it('accepts the exact shape, with the quality versions null while the card is pending', () => {
    expect(ReportMetaResponse.parse(meta)).toEqual(meta);
    expect(ok(ReportMetaResponse, { ...meta, versions: { ...meta.versions, quality: null } })).toBe(
      true,
    );
    expect(
      ok(ReportMetaResponse, { ...meta, versions: { ...meta.versions, integrity: null } }),
    ).toBe(false);
    expect(ok(ReportMetaResponse, { ...meta, extra: 1 })).toBe(false);
    expect(ok(ReportMetaResponse, { ...meta, report: { ...meta.report, extra: 1 } })).toBe(false);
  });
  it('has exactly the §6.2 keys and no card field', () => {
    expect(schemaKeys(ReportMetaResponse)).toEqual([
      'id',
      'integrity',
      'label',
      'noticeHashPrefix',
      'quality',
      'receiptRefPrefix',
      'report',
      'rubricVersion',
      'rulesetVersion',
      'scoringVersion',
      'submittedAt',
      'testName',
      'testVersion',
      'versions',
    ]);
    expect(
      keysMatching(
        ReportMetaResponse,
        /card|band|score$|flag|timeline|coverage|evidence|photo|cutoff/i,
      ),
    ).toEqual([]);
  });
});

describe('QualityCard and IntegrityCard (rule 1, rule 6)', () => {
  const quality = {
    state: 'ready',
    score: 72,
    sections: [
      { sectionId: id(4), name: 'Part A', weight: 1, scoreHundredths: 8000 },
      { sectionId: id(6), name: 'Part B', weight: 2, scoreHundredths: 6800 },
    ],
    graderModelId: 'mock-grader-v1',
    rubricVersion: 'rubric-v1',
    scoringVersion: 'd1-scoring-v1',
  };
  const flag = {
    ruleId: 'D1-PASTE',
    family: 'paste',
    tier: 'T3',
    atMs: 45000,
    count: 1,
    observed: { len: 120 },
    signalSeqs: [7],
    state: 'pending',
  };
  const entry = {
    position: 1,
    entryKind: 'flag',
    signalKind: 'paste',
    family: 'paste',
    ruleId: 'D1-PASTE',
    tier: 'T3',
    atMs: 45000,
    count: 1,
    observed: { len: 120 },
    flagState: 'pending',
    signalSeqs: [7],
  };
  const ready = {
    state: 'ready',
    band: 'review',
    evidenceStrength: 1,
    coveragePct: 96.5,
    photoMissing: false,
    reasons: ['A paste event was recorded.'],
    flags: [flag],
    timeline: [entry],
    signalsByFamily: [
      { family: 'paste', flagCount: 1, contextCount: 0 },
      { family: 'input_origin', flagCount: 0, contextCount: 0 },
      { family: 'focus', flagCount: 0, contextCount: 2 },
      { family: 'connectivity', flagCount: 0, contextCount: 1 },
    ],
    ruleTableVersion: 'd1-v1',
    engineVersion: 'band-engine-1',
  };

  it('QualityCard: pending or ready, no integrity value', () => {
    expect(QualityCard.parse({ state: 'pending' })).toEqual({ state: 'pending' });
    expect(QualityCard.parse(quality)).toEqual(quality);
    expect(ok(QualityCard, { state: 'pending', score: 1 })).toBe(false);
    expect(ok(QualityCard, { ...quality, score: 101 })).toBe(false);
    expect(ok(QualityCard, { ...quality, band: 'clear' })).toBe(false);
    expect(ok(QualityCard, { ...quality, integrity: {} })).toBe(false);
    expect(
      ok(QualityCard, {
        ...quality,
        sections: [{ ...quality.sections[0], scoreHundredths: 10001 }],
      }),
    ).toBe(false);
    expect(ok(QualityCard, { state: 'not_used_below_cutoff' })).toBe(false);
  });
  it('IntegrityCard: pending | ready | not_used_below_cutoff, and nothing else', () => {
    expect(IntegrityCard.parse({ state: 'pending' })).toEqual({ state: 'pending' });
    expect(IntegrityCard.parse({ state: 'not_used_below_cutoff' })).toEqual({
      state: 'not_used_below_cutoff',
    });
    expect(IntegrityCard.parse(ready)).toEqual(ready);
    expect(ok(IntegrityCard, { state: 'failed' })).toBe(false);
    expect(ok(IntegrityCard, { state: 'awaiting_quality' })).toBe(false);
  });
  it('rule 6: pending and below-cutoff payloads carry no band, flag or timeline key', () => {
    for (const state of ['pending', 'not_used_below_cutoff']) {
      for (const key of [
        'band',
        'evidenceStrength',
        'flags',
        'timeline',
        'coveragePct',
        'reasons',
        'photoMissing',
        'signalsByFamily',
      ]) {
        expect(
          ok(IntegrityCard, { state, [key]: key === 'band' ? 'clear' : [] }),
          `${state}+${key}`,
        ).toBe(false);
      }
    }
    const noBand: Record<string, unknown> = { ...ready };
    delete noBand.band;
    expect(ok(IntegrityCard, noBand)).toBe(false);
  });
  it('ready: band enum, evidence strength, coverage, flags and timeline with their evidence (AT-D19)', () => {
    for (const band of ['clear', 'review', 'strong_concern', 'insufficient_evidence']) {
      expect(ok(IntegrityCard, { ...ready, band }), band).toBe(true);
    }
    expect(ok(IntegrityCard, { ...ready, band: 'reject' })).toBe(false);
    expect(ok(IntegrityCard, { ...ready, band: 'pass' })).toBe(false);
    expect(ok(IntegrityCard, { ...ready, evidenceStrength: 1.01 })).toBe(false);
    expect(ok(IntegrityCard, { ...ready, coveragePct: 100.5 })).toBe(false);
    expect(ok(IntegrityCard, { ...ready, coveragePct: -1 })).toBe(false);
    expect(ok(IntegrityCard, { ...ready, extra: 1 })).toBe(false);
    for (const key of ['ruleId', 'tier', 'atMs', 'observed', 'signalSeqs']) {
      const partial: Record<string, unknown> = { ...flag };
      delete partial[key];
      expect(ok(IntegrityCard, { ...ready, flags: [partial] }), `flag without ${key}`).toBe(false);
    }
    expect(ok(IntegrityCard, { ...ready, flags: [{ ...flag, state: 'confirmed' }] })).toBe(false); // no confirm action in D1
    expect(ok(IntegrityCard, { ...ready, flags: [{ ...flag, state: 'not_used' }] })).toBe(false);
    expect(ok(IntegrityCard, { ...ready, flags: [{ ...flag, family: 'connectivity' }] })).toBe(
      false,
    );
    expect(ok(IntegrityCard, { ...ready, flags: [{ ...flag, tier: 'T4' }] })).toBe(false);
    expect(
      ok(IntegrityCard, {
        ...ready,
        flags: [{ ...flag, signalSeqs: Array.from({ length: 51 }, (_v, i) => i + 1) }],
      }),
    ).toBe(false);
    expect(
      ok(IntegrityCard, { ...ready, flags: [{ ...flag, observed: { text: 'pasted words' } }] }),
    ).toBe(false); // never paste content
    expect(
      ok(IntegrityCard, {
        ...ready,
        flags: [{ ...flag, observed: { durationMs: 4000, count: 2 } }],
      }),
    ).toBe(true);
  });
  it('timeline entries follow the table rules (flag vs context, connectivity)', () => {
    const context = {
      position: 2,
      entryKind: 'context',
      signalKind: 'tab_hidden',
      family: 'focus',
      ruleId: null,
      tier: null,
      atMs: 60000,
      count: 1,
      observed: { durationMs: 4000 },
      flagState: null,
      signalSeqs: [9],
    };
    const gap = {
      ...context,
      position: 3,
      signalKind: 'connectivity_gap',
      family: 'connectivity',
      observed: {},
    };
    expect(ok(IntegrityCard, { ...ready, timeline: [entry, context, gap] })).toBe(true);
    expect(ok(IntegrityCard, { ...ready, timeline: [{ ...gap, family: 'focus' }] })).toBe(false); // a gap is never focus
    expect(
      ok(IntegrityCard, {
        ...ready,
        timeline: [{ ...gap, entryKind: 'flag', ruleId: 'R', tier: 'T3', flagState: 'pending' }],
      }),
    ).toBe(false);
    expect(ok(IntegrityCard, { ...ready, timeline: [{ ...entry, ruleId: null }] })).toBe(false); // a flag carries its rule
    expect(ok(IntegrityCard, { ...ready, timeline: [{ ...context, ruleId: 'D1-X' }] })).toBe(false); // context carries none
    expect(ok(IntegrityCard, { ...ready, timeline: [{ ...entry, signalKind: 'copy' }] })).toBe(
      false,
    );
    expect(ok(IntegrityCard, { ...ready, timeline: [{ ...entry, position: 0 }] })).toBe(false);
  });
  it('QualityCard has no integrity key; IntegrityCard has no quality, score or cutoff key (AT-D3)', () => {
    expect(
      keysMatching(
        QualityCard,
        /integrity|band|flag|timeline|coverage|evidence|review|signal|photo|tier|family/i,
      ),
    ).toEqual([]);
    expect(
      keysMatching(
        IntegrityCard,
        /quality|score|cutoff|grade|rubric|grader|section|weight|belowCutoff/i,
      ),
    ).toEqual([]);
  });
  it('QualityCard and IntegrityCard share no schema object (independent definitions)', () => {
    expect(sharedNodes(QualityCard, IntegrityCard)).toEqual([]);
    expect(sharedNodes(QualityCardRow, IntegrityCardRow)).toEqual([]);
    expect(sharedNodes(QualityCardRow, IntegrityTimelineEntryRow)).toEqual([]);
    expect(sharedNodes(ResultRow, IntegrityCard)).toEqual([]);
    expect(sharedNodes(ReviewQueueResponse, IntegrityCard)).toEqual([]);
    expect(sharedNodes(ReportMetaResponse, IntegrityCard)).toEqual([]);
    expect(sharedNodes(ReportMetaResponse, QualityCard)).toEqual([]);
  });
  it('the walker really sees shared nodes (guards the test above against a vacuous pass)', () => {
    const shared = z.string();
    expect(sharedNodes(z.strictObject({ a: shared }), z.strictObject({ b: shared })).length).toBe(
      1,
    );
  });
});

describe('MediaLinkResponse and OutboxListResponse and ApiError', () => {
  it('MediaLinkResponse', () => {
    const link = {
      url: `https://api.example.test/media/${'j'.repeat(32)}?exp=1790000300&sig=${'s'.repeat(43)}`,
      expiresAt: T0,
      watermark: { viewerRole: 'reviewer', org: 'Acme Hiring', issuedAt: T0 },
    };
    expect(MediaLinkResponse.parse(link)).toEqual(link);
    expect(
      ok(MediaLinkResponse, { ...link, watermark: { ...link.watermark, viewerRole: 'superuser' } }),
    ).toBe(false);
    expect(ok(MediaLinkResponse, { ...link, url: 'not a url' })).toBe(false);
    expect(ok(MediaLinkResponse, { ...link, key: 'media/o/s/start_photo.jpg' })).toBe(false); // the R2 key is never returned
    expect(
      ok(MediaLinkResponse, { ...link, watermark: { viewerRole: 'reviewer', org: 'x' } }),
    ).toBe(false);
  });
  it('OutboxListResponse', () => {
    const list = {
      entries: [
        {
          id: id(30),
          createdAt: T0,
          kind: 'otp',
          candidateLabel: 'Candidate 1',
          bodyText: 'Your code is 123456',
        },
      ],
    };
    expect(OutboxListResponse.parse(list)).toEqual(list);
    expect(ok(OutboxListResponse, { entries: [{ ...list.entries[0], kind: 'sms' }] })).toBe(false);
    expect(
      ok(OutboxListResponse, { entries: [{ ...list.entries[0], to: 'a@example.test' }] }),
    ).toBe(false);
  });
  it('ApiError is {error:{code}} and never echoes input', () => {
    expect(ApiError.parse({ error: { code: 'cutoff_required' } })).toEqual({
      error: { code: 'cutoff_required' },
    });
    expect(ok(ApiError, { error: { code: 'aal2_required' } })).toBe(true);
    expect(ok(ApiError, { error: 'cutoff_required' })).toBe(false);
    expect(ok(ApiError, { error: { code: 'cutoff_required', message: 'bad input: x' } })).toBe(
      false,
    );
    expect(ok(ApiError, { error: { code: 'Has Spaces' } })).toBe(false);
    expect(ok(ApiError, { error: { code: '' } })).toBe(false);
  });
});

// ---- Row schemas (public card tables, as the api reads them) ------------------------------------------------------

describe('card row schemas (migration 3)', () => {
  const qRow = {
    id: id(40),
    org_id: id(41),
    workspace_id: id(42),
    test_id: id(1),
    session_id: id(43),
    quality_score_id: id(44),
    score: 72,
    section_scores: [{ sectionId: id(4), weight: 1, scoreHundredths: 8000 }],
    quality_cutoff: 40,
    meets_cutoff: true,
    scoring_version: 'd1-scoring-v1',
    rubric_set_sha256: HEX,
    rubric_version_ids: [id(45)],
    grader_model_id: 'mock-grader-v1',
    grader_adapter_version: 'mock-1',
    test_version_id: id(3),
    computed_at: T1,
  };
  const iRow = {
    id: id(50),
    org_id: id(41),
    workspace_id: id(42),
    test_id: id(1),
    session_id: id(43),
    integrity_result_id: id(51),
    ruleset_version_id: id(52),
    band_rule_version_id: id(53),
    rule_table_version: 'd1-v1',
    engine_version: 'band-engine-1',
    review_state: 'reviewed',
    band: 'review',
    evidence_strength: 0.67,
    coverage_permille: 965,
    coverage_floor_permille: 700,
    photo_missing: false,
    computed_at: T1,
  };
  const tRow = {
    id: id(60),
    org_id: id(41),
    workspace_id: id(42),
    test_id: id(1),
    session_id: id(43),
    integrity_card_id: id(50),
    position: 1,
    entry_kind: 'flag',
    signal_kind: 'paste',
    family: 'paste',
    rule_id: 'D1-PASTE',
    tier: 'T3',
    offset_ms: 45000,
    count: 1,
    observed: { len: 120 },
    flag_state: 'pending',
    signal_seqs: [7],
  };

  it('QualityCardRow: every column, strict, meets_cutoff agrees with the score', () => {
    expect(QualityCardRow.parse(qRow)).toEqual(qRow);
    expect(ok(QualityCardRow, { ...qRow, extra: 1 })).toBe(false);
    expect(ok(QualityCardRow, { ...qRow, meets_cutoff: null })).toBe(false);
    expect(ok(QualityCardRow, { ...qRow, meets_cutoff: false })).toBe(false); // 72 >= 40
    expect(ok(QualityCardRow, { ...qRow, score: 39, meets_cutoff: false })).toBe(true);
    expect(ok(QualityCardRow, { ...qRow, score: 40, meets_cutoff: true })).toBe(true);
    expect(ok(QualityCardRow, { ...qRow, score: 101 })).toBe(false);
    expect(ok(QualityCardRow, { ...qRow, rubric_set_sha256: 'abc' })).toBe(false);
    expect(
      ok(QualityCardRow, { ...qRow, rubric_version_ids: Array.from({ length: 21 }, () => id(45)) }),
    ).toBe(false);
    expect(keysMatching(QualityCardRow, /integrity|band|flag|timeline|coverage|evidence/i)).toEqual(
      [],
    );
  });
  it('IntegrityCardRow: every column, strict, no quality column', () => {
    expect(IntegrityCardRow.parse(iRow)).toEqual(iRow);
    expect(ok(IntegrityCardRow, { ...iRow, extra: 1 })).toBe(false);
    for (const review_state of ['reviewed', 'not_reviewed_below_cutoff', 'awaiting_quality']) {
      expect(ok(IntegrityCardRow, { ...iRow, review_state }), review_state).toBe(true);
    }
    expect(ok(IntegrityCardRow, { ...iRow, review_state: 'rejected' })).toBe(false);
    expect(ok(IntegrityCardRow, { ...iRow, band: 'reject' })).toBe(false);
    expect(ok(IntegrityCardRow, { ...iRow, evidence_strength: 1.5 })).toBe(false);
    expect(ok(IntegrityCardRow, { ...iRow, coverage_permille: 1001 })).toBe(false);
    expect(ok(IntegrityCardRow, { ...iRow, photo_missing: null })).toBe(false);
    expect(keysMatching(IntegrityCardRow, /quality|score|cutoff|grade|rubric/i)).toEqual([]);
  });
  it('IntegrityTimelineEntryRow: the table CHECKs, and observed holds metadata keys only', () => {
    expect(IntegrityTimelineEntryRow.parse(tRow)).toEqual(tRow);
    expect(ok(IntegrityTimelineEntryRow, { ...tRow, extra: 1 })).toBe(false);
    expect(
      ok(IntegrityTimelineEntryRow, { ...tRow, observed: { len: 1, duration_ms: 2, count: 3 } }),
    ).toBe(true);
    expect(ok(IntegrityTimelineEntryRow, { ...tRow, observed: { text: 'x' } })).toBe(false);
    expect(ok(IntegrityTimelineEntryRow, { ...tRow, flag_state: 'not_used' })).toBe(false); // pending only in D1 (L-3)
    expect(ok(IntegrityTimelineEntryRow, { ...tRow, flag_state: null })).toBe(false); // a flag carries its state
    expect(ok(IntegrityTimelineEntryRow, { ...tRow, entry_kind: 'context' })).toBe(false); // context carries no rule
    const context = {
      ...tRow,
      entry_kind: 'context',
      rule_id: null,
      tier: null,
      flag_state: null,
      signal_kind: 'tab_hidden',
      family: 'focus',
    };
    expect(ok(IntegrityTimelineEntryRow, context)).toBe(true);
    const gap = {
      ...context,
      signal_kind: 'connectivity_gap',
      family: 'connectivity',
      observed: {},
    };
    expect(ok(IntegrityTimelineEntryRow, gap)).toBe(true);
    expect(ok(IntegrityTimelineEntryRow, { ...gap, family: 'focus' })).toBe(false);
    expect(ok(IntegrityTimelineEntryRow, { ...tRow, signal_kind: 'copy' })).toBe(false);
    expect(
      ok(IntegrityTimelineEntryRow, {
        ...tRow,
        signal_seqs: Array.from({ length: 51 }, (_v, i) => i),
      }),
    ).toBe(false);
    expect(ok(IntegrityTimelineEntryRow, { ...tRow, offset_ms: -1 })).toBe(false);
  });
});

// ---- Sweeps over every exported schema ----------------------------------------------------------------------------

const exported = Object.entries(D1).filter(([, value]) => value instanceof z.ZodType) as [
  string,
  z.ZodType,
][];

describe('every D1 schema', () => {
  it('the module exports the contracts the spec names', () => {
    const names = exported.map(([name]) => name);
    for (const name of [
      'TestListResponse',
      'CreateTestRequest',
      'UpdateTestDraftRequest',
      'TestDetailResponse',
      'PublishTestRequest',
      'PublishTestResponse',
      'CreateAssignmentRequest',
      'AssignmentListResponse',
      'CreateInvitationRequest',
      'CreateInvitationResponse',
      'InvitationListResponse',
      'ResultsListResponse',
      'ResultRow',
      'ReportMetaResponse',
      'QualityCard',
      'IntegrityCard',
      'ReviewQueueResponse',
      'MediaLinkResponse',
      'OutboxListResponse',
      'ApiError',
      'QualityCardRow',
      'IntegrityCardRow',
      'IntegrityTimelineEntryRow',
    ]) {
      expect(names, name).toContain(name);
    }
  });
  it.each(exported)('%s: no combined-result key (rule 1, AT-D3)', (_name, schema) => {
    expect(keysMatching(schema, /overall|combined|total|trust|honesty|composite/i)).toEqual([]);
  });
  it.each(exported)('%s: nothing from the never-build list (rule 7)', (_name, schema) => {
    expect(
      keysMatching(
        schema,
        /emotion|stress|personality|gaze|ai_?likeness|voiceprint|faceMatch|face_template|asn$/i,
      ),
    ).toEqual([]);
  });
  it.each(exported)('%s: strict at every depth', (_name, schema) => {
    expect(allObjectsStrict(schema)).toBe(true);
  });
  it('no schema offers a reject, decision or appeal path (rules 2, 4)', () => {
    for (const [name, schema] of exported) {
      expect(
        keysMatching(schema, /reject|decision|decide|overturn|appeal|shortlist/i),
        name,
      ).toEqual([]);
    }
  });
});
