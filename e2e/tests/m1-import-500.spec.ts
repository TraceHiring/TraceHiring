// AT-M1-10 (exit gate, MEASURE; specs/m1-test-authoring.md §1.1, §6.9, §12, R2-19): a `trace-items-v1.xlsx` with 500 rows
// and an images .zip with 500 DISTINCT images of about 60 KB each are imported end to end through the recruiter UI, and
// the run asserts `elapsed_ms < 300000` and that 500 approved item versions exist. `elapsed_ms` is recorded as a test
// annotation and in `<output dir>/m1-at10.json` (numbers only), for the M1 summary.
//
// What is timed: real wall-clock time from the moment the two files are picked to the moment the screen says the import
// finished (check in the browser worker, images six at a time, rows 100 at a time, three batches at once, complete).
// No human pace here (this is a machine measurement). Not timed: building the files, signing in, opening the screen.
//
// The files are generated at run time by support/m1-fixtures.ts (node built-ins only) into this test's output dir, which
// Playwright clears and git ignores (`test-results/`); nothing generated is committed. Each image is a valid RGB PNG of
// seeded noise (141 x 141 px, about 59.9 KB, so far under the 1 MiB and 4096 px caps); the 500 SHA-256 values differ.
// The archive is about 30 MB (cap 100 MB uncompressed, 2,000 images, R2-19).
//
// Read back, as the signed-in recruiter (RLS applies): the import job (`completed`, 500 rows ok, 0 rows with an error,
// 500 images) and its 500 `item_versions` rows, all `approved` (an import is approved by the importer at import, Q23).
//
// Labels used (apps/recruiter/src):
//   shell/SignedIn.tsx:31          navigation "Main";  shell/nav.ts: nav link "Item bank"
//   bank/BankRoute.tsx:157         heading (2) "Item bank";  :163 link "Import items"
//   bank/import/ImportView.tsx:384 heading (2) "Import items"
//   bank/import/ImportView.tsx:152 field "Items file (.xlsx or .docx)";  :168 field "Images zip (optional, for .xlsx)"
//   bank/import/ImportView.tsx:190 button "Check file"
//   bank/import/ImportView.tsx:219-222 "Rows in the file: n", "Ready to import: n", "Rows with problems: n", "Images found: n"
//   bank/import/ImportView.tsx:248 button "Start import";  :301 status "All rows were sent.";  :303 "Rows accepted: n"
//   bank/import/ImportView.tsx:357 button "Finish import";  :310 status "Import finished.";  :312 "Questions imported: n"
//   bank/import/ImportView.tsx:335 alert (a failure)
//
// Skipped unless E2E_LOCAL=1 (scripts/e2e-local.mjs). Synthetic data only; nothing printed holds a secret.
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { buildImportFixture } from '../support/m1-fixtures.js';
import { recordMeasurement } from '../support/m1-pace.js';
import { M1_IMPORT_EMAIL, m1User, readM1Env } from '../support/m1-ui.js';
import { accessToken, restClient, seedSession, signInThroughUi } from '../support/recruiter-ui.js';

test.skip(process.env['E2E_LOCAL'] !== '1', 'set E2E_LOCAL=1 (scripts/e2e-local.mjs) to run');

/** AT-M1-10: 500 items with images in under five minutes. */
const LIMIT_MS = 300_000;
const ROWS = 500;
const IMAGE_CAP_BYTES = 1_048_576;
const IMAGE_CAP_SIDE = 4096;
/** Lower-case letters and digits: it goes into the stems. */
const RUN = randomBytes(4).toString('hex');

/** The shape of the import job as PostgREST returns it (supabase/migrations/20261023030000_m1_imports_drafts.sql:27-50). */
interface JobRow {
  id: string;
  status: string;
  rows_total: number;
  rows_ok: number;
  rows_error: number;
  images_ok: number;
}

test('AT-M1-10: 500 items with 500 distinct images import in under 300 s', async ({
  browser,
  context,
  page,
  request,
}, testInfo) => {
  // The assertion on elapsed_ms decides, not the timeout: ten minutes covers the slowest run worth reporting.
  test.setTimeout(900_000);
  const values = readM1Env();
  const user = m1User(values, M1_IMPORT_EMAIL);

  // ---- the files (not timed) --------------------------------------------------------------------------------------
  const fixture = buildImportFixture({ runTag: RUN, rows: ROWS, imageTargetBytes: 60_000 });
  expect(fixture.rows).toBe(ROWS);
  expect(new Set(fixture.imageSha256).size).toBe(ROWS);
  expect(fixture.imageBytes.max).toBeLessThanOrEqual(IMAGE_CAP_BYTES);
  expect(fixture.imageMaxSide).toBeLessThanOrEqual(IMAGE_CAP_SIDE);
  expect(fixture.imageBytes.min).toBeGreaterThanOrEqual(50_000);
  expect(fixture.imageBytes.max).toBeLessThanOrEqual(70_000);
  const dir = path.join(testInfo.outputDir, 'import-500');
  mkdirSync(dir, { recursive: true });
  const xlsxPath = path.join(dir, 'trace-items-v1.xlsx');
  const zipPath = path.join(dir, 'images.zip');
  writeFileSync(xlsxPath, fixture.xlsx);
  writeFileSync(zipPath, fixture.imagesZip);
  try {
    // ---- sign in and open the import screen (not timed) -------------------------------------------------------------
    const session = await signInThroughUi(browser, values.recruiterUrl, user, 'import recruiter');
    await seedSession(context, values.recruiterUrl, session);
    await page.goto('/tests');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav).toBeVisible({ timeout: 30_000 });
    await nav.getByRole('link', { name: 'Item bank', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Item bank', exact: true }),
    ).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('link', { name: 'Import items', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Import items', exact: true }),
    ).toBeVisible();

    // ---- the import (timed) -----------------------------------------------------------------------------------------
    const startedIso = new Date(Date.now() - 60_000).toISOString();
    const t0 = Date.now();
    let checkMs = 0;
    let runMs = 0;
    let finishMs = 0;
    let finished = false;
    try {
      await page.getByLabel('Items file (.xlsx or .docx)', { exact: true }).setInputFiles(xlsxPath);
      await page
        .getByLabel('Images zip (optional, for .xlsx)', { exact: true })
        .setInputFiles(zipPath);
      await page.getByRole('button', { name: 'Check file', exact: true }).click();
      const ready = page.getByText(`Ready to import: ${ROWS}`, { exact: true });
      const failure = page.getByRole('alert');
      await expect(ready.or(failure)).toBeVisible({ timeout: 540_000 });
      await expect(ready).toBeVisible({ timeout: 1_000 });
      checkMs = Date.now() - t0;
      await expect(page.getByText(`Rows in the file: ${ROWS}`, { exact: true })).toBeVisible();
      await expect(page.getByText('Rows with problems: 0', { exact: true })).toBeVisible();
      await expect(page.getByText(`Images found: ${ROWS}`, { exact: true })).toBeVisible();

      const tRun = Date.now();
      await page.getByRole('button', { name: 'Start import', exact: true }).click();
      const sent = page.getByText('All rows were sent.', { exact: true });
      await expect(sent.or(failure)).toBeVisible({ timeout: 540_000 });
      await expect(sent).toBeVisible({ timeout: 1_000 });
      runMs = Date.now() - tRun;
      await expect(page.getByText(`Rows accepted: ${ROWS}`, { exact: true })).toBeVisible();

      const tFinish = Date.now();
      await page.getByRole('button', { name: 'Finish import', exact: true }).click();
      const done = page.getByText('Import finished.', { exact: true });
      await expect(done.or(failure)).toBeVisible({ timeout: 120_000 });
      await expect(done).toBeVisible({ timeout: 1_000 });
      finishMs = Date.now() - tFinish;
      finished = true;
    } finally {
      const elapsed = Date.now() - t0;
      recordMeasurement(testInfo, 'm1-at10', {
        elapsed_ms: elapsed,
        check_ms: checkMs,
        send_ms: runMs,
        finish_ms: finishMs,
        limit_ms: LIMIT_MS,
        rows: ROWS,
        images: fixture.images,
        image_bytes_min: fixture.imageBytes.min,
        image_bytes_max: fixture.imageBytes.max,
        xlsx_bytes: fixture.xlsx.length,
        zip_bytes: fixture.imagesZip.length,
        finished,
      });
    }
    const elapsedMs = Date.now() - t0;
    await expect(page.getByText(`Questions imported: ${ROWS}`, { exact: true })).toBeVisible();

    // ---- read back what the database holds (RLS applies) ------------------------------------------------------------
    const rest = restClient(request, values.supabaseUrl, values.publishableKey);
    const jwt = await accessToken(page);
    const jobs = await rest.select<JobRow>(
      'import_jobs',
      `select=id,status,rows_total,rows_ok,rows_error,images_ok&rows_total=eq.${ROWS}` +
        `&created_at=gte.${encodeURIComponent(startedIso)}&order=created_at.desc&limit=5`,
      jwt,
    );
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    if (job === undefined) throw new Error('no import job');
    expect(job).toMatchObject({
      status: 'completed',
      rows_total: ROWS,
      rows_ok: ROWS,
      rows_error: 0,
      images_ok: ROWS,
    });
    const versions = await rest.select<{ status: string }>(
      'item_versions',
      `select=status&import_job_id=eq.${job.id}&limit=1000`,
      jwt,
    );
    expect(versions).toHaveLength(ROWS);
    expect(versions.every((v) => v.status === 'approved')).toBe(true);

    // ---- the gate ---------------------------------------------------------------------------------------------------
    expect(elapsedMs).toBeLessThan(LIMIT_MS);
  } finally {
    // The generated 30 MB are not kept (m1-at10.json is).
    rmSync(xlsxPath, { force: true });
    rmSync(zipPath, { force: true });
  }
});
