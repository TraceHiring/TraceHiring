// M0b contracts (specs/m0b-tenancy.md §4.5): operator script arguments, sign-in inputs, the rows the recruiter
// shell reads, and the exact audit `details` keys per action. Every object schema is strict: an unknown key fails.
import { z } from 'zod';

export const OrgRole = z.enum(['org_owner', 'admin', 'recruiter', 'reviewer', 'hiring_manager']);
export type OrgRole = z.infer<typeof OrgRole>;
export const OrgKind = z.enum(['customer', 'trace_library', 'trace_internal']);
export const OrgStatus = z.enum(['active', 'suspended']);
export const MembershipStatus = z.enum(['invited', 'active', 'suspended', 'removed']);
export type MembershipStatus = z.infer<typeof MembershipStatus>;

const Email = z.email().max(254);
const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{2,62}$/);
const DisplayName = z.string().min(1).max(120);
const Roles = z
  .array(OrgRole)
  .min(1)
  .max(5)
  .refine((roles) => new Set(roles).size === roles.length, { message: 'duplicate role' });

export const CreateOrgArgs = z
  .object({
    name: z.string().min(1).max(200),
    slug: Slug,
    kind: OrgKind,
    ownerUserId: z.uuid(),
    displayName: DisplayName,
    requestId: z.uuid(),
  })
  .strict();
export type CreateOrgArgs = z.infer<typeof CreateOrgArgs>;

/** `status` is not an argument: an operator add is always `active`. */
export const AddMemberArgs = z
  .object({
    orgId: z.uuid(),
    userId: z.uuid(),
    roles: Roles,
    displayName: DisplayName,
    requestId: z.uuid(),
  })
  .strict();
export type AddMemberArgs = z.infer<typeof AddMemberArgs>;

/** The password never travels as an argument: it comes from SMOKE_PASSWORD only (§4.4). */
export const EnrolSmokeUserArgs = z
  .discriminatedUnion('env', [
    z.object({ env: z.literal('local'), email: Email }).strict(),
    z.object({ env: z.literal('staging'), email: Email, ownerEmail: Email }).strict(),
  ])
  .refine(
    (args) => args.env !== 'staging' || args.ownerEmail.toLowerCase() !== args.email.toLowerCase(),
    {
      message: 'the owner must be a different user',
    },
  );
export type EnrolSmokeUserArgs = z.infer<typeof EnrolSmokeUserArgs>;

export const SignInEmail = z.object({ email: Email }).strict();
export const OtpCode = z.string().regex(/^[0-9]{6}$/);
export const TotpCode = z.string().regex(/^[0-9]{6}$/);
export const Password = z.string().min(12).max(128);

/** What the recruiter shell reads from `memberships` through RLS. */
export const MembershipRow = z
  .object({
    id: z.uuid(),
    org_id: z.uuid(),
    user_id: z.uuid(),
    roles: Roles,
    workspace_id: z.uuid().nullable(),
    team_id: z.uuid().nullable(),
    display_name: z.string(),
    status: MembershipStatus,
  })
  .strict();
export type MembershipRow = z.infer<typeof MembershipRow>;

export const OrgRow = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    kind: OrgKind,
    status: OrgStatus,
  })
  .strict();
export type OrgRow = z.infer<typeof OrgRow>;

// Audit details: IDs, enum labels and column names only. Never a name, slug, email or ticket text.
const WorkspaceKind = z.enum(['default', 'client']);
const Aal = z.enum(['aal1', 'aal2']);
const changed = <T extends readonly [string, ...string[]]>(columns: T) =>
  z.array(z.enum(columns)).min(1);
const empty = z.object({}).strict();

export const AUDIT_ACTIONS = [
  'org.create',
  'org.update',
  'workspace.create',
  'workspace.update',
  'workspace.archive',
  'team.create',
  'team.update',
  'team.delete',
  'membership.create',
  'membership.update',
  'membership.remove',
  'staff_grant.create',
  'staff_grant.revoke',
  'auth.sign_in',
  'auth.step_up',
  'audit.repartition',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AuditDetails = {
  'org.create': z
    .object({ kind: OrgKind, default_workspace_id: z.uuid(), first_membership_id: z.uuid() })
    .strict(),
  'org.update': z.object({ changed: changed(['name', 'data_residency', 'status']) }).strict(),
  'workspace.create': z.object({ kind: WorkspaceKind }).strict(),
  'workspace.update': z
    .object({ kind: WorkspaceKind, changed: changed(['name', 'archived_at']) })
    .strict(),
  'workspace.archive': z.object({ kind: WorkspaceKind }).strict(),
  'team.create': empty,
  'team.update': z.object({ changed: changed(['name']) }).strict(),
  'team.delete': empty,
  'membership.create': z
    .object({
      roles: Roles,
      status: MembershipStatus,
      workspace_id: z.uuid().nullable(),
      team_id: z.uuid().nullable(),
    })
    .strict(),
  'membership.update': z
    .object({
      old_roles: Roles,
      new_roles: Roles,
      old_status: MembershipStatus,
      new_status: MembershipStatus,
      changed: changed(['roles', 'status', 'workspace_id', 'team_id', 'display_name']),
    })
    .strict(),
  'membership.remove': z.object({ old_status: MembershipStatus }).strict(),
  'staff_grant.create': z
    .object({ scope: z.enum(['support_read']), expires_at: z.iso.datetime({ offset: true }) })
    .strict(),
  'staff_grant.revoke': empty,
  'auth.sign_in': z.object({ aal: Aal }).strict(),
  'auth.step_up': z.object({ aal: Aal }).strict(),
  'audit.repartition': z
    .object({ month: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/), rows_moved: z.int().min(1) })
    .strict(),
} as const satisfies Record<AuditAction, z.ZodType>;
