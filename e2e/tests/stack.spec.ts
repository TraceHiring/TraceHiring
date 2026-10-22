// DC-D9 (specs/d1-demo-slice.md §8): the local E2E stack is up. scripts/e2e-local.mjs starts
// Supabase, api (8788) and edge with jobs (8787) under wrangler dev, and both apps under vite
// preview; this spec checks what each serves before the D1 slice spec (stream R5) uses them.
// Skipped unless E2E_LOCAL=1.
import { expect, test } from '@playwright/test';

const url = (name: string, fallback: string): string => process.env[name] ?? fallback;
const EDGE = url('E2E_EDGE_URL', 'http://127.0.0.1:8787');
const API = url('E2E_API_URL', 'http://127.0.0.1:8788');
const CANDIDATE = url('E2E_CANDIDATE_URL', 'http://localhost:5173');
const RECRUITER = url('E2E_RECRUITER_URL', 'http://localhost:5174');

test.skip(process.env['E2E_LOCAL'] !== '1', 'set E2E_LOCAL=1 (scripts/e2e-local.mjs) to run');

test.describe('the local stack (DC-D9)', () => {
  for (const [service, origin] of [
    ['edge', EDGE],
    ['api', API],
  ] as const) {
    test(`${service} answers /health`, async ({ request }) => {
      const res = await request.get(`${origin}/health`);
      expect(res.status()).toBe(200);
      expect(await res.json()).toMatchObject({ status: 'ok', service });
    });
  }

  for (const [app, origin] of [
    ['candidate', CANDIDATE],
    ['recruiter', RECRUITER],
  ] as const) {
    test(`the ${app} app is served by vite preview`, async ({ request, page }) => {
      const version = await request.get(`${origin}/version.json`);
      expect(version.status()).toBe(200);
      expect(await version.json()).toMatchObject({ app });
      const res = await page.goto(origin);
      expect(res?.status()).toBe(200);
      await expect(page.locator('#root')).toBeAttached();
    });
  }
});
