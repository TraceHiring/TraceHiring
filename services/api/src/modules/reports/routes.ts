// The neutral reports module (spec §6.2, L-19): the results list, the report metadata and the reviewer queue. It
// serves Answer Quality only in lists and never a card; it imports neither card module (rule 1, rule1-separation
// test). Every read is as the caller through PostgREST (RLS decides) and filtered by the path org; anything the
// caller cannot see is 404; every answer is strictly parsed against the contract first (a mismatch is `unavailable`).
import {
  ReportMetaResponse,
  ResultsListResponse,
  ReviewQueueResponse,
} from '@trace/shared/contracts/d1';
import { Hono } from 'hono';
import type { z } from 'zod';
import { handleOrg, orgFail, orgJson, pathId, type OrgDeps } from '../tests/org-context.js';
import { loadReportMeta } from './report-meta.js';
import { loadResults, loadReviewQueue } from './results.js';

export const RESULTS_PATH = '/v1/orgs/:orgId/tests/:testId/results';
export const REPORT_META_PATH = '/v1/orgs/:orgId/reports/:reportId';
export const REVIEW_QUEUE_PATH = '/v1/orgs/:orgId/review/reports';

const answer = <T>(schema: z.ZodType<T>, body: unknown): Response => {
  const out = schema.safeParse(body);
  return out.success ? orgJson(out.data) : orgFail('unavailable');
};

/** The sub-router the lead mounts with `app.route('/', createReportsRoutes(orgDeps))`. */
export const createReportsRoutes = (deps: OrgDeps): Hono<{ Bindings: Env }> => {
  const app = new Hono<{ Bindings: Env }>();

  app.get(RESULTS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const testId = pathId(c.req.param('testId'));
      const { rest } = await deps.context(c.req.raw, c.env);
      return answer(ResultsListResponse, await loadResults(rest, orgId, testId));
    }),
  );

  app.get(REPORT_META_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const reportId = pathId(c.req.param('reportId'));
      const { rest } = await deps.context(c.req.raw, c.env);
      return answer(ReportMetaResponse, await loadReportMeta(rest, orgId, reportId));
    }),
  );

  app.get(REVIEW_QUEUE_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const { caller, rest } = await deps.context(c.req.raw, c.env);
      return answer(ReviewQueueResponse, await loadReviewQueue(rest, caller, orgId));
    }),
  );

  return app;
};
