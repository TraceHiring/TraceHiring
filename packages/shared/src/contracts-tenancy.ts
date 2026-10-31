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
// public.invitation_status (D1 migration 2).
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
// M1 value lists, repeated here so this file imports no other contract (contracts-m1 imports this one).
// contracts-tenancy.test.ts proves each equals its contracts-m1 list.
const ItemFormat = z.enum(['mcq', 'written']); // public.section_format
const ItemStatus = z.enum(['draft', 'in_review', 'approved', 'not_approved', 'retired']); // public.item_status
const itemTransition = z
  .object({
    item_version_id: z.uuid(),
    from: ItemStatus,
    to: ItemStatus,
    self_approved: z.boolean(),
  })
  .strict();
/** Catalog m1-settings-v1 minus the always-locked settings (a lock row on those is refused). */
const LockableSettingKey = z.enum([
  'calibration_warmup',
  'typing_provenance',
  'burst_after_tab',
  'fullscreen_tab_focus',
  'single_screen',
  'camera_face_presence',
  'mic_speech_presence',
  'explain_probe',
  'question_copy',
  'paste_written',
]);
const PresetKey = z.enum(['strict', 'standard', 'open_book']);
const IntegrityCatalogVersion = z.enum(['m1-settings-v1']);
/** Why an import job failed: import_jobs.error_code (M1-c), never a message. */
export const ImportJobErrorCode = z.enum(['row_limit', 'image_limit', 'timeout', 'internal']);
export type ImportJobErrorCode = z.infer<typeof ImportJobErrorCode>;
/** Why a drafting job failed: ai_draft_jobs.error_code (M1-c), never a message. */
export const AiDraftErrorCode = z.enum([
  'drafter_error',
  'bad_output',
  'no_draft_passed',
  'timeout',
  'internal',
]);
export type AiDraftErrorCode = z.infer<typeof AiDraftErrorCode>;
/** An import job holds at most 2,000 rows and 2,000 images (§4.3, §6.9). */
const importCount = () => z.int().min(0).max(2000);

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
  // D1 migration 1 (specs/d1-demo-slice.md §3.1): authoring and assignments.
  'test.create',
  'test.publish',
  // DB review m1 m-5: published -> retired is audited like publish.
  'test.retire',
  'assignment.create',
  'assignment.delete',
  // D1 migration 2: invitations.
  'invitation.create',
  'invitation.revoke',
  // D1 migration 4: media grants (one media.view per fetch; rule 8).
  'media.link_issued',
  'media.view',
  // M1 (specs/m1-test-authoring.md R5-14, R5-26): bank, library, pools, templates, settings, imports, drafts, invites.
  'item.create',
  'item.submit',
  'item.approve',
  'item.not_approved',
  'item.retire',
  'item.ai_drafted',
  'item.key_review',
  'library.copy',
  'pool.archive',
  'role_template.publish',
  'integrity_lock.create',
  'integrity_lock.delete',
  'test.integrity_settings',
  'test.new_version',
  'import.complete',
  'import.cancel',
  'import.fail',
  'ai_draft.complete',
  'ai_draft.fail',
  'member_invite.create',
  'member_invite.cancel',
  'member_invite.provisioned',
  'member_invite.failed',
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
  'test.create': empty,
  'test.publish': z.object({ version_no: z.number().int().positive() }).strict(),
  'test.retire': z.object({ version_no: z.number().int().positive() }).strict(),
  'assignment.create': z.object({ test_id: z.uuid(), membership_id: z.uuid() }).strict(),
  'assignment.delete': z.object({ test_id: z.uuid(), membership_id: z.uuid() }).strict(),
  'invitation.create': z.object({ test_version_id: z.uuid(), status: InvitationStatus }).strict(),
  'invitation.revoke': z.object({ old_status: InvitationStatus }).strict(),
  'media.link_issued': z
    .object({
      media_id: z.uuid(),
      session_id: z.uuid(),
      link_id: z.uuid(),
      ttl_seconds: z.int().min(1).max(300),
    })
    .strict(),
  'media.view': z.object({ media_id: z.uuid(), session_id: z.uuid(), link_id: z.uuid() }).strict(),
  // M1: the exact keys the M1 migrations write. Ids, enums, counts and booleans only; never a stem, topic, email or
  // name (B0-SEC7, AT-M1-25).
  'item.create': z.object({ format: ItemFormat }).strict(),
  'item.submit': itemTransition,
  'item.approve': itemTransition,
  'item.not_approved': itemTransition,
  'item.retire': itemTransition,
  'item.ai_drafted': z.object({ item_version_id: z.uuid(), ai_draft_job_id: z.uuid() }).strict(),
  'item.key_review': z.object({ item_version_id: z.uuid() }).strict(),
  'library.copy': z.object({ count: z.int().min(0), reused: z.int().min(0) }).strict(),
  'pool.archive': z.object({ pool_id: z.uuid() }).strict(),
  'role_template.publish': z.object({ version: z.int().min(1) }).strict(),
  'integrity_lock.create': z.object({ setting_key: LockableSettingKey }).strict(),
  'integrity_lock.delete': z.object({ setting_key: LockableSettingKey }).strict(),
  'test.integrity_settings': z
    .object({ preset_key: PresetKey.nullable(), catalog_version: IntegrityCatalogVersion })
    .strict(),
  'test.new_version': z.object({ version_no: z.int().min(1) }).strict(),
  'import.complete': z
    .object({
      import_job_id: z.uuid(),
      rows_ok: importCount(),
      rows_error: importCount(),
      images_ok: importCount(),
    })
    .strict(),
  'import.cancel': z.object({ import_job_id: z.uuid() }).strict(),
  'import.fail': z.object({ import_job_id: z.uuid(), error_code: ImportJobErrorCode }).strict(),
  'ai_draft.complete': z
    .object({ ai_draft_job_id: z.uuid(), drafts_created: z.int().min(0).max(10) })
    .strict(),
  'ai_draft.fail': z.object({ ai_draft_job_id: z.uuid(), error_code: AiDraftErrorCode }).strict(),
  'member_invite.create': z.object({ member_invite_id: z.uuid(), roles: Roles }).strict(),
  'member_invite.cancel': z.object({ member_invite_id: z.uuid() }).strict(),
  'member_invite.provisioned': z.object({ member_invite_id: z.uuid() }).strict(),
  'member_invite.failed': z.object({ member_invite_id: z.uuid() }).strict(),
} as const satisfies Record<AuditAction, z.ZodType>;
