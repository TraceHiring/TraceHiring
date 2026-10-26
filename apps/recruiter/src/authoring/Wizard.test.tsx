// @vitest-environment happy-dom
// The recruiter wizard on `/tests/:testId` (specs/m1-test-authoring.md §6.10; R5-69 a-h): steps 2 Questions,
// 3 Integrity and 4 Review and publish on one page under a step list; a D1-shaped draft keeps D1's editor, save
// (`PUT /tests/:id`) and publish exactly, a v2 draft is edited with the sections editor and D1's item editor and saved
// with `PUT …/draft` before publish; saving the integrity step re-saves the draft so the publish uses those settings;
// the published view is read-only with "Edit as new version". Synthetic data only.
import {
  INTEGRITY_CATALOG_VERSION,
  IntegritySettingsView,
  TestDraftView,
  encodePageCursor,
  type PoolDetail,
} from '@trace/shared/contracts/m1';
import { renderCandidateSummary } from '@trace/shared';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorText } from '../common/messages';
import { INTEGRITY_PRESETS } from '../settings/integrity-model';
import {
  button,
  choose,
  click,
  fakeApi,
  field,
  mountScreen,
  plain,
  typeInto,
  uuid,
  type Call,
  type Mounted,
  type Routes as ApiRoutes,
} from './dom.test-helpers';
import { EditorBody, FREEZE_COPY, TestEditorRoute } from './TestEditorPage';

const TEST = uuid(1);
const VERSION = uuid(3);
const AT = '2026-10-23T10:00:00.000Z';

const mcqItem = {
  id: uuid(20),
  position: 1,
  format: 'mcq' as const,
  prompt: 'Synthetic question?',
  options: [
    { id: 'o1', text: 'First' },
    { id: 'o2', text: 'Second' },
  ],
  correctOptionId: 'o1',
};
const writtenItem = {
  id: uuid(21),
  position: 1,
  format: 'written' as const,
  prompt: 'Describe a synthetic situation.',
  rubric: {
    criteria: [{ id: 'c1', label: 'Clarity', maxPoints: 10, anchors: ['clear steps'], minHits: 1 }],
  },
};
const d1Sections = [
  {
    id: uuid(10),
    position: 1,
    mode: 'inline',
    format: 'mcq',
    name: 'Multiple choice',
    weight: 50,
    items: [mcqItem],
    shuffleItems: false,
    shuffleOptions: false,
    navigation: null,
  },
  {
    id: uuid(11),
    position: 2,
    mode: 'inline',
    format: 'written',
    name: 'Written answers',
    weight: 50,
    items: [writtenItem],
    shuffleItems: false,
    shuffleOptions: false,
    navigation: null,
  },
];
/** A draft made from a template: pool sections, the preset stored. */
const templateSections = [
  {
    id: uuid(12),
    position: 1,
    mode: 'pool',
    format: 'mcq',
    name: 'Verbal',
    weight: 50,
    items: [],
    poolId: uuid(50),
    drawCount: 10,
    shuffleItems: true,
    shuffleOptions: true,
    navigation: 'free',
  },
  {
    id: uuid(13),
    position: 2,
    mode: 'pool',
    format: 'written',
    name: 'Written communication',
    weight: 50,
    items: [],
    poolId: uuid(51),
    drawCount: 1,
    shuffleItems: false,
    shuffleOptions: false,
    navigation: 'forward_only',
    pasteRule: 'allowed_logged',
  },
];
/** A v2 draft with an inline multiple-choice section next to a pool section. */
const mixedSections = [
  { ...d1Sections[0], navigation: 'free' },
  { ...templateSections[1], position: 2 },
];

const draftView = (
  sections: unknown[],
  status: 'draft' | 'published' = 'draft',
  name = 'Synthetic support test',
) =>
  TestDraftView.parse({
    test: { id: TEST, workspaceId: uuid(2), name, createdAt: AT },
    version: {
      id: VERSION,
      versionNo: 1,
      status,
      durationMinutes: 40,
      qualityCutoff: 40,
      publishedAt: status === 'draft' ? null : AT,
      sections,
    },
  });
const integrityView = (presetKey: 'standard' | 'strict' | null, stored = presetKey !== null) => {
  const values =
    presetKey === 'strict'
      ? INTEGRITY_PRESETS.strict
      : presetKey === 'standard'
        ? INTEGRITY_PRESETS.standard
        : { ...INTEGRITY_PRESETS.standard, paste_written: 'blocked' as const };
  return IntegritySettingsView.parse({
    presetKey,
    values,
    locked: {
      integrity_review_scope: 'always',
      accommodations: 'always',
      id_verification: 'always',
    },
    candidateSummary: renderCandidateSummary(values, INTEGRITY_CATALOG_VERSION).lines,
    stored,
  });
};
const pool = (n: number, name: string, format: 'mcq' | 'written'): PoolDetail => ({
  id: uuid(n),
  name,
  format,
  skillKey: null,
  status: 'active',
  itemCount: 40,
  approvedCount: 30,
  usedByDraws: [],
  usedByDrawsTotal: 0,
});
const PUBLISHED = {
  testVersionId: VERSION,
  versionNo: 1,
  status: 'published',
  publishedAt: AT,
  contentSha256: 'a'.repeat(64),
  qualityCutoff: 40,
};

const routesFor = (
  detail: TestDraftView,
  integrity: IntegritySettingsView,
  extra: ApiRoutes = {},
): ApiRoutes => ({
  [`GET /tests/${TEST}`]: () => ({ body: detail }),
  [`GET /tests/${TEST}/integrity`]: () => ({ body: integrity }),
  [`PUT /tests/${TEST}`]: () => ({ body: detail }),
  [`PUT /tests/${TEST}/draft`]: () => ({ body: detail }),
  [`POST /tests/${TEST}/publish`]: () => ({ body: PUBLISHED }),
  'GET /pools': () => ({
    body: {
      pools: [pool(50, 'Verbal pool', 'mcq'), pool(51, 'Prompts pool', 'written')],
      nextCursor: null,
    },
  }),
  ...extra,
});
/** The calls the editor itself made (the reviewers panel has its own). */
const editorCalls = (calls: Call[]) =>
  calls
    .filter((c) => c.path.startsWith(`/tests/${TEST}`) || c.path === '/pools')
    .filter((c) => !c.path.includes('/assignments'))
    .map((c) => `${c.method} ${c.path}${c.query}`);
/** R5-70 a: every draft save names the version it was loaded from. */
const Q = `?version=${VERSION}`;
const bodyOf = (calls: Call[], key: string) =>
  calls.find((c) => `${c.method} ${c.path}` === key)?.body;

let mounted: Mounted | undefined;
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
});

async function mountBody(
  detail: TestDraftView,
  integrity: IntegritySettingsView | null,
  extra: ApiRoutes = {},
) {
  const { api, calls } = fakeApi(routesFor(detail, integrity ?? integrityView(null), extra));
  const onReload = vi.fn();
  mounted = await mountScreen(
    <EditorBody api={api} detail={detail} integrity={integrity} onReload={onReload} />,
    api,
    ['recruiter'],
  );
  return { c: mounted.container, calls, onReload };
}

const STEP_LIST = ['1. Job details', '2. Questions', '3. Integrity', '4. Review and publish'];
const stepList = (c: HTMLElement) =>
  [...(c.querySelector('ol[aria-label="Steps"]')?.querySelectorAll('li') ?? [])].map(
    (li) => li.textContent,
  );
const headings = (c: HTMLElement, level: string) =>
  [...c.querySelectorAll(level)].map((h) => h.textContent);

describe('the editor route loads the draft and its integrity settings (R5-69 a)', () => {
  it('a D1 draft: the h2 is the test name, steps 2 to 4 on one page, D1 editor, no pool request', async () => {
    const detail = draftView(d1Sections);
    const { api, calls } = fakeApi(routesFor(detail, integrityView(null)));
    mounted = await mountScreen(
      <Routes>
        <Route path="/tests/:testId" element={<TestEditorRoute />} />
      </Routes>,
      api,
      ['recruiter'],
      `/tests/${TEST}`,
    );
    const c = mounted.container;
    expect(headings(c, 'h2')).toEqual(['Synthetic support test']);
    expect(stepList(c)).toEqual(STEP_LIST);
    expect(headings(c, 'h3')).toEqual(
      expect.arrayContaining([
        'Step 2: Questions',
        'Step 3: Integrity',
        'Step 4: Review and publish',
      ]),
    );
    expect(field<HTMLInputElement>(c, 'Answer Quality cutoff (0 to 100)').value).toBe('40');
    expect(c.querySelectorAll('[aria-label="Multiple choice section"]')).toHaveLength(1);
    expect(headings(c, 'h3')).not.toContain('Sections');
    expect(headings(c, 'h3')).toContain('Integrity settings');
    expect(editorCalls(calls)).toEqual([`GET /tests/${TEST}`, `GET /tests/${TEST}/integrity`]);
  });

  it('a template draft: the v2 editor with the pool picker', async () => {
    const detail = draftView(templateSections, 'draft', 'Support associate');
    const { api, calls } = fakeApi(routesFor(detail, integrityView('standard')));
    mounted = await mountScreen(
      <Routes>
        <Route path="/tests/:testId" element={<TestEditorRoute />} />
      </Routes>,
      api,
      ['recruiter'],
      `/tests/${TEST}`,
    );
    const c = mounted.container;
    expect(headings(c, 'h2')).toEqual(['Support associate']);
    expect(stepList(c)).toEqual(STEP_LIST);
    expect(headings(c, 'h3')).toContain('Sections');
    expect(c.querySelectorAll('[aria-label="Multiple choice section"]')).toHaveLength(0);
    // One cutoff field with D1's label (R5-69 h).
    expect(field<HTMLInputElement>(c, 'Answer Quality cutoff (0 to 100)').value).toBe('40');
    expect(editorCalls(calls)).toEqual([
      `GET /tests/${TEST}`,
      `GET /tests/${TEST}/integrity`,
      'GET /pools',
    ]);
    const poolSelect = c.querySelectorAll('select');
    expect(plain([...poolSelect].map((s) => s.outerHTML).join(' '))).toContain(
      'Verbal pool (30 approved)',
    );
  });
});

describe('a D1-shaped draft keeps D1 save and publish exactly (R5-69 b, h)', () => {
  it('saves with PUT /tests/:id, never PUT …/draft, and the body has no M1 field', async () => {
    const { c, calls } = await mountBody(draftView(d1Sections), integrityView(null));
    await click(button(c, 'Save draft'));
    expect(editorCalls(calls)).toEqual([`PUT /tests/${TEST}${Q}`]);
    const body = bodyOf(calls, `PUT /tests/${TEST}`) as { sections: Record<string, unknown>[] };
    expect(body.sections.map((s) => Object.keys(s).sort())).toEqual([
      ['format', 'items', 'name', 'weight'],
      ['format', 'items', 'name', 'weight'],
    ]);
    expect(plain(c.innerHTML)).toContain('Draft saved.');
  });

  it('publishes through the dialog: D1 save, then publish with the version id, then reloads', async () => {
    const { c, calls, onReload } = await mountBody(draftView(d1Sections), integrityView(null));
    await click(button(c, 'Publish...'));
    const dialog = c.querySelector('[role="dialog"]');
    expect(dialog?.querySelector('h3')?.textContent).toBe('Publish this test');
    await click(button(c, 'Publish test'));
    expect(editorCalls(calls)).toEqual([`PUT /tests/${TEST}${Q}`, `POST /tests/${TEST}/publish`]);
    expect(bodyOf(calls, `POST /tests/${TEST}/publish`)).toEqual({ testVersionId: VERSION });
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('offers step 3; saving it saves the D1 form and reloads into the v2 editor', async () => {
    const { c, calls, onReload } = await mountBody(draftView(d1Sections), integrityView(null), {
      [`PUT /tests/${TEST}/integrity`]: () => ({ body: integrityView('standard') }),
    });
    await click(field<HTMLInputElement>(c, 'Standard'));
    await click(button(c, 'Save settings'));
    expect(editorCalls(calls)).toEqual([`PUT /tests/${TEST}/integrity`, `PUT /tests/${TEST}${Q}`]);
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe('a v2 draft (R5-69 b-e)', () => {
  it('saves with PUT …/draft; written sections take the stored paste setting', async () => {
    const { c, calls } = await mountBody(draftView(templateSections), integrityView('standard'));
    await click(button(c, 'Save draft'));
    expect(editorCalls(calls)).toEqual(['GET /pools', `PUT /tests/${TEST}/draft${Q}`]);
    const body = bodyOf(calls, `PUT /tests/${TEST}/draft`) as {
      sections: { mode: string; poolId?: string; pasteRule?: string; navigation: string }[];
    };
    expect(body.sections.map((s) => [s.mode, s.poolId, s.navigation, s.pasteRule])).toEqual([
      ['pool', uuid(50), 'free', undefined],
      ['pool', uuid(51), 'forward_only', 'allowed_logged'],
    ]);
  });

  it('publishes: saves the draft, then publishes the version, then reloads', async () => {
    const { c, calls, onReload } = await mountBody(
      draftView(templateSections),
      integrityView('standard'),
    );
    await click(button(c, 'Publish...'));
    await click(button(c, 'Publish test'));
    expect(editorCalls(calls)).toEqual([
      'GET /pools',
      `PUT /tests/${TEST}/draft${Q}`,
      `POST /tests/${TEST}/publish`,
    ]);
    expect(bodyOf(calls, `POST /tests/${TEST}/publish`)).toEqual({ testVersionId: VERSION });
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['pool_too_small', 422],
    ['package_too_large', 422],
  ])('a publish refused with %s says so in plain language', async (code, status) => {
    const { c, onReload } = await mountBody(
      draftView(templateSections),
      integrityView('standard'),
      {
        [`POST /tests/${TEST}/publish`]: () => ({ status, body: { error: { code } } }),
      },
    );
    await click(button(c, 'Publish...'));
    await click(button(c, 'Publish test'));
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(errorText(code));
    expect(onReload).not.toHaveBeenCalled();
  });

  it('a save refused because the version is frozen (409) says so and does not publish', async () => {
    const { c, calls } = await mountBody(draftView(templateSections), integrityView('standard'), {
      [`PUT /tests/${TEST}/draft`]: () => ({ status: 409, body: { error: { code: 'conflict' } } }),
    });
    await click(button(c, 'Publish...'));
    await click(button(c, 'Publish test'));
    expect(editorCalls(calls)).not.toContain(`POST /tests/${TEST}/publish`);
    expect(c.querySelector('[role="alert"]')?.textContent).toBe(errorText('conflict'));
  });

  it('saving the integrity step re-saves the draft with the new paste setting (R5-69 c)', async () => {
    const { c, calls } = await mountBody(draftView(templateSections), integrityView('standard'), {
      [`PUT /tests/${TEST}/integrity`]: () => ({ body: integrityView('strict') }),
    });
    await click(field<HTMLInputElement>(c, 'Strict'));
    await click(button(c, 'Save settings'));
    expect(editorCalls(calls)).toEqual([
      'GET /pools',
      `PUT /tests/${TEST}/integrity`,
      `PUT /tests/${TEST}/draft${Q}`,
    ]);
    const body = bodyOf(calls, `PUT /tests/${TEST}/draft`) as {
      sections: { format: string; pasteRule?: string }[];
    };
    expect(body.sections.find((s) => s.format === 'written')?.pasteRule).toBe('blocked');
  });

  it('edits inline items with D1 item editor and saves them (R5-69 d)', async () => {
    const { c, calls } = await mountBody(draftView(mixedSections), integrityView('standard'));
    const prompt = field<HTMLTextAreaElement>(c, 'Question text');
    expect(prompt.value).toBe('Synthetic question?');
    await typeInto(prompt, 'Synthetic question, edited?');
    await click(button(c, 'Save draft'));
    const body = bodyOf(calls, `PUT /tests/${TEST}/draft`) as {
      sections: { items: { prompt: string }[] }[];
    };
    expect(body.sections[0]?.items.map((i) => i.prompt)).toEqual(['Synthetic question, edited?']);
  });

  it('a new inline section takes items', async () => {
    const { c, calls } = await mountBody(draftView(templateSections), integrityView('standard'));
    await click(button(c, 'Add a multiple-choice section'));
    const sections = c.querySelectorAll('li[data-section]');
    expect(sections).toHaveLength(3);
    const added = sections[2] as HTMLElement;
    await click(button(added, 'Add question'));
    expect(plain(added.innerHTML)).toContain('Question 1 (multiple choice)');
    await typeInto(field<HTMLTextAreaElement>(added, 'Question text'), 'New synthetic question?');
    await typeInto(field<HTMLInputElement>(added, 'Option 1'), 'Yes');
    await typeInto(field<HTMLInputElement>(added, 'Option 2'), 'No');
    await click(button(c, 'Save draft'));
    const body = bodyOf(calls, `PUT /tests/${TEST}/draft`) as {
      sections: { mode: string; items: { prompt: string; options: { text: string }[] }[] }[];
    };
    expect(body.sections[2]?.mode).toBe('inline');
    expect(body.sections[2]?.items).toEqual([
      {
        format: 'mcq',
        prompt: 'New synthetic question?',
        options: [
          { id: 'o1', text: 'Yes' },
          { id: 'o2', text: 'No' },
        ],
        correctOptionId: 'o1',
      },
    ]);
  });

  it('the pool picker lists every page the api gives (R5-69 e)', async () => {
    const next = encodePageCursor({ createdAt: AT, id: uuid(51) });
    const { c, calls } = await mountBody(draftView(templateSections), integrityView('standard'), {
      'GET /pools': (call) =>
        call.query === ''
          ? { body: { pools: [pool(50, 'Verbal pool', 'mcq')], nextCursor: next } }
          : { body: { pools: [pool(52, 'Reading pool', 'mcq')], nextCursor: null } },
    });
    await click(button(c, 'Show more pools'));
    expect(editorCalls(calls)).toEqual(['GET /pools', `GET /pools?cursor=${next}`]);
    expect(plain(c.innerHTML)).toContain('Verbal pool (30 approved)');
    expect(plain(c.innerHTML)).toContain('Reading pool (30 approved)');
    expect(() => button(c, 'Show more pools')).toThrow();
    // The picker chooses any listed pool of the section's format (no client workspace filter).
    const select = field<HTMLSelectElement>(
      c.querySelector('li[data-section]') as HTMLElement,
      'Pool',
    );
    await choose(select, uuid(52));
    await click(button(c, 'Save draft'));
    const body = bodyOf(calls, `PUT /tests/${TEST}/draft`) as { sections: { poolId?: string }[] };
    expect(body.sections[0]?.poolId).toBe(uuid(52));
  });
});

describe('the published view (R5-69 g)', () => {
  it('a D1 test is read-only, without the later-release sentence, with "Edit as new version"', async () => {
    const { c, calls, onReload } = await mountBody(
      draftView(d1Sections, 'published'),
      integrityView(null),
      { [`POST /tests/${TEST}/versions`]: () => ({ status: 201, body: draftView(d1Sections) }) },
    );
    const text = plain(c.innerHTML);
    expect(text).toMatch(/Published, version 1\./);
    expect(text).not.toContain('later release');
    expect(() => button(c, 'Save draft')).toThrow();
    expect(() => button(c, 'Publish...')).toThrow();
    for (const input of c.querySelectorAll('input, textarea')) {
      expect((input as HTMLInputElement).disabled).toBe(true);
    }
    await click(button(c, 'Edit as new version'));
    expect(editorCalls(calls)).toEqual([`POST /tests/${TEST}/versions`]);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('a v2 test is read-only too and offers "Edit as new version"', async () => {
    const { c } = await mountBody(
      draftView(templateSections, 'published'),
      integrityView('standard'),
    );
    expect(plain(c.innerHTML)).toMatch(/Published, version 1\./);
    expect(headings(c, 'h3')).toContain('Sections');
    expect(() => button(c, 'Save draft')).toThrow();
    expect(() => button(c, 'Save settings')).toThrow();
    expect(button(c, 'Edit as new version')).toBeDefined();
  });

  it('a draft already open (409) is named neutrally, with a link to it', async () => {
    const { c, onReload } = await mountBody(
      draftView(d1Sections, 'published'),
      integrityView(null),
      {
        [`POST /tests/${TEST}/versions`]: () => ({
          status: 409,
          body: { error: { code: 'conflict' } },
        }),
      },
    );
    await click(button(c, 'Edit as new version'));
    expect(plain(c.innerHTML)).toContain('A draft of this test is already open.');
    const link = [...c.querySelectorAll('a')].find((a) => a.textContent === 'Open the draft');
    expect(link?.getAttribute('href')).toBe(`/tests/${TEST}`);
    expect(onReload).not.toHaveBeenCalled();
    if (link !== undefined) await click(link);
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

// ---- fix round 1 (R5-70 d, e) ---------------------------------------------------------------------------------------

const mountRoute = async (routes: ApiRoutes) => {
  const { api, calls } = fakeApi(routes);
  mounted = await mountScreen(
    <Routes>
      <Route path="/tests/:testId" element={<TestEditorRoute />} />
    </Routes>,
    api,
    ['recruiter'],
    `/tests/${TEST}`,
  );
  return { c: mounted.container, calls };
};
const publishButton = (c: HTMLElement) => button(c, 'Publish...');

describe('which editor, from `stored` (R5-70 d)', () => {
  it('stored custom settings (preset null) on D1 sections make a v2 draft', async () => {
    const { c } = await mountBody(draftView(d1Sections), integrityView(null, true));
    expect(headings(c, 'h3')).toContain('Sections');
    expect(c.querySelectorAll('[aria-label="Multiple choice section"]')).toHaveLength(0);
  });

  it('settings not stored: D1 sections keep the D1 editor', async () => {
    const { c } = await mountBody(draftView(d1Sections), integrityView(null, false));
    expect(c.querySelectorAll('[aria-label="Multiple choice section"]')).toHaveLength(1);
  });

  it('the integrity read failed: the sections decide, and step 3 loads the settings itself', async () => {
    const failing = {
      [`GET /tests/${TEST}/integrity`]: () => ({
        status: 503,
        body: { error: { code: 'unavailable' } },
      }),
    };
    const d1 = await mountRoute(routesFor(draftView(d1Sections), integrityView(null), failing));
    expect(d1.c.querySelectorAll('[aria-label="Multiple choice section"]')).toHaveLength(1);
    expect(editorCalls(d1.calls).filter((x) => x.endsWith('/integrity'))).toHaveLength(2);
    await mounted?.unmount();
    mounted = undefined;

    const v2 = await mountRoute(
      routesFor(draftView(templateSections), integrityView(null), failing),
    );
    expect(headings(v2.c, 'h3')).toContain('Sections');
    expect(plain(v2.c.innerHTML)).toContain(errorText('unavailable'));
  });
});

describe('publish waits for step 3 (R5-70 e)', () => {
  it('v2: unsaved integrity changes disable Publish with a note, until they are saved', async () => {
    const { c } = await mountBody(draftView(templateSections), integrityView('standard'), {
      [`PUT /tests/${TEST}/integrity`]: () => ({ body: integrityView('strict') }),
    });
    expect(publishButton(c).disabled).toBe(false);
    await click(field<HTMLInputElement>(c, 'Strict'));
    expect(publishButton(c).disabled).toBe(true);
    expect(plain(c.innerHTML)).toContain(
      'Step 3 has unsaved changes. Save the settings before you publish.',
    );
    await click(button(c, 'Save settings'));
    expect(publishButton(c).disabled).toBe(false);
    expect(plain(c.innerHTML)).not.toContain('Step 3 has unsaved changes.');
  });

  it('D1: the same', async () => {
    const { c } = await mountBody(draftView(d1Sections), integrityView(null));
    expect(publishButton(c).disabled).toBe(false);
    await click(field<HTMLInputElement>(c, 'Strict'));
    expect(publishButton(c).disabled).toBe(true);
    expect(plain(c.innerHTML)).toContain(
      'Step 3 has unsaved changes. Save the settings before you publish.',
    );
  });
});

describe('the rest of R5-70 e', () => {
  it('a stored pool missing from the loaded pages shows as "Current pool"', async () => {
    const { c } = await mountBody(draftView(templateSections), integrityView('standard'), {
      'GET /pools': () => ({
        body: { pools: [pool(52, 'Reading pool', 'mcq')], nextCursor: null },
      }),
    });
    const select = field<HTMLSelectElement>(
      c.querySelector('li[data-section]') as HTMLElement,
      'Pool',
    );
    expect(select.value).toBe(uuid(50));
    expect(select.selectedOptions[0]?.textContent).toBe('Current pool');
    expect(plain(c.innerHTML)).not.toContain('Choose a pool');
  });

  it('the 10-question limit counts the whole test: Add question is disabled in both inline sections', async () => {
    const many = (item: typeof mcqItem | typeof writtenItem, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        ...item,
        id: uuid(300 + i + (item.format === 'mcq' ? 0 : 50)),
        position: i + 1,
      }));
    const sections = [
      { ...d1Sections[0], navigation: 'free', items: many(mcqItem, 6) },
      {
        ...d1Sections[1],
        navigation: 'forward_only',
        pasteRule: 'allowed_logged',
        items: many(writtenItem, 4),
      },
    ];
    const { c } = await mountBody(draftView(sections), integrityView('standard'));
    const adds = [...c.querySelectorAll('button')].filter((b) => b.textContent === 'Add question');
    expect(adds).toHaveLength(2);
    for (const b of adds) expect(b.disabled).toBe(true);
  });

  it('the v2 publish dialog carries the freeze copy', async () => {
    const { c } = await mountBody(draftView(templateSections), integrityView('standard'));
    await click(publishButton(c));
    const dialog = c.querySelector('[role="dialog"]');
    expect(plain(dialog?.innerHTML ?? '')).toContain(FREEZE_COPY);
  });

  it('the D1 published view keeps the "Reviewers" region', async () => {
    const { c } = await mountBody(draftView(d1Sections, 'published'), integrityView(null), {
      [`GET /tests/${TEST}/assignments`]: () => ({ body: { assignments: [] } }),
    });
    const region = c.querySelector('section[aria-labelledby="reviewers-title"]');
    expect(region?.querySelector('h3')?.textContent).toBe('Reviewers');
  });
});
