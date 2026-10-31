// Member invitations (spec m1 M1-20, §3.2 member_invites, §3.5, §4.5, §6.11 `POST/GET/DELETE …/members/invites`, R2-14,
// R5-12, R5-53 c, R5-56 c; E26, E27). An org admin (the admin role counts only at aal2, ADR-029) invites a person by
// email. services/api never creates an Auth user (it serves candidate RPCs; CLAUDE.md service keys rule): it inserts the
// `member_invites` row as the caller (RLS and the guard decide; an owner invite needs an owner) with the email's HMAC
// and the roles on the row, then enqueues AdminQueueMessage on trace-admin; workers/jobs creates the user and
// provisions the invited membership. The address travels only in that message: it is never stored, logged, returned
// or put in an error. A failed enqueue cancels the invite (the admin can invite again). DELETE cancels a pending invite
// (a status update: invites are kept, R5-53 c). Errors are constant codes.
import {
  AdminQueueMessage,
  MemberInviteCreateResponse,
  MemberInviteListQuery,
  MemberInviteListResponse,
  MemberInviteRequest,
  MemberInviteView,
} from '@trace/shared/contracts/m1';
import { Hono } from 'hono';
import { z } from 'zod';
import { parseRows } from '../tests/authoring.js';
import { answer, parseBody, readJson, readQuery } from '../tests/http.js';
import { requireRole } from '../tests/membership.js';
import {
  eq,
  handleOrg,
  orgFail,
  pathId,
  type OrgContext,
  type OrgDeps,
} from '../tests/org-context.js';
import { cursorOf, keysetQuery, pageOf } from '../tests/rest-keyset.js';
import {
  inviteEmailHmac,
  normaliseInviteEmail,
  pepperStrongEnough,
} from '@trace/shared/invite-email';

/** The trace-admin queue producer (`ADMIN_QUEUE`, trace-admin-<env>). */
export interface InviteQueue {
  send(message: AdminQueueMessage): Promise<void>;
}

export interface MembersDeps {
  org: OrgDeps;
  /** MEMBER_INVITE_PEPPER (a secret shared with workers/jobs), or null when unset (invites answer 503). */
  pepper(env: Env): string | null;
  /** The ADMIN_QUEUE producer, or null when unbound (invites answer 503). */
  queue(env: Env): InviteQueue | null;
}

/** The pepper, or null when unset or under PEPPER_MIN_BYTES UTF-8 bytes (one rule with the jobs; fail closed). */
export const pepperFromEnv = (env: Env): string | null => {
  const value = (env as unknown as { MEMBER_INVITE_PEPPER?: unknown }).MEMBER_INVITE_PEPPER;
  return typeof value === 'string' && pepperStrongEnough(value) ? value : null;
};

export const adminQueueFromEnv = (env: Env): InviteQueue | null => {
  const queue = env.ADMIN_QUEUE;
  if (queue === undefined) return null;
  return { send: async (message) => void (await queue.send(message)) };
};

const ADMIN = ['admin'] as const;

const INVITE_COLS = 'id,roles,workspace_id,status,membership_id,invited_by,created_at';
const InviteRow = z.object({
  id: z.uuid(),
  roles: z.array(z.string()),
  workspace_id: z.uuid().nullable(),
  status: z.string(),
  membership_id: z.uuid().nullable(),
  invited_by: z.uuid().nullable(),
  created_at: z.string().min(1),
});
type InviteRow = z.infer<typeof InviteRow>;

const viewOf = (r: InviteRow) => ({
  id: r.id,
  roles: r.roles,
  workspaceId: r.workspace_id,
  status: r.status,
  membershipId: r.membership_id,
  invitedBy: r.invited_by,
  createdAt: r.created_at,
});

export const MEMBER_INVITES_PATH = '/v1/orgs/:orgId/members/invites';
export const MEMBER_INVITE_PATH = '/v1/orgs/:orgId/members/invites/:inviteId';

const cancel = async (ctx: OrgContext, orgId: string, inviteId: string) =>
  parseRows(
    InviteRow,
    await ctx.rest.update(
      'member_invites',
      { id: eq(inviteId), org_id: eq(orgId), status: 'eq.pending', select: INVITE_COLS },
      { status: 'cancelled' },
    ),
  );

export const createMembersRoutes = (deps: MembersDeps): Hono<{ Bindings: Env }> => {
  const app = new Hono<{ Bindings: Env }>();

  app.post(MEMBER_INVITES_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, ADMIN);
      const req = parseBody(MemberInviteRequest, await readJson(c.req.raw));
      // Owners and admins are org-wide (D16b; the table CHECK refuses it too).
      if (
        req.workspaceId !== undefined &&
        req.roles.some((r) => r === 'org_owner' || r === 'admin')
      ) {
        return orgFail('bad_request');
      }
      // Fix round 1 #2: the shared minimum (32 UTF-8 bytes), checked before any write.
      const pepper = deps.pepper(c.env);
      if (pepper === null || !pepperStrongEnough(pepper)) return orgFail('unavailable');
      const queue = deps.queue(c.env) ?? orgFail('unavailable');
      const email = normaliseInviteEmail(req.email);
      const [row] = parseRows(
        InviteRow,
        await ctx.rest.insert(
          'member_invites',
          {
            org_id: orgId,
            email_hmac: await inviteEmailHmac(email, pepper),
            roles: req.roles,
            workspace_id: req.workspaceId ?? null,
          },
          { select: INVITE_COLS },
        ),
      );
      if (row === undefined) return orgFail('not_found');
      const message = AdminQueueMessage.safeParse({
        v: 1,
        kind: 'member_invite',
        inviteId: row.id,
        orgId,
        email,
        displayName: req.displayName,
      });
      try {
        if (!message.success) throw new Error('bad_message');
        await queue.send(message.data);
      } catch {
        // Nothing keeps the address: cancel the invite so the admin can send it again.
        try {
          await cancel(ctx, orgId, row.id);
        } catch {
          // The invite stays pending without a message; a new invite of the address is refused until it is cancelled.
        }
        return orgFail('unavailable');
      }
      return answer(MemberInviteCreateResponse, viewOf(row), 201);
    }),
  );

  app.get(MEMBER_INVITES_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, ADMIN);
      const query = readQuery(c.req.url, MemberInviteListQuery);
      const rows = parseRows(
        InviteRow,
        await ctx.rest.select('member_invites', {
          select: INVITE_COLS,
          org_id: eq(orgId),
          ...keysetQuery(cursorOf(query.cursor), 'desc'),
        }),
      );
      const page = pageOf(rows);
      return answer(MemberInviteListResponse, {
        invites: page.rows.map(viewOf),
        nextCursor: page.nextCursor,
      });
    }),
  );

  app.delete(MEMBER_INVITE_PATH, (c) =>
    handleOrg(async () => {
      const orgId = pathId(c.req.param('orgId'));
      const ctx = await deps.org.context(c.req.raw, c.env);
      await requireRole(ctx.rest, ctx.caller, orgId, ADMIN);
      const inviteId = pathId(c.req.param('inviteId'));
      const [row] = await cancel(ctx, orgId, inviteId);
      if (row === undefined) {
        // Settled (provisioned, failed or cancelled) is 409; an invite the caller cannot see is 404.
        const seen = await ctx.rest.select('member_invites', {
          select: 'id',
          id: eq(inviteId),
          org_id: eq(orgId),
        });
        return orgFail(seen.length === 0 ? 'not_found' : 'conflict');
      }
      return answer(MemberInviteView, viewOf(row));
    }),
  );

  return app;
};
