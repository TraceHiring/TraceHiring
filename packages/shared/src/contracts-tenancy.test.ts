// M0b contracts (specs/m0b-tenancy.md §4.5). Synthetic values only.
import { describe, expect, it } from 'vitest';
import {
  AddMemberArgs,
  AUDIT_ACTIONS,
  AuditDetails,
  CreateOrgArgs,
  EnrolSmokeUserArgs,
  MembershipRow,
  OrgRow,
  OtpCode,
  Password,
  SignInEmail,
  TotpCode,
} from './contracts-tenancy.js';
import {
  ALWAYS_LOCKED_SETTINGS,
  AiDraftErrorCode,
  IMPORT_ERROR_CODES,
  ImportJobErrorCode,
  INTEGRITY_CATALOG_VERSION,
  ItemFormat,
  ItemStatus,
  PresetKey,
  SettingKey,
} from './contracts-m1.js';
import { keysMatching, schemaNodes } from './contracts-schema-walk.js';

const ID = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';

describe('CreateOrgArgs', () => {
  const ok = {
    name: 'Acme Hiring',
    slug: 'acme-hiring',
    kind: 'customer',
    ownerUserId: ID,
    displayName: 'Owner One',
    requestId: ID2,
  };
  it('accepts a valid org', () => {
    expect(CreateOrgArgs.parse(ok)).toEqual(ok);
  });
  it.each([
    ['slug too short', { slug: 'ab' }],
    ['slug with upper case', { slug: 'Acme' }],
    ['slug starting with a dash', { slug: '-acme' }],
    ['slug too long', { slug: 'a'.repeat(64) }],
    ['empty name', { name: '' }],
    ['name over 200', { name: 'n'.repeat(201) }],
    ['unknown kind', { kind: 'partner' }],
    ['owner not a uuid', { ownerUserId: 'x' }],
    ['display name over 120', { displayName: 'd'.repeat(121) }],
    ['request id not a uuid', { requestId: '1' }],
    ['unknown key', { extra: 1 }],
  ])('rejects %s', (_label, patch) => {
    expect(CreateOrgArgs.safeParse({ ...ok, ...patch }).success).toBe(false);
  });
  it('accepts a 63-character slug and the trace kinds', () => {
    expect(CreateOrgArgs.safeParse({ ...ok, slug: 'a'.repeat(63) }).success).toBe(true);
    expect(CreateOrgArgs.safeParse({ ...ok, kind: 'trace_internal' }).success).toBe(true);
    expect(CreateOrgArgs.safeParse({ ...ok, kind: 'trace_library' }).success).toBe(true);
  });
});

describe('AddMemberArgs', () => {
  const ok = {
    orgId: ID,
    userId: ID2,
    roles: ['recruiter'],
    displayName: 'Recruiter One',
    requestId: ID,
  };
  it('accepts 1–5 unique roles', () => {
    expect(AddMemberArgs.parse(ok)).toEqual(ok);
    expect(
      AddMemberArgs.safeParse({
        ...ok,
        roles: ['org_owner', 'admin', 'recruiter', 'reviewer', 'hiring_manager'],
      }).success,
    ).toBe(true);
  });
  it.each([
    ['no roles', { roles: [] }],
    ['a duplicate role', { roles: ['admin', 'admin'] }],
    ['an unknown role', { roles: ['superuser'] }],
    ['a status argument', { status: 'invited' }],
  ])('rejects %s', (_label, patch) => {
    expect(AddMemberArgs.safeParse({ ...ok, ...patch }).success).toBe(false);
  });
});

describe('EnrolSmokeUserArgs', () => {
  it('accepts the local and staging shapes', () => {
    expect(
      EnrolSmokeUserArgs.safeParse({ env: 'local', email: 'p-owner@example.test' }).success,
    ).toBe(true);
    expect(
      EnrolSmokeUserArgs.safeParse({
        env: 'staging',
        email: 'smoke+staging@example.com',
        ownerEmail: 'smoke-owner+staging@example.com',
      }).success,
    ).toBe(true);
  });
  it.each([
    ['staging without an owner', { env: 'staging', email: 'a@example.test' }],
    [
      'staging owner equal to the smoke user',
      { env: 'staging', email: 'a@example.test', ownerEmail: 'A@example.test' },
    ],
    [
      'local with an owner',
      { env: 'local', email: 'a@example.test', ownerEmail: 'b@example.test' },
    ],
    ['an unknown env', { env: 'production', email: 'a@example.test' }],
    ['a bad email', { env: 'local', email: 'not-an-email' }],
    ['an email over 254', { env: 'local', email: `${'a'.repeat(250)}@example.test` }],
    ['a password argument', { env: 'local', email: 'a@example.test', password: 'x' }],
  ])('rejects %s', (_label, value) => {
    expect(EnrolSmokeUserArgs.safeParse(value).success).toBe(false);
  });
});

describe('sign-in inputs', () => {
  it('accepts and rejects emails, codes and passwords', () => {
    expect(SignInEmail.safeParse({ email: 'p-x@example.test' }).success).toBe(true);
    expect(SignInEmail.safeParse({ email: 'x' }).success).toBe(false);
    for (const code of [OtpCode, TotpCode]) {
      expect(code.safeParse('012345').success).toBe(true);
      expect(code.safeParse('12345').success).toBe(false);
      expect(code.safeParse('1234567').success).toBe(false);
      expect(code.safeParse('12a456').success).toBe(false);
    }
    expect(Password.safeParse('a'.repeat(12)).success).toBe(true);
    expect(Password.safeParse('a'.repeat(11)).success).toBe(false);
    expect(Password.safeParse('a'.repeat(129)).success).toBe(false);
  });
});

describe('MembershipRow and OrgRow', () => {
  const row = {
    id: ID,
    org_id: ID2,
    user_id: ID,
    roles: ['recruiter'],
    workspace_id: null,
    team_id: null,
    display_name: 'Recruiter One',
    status: 'active',
  };
  it('parse PostgREST rows', () => {
    expect(MembershipRow.parse(row)).toEqual(row);
    expect(
      OrgRow.parse({ id: ID, name: 'Acme', slug: 'acme', kind: 'customer', status: 'active' }),
    ).toBeTruthy();
  });
  it('reject malformed rows', () => {
    expect(MembershipRow.safeParse({ ...row, roles: [] }).success).toBe(false);
    expect(MembershipRow.safeParse({ ...row, status: 'deleted' }).success).toBe(false);
    expect(MembershipRow.safeParse({ ...row, org_id: 'x' }).success).toBe(false);
    expect(OrgRow.safeParse({ id: ID, name: 'Acme', slug: 'acme', kind: 'customer' }).success).toBe(
      false,
    );
  });
});

describe('AuditDetails', () => {
  const examples: Record<(typeof AUDIT_ACTIONS)[number], unknown> = {
    'org.create': { kind: 'customer', default_workspace_id: ID, first_membership_id: ID2 },
    'org.update': { changed: ['name', 'status'] },
    'workspace.create': { kind: 'client' },
    'workspace.update': { kind: 'client', changed: ['name'] },
    'workspace.archive': { kind: 'client' },
    'team.create': {},
    'team.update': { changed: ['name'] },
    'team.delete': {},
    'membership.create': {
      roles: ['recruiter'],
      status: 'active',
      workspace_id: null,
      team_id: null,
    },
    'membership.update': {
      old_roles: ['recruiter'],
      new_roles: ['reviewer'],
      old_status: 'active',
      new_status: 'active',
      changed: ['roles'],
    },
    'membership.remove': { old_status: 'active' },
    'staff_grant.create': { scope: 'support_read', expires_at: '2026-10-12T12:00:00+00:00' },
    'staff_grant.revoke': {},
    'auth.sign_in': { aal: 'aal1' },
    'auth.step_up': { aal: 'aal2' },
    'audit.repartition': { month: '2099-01', rows_moved: 3 },
    'test.create': {},
    'test.publish': { version_no: 1 },
    'test.retire': { version_no: 2 },
    'assignment.create': { test_id: ID, membership_id: ID2 },
    'assignment.delete': { test_id: ID, membership_id: ID2 },
    'invitation.create': { test_version_id: ID, status: 'created' },
    'invitation.revoke': { old_status: 'sent' },
    'media.link_issued': { media_id: ID, session_id: ID2, link_id: ID, ttl_seconds: 300 },
    'media.view': { media_id: ID, session_id: ID2, link_id: ID },
    // M1 (specs/m1-test-authoring.md R5-14, R5-26): the keys the M1 migrations write, ids, enums and counts only.
    'item.create': { format: 'mcq' },
    'item.submit': { item_version_id: ID, from: 'draft', to: 'in_review', self_approved: false },
    'item.approve': { item_version_id: ID, from: 'in_review', to: 'approved', self_approved: true },
    'item.not_approved': {
      item_version_id: ID,
      from: 'in_review',
      to: 'not_approved',
      self_approved: false,
    },
    'item.retire': { item_version_id: ID, from: 'approved', to: 'retired', self_approved: false },
    'item.ai_drafted': { item_version_id: ID, ai_draft_job_id: ID2 },
    'item.key_review': { item_version_id: ID },
    'library.copy': { count: 1, reused: 0 },
    'pool.archive': { pool_id: ID },
    'role_template.publish': { version: 1 },
    'integrity_lock.create': { setting_key: 'paste_written' },
    'integrity_lock.delete': { setting_key: 'paste_written' },
    'test.integrity_settings': { preset_key: 'strict', catalog_version: 'm1-settings-v1' },
    'test.new_version': { version_no: 2 },
    'import.complete': { import_job_id: ID, rows_ok: 98, rows_error: 2, images_ok: 4 },
    'import.cancel': { import_job_id: ID },
    'import.fail': { import_job_id: ID, error_code: 'row_limit' },
    'ai_draft.complete': { ai_draft_job_id: ID, drafts_created: 5 },
    'ai_draft.fail': { ai_draft_job_id: ID, error_code: 'drafter_error' },
    'member_invite.create': { member_invite_id: ID, roles: ['recruiter', 'reviewer'] },
    'member_invite.cancel': { member_invite_id: ID },
    'member_invite.provisioned': { member_invite_id: ID },
    'member_invite.failed': { member_invite_id: ID },
  };
  it('covers exactly the 16 events of spec §2.4, the 9 of D1 (specs/d1-demo-slice.md §3.4; test.retire: DB review m1 m-5) and the 23 of M1 (R5-14, R5-26; item.key_review)', () => {
    expect(AUDIT_ACTIONS).toHaveLength(48);
    expect(Object.keys(AuditDetails).sort()).toEqual([...AUDIT_ACTIONS].sort());
  });
  it('limits a media link to 5 minutes and media details to ids (rule 8)', () => {
    const link = AuditDetails['media.link_issued'];
    expect(
      link.safeParse({ media_id: ID, session_id: ID2, link_id: ID, ttl_seconds: 301 }).success,
    ).toBe(false);
    expect(
      link.safeParse({ media_id: ID, session_id: ID2, link_id: ID, ttl_seconds: 0 }).success,
    ).toBe(false);
    expect(
      AuditDetails['media.view'].safeParse({ media_id: ID, session_id: ID2, link_id: 'not-an-id' })
        .success,
    ).toBe(false);
    expect(
      AuditDetails['invitation.create'].safeParse({ test_version_id: ID, status: 'accepted' })
        .success,
    ).toBe(false);
  });
  it('takes the link id from crypto.randomUUID: a v4 id passes, a non-RFC 128-bit id does not', () => {
    const view = AuditDetails['media.view'];
    expect(
      view.safeParse({ media_id: ID, session_id: ID2, link_id: crypto.randomUUID() }).success,
    ).toBe(true);
    expect(
      view.safeParse({
        media_id: ID,
        session_id: ID2,
        link_id: '0123abcd-0123-0123-0123-0123456789ab',
      }).success,
    ).toBe(false);
  });
  it.each(AUDIT_ACTIONS)('accepts the %s shape', (action) => {
    expect(AuditDetails[action].safeParse(examples[action]).success).toBe(true);
  });
  it.each(AUDIT_ACTIONS)('rejects an extra key on %s', (action) => {
    const value = { ...(examples[action] as object), display_name: 'x' };
    expect(AuditDetails[action].safeParse(value).success).toBe(false);
  });
  it('rejects column values in changed lists and bad months', () => {
    expect(AuditDetails['org.update'].safeParse({ changed: ['slug'] }).success).toBe(false);
    expect(AuditDetails['org.update'].safeParse({ changed: [] }).success).toBe(false);
    expect(
      AuditDetails['audit.repartition'].safeParse({ month: '2099-1', rows_moved: 1 }).success,
    ).toBe(false);
    expect(
      AuditDetails['audit.repartition'].safeParse({ month: '2099-01', rows_moved: 0 }).success,
    ).toBe(false);
  });
});

// ---- M1 audit actions (specs/m1-test-authoring.md R5-14, R5-26; AT-M1-25 zod half; B0-SEC7) ---------------------

const M1_ACTIONS = [
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

type Def = { type: string; format?: string; checks?: { _zod: { def: { format?: string } } }[] };
const defOf = (node: unknown) => (node as { _zod: { def: Def } })._zod.def;

describe('M1 audit details carry ids, enums, counts and booleans only (AT-M1-25, B0-SEC7)', () => {
  it('every M1 action is in the closed list', () => {
    for (const action of M1_ACTIONS) expect(AUDIT_ACTIONS, action).toContain(action);
  });
  it.each(M1_ACTIONS)('%s: every string is a uuid, an enum value or a constant code', (action) => {
    const strings = [...schemaNodes(AuditDetails[action])]
      .map(defOf)
      .filter((d) => d.type === 'string');
    for (const def of strings) {
      const constrained =
        def.format === 'uuid' || (def.checks ?? []).some((c) => c._zod.def.format === 'regex');
      expect(constrained, action).toBe(true);
    }
  });
  // The valid example plus an extra key is refused by the AUDIT_ACTIONS sweep above ('display_name'); here every
  // M1 shape also needs its own keys and has no free-text key of any common name.
  it.each(M1_ACTIONS)('%s: no free-text key and no empty details', (action) => {
    const shape = AuditDetails[action];
    expect(shape.safeParse({}).success).toBe(false);
    expect(keysMatching(shape, /stem|topic|email|note|reason|title|name|text|message|jd/i)).toEqual(
      [],
    );
  });
  it('item transitions use public.item_status, never rejected (R5-22)', () => {
    const approve = AuditDetails['item.approve'];
    const base = { item_version_id: ID, from: 'in_review', to: 'approved', self_approved: false };
    expect(approve.safeParse(base).success).toBe(true);
    expect(approve.safeParse({ ...base, to: 'rejected' }).success).toBe(false);
    expect(approve.safeParse({ ...base, self_approved: 'yes' }).success).toBe(false);
    expect(approve.safeParse({ ...base, item_version_id: 'x' }).success).toBe(false);
    expect(AuditDetails['item.create'].safeParse({ format: 'voice' }).success).toBe(false);
  });
  it('the M1 value lists match contracts-m1 (one source per list)', () => {
    const settingKey = AuditDetails['integrity_lock.create'].shape.setting_key;
    const lockable = SettingKey.options.filter((key) => !ALWAYS_LOCKED_SETTINGS.includes(key));
    expect([...settingKey.options].sort()).toEqual([...lockable].sort());
    expect(
      AuditDetails['integrity_lock.create'].safeParse({ setting_key: 'id_verification' }).success,
    ).toBe(false);
    const settings = AuditDetails['test.integrity_settings'].shape;
    expect([...settings.preset_key.unwrap().options]).toEqual([...PresetKey.options]);
    // Custom settings have no preset: the database audits preset_key null (review fix 4).
    const custom = { preset_key: null, catalog_version: INTEGRITY_CATALOG_VERSION };
    expect(AuditDetails['test.integrity_settings'].safeParse(custom).success).toBe(true);
    const absent = { catalog_version: INTEGRITY_CATALOG_VERSION };
    expect(AuditDetails['test.integrity_settings'].safeParse(absent).success).toBe(false);
    expect([...settings.catalog_version.options]).toEqual([INTEGRITY_CATALOG_VERSION]);
    expect([...AuditDetails['item.submit'].shape.from.options]).toEqual([...ItemStatus.options]);
    expect([...AuditDetails['item.create'].shape.format.options]).toEqual([...ItemFormat.options]);
    // import.fail names a job failure code (import_jobs.error_code), never a per-row code.
    expect([...AuditDetails['import.fail'].shape.error_code.options]).toEqual([
      ...ImportJobErrorCode.options,
    ]);
    // row_limit is both a row code and a job code; every other row code is refused.
    const rowOnly = IMPORT_ERROR_CODES.filter((code) => code !== 'row_limit');
    expect(
      rowOnly.some(
        (code) =>
          AuditDetails['import.fail'].safeParse({ import_job_id: ID, error_code: code }).success,
      ),
    ).toBe(false);
    expect([...AuditDetails['ai_draft.fail'].shape.error_code.options]).toEqual([
      ...AiDraftErrorCode.options,
    ]);
  });
  it('counts are non-negative integers and codes are constant lower-snake codes', () => {
    const done = AuditDetails['import.complete'];
    const base = { import_job_id: ID, rows_ok: 1, rows_error: 0, images_ok: 0 };
    expect(done.safeParse(base).success).toBe(true);
    expect(done.safeParse({ ...base, rows_ok: -1 }).success).toBe(false);
    expect(done.safeParse({ ...base, rows_ok: 1.5 }).success).toBe(false);
    expect(done.safeParse({ ...base, rows_ok: 2001 }).success).toBe(false);
    const fail = AuditDetails['ai_draft.fail'];
    expect(fail.safeParse({ ai_draft_job_id: ID, error_code: 'Bedrock said no' }).success).toBe(
      false,
    );
    expect(fail.safeParse({ ai_draft_job_id: ID, error_code: 'x'.repeat(65) }).success).toBe(false);
    expect(AuditDetails['library.copy'].safeParse({ count: 0, reused: 2 }).success).toBe(true);
    expect(AuditDetails['library.copy'].safeParse({ count: 1, reused: -1 }).success).toBe(false);
    expect(
      AuditDetails['ai_draft.complete'].safeParse({ ai_draft_job_id: ID, drafts_created: 11 })
        .success,
    ).toBe(false);
    expect(
      AuditDetails['member_invite.create'].safeParse({ member_invite_id: ID, roles: [] }).success,
    ).toBe(false);
  });
  it('provisioning writes the existing membership.create shape with status invited (R5-14)', () => {
    const invited = { roles: ['recruiter'], status: 'invited', workspace_id: ID, team_id: null };
    expect(AuditDetails['membership.create'].safeParse(invited).success).toBe(true);
  });
});
