// @vitest-environment happy-dom
// Create a test from a role template (specs/m1-test-authoring.md §6.1, M1-16, E18, R5-54 a): templates are listed in
// cursor pages, the draft is created from the chosen one, and the typing and voice sections the blueprint lists but
// cannot serve yet are shown as a visible note. Synthetic data only.
import {
  CreateTestFromTemplateResponse,
  encodePageCursor,
  RoleTemplateListResponse,
} from '@trace/shared/contracts/m1';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import {
  button,
  click,
  fakeApi,
  field,
  mountScreen,
  plain,
  typeInto,
  uuid,
  type Mounted,
} from './dom.test-helpers';
import {
  FromTemplateRoute,
  FromTemplateView,
  type FromTemplateViewProps,
} from './FromTemplateRoute';

const AT = '2026-10-23T10:00:00.000Z';
const page1 = RoleTemplateListResponse.parse({
  templates: [
    {
      templateKey: 'customer_support',
      version: 1,
      name: 'Customer Support',
      presetKey: 'standard',
    },
    { templateKey: 'bpo_voice', version: 1, name: 'BPO Voice', presetKey: 'strict' },
  ],
  nextCursor: encodePageCursor({ createdAt: AT, id: uuid(5) }),
});
const page2 = RoleTemplateListResponse.parse({
  templates: [
    { templateKey: 'back_office', version: 2, name: 'Back Office', presetKey: 'open_book' },
  ],
  nextCursor: null,
});
const created = CreateTestFromTemplateResponse.parse({
  draft: {
    test: { id: uuid(40), workspaceId: uuid(2), name: 'Synthetic support test', createdAt: AT },
    version: {
      id: uuid(41),
      versionNo: 1,
      status: 'draft',
      durationMinutes: 40,
      qualityCutoff: 40,
      publishedAt: null,
      sections: [],
    },
  },
  skippedSections: [
    { title: 'Typing speed', format: 'typing' },
    { title: 'Spoken English', format: 'voice' },
  ],
});

let mounted: Mounted | undefined;
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
});

describe('FromTemplateView (static)', () => {
  const props: FromTemplateViewProps = {
    status: 'ready',
    templates: page1.templates,
    hasMore: true,
    loadingMore: false,
    selected: null,
    jobTitle: '',
    jdText: '',
    busy: false,
    error: null,
    created: null,
    onSelect: () => undefined,
    onJobTitle: () => undefined,
    onJdText: () => undefined,
    onMore: () => undefined,
    onCreate: () => undefined,
  };
  const render = (over: Partial<typeof props> = {}) =>
    renderToString(
      <MemoryRouter>
        <FromTemplateView {...props} {...over} />
      </MemoryRouter>,
    );

  it('keeps the heading in every state, including loading', () => {
    for (const status of ['loading', 'ready', 'error'] as const) {
      expect(plain(render({ status }))).toContain('New test from a template');
    }
  });

  it('lists templates with their preset and uses radios, no checkbox', () => {
    const html = render();
    expect(plain(html)).toContain('Customer Support');
    expect(plain(html)).toContain('BPO Voice');
    expect(html).toMatch(/type="radio"/);
    expect(html).not.toMatch(/type="checkbox"| style=/);
  });

  it('shows the skipped sections as a note once created', () => {
    const text = plain(render({ created }));
    expect(text).toContain('Draft created');
    expect(text).toContain('left out of this draft');
    expect(text).toContain('Typing speed');
    expect(text).toContain('Spoken English');
  });
});

describe('FromTemplateRoute', () => {
  const routes = (seen: unknown[] = []) => ({
    'GET /templates': (call: { query: string }) => ({ body: call.query === '' ? page1 : page2 }),
    'POST /tests/from-template': (call: { body: unknown }) => {
      seen.push(call.body);
      return { status: 201, body: created };
    },
  });

  it('pages through templates with the cursor, and only offers Load more while there is a next page', async () => {
    const { api, calls } = fakeApi(routes());
    mounted = await mountScreen(<FromTemplateRoute />, api, ['recruiter']);
    const c = mounted.container;
    expect(plain(c.innerHTML)).toContain('Customer Support');
    expect(plain(c.innerHTML)).not.toContain('Back Office');
    await click(button(c, 'Load more templates'));
    expect(plain(c.innerHTML)).toContain('Back Office');
    expect(calls.map((x) => x.query)).toEqual([
      '',
      `?cursor=${encodeURIComponent(page1.nextCursor ?? '')}`,
    ]);
    expect([...c.querySelectorAll('button')].map((b) => b.textContent)).not.toContain(
      'Load more templates',
    );
  });

  it('creates the draft from the chosen template and shows what was left out', async () => {
    const seen: unknown[] = [];
    const { api } = fakeApi(routes(seen));
    mounted = await mountScreen(<FromTemplateRoute />, api, ['recruiter']);
    const c = mounted.container;
    expect(button(c, 'Create draft').disabled).toBe(true);
    await typeInto(field(c, 'Job title'), 'Support associate');
    await click(field(c, 'Customer Support (version 1, Standard)'));
    expect(button(c, 'Create draft').disabled).toBe(false);
    await click(button(c, 'Create draft'));
    expect(seen).toEqual([
      { jobTitle: 'Support associate', templateKey: 'customer_support', templateVersion: 1 },
    ]);
    const text = plain(c.innerHTML);
    expect(text).toContain('Draft created');
    expect(text).toContain('Typing speed');
    expect(text).toContain('Spoken English');
    const open = [...c.querySelectorAll('a')].find((a) => a.textContent === 'Open the draft');
    expect(open?.getAttribute('href')).toBe(`/tests/${uuid(40)}`);
  });

  it('sends the job description only when one was typed', async () => {
    const seen: unknown[] = [];
    const { api } = fakeApi(routes(seen));
    mounted = await mountScreen(<FromTemplateRoute />, api, ['recruiter']);
    const c = mounted.container;
    await typeInto(field(c, 'Job title'), 'Support associate');
    await typeInto(field(c, 'Job description (optional)'), 'Answers synthetic questions.');
    await click(field(c, 'BPO Voice (version 1, Strict)'));
    await click(button(c, 'Create draft'));
    expect(seen).toEqual([
      {
        jobTitle: 'Support associate',
        templateKey: 'bpo_voice',
        templateVersion: 1,
        jdText: 'Answers synthetic questions.',
      },
    ]);
  });

  it('shows a fixed failure text and keeps the form when the api refuses', async () => {
    const { api } = fakeApi({
      'GET /templates': () => ({ body: page2 }),
      'POST /tests/from-template': () => ({
        status: 400,
        body: { error: { code: 'bad_request' } },
      }),
    });
    mounted = await mountScreen(<FromTemplateRoute />, api, ['recruiter']);
    const c = mounted.container;
    await typeInto(field(c, 'Job title'), 'Clerk');
    await click(field(c, 'Back Office (version 2, Open-book)'));
    await click(button(c, 'Create draft'));
    expect(plain(c.innerHTML)).toContain('Some values were not accepted. Check the form.');
    expect(field<HTMLInputElement>(c, 'Job title').value).toBe('Clerk');
  });

  it('says so when the templates cannot be loaded', async () => {
    const { api } = fakeApi({});
    mounted = await mountScreen(<FromTemplateRoute />, api, ['recruiter']);
    expect(plain(mounted.container.innerHTML)).toContain('Not found, or you do not have access.');
    expect(plain(mounted.container.innerHTML)).toContain('New test from a template');
  });
});
