// The test editor is for staff only (owner, admin, recruiter; specs/d1-demo-slice.md §6.1, security review): a
// reviewer sees no "Open" or "Edit" link, the editor route shows the no-access text, and the test detail is never
// requested for them. The server decides every request; this is the screen not offering what it would refuse.
import type { TestListResponse } from '@trace/shared/contracts/d1';
import { renderToString } from 'react-dom/server';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, type FetchLike } from '../api/client';
import { ApiContext, OrgInfoContext, type OrgInfo } from '../api/runtime';
import { NO_ACCESS_TEXT } from '../shell/nav';
import { TestEditorRoute, testDetailLoader } from './TestEditorPage';
import { TestsView } from './TestsListPage';

const ORG = '11111111-1111-4111-8111-111111111111';
const TEST_ID = '22222222-2222-4222-8222-222222222222';
const plain = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const TESTS: TestListResponse = {
  tests: [
    {
      id: TEST_ID,
      name: 'Synthetic draft test',
      status: 'draft',
      versionNo: 1,
      invitationCount: 0,
      createdAt: '2026-10-19T10:00:00.000Z',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Synthetic published test',
      status: 'published',
      versionNo: 2,
      invitationCount: 3,
      createdAt: '2026-10-19T10:00:00.000Z',
    },
  ],
};

function apiWith(fetchImpl: FetchLike): ApiClient {
  return new ApiClient({
    origin: 'https://trace-api-staging.example-sub.workers.dev',
    orgId: ORG,
    getAccessToken: () => Promise.resolve('tok'),
    fetch: fetchImpl,
  });
}

const info = (roles: string[]): OrgInfo => ({
  orgId: ORG,
  orgName: 'Synthetic Staffing',
  userId: '44444444-4444-4444-8444-444444444444',
  roles,
});

function editorHtml(roles: string[], fetchImpl: FetchLike): string {
  const router = createMemoryRouter([{ path: '/tests/:testId', element: <TestEditorRoute /> }], {
    initialEntries: [`/tests/${TEST_ID}`],
  });
  return renderToString(
    <OrgInfoContext value={info(roles)}>
      <ApiContext value={apiWith(fetchImpl)}>
        <RouterProvider router={router} />
      </ApiContext>
    </OrgInfoContext>,
  );
}

describe('the tests list', () => {
  it('shows "Edit" and "Open" links to staff', () => {
    const html = renderToString(
      <RouterProviderFor>
        <TestsView data={TESTS} canCreate />
      </RouterProviderFor>,
    );
    expect(html).toContain(`href="/tests/${TEST_ID}"`);
    expect(plain(html)).toContain('Edit');
    expect(plain(html)).toContain('Open');
  });

  it('shows a reviewer neither "Edit" nor "Open", and no link to the editor, but still the results', () => {
    const html = renderToString(
      <RouterProviderFor>
        <TestsView data={TESTS} canCreate={false} />
      </RouterProviderFor>,
    );
    expect(plain(html)).not.toMatch(/\b(?:Edit|Open)\b/);
    for (const test of TESTS.tests) {
      expect(html).not.toContain(`href="/tests/${test.id}"`);
      expect(html).toContain(`href="/tests/${test.id}/results"`);
    }
  });
});

describe('the editor route', () => {
  it.each([['org_owner'], ['admin'], ['recruiter']])('loads the test detail for a %s', (role) => {
    const fetchImpl = vi.fn<FetchLike>(() => Promise.resolve(new Response('{}', { status: 404 })));
    const html = editorHtml([role], fetchImpl);
    expect(plain(html)).toContain('Loading...');
    expect(plain(html)).not.toContain(NO_ACCESS_TEXT);
  });

  it('shows a reviewer the no-access text and no editor', () => {
    const fetchImpl = vi.fn<FetchLike>(() => Promise.resolve(new Response('{}', { status: 404 })));
    const html = editorHtml(['reviewer'], fetchImpl);
    expect(plain(html)).toContain(NO_ACCESS_TEXT);
    expect(plain(html)).not.toContain('Loading...');
    expect(html).not.toContain('<form');
  });
});

describe('testDetailLoader', () => {
  it('requests the test detail for staff', async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = (url) => {
      urls.push(url);
      return Promise.resolve(new Response('{}', { status: 404 }));
    };
    for (const role of ['org_owner', 'admin', 'recruiter']) {
      const load = testDetailLoader(apiWith(fetchImpl), TEST_ID, [role]);
      expect(load).not.toBeNull();
      await load?.();
    }
    expect(urls).toHaveLength(3);
    for (const url of urls) expect(new URL(url).pathname).toBe(`/v1/orgs/${ORG}/tests/${TEST_ID}`);
  });

  it('gives a reviewer, or an unknown role set, no loader, so no request can be made', () => {
    const fetchImpl = vi.fn<FetchLike>(() => Promise.resolve(new Response('{}')));
    const api = apiWith(fetchImpl);
    expect(testDetailLoader(api, TEST_ID, ['reviewer'])).toBeNull();
    expect(testDetailLoader(api, TEST_ID, ['hiring_manager'])).toBeNull();
    expect(testDetailLoader(api, TEST_ID, [])).toBeNull();
    expect(testDetailLoader(api, TEST_ID, null)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function RouterProviderFor({ children }: { children: React.ReactNode }) {
  const router = createMemoryRouter([{ path: '/', element: children }]);
  return <RouterProvider router={router} />;
}
