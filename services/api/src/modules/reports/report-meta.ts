// GET /v1/orgs/:orgId/reports/:reportId -> ReportMetaResponse (spec §6.2, L-19): metadata and versions only, from
// reports, sessions, invitations (label), consents (hash prefix), tests, test_versions and quality_cards (versions).
// Never from an integrity card or timeline, so nothing about a below-cutoff candidate leaks; no card field, no
// score, no band. Any row the caller cannot see is 404.
import type { ReportMetaResponse } from '@trace/shared/contracts/d1';
import { eq, orgFail, type Rest } from '../tests/org-context.js';
import { orgReader } from './read.js';
import {
  ConsentHash,
  InvitationLabel,
  INVITATION_LABEL_COLUMNS,
  QualityVersions,
  ReportRef,
  REPORT_REF_COLUMNS,
  SessionMeta,
  SESSION_META_COLUMNS,
  TestName,
  TestVersionNo,
} from './rows.js';

/** The receipt reference shown in the header: its first 8 characters (the whole D1 reference). */
export const RECEIPT_PREFIX_LENGTH = 8;
/** The notice hash shown in the header: the first 16 hex characters of the consent's rendered_sha256. */
export const NOTICE_HASH_PREFIX_LENGTH = 16;

/** The same label the quality card uses: a prefix of the rubric set's SHA-256 (L-23). */
const rubricVersionLabel = (rubricSetSha256: string): string =>
  `rubric-set-${rubricSetSha256.slice(0, 12)}`;

/** The response before the strict contract parse (the route parses it; a mismatch is `unavailable`). */
export const loadReportMeta = async (
  rest: Rest,
  orgId: string,
  reportId: string,
): Promise<ReportMetaResponse> => {
  const read = orgReader(rest, orgId);
  const report = await read.one(ReportRef, 'reports', {
    select: REPORT_REF_COLUMNS,
    id: eq(reportId),
  });
  const session = await read.one(SessionMeta, 'sessions', {
    select: SESSION_META_COLUMNS,
    id: eq(report.session_id),
  });
  const [invitation, consent, version, test, quality] = await Promise.all([
    read.one(InvitationLabel, 'invitations', {
      select: INVITATION_LABEL_COLUMNS,
      id: eq(session.invitation_id),
    }),
    read.one(ConsentHash, 'consents', { select: 'rendered_sha256', id: eq(session.consent_id) }),
    read.one(TestVersionNo, 'test_versions', {
      select: 'version_no',
      id: eq(session.test_version_id),
    }),
    read.one(TestName, 'tests', { select: 'id,name', id: eq(report.test_id) }),
    report.quality_card_id === null
      ? Promise.resolve(null)
      : read.maybe(QualityVersions, 'quality_cards', {
          select: 'scoring_version,rubric_set_sha256',
          id: eq(report.quality_card_id),
          session_id: eq(session.id),
        }),
  ]);
  return {
    report: {
      id: report.id,
      label: invitation.candidate_label,
      testName: test.name,
      testVersion: version.version_no,
      // A report row exists only after the submit mirror, so submitted_at is set; null is a broken invariant.
      submittedAt: session.submitted_at ?? orgFail('unavailable'),
      receiptRefPrefix: session.receipt_ref.slice(0, RECEIPT_PREFIX_LENGTH),
      noticeHashPrefix: consent.rendered_sha256.slice(0, NOTICE_HASH_PREFIX_LENGTH),
    },
    versions: {
      quality:
        quality === null
          ? null
          : {
              rubricVersion: rubricVersionLabel(quality.rubric_set_sha256),
              scoringVersion: quality.scoring_version,
            },
      // The frozen ruleset the session ran under (sessions.ruleset_version_id), not an integrity card.
      integrity: { rulesetVersion: session.ruleset_version_id },
    },
  };
};
