// Registers the A5c authoring screens for tests/m1-guards.test.tsx (AT-M1-24): synthetic-data renders of the views
// built here, so D1's word lists, the no-checkbox rule and the R5-6 wording apply to them. A name ending in
// `integrity-step` is also checked for the plan's "Data and review" wording.
import {
  CreateTestFromTemplateResponse,
  IntegritySettingsView,
  INTEGRITY_CATALOG_VERSION,
  TestDraftView,
  type PoolDetail,
} from '@trace/shared/contracts/m1';
import { renderCandidateSummary } from '@trace/shared';
import type { ReactNode } from 'react';
import { ApiClient } from '../api/client';
import { OrgInfoContext } from '../api/runtime';
import { INTEGRITY_PRESETS, fromIntegrityView } from '../settings/integrity-model';
import { fromDraftView } from './editor-v2-model';
import { FromTemplateView } from './FromTemplateRoute';
import { IntegrityStepView } from './IntegrityStep';
import { SectionsEditorView } from './SectionsEditor';
import { EditorBody, NewTestRoute } from './TestEditorPage';
import { EditAsNewVersionView } from './WizardEditor';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AT = '2026-10-23T10:00:00.000Z';
const noop = () => undefined;

const draft = TestDraftView.parse({
  test: { id: ID(1), workspaceId: ID(2), name: 'Synthetic support test', createdAt: AT },
  version: {
    id: ID(3),
    versionNo: 1,
    status: 'draft',
    durationMinutes: 40,
    qualityCutoff: 40,
    publishedAt: null,
    sections: [
      {
        id: ID(10),
        position: 1,
        mode: 'inline',
        format: 'mcq',
        name: 'Multiple choice',
        weight: 40,
        items: [
          {
            id: ID(11),
            position: 1,
            format: 'mcq',
            prompt: 'Synthetic question?',
            options: [
              { id: 'a', text: 'First' },
              { id: 'b', text: 'Second' },
            ],
            correctOptionId: 'a',
          },
        ],
        shuffleItems: false,
        shuffleOptions: false,
        navigation: null,
      },
      {
        id: ID(12),
        position: 2,
        mode: 'pool',
        format: 'mcq',
        name: 'Verbal',
        weight: 30,
        items: [],
        poolId: ID(50),
        drawCount: 10,
        shuffleItems: true,
        shuffleOptions: true,
        navigation: 'free',
        timeLimitSeconds: 600,
        blueprint: {
          strata: [
            { skillKey: 'verbal', difficultyBand: 1, count: 4 },
            { skillKey: 'verbal', difficultyBand: 3, count: 6 },
          ],
        },
      },
      {
        id: ID(13),
        position: 3,
        mode: 'pool',
        format: 'written',
        name: 'Written answer',
        weight: 30,
        items: [],
        poolId: ID(51),
        drawCount: 1,
        shuffleItems: false,
        shuffleOptions: false,
        navigation: 'forward_only',
        pasteRule: 'blocked',
        timeLimitSeconds: 900,
      },
    ],
  },
});

/** The same draft, published (the read-only view with "Edit as new version"). */
const published = TestDraftView.parse({
  ...draft,
  version: { ...draft.version, status: 'published', publishedAt: AT },
});
/** A D1-shaped draft: one inline section, navigation null. */
const d1Draft = TestDraftView.parse({
  ...draft,
  version: { ...draft.version, sections: draft.version.sections.slice(0, 1) },
});
/** An api client whose calls never answer: the registry renders on the server, where no effect runs anyway. */
const idleApi = new ApiClient({
  origin: 'https://trace-api-staging.example-sub.workers.dev',
  orgId: ID(90),
  getAccessToken: () => Promise.resolve(null),
  fetch: () => new Promise<Response>(() => undefined),
});

const pools: PoolDetail[] = [
  {
    id: ID(50),
    name: 'Verbal pool',
    format: 'mcq',
    skillKey: 'verbal',
    status: 'active',
    itemCount: 40,
    approvedCount: 30,
    usedByDraws: [],
    usedByDrawsTotal: 0,
  },
  {
    id: ID(51),
    name: 'Prompts pool',
    format: 'written',
    skillKey: null,
    status: 'active',
    itemCount: 12,
    approvedCount: 12,
    usedByDraws: [],
    usedByDrawsTotal: 0,
  },
];

const integrityView = (admin: 'typing_provenance' | null) =>
  IntegritySettingsView.parse({
    presetKey: 'standard',
    values: INTEGRITY_PRESETS.standard,
    locked: {
      ...(admin === null ? {} : { [admin]: 'admin' }),
      integrity_review_scope: 'always',
      accommodations: 'always',
      id_verification: 'always',
    },
    candidateSummary: renderCandidateSummary(INTEGRITY_PRESETS.standard, INTEGRITY_CATALOG_VERSION)
      .lines,
    stored: true,
  });

const templateProps = {
  status: 'ready' as const,
  templates: [
    {
      templateKey: 'customer_support',
      version: 1,
      name: 'Customer Support',
      presetKey: 'standard' as const,
    },
    { templateKey: 'bpo_voice', version: 1, name: 'BPO Voice', presetKey: 'strict' as const },
  ],
  hasMore: true,
  loadingMore: false,
  selected: 'customer_support:1',
  jobTitle: 'Support associate',
  jdText: '',
  busy: false,
  error: null,
  created: null,
  proposal: { kind: 'none' as const },
  onSelect: noop,
  onJobTitle: noop,
  onJdText: noop,
  onMore: noop,
  onPropose: noop,
  onCreate: noop,
};

export function m1Screens(): Record<string, ReactNode> {
  const stepProps = {
    readOnly: false,
    busy: false,
    message: null,
    onPreset: noop,
    onSet: noop,
    onSave: noop,
  };
  return {
    'editor-sections': (
      <SectionsEditorView
        form={fromDraftView(draft)}
        pools={pools}
        readOnly={false}
        onChange={noop}
      />
    ),
    'editor-sections-read-only': (
      <SectionsEditorView form={fromDraftView(draft)} pools={pools} readOnly onChange={noop} />
    ),
    'editor-sections-paste-allowed': (
      <SectionsEditorView
        form={fromDraftView(draft, { paste_written: 'allowed_logged' })}
        pools={pools}
        readOnly={false}
        onChange={noop}
      />
    ),
    'new-test-step-1': (
      <OrgInfoContext
        value={{
          orgId: ID(90),
          orgName: 'Synthetic Staffing',
          userId: ID(91),
          roles: ['recruiter'],
        }}
      >
        <NewTestRoute />
      </OrgInfoContext>
    ),
    'from-template-embedded': <FromTemplateView {...templateProps} embedded />,
    'from-template-proposed': (
      <FromTemplateView
        {...templateProps}
        jdText="Synthetic job description."
        selected="bpo_voice:1"
        proposal={{
          kind: 'matched',
          name: 'BPO Voice',
          sections: [
            { title: 'Verbal', available: true },
            { title: 'Spoken English', available: false },
          ],
        }}
      />
    ),
    'from-template-no-match': (
      <FromTemplateView
        {...templateProps}
        jdText="Synthetic job description."
        selected={null}
        proposal={{ kind: 'no_match' }}
      />
    ),
    'integrity-step': (
      <IntegrityStepView
        state={fromIntegrityView(integrityView('typing_provenance'))}
        {...stepProps}
      />
    ),
    'integrity-step-read-only': (
      <IntegrityStepView state={fromIntegrityView(integrityView(null))} {...stepProps} readOnly />
    ),
    // R5-69: the wizard on /tests/:testId (steps 2 to 4) for a v2 draft, a D1-shaped draft and a published version.
    'wizard-v2-draft': (
      <EditorBody api={idleApi} detail={draft} integrity={integrityView(null)} onReload={noop} />
    ),
    'wizard-v2-published': (
      <EditorBody
        api={idleApi}
        detail={published}
        integrity={integrityView(null)}
        onReload={noop}
      />
    ),
    'wizard-d1-draft': (
      <EditorBody api={idleApi} detail={d1Draft} integrity={null} onReload={noop} />
    ),
    'edit-as-new-version-open': (
      <EditAsNewVersionView
        testId={ID(1)}
        busy={false}
        outcome="already_open"
        onEdit={noop}
        onOpen={noop}
      />
    ),
    'from-template': <FromTemplateView {...templateProps} />,
    'from-template-loading': <FromTemplateView {...templateProps} status="loading" />,
    'from-template-created': (
      <FromTemplateView
        {...templateProps}
        created={CreateTestFromTemplateResponse.parse({
          draft,
          skippedSections: [
            { title: 'Typing speed', format: 'typing' },
            { title: 'Spoken English', format: 'voice' },
          ],
        })}
      />
    ),
  };
}
