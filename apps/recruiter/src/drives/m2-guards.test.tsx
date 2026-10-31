// @vitest-environment happy-dom
// AT-M2-22 and R5-59 (rules 1, 2, 4, 6, 7; specs/m2-scheduling-invites.md §12): the D1 and M1 word lists apply,
// unchanged, to every M2 drive screen. No control or label for reject, decline, shortlist, decision, confirm, overturn,
// notice or appeal (the held-row action is "Mark as different people"), none of those words anywhere, no combined
// number ("rows in file", never "total"), no band, no row selection or bulk revoke (a cancelled drive has the one
// drive-level action), no export (the template is text, not a download), no gaze, emotion, face-match, IP, ASN or
// device text, no AI-likeness, no inline style. Every screen is rendered with synthetic data in each state it has.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROW_REFUSAL_REASONS } from '@trace/shared/contracts/m2';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { failure, fakeApi, info } from '../bank/testing/api.test-helpers';
import { mountScreen } from '../bank/testing/dom.test-helpers';
import { ApiContext, OrgInfoContext } from '../api/runtime';
import { BAND_LABEL } from '../reports/labels';
import { buildRoutes } from '../routes';
import { DriveRoute, DriveUploadRoute, DrivesRoute, NewDriveRoute } from './DriveRoutes';
import { cursorFor, drive, invitation, slot, summary, uid } from './testing/fixtures.test-helpers';
import type { RunState } from './upload/run';
import { FILE_REFUSALS, LOCAL_ROW_REASONS } from './upload/types';
import { UploadView, type Screen, type UploadHandlers } from './upload/UploadView';

// D1's lists, as tests/m1-guards.test.tsx copies them (parity is checked against that file and d1-guards below).
const CONTROL_WORDS =
  /\b(?:reject\w*|decline\w*|shortlist\w*|decision\w*|confirm\w*|overturn\w*|notice\w*|appeal\w*)\b/i;
const ANYWHERE_WORDS =
  /\b(?:reject\w*|decline\w*|shortlist\w*|overturn\w*|appeal\w*|confirm\w*)\b/i;
const COMBINED = /\b(?:overall|combined|total|trust|honesty|composite)\b/i;
const GAZE_ASN_IP =
  /\b(?:gaze|ASN|IPv?[46]?)\b|\bIP[\s _-]*address(?:es)?\b|\b(?:\d{1,3}\.){3}\d{1,3}\b/i;
const NEVER_BUILD_TAIL =
  '|\\bemotion|face.?match|\\bdevice\\b|\\bpersonality\\b|voiceprint|biometric|likeness';
const NEVER_BUILD = new RegExp(`${GAZE_ASN_IP.source}${NEVER_BUILD_TAIL}`, 'i');
const SELECTION = /type="checkbox"|role="checkbox"|aria-selected|role="option"|select all/i;
const EXPORT = /\bexport\w*|\bdownload\w*|\.csv\b|\.pdf\b/i;
const BAND_WORDS = new RegExp(`\\b(?:${Object.values(BAND_LABEL).join('|')})\\b|\\bband\\b`, 'i');
const M1_NEVER_BUILD =
  /solvab\w*|\bai[\s_-]*(?:likeness|detect\w*|score)\b|\bchatgpt[\s_-]*score\b/i;

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;|&#x27;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
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

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const orgInfo = {
  orgId: ORG_ID,
  orgName: 'Synthetic Staffing',
  userId: uid(7),
  roles: ['recruiter'],
};

const gateChildren = (table: ReturnType<typeof buildRoutes>) => {
  const gate = table[0]?.children?.find((child) => child.path === undefined && !child.index);
  return gate?.children ?? [];
};
const routeElement = (routePath: string): ReactNode => {
  const route = gateChildren(buildRoutes(null)).find((child) => child.path === routePath);
  if (route === undefined) throw new Error(`no route ${routePath}`);
  return route.element;
};

// ---- Upload screens (pure views) -----------------------------------------------------------------------------------

const noop = () => undefined;
const handlers: UploadHandlers = {
  onFile: noop,
  onStart: noop,
  onChooseAnother: noop,
  onCancel: noop,
  onRetry: noop,
  onMarkDifferent: noop,
  onFinish: noop,
};
const run = (patch: Partial<RunState>): RunState => ({
  phase: 'completed',
  uploadId: uid(600),
  rowsInFile: 40,
  rowsSent: 38,
  rowsToSend: 38,
  invited: 30,
  refused: [...ROW_REFUSAL_REASONS, ...LOCAL_ROW_REASONS].map((reason, i) => ({
    rowNo: 2 + i,
    reason,
  })),
  held: [5, 9],
  reuploadWarning: true,
  failure: null,
  upload: null,
  busy: false,
  ...patch,
});
const uploadScreens = (): Record<string, Screen> => ({
  'upload choose': { kind: 'choose', refusal: null, reading: false },
  'upload reading': { kind: 'choose', refusal: null, reading: true },
  ...Object.fromEntries(
    FILE_REFUSALS.map((refusal) => [
      `upload refused ${refusal}`,
      { kind: 'choose', refusal, reading: false } satisfies Screen,
    ]),
  ),
  'upload checked': {
    kind: 'checked',
    rowsInFile: 40,
    sendable: 37,
    issues: [
      { rowNo: 3, reason: 'bad_adult_value' },
      { rowNo: 8, reason: 'invalid_email' },
      { rowNo: 11, reason: 'bad_language' },
    ],
  },
  ...Object.fromEntries(
    (
      [
        'running',
        'ready',
        'stopped',
        'completing',
        'completed',
        'cancelling',
        'cancelled',
        'failed',
      ] as const
    ).map((phase) => [
      `upload run ${phase}`,
      {
        kind: 'run',
        run: run({
          phase,
          failure: phase === 'stopped' || phase === 'failed' ? 'unavailable' : null,
        }),
      } satisfies Screen,
    ]),
  ),
  'upload run no held': { kind: 'run', run: run({ held: [] }) },
});

// ---- Every screen, rendered ----------------------------------------------------------------------------------------

const screens: Record<string, string> = {};
/** Screen names whose page is a drive page in the given status (for the revoke-all checks). */
const drivePages: { name: string; status: string }[] = [];

beforeAll(async () => {
  // The four routes, as the route table mounts them, for a signed-in staff member with no api yet.
  for (const routePath of ['drives', 'drives/new', 'drives/:driveId', 'drives/:driveId/upload']) {
    screens[`route ${routePath}`] = renderToString(
      <MemoryRouter>
        <OrgInfoContext value={orgInfo}>
          <ApiContext value={null}>{routeElement(routePath)}</ApiContext>
        </OrgInfoContext>
      </MemoryRouter>,
    );
  }
  void [DriveRoute, DriveUploadRoute, DrivesRoute, NewDriveRoute];

  for (const [name, screen] of Object.entries(uploadScreens())) {
    screens[name] = renderToString(
      <MemoryRouter>
        <UploadView driveId={uid(101)} screen={screen} handlers={handlers} />
      </MemoryRouter>,
    );
  }

  const capture = async (
    name: string,
    node: ReactNode,
    api: ReturnType<typeof fakeApi>['api'],
    at: string,
    routePath: string,
    act?: (el: Awaited<ReturnType<typeof mountScreen>>) => Promise<void>,
  ) => {
    const el = await mountScreen(node, { api, info: info('recruiter'), at, path: routePath });
    if (act !== undefined) await act(el);
    screens[name] = el.container.innerHTML;
    el.unmount();
  };

  // The list: rows of every mode and status, a second page, nothing, and a failure.
  await capture(
    'list rows',
    <DrivesRoute />,
    fakeApi((call) =>
      call.path === '/drives'
        ? {
            body: {
              drives: [
                summary(1, { status: 'scheduled' }),
                summary(2, { mode: 'open_window' }),
                summary(3, { status: 'closed' }),
                summary(4, { status: 'cancelled' }),
              ],
              nextCursor: cursorFor(1),
            },
          }
        : undefined,
    ).api,
    '/drives',
    '/drives',
  );
  await capture(
    'list empty',
    <DrivesRoute />,
    fakeApi(() => ({ body: { drives: [], nextCursor: null } })).api,
    '/drives',
    '/drives',
  );
  await capture(
    'list failed',
    <DrivesRoute />,
    fakeApi(() => failure(500, 'x')).api,
    '/drives',
    '/drives',
  );

  // The new-drive form: fresh, with every check message showing, with the version id field, and open window.
  const tests = {
    tests: [
      {
        id: uid(11),
        name: '[synthetic] Test',
        status: 'draft',
        versionNo: 2,
        invitationCount: 0,
        createdAt: '2026-11-02T04:30:00.000Z',
      },
    ],
  };
  const newApi = () =>
    fakeApi((call) => {
      if (call.path === '/tests') return { body: tests };
      if (call.path === `/tests/${uid(11)}`) {
        return {
          body: {
            test: {
              id: uid(11),
              workspaceId: uid(3),
              name: '[synthetic] Test',
              createdAt: '2026-11-02T04:30:00.000Z',
            },
            version: {
              id: uid(22),
              versionNo: 2,
              status: 'draft',
              durationMinutes: 30,
              qualityCutoff: 40,
              publishedAt: null,
              sections: [],
            },
          },
        };
      }
      return undefined;
    }).api;
  await capture('new fresh', <NewDriveRoute />, newApi(), '/drives/new', '/drives/new');
  await capture(
    'new with messages',
    <NewDriveRoute />,
    newApi(),
    '/drives/new',
    '/drives/new',
    async (el) => {
      await el.choose(el.field('Test'), uid(11));
      await el.settle();
      await el.choose(el.field('Mode'), 'open_window');
      await el.choose(el.field('Lab mode'), 'on');
      await el.click(el.button('Add reminder'));
      await el.click(el.button('Create drive'));
    },
  );

  // The drive page in each status, with slots and invitations in every state.
  const allStatuses = [
    'created',
    'sent',
    'otp_verified',
    'started',
    'submitted',
    'expired',
    'revoked',
    'blocked_age',
  ] as const;
  const deliveries = [
    'planned',
    'queued',
    'sent',
    'delivered',
    'bounced',
    'complained',
    'failed',
    'cancelled',
  ] as const;
  const invitations = allStatuses.map((status, i) =>
    invitation(i + 1, {
      status,
      delivery: {
        invite: deliveries[i] ?? null,
        reminder: deliveries[(i + 3) % deliveries.length] ?? null,
        reschedule: i % 2 === 0 ? (deliveries[(i + 5) % deliveries.length] ?? null) : null,
      },
    }),
  );
  const slots = [
    slot(1),
    slot(2, { booked: 50 }),
    slot(3, { status: 'closed' }),
    slot(4, { status: 'cancelled' }),
  ];
  const driveApiFor = (
    status: 'draft' | 'scheduled' | 'closed' | 'cancelled',
    mode: 'scheduled' | 'open_window',
    ratio: number | null,
  ) =>
    fakeApi((call) => {
      const base = `/drives/${drive(1).id}`;
      if (call.path === base)
        return {
          body: drive(1, {
            status,
            mode,
            minPoolRatio: ratio,
            expectedCandidates: 2000,
            labMode: true,
          }),
        };
      if (call.path === `${base}/slots`) return { body: { slots, nextCursor: cursorFor(1) } };
      if (call.path === `${base}/invitations`)
        return { body: { invitations, nextCursor: cursorFor(2) } };
      if (call.path.endsWith('/revoke-not-started')) return { body: { revoked: 4, skipped: 2 } };
      return undefined;
    }).api;
  const drivePage = async (
    name: string,
    status: 'draft' | 'scheduled' | 'closed' | 'cancelled',
    mode: 'scheduled' | 'open_window' = 'scheduled',
    ratio: number | null = null,
    act?: (el: Awaited<ReturnType<typeof mountScreen>>) => Promise<void>,
  ) => {
    drivePages.push({ name, status });
    await capture(
      name,
      <DriveRoute />,
      driveApiFor(status, mode, ratio),
      `/drives/${drive(1).id}`,
      '/drives/:driveId',
      act,
    );
  };
  await drivePage('drive draft', 'draft');
  await drivePage('drive scheduled', 'scheduled');
  await drivePage('drive closed', 'closed');
  await drivePage('drive cancelled', 'cancelled');
  await drivePage('drive open window pool warning', 'scheduled', 'open_window', 6.5);
  await drivePage('drive cancel panel', 'scheduled', 'scheduled', null, async (el) => {
    await el.click(el.button('Cancel drive'));
  });
  await drivePage('drive revoke panel', 'scheduled', 'scheduled', null, async (el) => {
    const row = [...el.container.querySelectorAll('tr')].find(
      (tr) => tr.querySelector('th')?.textContent.trim() === 'Candidate 1',
    );
    const revoke = [...(row?.querySelectorAll('button') ?? [])].find((b) =>
      (b.getAttribute('aria-label') ?? b.textContent).startsWith('Revoke'),
    );
    if (revoke !== undefined) await el.click(revoke);
  });
  await drivePage('drive move picker', 'scheduled', 'scheduled', null, async (el) => {
    const row = [...el.container.querySelectorAll('tr')].find(
      (tr) => tr.querySelector('th')?.textContent.trim() === 'Candidate 1',
    );
    const move = [...(row?.querySelectorAll('button') ?? [])].find((b) =>
      (b.getAttribute('aria-label') ?? b.textContent).startsWith('Move to slot'),
    );
    if (move !== undefined) await el.click(move);
  });
  await drivePage('drive slot generator', 'draft', 'scheduled', null, async (el) => {
    await el.choose(el.field('Add slots by'), 'generator');
    await el.click(el.button('Create slots'));
  });
  await drivePage('drive slot list', 'draft', 'scheduled', null, async (el) => {
    await el.choose(el.field('Add slots by'), 'list');
    await el.type(el.field('Slot times (one per line, IST)'), 'nonsense');
    await el.click(el.button('Create slots'));
  });
  await drivePage('drive revoke-all result', 'cancelled', 'scheduled', null, async (el) => {
    await el.click(el.button('Revoke all invitations not yet started'));
    await el.click(el.button('Yes, revoke them'));
  });
}, 60_000);

const entries = () => Object.entries(screens);

describe('M2 drive screens never show what the product never builds (AT-M2-22, R5-59)', () => {
  it('renders the whole screen set (the checks below are not vacuous)', () => {
    expect(entries().length).toBeGreaterThanOrEqual(40);
    for (const [name, html] of entries()) expect(html.length, name).toBeGreaterThan(20);
    for (const name of [
      'route drives',
      'route drives/new',
      'route drives/:driveId',
      'route drives/:driveId/upload',
    ]) {
      expect(Object.keys(screens)).toContain(name);
    }
    expect(text(screens['drive cancelled'] ?? '')).toContain(
      'Revoke all invitations not yet started',
    );
    expect(text(screens['drive revoke-all result'] ?? '')).toContain(
      '4 revoked, 2 skipped (a test may still start)',
    );
    expect(text(screens['list rows'] ?? '')).toContain('[synthetic] Drive 1');
    expect(text(screens['upload run completed'] ?? '')).toContain('Mark as different people');
  });

  it('has no control or label for reject, decline, shortlist, decision, confirm, overturn, notice, appeal', () => {
    for (const [name, html] of entries()) {
      for (const label of controlsAndLabels(html)) {
        expect(label, `${name}: "${label}"`).not.toMatch(CONTROL_WORDS);
      }
    }
  });

  it('has none of reject, decline, shortlist, overturn, appeal, confirm anywhere in the text', () => {
    for (const [name, html] of entries()) expect(text(html), name).not.toMatch(ANYWHERE_WORDS);
  });

  it('shows no overall, combined, total, trust, honesty or composite number (the upload says "rows in file")', () => {
    for (const [name, html] of entries()) expect(text(html), name).not.toMatch(COMBINED);
    expect(text(screens['upload checked'] ?? '')).toMatch(/rows in file/i);
  });

  it('shows no integrity band, and no word of one', () => {
    for (const [name, html] of entries()) expect(text(html), name).not.toMatch(BAND_WORDS);
  });

  it('has no row selection, no select-all, no bulk word and no export', () => {
    for (const [name, html] of entries()) {
      expect(html, name).not.toMatch(SELECTION);
      expect(text(html), name).not.toMatch(/\bbulk\b/i);
      expect(text(html), name).not.toMatch(EXPORT);
    }
  });

  it('offers the one drive-level revoke on a cancelled drive only, and no other "revoke all"', () => {
    for (const { name, status } of drivePages) {
      const buttons = [
        ...(screens[name] ?? '').matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g),
      ].map((m) => text(m[1] ?? '').trim());
      const all = buttons.filter((b) => /revoke all/i.test(b));
      const expected = status === 'cancelled' ? 1 : 0;
      expect(all, name).toHaveLength(expected);
      expect(
        buttons.filter((b) => /revoke all invitations not yet started/i.test(b)).length,
        name,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('has no gaze, emotion, face-match, IP, ASN or device text, no AI-likeness and no solvability', () => {
    for (const [name, html] of entries()) {
      expect(text(html), name).not.toMatch(NEVER_BUILD);
      expect(text(html), name).not.toMatch(M1_NEVER_BUILD);
    }
  });

  it('has no score, result or outcome wording (Answer Quality and integrity are not on these screens)', () => {
    for (const [name, html] of entries()) {
      expect(text(html), name).not.toMatch(
        /\b(?:score|integrity|answer quality|outcome|pass|fail)\b/i,
      );
    }
  });

  it('draws no inline style (the CSP forbids style attributes) and no raw link to a file', () => {
    for (const [name, html] of entries()) {
      expect(html, name).not.toMatch(/\sstyle=/);
      expect(html, name).not.toMatch(/\bdownload=|href="(?:blob|data):/i);
    }
  });

  it('the file picker is the only file control, and it takes CSV only', () => {
    for (const [name, html] of entries()) {
      const inputs = [...html.matchAll(/<input\b[^>]*type="file"[^>]*>/g)].map((m) => m[0]);
      for (const input of inputs) expect(input, name).toContain('accept="text/csv"');
    }
    expect(screens['upload choose']).toContain('type="file"');
  });
});

describe('the M2 guard patterns (negative controls)', () => {
  it('catch what they should', () => {
    for (const bad of ['Reject', 'Send notice', 'Record decision', 'Confirm', 'Appeal'])
      expect(bad).toMatch(CONTROL_WORDS);
    expect('Total rows').toMatch(COMBINED);
    expect('<input type="checkbox">').toMatch(SELECTION);
    expect('Select all rows').toMatch(SELECTION);
    expect('Download the template').toMatch(EXPORT);
    expect('invites.csv').toMatch(EXPORT);
    expect('Clear').toMatch(BAND_WORDS);
    expect('Gaze direction').toMatch(NEVER_BUILD);
    expect('This device').toMatch(NEVER_BUILD);
    expect('AI score').toMatch(M1_NEVER_BUILD);
  });
  it('let the M2 wording through', () => {
    for (const ok of [
      'Mark as different people',
      'Revoke all invitations not yet started',
      'Rows in file',
      'Save the sheet as CSV and upload that',
      'Use the 18-or-older column',
      'Lab mode',
      'Move to slot',
      'Resend invite',
    ]) {
      expect(ok).not.toMatch(CONTROL_WORDS);
      expect(ok).not.toMatch(ANYWHERE_WORDS);
      expect(ok).not.toMatch(COMBINED);
      expect(ok).not.toMatch(EXPORT);
      expect(ok).not.toMatch(NEVER_BUILD);
      expect(ok).not.toMatch(BAND_WORDS);
    }
  });
});

describe('parity with M1 and D1 (R5-59: the word lists are theirs, unchanged)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const m1 = readFileSync(path.join(here, '..', 'tests', 'm1-guards.test.tsx'), 'utf8');
  const d1 = readFileSync(path.join(here, '..', 'd1-guards.test.tsx'), 'utf8');

  it('tests/m1-guards.test.tsx holds the same patterns', () => {
    expect(m1).toContain(CONTROL_WORDS.source);
    expect(m1).toContain(ANYWHERE_WORDS.source);
    expect(m1).toContain(COMBINED.source);
    expect(m1).toContain(GAZE_ASN_IP.source);
    // m1 writes the tail as a quoted string, so each backslash is doubled in its source text.
    expect(m1).toContain(NEVER_BUILD_TAIL.replaceAll('\\', '\\\\'));
    expect(m1).toContain(SELECTION.source);
    expect(m1).toContain(EXPORT.source);
    expect(m1).toContain(M1_NEVER_BUILD.source);
    expect(m1).toContain('Object.values(BAND_LABEL).join');
  });

  it('d1-guards.test.tsx holds the same patterns', () => {
    expect(d1).toContain(CONTROL_WORDS.source);
    expect(d1).toContain(ANYWHERE_WORDS.source);
    expect(d1).toContain(COMBINED.source);
    expect(d1).toContain(GAZE_ASN_IP.source);
    // d1 writes the tail inside a template literal, so each backslash is doubled in its source text.
    expect(d1).toContain(NEVER_BUILD_TAIL.replaceAll('\\', '\\\\'));
    expect(d1).toContain(SELECTION.source);
    expect(d1).toContain(EXPORT.source);
  });

  it('applies the lists in the same places the M1 file does', () => {
    // The control-word list on controls and labels, the anywhere list on the text, and so on.
    expect(m1).toMatch(/not\.toMatch\(CONTROL_WORDS\)/);
    expect(m1).toMatch(/not\.toMatch\(ANYWHERE_WORDS\)/);
    expect(m1).toMatch(/not\.toMatch\(COMBINED\)/);
    expect(m1).toMatch(/not\.toMatch\(BAND_WORDS\)/);
    expect(m1).toMatch(/not\.toMatch\(SELECTION\)/);
    expect(m1).toMatch(/not\.toMatch\(NEVER_BUILD\)/);
  });
});
