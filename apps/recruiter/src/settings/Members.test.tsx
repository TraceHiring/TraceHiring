// @vitest-environment happy-dom
// The admin members screen (specs/m1-test-authoring.md §4.5, R2-14, AT-M1-26 UI side): invite with a role, list the
// invites in cursor pages, cancel a pending one. Only an owner can invite an owner, so the choice is hidden for anyone
// else (the server enforces it). An address is never shown after it is submitted, and the invite view has none.
import {
  MemberInviteListResponse,
  MemberInviteView,
  encodePageCursor,
} from '@trace/shared/contracts/m1';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import {
  button,
  click,
  choose,
  fakeApi,
  field,
  mountScreen,
  plain,
  typeInto,
  uuid,
  type Mounted,
} from '../authoring/dom.test-helpers';
import { MembersRoute, MembersView } from './MembersRoute';

const AT = '2026-10-23T10:00:00.000Z';
const EMAIL = 'new.person@example.test';
const invite = (
  n: number,
  status: 'pending' | 'provisioned' | 'failed' | 'cancelled',
  roles = ['recruiter'],
) =>
  MemberInviteView.parse({
    id: uuid(n),
    roles,
    workspaceId: null,
    status,
    membershipId: status === 'provisioned' ? uuid(n + 100) : null,
    invitedBy: uuid(7),
    createdAt: AT,
  });
const noop = () => undefined;
const emptyForm = { displayName: '', email: '', role: 'recruiter' };

const viewHtml = (props: Partial<Parameters<typeof MembersView>[0]> = {}) =>
  renderToString(
    <MembersView
      status="ready"
      callerIsOwner={false}
      invites={[
        invite(1, 'pending'),
        invite(2, 'provisioned', ['reviewer']),
        invite(3, 'failed'),
        invite(4, 'cancelled'),
      ]}
      hasMore={false}
      loadingMore={false}
      form={emptyForm}
      busy={false}
      error={null}
      notice={null}
      onForm={noop}
      onInvite={noop}
      onCancel={noop}
      onMore={noop}
      {...props}
    />,
  );

describe('MembersView (static)', () => {
  it('keeps the heading in every state', () => {
    for (const status of ['loading', 'ready', 'error'] as const) {
      expect(plain(viewHtml({ status }))).toContain('Members');
    }
  });

  it('lists roles and statuses, and offers Cancel invite only for a pending one', () => {
    const out = viewHtml();
    const text = plain(out);
    for (const t of ['Recruiter', 'Reviewer', 'Pending', 'Failed', 'Cancelled'])
      expect(text, t).toContain(t);
    expect(out.match(/Cancel invite/g)).toHaveLength(1);
  });

  it('hides the Owner role from anyone who is not an owner, and offers it to an owner', () => {
    expect(viewHtml({ callerIsOwner: false })).not.toContain('value="org_owner"');
    expect(viewHtml({ callerIsOwner: true })).toContain('value="org_owner"');
    expect(viewHtml()).toContain('value="admin"');
  });

  it('shows no address and no checkbox, and has no inline style', () => {
    const out = viewHtml();
    expect(out).not.toMatch(/@|type="checkbox"|role="checkbox"|aria-selected| style=/);
  });
});

let mounted: Mounted | undefined;
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
});

const page1 = MemberInviteListResponse.parse({
  invites: [invite(1, 'pending')],
  nextCursor: encodePageCursor({ createdAt: AT, id: uuid(1) }),
});
const page2 = MemberInviteListResponse.parse({ invites: [invite(2, 'failed')], nextCursor: null });

describe('MembersRoute', () => {
  it('pages through invites with the cursor', async () => {
    const { api, calls } = fakeApi({
      'GET /members/invites': (call) => ({ body: call.query === '' ? page1 : page2 }),
    });
    mounted = await mountScreen(<MembersRoute />, api, ['admin']);
    const c = mounted.container;
    expect(c.querySelectorAll('tbody tr')).toHaveLength(1);
    await click(button(c, 'Load more invites'));
    expect(c.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(calls.map((x) => x.query)).toEqual([
      '',
      `?cursor=${encodeURIComponent(page1.nextCursor ?? '')}`,
    ]);
    expect([...c.querySelectorAll('button')].map((b) => b.textContent)).not.toContain(
      'Load more invites',
    );
  });

  it('invites with the chosen role, then shows no address and clears the form', async () => {
    const seen: unknown[] = [];
    const { api } = fakeApi({
      'GET /members/invites': () => ({
        body: MemberInviteListResponse.parse({ invites: [], nextCursor: null }),
      }),
      'POST /members/invites': (call) => {
        seen.push(call.body);
        return { status: 201, body: invite(9, 'pending', ['reviewer']) };
      },
    });
    mounted = await mountScreen(<MembersRoute />, api, ['admin']);
    const c = mounted.container;
    expect(button(c, 'Send invite').disabled).toBe(true);
    await typeInto(field(c, 'Display name'), 'Synthetic Reviewer');
    await typeInto(field(c, 'Email address'), EMAIL);
    await choose(field(c, 'Role'), 'reviewer');
    await click(button(c, 'Send invite'));
    expect(seen).toEqual([
      { email: EMAIL, roles: ['reviewer'], displayName: 'Synthetic Reviewer' },
    ]);
    expect(plain(c.innerHTML)).toContain('Invitation created.');
    expect(c.innerHTML).not.toContain(EMAIL);
    expect(c.textContent).not.toContain(EMAIL);
    expect(field<HTMLInputElement>(c, 'Email address').value).toBe('');
    expect(field<HTMLInputElement>(c, 'Display name').value).toBe('');
    expect(c.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('an admin who is not an owner cannot pick Owner; an owner can', async () => {
    const { api } = fakeApi({
      'GET /members/invites': () => ({
        body: MemberInviteListResponse.parse({ invites: [], nextCursor: null }),
      }),
    });
    mounted = await mountScreen(<MembersRoute />, api, ['admin']);
    expect(
      [...field<HTMLSelectElement>(mounted.container, 'Role').options].map((o) => o.value),
    ).toEqual(['admin', 'recruiter', 'reviewer', 'hiring_manager']);
    await mounted.unmount();
    mounted = await mountScreen(<MembersRoute />, api, ['admin', 'org_owner']);
    expect(
      [...field<HTMLSelectElement>(mounted.container, 'Role').options].map((o) => o.value),
    ).toContain('org_owner');
  });

  it('cancels a pending invite and shows it as cancelled (the DELETE answers the invite)', async () => {
    const { api, calls } = fakeApi({
      'GET /members/invites': () => ({
        body: MemberInviteListResponse.parse({ invites: [invite(1, 'pending')], nextCursor: null }),
      }),
      [`DELETE /members/invites/${uuid(1)}`]: () => ({ body: invite(1, 'cancelled') }),
    });
    mounted = await mountScreen(<MembersRoute />, api, ['admin']);
    const c = mounted.container;
    await click(button(c, 'Cancel invite'));
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: `/members/invites/${uuid(1)}` });
    expect(plain(c.innerHTML)).toContain('Cancelled');
    expect([...c.querySelectorAll('button')].map((b) => b.textContent)).not.toContain(
      'Cancel invite',
    );
  });

  it('shows a fixed failure text when the invite is refused, keeping the name but not the address shown', async () => {
    const { api } = fakeApi({
      'GET /members/invites': () => ({
        body: MemberInviteListResponse.parse({ invites: [], nextCursor: null }),
      }),
      'POST /members/invites': () => ({ status: 403, body: { error: { code: 'aal2_required' } } }),
    });
    mounted = await mountScreen(<MembersRoute />, api, ['admin']);
    const c = mounted.container;
    await typeInto(field(c, 'Display name'), 'Synthetic Person');
    await typeInto(field(c, 'Email address'), EMAIL);
    await click(button(c, 'Send invite'));
    expect(plain(c.innerHTML)).toContain('Two-step sign-in is needed for this screen.');
    expect(c.textContent).not.toContain('Invitation created.');
  });
});
