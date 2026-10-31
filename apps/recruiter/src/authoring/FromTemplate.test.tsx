// @vitest-environment happy-dom
// Create a test from a role template (specs/m1-test-authoring.md §6.1, M1-16, E18, R5-54 a): templates are listed in
// cursor pages, a pasted job description proposes one (`POST …/blueprints/propose`, ABH-5: a match of at least 0.15 is
// preselected, else "Pick a template"), the draft is created from the chosen one, and the typing and voice sections
// the blueprint lists but cannot serve yet are shown as a visible note. Synthetic data only.
import {
  BlueprintProposeResponse,
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
    proposal: { kind: 'none' },
    onSelect: () => undefined,
    onJobTitle: () => undefined,
    onJdText: () => undefined,
    onMore: () => undefined,
    onPropose: () => undefined,
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

  it('says what the job description is used for, and no longer that it shapes the draft', () => {
    const text = plain(render());
    expect(text).not.toContain('read once to shape the draft');
    expect(text).toContain('The job description is used only to suggest a template');
    expect(text).toContain('Its text is not stored.');
  });

  it('embedded in the tests/new wizard, it is a step section under the page heading', () => {
    const html = render({ embedded: true });
    expect(plain(html)).toContain('Or start from a role template');
    expect(html).not.toMatch(/<h2\b/);
  });

  it('shows the proposal, or "Pick a template" when nothing matches', () => {
    const matched = plain(
      render({
        proposal: {
          kind: 'matched',
          name: 'BPO Voice',
          sections: [
            { title: 'Verbal', available: true },
            { title: 'Spoken English', available: false },
          ],
        },
      }),
    );
    expect(matched).toContain('Suggested from the job description: BPO Voice.');
    expect(matched).toContain('Spoken English (not available yet)');
    expect(plain(render({ proposal: { kind: 'no_match' } }))).toContain(
      'No template matches this job description closely enough. Pick a template.',
    );
  });

  it('shows the skipped sections as a note once created', () => {
    const text = plain(render({ created }));
    expect(text).toContain('Draft created');
    expect(text).toContain('left out of this draft');
    expect(text).toContain('Typing speed');
    expect(text).toContain('Spoken English');
  });

  it('names an unavailable multiple-choice or written section it skipped (R5-71 i)', () => {
    const text = plain(
      render({
        created: {
          ...created,
          skippedSections: [
            { title: 'Choices', format: 'mcq' },
            { title: 'Essay', format: 'written' },
          ],
        },
      }),
    );
    expect(text).toContain('Choices (multiple-choice section)');
    expect(text).toContain('Essay (written section)');
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
    expect(button(c, 'Create draft from template').disabled).toBe(true);
    await typeInto(field(c, 'Job title'), 'Support associate');
    await click(field(c, 'Customer Support (version 1, Standard)'));
    expect(button(c, 'Create draft from template').disabled).toBe(false);
    await click(button(c, 'Create draft from template'));
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
    await click(button(c, 'Create draft from template'));
    expect(seen).toEqual([
      {
        jobTitle: 'Support associate',
        templateKey: 'bpo_voice',
        templateVersion: 1,
        jdText: 'Answers synthetic questions.',
      },
    ]);
  });

  const proposed = (matchPermille: number) =>
    BlueprintProposeResponse.parse({
      proposal: {
        templateKey: 'bpo_voice',
        version: 1,
        matchPermille,
        sections: [
          { title: 'Verbal', format: 'mcq', skillKey: 'verbal', drawCount: 10, available: true },
          {
            title: 'Spoken English',
            format: 'voice',
            skillKey: 'spoken_english',
            drawCount: 1,
            available: false,
          },
        ],
      },
    });

  it('proposes a template from the pasted job description and preselects it (ABH-5)', async () => {
    const seen: unknown[] = [];
    const proposeBodies: unknown[] = [];
    const { api } = fakeApi({
      ...routes(seen),
      'POST /blueprints/propose': (call) => {
        proposeBodies.push(call.body);
        return { body: proposed(400) };
      },
    });
    mounted = await mountScreen(<FromTemplateRoute />, api, ['recruiter']);
    const c = mounted.container;
    expect(button(c, 'Suggest a template').disabled).toBe(true);
    await typeInto(field(c, 'Job title'), 'Voice associate');
    await typeInto(field(c, 'Job description (optional)'), 'Synthetic calls in English.');
    await click(button(c, 'Suggest a template'));
    expect(proposeBodies).toEqual([{ jdText: 'Synthetic calls in English.' }]);
    expect(field<HTMLInputElement>(c, 'BPO Voice (version 1, Strict)').checked).toBe(true);
    expect(field<HTMLInputElement>(c, 'Customer Support (version 1, Standard)').checked).toBe(
      false,
    );
    expect(plain(c.innerHTML)).toContain('Suggested from the job description: BPO Voice.');
    await click(button(c, 'Create draft from template'));
    expect(seen).toEqual([
      {
        jobTitle: 'Voice associate',
        templateKey: 'bpo_voice',
        templateVersion: 1,
        jdText: 'Synthetic calls in English.',
      },
    ]);
  });

  it('with no proposal, selects nothing and asks to pick a template', async () => {
    const { api } = fakeApi({
      ...routes(),
      'POST /blueprints/propose': () => ({ body: { proposal: null } }),
    });
    mounted = await mountScreen(<FromTemplateRoute />, api, ['recruiter']);
    const c = mounted.container;
    await typeInto(field(c, 'Job title'), 'Clerk');
    await typeInto(field(c, 'Job description (optional)'), 'Unrelated synthetic text.');
    await click(button(c, 'Suggest a template'));
    expect(plain(c.innerHTML)).toContain('Pick a template.');
    expect(
      [...c.querySelectorAll('input[type="radio"]')].some((r) => (r as HTMLInputElement).checked),
    ).toBe(false);
    expect(button(c, 'Create draft from template').disabled).toBe(true);
  });

  it('never preselects a match below 0.15', async () => {
    const { api } = fakeApi({
      ...routes(),
      'POST /blueprints/propose': () => ({ body: proposed(149) }),
    });
    mounted = await mountScreen(<FromTemplateRoute />, api, ['recruiter']);
    const c = mounted.container;
    await typeInto(field(c, 'Job description (optional)'), 'Synthetic text.');
    await click(button(c, 'Suggest a template'));
    expect(field<HTMLInputElement>(c, 'BPO Voice (version 1, Strict)').checked).toBe(false);
    expect(plain(c.innerHTML)).toContain('Pick a template.');
  });

  it('a refused proposal shows a fixed failure text and keeps the choice open', async () => {
    const { api } = fakeApi({
      ...routes(),
      'POST /blueprints/propose': () => ({ status: 400, body: { error: { code: 'bad_request' } } }),
    });
    mounted = await mountScreen(<FromTemplateRoute />, api, ['recruiter']);
    const c = mounted.container;
    await typeInto(field(c, 'Job description (optional)'), 'Synthetic text.');
    await click(button(c, 'Suggest a template'));
    expect(plain(c.innerHTML)).toContain('Some values were not accepted. Check the form.');
    expect(plain(c.innerHTML)).toContain('Customer Support');
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
    await click(button(c, 'Create draft from template'));
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
