// Test assignments (spec §6.2 rows `POST/GET …/tests/:testId/assignments`, `DELETE …/assignments/:id`; D1-14, R-15,
// L-16; AT-D10 assignment part). Owner and admin manage any test of the org; a recruiter manages **reviewer** rows
// only, and only on a test they are themselves assigned to (the creator is assigned at first publish). A reviewer, a
// hiring manager, a recruiter on another recruiter's test and anyone outside the org get 404.
//
// Every read and write is PostgREST as the caller, so RLS (assignments_*_owner_admin / _recruiter), the guard trigger
// (active membership holding the role, same workspace) and the audit trigger (`assignment.create` /
// `assignment.delete` with the caller as actor) all apply. The role gate here only narrows: RLS lets any recruiter of
// the workspace read every assignment, but L-16 limits the panel to the test's own recruiters.
import {
  AssignmentListResponse,
  CreateAssignmentRequest,
  type AssignmentListResponse as AssignmentList,
} from '@trace/shared/contracts/d1';
import { Hono } from 'hono';
import { z } from 'zod';
import { findTest, parseRows } from '../tests/authoring.js';
import { parseBody, readJson } from '../tests/http.js';
import { requireRole, type CallerMembership } from '../tests/membership.js';
import {
  eq,
  handleOrg,
  orgFail,
  orgJson,
  pathId,
  type OrgContext,
  type OrgDeps,
} from '../tests/org-context.js';

export const ASSIGNMENTS_PATH = '/v1/orgs/:orgId/tests/:testId/assignments';
export const ASSIGNMENT_PATH = '/v1/orgs/:orgId/tests/:testId/assignments/:assignmentId';

const AssignmentRow = z.object({
  id: z.uuid(),
  membership_id: z.uuid(),
  as_role: z.enum(['org_owner', 'admin', 'recruiter', 'reviewer']),
  created_at: z.string().min(1),
});
const MemberRow = z.object({ id: z.uuid(), display_name: z.string() });

/**
 * Shown for an assignment whose member the caller can no longer read (a removed membership is outside a recruiter's
 * directory); never another person's data.
 */
export const REMOVED_MEMBER_LABEL = 'Removed member';

interface Manager {
  membership: CallerMembership;
  /** Owner or admin: any row. Otherwise a recruiter assigned to the test: reviewer rows only. */
  orgWide: boolean;
}

/** L-16 gate: owner/admin of the org, or a recruiter holding a recruiter assignment on this visible test. */
const requireManager = async (ctx: OrgContext, orgId: string, testId: string): Promise<Manager> => {
  const membership = await requireRole(ctx.rest, ctx.caller, orgId, [
    'org_owner',
    'admin',
    'recruiter',
  ]);
  if ((await findTest(ctx.rest, orgId, testId)) === null) return orgFail('not_found');
  const orgWide = membership.roles.includes('org_owner') || membership.roles.includes('admin');
  if (!orgWide) {
    const own = await ctx.rest.select('assignments', {
      select: 'id',
      org_id: eq(orgId),
      test_id: eq(testId),
      membership_id: eq(membership.id),
      as_role: 'eq.recruiter',
    });
    if (own.length === 0) return orgFail('not_found');
  }
  return { membership, orgWide };
};

const listOf = async (ctx: OrgContext, orgId: string, testId: string): Promise<AssignmentList> => {
  const rows = parseRows(
    AssignmentRow,
    await ctx.rest.select('assignments', {
      select: 'id,membership_id,as_role,created_at',
      org_id: eq(orgId),
      test_id: eq(testId),
      order: 'created_at.asc,id.asc',
    }),
  );
  const ids = [...new Set(rows.map((r) => r.membership_id))];
  const members =
    ids.length === 0
      ? []
      : parseRows(
          MemberRow,
          await ctx.rest.select('memberships', {
            select: 'id,display_name',
            org_id: eq(orgId),
            id: `in.(${ids.join(',')})`,
          }),
        );
  const name = new Map(members.map((m) => [m.id, m.display_name]));
  return {
    assignments: rows.map((r) => ({
      id: r.id,
      membershipId: r.membership_id,
      asRole: r.as_role,
      displayName: name.get(r.membership_id) ?? REMOVED_MEMBER_LABEL,
      createdAt: r.created_at,
    })),
  };
};

const answer = (body: unknown, status = 200): Response => {
  const out = AssignmentListResponse.safeParse(body);
  return out.success ? orgJson(out.data, status) : orgFail('unavailable');
};

/** The sub-router the lead mounts with `app.route('/', createAssignmentsRoutes(orgDeps))`. */
export const createAssignmentsRoutes = (deps: OrgDeps): Hono<{ Bindings: Env }> => {
  const app = new Hono<{ Bindings: Env }>();

  app.get(ASSIGNMENTS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const testId = pathId(c.req.param('testId'));
      const ctx = await deps.context(c.req.raw, c.env);
      await requireManager(ctx, orgId, testId);
      return answer(await listOf(ctx, orgId, testId));
    }),
  );

  app.post(ASSIGNMENTS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const testId = pathId(c.req.param('testId'));
      const ctx = await deps.context(c.req.raw, c.env);
      const req = parseBody(CreateAssignmentRequest, await readJson(c.req.raw));
      const manager = await requireManager(ctx, orgId, testId);
      // A recruiter assigns reviewers only (L-16); the RLS insert policy refuses the rest too.
      if (!manager.orgWide && req.asRole !== 'reviewer') return orgFail('not_found');
      await ctx.rest.insert(
        'assignments',
        {
          org_id: orgId,
          membership_id: req.membershipId,
          scope: 'test',
          test_id: testId,
          as_role: req.asRole,
        },
        { select: 'id' },
      );
      return answer(await listOf(ctx, orgId, testId), 201);
    }),
  );

  app.delete(ASSIGNMENT_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const testId = pathId(c.req.param('testId'));
      const assignmentId = pathId(c.req.param('assignmentId'));
      const ctx = await deps.context(c.req.raw, c.env);
      const manager = await requireManager(ctx, orgId, testId);
      const removed = await ctx.rest.remove('assignments', {
        id: eq(assignmentId),
        org_id: eq(orgId),
        test_id: eq(testId),
        // A recruiter deletes reviewer rows only (L-16); the RLS delete policy hides the rest too.
        ...(manager.orgWide ? {} : { as_role: 'eq.reviewer' }),
        select: 'id',
      });
      if (removed.length !== 1) return orgFail('not_found');
      return answer(await listOf(ctx, orgId, testId));
    }),
  );

  return app;
};
