// The rows the reports module selects as the caller (spec §6.2), each with an explicit column list: no contact
// address, no link-token hash, no score detail beyond what a payload needs, and nothing from an integrity table.
// Every schema is strict, so a column the select did not ask for fails closed.
import { z } from 'zod';

export const ReportRef = z.strictObject({
  id: z.uuid(),
  test_id: z.uuid(),
  session_id: z.uuid(),
  quality_card_id: z.uuid().nullable(),
  created_at: z.string(),
});
export type ReportRef = z.infer<typeof ReportRef>;
export const REPORT_REF_COLUMNS = 'id,test_id,session_id,quality_card_id,created_at';

export const SessionMeta = z.strictObject({
  id: z.uuid(),
  invitation_id: z.uuid(),
  consent_id: z.uuid(),
  test_version_id: z.uuid(),
  ruleset_version_id: z.uuid(),
  submitted_at: z.string().nullable(),
  receipt_ref: z.string(),
});
export const SESSION_META_COLUMNS =
  'id,invitation_id,consent_id,test_version_id,ruleset_version_id,submitted_at,receipt_ref';

export const SessionListRow = z.strictObject({
  id: z.uuid(),
  invitation_id: z.uuid(),
  submitted_at: z.string().nullable(),
});
export const SESSION_LIST_COLUMNS = 'id,invitation_id,submitted_at';

export const InvitationLabel = z.strictObject({ id: z.uuid(), candidate_label: z.string() });
export const INVITATION_LABEL_COLUMNS = 'id,candidate_label';

export const ConsentHash = z.strictObject({ rendered_sha256: z.string() });

export const TestVersionNo = z.strictObject({ version_no: z.int() });

export const TestVersionCutoff = z.strictObject({
  version_no: z.int(),
  status: z.enum(['draft', 'published', 'retired']),
  quality_cutoff: z.int(),
});

export const TestName = z.strictObject({ id: z.uuid(), name: z.string() });

/** The quality versions the metadata names (§6.2); never a score. */
export const QualityVersions = z.strictObject({
  scoring_version: z.string(),
  rubric_set_sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

/** The quality summary a results row shows: the score and the boolean cutoff mark (L-15, never null). */
export const QualitySummary = z.strictObject({
  id: z.uuid(),
  session_id: z.uuid(),
  score: z.int().min(0).max(100),
  meets_cutoff: z.boolean(),
});
export const QUALITY_SUMMARY_COLUMNS = 'id,session_id,score,meets_cutoff';

export const MembershipRoles = z.strictObject({ id: z.uuid(), roles: z.array(z.string()) });

export const AssignedTest = z.strictObject({ test_id: z.uuid() });
