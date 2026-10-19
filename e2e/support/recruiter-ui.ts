// The recruiter app's sign-in, driven through its own screens (apps/recruiter/src/auth/AuthPanel.tsx; m0b §4.2,
// §4.6): password, then TOTP. A user without a factor gets the enrolment screen (local: the key shown there is read
// from the page and used for the code); an enrolled user gets the challenge (staging: the secret comes from the
// environment). The sign-in runs in its own browser context with no video and no trace, so the email typed and the
// code never reach an artifact; the session (sessionStorage, spec m0b §2.7) is then copied into the recorded context
// before the app's scripts run. Passwords, codes, secrets and tokens stay in memory; nothing here prints one.
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { claimsOf } from './auth.js';
import { jsonOf, sleep } from './http.js';
import type { UiUser } from './slice-env.js';
import { totp } from './totp.js';

/** The supabase-js session key in sessionStorage (`sb-<host label>-auth-token`). */
const SESSION_KEY = /^sb-[A-Za-z0-9-]+-auth-token$/;

export interface UiSession {
  /** Every sessionStorage entry of the recruiter origin after sign-in (memory only). */
  storage: Record<string, string>;
  /** The aal2 access token at sign-in time. */
  jwt: string;
  /** The JWT subject (the user id). */
  userId: string;
}

const readStorage = (page: Page): Promise<Record<string, string>> =>
  page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key !== null) out[key] = sessionStorage.getItem(key) ?? '';
    }
    return out;
  });

const tokenIn = (storage: Record<string, string>): string | null => {
  for (const [key, value] of Object.entries(storage)) {
    if (!SESSION_KEY.test(key)) continue;
    try {
      const parsed = JSON.parse(value) as { access_token?: unknown };
      if (typeof parsed.access_token === 'string') return parsed.access_token;
    } catch {
      // not the session entry
    }
  }
  return null;
};

/** The current access token of a signed-in recruiter page (re-read, so a refreshed token is used). */
export const accessToken = async (page: Page): Promise<string> => {
  const token = tokenIn(await readStorage(page));
  if (token === null) throw new Error('the recruiter page holds no session');
  return token;
};

/**
 * Signs `user` in through the app in a fresh context without video or trace, and returns the session. Fails when
 * the user sees the org picker (the slice needs a user in exactly one org) or no org at all.
 */
export const signInThroughUi = async (
  browser: Browser,
  recruiterUrl: string,
  user: UiUser,
): Promise<UiSession> => {
  const context = await browser.newContext({ baseURL: recruiterUrl });
  try {
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    await page.locator('input[autocomplete="username"]').fill(user.email);
    await page.locator('input[name="password"]').fill(user.password);
    await page.getByRole('button', { name: 'Sign in with password', exact: true }).click();

    const enrol = page.getByRole('heading', { name: 'Set up two-step sign-in', exact: true });
    const challenge = page.getByRole('heading', { name: 'Two-step sign-in', exact: true });
    await expect(enrol.or(challenge)).toBeVisible({ timeout: 20_000 });
    let secret: string;
    let codeLabel: string;
    let submit: string;
    if (await enrol.isVisible()) {
      if (user.totpSecret !== null) {
        throw new Error('the user has no TOTP factor yet; enrol it before a staging run');
      }
      secret = ((await page.locator('p', { hasText: 'Key:' }).locator('code').textContent()) ?? '')
        .replace(/\s/g, '')
        .trim();
      if (!/^[A-Z2-7]+=*$/i.test(secret)) throw new Error('the enrolment screen shows no key');
      codeLabel = '6-digit code from the app';
      submit = 'Verify and continue';
    } else {
      if (user.totpSecret === null) {
        throw new Error('the user is already enrolled; this run has no TOTP secret for it');
      }
      secret = user.totpSecret;
      codeLabel = '6-digit code from your authenticator app';
      submit = 'Verify';
    }
    const signedIn = page.getByText(/^Signed in to /);
    const picker = page.getByRole('heading', { name: 'Choose an organisation', exact: true });
    // One retry in the next 30-second window: a code typed at the very end of its window can expire in flight.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.getByLabel(codeLabel, { exact: true }).fill(totp(secret));
      await page.getByRole('button', { name: submit, exact: true }).click();
      try {
        await expect(signedIn.or(picker)).toBeVisible({ timeout: 15_000 });
        break;
      } catch (e) {
        if (attempt === 1) throw new Error('the TOTP step did not sign in');
        void e;
        await sleep(30_000 - (Date.now() % 30_000) + 500);
      }
    }
    if (await picker.isVisible()) {
      throw new Error('the user belongs to several organisations; the slice needs exactly one');
    }
    const storage = await readStorage(page);
    const jwt = tokenIn(storage);
    if (jwt === null) throw new Error('no session after sign-in');
    const claims = claimsOf(jwt);
    if (claims.aal !== 'aal2') throw new Error('the session is not aal2');
    if (typeof claims.sub !== 'string') throw new Error('the session has no subject');
    return { storage, jwt, userId: claims.sub };
  } finally {
    await context.close();
  }
};

/**
 * Seeds a signed-in session into `context` for the recruiter origin before any app script runs (only when the tab
 * has no entry yet, so a token the app refreshed later is kept across reloads).
 */
export const seedSession = async (
  context: BrowserContext,
  recruiterUrl: string,
  session: UiSession,
): Promise<void> => {
  await context.addInitScript(
    ({ origin, entries }) => {
      if (location.origin !== origin) return;
      for (const [key, value] of Object.entries(entries)) {
        if (sessionStorage.getItem(key) === null) sessionStorage.setItem(key, value);
      }
    },
    { origin: new URL(recruiterUrl).origin, entries: session.storage },
  );
};

// ---- PostgREST as the signed-in user (RLS applies; the staging form of every database check) --------------------

export interface Rest {
  select<T>(table: string, query: string, jwt: string): Promise<T[]>;
}

export const restClient = (
  request: APIRequestContext,
  supabaseUrl: string,
  publishableKey: string,
): Rest => ({
  select: async <T>(table: string, query: string, jwt: string): Promise<T[]> =>
    jsonOf<T[]>(
      await request.get(`${supabaseUrl}/rest/v1/${table}?${query}`, {
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${jwt}`,
          Accept: 'application/json',
        },
      }),
      200,
      `selecting from ${table}`,
    ),
});

export interface MembershipRow {
  id: string;
  org_id: string;
  roles: string[];
  status: string;
}

/** The user's own active memberships (readable at any aal, m0b §2.2). */
export const ownMemberships = (rest: Rest, jwt: string, userId: string) =>
  rest.select<MembershipRow>(
    'memberships',
    `select=id,org_id,roles,status&user_id=eq.${encodeURIComponent(userId)}&status=eq.active`,
    jwt,
  );
