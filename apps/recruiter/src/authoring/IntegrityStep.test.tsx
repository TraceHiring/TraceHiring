// @vitest-environment happy-dom
// The integrity step of the test editor (specs/m1-test-authoring.md §6.6, §6.10, screen 04; R5-6): presets, one
// control per catalog setting, "Locked by admin" and always-locked settings that cannot be edited, "Takes effect when
// available" for settings that run later, the live "What candidates will see", and the plan's wording in "Data and
// review". Every control is a radio group or a select, never a checkbox. Synthetic data only.
import { INTEGRITY_CATALOG_VERSION, IntegritySettingsView } from '@trace/shared/contracts/m1';
import { renderCandidateSummary } from '@trace/shared';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { INTEGRITY_PRESETS, fromIntegrityView } from '../settings/integrity-model';
import {
  button,
  choose,
  click,
  fakeApi,
  field,
  mountScreen,
  plain,
  uuid,
  type Mounted,
} from './dom.test-helpers';
import { DataAndReviewPanel, IntegrityStep, IntegrityStepView } from './IntegrityStep';

/** The draft version the editor loaded; every settings save names it (R5-70 a, A5d re-review #2). */
const VERSION = uuid(10);

const viewOf = (
  values = INTEGRITY_PRESETS.standard,
  adminLocked: Record<string, 'admin'> = {},
  presetKey: 'strict' | 'standard' | 'open_book' | null = 'standard',
) =>
  IntegritySettingsView.parse({
    presetKey,
    values,
    locked: {
      ...adminLocked,
      integrity_review_scope: 'always',
      accommodations: 'always',
      id_verification: 'always',
    },
    candidateSummary: renderCandidateSummary(values, INTEGRITY_CATALOG_VERSION).lines,
    stored: presetKey !== null,
  });
const noop = () => undefined;

describe('DataAndReviewPanel (R5-6: the plan, never the design)', () => {
  const body = plain(renderToString(<DataAndReviewPanel />));
  it('carries the plan wording', () => {
    for (const phrase of [
      'deleted 30 days after the decision',
      '72 hours',
      '5 business days',
      'candidates above your cutoff only',
      'Integrity results are never acted on automatically',
    ]) {
      expect(body).toContain(phrase);
    }
  });
  it('never shows the design numbers 90 days or 2 business days', () => {
    expect(body).not.toMatch(/90 days|2 business days|7 days/);
  });
});

describe('IntegrityStepView', () => {
  const html = (
    state = fromIntegrityView(viewOf(INTEGRITY_PRESETS.standard, { typing_provenance: 'admin' })),
  ) =>
    renderToString(
      <IntegrityStepView
        state={state}
        readOnly={false}
        busy={false}
        message={null}
        onPreset={noop}
        onSet={noop}
        onSave={noop}
      />,
    );

  it('shows the three presets, every setting, the preview and the data panel', () => {
    const text = plain(html());
    for (const t of [
      'Strict',
      'Standard',
      'Open-book',
      'Calibration warm-up',
      'Typing provenance',
      'Fullscreen and tab focus',
      'Paste on written answers',
      'What candidates will see',
      'Data and review',
    ]) {
      expect(text, t).toContain(t);
    }
    expect(text).toContain('Integrity results are never acted on automatically');
  });

  it('marks the admin lock, the always-locked settings and settings that run later', () => {
    const text = plain(html());
    expect(text).toContain('Locked by admin');
    expect(text).toContain('Candidates above your cutoff only');
    expect(text).toContain('Takes effect when available');
    expect(text).not.toContain('shortlist_only');
  });

  it('uses no checkbox and no inline style', () => {
    expect(html()).not.toMatch(/type="checkbox"|role="checkbox"|aria-selected| style=/);
  });

  it('names Custom when the values match no preset', () => {
    const custom = fromIntegrityView(
      viewOf({ ...INTEGRITY_PRESETS.standard, single_screen: 'on' }, {}, null),
    );
    expect(plain(html(custom))).toContain('Custom settings');
  });
});

let mounted: Mounted | undefined;
afterEach(async () => {
  await mounted?.unmount();
  mounted = undefined;
});

describe('IntegrityStep (load and save)', () => {
  it('loads the settings, applies a preset except locked settings, and saves the request', async () => {
    const saved: unknown[] = [];
    const { api, calls } = fakeApi({
      [`GET /tests/${uuid(9)}/integrity`]: () => ({
        body: viewOf(INTEGRITY_PRESETS.standard, { paste_written: 'admin' }),
      }),
      [`PUT /tests/${uuid(9)}/integrity`]: (call) => {
        saved.push(call.body);
        const b = call.body as {
          presetKey: 'strict' | null;
          values: typeof INTEGRITY_PRESETS.strict;
        };
        return { body: viewOf(b.values, { paste_written: 'admin' }, b.presetKey) };
      },
    });
    mounted = await mountScreen(
      <IntegrityStep api={api} testId={uuid(9)} versionId={VERSION} />,
      api,
      ['recruiter'],
    );
    const c = mounted.container;
    expect(plain(c.innerHTML)).toContain('What candidates will see');
    // Locked: the control is disabled.
    expect(field<HTMLSelectElement>(c, 'Paste on written answers').disabled).toBe(true);
    await click(field(c, 'Strict'));
    expect(field<HTMLSelectElement>(c, 'Single screen').value).toBe('on');
    expect(field<HTMLSelectElement>(c, 'Paste on written answers').value).toBe('allowed_logged');
    expect(plain(c.innerHTML)).toContain('Custom settings');
    await click(button(c, 'Save settings'));
    expect(calls.map((x) => `${x.method} ${x.path}`)).toEqual([
      `GET /tests/${uuid(9)}/integrity`,
      `PUT /tests/${uuid(9)}/integrity`,
    ]);
    // R5-70 a: the save names the version the editor loaded; a stale tab is refused with 409.
    expect(calls.map((x) => x.query)).toEqual(['', `?version=${VERSION}`]);
    const sent = saved[0] as { presetKey: unknown; values: Record<string, string> };
    expect(sent.presetKey).toBeNull();
    expect(sent.values.single_screen).toBe('on');
    expect(sent.values.paste_written).toBe('allowed_logged');
    expect(plain(c.innerHTML)).toContain('Settings saved.');
  });

  it('hands the saved settings to the editor, so every written section follows paste_written (rule 3)', async () => {
    const savedViews: { values: { paste_written: string } }[] = [];
    const { api } = fakeApi({
      [`GET /tests/${uuid(9)}/integrity`]: () => ({ body: viewOf(INTEGRITY_PRESETS.standard) }),
      [`PUT /tests/${uuid(9)}/integrity`]: (call) => {
        const b = call.body as { values: typeof INTEGRITY_PRESETS.strict };
        return { body: viewOf(b.values, {}, null) };
      },
    });
    mounted = await mountScreen(
      <IntegrityStep
        api={api}
        testId={uuid(9)}
        versionId={VERSION}
        onSaved={(view) => {
          savedViews.push(view);
        }}
      />,
      api,
      ['recruiter'],
    );
    const c = mounted.container;
    await choose(field(c, 'Paste on written answers'), 'blocked');
    expect(savedViews).toEqual([]);
    await click(button(c, 'Save settings'));
    expect(savedViews.map((v) => v.values.paste_written)).toEqual(['blocked']);
  });

  it('a refused save hands nothing to the editor', async () => {
    const savedViews: unknown[] = [];
    const { api } = fakeApi({
      [`GET /tests/${uuid(9)}/integrity`]: () => ({ body: viewOf() }),
      [`PUT /tests/${uuid(9)}/integrity`]: () => ({
        status: 409,
        body: { error: { code: 'conflict' } },
      }),
    });
    mounted = await mountScreen(
      <IntegrityStep
        api={api}
        testId={uuid(9)}
        versionId={VERSION}
        onSaved={(v) => savedViews.push(v)}
      />,
      api,
      ['recruiter'],
    );
    await click(button(mounted.container, 'Save settings'));
    expect(savedViews).toEqual([]);
  });

  it('changing a setting updates what candidates will see at once', async () => {
    const { api } = fakeApi({
      [`GET /tests/${uuid(9)}/integrity`]: () => ({
        body: viewOf(INTEGRITY_PRESETS.strict, {}, 'strict'),
      }),
    });
    mounted = await mountScreen(
      <IntegrityStep api={api} testId={uuid(9)} versionId={VERSION} />,
      api,
      ['recruiter'],
    );
    const c = mounted.container;
    expect(plain(c.innerHTML)).toContain('blocked');
    await choose(field(c, 'Paste on written answers'), 'allowed_logged');
    expect(plain(c.innerHTML)).toContain('You may paste or drop text into written answers.');
  });

  it('shows a fixed failure text when the save is refused, never the server text', async () => {
    const { api } = fakeApi({
      [`GET /tests/${uuid(9)}/integrity`]: () => ({ body: viewOf() }),
      [`PUT /tests/${uuid(9)}/integrity`]: () => ({
        status: 409,
        body: { error: { code: 'conflict' } },
      }),
    });
    mounted = await mountScreen(
      <IntegrityStep api={api} testId={uuid(9)} versionId={VERSION} />,
      api,
      ['recruiter'],
    );
    await click(button(mounted.container, 'Save settings'));
    expect(plain(mounted.container.innerHTML)).toContain(
      'That change is no longer possible. Reload the page.',
    );
  });

  it('read-only (a published version) disables the controls and offers no save', async () => {
    const { api } = fakeApi({ [`GET /tests/${uuid(9)}/integrity`]: () => ({ body: viewOf() }) });
    mounted = await mountScreen(
      <IntegrityStep api={api} testId={uuid(9)} versionId={VERSION} readOnly />,
      api,
      ['recruiter'],
    );
    expect(field<HTMLSelectElement>(mounted.container, 'Single screen').disabled).toBe(true);
    expect(
      [...mounted.container.querySelectorAll('button')].map((b) => b.textContent),
    ).not.toContain('Save settings');
  });
});
