// AT-D13 (rules 1, 2, 4, 6, 7; specs/d1-demo-slice.md §6.1 "Never appears"): every D1 screen's rendered DOM has no
// control or label for reject, decline, shortlist, decision, confirm, overturn, notice or appeal; no combined,
// overall, total, trust, honesty or composite number; no band outside the integrity card; no row selection, bulk
// action or export; no gaze, emotion, face-match, IP, ASN or device text. The route table is pinned too, so a new
// route cannot appear without this file being updated.
import type { ResultsListResponse } from '@trace/shared/contracts/d1';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from './api/client';
import type { OrgInfo } from './api/runtime';
import { DraftFormView } from './authoring/DraftFormView';
import { addMcqItem, addWrittenItem, emptyDraft } from './authoring/editor-model';
import { InviteFormView, InviteResultView } from './authoring/InvitePage';
import { ReviewersPanelView } from './authoring/ReviewersPanel';
import { PublishDialog } from './authoring/TestEditorPage';
import { TestsView } from './authoring/TestsListPage';
import { demoOutboxExtras } from './outbox/demo-extras';
import { OutboxView } from './outbox/OutboxPage';
import { ReportPage } from './reports/ReportPage';
import { ReportController } from './reports/report-controller';
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
const NEVER_BUILD =
  /\bgaze\b|\bemotion|face.?match|\bASN\b|\bIP address\b|\bdevice\b|\bpersonality\b|voiceprint|biometric|likeness/i;
const SELECTION = /type="checkbox"|role="checkbox"|aria-selected|role="option"|select all/i;
const EXPORT = /\bexport\w*|\bdownload\w*|\.csv\b|\.pdf\b/i;
const BAND_WORDS = /strong concern|insufficient evidence|review suggested|\bband\b/i;

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

  it('has exactly the D1 screens behind the signed-in gate', () => {
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
    expect(Object.keys(all).length).toBeGreaterThanOrEqual(18);
    for (const html of Object.values(all)) expect(html.length).toBeGreaterThan(40);
    expect(text(all['report-ready'] ?? '')).toContain('Review suggested');
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
    expect('Strong concern').toMatch(BAND_WORDS);
    expect('Gaze direction').toMatch(NEVER_BUILD);
  });
});
