// The caller-membership gate (m0b §2.2, L-25): membershipCounts is the private.membership_counts_for truth table,
// and requireRole answers 404 for no membership or no allowed role, 403 aal2_required when it does not count.
import { describe, expect, it } from 'vitest';
import { membershipCounts, requireRole, type Role } from './membership.js';
import { OrgError, type OrgCaller } from './org-context.js';
import { fakeDb } from './rest.test-helpers.js';

const ORG = 'a1000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000005';

describe('membershipCounts', () => {
  const cases: [Role[], OrgCaller['aal'], string[], boolean][] = [
    [['recruiter'], 'aal1', ['otp'], true],
    [['recruiter'], 'aal1', ['magiclink'], true],
    [['recruiter'], 'aal1', ['password'], false],
    [['recruiter'], 'aal1', ['otp', 'password'], false],
    [['recruiter'], 'aal1', [], false],
    [['recruiter'], 'aal2', ['password', 'totp'], true],
    [['hiring_manager'], 'aal1', ['otp'], true],
    [['org_owner', 'admin'], 'aal1', ['otp'], false],
    [['admin'], 'aal2', ['password', 'totp'], true],
    [['reviewer'], 'aal1', ['otp'], false],
    [['recruiter', 'reviewer'], 'aal1', ['otp'], false],
    [['reviewer'], 'aal2', ['otp', 'totp'], true],
  ];
  for (const [roles, aal, amr, want] of cases) {
    it(`${roles.join('+')} at ${aal} with [${amr.join(',')}] -> ${String(want)}`, () => {
      expect(membershipCounts(roles, aal, amr)).toBe(want);
    });
  }
});

describe('requireRole', () => {
  const caller = (patch: Partial<OrgCaller> = {}): OrgCaller => ({
    userId: USER,
    aal: 'aal1',
    amr: ['otp'],
    jwt: 'h.p.s',
    ...patch,
  });
  const db = (roles: Role[], status = 'active', org = ORG) =>
    fakeDb({
      memberships: [
        { id: 'd1000000-0000-4000-8000-000000000005', org_id: org, user_id: USER, roles, status },
      ],
    });
  const codeOf = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (err) {
      return err instanceof OrgError ? err.code : 'other';
    }
  };

  it('returns the membership of the path org for an allowed, counting role', async () => {
    const d = db(['recruiter']);
    const m = await requireRole(d.rest, caller(), ORG, ['recruiter']);
    expect(m).toEqual({ id: 'd1000000-0000-4000-8000-000000000005', roles: ['recruiter'] });
    expect(d.calls[0]?.query).toMatchObject({
      org_id: `eq.${ORG}`,
      user_id: `eq.${USER}`,
      status: 'eq.active',
    });
  });

  it('no membership, another org, a removed membership or no allowed role is 404', async () => {
    for (const d of [
      fakeDb({ memberships: [] }),
      db(['recruiter'], 'active', 'a1000000-0000-4000-8000-000000000003'),
      db(['recruiter'], 'removed'),
      db(['reviewer']),
      db(['hiring_manager']),
    ]) {
      expect(
        await codeOf(requireRole(d.rest, caller(), ORG, ['org_owner', 'admin', 'recruiter'])),
      ).toBe('not_found');
    }
  });

  it('a membership that does not count at this aal is 403 aal2_required', async () => {
    expect(await codeOf(requireRole(db(['admin']).rest, caller(), ORG, ['admin']))).toBe(
      'aal2_required',
    );
    expect(
      await codeOf(
        requireRole(db(['recruiter']).rest, caller({ amr: ['password'] }), ORG, ['recruiter']),
      ),
    ).toBe('aal2_required');
  });

  it('a stored row that does not parse is 503 unavailable', async () => {
    expect(
      await codeOf(requireRole(db(['nobody' as Role]).rest, caller(), ORG, ['recruiter'])),
    ).toBe('unavailable');
  });
});
