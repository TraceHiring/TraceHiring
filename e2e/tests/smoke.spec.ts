// Wave 0 smoke spec: proves the Playwright package is wired. It is skipped unless E2E_SMOKE=1, so neither
// `pnpm verify` nor CI needs a browser. The D1 slice spec (tests/d1-slice.spec.ts) replaces it in stream R5.
import { expect, test } from '@playwright/test';

test.skip(
  process.env['E2E_SMOKE'] !== '1',
  'set E2E_SMOKE=1 to run (needs `playwright install chromium`)',
);

test('the browser starts and renders a page', async ({ page }) => {
  await page.setContent('<main><h1>Trace e2e</h1></main>');
  await expect(page.getByRole('heading', { name: 'Trace e2e' })).toBeVisible();
});
