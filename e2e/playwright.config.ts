// Playwright config for the D1 end-to-end slice (specs/d1-demo-slice.md §7.2, §7.3, D1-17). Chromium only, a fake
// camera. Two projects:
//  - `local` (E2E_LOCAL=1, scripts/e2e-local.mjs): every spec, exactly as before the slice existed;
//  - `staging` (E2E_STAGING=1): tests/d1-slice.spec.ts only, with no trace ever kept (no secret in an artifact).
// Record mode (E2E_RECORD=1, §7.3): headed, `slowMo` 250, 1280x720, video on; the slice adds captions and pauses.
// Nothing here reads a secret; the base URL comes from the environment with a local default.
import { defineConfig, devices, type PlaywrightTestProject } from '@playwright/test';

/** Recruiter app origin: `E2E_RECRUITER_URL`, else the local `vite preview` port pinned in apps/recruiter (F9). */
const baseURL = process.env['E2E_RECRUITER_URL'] ?? 'http://localhost:5174';
const STAGING = process.env['E2E_STAGING'] === '1';
const RECORD = process.env['E2E_RECORD'] === '1';
if (STAGING && process.env['E2E_LOCAL'] === '1') {
  throw new Error('set E2E_LOCAL=1 or E2E_STAGING=1, not both');
}
const VIEWPORT = { width: 1280, height: 720 };
if (STAGING) {
  // SEC-W5-1: Playwright 1.63 writes an aria snapshot of the first open page into error-context.md when a test
  // fails (ArtifactsRecorder._takePageSnapshot, on context close and at test end); the snapshot holds input values.
  // This variable is the only switch for that path. Set here, before any worker starts, so CI needs no extra env.
  // A failed locator assertion carries its own snapshot regardless: the slice's sign-in rethrows every failure as a
  // fresh constant error, so that snapshot never reaches a report (support/recruiter-ui.ts).
  process.env['PLAYWRIGHT_NO_COPY_PROMPT'] = '1';
}

const local: PlaywrightTestProject = {
  name: 'local',
  use: {
    ...devices['Desktop Chrome'],
    // Traces record filled values and network bodies (passwords, TOTP codes, tokens), so they are off unless a
    // local run asks for them (d1 bindings security review F8).
    trace: process.env['E2E_TRACE'] === '1' ? 'retain-on-failure' : 'off',
  },
};

const staging: PlaywrightTestProject = {
  name: 'staging',
  testMatch: /d1-slice\.spec\.ts$/,
  use: {
    ...devices['Desktop Chrome'],
    // A staging run never keeps or uploads a trace, whatever E2E_TRACE says.
    trace: 'off',
    permissions: ['camera', 'clipboard-read', 'clipboard-write'],
    // SEC-W5-1: a stuck action or navigation throws within 20 s, so the sign-in helper's `finally` closes its
    // context long before the test timeout (an explicit assertion timeout in the spec still wins).
    actionTimeout: 20_000,
    navigationTimeout: 20_000,
  },
};

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
    video: RECORD ? { mode: 'on', size: VIEWPORT } : 'on',
    viewport: VIEWPORT,
    headless: !RECORD,
    launchOptions: {
      // A synthetic camera feed, no permission prompt (candidate start photo, RT-9).
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
      ...(RECORD ? { slowMo: 250 } : {}),
    },
  },
  projects: [STAGING ? staging : local],
});
