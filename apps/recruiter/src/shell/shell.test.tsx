// The signed-in shell: links by role (UX only), "no access in this release" for a hiring_manager, and the
// org/roles read under RLS. Synthetic data only.
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { accessTokenOf, type OrgInfo } from '../api/runtime';
import { FakeSupabase, ORG_A, ORG_B, USER_ID, membership } from '../auth/testing/fake-supabase';
import { NO_ACCESS_TEXT, navFor } from './nav';
import { loadOrgInfo } from './org-info';
import { SignedInView } from './SignedIn';

const OUTBOX = { to: '/demo-outbox', label: 'Demo outbox' };
const labels = (roles: string[], extra = OUTBOX) => navFor(roles, extra).map((i) => i.label);
const info = (roles: string[]): OrgInfo => ({
  orgId: ORG_A,
  orgName: 'Synthetic Staffing',
  userId: USER_ID,
  roles,
});
const html = (roles: string[]) =>
  renderToString(
    <MemoryRouter>
      <SignedInView info={info(roles)} extraNav={OUTBOX}>
        <p>screen</p>
      </SignedInView>
    </MemoryRouter>,
  );

describe('navFor', () => {
  it('staff: Tests and the demo outbox when the build has it', () => {
    for (const role of ['org_owner', 'admin', 'recruiter'])
      expect(labels([role])).toEqual(['Tests', 'Demo outbox']);
    expect(navFor(['recruiter'], null).map((i) => i.label)).toEqual(['Tests']);
  });

  it('reviewer: Tests and Review queue, never the outbox', () => {
    expect(labels(['reviewer'])).toEqual(['Tests', 'Review queue']);
  });

  it('a hiring_manager gets no links', () => {
    expect(labels(['hiring_manager'])).toEqual([]);
  });
});

describe('SignedInView', () => {
  it('a hiring_manager sees "no access in this release" and not the screen', () => {
    const out = html(['hiring_manager']);
    expect(out).toContain(NO_ACCESS_TEXT);
    expect(out).not.toContain('screen');
  });

  it('a recruiter sees the screen and the org name', () => {
    const out = html(['recruiter']);
    expect(out).toContain('screen');
    expect(out).toContain('Synthetic Staffing');
    expect(out).toContain('href="/tests"');
  });
});

describe('loadOrgInfo', () => {
  const org = { id: ORG_A, name: 'Synthetic Staffing' };

  it('unions the roles of the active memberships of this org only', async () => {
    const fake = new FakeSupabase({
      session: { methods: ['otp'], aal: 'aal1' },
      memberships: [
        membership(ORG_A, ['recruiter']),
        membership(ORG_A, ['reviewer'], 'active', { id: '00000000-0000-4000-8000-000000000999' }),
        membership(ORG_A, ['admin'], 'removed', { id: '00000000-0000-4000-8000-000000000998' }),
        membership(ORG_B, ['org_owner']),
      ],
    });
    const result = await loadOrgInfo(fake.client, org);
    expect(result?.roles).toEqual(['recruiter', 'reviewer']);
    expect(result?.userId).toBe(USER_ID);
  });

  it('is null without a session, on a failed read, or on a row that fails its contract', async () => {
    expect(await loadOrgInfo(new FakeSupabase().client, org)).toBeNull();
    const failing = new FakeSupabase({
      session: { methods: ['otp'], aal: 'aal1' },
      fail: { 'select:memberships': 'error' },
    });
    expect(await loadOrgInfo(failing.client, org)).toBeNull();
    const bad = new FakeSupabase({
      session: { methods: ['otp'], aal: 'aal1' },
      memberships: [{ nonsense: true }],
    });
    expect(await loadOrgInfo(bad.client, org)).toBeNull();
  });
});

describe('accessTokenOf', () => {
  it('reads data.session.access_token and nothing else', () => {
    expect(accessTokenOf({ data: { session: { access_token: 'tok' } } })).toBe('tok');
    expect(accessTokenOf({ data: { session: {} } })).toBeNull();
    expect(accessTokenOf({ data: null })).toBeNull();
    expect(accessTokenOf(undefined)).toBeNull();
  });
});
