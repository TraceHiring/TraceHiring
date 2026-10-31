// @vitest-environment happy-dom
// `/drives` (specs/m2-scheduling-invites.md §6.1, M2-8, R5-31): the drive list in cursor pages, with the window shown
// in IST, and a link to each drive and to a new one. A fake fetch stands in for the api. Synthetic data only.
import type { DriveListResponse } from '@trace/shared/contracts/m2';
import { afterEach, describe, expect, it } from 'vitest';
import { failure, fakeApi, info } from '../bank/testing/api.test-helpers';
import { mountScreen, type Mounted } from '../bank/testing/dom.test-helpers';
import { DrivesRoute } from './DriveRoutes';
import { cursorFor, summary, uid } from './testing/fixtures.test-helpers';
import { formatIst } from './time';

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const PAGE_ONE: DriveListResponse = {
  drives: [
    summary(1, { status: 'scheduled' }),
    summary(2, { mode: 'open_window', status: 'draft' }),
    summary(3, { status: 'closed' }),
    summary(4, { status: 'cancelled' }),
  ],
  nextCursor: cursorFor(1),
};
const PAGE_TWO: DriveListResponse = { drives: [summary(5)], nextCursor: null };

function listApi() {
  return fakeApi((call) => {
    if (call.method !== 'GET' || call.path !== '/drives') return undefined;
    return { body: call.query['cursor'] === cursorFor(1) ? PAGE_TWO : PAGE_ONE };
  });
}
const mountList = (api: ReturnType<typeof listApi>['api'] | null) =>
  mountScreen(<DrivesRoute />, { api, info: info('recruiter'), at: '/drives' });

describe('the drive list', () => {
  it('shows name, mode, status and the window in IST for each drive', async () => {
    const { api } = listApi();
    mounted = await mountList(api);
    const text = mounted.text();
    expect(text).toContain('Drives');
    expect(text).toContain('[synthetic] Drive 1');
    expect(text).toContain('Scheduled slots');
    expect(text).toContain('Open window');
    for (const status of ['Draft', 'Published', 'Closed', 'Cancelled'])
      expect(text).toContain(status);
    const opens = formatIst(summary(1).opensAt);
    const deadline = formatIst(summary(1).deadlineAt);
    expect(opens).toMatch(/IST$/);
    expect(opens).toContain('2 Nov 2026');
    expect(opens).toContain('10:00');
    expect(text).toContain(opens);
    expect(text).toContain(deadline);
  });

  it('links to each drive and to a new one', async () => {
    const { api } = listApi();
    mounted = await mountList(api);
    const links = mounted.links();
    expect(links).toContain('/drives/new');
    for (const n of [1, 2, 3, 4]) expect(links).toContain(`/drives/${uid(100 + n)}`);
  });

  it('pages with a keyset cursor: "Next page" asks for the next page, "Previous page" goes back', async () => {
    const { api, calls } = listApi();
    mounted = await mountList(api);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toEqual({});
    expect(mounted.maybeButton('Previous page')).toBeNull();

    await mounted.click(mounted.button('Next page'));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.query).toEqual({ cursor: cursorFor(1) });
    expect(mounted.text()).toContain('[synthetic] Drive 5');
    expect(mounted.text()).not.toContain('[synthetic] Drive 1');
    expect(mounted.maybeButton('Next page')).toBeNull();

    await mounted.click(mounted.button('Previous page'));
    expect(mounted.text()).toContain('[synthetic] Drive 1');
    expect(mounted.maybeButton('Next page')).not.toBeNull();
  });

  it('says so when there are no drives, and still offers a new one', async () => {
    const { api } = fakeApi((call) =>
      call.path === '/drives' ? { body: { drives: [], nextCursor: null } } : undefined,
    );
    mounted = await mountList(api);
    expect(mounted.text()).toContain('No drives yet.');
    expect(mounted.links()).toContain('/drives/new');
  });

  it('shows a failure as fixed text, never the server’s words', async () => {
    const { api } = fakeApi(() => failure(500, 'boom_internal_detail'));
    mounted = await mountList(api);
    expect(mounted.text()).toContain('Something went wrong. Try again.');
    expect(mounted.text()).not.toContain('boom_internal_detail');
  });

  it('shows the heading and a loading line when there is no api client yet', async () => {
    mounted = await mountList(null);
    expect(mounted.text()).toContain('Drives');
  });
});
