// AT-M1-01 (ABH-5 proxy) and AT-M1-30 (specs/m1-test-authoring.md §12, §1.6 R2-20, §6.1, §6.10): a recruiter publishes a
// test from a role template through the recruiter UI, at a stated human pace, and the run records how long it took.
//  - AT-M1-01: sign-in to a PUBLISHED test via the Customer Support template; the budget is 300 s.
//  - AT-M1-30: the BPO Voice template, found from a pasted job description; the voice section is skipped with its note.
// The real five-recruiter median is a deferred gate (§13); this is its automated proxy.
//
// HUMAN PACE (R2-20), applied as a BUDGET ADDED to the measured time, not as real waits (support/m1-pace.ts): 2 s per
// click, 1 s per field focus, typing at 40 wpm (300 ms a character), 10 s of reading per screen. The spec calls
// `pace.click()` / `focus()` / `typed()` / `read()` where a person would, and the browser acts at machine speed.
//   elapsed_ms = measured wall-clock time (page loads, api calls, waits, and the sign-in when this run signed in) + the
// modelled human time, minus the placeholder item bank set-up (`pace.excluded`, see below). `elapsed_ms` must be <=
// 300,000. It is recorded as a test annotation and in `<output dir>/m1-at01.json` / `m1-at30.json` (numbers only).
// `includes_sign_in` says whether this run signed in (AT-M1-01: true) or reused that session (AT-M1-30: false).
//
// KNOWN LIMIT (placeholder bank, excluded from the time): the local stack has no library content (§1.3 M1-4, R5-28).
// The spec seeds approved synthetic items in the RECRUITER'S OWN org through the import api before the form
// (`seedBank`), and tops up the draft's pools through the pool api right after "Create draft from template"
// (`fillPools`, excluded from the time), because a test cannot be published with fewer approved pool items than its
// draw count (§6.5). So AT-M1-01 does NOT exercise the from-template library copy, and the pools (12 / 12 / 10 / 3
// items) are below the 10x rule for drives (§6.5). A library-seeding route for E2E is a lead ask (owed).
//
// SIGN-IN: `signInThroughUi` enrols the TOTP factor of a fresh local user through the app's own screens in a context
// that records nothing; its real duration is in `measured_ms`; the typing, reading and clicks of a sign-in are modelled.
//
// WIZARD (apps/recruiter/src/authoring/WizardEditor.tsx): on `/tests/:testId` the page shows the step list "Steps" and
// three regions, "Step 2: Questions", "Step 3: Integrity", "Step 4: Review and publish". The spec asserts all of them
// before "Publish..." and models `WIZARD_SCREENS` = 3 regions read. It also adds 3 clicks: a deliberate over-count
// (scrolling between regions on one page), so the budget errs on the safe side.
//
// Labels used (apps/recruiter/src):
//   shell/SignedIn.tsx:31            navigation "Main"
//   authoring/TestsListPage.tsx:80   heading (2) "Tests";  :28 link "New test"
//   authoring/TestEditorPage.tsx:312 heading (2) "New test"
//   authoring/FromTemplateRoute.tsx:116 heading (3) "Or start from a role template"
//   authoring/FromTemplateRoute.tsx:138 field "Job title";  :150 field "Job description (optional)"
//   authoring/FromTemplateRoute.tsx:171 button "Suggest a template";  :100 text "Suggested from the job description: <name>."
//   authoring/FromTemplateRoute.tsx:188 radio "<name> (version <n>, <preset>)" -> "Customer Support (version 1, Standard)"
//   authoring/FromTemplateRoute.tsx:207 button "Create draft from template";  :69 text "Draft created: <name>."
//   authoring/FromTemplateRoute.tsx:72 heading (3) "Not in this draft yet";  :78 items "<title> (<format> section)"
//   authoring/FromTemplateRoute.tsx:84 link "Open the draft"
//   authoring/TestEditorPage.tsx:261 heading (2) <test name>
//   authoring/WizardEditor.tsx:37    list "Steps" (items "1. Job details" ... "4. Review and publish", :33-:41)
//   authoring/WizardEditor.tsx:52    headings (3) "Step 2: Questions", "Step 3: Integrity", "Step 4: Review and publish"
//   authoring/WizardEditor.tsx:485   button "Publish..."
//   authoring/PublishDialog.tsx:18   dialog "Publish this test" (:20);  :5 freeze text;  :30 button "Publish test"
//   authoring/WizardEditor.tsx:86    text "Published, version <n>. Settings are frozen; ..."
// Template and section names: supabase/migrations/20261023020000_m1_tests.sql:1414-1431 (customer_support, bpo_voice).
//
// Skipped unless E2E_LOCAL=1 (scripts/e2e-local.mjs). Synthetic data only; nothing printed holds a secret.
import { randomBytes } from 'node:crypto';
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { fillPools, readDraft, seedBank, type M1Api, type SeededBank } from '../support/m1-api.js';
import { PaceClock, recordMeasurement } from '../support/m1-pace.js';
import { M1_TEMPLATE_EMAIL, m1Api, m1User, readM1Env, type M1Env } from '../support/m1-ui.js';
import {
  restClient,
  seedSession,
  signInThroughUi,
  type UiSession,
} from '../support/recruiter-ui.js';

test.skip(process.env['E2E_LOCAL'] !== '1', 'set E2E_LOCAL=1 (scripts/e2e-local.mjs) to run');
test.describe.configure({ mode: 'serial' });

/** R2-20 / AT-M1-01: the whole flow, modelled human time included, fits in five minutes. */
const LIMIT_MS = 300_000;
/** Lower-case letters and digits: it goes into stems, rubric keys and test names. */
const RUN = randomBytes(4).toString('hex');
/** §6.10 wizard steps after "Job details": Questions, Integrity, Review and publish (each read, each reached by a click). */
const WIZARD_SCREENS = 3;
/** The freeze text of the publish dialog (apps/recruiter/src/authoring/TestEditorPage.tsx:22). */
const FREEZE_COPY =
  'Settings freeze when you publish, including the cutoff; later changes create a new version';

/**
 * Approved synthetic items for both templates' pools (§6.1 blueprints): a pool needs its section's draw count
 * (verbal 10, customer service 10, reading 8, written 1), and two more are added.
 */
const BANK_NEEDS = [
  { skill: 'verbal', format: 'mcq', count: 12 },
  { skill: 'customer_service_sjt', format: 'mcq', count: 12 },
  { skill: 'reading', format: 'mcq', count: 10 },
  { skill: 'written_communication', format: 'written', count: 3 },
] as const;

/** What the two serial tests hand each other. */
const shared: { session?: UiSession; bank?: SeededBank } = {};

interface Scenario {
  /** `m1-at01` / `m1-at30`: the measurement file. */
  file: string;
  jobTitle: string;
  /** The template's radio label (FromTemplateRoute.tsx:188). */
  radio: string;
  /** Found from a pasted job description (then the radio is preselected) or picked by hand. */
  jd: string | null;
  /** The blueprint sections that become pool sections, in order (migration :1415-1431). */
  sections: readonly string[];
  /** The "not in this draft yet" items (FromTemplateRoute.tsx:78). */
  skipped: readonly string[];
}

const CUSTOMER_SUPPORT: Scenario = {
  file: 'm1-at01',
  jobTitle: `Customer Support Associate ${RUN}`,
  radio: 'Customer Support (version 1, Standard)',
  jd: null,
  sections: ['Verbal ability', 'Customer service situations', 'Written communication'],
  skipped: ['Typing (typing section)'],
};

const BPO_VOICE: Scenario = {
  file: 'm1-at30',
  jobTitle: `BPO Voice Associate ${RUN}`,
  radio: 'BPO Voice (version 1, Standard)',
  // 9 of the template's 12 keywords (bpo, voice, calls, inbound, telecaller, process, english, communication, accent):
  // 750 permille, far above the 150 the api proposes at (services/api/src/modules/templates/routes.ts).
  jd: '[synthetic] Inbound BPO voice process. Handle calls in English with a clear accent and strong communication. Telecaller role.',
  sections: ['Verbal ability', 'Reading comprehension', 'Written communication'],
  skipped: ['Spoken English (voice section)', 'Typing (typing section)'],
};

/** Signs in once per run (modelled and measured), or reuses the session of the first test. */
const ensureSession = async (
  browser: Browser,
  values: M1Env,
  pace: PaceClock,
): Promise<UiSession> => {
  if (shared.session !== undefined) return shared.session;
  const user = m1User(values, M1_TEMPLATE_EMAIL);
  pace.read(); // the sign-in screen
  pace.focus();
  pace.typed(user.email.length);
  pace.focus();
  pace.typed(user.password.length);
  pace.click(); // "Sign in with password"
  pace.read(); // the two-step screen
  pace.focus();
  pace.typed(6); // the code
  pace.click(); // "Verify" / "Verify and continue"
  shared.session = await signInThroughUi(browser, values.recruiterUrl, user, 'template recruiter');
  return shared.session;
};

/** From a signed-in page to a published test; returns the elapsed milliseconds and the breakdown is recorded. */
const publishFromTemplate = async (
  scenario: Scenario,
  fixtures: {
    browser: Browser;
    context: BrowserContext;
    page: Page;
    request: APIRequestContext;
  },
  testInfo: TestInfo,
): Promise<void> => {
  const { browser, context, page, request } = fixtures;
  const values = readM1Env();
  const pace = new PaceClock();
  pace.start();
  let published = false;
  // True when this run signed in (modelled and measured), false when it reused the first test's session.
  const signedInHere = shared.session === undefined;
  try {
    // ---- sign in, land on the home screen, go to Tests -------------------------------------------------------
    const session = await ensureSession(browser, values, pace);
    await seedSession(context, values.recruiterUrl, session);
    pace.read(); // "Signed in to ..." on the home screen
    pace.click(); // "Go to Tests" (the spec goes straight to /tests, as d1-slice.spec.ts does)
    await page.goto('/tests');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 2, name: 'Tests', exact: true })).toBeVisible({
      timeout: 30_000,
    });
    pace.read(); // the Tests screen

    const api: M1Api = m1Api(values, request, page);
    shared.bank ??= await pace.excluded(() =>
      seedBank(
        api,
        restClient(request, values.supabaseUrl, values.publishableKey),
        RUN,
        BANK_NEEDS,
      ),
    );
    const bank = shared.bank;

    // ---- step 1 of the wizard: job details and the template ----------------------------------------------------
    pace.click(); // "New test"
    await page.getByRole('link', { name: 'New test', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: 'New test', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: 'Or start from a role template', exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    pace.read(); // the New test screen

    pace.focus();
    pace.typed(scenario.jobTitle.length);
    await page.getByLabel('Job title', { exact: true }).fill(scenario.jobTitle);

    const radio = page.getByRole('radio', { name: scenario.radio, exact: true });
    if (scenario.jd === null) {
      pace.click(); // the template
      await radio.check();
    } else {
      pace.focus();
      pace.click(); // a job description is pasted, not typed: one keystroke chord
      await page.getByLabel('Job description (optional)', { exact: true }).fill(scenario.jd);
      pace.click(); // "Suggest a template"
      await page.getByRole('button', { name: 'Suggest a template', exact: true }).click();
      await expect(
        page.getByText(`Suggested from the job description: ${scenario.radio.split(' (')[0]}.`),
      ).toBeVisible({ timeout: 30_000 });
      pace.read(); // the suggestion
    }
    await expect(radio).toBeChecked();

    pace.click(); // "Create draft from template"
    await page.getByRole('button', { name: 'Create draft from template', exact: true }).click();
    await expect(page.getByText(`Draft created: ${scenario.jobTitle}.`)).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.getByRole('heading', { level: 3, name: 'Not in this draft yet', exact: true }),
    ).toBeVisible();
    for (const note of scenario.skipped) {
      await expect(page.getByText(note, { exact: true })).toBeVisible();
    }
    pace.read(); // the created screen and its note

    const href = await page
      .getByRole('link', { name: 'Open the draft', exact: true })
      .getAttribute('href');
    const testId = /^\/tests\/([0-9a-f-]{36})$/.exec(href ?? '')?.[1];
    if (testId === undefined) throw new Error('the created screen links to no test');

    // The placeholder bank goes into the new pools (see the header): not part of the time.
    const added = await pace.excluded(() => fillPools(api, testId, bank));

    // ---- steps 2 to 4 (modelled) and publish -------------------------------------------------------------------
    pace.click(); // "Open the draft"
    await page.getByRole('link', { name: 'Open the draft', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/tests/${testId}$`));
    await expect(
      page.getByRole('heading', { level: 2, name: scenario.jobTitle, exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    const steps = page.getByRole('list', { name: 'Steps', exact: true });
    await expect(steps).toBeVisible();
    for (const title of [
      '1. Job details',
      '2. Questions',
      '3. Integrity',
      '4. Review and publish',
    ]) {
      await expect(steps.getByRole('listitem').filter({ hasText: title })).toBeVisible();
    }
    for (const heading of [
      'Step 2: Questions',
      'Step 3: Integrity',
      'Step 4: Review and publish',
    ]) {
      await expect(
        page.getByRole('heading', { level: 3, name: heading, exact: true }),
      ).toBeVisible();
    }
    pace.read(WIZARD_SCREENS); // the three regions: Questions, Integrity, Review and publish
    // A deliberate over-count: the regions share one page, so a person scrolls rather than clicks. Kept so the budget
    // errs on the safe side.
    pace.click(WIZARD_SCREENS);

    pace.click(); // "Publish..."
    await page.getByRole('button', { name: 'Publish...', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Publish this test' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(FREEZE_COPY)).toBeVisible();
    pace.read(); // the freeze text
    pace.click(); // "Publish test"
    await dialog.getByRole('button', { name: 'Publish test', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 60_000 });
    await expect(page.getByText(/^Published, version 1\b/)).toBeVisible({ timeout: 30_000 });
    pace.read(); // the published screen
    published = true;

    // ---- what was published ------------------------------------------------------------------------------------
    const detail = await readDraft(api, testId);
    expect(detail.version.status).toBe('published');
    expect(detail.version.publishedAt).not.toBeNull();
    expect(detail.version.sections.map((s) => s.name)).toEqual([...scenario.sections]);
    expect(detail.version.sections.every((s) => s.mode === 'pool')).toBe(true);
    testInfo.annotations.push({ type: 'pool_items_added', description: String(added) });
  } finally {
    const facts = pace.breakdown();
    recordMeasurement(testInfo, scenario.file, {
      ...facts,
      limit_ms: LIMIT_MS,
      published,
      includes_sign_in: signedInHere,
      pace_model: 'budget-added: click 2000, focus 1000, typing 40 wpm, read 10000 per screen',
    });
  }
  expect(pace.elapsedMs()).toBeLessThanOrEqual(LIMIT_MS);
};

test.describe('a recruiter publishes from a role template (AT-M1-01, AT-M1-30)', () => {
  test('AT-M1-01: sign-in to a published Customer Support test within 300 s at human pace', async ({
    browser,
    context,
    page,
    request,
  }, testInfo) => {
    test.setTimeout(600_000);
    await publishFromTemplate(CUSTOMER_SUPPORT, { browser, context, page, request }, testInfo);
  });

  test('AT-M1-30: the BPO Voice template, found from a job description; its voice section is skipped with a note', async ({
    browser,
    context,
    page,
    request,
  }, testInfo) => {
    test.setTimeout(600_000);
    await publishFromTemplate(BPO_VOICE, { browser, context, page, request }, testInfo);
  });
});
