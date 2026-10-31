// The environment and the recruiter-app plumbing of the M1 specs (local stack only, scripts/e2e-local.mjs). A missing
// value fails with the variable's NAME, never its value (support/http.ts `env`). The specs sign users in through the
// app's own screens (support/recruiter-ui.ts `signInThroughUi`: password, then TOTP enrolment) in a context with no
// video and no trace, then copy the session into the test's recorded context (`seedSession`).
import type { APIRequestContext, Page } from '@playwright/test';
import { env, requireLocalHosts } from './http.js';
import type { M1Api } from './m1-api.js';
import { accessToken } from './recruiter-ui.js';
import type { UiUser } from './slice-env.js';

/** The seed users of the M1 specs (a lead ask: scripts/e2e-local.mjs USERS), one per spec file: GoTrue enrols a TOTP factor once per user. */
export const M1_TEMPLATE_EMAIL = 'E2E_M1_TEMPLATE_EMAIL';
export const M1_IMPORT_EMAIL = 'E2E_M1_IMPORT_EMAIL';

export interface M1Env {
  recruiterUrl: string;
  api: string;
  supabaseUrl: string;
  publishableKey: string;
  orgId: string;
  password: string;
}

/** Reads the values scripts/e2e-local.mjs sets, and refuses anything but a local stack (security review SEC-E4). */
export const readM1Env = (): M1Env => {
  const recruiterUrl = env('E2E_RECRUITER_URL');
  const api = env('E2E_API_URL');
  const supabaseUrl = env('E2E_SUPABASE_URL');
  requireLocalHosts({
    E2E_RECRUITER_URL: recruiterUrl,
    E2E_API_URL: api,
    E2E_SUPABASE_URL: supabaseUrl,
  });
  return {
    recruiterUrl,
    api,
    supabaseUrl,
    publishableKey: env('E2E_SUPABASE_PUBLISHABLE_KEY'),
    orgId: env('E2E_ORG_ID'),
    password: env('E2E_USER_PASSWORD'),
  };
};

/** A local user that still has to enrol its TOTP factor through the app's own screen. */
export const m1User = (values: M1Env, emailVariable: string): UiUser => ({
  email: env(emailVariable),
  password: values.password,
  totpSecret: null,
});

/** The api and database reads for the signed-in recruiter page (the token is re-read from the page on every call). */
export const m1Api = (values: M1Env, request: APIRequestContext, page: Page): M1Api => ({
  request,
  api: values.api,
  orgId: values.orgId,
  supabaseUrl: values.supabaseUrl,
  publishableKey: values.publishableKey,
  jwt: () => accessToken(page),
});
