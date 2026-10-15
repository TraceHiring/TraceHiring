// Playwright config for the D1 end-to-end slice (specs/d1-demo-slice.md §7.2, D1-17).
// Wave 0 skeleton: Chromium only, a fake camera, video on. The `local` and `staging` projects, the
// permissions and the recording settings are added with the real spec (stream R5).
// Nothing here reads a secret; the base URL comes from the environment with a local default.
import { defineConfig, devices } from '@playwright/test';

/** Recruiter app origin: `E2E_RECRUITER_URL`, else the local `vite preview` default. */
const baseURL = process.env['E2E_RECRUITER_URL'] ?? 'http://localhost:4173';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  // One serial spec runs the whole slice (D1-17), so there is no file-level parallelism to configure.
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env['CI'] !== undefined,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]],
  use: {
    baseURL,
    video: 'on',
    // Traces record filled values and network bodies (passwords, TOTP codes, tokens), so they are off unless a
    // local run asks for them; a staging run never keeps or uploads one (d1 bindings security review F8).
    trace: process.env.E2E_TRACE === '1' ? 'retain-on-failure' : 'off',
    launchOptions: {
      // A synthetic camera feed, no permission prompt (candidate start photo, RT-9).
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
