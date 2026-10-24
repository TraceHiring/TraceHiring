// The reviewers panel (specs/d1-demo-slice.md §6.1, L-16, R-15): assign or unassign from the member directory;
// a recruiter may assign reviewers only; the panel says why assignment matters (start photo access).
import type { AssignmentListResponse } from '@trace/shared/contracts/d1';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FakeSupabase, ORG_A, membership } from '../auth/testing/fake-supabase';
import { loadDirectory } from './directory';
import { ReviewersPanelView, assignableRoles } from './ReviewersPanel';

const ASSIGNMENTS: AssignmentListResponse = {
  assignments: [
    {
      id: '00000000-0000-4000-8000-000000000a01',
      membershipId: '00000000-0000-4000-8000-000000000b01',
      asRole: 'reviewer',
      displayName: 'Synthetic Reviewer One',
      createdAt: '2026-10-19T10:00:00.000Z',
    },
  ],
};
const MEMBERS = [
  {
    id: '00000000-0000-4000-8000-000000000b01',
    displayName: 'Synthetic Reviewer One',
    roles: ['reviewer'],
  },
  {
    id: '00000000-0000-4000-8000-000000000b02',
    displayName: 'Synthetic Reviewer Two',
    roles: ['reviewer'],
  },
];
const noop = () => undefined;
const plain = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('assignableRoles', () => {
  it('a recruiter assigns reviewers only; an owner or admin may assign every role', () => {
    expect(assignableRoles(['recruiter'])).toEqual(['reviewer']);
    expect(assignableRoles(['admin'])).toEqual(['reviewer', 'recruiter', 'admin', 'org_owner']);
    expect(assignableRoles(['org_owner', 'recruiter'])).toEqual([
      'reviewer',
      'recruiter',
      'admin',
      'org_owner',
    ]);
  });
});

describe('ReviewersPanelView', () => {
  const out = renderToString(
    <ReviewersPanelView
      assignments={ASSIGNMENTS}
      members={MEMBERS}
      roles={['reviewer']}
      busy={false}
      error={null}
      onAssign={noop}
      onUnassign={noop}
    />,
  );

  it('lists who is assigned with an Unassign control and explains why it matters', () => {
    const text = plain(out);
    expect(text).toContain('Synthetic Reviewer One');
    expect(text).toContain('Unassign');
    expect(text).toContain('start photo');
  });

  it('offers only members who are not yet assigned', () => {
    const options = [...out.matchAll(/<option\b[^>]*>(.*?)<\/option>/g)].map((m) => m[1]);
    expect(options).toContain('Synthetic Reviewer Two (reviewer)');
    expect(options.join(' ')).not.toContain('Synthetic Reviewer One');
  });

  it('shows a fixed error text and no server text', () => {
    const withError = renderToString(
      <ReviewersPanelView
        assignments={ASSIGNMENTS}
        members={MEMBERS}
        roles={['reviewer']}
        busy={false}
        error="not_found"
        onAssign={noop}
        onUnassign={noop}
      />,
    );
    expect(plain(withError)).toContain('Not found, or you do not have access.');
  });
});

describe('loadDirectory (supabase under RLS)', () => {
  it('lists active members of the org by display name and roles', async () => {
    const fake = new FakeSupabase({
      memberships: [
        membership(ORG_A, ['reviewer'], 'active', {
          id: '00000000-0000-4000-8000-000000000b01',
          display_name: 'Synthetic Reviewer One',
        }),
        membership(ORG_A, ['recruiter'], 'removed', { id: '00000000-0000-4000-8000-000000000b09' }),
      ],
    });
    const result = await loadDirectory(fake.client, ORG_A);
    expect(result).toEqual({
      ok: true,
      data: [
        {
          id: '00000000-0000-4000-8000-000000000b01',
          displayName: 'Synthetic Reviewer One',
          roles: ['reviewer'],
        },
      ],
    });
    expect(fake.callsOf('select:memberships')[0]).toEqual([
      expect.stringContaining('display_name'),
      'eq',
      'org_id',
      ORG_A,
    ]);
  });

  it('fails closed on a read error or a row that fails its contract', async () => {
    const failing = new FakeSupabase({ fail: { 'select:memberships': 'error' } });
    expect((await loadDirectory(failing.client, ORG_A)).ok).toBe(false);
    const bad = new FakeSupabase({ memberships: [{ x: 1 }] });
    expect((await loadDirectory(bad.client, ORG_A)).ok).toBe(false);
  });
});
