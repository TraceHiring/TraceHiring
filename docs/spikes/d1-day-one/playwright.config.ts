import { defineConfig } from '@playwright/test';
import { FAKE_MEDIA_ARGS, OUT_DIR } from './browser/support/env.ts';
import path from 'node:path';

// DC-D5 part (c) and DC-D6 (Windows half). Two Chromium flavours are run on purpose:
// - chromium-headless-shell: what `headless: true` launches by default in Playwright 1.63 (the CI default)
// - chromium-new-headless: the full Chromium binary (`channel: 'chromium'`), same code as headed
export default defineConfig({
  testDir: './browser/tests',
  outputDir: path.join(OUT_DIR, 'pw-results'),
  globalSetup: './browser/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['list'], ['json', { outputFile: path.join(OUT_DIR, 'playwright-report.json') }]],
  use: {
    video: 'on',
    trace: 'off',
    permissions: ['camera', 'clipboard-read', 'clipboard-write'],
    launchOptions: { args: FAKE_MEDIA_ARGS },
  },
  projects: [
    { name: 'chromium-headless-shell', use: {} },
    { name: 'chromium-new-headless', use: { channel: 'chromium' } },
  ],
});
