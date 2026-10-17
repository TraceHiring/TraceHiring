// Invitations (spec §6.2 rows `POST/GET …/tests/:testId/invitations`, `POST …/invitations/:id/revoke`; D1-1, D1-2,
// D1-12, L-1, R-14; AT-D12 api part in invitation.test.ts).
//
// Create: owner, admin or recruiter (RLS and the label trigger decide the workspace). The api draws a 32-byte link
// token, stores only its SHA-256, and inserts **as the caller** (the trigger pins the published version, numbers the
// label, and forces `blocked_age` when the inviter says the candidate is under 18). Then, for a non-blocked
// invitation only: the mock Messaging writes the invite (with the link) to the demo outbox, and only after that write
// does the api set `sent` as trace_api (L-1). `inviteUrl` = `${CANDIDATE_APP_ORIGIN}/i#<token>` is returned in this
// response only and is never stored or logged. A `blocked_age` invitation gets no URL and no message (rule 9).
// The list carries no contact field. Revoke is a caller write from `created` or `sent` only (R-14).
import {
  CreateInvitationRequest,
  CreateInvitationResponse,
  InvitationListResponse,
} from '@trace/shared/contracts/d1';
import { Hono } from 'hono';
import { z } from 'zod';
import { openApiDb } from '../candidate/api-db.js';
import { randomBase64Url, sha256Hex } from '../candidate/encoding.js';
import { createSqlCandidateStore } from '../candidate/store.js';
import { createDemoOutbox, outboxNamespace, type OutboxWriter } from '../outbox/outbox-writer.js';
import { findTest, parseRows } from '../tests/authoring.js';
import { parseBody, readJson } from '../tests/http.js';
import { requireRole } from '../tests/membership.js';
import {
  eq,
  handleOrg,
  orgFail,
  orgJson,
  pathId,
  type OrgContext,
  type OrgDeps,
} from '../tests/org-context.js';

export const INVITATIONS_PATH = '/v1/orgs/:orgId/tests/:testId/invitations';
export const REVOKE_PATH = '/v1/orgs/:orgId/tests/:testId/invitations/:invitationId/revoke';

/** How long a new link stays valid before its first use (inference: the spec names no window; see the report). */
export const INVITE_TTL_SECONDS = 7 * 24 * 3600;

const STAFF = ['org_owner', 'admin', 'recruiter'] as const;

/** What the create route needs beyond the caller: the mock Messaging, the trace_api `sent` step, the link origin. */
export interface InvitationDelivery {
  outbox: OutboxWriter;
  /** created -> sent as trace_api; true if a row moved. */
  markSent(orgId: string, invitationId: string): Promise<boolean>;
  /** The candidate app origin, e.g. `https://trace-candidate-staging.pages.dev`. */
  candidateOrigin: string;
  close(): Promise<void>;
}

export interface InvitationRouteDeps {
  org: OrgDeps;
  /** Built per request; null when a binding is missing (create answers 503 before any write). */
  delivery(env: Env): InvitationDelivery | null;
  now?: () => number;
  /** The raw 32-byte link token, base64url (43 characters). */
  newToken?: () => string;
}

const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:[0-9]{1,5})?$/;

/** Production delivery: the demo outbox (dev/staging only, via @trace/vendors), API_DB_URL, CANDIDATE_APP_ORIGIN. */
export const deliveryFromEnv = (env: Env): InvitationDelivery | null => {
  const outbox = createDemoOutbox(env, outboxNamespace(env));
  const origin = env.CANDIDATE_APP_ORIGIN;
  if (outbox === null || origin === undefined || !ORIGIN.test(origin)) return null;
  const handle = openApiDb(env.API_DB_URL);
  if (handle === null) return null;
  const store = createSqlCandidateStore(handle.db);
  return {
    outbox,
    markSent: (orgId, invitationId) =>
      store.withOrg(orgId, (s) => s.moveStatus(invitationId, ['created'], 'sent')),
    candidateOrigin: origin,
    close: () => handle.close(),
  };
};

const VersionRow = z.object({ id: z.uuid(), status: z.enum(['draft', 'published', 'retired']) });
const CreatedRow = z.object({
  id: z.uuid(),
  candidate_label: z.string(),
  status: z.string(),
  contact_email: z.string(),
});
const ListRow = z.object({
  id: z.uuid(),
  candidate_label: z.string(),
  status: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
});
const LIST_COLS = 'id,candidate_label,status,created_at,expires_at';

/** The invite body in the demo outbox: the link and nothing about the candidate. */
export const inviteBody = (inviteUrl: string): string =>
  `You are invited to take an online assessment on Trace. Open this personal link to begin: ${inviteUrl} . Do not share it.`;

const listOf = async (ctx: OrgContext, orgId: string, testId: string) => ({
  invitations: parseRows(
    ListRow,
    await ctx.rest.select('invitations', {
      select: LIST_COLS,
      org_id: eq(orgId),
      test_id: eq(testId),
      order: 'created_at.asc,id.asc',
    }),
  ).map((r) => ({
    id: r.id,
    label: r.candidate_label,
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  })),
});

const answer = <T>(
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false } },
  body: unknown,
  status = 200,
): Response => {
  const out = schema.safeParse(body);
  return out.success ? orgJson(out.data, status) : orgFail('unavailable');
};

/** The sub-router the lead mounts with `app.route('/', createInvitationsRoutes({ org, delivery: deliveryFromEnv }))`. */
export const createInvitationsRoutes = (deps: InvitationRouteDeps): Hono<{ Bindings: Env }> => {
  const app = new Hono<{ Bindings: Env }>();
  const now = deps.now ?? (() => Date.now());
  const newToken = deps.newToken ?? (() => randomBase64Url(32));

  app.post(INVITATIONS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const testId = pathId(c.req.param('testId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      const req = parseBody(CreateInvitationRequest, await readJson(c.req.raw));
      await requireRole(ctx.rest, ctx.caller, orgId, STAFF);
      if ((await findTest(ctx.rest, orgId, testId)) === null) return orgFail('not_found');
      // The invitation pins the test's published version (Q20; the trigger refuses anything else).
      const versions = parseRows(
        VersionRow,
        await ctx.rest.select('test_versions', {
          select: 'id,status',
          org_id: eq(orgId),
          test_id: eq(testId),
          status: 'eq.published',
          order: 'version_no.desc',
          limit: '1',
        }),
      );
      const version = versions[0] ?? orgFail('conflict');

      const delivery = deps.delivery(c.env) ?? orgFail('unavailable');
      try {
        const token = newToken();
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return orgFail('unavailable');
        const [row] = parseRows(
          CreatedRow,
          await ctx.rest.insert(
            'invitations',
            {
              org_id: orgId,
              test_id: testId,
              test_version_id: version.id,
              contact_email: req.contactEmail,
              link_token_hash: await sha256Hex(token),
              adult_confirmed_by_inviter: req.adultConfirmedByInviter,
              expires_at: new Date(now() + INVITE_TTL_SECONDS * 1000).toISOString(),
            },
            { select: 'id,candidate_label,status,contact_email' },
          ),
        );
        if (row === undefined) return orgFail('not_found');

        // Rule 9: an inviter's "under 18" is blocked whatever the row says; no link and no message, ever.
        const blocked = req.adultConfirmedByInviter === false || row.status === 'blocked_age';
        if (blocked) {
          if (row.status !== 'blocked_age') return orgFail('unavailable');
          return answer(
            CreateInvitationResponse,
            {
              invitationId: row.id,
              label: row.candidate_label,
              status: 'blocked_age',
              inviteUrl: null,
            },
            201,
          );
        }
        if (row.status !== 'created') return orgFail('unavailable');

        const inviteUrl = `${delivery.candidateOrigin}/i#${token}`;
        try {
          await delivery.outbox.write(orgId, {
            kind: 'invite',
            to: row.contact_email,
            candidateLabel: row.candidate_label,
            bodyText: inviteBody(inviteUrl),
            idempotencyKey: `invite:${row.id}`,
          });
        } catch {
          // Nothing was delivered: withdraw the invitation (as the caller, created -> revoked) so the contact can be
          // invited again, and answer without the link.
          try {
            await ctx.rest.update(
              'invitations',
              { id: eq(row.id), org_id: eq(orgId), status: 'eq.created', select: 'id' },
              { status: 'revoked' },
            );
          } catch {
            // The 503 stands; the link was never returned, so the invitation cannot be used.
          }
          return orgFail('unavailable');
        }
        // L-1: `sent` only after the outbox write. If this step fails the link is already delivered, so the answer
        // still carries it with the stored status (`created`; the candidate flow accepts both).
        let status: 'sent' | 'created' = 'created';
        try {
          if (await delivery.markSent(orgId, row.id)) status = 'sent';
        } catch {
          status = 'created';
        }
        return answer(
          CreateInvitationResponse,
          { invitationId: row.id, label: row.candidate_label, status, inviteUrl },
          201,
        );
      } finally {
        await delivery.close();
      }
    }),
  );

  app.get(INVITATIONS_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const testId = pathId(c.req.param('testId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, STAFF);
      if ((await findTest(ctx.rest, orgId, testId)) === null) return orgFail('not_found');
      return answer(InvitationListResponse, await listOf(ctx, orgId, testId));
    }),
  );

  app.post(REVOKE_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const testId = pathId(c.req.param('testId'));
      const invitationId = pathId(c.req.param('invitationId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, STAFF);
      const [current] = parseRows(
        z.object({ id: z.uuid(), status: z.string() }),
        await ctx.rest.select('invitations', {
          select: 'id,status',
          id: eq(invitationId),
          org_id: eq(orgId),
          test_id: eq(testId),
        }),
      );
      if (current === undefined) return orgFail('not_found');
      // R-14: from created or sent only; a started session finishes (a live revoke is M3a).
      if (current.status !== 'created' && current.status !== 'sent') return orgFail('conflict');
      const moved = await ctx.rest.update(
        'invitations',
        {
          id: eq(invitationId),
          org_id: eq(orgId),
          test_id: eq(testId),
          status: 'in.(created,sent)',
          select: 'id',
        },
        { status: 'revoked' },
      );
      if (moved.length !== 1) return orgFail('conflict');
      return answer(InvitationListResponse, await listOf(ctx, orgId, testId));
    }),
  );

  return app;
};
