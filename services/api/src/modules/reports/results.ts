// GET /v1/orgs/:orgId/tests/:testId/results -> ResultsListResponse and GET /v1/orgs/:orgId/review/reports ->
// ReviewQueueResponse (spec §6.1, §6.2, §6.3). Answer Quality only (rule 1): a row is the report id, the candidate
// label, the submit time and `quality` (pending, or the score with the boolean `belowCutoff`, never null, L-15). No
// row has an integrity field, and nothing here reads an integrity table, so no band can be sorted or filtered on.
// "Below cutoff" is a plain mark with no action (rule 6; D1 has no bulk action).
import type {
  ResultRow,
  ResultsListResponse,
  ReviewQueueResponse,
} from '@trace/shared/contracts/d1';
import { eq, orgFail, type OrgCaller, type Rest } from '../tests/org-context.js';
import { orgReader, type OrgReader } from './read.js';
import {
  AssignedTest,
  InvitationLabel,
  INVITATION_LABEL_COLUMNS,
  MembershipRoles,
  QualitySummary,
  QUALITY_SUMMARY_COLUMNS,
  ReportRef,
  REPORT_REF_COLUMNS,
  SessionListRow,
  SESSION_LIST_COLUMNS,
  TestName,
  TestVersionCutoff,
} from './rows.js';

/** The most reports one list returns (D1 is demo scale; pagination is M2). */
export const MAX_LIST_REPORTS = 500;

/** Quality-only rows for the given reports; a report whose session or label the caller cannot see is left out. */
const resultRows = async (
  read: OrgReader,
  reports: readonly ReportRef[],
): Promise<(ResultRow & { testId: string })[]> => {
  if (reports.length === 0) return [];
  const sessions = await read.rowsIn(
    SessionListRow,
    'sessions',
    'id',
    reports.map((r) => r.session_id),
    { select: SESSION_LIST_COLUMNS },
  );
  const bySession = new Map(sessions.map((s) => [s.id, s]));
  const [labels, quality] = await Promise.all([
    read.rowsIn(
      InvitationLabel,
      'invitations',
      'id',
      sessions.map((s) => s.invitation_id),
      { select: INVITATION_LABEL_COLUMNS },
    ),
    read.rowsIn(
      QualitySummary,
      'quality_cards',
      'id',
      reports.flatMap((r) => (r.quality_card_id === null ? [] : [r.quality_card_id])),
      { select: QUALITY_SUMMARY_COLUMNS },
    ),
  ]);
  const labelOf = new Map(labels.map((l) => [l.id, l.candidate_label]));
  const qualityOf = new Map(quality.map((q) => [q.id, q]));

  const rows: (ResultRow & { testId: string })[] = [];
  for (const report of reports) {
    const session = bySession.get(report.session_id);
    if (session === undefined || session.submitted_at === null) continue;
    const label = labelOf.get(session.invitation_id);
    if (label === undefined) continue;
    const q = report.quality_card_id === null ? undefined : qualityOf.get(report.quality_card_id);
    rows.push({
      testId: report.test_id,
      reportId: report.id,
      label,
      submittedAt: session.submitted_at,
      quality:
        q === undefined || q.session_id !== report.session_id
          ? { state: 'pending' }
          : { state: 'ready', score: q.score, belowCutoff: !q.meets_cutoff },
    });
  }
  return rows;
};

const byTimeDesc = (a: ResultRow, b: ResultRow): number =>
  Date.parse(b.submittedAt) - Date.parse(a.submittedAt) || (a.reportId < b.reportId ? -1 : 1);

/** Score descending (§6.1), then pending rows; ties by newest submit, then report id (deterministic). */
const byScoreDesc = (a: ResultRow, b: ResultRow): number => {
  const sa = a.quality.state === 'ready' ? a.quality.score : -1;
  const sb = b.quality.state === 'ready' ? b.quality.score : -1;
  return sb - sa || byTimeDesc(a, b);
};

const strip = ({ reportId, label, submittedAt, quality }: ResultRow): ResultRow => ({
  reportId,
  label,
  submittedAt,
  quality,
});

export const loadResults = async (
  rest: Rest,
  orgId: string,
  testId: string,
): Promise<ResultsListResponse> => {
  const read = orgReader(rest, orgId);
  await read.one(TestName, 'tests', { select: 'id,name', id: eq(testId) });
  const versions = await read.rows(TestVersionCutoff, 'test_versions', {
    select: 'version_no,status,quality_cutoff',
    test_id: eq(testId),
    order: 'version_no.desc',
  });
  // The cutoff pinned in the newest published (or retired) version; before the first publish, the draft's.
  const pinned = versions.find((v) => v.status !== 'draft') ?? versions[0];
  if (pinned === undefined) return orgFail('not_found');
  const reports = await read.rows(ReportRef, 'reports', {
    select: REPORT_REF_COLUMNS,
    test_id: eq(testId),
    order: 'created_at.desc',
    limit: String(MAX_LIST_REPORTS),
  });
  const rows = (await resultRows(read, reports)).sort(byScoreDesc).map(strip);
  return { cutoff: pinned.quality_cutoff, rows };
};

/**
 * The reviewer's queue: reports of the tests assigned to the caller's own reviewer membership in this org, newest
 * first (§6.1). aal2 is required (`aal2_required`); a caller with no reviewer membership here gets 404.
 */
export const loadReviewQueue = async (
  rest: Rest,
  caller: OrgCaller,
  orgId: string,
): Promise<ReviewQueueResponse> => {
  if (caller.aal !== 'aal2') return orgFail('aal2_required');
  const read = orgReader(rest, orgId);
  const membership = await read.maybe(MembershipRoles, 'memberships', {
    select: 'id,roles',
    user_id: eq(caller.userId),
    status: 'eq.active',
  });
  if (membership === null || !membership.roles.includes('reviewer')) return orgFail('not_found');
  const assigned = await read.rows(AssignedTest, 'assignments', {
    select: 'test_id',
    membership_id: eq(membership.id),
    as_role: 'eq.reviewer',
  });
  const testIds = [...new Set(assigned.map((a) => a.test_id))];
  if (testIds.length === 0) return { reports: [] };
  const tests = await read.rowsIn(TestName, 'tests', 'id', testIds, { select: 'id,name' });
  const nameOf = new Map(tests.map((t) => [t.id, t.name]));
  const reports = (
    await read.rowsIn(ReportRef, 'reports', 'test_id', [...nameOf.keys()], {
      select: REPORT_REF_COLUMNS,
      order: 'created_at.desc',
      limit: String(MAX_LIST_REPORTS),
    })
  ).slice(0, MAX_LIST_REPORTS);
  const rows = (await resultRows(read, reports)).sort(byTimeDesc);
  return {
    reports: rows.flatMap((row) => {
      const testName = nameOf.get(row.testId);
      return testName === undefined ? [] : [{ ...strip(row), testId: row.testId, testName }];
    }),
  };
};
