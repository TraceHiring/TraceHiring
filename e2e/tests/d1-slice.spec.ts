// The D1 slice end to end (specs/d1-demo-slice.md §7.2 steps 1-10, §7.3; AT-D1, D2, D3, D8, D9, D10, D11(b), D12,
// D13, D14, D15, D17). One serial spec; every step is a `test.step` with a timeout, and its name is the recording
// caption. Projects: `local` (E2E_LOCAL=1, scripts/e2e-local.mjs) and `staging` (E2E_STAGING=1). The environment
// contract is in support/slice-env.ts.
//
// The recruiter and the reviewer sign in through the app (password + TOTP) in a context with no video and no trace;
// their session is then copied into the recorded contexts. The test content and the 18+ invitations are set up
// through the api (the spec allows it; a UI invitation would put the link on screen); the default cutoff, the
// reviewer assignment, the inviter-"No" invitation, the results, the reports and the review queue are driven and
// checked in the UI. Candidates A-D run in parallel browser contexts through the candidate app; E answers "under 18".
// Every database check has a staging form: PostgREST as the signed-in recruiter (RLS applies) or the org api.
//
// Product rules on the way: rule 1 (two cards from two requests, no combined value), rule 2 (no reject-type control
// anywhere), rule 5 (receipt only; AT-D11(b) cross-session), rule 6 (below cutoff: no band, flag or timeline, not
// readable through PostgREST), rule 8 (network allow-list, one binary upload, camera after consent, single-use photo
// link), rule 9 (under-18 blocked by the inviter and by the candidate, no consent, no camera).
//
// Synthetic data only (`@example.test`, the run id in every name). No email, password, code, token, link or body is
// printed: failures carry a step, a status, a constant code or a boolean.
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
} from '@playwright/test';
import { amrOf, claimsOf } from '../support/auth.js';
import { caption, pause, RECORDING } from '../support/caption.js';
import { edgeClient, sha256Hex } from '../support/candidate.js';
import {
  CandidateUi,
  cameraRecord,
  visibleText,
  waitUntil,
  type Notice,
  type MediaRecord,
  type PhotoPut,
  type ReceiptAnswer,
  type StartAnswer,
} from '../support/candidate-ui.js';
import { readDb } from '../support/db.js';
import { expectRefusal, jsonOf, keysOf, poll } from '../support/http.js';
import { headerMarkers, isMetadataMarker } from '../support/jpeg.js';
import { newManifest, writeManifest, type Manifest } from '../support/manifest.js';
import { linkTokenIn, outboxReader, type OutboxReader } from '../support/outbox.js';
import {
  DEFAULT_CUTOFF,
  fillAndPublish,
  getTestDetail,
  inviteCandidate,
  MCQ_OPTIONS,
  WRITTEN_ANCHORS,
  type Invitation,
  type PublishedTest,
  type RecruiterCtx,
} from '../support/recruiter.js';
import {
  accessToken,
  ownMemberships,
  restClient,
  seedSession,
  signInThroughUi,
  type Rest,
  type UiSession,
} from '../support/recruiter-ui.js';
import {
  BAND_LABEL,
  BLENDED_KEY,
  BLENDED_WORD,
  keysDeep,
  orgClient,
  REJECT_WORDS,
  type IntegrityCard,
  type MediaLink,
  type OrgClient,
  type QualityCard,
  type ReportMeta,
} from '../support/report.js';
import { readSliceEnv, sliceMode, type SliceEnv } from '../support/slice-env.js';

const MODE = sliceMode();
test.skip(MODE === null, 'set E2E_LOCAL=1 (scripts/e2e-local.mjs) or E2E_STAGING=1 to run');
test.describe.configure({ mode: 'serial' });

/** Lower-case (the contact pattern is lower-case only) and unique per run. */
const RUN = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const STEP_MS = 45_000;
/** AT-D17: `time_to_ready_ms` is recorded; the run fails only above 90 s. */
const READY_LIMIT_MS = 90_000;
const VIEWPORT = { width: 1280, height: 720 };
const ITEMS = 4;
const CORRECT = [MCQ_OPTIONS[0], MCQ_OPTIONS[0], MCQ_OPTIONS[0]] as const;
const WRONG = [MCQ_OPTIONS[1], MCQ_OPTIONS[1], MCQ_OPTIONS[1]] as const;
const STRONG = `Put each job on a ${WRITTEN_ANCHORS[0]}, ${WRITTEN_ANCHORS[1]} on failure, and keep every step ${WRITTEN_ANCHORS[2]} with a stable key.`;
const WEAK = 'I would try my best and see what happens next.';
/** What B pastes from outside the test (prevented by the app; only its length is recorded). */
const PASTED = 'synthetic external text';
/** A's client clock is moved one hour ahead before its reload; the timer must not change (AT-D7). */
const CLOCK_SHIFT_MS = 3_600_000;
const CLOCK_SHIFT_SCRIPT = `(() => {
  const SHIFT = ${CLOCK_SHIFT_MS};
  const RealDate = Date;
  const realNow = RealDate.now.bind(RealDate);
  function ShiftedDate(...args) {
    if (!new.target) return new RealDate(realNow() + SHIFT).toString();
    return args.length === 0 ? new RealDate(realNow() + SHIFT) : new RealDate(...args);
  }
  ShiftedDate.prototype = RealDate.prototype;
  ShiftedDate.now = () => realNow() + SHIFT;
  ShiftedDate.parse = RealDate.parse;
  ShiftedDate.UTC = RealDate.UTC;
  globalThis.Date = ShiftedDate;
})();`;

type Key = 'A' | 'B' | 'C' | 'D' | 'E';
const ADULTS = ['A', 'B', 'C', 'D'] as const;

interface Cand {
  key: Key;
  invitation: Invitation;
  context?: BrowserContext;
  ui?: CandidateUi;
  notice?: Notice;
  photo?: PhotoPut;
  /** The lobby document's camera record, read before the mid-test reload replaces the document. */
  media?: MediaRecord;
  start?: StartAnswer;
  receipt?: ReceiptAnswer;
  submittedAt?: number;
  reportId?: string;
  score?: number;
  integrity?: IntegrityCard;
}

interface Signed {
  session: UiSession;
  context: BrowserContext;
  page: Page;
  membershipId: string;
  roles: string[];
}

/** What the serial tests hand each other (one worker, one file). */
const run: {
  env?: SliceEnv;
  manifest?: Manifest;
  outputDir: string;
  orgId: string;
  recruiter?: Signed;
  reviewer?: Signed;
  test?: PublishedTest;
  blockedByInviter?: { label: string };
  cands: Partial<Record<Key, Cand>>;
  t0: number;
} = { outputDir: '', orgId: '', cands: {}, t0: Date.now() };

const must = <T>(value: T | undefined | null, what: string): T => {
  if (value === undefined || value === null)
    throw new Error(`${what} is missing (an earlier step failed)`);
  return value;
};
const envOf = () => must(run.env, 'the environment');
const recruiterOf = () => must(run.recruiter, 'the recruiter session');
const reviewerOf = () => must(run.reviewer, 'the reviewer session');
const testOf = () => must(run.test, 'the published test');
const cand = (key: Key) => must(run.cands[key], `candidate ${key}`);
const uiOf = (key: Key) => must(cand(key).ui, `candidate ${key}'s page`);

/** A `test.step` with a timeout, a caption on `page` (record mode) and a manifest entry. */
const step = async <T>(
  page: Page | null,
  name: string,
  body: () => Promise<T>,
  timeout = STEP_MS,
): Promise<T> =>
  test.step(
    name,
    async () => {
      if (page !== null) await caption(page, name);
      const started = Date.now();
      let ok = false;
      try {
        const value = await body();
        ok = true;
        return value;
      } finally {
        run.manifest?.steps.push({ name, ms: Date.now() - started, ok });
      }
    },
    { timeout },
  );

const newContext = (
  browser: Browser,
  options: { baseURL?: string; permissions?: string[] } = {},
): Promise<BrowserContext> =>
  browser.newContext({
    ...options,
    viewport: VIEWPORT,
    recordVideo: { dir: path.join(run.outputDir, 'd1-videos'), size: VIEWPORT },
  });

const ctxOf = async (): Promise<RecruiterCtx> => ({
  api: envOf().api,
  orgId: run.orgId,
  jwt: await accessToken(recruiterOf().page),
});
const recruiterApi = (request: APIRequestContext): OrgClient =>
  orgClient(request, {
    api: envOf().api,
    orgId: run.orgId,
    jwt: () => accessToken(recruiterOf().page),
  });
const restOf = (request: APIRequestContext): Rest =>
  restClient(request, envOf().supabaseUrl, envOf().publishableKey);
const outboxOf = async (request: APIRequestContext): Promise<OutboxReader> =>
  outboxReader(request, { api: envOf().api, orgId: run.orgId, jwt: (await ctxOf()).jwt });

/** The row of a results or review table whose row header is exactly `label`. */
const rowOf = (page: Page, label: string) =>
  page.locator('tr', { has: page.getByRole('rowheader', { name: label, exact: true }) });

/** The org path of a report request (`''`, `/quality` or `/integrity`), or null. */
const reportCall = (res: Response, reportId: string): '' | '/quality' | '/integrity' | null => {
  const req = res.request();
  if (req.method() !== 'GET') return null;
  const p = new URL(res.url()).pathname;
  const base = `/v1/orgs/${run.orgId}/reports/${reportId}`;
  if (p === base) return '';
  if (p === `${base}/quality`) return '/quality';
  if (p === `${base}/integrity`) return '/integrity';
  return null;
};

/** No control on the page names a reject-type action, and nothing is selectable in bulk (rules 2 and 6). */
const expectNoRejectControl = async (page: Page) => {
  const names: string[] = [];
  for (const role of ['button', 'link', 'menuitem', 'tab', 'option'] as const) {
    for (const el of await page.getByRole(role).all()) {
      names.push(((await el.getAttribute('aria-label')) ?? (await el.innerText())).trim());
    }
  }
  expect(names.filter((n) => REJECT_WORDS.test(n))).toEqual([]);
  expect(await page.getByRole('checkbox').count()).toBe(0);
};

test.beforeAll(() => {
  run.env = readSliceEnv();
  run.outputDir = test.info().project.outputDir;
  run.manifest = newManifest(test.info().project.name, RUN, RECORDING);
  run.t0 = Date.now();
});

test.afterAll(async () => {
  const contexts = [
    run.recruiter?.context,
    run.reviewer?.context,
    ...Object.values(run.cands).map((c) => c.context),
  ];
  for (const context of contexts) await context?.close().catch(() => undefined);
  if (run.manifest !== undefined && run.outputDir !== '') {
    run.manifest.durationMs = Date.now() - run.t0;
    writeManifest(run.outputDir, run.manifest);
  }
});

test.describe('the D1 slice (spec §7.2 steps 1-10)', () => {
  test('step 1: the recruiter and the reviewer sign in with password and TOTP (aal2)', async ({
    browser,
    request,
  }) => {
    test.setTimeout(240_000);
    const env = envOf();
    const rest = restOf(request);

    const signIn = async (who: 'recruiter' | 'reviewer'): Promise<Signed> => {
      const user = who === 'recruiter' ? env.recruiter : env.reviewer;
      const session = await signInThroughUi(browser, env.recruiterUrl, user);
      const claims = claimsOf(session.jwt);
      expect(claims.aal).toBe('aal2');
      expect(amrOf(claims)).toEqual(['password', 'totp']);
      const context = await newContext(browser, { baseURL: env.recruiterUrl });
      await seedSession(context, env.recruiterUrl, session);
      const page = await context.newPage();
      await page.goto('/tests');
      await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 20_000 });
      const memberships = await ownMemberships(rest, session.jwt, session.userId);
      const orgs = [...new Set(memberships.map((m) => m.org_id))];
      if (who === 'recruiter') {
        // The org comes from the recruiter's own memberships, never from a variable (staging); local cross-checks it.
        expect(orgs).toHaveLength(1);
        run.orgId = must(orgs[0], 'the org');
        if (env.orgId !== null) expect(run.orgId === env.orgId).toBe(true);
      }
      const mine = memberships.find((m) => m.org_id === run.orgId);
      const need = who === 'recruiter' ? ['org_owner', 'admin', 'recruiter'] : ['reviewer'];
      if (mine === undefined || !mine.roles.some((r) => need.includes(r))) {
        throw new Error(`the ${who} has no ${need.join('/')} membership in the recruiter's org`);
      }
      return { session, context, page, membershipId: mine.id, roles: mine.roles };
    };

    await step(
      null,
      'the recruiter signs in: password, then TOTP',
      async () => {
        run.recruiter = await signIn('recruiter');
        await caption(run.recruiter.page, 'Step 1: the recruiter is signed in (password + TOTP)');
      },
      120_000,
    );
    await step(
      null,
      'the reviewer signs in: password, then TOTP',
      async () => {
        run.reviewer = await signIn('reviewer');
        await expect(
          run.reviewer.page.getByRole('link', { name: 'Review queue', exact: true }),
        ).toBeVisible();
      },
      120_000,
    );
  });

  test('step 2: the recruiter creates a test (default cutoff 40 on screen) and publishes it', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const { page, membershipId } = recruiterOf();
    const name = `E2E D1 slice ${RUN}`;

    await step(page, 'Step 2: the recruiter creates a draft test', async () => {
      await page.goto('/tests/new');
      await page.getByLabel('Test name', { exact: true }).fill(name);
      await page.getByRole('button', { name: 'Create draft', exact: true }).click();
      await expect(page).toHaveURL(/\/tests\/[0-9a-f-]{36}$/);
      await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible();
    });

    await step(page, 'the editor shows the default Answer Quality cutoff, 40', async () => {
      const cutoff = page.getByLabel('Answer Quality cutoff (0 to 100)');
      await expect(cutoff).toBeVisible();
      await expect(cutoff).toHaveValue(String(DEFAULT_CUTOFF));
      await pause(page);
    });

    await step(
      page,
      'the content (3 MCQ items, 1 written item with rubric anchors) is saved and published',
      async () => {
        const testId = must(
          /\/tests\/([0-9a-f-]{36})$/.exec(new URL(page.url()).pathname)?.[1],
          'the test id',
        );
        const ctx = await ctxOf();
        const detail = await getTestDetail(request, ctx, testId);
        expect(detail.version.status).toBe('draft');
        expect(detail.version.qualityCutoff).toBe(DEFAULT_CUTOFF);
        const draft = { testId, versionId: detail.version.id, name };
        const published = await fillAndPublish(request, ctx, draft);
        expect(published).toMatchObject({ status: 'published', qualityCutoff: DEFAULT_CUTOFF });
        run.test = draft;
        await page.reload();
        await expect(page.getByText(/^Published, version 1\./)).toBeVisible();
        await expect(page.getByLabel('Answer Quality cutoff (0 to 100)')).toHaveValue(
          String(DEFAULT_CUTOFF),
        );
      },
    );

    await step(page, 'the creator is assigned to the test automatically', async () => {
      const list = await recruiterApi(request).assignments(testOf().testId);
      expect(list.assignments.map((a) => [a.membershipId === membershipId, a.asRole])).toEqual([
        [true, 'recruiter'],
      ]);
      const panel = page.getByRole('region', { name: 'Reviewers' });
      await expect(panel.getByText(/\(Recruiter\)$/)).toBeVisible();
    });
  });

  test('step 3: the reviewer sees nothing of this test; the recruiter assigns the reviewer', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const reviewer = reviewerOf();
    const { page } = recruiterOf();
    const t = testOf();

    await step(
      reviewer.page,
      'Step 3: the reviewer opens the review queue: nothing of this test',
      async () => {
        await reviewer.page.goto('/review');
        await expect(
          reviewer.page.getByRole('heading', { level: 2, name: 'Review queue' }),
        ).toBeVisible();
        const empty = reviewer.page.getByText('No reports are assigned to you yet.', {
          exact: true,
        });
        const table = reviewer.page.getByRole('table');
        await expect(empty.or(table)).toBeVisible();
        // A staging reviewer keeps earlier runs' assignments; a fresh local stack has none at all.
        if (envOf().mode === 'local') await expect(empty).toBeVisible();
        await expect(reviewer.page.getByRole('cell', { name: t.name, exact: true })).toHaveCount(0);
        await pause(reviewer.page);
      },
    );

    await step(page, 'the recruiter assigns the reviewer from the reviewers panel', async () => {
      await page.goto(`/tests/${t.testId}/reviewers`);
      const panel = page.getByRole('region', { name: 'Reviewers' });
      await expect(panel.getByText(/\(Recruiter\)$/)).toBeVisible();
      await panel.locator('select[name="member"]').selectOption(reviewer.membershipId);
      await expect(panel.locator('select[name="role"]')).toHaveValue('reviewer');
      await panel.getByRole('button', { name: 'Assign', exact: true }).click();
      await expect(panel.getByText(/\(Reviewer\)$/)).toBeVisible();
      const list = await recruiterApi(request).assignments(t.testId);
      expect(
        list.assignments.some(
          (a) => a.membershipId === reviewer.membershipId && a.asRole === 'reviewer',
        ),
      ).toBe(true);
    });
  });

  test('step 4: five 18+ invitations and one inviter-"No" invitation (blocked, no link)', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const { page } = recruiterOf();
    const t = testOf();

    await step(page, 'Step 4: five candidates are invited (18+ yes)', async () => {
      const ctx = await ctxOf();
      for (const key of ['A', 'B', 'C', 'D', 'E'] as const) {
        const invitation = await inviteCandidate(
          request,
          ctx,
          t.testId,
          `e2e-${RUN}+${key.toLowerCase()}@example.test`,
        );
        expect(invitation.status, key).toBe('sent');
        expect(invitation.token === null, key).toBe(false);
        run.cands[key] = { key, invitation };
      }
    });

    await step(page, 'one candidate is invited with "No" to 18+: blocked, no link', async () => {
      await page.goto(`/tests/${t.testId}/invite`);
      await page.getByLabel('Contact email').fill(`e2e-${RUN}+n@example.test`);
      await page.getByRole('radio', { name: 'No', exact: true }).check();
      await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
      const created = page.getByRole('region', { name: 'Invitation created' });
      await expect(created.getByText('Blocked: under 18', { exact: true })).toBeVisible();
      await expect(created.getByRole('button', { name: 'Copy link' })).toHaveCount(0);
      expect((await created.innerText()).includes('/i#')).toBe(false);
      const label = ((await created.getByRole('heading', { level: 3 }).textContent()) ?? '').trim();
      expect(label).toMatch(/^Candidate [1-9][0-9]*$/);
      run.blockedByInviter = { label };
      await pause(page);
    });

    await step(
      page,
      'the demo outbox holds one link per 18+ invitation and nothing for the blocked one',
      async () => {
        const entries = await (await outboxOf(request)).list();
        for (const key of ['A', 'B', 'C', 'D', 'E'] as const) {
          const c = cand(key);
          const mine = entries.filter(
            (e) => e.kind === 'invite' && e.candidateLabel === c.invitation.label,
          );
          expect(mine, key).toHaveLength(1);
          const token = linkTokenIn(mine[0]?.bodyText ?? '');
          expect(token !== null && token === c.invitation.token, key).toBe(true);
        }
        const blocked = must(run.blockedByInviter, 'the blocked invitation');
        expect(entries.filter((e) => e.candidateLabel === blocked.label)).toHaveLength(0);
        const list = await recruiterApi(request).invitations(t.testId);
        expect(list.invitations.find((i) => i.label === blocked.label)?.status).toBe('blocked_age');
      },
    );
  });

  test('steps 5-6: A-D take the test in parallel and see a receipt only; E answers "under 18"', async ({
    browser,
    request,
  }) => {
    test.setTimeout(600_000);
    const env = envOf();
    const t = testOf();
    const outbox = await outboxOf(request);
    const edge = edgeClient(request, env.edge);

    for (const key of ['A', 'B', 'C', 'D', 'E'] as const) {
      const c = cand(key);
      c.context = await newContext(browser, {
        permissions: key === 'B' ? ['camera', 'clipboard-read', 'clipboard-write'] : ['camera'],
      });
      c.ui = await CandidateUi.on(await c.context.newPage(), env.candidateUrl);
    }

    const cstep = <T>(key: Key, name: string, body: () => Promise<T>, timeout = STEP_MS) =>
      step(uiOf(key).page, `${key}: ${name}`, body, timeout);

    /** One adult candidate from the link to the receipt; `extra` runs after the mid-test reload. */
    const adult = async (
      key: (typeof ADULTS)[number],
      plan: {
        choices: readonly string[];
        ids: readonly string[];
        written: string;
        shiftClock: boolean;
        extra?: { name: string; body: (ui: CandidateUi) => Promise<void> };
      },
    ) => {
      const c = cand(key);
      const ui = uiOf(key);
      const token = must(c.invitation.token, `${key}'s link`);
      await cstep(key, 'opens the link and enters the code from the demo outbox', async () => {
        await ui.openLink(token, t.name);
        await ui.enterCode(outbox, c.invitation.label);
      });
      await cstep(key, 'is 18 or older, reads the notice and consents', async () => {
        c.notice = await ui.declareAdult();
        await ui.consent(c.notice);
      });
      await cstep(
        key,
        'takes the start photo; the camera goes off',
        async () => {
          c.photo = await ui.takePhoto();
          c.media = await cameraRecord(ui.page);
        },
        120_000,
      );
      await cstep(
        key,
        'starts the test and answers',
        async () => {
          c.start = await ui.startTest(ITEMS);
          await ui.answer(plan.choices, plan.written, ITEMS);
          await ui.waitAnswersAcked(plan.ids, plan.written, ITEMS);
        },
        90_000,
      );
      await cstep(
        key,
        plan.shiftClock
          ? 'reloads mid-test with its clock an hour ahead: same answers, timer not larger'
          : 'reloads mid-test: same answers, timer not larger',
        async () => {
          const before = await ui.timerSeconds();
          if (plan.shiftClock) await ui.page.addInitScript({ content: CLOCK_SHIFT_SCRIPT });
          await ui.page.reload();
          await expect(ui.page.getByTestId('timer')).toBeVisible();
          if (plan.shiftClock) {
            const skew = await ui.page.evaluate(() => Date.now());
            expect(skew - Date.now() > CLOCK_SHIFT_MS / 2).toBe(true);
          }
          const after = await ui.timerSeconds();
          expect(after).toBeLessThanOrEqual(before);
          // A shifted client clock changes nothing: the timer is the server's deadline (AT-D7).
          expect(after).toBeGreaterThanOrEqual(before - 120);
          expect((await cameraRecord(ui.page)).calls).toHaveLength(0);
          await ui.expectAnswersRestored(plan.choices, plan.written, ITEMS);
        },
        90_000,
      );
      if (plan.extra !== undefined) {
        const extra = plan.extra;
        await cstep(key, extra.name, () => extra.body(ui), 150_000);
      }
      await cstep(key, 'submits and sees the receipt only', async () => {
        await ui.submit();
        await waitUntil('the receipt answer', 10_000, () => ui.net.state.receipt !== null);
        c.receipt = must(ui.net.state.receipt, 'the receipt');
        c.submittedAt = must(ui.net.state.submittedAt, 'the submit time');
        // D1-11, rule 5: exactly the receipt.
        expect(keysOf(c.receipt)).toEqual(['receiptRef', 'submittedAt']);
      });
    };

    const flows: [Key, () => Promise<void>][] = [
      [
        'A',
        () =>
          adult('A', {
            choices: CORRECT,
            ids: ['a', 'a', 'a'],
            written: STRONG,
            shiftClock: true,
            extra: {
              // AT-D11(b), the part that needs A's session still running: B's stream id is unknown to A's object.
              name: "B's stream id sent with A's session token is refused 400 by A's own object",
              body: async () => {
                const a = must(cand('A').start, "A's session");
                await waitUntil(
                  "B's session start",
                  120_000,
                  () => uiOf('B').net.state.start !== null,
                );
                const b = must(uiOf('B').net.state.start, "B's session");
                await expectRefusal(
                  await edge.sessionPost(
                    `/v1/session/events?invitationId=${cand('B').invitation.invitationId}`,
                    a.sessionToken,
                    {
                      streamId: b.view.streamId,
                      events: [{ seq: 1, t: 0, kind: 'heartbeat' }],
                      invitationId: cand('B').invitation.invitationId,
                      sessionId: b.view.sessionId,
                    },
                  ),
                  400,
                  'bad_request',
                  "A's token with B's stream id",
                );
                // B's ids in the URL are ignored: A's own item is served.
                const served = await jsonOf<{ position: number; kind: string }>(
                  await edge.sessionGet(
                    `/v1/session/items/1?invitationId=${cand('B').invitation.invitationId}&sessionId=${b.view.sessionId}`,
                    a.sessionToken,
                  ),
                  200,
                  "A's item with B's ids in the URL",
                );
                expect(served).toMatchObject({ position: 1, kind: 'mcq' });
              },
            },
          }),
      ],
      [
        'B',
        () =>
          adult('B', {
            choices: CORRECT,
            ids: ['a', 'a', 'a'],
            written: STRONG,
            shiftClock: false,
            extra: {
              name: 'pastes text from outside the test (a real Ctrl+V): blocked and recorded',
              body: async (ui) => {
                await ui.page.bringToFront();
                const box = ui.page.getByLabel('Your answer');
                await box.focus();
                await ui.page.evaluate((text) => navigator.clipboard.writeText(text), PASTED);
                await ui.page.keyboard.press('ControlOrMeta+V');
                const signal = await ui.waitSignalAcked('paste');
                expect(signal).toMatchObject({ item: ITEMS, len: PASTED.length });
                // The paste was prevented: the answer is unchanged, so A, B and C score the same.
                await expect(box).toHaveValue(STRONG);
              },
            },
          }),
      ],
      [
        'C',
        () =>
          adult('C', {
            choices: CORRECT,
            ids: ['a', 'a', 'a'],
            written: STRONG,
            shiftClock: false,
            extra: {
              name: 'synthetic key events (dispatchEvent, isTrusted=false) reach the answer box',
              body: async (ui) => {
                const box = ui.page.getByLabel('Your answer');
                const trusted = await box.evaluate((el) => {
                  const seen: boolean[] = [];
                  el.addEventListener('keydown', (e) => seen.push(e.isTrusted), { once: true });
                  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
                  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', bubbles: true }));
                  return seen;
                });
                expect(trusted).toEqual([false]);
                await ui.waitSignalAcked('untrusted_input');
                await expect(box).toHaveValue(STRONG);
              },
            },
          }),
      ],
      [
        'D',
        () =>
          adult('D', {
            choices: WRONG,
            ids: ['b', 'b', 'b'],
            written: WEAK,
            shiftClock: false,
          }),
      ],
      [
        'E',
        async () => {
          const ui = uiOf('E');
          const c = cand('E');
          await step(
            ui.page,
            'E: opens the link, enters the code, answers "under 18": blocked',
            async () => {
              await ui.openLink(must(c.invitation.token, "E's link"), t.name);
              await ui.enterCode(outbox, c.invitation.label);
              await ui.declareMinor();
              expect(await visibleText(ui.page)).not.toMatch(/What we record and why|Start photo/);
            },
            90_000,
          );
        },
      ],
    ];

    const results = await Promise.allSettled(flows.map(([, flow]) => flow()));
    const failed = results.flatMap((r, i) =>
      r.status === 'rejected'
        ? [`${flows[i]?.[0]}: ${r.reason instanceof Error ? r.reason.message : 'failed'}`]
        : [],
    );
    if (failed.length > 0) throw new Error(`candidate flows failed:\n${failed.join('\n')}`);

    await step(
      null,
      'E: no consent row, no session, the invitation is blocked (rule 9)',
      async () => {
        const rest = restOf(request);
        const jwt = await accessToken(recruiterOf().page);
        const e = cand('E').invitation.invitationId;
        const a = cand('A').invitation.invitationId;
        const ui = uiOf('E');
        expect((await cameraRecord(ui.page)).calls).toHaveLength(0);
        expect(ui.net.state.consentRequests).toBe(0);
        expect(ui.net.seen.some((s) => s.path === '/v1/lobby/notice')).toBe(false);
        const [row] = await rest.select<{
          status: string;
          age_block_source: string | null;
          adult_self_declared: boolean | null;
          session_id: string | null;
        }>(
          'invitations',
          `select=status,age_block_source,adult_self_declared,session_id&id=eq.${e}`,
          jwt,
        );
        expect(row).toEqual({
          status: 'blocked_age',
          age_block_source: 'self_declared',
          adult_self_declared: false,
          session_id: null,
        });
        // The same query finds A's consent, so an empty answer for E is not RLS hiding the table.
        expect(await rest.select('consents', `select=id&invitation_id=eq.${a}`, jwt)).toHaveLength(
          1,
        );
        expect(await rest.select('consents', `select=id&invitation_id=eq.${e}`, jwt)).toEqual([]);
        expect(await rest.select('sessions', `select=id&invitation_id=eq.${e}`, jwt)).toEqual([]);
        if (envOf().dbContainer !== null) {
          const counts = readDb(
            `select (select count(*) from public.consents where invitation_id = :'inv')
               || '|' || (select count(*) from public.sessions where invitation_id = :'inv');`,
            { inv: e },
            'counting E consents and sessions',
          );
          expect(counts).toEqual(['0|0']);
        }
      },
    );
  });

  test('AT-D17: both cards of A-D are ready within 90 s of the submit', async ({ request }) => {
    test.setTimeout(READY_LIMIT_MS + 120_000);
    const api = recruiterApi(request);
    const t = testOf();
    await step(
      recruiterOf().page,
      'Waiting for the results: quality first, then integrity',
      async () => {
        await Promise.all(
          ADULTS.map(async (key) => {
            const c = cand(key);
            const submittedAt = must(c.submittedAt, `${key}'s submit time`);
            const left = () => Math.max(1_000, submittedAt + READY_LIMIT_MS - Date.now());
            const row = await api.readyRow(t.testId, c.invitation.label, left());
            c.reportId = row.reportId;
            if (row.quality.state === 'ready') c.score = row.quality.score;
            c.integrity = await poll(
              `${key}'s integrity card`,
              { timeoutMs: left(), everyMs: 1000 },
              async () => {
                const card = await api.integrity(row.reportId);
                return card.state === 'pending' ? undefined : card;
              },
            );
            const ms = Date.now() - submittedAt;
            must(run.manifest, 'the manifest').timeToReadyMs[key] = ms;
            expect(ms, `${key} time_to_ready_ms`).toBeLessThanOrEqual(READY_LIMIT_MS);
          }),
        );
      },
      READY_LIMIT_MS + 60_000,
    );
  });

  test('step 7: the results list shows A, B, C with the same score, D below the cutoff, no band', async ({
    request,
  }) => {
    test.setTimeout(120_000);
    const { page } = recruiterOf();
    const t = testOf();

    await step(page, 'Step 7: the results list (Answer Quality only)', async () => {
      const list = await recruiterApi(request).results(t.testId);
      expect(keysOf(list)).toEqual(['cutoff', 'rows']);
      expect(list.cutoff).toBe(DEFAULT_CUTOFF);
      for (const row of list.rows) {
        expect(keysOf(row)).toEqual(['label', 'quality', 'reportId', 'submittedAt']);
      }
      const score = (key: Key) => {
        const row = list.rows.find((r) => r.label === cand(key).invitation.label);
        return row?.quality.state === 'ready' ? row.quality : null;
      };
      const [a, b, c, d] = [score('A'), score('B'), score('C'), score('D')];
      expect(a?.belowCutoff).toBe(false);
      expect(b?.score).toBe(a?.score);
      expect(c?.score).toBe(a?.score);
      expect(d?.belowCutoff).toBe(true);
      expect((d?.score ?? 100) < (a?.score ?? 0)).toBe(true);
      // Neither the blocked candidates nor anyone else of this test has a row.
      expect(list.rows).toHaveLength(4);

      await page.goto(`/tests/${t.testId}/results`);
      await expect(page.getByRole('heading', { level: 2, name: 'Results' })).toBeVisible();
      await expect(page.getByRole('table')).toBeVisible();
      const headers = await page.getByRole('columnheader').allInnerTexts();
      expect(headers.map((h) => h.trim())).toEqual([
        'Candidate',
        'Answer Quality',
        'Submitted',
        'Report',
      ]);
      const cell = async (key: Key) =>
        (
          (await rowOf(page, cand(key).invitation.label).getByRole('cell').first().innerText()) ??
          ''
        ).trim();
      const [ca, cb, cc, cd] = [await cell('A'), await cell('B'), await cell('C'), await cell('D')];
      expect(ca).toBe(String(a?.score));
      expect(cb).toBe(ca);
      expect(cc).toBe(ca);
      expect(cd).toBe(`${d?.score} · Below cutoff`);
      expect(await visibleText(page)).not.toMatch(
        /\bbands?\b|integrity|strong concern|review suggested/i,
      );
      await expectNoRejectControl(page);
      await pause(page);
    });
  });

  test('step 8: reports B, C and D (rules 1, 2 and 6; AT-D8, AT-D10, AT-D14)', async ({
    request,
  }) => {
    test.setTimeout(300_000);
    const { page, roles } = recruiterOf();
    const t = testOf();
    const rest = restOf(request);

    /** Opens a report from the results list, collecting the three report answers the page receives. */
    const openReport = async (key: Key) => {
      const c = cand(key);
      const reportId = must(c.reportId, `${key}'s report`);
      const bodies: { meta: unknown[]; quality: unknown[]; integrity: unknown[] } = {
        meta: [],
        quality: [],
        integrity: [],
      };
      const listener = (res: Response) => {
        const kind = reportCall(res, reportId);
        if (kind === null || res.status() !== 200) return;
        const into =
          kind === '' ? bodies.meta : kind === '/quality' ? bodies.quality : bodies.integrity;
        void res
          .json()
          .then((body: unknown) => into.push(body))
          .catch(() => undefined);
      };
      page.on('response', listener);
      await page.goto(`/tests/${t.testId}/results`);
      await rowOf(page, c.invitation.label).getByRole('link', { name: 'Open report' }).click();
      await expect(page).toHaveURL(new RegExp(`/reports/${reportId}$`));
      await expect(page.getByRole('heading', { level: 2, name: c.invitation.label })).toBeVisible();
      const qualityCard = page.locator('[data-region="quality-card"]');
      const integrityCard = page.locator('[data-region="integrity-card"]');
      await expect(qualityCard.locator('[data-headline]')).toHaveText(`${c.score} / 100`);
      await waitUntil(
        'the three report answers',
        20_000,
        () => bodies.meta.length > 0 && bodies.quality.length > 0 && bodies.integrity.length > 0,
      );
      return {
        c,
        reportId,
        bodies,
        qualityCard,
        integrityCard,
        stop: () => page.off('response', listener),
      };
    };

    /** Rule 1 on the wire: each card comes from its own request and holds nothing of the other. */
    const expectSeparateCards = (bodies: {
      meta: unknown[];
      quality: unknown[];
      integrity: unknown[];
    }) => {
      const quality = bodies.quality.at(-1) as QualityCard;
      const integrity = bodies.integrity.at(-1) as IntegrityCard;
      const qKeys = keysDeep(quality);
      const iKeys = keysDeep(integrity);
      expect(
        qKeys.filter((k) =>
          ['band', 'flags', 'timeline', 'evidenceStrength', 'coveragePct', 'reasons'].includes(k),
        ),
      ).toEqual([]);
      expect(
        iKeys.filter((k) => ['score', 'sections', 'graderModelId', 'scoringVersion'].includes(k)),
      ).toEqual([]);
      const metaKeys = keysDeep(bodies.meta.at(-1));
      expect(metaKeys.filter((k) => ['score', 'band', 'flags'].includes(k))).toEqual([]);
      for (const k of [...qKeys, ...iKeys, ...metaKeys]) expect(k).not.toMatch(BLENDED_KEY);
      return { quality, integrity, meta: bodies.meta.at(-1) as ReportMeta };
    };

    /** AT-D8: the report's notice hash prefix is the SHA-256 of the notice text the candidate read. */
    const expectNoticeHash = (key: Key, meta: ReportMeta) => {
      const notice = must(cand(key).notice, `${key}'s notice`);
      const prefix = meta.report.noticeHashPrefix;
      expect(prefix.length).toBeGreaterThanOrEqual(8);
      expect(sha256Hex(notice.bodyText).startsWith(prefix)).toBe(true);
    };

    /** Rule 1 in the DOM: one score in the quality card, a band label (no number) in the integrity card. */
    const expectNoCombinedNumber = async () => {
      const text = await visibleText(page);
      expect(text).not.toMatch(BLENDED_WORD);
      await expect(page.locator('[data-region="quality-card"] [data-headline]')).toHaveCount(1);
      const band = (
        await page.locator('[data-region="integrity-card"] [data-headline]').innerText()
      ).trim();
      expect(band).not.toMatch(/\d/);
    };

    await step(page, 'Step 8: report B: two cards from two requests, band Review', async () => {
      const r = await openReport('B');
      await expect(r.integrityCard.locator('[data-headline]')).toHaveText(BAND_LABEL.review);
      const { integrity, meta } = expectSeparateCards(r.bodies);
      expect(integrity.state === 'ready' && integrity.band).toBe('review');
      expectNoticeHash('B', meta);
      await expect(page.getByText(meta.report.noticeHashPrefix, { exact: true })).toBeVisible();
      await expectNoCombinedNumber();
      await expectNoRejectControl(page);
      r.stop();
      await pause(page);
    });

    await step(page, "B's paste flag: rule, observed value and time", async () => {
      const integrity = must(cand('B').integrity, "B's integrity card");
      if (integrity.state !== 'ready') throw new Error("B's integrity card is not ready");
      const flag = must(
        integrity.flags.find((f) => f.family === 'paste'),
        "B's paste flag",
      );
      expect(flag.tier).toBe('T3');
      expect(flag.observed.len).toBe(PASTED.length);
      const card = page.locator(`article[aria-label$=": ${flag.ruleId}"]`);
      await expect(card).toBeVisible();
      await expect(card.getByText(flag.ruleId, { exact: true })).toBeVisible();
      await expect(card.getByText(`${PASTED.length} characters`, { exact: false })).toBeVisible();
      await expect(
        card.getByText(`(${flag.atMs} ms into the session)`, { exact: true }),
      ).toBeVisible();
      await expect(card.getByRole('button')).toHaveCount(0);
      await card.scrollIntoViewIfNeeded();
      await pause(page);
    });

    await step(page, "B's start photo: watermarked, from a single-use link (AT-D10)", async () => {
      const linkAnswer = page.waitForResponse(
        (res) =>
          res.request().method() === 'POST' &&
          new URL(res.url()).pathname.endsWith(`/reports/${cand('B').reportId}/start-photo-link`),
      );
      const media = page.waitForResponse((res) =>
        new URL(res.url()).pathname.startsWith('/media/'),
      );
      await page.getByRole('button', { name: 'View start photo', exact: true }).click();
      const linkRes = await linkAnswer;
      expect(linkRes.status()).toBe(200);
      const link = (await linkRes.json()) as MediaLink;
      expect(roles.includes(link.watermark.viewerRole)).toBe(true);
      expect(link.watermark.org.length).toBeGreaterThan(0);
      expect(Date.parse(link.expiresAt) - Date.now()).toBeLessThanOrEqual(300_000 + 5_000);
      expect((await media).status()).toBe(200);
      const img = page.getByRole('img', {
        name: 'Candidate at the start of the test, with a viewing watermark',
      });
      await expect(img).toBeVisible();
      expect(((await img.getAttribute('src')) ?? '').startsWith('data:image/')).toBe(true);
      // The browser fetched the bytes once; the same link is spent (single use). Node's fetch, not the Playwright
      // request context, so the link never becomes a step title in the report.
      const again = await fetch(link.url, { cache: 'no-store' });
      expect(again.status).toBe(404);
      await pause(page);
    });

    await step(page, 'report C: Strong concern (input not produced by the keyboard)', async () => {
      const r = await openReport('C');
      await expect(r.integrityCard.locator('[data-headline]')).toHaveText(
        BAND_LABEL.strong_concern,
      );
      const { integrity, meta } = expectSeparateCards(r.bodies);
      expect(
        integrity.state === 'ready' && integrity.flags.some((f) => f.family === 'input_origin'),
      ).toBe(true);
      expectNoticeHash('C', meta);
      await expectNoCombinedNumber();
      await expectNoRejectControl(page);
      r.stop();
    });

    await step(
      page,
      'report D: "Not reviewed (below cutoff)"; no band, flag or timeline (rule 6)',
      async () => {
        const r = await openReport('D');
        await expect(r.integrityCard.locator('[data-headline]')).toHaveText(
          'Not reviewed (below cutoff)',
        );
        const { integrity, meta } = expectSeparateCards(r.bodies);
        expect(integrity).toEqual({ state: 'not_used_below_cutoff' });
        for (const body of r.bodies.integrity)
          expect(body).toEqual({ state: 'not_used_below_cutoff' });
        expectNoticeHash('D', meta);
        await expect(page.locator('[data-region="integrity-evidence"]')).toHaveCount(0);
        await expect(page.locator('article[aria-label^="Flag "]')).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Evidence timeline' })).toHaveCount(0);
        const text = await visibleText(page);
        expect(text).not.toMatch(/Review suggested|Strong concern|\bClear\b|Insufficient evidence/);
        await expectNoRejectControl(page);
        r.stop();
        await pause(page);
      },
    );

    await step(
      page,
      "D's integrity card is not readable through PostgREST as the recruiter",
      async () => {
        const jwt = await accessToken(page);
        const d = must(cand('D').start, "D's session").view.sessionId;
        const b = must(cand('B').start, "B's session").view.sessionId;
        // B's reviewed card is readable with the same query, so D's empty answer is the rule-6 policy.
        expect(
          await rest.select('integrity_cards', `select=id&session_id=eq.${b}`, jwt),
        ).toHaveLength(1);
        expect(await rest.select('integrity_cards', `select=id&session_id=eq.${d}`, jwt)).toEqual(
          [],
        );
        expect(
          await rest.select('integrity_timeline_entries', `select=id&session_id=eq.${d}`, jwt),
        ).toEqual([]);
      },
    );
  });

  test('step 9: the reviewer (aal2) sees the assigned reports and opens C', async () => {
    test.setTimeout(120_000);
    const { page, session } = reviewerOf();
    const t = testOf();
    await step(page, 'Step 9: the reviewer reloads the review queue', async () => {
      expect(claimsOf(await accessToken(page)).aal).toBe('aal2');
      expect(claimsOf(session.jwt).aal).toBe('aal2');
      await page.goto('/review');
      await expect(page.getByRole('table')).toBeVisible();
      for (const key of ADULTS) {
        const row = rowOf(page, cand(key).invitation.label).filter({ hasText: t.name });
        await expect(row, key).toHaveCount(1);
      }
      expect(await visibleText(page)).not.toMatch(/\bbands?\b|strong concern|review suggested/i);
      await pause(page);
    });
    await step(page, 'the reviewer opens report C: Strong concern', async () => {
      await rowOf(page, cand('C').invitation.label)
        .filter({ hasText: t.name })
        .getByRole('link', { name: 'Open report' })
        .click();
      await expect(page.locator('[data-region="integrity-card"] [data-headline]')).toHaveText(
        BAND_LABEL.strong_concern,
      );
      await expectNoRejectControl(page);
      await pause(page);
    });
  });

  test('step 10: negative checks (AT-D11(b), network, camera) and A is Clear', async ({
    request,
  }) => {
    test.setTimeout(180_000);
    const env = envOf();
    const edge = edgeClient(request, env.edge);
    const candidateOrigin = new URL(env.candidateUrl).origin;
    const edgeOrigin = new URL(env.edge).origin;

    await step(
      null,
      "AT-D11(b): with A's token, B's ids are ignored and B's receipt is never returned",
      async () => {
        const a = must(cand('A').start, "A's session");
        const b = must(cand('B').start, "B's session");
        const receiptA = must(cand('A').receipt, "A's receipt");
        const receiptB = must(cand('B').receipt, "B's receipt");
        expect(receiptA.receiptRef === receiptB.receiptRef).toBe(false);
        const bIds = {
          invitationId: cand('B').invitation.invitationId,
          sessionId: b.view.sessionId,
        };
        const attached = await jsonOf<{
          view: { sessionId: string; streamId: string; state: string; receipt?: ReceiptAnswer };
        }>(
          await edge.sessionPost(
            `/v1/session/attach?invitationId=${bIds.invitationId}&sessionId=${bIds.sessionId}`,
            a.sessionToken,
            bIds,
          ),
          200,
          "A's attach with B's ids",
        );
        expect(attached.view.sessionId === a.view.sessionId).toBe(true);
        expect(attached.view.state).toBe('submitted');
        expect(attached.view.receipt).toEqual(receiptA);
        const again = await jsonOf<ReceiptAnswer>(
          await edge.sessionPost(`/v1/session/submit?sessionId=${bIds.sessionId}`, a.sessionToken, {
            streamId: attached.view.streamId,
            finalSeq: 0,
            ...bIds,
          }),
          200,
          "A's submit with B's ids",
        );
        expect(again).toEqual(receiptA);
        expect(JSON.stringify([attached, again]).includes(receiptB.receiptRef)).toBe(false);
      },
    );

    await step(
      null,
      'every candidate request went to the candidate or edge origin; one binary upload (rule 8)',
      async () => {
        const allowed = new Set([candidateOrigin, edgeOrigin]);
        for (const key of ['A', 'B', 'C', 'D', 'E'] as const) {
          const { net } = uiOf(key);
          const token = must(cand(key).invitation.token, `${key}'s link`);
          expect(
            [...new Set(net.seen.map((s) => s.origin))].filter((o) => !allowed.has(o)),
            key,
          ).toEqual([]);
          expect(
            net.sockets.filter((u) => !allowed.has(new URL(u).origin.replace(/^ws/, 'http'))),
            key,
          ).toEqual([]);
          expect(
            net.seen
              .filter((s) => s.origin === candidateOrigin && s.method !== 'GET')
              .map((s) => s.method),
            key,
          ).toEqual([]);
          const notJson = net.seen
            .filter((s) => s.body !== null && s.body.length > 0)
            .filter((s) => !s.contentType.startsWith('application/json'))
            .map(
              (s) =>
                `${s.method} ${s.origin === edgeOrigin ? 'edge' : 'other'} ${s.path} ${s.contentType}`,
            );
          expect(notJson, key).toEqual(key === 'E' ? [] : ['PUT edge /v1/lobby/photo image/jpeg']);
          expect(
            net.seen.some((s) => s.url.includes(token)),
            key,
          ).toBe(false);
        }
      },
    );

    await step(
      null,
      'the camera was asked for once, video only, after the consent response (AT-D9)',
      async () => {
        for (const key of ADULTS) {
          const ui = uiOf(key);
          const consentAt = must(ui.net.state.consentResponseAt, `${key}'s consent response`);
          // The lobby document's record (read right after the photo); the document after the reload asked for none.
          const media = must(cand(key).media, `${key}'s camera record`);
          expect(media.calls, key).toHaveLength(1);
          const call = media.calls[0];
          const constraints = call?.constraints as { audio?: unknown; video?: unknown } | null;
          expect(constraints?.audio, key).toBe(false);
          expect(constraints?.video, key).toBeTruthy();
          expect((call?.at ?? 0) >= consentAt, key).toBe(true);
          expect(media.tracks.length, key).toBeGreaterThan(0);
          expect(
            media.tracks.every((t) => t.kind === 'video' && t.readyState === 'ended'),
            key,
          ).toBe(true);
          expect((await cameraRecord(ui.page)).calls, key).toHaveLength(0);
          const photo = must(cand(key).photo, `${key}'s photo`);
          expect(photo.status, key).toBe(200);
          expect(photo.contentType, key).toBe('image/jpeg');
          expect([...photo.body.subarray(0, 2)], key).toEqual([0xff, 0xd8]);
          expect(headerMarkers(photo.body).filter(isMetadataMarker), key).toEqual([]);
          expect(photo.sha256Header, key).toBe(sha256Hex(photo.body));
          expect(photo.answer, key).toEqual({
            sha256: sha256Hex(photo.body),
            bytes: photo.body.length,
          });
        }
      },
    );

    await step(null, 'A, with no signal, is Clear', async () => {
      const integrity = must(cand('A').integrity, "A's integrity card");
      expect(integrity.state === 'ready' && integrity.band).toBe('clear');
    });
  });
});
