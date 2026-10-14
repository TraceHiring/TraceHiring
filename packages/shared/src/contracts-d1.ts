// D1 org-endpoint contracts (specs/d1-demo-slice.md §6.2) and the public card rows the api reads (migration 3).
// Rule 1: the quality side and the integrity side are defined independently below. Nothing here carries a combined
// number, and no schema object is shared between QualityCard, IntegrityCard, the rows and the quality-only list rows.
// Every object schema is strict: an unknown key fails.
import { z } from 'zod';
import { OrgRole } from './contracts-tenancy.js';

// Small factories, so each schema gets its own node and the two result sides never share one.
const uuid = () => z.uuid();
const time = () => z.iso.datetime({ offset: true });
const sha256 = () => z.string().regex(/^[0-9a-f]{64}$/);
const posInt = () => z.int().min(1);
const percent = () => z.int().min(0).max(100);

const TestVersionStatus = z.enum(['draft', 'published', 'retired']);
const InvitationStatus = z.enum([
  'created',
  'sent',
  'otp_verified',
  'started',
  'submitted',
  'expired',
  'revoked',
  'blocked_age',
]);
const AssignableRole = z.enum(['org_owner', 'admin', 'recruiter', 'reviewer']);

/** `{ error: { code } }`, a constant lower-snake code; the body never echoes input (§6.2). */
export const ApiError = z.strictObject({
  error: z.strictObject({ code: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/) }),
});

// ---- Authoring ---------------------------------------------------------------------------------------------------

export const TestListResponse = z.strictObject({
  tests: z.array(
    z.strictObject({
      id: uuid(),
      name: z.string().min(1).max(200),
      status: TestVersionStatus,
      versionNo: posInt(),
      invitationCount: z.int().min(0),
      createdAt: time(),
    }),
  ),
});

/** The new test starts as a draft with `quality_cutoff = 40`; the cutoff is set through the draft update. */
export const CreateTestRequest = z.strictObject({
  name: z.string().min(1).max(200),
  durationMinutes: z.int().min(5).max(120).optional(),
  // Absent: the org's default workspace. A workspace-scoped recruiter names its own; RLS decides.
  workspaceId: z.uuid().optional(),
});

const mcqOptionsInput = () =>
  z
    .array(z.strictObject({ id: z.string().min(1).max(64), text: z.string().min(1).max(500) }))
    .min(2)
    .max(6);
const rubricInput = () =>
  z.strictObject({
    criteria: z
      .array(
        z
          .strictObject({
            id: z.string().min(1).max(64),
            label: z.string().min(1).max(200),
            maxPoints: z.int().min(1).max(100),
            anchors: z.array(z.string().min(1).max(100)).min(1).max(20),
            minHits: posInt(),
          })
          .refine((criterion) => criterion.minHits <= criterion.anchors.length, {
            message: 'minHits cannot exceed the number of anchors',
          }),
      )
      .min(1)
      .max(8),
  });
const uniqueIds = (rows: readonly { id: string }[]) =>
  new Set(rows.map((row) => row.id)).size === rows.length;
const rubricOk = (rubric: { criteria: readonly { id: string }[] }) => uniqueIds(rubric.criteria);
const mcqOk = (item: { options: readonly { id: string }[]; correctOptionId: string }) =>
  uniqueIds(item.options) && item.options.some((option) => option.id === item.correctOptionId);

const DraftMcqItem = z
  .strictObject({
    format: z.literal('mcq'),
    prompt: z.string().min(1).max(4000),
    options: mcqOptionsInput(),
    correctOptionId: z.string().min(1).max(64),
  })
  .refine(mcqOk, { message: 'option ids must be unique and the key must be one of them' });
const DraftWrittenItem = z.strictObject({
  format: z.literal('written'),
  prompt: z.string().min(1).max(4000),
  rubric: rubricInput().refine(rubricOk, { message: 'criterion ids must be unique' }),
});
const DraftItem = z.discriminatedUnion('format', [DraftMcqItem, DraftWrittenItem]);

/**
 * Replaces the draft's children. `qualityCutoff` is required (L-15): null, missing or out of range fails.
 * A half-written draft (no sections, empty sections) is valid; publish validates the content.
 */
export const UpdateTestDraftRequest = z
  .strictObject({
    name: z.string().min(1).max(200),
    durationMinutes: z.int().min(5).max(120),
    qualityCutoff: percent(),
    sections: z
      .array(
        z.strictObject({
          format: z.enum(['mcq', 'written']),
          name: z.string().min(1).max(120),
          weight: z.int().min(1).max(100),
          items: z.array(DraftItem).max(10),
        }),
      )
      .max(2),
  })
  .superRefine((draft, ctx) => {
    const formats = draft.sections.map((section) => section.format);
    if (new Set(formats).size !== formats.length) {
      ctx.addIssue({ code: 'custom', path: ['sections'], message: 'one section per format' });
    }
    draft.sections.forEach((section, s) => {
      section.items.forEach((item, i) => {
        if (item.format !== section.format) {
          ctx.addIssue({
            code: 'custom',
            path: ['sections', s, 'items', i, 'format'],
            message: 'item format differs from its section',
          });
        }
      });
    });
    if (draft.sections.reduce((n, section) => n + section.items.length, 0) > 10) {
      ctx.addIssue({ code: 'custom', path: ['sections'], message: 'at most 10 items' });
    }
  });
export type UpdateTestDraftRequest = z.infer<typeof UpdateTestDraftRequest>;

const detailMcqItem = () =>
  z
    .strictObject({
      id: uuid(),
      position: posInt(),
      format: z.literal('mcq'),
      prompt: z.string().min(1).max(4000),
      options: mcqOptionsInput(),
      correctOptionId: z.string().min(1).max(64),
    })
    .refine(mcqOk, { message: 'option ids must be unique and the key must be one of them' });
const detailWrittenItem = () =>
  z.strictObject({
    id: uuid(),
    position: posInt(),
    format: z.literal('written'),
    prompt: z.string().min(1).max(4000),
    rubric: rubricInput(),
  });

/** Org-side only (recruiter editor): it carries the answer key, so it is never built from or sent to the candidate path. */
export const TestDetailResponse = z.strictObject({
  test: z.strictObject({ id: uuid(), name: z.string().min(1).max(200), createdAt: time() }),
  version: z
    .strictObject({
      id: uuid(),
      versionNo: posInt(),
      status: TestVersionStatus,
      durationMinutes: z.int().min(1).max(120),
      qualityCutoff: percent(),
      publishedAt: time().nullable(),
      sections: z.array(
        z.strictObject({
          id: uuid(),
          position: posInt(),
          name: z.string().min(1).max(120),
          format: z.enum(['mcq', 'written']),
          weight: z.int().min(1).max(100),
          items: z
            .array(z.discriminatedUnion('format', [detailMcqItem(), detailWrittenItem()]))
            .max(10),
        }),
      ),
    })
    .refine((version) => (version.status === 'draft') === (version.publishedAt === null), {
      message: 'publishedAt is set exactly when the version is not a draft',
    }),
});

export const PublishTestRequest = z.strictObject({ testVersionId: uuid() });
export const PublishTestResponse = z.strictObject({
  testVersionId: uuid(),
  versionNo: posInt(),
  status: z.literal('published'),
  publishedAt: time(),
  contentSha256: sha256(),
  qualityCutoff: percent(),
});

// ---- Assignments and invitations -------------------------------------------------------------------------------

export const CreateAssignmentRequest = z.strictObject({
  membershipId: uuid(),
  asRole: AssignableRole,
});
export const AssignmentListResponse = z.strictObject({
  assignments: z.array(
    z.strictObject({
      id: uuid(),
      membershipId: uuid(),
      asRole: AssignableRole,
      displayName: z.string().min(1).max(120),
      createdAt: time(),
    }),
  ),
});

/** Synthetic-only contact (D1-1). The inviter's age answer is required but may be null ("not sure"). */
export const CreateInvitationRequest = z.strictObject({
  contactEmail: z.string().regex(/^[a-z0-9._+-]{1,64}@example\.test$/),
  adultConfirmedByInviter: z.boolean().nullable(),
});
/** `inviteUrl` is returned once, here only; a `blocked_age` invitation has none (rule 9). */
export const CreateInvitationResponse = z
  .strictObject({
    invitationId: uuid(),
    label: z.string().regex(/^Candidate [1-9][0-9]{0,8}$/),
    status: InvitationStatus,
    inviteUrl: z.url().nullable(),
  })
  .refine((res) => (res.status === 'blocked_age') === (res.inviteUrl === null), {
    message: 'a blocked invitation has no link and every other one has',
  });
/** No contact field of any kind. */
export const InvitationListResponse = z.strictObject({
  invitations: z.array(
    z.strictObject({
      id: uuid(),
      label: z.string().regex(/^Candidate [1-9][0-9]{0,8}$/),
      status: InvitationStatus,
      createdAt: time(),
      expiresAt: time(),
    }),
  ),
});

// ---- Results and review queue: Answer Quality only (rule 1) -----------------------------------------------------

const resultQuality = () =>
  z.discriminatedUnion('state', [
    z.strictObject({ state: z.literal('pending') }),
    z.strictObject({ state: z.literal('ready'), score: percent(), belowCutoff: z.boolean() }),
  ]);
const resultRowShape = () => ({
  reportId: uuid(),
  label: z.string().regex(/^Candidate [1-9][0-9]{0,8}$/),
  submittedAt: time(),
  quality: resultQuality(),
});

/** One result: quality only. `belowCutoff` is a boolean, never null. There is no integrity field. */
export const ResultRow = z.strictObject(resultRowShape());
export const ResultsListResponse = z.strictObject({ cutoff: percent(), rows: z.array(ResultRow) });
/** Same row shape plus the test it belongs to. */
export const ReviewQueueResponse = z.strictObject({
  reports: z.array(
    z.strictObject({
      ...resultRowShape(),
      testId: uuid(),
      testName: z.string().min(1).max(200),
    }),
  ),
});

// ---- Report metadata (no card, no band, no score) ---------------------------------------------------------------

export const ReportMetaResponse = z.strictObject({
  report: z.strictObject({
    id: uuid(),
    label: z.string().regex(/^Candidate [1-9][0-9]{0,8}$/),
    testName: z.string().min(1).max(200),
    testVersion: posInt(),
    submittedAt: time(),
    receiptRefPrefix: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{1,8}$/),
    noticeHashPrefix: z.string().regex(/^[0-9a-f]{1,64}$/),
  }),
  versions: z.strictObject({
    quality: z
      .strictObject({
        rubricVersion: z.string().min(1).max(64),
        scoringVersion: z.string().min(1).max(64),
      })
      .nullable(),
    integrity: z.strictObject({ rulesetVersion: z.string().min(1).max(64) }),
  }),
});

// ---- The two cards. Defined independently: no shared sub-schema, no shared key ----------------------------------

export const QualityCard = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('pending') }),
  z.strictObject({
    state: z.literal('ready'),
    score: z.int().min(0).max(100),
    sections: z.array(
      z.strictObject({
        sectionId: z.uuid(),
        name: z.string().min(1).max(120),
        weight: z.int().min(1).max(100),
        scoreHundredths: z.int().min(0).max(10000),
      }),
    ),
    graderModelId: z.string().min(1).max(64),
    rubricVersion: z.string().min(1).max(64),
    scoringVersion: z.string().min(1).max(64),
  }),
]);
export type QualityCard = z.infer<typeof QualityCard>;

// The table rules of public.integrity_timeline_entries (entry_kind / signal_kind / family / flag_state CHECKs).
const entryShapeOk = (e: {
  entryKind: string;
  signalKind: string;
  family: string | null;
  hasRule: boolean;
  hasTier: boolean;
  hasFlagState: boolean;
}) =>
  // Stricter than the table CHECK (F7): a flag entry also names its family, and never `connectivity`. The integrity
  // job must therefore always write a family on flag entries.
  (e.entryKind === 'flag'
    ? e.hasRule && e.hasTier && e.hasFlagState && e.family !== null && e.family !== 'connectivity'
    : !e.hasRule && !e.hasTier && !e.hasFlagState) &&
  (e.signalKind === 'connectivity_gap') === (e.family === 'connectivity') &&
  (e.signalKind !== 'connectivity_gap' || e.entryKind === 'context');

export const IntegrityCard = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('pending') }),
  z.strictObject({ state: z.literal('not_used_below_cutoff') }),
  z.strictObject({
    state: z.literal('ready'),
    band: z.enum(['clear', 'review', 'strong_concern', 'insufficient_evidence']),
    evidenceStrength: z.number().min(0).max(1),
    coveragePct: z.number().min(0).max(100),
    photoMissing: z.boolean(),
    reasons: z.array(z.string().min(1).max(300)).max(10),
    flags: z.array(
      z.strictObject({
        ruleId: z.string().min(1).max(64),
        family: z.enum(['paste', 'input_origin', 'focus']),
        tier: z.enum(['T1', 'T2', 'T3']),
        atMs: z.int().min(0),
        count: z.int().min(1),
        observed: z.strictObject({
          len: z.int().min(0).optional(),
          durationMs: z.int().min(0).optional(),
          count: z.int().min(0).optional(),
        }),
        signalSeqs: z.array(z.int().min(0)).max(50),
        state: z.literal('pending'),
      }),
    ),
    timeline: z.array(
      z
        .strictObject({
          position: z.int().min(1),
          entryKind: z.enum(['flag', 'context']),
          signalKind: z.enum([
            'paste',
            'drop',
            'untrusted_input',
            'tab_hidden',
            'fullscreen_exit',
            'connectivity_gap',
          ]),
          family: z.enum(['paste', 'input_origin', 'focus', 'connectivity']).nullable(),
          ruleId: z.string().min(1).max(64).nullable(),
          tier: z.enum(['T1', 'T2', 'T3']).nullable(),
          atMs: z.int().min(0),
          count: z.int().min(1),
          observed: z.strictObject({
            len: z.int().min(0).optional(),
            durationMs: z.int().min(0).optional(),
            count: z.int().min(0).optional(),
          }),
          flagState: z.literal('pending').nullable(),
          signalSeqs: z.array(z.int().min(0)).max(50),
        })
        .refine(
          (e) =>
            entryShapeOk({
              entryKind: e.entryKind,
              signalKind: e.signalKind,
              family: e.family,
              hasRule: e.ruleId !== null,
              hasTier: e.tier !== null,
              hasFlagState: e.flagState !== null,
            }),
          { message: 'timeline entry breaks the table rules' },
        ),
    ),
    signalsByFamily: z.array(
      z.strictObject({
        family: z.enum(['paste', 'input_origin', 'focus', 'connectivity']),
        flagCount: z.int().min(0),
        contextCount: z.int().min(0),
      }),
    ),
    ruleTableVersion: z.string().min(1).max(32),
    engineVersion: z.string().min(1).max(64),
  }),
]);
export type IntegrityCard = z.infer<typeof IntegrityCard>;

// ---- Media link and demo outbox ---------------------------------------------------------------------------------

/** The R2 key is never returned; the link is single use and expires within 5 minutes (rule 8). */
export const MediaLinkResponse = z.strictObject({
  url: z.url(),
  expiresAt: time(),
  watermark: z.strictObject({
    viewerRole: OrgRole,
    org: z.string().min(1).max(200),
    issuedAt: time(),
  }),
});

/** Non-production builds only. Recipients are not listed (the label stands in). */
export const OutboxListResponse = z.strictObject({
  entries: z.array(
    z.strictObject({
      id: uuid(),
      createdAt: time(),
      kind: z.enum(['invite', 'otp']),
      candidateLabel: z.string().regex(/^Candidate [1-9][0-9]{0,8}$/),
      bodyText: z.string().max(5000),
    }),
  ),
});

// ---- Row schemas: the public card tables as the api reads them (supabase/migrations/20261014151833_d1_results.sql) -

/** public.quality_cards. `meets_cutoff = (score >= quality_cutoff)` is a table CHECK, repeated here. */
export const QualityCardRow = z
  .strictObject({
    id: z.uuid(),
    org_id: z.uuid(),
    workspace_id: z.uuid(),
    test_id: z.uuid(),
    session_id: z.uuid(),
    quality_score_id: z.uuid(),
    score: z.int().min(0).max(100),
    section_scores: z.array(
      z.strictObject({
        sectionId: z.uuid(),
        weight: z.int().min(1).max(100),
        scoreHundredths: z.int().min(0).max(10000),
      }),
    ),
    quality_cutoff: z.int().min(0).max(100),
    meets_cutoff: z.boolean(),
    scoring_version: z.string().min(1).max(64),
    rubric_set_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    rubric_version_ids: z.array(z.uuid()).max(20),
    grader_model_id: z.string().min(1).max(64),
    grader_adapter_version: z.string().min(1).max(64),
    test_version_id: z.uuid(),
    computed_at: z.iso.datetime({ offset: true }),
  })
  .refine((row) => row.meets_cutoff === row.score >= row.quality_cutoff, {
    message: 'meets_cutoff must equal score >= quality_cutoff',
  });
export type QualityCardRow = z.infer<typeof QualityCardRow>;

/** public.integrity_cards. The api reads only `reviewed` cards through RLS (rule 6). */
export const IntegrityCardRow = z.strictObject({
  id: z.uuid(),
  org_id: z.uuid(),
  workspace_id: z.uuid(),
  test_id: z.uuid(),
  session_id: z.uuid(),
  integrity_result_id: z.uuid(),
  ruleset_version_id: z.uuid(),
  band_rule_version_id: z.uuid(),
  rule_table_version: z.string().min(1).max(32),
  engine_version: z.string().min(1).max(64),
  review_state: z.enum(['reviewed', 'not_reviewed_below_cutoff', 'awaiting_quality']),
  band: z.enum(['clear', 'review', 'strong_concern', 'insufficient_evidence']),
  evidence_strength: z.number().min(0).max(1),
  coverage_permille: z.int().min(0).max(1000),
  coverage_floor_permille: z.int().min(0).max(1000),
  photo_missing: z.boolean(),
  computed_at: z.iso.datetime({ offset: true }),
});
export type IntegrityCardRow = z.infer<typeof IntegrityCardRow>;

/** public.integrity_timeline_entries. `observed` holds metadata keys only, never pasted content. */
export const IntegrityTimelineEntryRow = z
  .strictObject({
    id: z.uuid(),
    org_id: z.uuid(),
    workspace_id: z.uuid(),
    test_id: z.uuid(),
    session_id: z.uuid(),
    integrity_card_id: z.uuid(),
    position: z.int().min(1),
    entry_kind: z.enum(['flag', 'context']),
    signal_kind: z.enum([
      'paste',
      'drop',
      'untrusted_input',
      'tab_hidden',
      'fullscreen_exit',
      'connectivity_gap',
    ]),
    family: z.enum(['paste', 'input_origin', 'focus', 'connectivity']).nullable(),
    rule_id: z.string().min(1).max(64).nullable(),
    tier: z.enum(['T1', 'T2', 'T3']).nullable(),
    offset_ms: z.int().min(0),
    count: z.int().min(1),
    observed: z.strictObject({
      len: z.int().min(0).optional(),
      duration_ms: z.int().min(0).optional(),
      count: z.int().min(0).optional(),
    }),
    flag_state: z.literal('pending').nullable(),
    signal_seqs: z.array(z.int().min(0)).max(50),
  })
  .refine(
    (row) =>
      entryShapeOk({
        entryKind: row.entry_kind,
        signalKind: row.signal_kind,
        family: row.family,
        hasRule: row.rule_id !== null,
        hasTier: row.tier !== null,
        hasFlagState: row.flag_state !== null,
      }),
    { message: 'timeline entry breaks the table rules' },
  );
export type IntegrityTimelineEntryRow = z.infer<typeof IntegrityTimelineEntryRow>;

// ---- Inferred types for the exported schemas that had none -----------------------------------------------------------

export type ApiError = z.infer<typeof ApiError>;
export type TestListResponse = z.infer<typeof TestListResponse>;
export type CreateTestRequest = z.infer<typeof CreateTestRequest>;
export type TestDetailResponse = z.infer<typeof TestDetailResponse>;
export type PublishTestRequest = z.infer<typeof PublishTestRequest>;
export type PublishTestResponse = z.infer<typeof PublishTestResponse>;
export type CreateAssignmentRequest = z.infer<typeof CreateAssignmentRequest>;
export type AssignmentListResponse = z.infer<typeof AssignmentListResponse>;
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequest>;
export type CreateInvitationResponse = z.infer<typeof CreateInvitationResponse>;
export type InvitationListResponse = z.infer<typeof InvitationListResponse>;
export type ResultRow = z.infer<typeof ResultRow>;
export type ResultsListResponse = z.infer<typeof ResultsListResponse>;
export type ReviewQueueResponse = z.infer<typeof ReviewQueueResponse>;
export type ReportMetaResponse = z.infer<typeof ReportMetaResponse>;
export type MediaLinkResponse = z.infer<typeof MediaLinkResponse>;
export type OutboxListResponse = z.infer<typeof OutboxListResponse>;
