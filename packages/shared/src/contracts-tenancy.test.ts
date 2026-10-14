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
    'assignment.create': { test_id: ID, membership_id: ID2 },
    'assignment.delete': { test_id: ID, membership_id: ID2 },
    'invitation.create': { test_version_id: ID, status: 'created' },
    'invitation.revoke': { old_status: 'sent' },
    'media.link_issued': { media_id: ID, session_id: ID2, link_id: ID, ttl_seconds: 300 },
    'media.view': { media_id: ID, session_id: ID2, link_id: ID },
  };
  it('covers exactly the 16 events of spec §2.4 plus the 8 of D1 (specs/d1-demo-slice.md §3.4)', () => {
    expect(AUDIT_ACTIONS).toHaveLength(24);
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
