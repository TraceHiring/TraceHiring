// AT-D13 (rules 1, 2, 4, 6, 7; specs/d1-demo-slice.md §6.1 "Never appears"): every D1 screen's rendered DOM has no
// control or label for reject, decline, shortlist, decision, confirm, overturn, notice or appeal; no combined,
// overall, total, trust, honesty or composite number; no band outside the integrity card; no row selection, bulk
// action or export; no gaze, emotion, face-match, IP, ASN or device text. The route table is pinned too, so a new
// route cannot appear without this file being updated.
import type { ResultsListResponse, TestDetailResponse } from '@trace/shared/contracts/d1';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from './api/client';
import { errorText } from './common/messages';
import type { PollSnapshot } from './common/poller';
import type { OrgInfo } from './api/runtime';
import { DraftFormView } from './authoring/DraftFormView';
import { addMcqItem, addWrittenItem, emptyDraft } from './authoring/editor-model';
import { InvitationsView, InviteFormView, InviteResultView } from './authoring/InvitePage';
import { ReviewersPanelView } from './authoring/ReviewersPanel';
import { EditorBody, NewTestRoute, PublishDialog } from './authoring/TestEditorPage';
import { TestsView } from './authoring/TestsListPage';
import { demoOutboxExtras } from './outbox/demo-extras';
import { OutboxView } from './outbox/OutboxPage';
import { IntegrityCardView, QualityCardView } from './reports/Cards';
import { BAND_LABEL } from './reports/labels';
import { ReportPage } from './reports/ReportPage';
import { ReportController } from './reports/report-controller';
import { StartPhotoView } from './reports/StartPhotoPanel';
import {
  API_ORIGIN,
  INTEGRITY_READY,
  META,
  ORG_ID,
  QUALITY_READY,
  REPORT_ID,
  fakeApiFetch,
  json,
  type RouteTable,
} from './reports/report.test-helpers';
import { ResultsView } from './review/ResultsPage';
import { ReviewQueueView } from './review/ReviewQueuePage';
import { buildRoutes, routes } from './routes';
import { SignedInView } from './shell/SignedIn';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const noop = () => undefined;
const wrap = (node: React.ReactNode) => renderToString(<MemoryRouter>{node}</MemoryRouter>);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;|&#x27;/g, '"')
    .replace(/\s+/g, ' ');

const CONTROL_WORDS =
  /\b(?:reject\w*|decline\w*|shortlist\w*|decision\w*|confirm\w*|overturn\w*|notice\w*|appeal\w*)\b/i;
const ANYWHERE_WORDS =
  /\b(?:reject\w*|decline\w*|shortlist\w*|overturn\w*|appeal\w*|confirm\w*)\b/i;
const COMBINED = /\b(?:overall|combined|total|trust|honesty|composite)\b/i;
/** Gaze, ASN and IP wording or an IPv4 literal (D1-SEC-1); the same source as e2e/support/report.ts NEVER_BUILD_TEXT. */
const GAZE_ASN_IP =
  /\b(?:gaze|ASN|IPv?[46]?)\b|\bIP[\s _-]*address(?:es)?\b|\b(?:\d{1,3}\.){3}\d{1,3}\b/i;
const NEVER_BUILD = new RegExp(
  `${GAZE_ASN_IP.source}|\\bemotion|face.?match|\\bdevice\\b|\\bpersonality\\b|voiceprint|biometric|likeness`,
  'i',
);
const SELECTION = /type="checkbox"|role="checkbox"|aria-selected|role="option"|select all/i;
const EXPORT = /\bexport\w*|\bdownload\w*|\.csv\b|\.pdf\b/i;
/** Every band label (Clear, Review suggested, Strong concern, Insufficient evidence) and the word "band". */
const BAND_WORDS = new RegExp(`\\b(?:${Object.values(BAND_LABEL).join('|')})\\b|\\bband\\b`, 'i');

/** The text of every control and label: buttons, links, form labels, headings, table heads, summaries. */
function controlsAndLabels(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(
    /<(button|a|label|legend|summary|option|th|h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/g,
  )) {
    out.push(text(m[2] ?? ''));
  }
  for (const m of html.matchAll(/aria-label="([^"]*)"|placeholder="([^"]*)"|title="([^"]*)"/g)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  return out;
}

/** The page without the integrity card (the only place a band may appear). */
const withoutIntegrityCard = (html: string): string =>
  html.replace(/<section[^>]*data-region="integrity-card"[\s\S]*?<\/section>/, '');

function reportApi(table: RouteTable): ReportController {
  const { fetch: fetchImpl } = fakeApiFetch(table);
  const api = new ApiClient({
    origin: API_ORIGIN,
    orgId: ORG_ID,
    getAccessToken: () => Promise.resolve('tok'),
    fetch: fetchImpl,
  });
  return new ReportController(api, REPORT_ID);
}

async function reportHtml(table: RouteTable): Promise<string> {
  vi.useFakeTimers();
  try {
    const controller = reportApi(table);
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const html = wrap(<ReportPage controller={controller} />);
    controller.stop();
    return html;
  } finally {
    vi.useRealTimers();
  }
}

const RESULTS: ResultsListResponse = {
  cutoff: 40,
  rows: [
    {
      reportId: ID(1),
      label: 'Candidate 1',
      submittedAt: '2026-10-19T10:00:00.000Z',
      quality: { state: 'ready', score: 35, belowCutoff: true },
    },
    {
      reportId: ID(2),
      label: 'Candidate 2',
      submittedAt: '2026-10-19T10:05:00.000Z',
      quality: { state: 'pending' },
    },
  ],
};
const ORG_INFO = (roles: string[]): OrgInfo => ({
  orgId: ORG_ID,
  orgName: 'Synthetic Staffing',
  userId: ID(7),
  roles,
});
let full = emptyDraft('Synthetic test');
full = addWrittenItem(addMcqItem(full));

const DETAIL = (status: 'draft' | 'published'): TestDetailResponse => ({
  test: { id: ID(50), name: 'Synthetic test', createdAt: '2026-10-19T10:00:00.000Z' },
  version: {
    id: ID(51),
    versionNo: 1,
    status,
    durationMinutes: 30,
    qualityCutoff: 55,
    publishedAt: status === 'draft' ? null : '2026-10-19T11:00:00.000Z',
    sections: [
      {
        id: ID(52),
        position: 1,
        name: 'Multiple choice',
        format: 'mcq',
        weight: 40,
        items: [
          {
            id: ID(53),
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
      },
      {
        id: ID(54),
        position: 2,
        name: 'Written answer',
        format: 'written',
        weight: 60,
        items: [
          {
            id: ID(55),
            position: 1,
            format: 'written',
            prompt: 'Describe a synthetic situation.',
            rubric: {
              criteria: [
                { id: 'c1', label: 'Clarity', maxPoints: 10, anchors: ['clear steps'], minHits: 1 },
              ],
            },
          },
        ],
      },
    ],
  },
});
const editorApi = (): ApiClient =>
  new ApiClient({
    origin: API_ORIGIN,
    orgId: ORG_ID,
    getAccessToken: () => Promise.resolve('tok'),
    fetch: fakeApiFetch({}).fetch,
  });

const snap = <T,>(state: PollSnapshot<T>['state'], slow = false): PollSnapshot<T> => ({
  state,
  slow,
});
const PIXEL = 'data:image/jpeg;base64,AAAA';
/** Every fixed failure text the app can show for an api code. */
const ERROR_CODES = [
  'aal2_required',
  'not_found',
  'unauthorized',
  'conflict',
  'cutoff_required',
  'draft_incomplete',
  'bad_request',
  'rate_limited',
  'something_unlisted',
];

/** Every D1 screen, rendered from synthetic data, by name. */
async function screens(): Promise<Record<string, string>> {
  const allReady: RouteTable = {
    meta: () => json(META),
    quality: () => json(QUALITY_READY),
    integrity: () => json(INTEGRITY_READY),
  };
  return {
    tests: wrap(
      <TestsView
        canCreate
        data={{
          tests: [
            {
              id: ID(3),
              name: 'Synthetic test',
              status: 'published',
              versionNo: 1,
              invitationCount: 2,
              createdAt: '2026-10-19T10:00:00.000Z',
            },
            {
              id: ID(4),
              name: 'Draft test',
              status: 'draft',
              versionNo: 1,
              invitationCount: 0,
              createdAt: '2026-10-19T10:00:00.000Z',
            },
          ],
        }}
      />,
    ),
    'editor-body-draft': wrap(
      <EditorBody api={editorApi()} detail={DETAIL('draft')} onPublished={noop} />,
    ),
    'editor-body-published': wrap(
      <EditorBody api={editorApi()} detail={DETAIL('published')} onPublished={noop} />,
    ),
    'new-test': wrap(<NewTestRoute />),
    invitations: wrap(
      <InvitationsView
        data={{
          invitations: [
            {
              id: ID(60),
              label: 'Candidate 1',
              status: 'sent',
              createdAt: '2026-10-19T10:00:00.000Z',
              expiresAt: '2026-10-26T10:00:00.000Z',
            },
            {
              id: ID(61),
              label: 'Candidate 2',
              status: 'blocked_age',
              createdAt: '2026-10-19T10:05:00.000Z',
              expiresAt: '2026-10-26T10:05:00.000Z',
            },
          ],
        }}
      />,
    ),
    'invitations-empty': wrap(<InvitationsView data={{ invitations: [] }} />),
    'invite-error': wrap(<InviteFormView busy={false} error="invalid_email" onSubmit={noop} />),
    'error-texts': wrap(
      <ul>
        {ERROR_CODES.map((code) => (
          <li key={code}>{errorText(code)}</li>
        ))}
      </ul>,
    ),
    'quality-loading': wrap(<QualityCardView snapshot={snap({ kind: 'loading' })} />),
    'quality-unavailable': wrap(<QualityCardView snapshot={snap({ kind: 'unavailable' })} />),
    'quality-slow': wrap(
      <QualityCardView snapshot={snap({ kind: 'value', value: { state: 'pending' } }, true)} />,
    ),
    'integrity-loading': wrap(<IntegrityCardView snapshot={snap({ kind: 'loading' })} />),
    'integrity-unavailable': wrap(<IntegrityCardView snapshot={snap({ kind: 'unavailable' })} />),
    'integrity-slow': wrap(
      <IntegrityCardView snapshot={snap({ kind: 'value', value: { state: 'pending' } }, true)} />,
    ),
    'photo-idle': wrap(
      <StartPhotoView photoMissing={false} state={{ kind: 'idle' }} onView={noop} />,
    ),
    'photo-working': wrap(
      <StartPhotoView photoMissing={false} state={{ kind: 'working' }} onView={noop} />,
    ),
    'photo-shown': wrap(
      <StartPhotoView
        photoMissing={false}
        state={{ kind: 'shown', dataUrl: PIXEL }}
        onView={noop}
      />,
    ),
    'photo-error-aal2': wrap(
      <StartPhotoView
        photoMissing={false}
        state={{ kind: 'error', reason: 'aal2' }}
        onView={noop}
      />,
    ),
    'photo-error-generic': wrap(
      <StartPhotoView
        photoMissing={false}
        state={{ kind: 'error', reason: 'generic' }}
        onView={noop}
      />,
    ),
    'photo-missing': wrap(<StartPhotoView photoMissing state={{ kind: 'idle' }} onView={noop} />),
    editor: wrap(<DraftFormView form={full} readOnly={false} onChange={noop} />),
    'editor-read-only': wrap(<DraftFormView form={full} readOnly onChange={noop} />),
    'publish-dialog': wrap(<PublishDialog busy={false} onPublish={noop} onCancel={noop} />),
    reviewers: wrap(
      <ReviewersPanelView
        assignments={{
          assignments: [
            {
              id: ID(20),
              membershipId: ID(21),
              asRole: 'reviewer',
              displayName: 'Synthetic Reviewer',
              createdAt: '2026-10-19T10:00:00.000Z',
            },
          ],
        }}
        members={[{ id: ID(22), displayName: 'Synthetic Member', roles: ['recruiter'] }]}
        roles={['admin']}
        busy={false}
        error={null}
        onAssign={noop}
        onUnassign={noop}
      />,
    ),
    invite: wrap(<InviteFormView busy={false} error={null} onSubmit={noop} />),
    'invite-created': wrap(
      <InviteResultView
        result={{
          invitationId: ID(30),
          label: 'Candidate 5',
          status: 'sent',
          inviteUrl: 'https://candidate.example.test/i#abc',
        }}
        onCopy={noop}
        onAnother={noop}
      />,
    ),
    'invite-blocked': wrap(
      <InviteResultView
        result={{
          invitationId: ID(31),
          label: 'Candidate 6',
          status: 'blocked_age',
          inviteUrl: null,
        }}
        onCopy={noop}
        onAnother={noop}
      />,
    ),
    results: wrap(<ResultsView data={RESULTS} />),
    'review-queue': wrap(
      <ReviewQueueView
        data={{
          reports: RESULTS.rows.map((row) => ({
            ...row,
            testId: ID(3),
            testName: 'Synthetic test',
          })),
        }}
      />,
    ),
    outbox: wrap(
      <OutboxView
        data={{
          entries: [
            {
              id: ID(40),
              createdAt: '2026-10-19T10:00:00.000Z',
              kind: 'invite',
              candidateLabel: 'Candidate 1',
              bodyText: 'Synthetic invitation text',
            },
          ],
        }}
      />,
    ),
    'shell-recruiter': wrap(
      <SignedInView info={ORG_INFO(['recruiter'])} extraNav={demoOutboxExtras.nav}>
        <p>screen</p>
      </SignedInView>,
    ),
    'shell-reviewer': wrap(
      <SignedInView info={ORG_INFO(['reviewer'])} extraNav={null}>
        <p>screen</p>
      </SignedInView>,
    ),
    'shell-hiring-manager': wrap(
      <SignedInView info={ORG_INFO(['hiring_manager'])} extraNav={null}>
        <p>screen</p>
      </SignedInView>,
    ),
    'report-ready': await reportHtml(allReady),
    'report-pending': await reportHtml({
      ...allReady,
      quality: () => json({ state: 'pending' }),
      integrity: () => json({ state: 'pending' }),
    }),
    'report-below-cutoff': await reportHtml({
      ...allReady,
      integrity: () => json({ state: 'not_used_below_cutoff' }),
    }),
    'report-clear': await reportHtml({
      ...allReady,
      integrity: () =>
        json({ ...INTEGRITY_READY, band: 'clear', reasons: [], flags: [], timeline: [] }),
    }),
    'report-not-found': await reportHtml({
      ...allReady,
      meta: () => json({ error: { code: 'not_found' } }, 404),
    }),
    'report-no-photo': await reportHtml({
      ...allReady,
      integrity: () => json({ ...INTEGRITY_READY, photoMissing: true }),
    }),
  };
}

describe('D1 route table (AT-D13)', () => {
  const paths = (table: ReturnType<typeof buildRoutes>): string[] => {
    const root = table[0];
    const gate = root?.children?.find((child) => child.path === undefined && !child.index);
    return (gate?.children ?? []).map((child) => child.path ?? '').sort();
  };

  it('has exactly the D1 screens and the M1 screens (m1-guards.test.tsx) behind the signed-in gate', () => {
    expect(paths(buildRoutes(null))).toEqual(
      [
        'review',
        'reports/:reportId',
        'tests',
        'tests/new',
        'tests/:testId',
        'tests/:testId/invite',
        'tests/:testId/reviewers',
        'tests/:testId/results',
        // M1 (specs/m1-test-authoring.md §6.10, R5-54): the route list only; the word lists above are unchanged.
        'bank',
        'bank/ai-drafts',
        'bank/approvals',
        'bank/import',
        'bank/items/:itemId',
        'bank/items/new',
        'bank/pools',
        'library',
        'settings/integrity',
        'settings/members',
        'tests/new/template',
      ].sort(),
    );
  });

  it('no route path names a forbidden word', () => {
    for (const path of paths(buildRoutes(demoOutboxExtras))) {
      expect(path).not.toMatch(CONTROL_WORDS);
    }
  });

  it('the demo outbox route exists only when the build passes it', () => {
    expect(paths(buildRoutes(null))).not.toContain('demo-outbox');
    expect(paths(buildRoutes(demoOutboxExtras))).toContain('demo-outbox');
    // This test build sets no VITE_DEMO_OUTBOX, so the real table is the production-flavour table.
    expect(paths(routes)).not.toContain('demo-outbox');
  });
});

describe('D1 screens never show what the product never builds (AT-D13)', () => {
  it('renders the whole screen set (the checks below are not vacuous)', async () => {
    const all = await screens();
    expect(Object.keys(all).length).toBeGreaterThanOrEqual(39);
    for (const [name, html] of Object.entries(all)) expect(html.length, name).toBeGreaterThan(20);
    expect(text(all['report-ready'] ?? '')).toContain('Review suggested');
  });

  it('covers the editor body, the new test form, the invitations table, the card states and the photo', async () => {
    const all = await screens();
    for (const name of [
      'editor-body-draft',
      'editor-body-published',
      'new-test',
      'invitations',
      'quality-unavailable',
      'quality-slow',
      'integrity-unavailable',
      'integrity-slow',
      'photo-shown',
      'photo-error-aal2',
      'photo-error-generic',
      'report-clear',
      'report-not-found',
    ]) {
      expect(Object.keys(all), name).toContain(name);
    }
    const body = text(all['editor-body-draft'] ?? '');
    expect(body).toContain('Save draft');
    expect(body).toContain('Publish...');
    expect(body).toContain('Draft, version 1');
    expect(text(all['editor-body-published'] ?? '')).toContain('Settings are frozen');
    expect(text(all['new-test'] ?? '')).toContain('Create draft');
    expect(text(all.invitations ?? '')).toContain('Blocked: under 18');
    expect(text(all['quality-unavailable'] ?? '')).toContain('Not available right now');
    expect(text(all['integrity-slow'] ?? '')).toContain('Taking longer than usual');
    expect(all['photo-shown']).toContain('<img');
    expect(text(all['photo-error-aal2'] ?? '')).toContain('Two-step sign-in');
    expect(text(all['photo-error-generic'] ?? '')).toContain('could not be shown');
    expect(text(all['report-clear'] ?? '')).toContain('Clear');
    expect(text(all['report-not-found'] ?? '')).toContain(errorText('not_found'));
  });

  it('has no control or label for reject, decline, shortlist, decision, confirm, overturn, notice, appeal', async () => {
    for (const [name, html] of Object.entries(await screens())) {
      for (const label of controlsAndLabels(html)) {
        expect(label, `${name}: "${label}"`).not.toMatch(CONTROL_WORDS);
      }
    }
  });

  it('has none of reject, decline, shortlist, overturn, appeal, confirm anywhere in the text', async () => {
    for (const [name, html] of Object.entries(await screens())) {
      expect(text(html), name).not.toMatch(ANYWHERE_WORDS);
    }
  });

  it('shows no overall, combined, total, trust, honesty or composite number', async () => {
    for (const [name, html] of Object.entries(await screens())) {
      expect(text(html), name).not.toMatch(COMBINED);
    }
  });

  it('shows no band outside the integrity card', async () => {
    for (const [name, html] of Object.entries(await screens())) {
      expect(text(withoutIntegrityCard(html)), name).not.toMatch(BAND_WORDS);
    }
    // The strip is real: the ready report does show a band inside the card.
    const ready = (await screens())['report-ready'] ?? '';
    expect(text(ready)).toMatch(BAND_WORDS);
    expect(text(withoutIntegrityCard(ready))).not.toMatch(BAND_WORDS);
    // The same for a Clear band: its label is a band word, and it is in the card only.
    const clear = (await screens())['report-clear'] ?? '';
    expect(text(clear)).toMatch(/\bClear\b/);
    expect(text(withoutIntegrityCard(clear))).not.toMatch(BAND_WORDS);
  });

  it('has no row selection, bulk bar or export', async () => {
    for (const [name, html] of Object.entries(await screens())) {
      expect(html, name).not.toMatch(SELECTION);
      expect(text(html), name).not.toMatch(EXPORT);
      expect(text(html), name).not.toMatch(/\bbulk\b/i);
    }
  });

  it('has no gaze, emotion, face-match, IP, ASN or device text', async () => {
    for (const [name, html] of Object.entries(await screens())) {
      expect(text(html), name).not.toMatch(NEVER_BUILD);
    }
  });

  it('draws no inline style (the CSP forbids style attributes)', async () => {
    for (const [name, html] of Object.entries(await screens())) {
      expect(html, name).not.toMatch(/\sstyle=/);
    }
  });

  it('the guard patterns catch what they should (negative controls)', () => {
    for (const bad of [
      'Reject',
      'Decline offer',
      'Shortlist',
      'Record decision',
      'Confirm',
      'Overturn',
      'Send notice',
      'Appeal',
    ])
      expect(bad).toMatch(CONTROL_WORDS);
    for (const bad of [
      'Overall score',
      'Combined',
      'Total score',
      'Trust score',
      'Honesty',
      'Composite',
    ])
      expect(bad).toMatch(COMBINED);
    expect('<input type="checkbox">').toMatch(SELECTION);
    for (const label of Object.values(BAND_LABEL)) expect(label).toMatch(BAND_WORDS);
    expect('Clear').toMatch(BAND_WORDS);
    expect('The band is set by rules').toMatch(BAND_WORDS);
    expect('Clearing the cache').not.toMatch(BAND_WORDS);
    expect('Gaze direction').toMatch(NEVER_BUILD);
  });
});

describe('the rule 7 text pattern (D1-SEC-1)', () => {
  it.each([
    'IP: 203.0.113.7',
    'IP-address',
    'IP address',
    'IP addresses',
    'ip_address',
    'Client IPv4',
    'Client IPv6',
    'Gaze direction',
    'ASN 64500',
    'seen from 203.0.113.7 today',
  ])('matches %j', (sample) => {
    expect(sample).toMatch(NEVER_BUILD);
  });

  it.each([
    'The leadership addressed the outage',
    'The gazette was printed',
    'zip address',
    'Skip the tip',
    'Version 1.2 of 3 items',
  ])('does not match %j', (sample) => {
    expect(sample).not.toMatch(NEVER_BUILD);
  });
});
