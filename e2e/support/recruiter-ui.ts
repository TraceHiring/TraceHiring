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
  type Locator,
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

/**
 * Puts `value` into an input without `fill`: Playwright names a `fill` step after the text typed, so the HTML report
 * (a CI artifact) would hold the email, the password or the code. The sign-in forms are uncontrolled (AuthPanel reads
 * them with FormData on submit), so setting `value` is what typing leaves behind. The value is an evaluate argument,
 * which no step title shows.
 */
const setValue = async (field: Locator, value: string): Promise<void> => {
  await field.waitFor({ state: 'visible' });
  await field.evaluate((el, v) => {
    if (!(el instanceof HTMLInputElement)) throw new Error('not an input');
    el.focus();
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
};

/** The current access token of a signed-in recruiter page (re-read, so a refreshed token is used). */
export const accessToken = async (page: Page): Promise<string> => {
  // A read during a navigation can lose its execution context; try again on the next document.
  for (let attempt = 0; ; attempt += 1) {
    try {
      const token = tokenIn(await readStorage(page));
      if (token !== null) return token;
    } catch {
      // retried below
    }
    if (attempt >= 4) throw new Error('the recruiter page holds no session');
    await sleep(500);
  }
};

/** A sign-in failure whose message is a constant naming the role and the stage (never a value or a page). */
class SignInError extends Error {}

/** Empties every input of the page (after a submit has read the form), so no later snapshot can show a value. */
const clearInputs = (page: Page): Promise<void> =>
  page
    .evaluate(() => {
      for (const el of Array.from(document.querySelectorAll('input'))) el.value = '';
    })
    .catch(() => undefined);

/**
 * Signs `user` in through the app in a fresh context without video or trace, and returns the session. Fails when
 * the user sees the org picker (the slice needs a user in exactly one org) or no org at all.
 *
 * SEC-W5-1: a failed locator assertion carries an aria snapshot of the page, input values included, into the
 * report's error-context.md, whatever PLAYWRIGHT_NO_COPY_PROMPT says. So every failure in here is rethrown as a
 * fresh SignInError (no matcher result, no snapshot) that names `role` and the stage only; the inputs are cleared
 * right after each submit; and the context is closed in `finally` (the staging project's 20 s action and
 * navigation timeouts make a stuck call reach it).
 */
export const signInThroughUi = async (
  browser: Browser,
  recruiterUrl: string,
  user: UiUser,
  role: string,
): Promise<UiSession> => {
  const context = await browser.newContext({ baseURL: recruiterUrl });
  let stage = 'opening the app';
  const fail = (why: string) => new SignInError(`${role} sign-in: ${why}`);
  try {
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
    stage = 'password';
    await setValue(page.locator('input[autocomplete="username"]'), user.email);
    await setValue(page.locator('input[name="password"]'), user.password);
    await page.getByRole('button', { name: 'Sign in with password', exact: true }).click();
    await clearInputs(page);

    stage = 'reaching the TOTP screen';
    const enrol = page.getByRole('heading', { name: 'Set up two-step sign-in', exact: true });
    const challenge = page.getByRole('heading', { name: 'Two-step sign-in', exact: true });
    await expect(enrol.or(challenge)).toBeVisible({ timeout: 20_000 });
    let secret: string;
    let codeLabel: string;
    let submit: string;
    if (await enrol.isVisible()) {
      if (user.totpSecret !== null) throw fail('no TOTP factor yet; enrol it before a staging run');
      secret = ((await page.locator('p', { hasText: 'Key:' }).locator('code').textContent()) ?? '')
        .replace(/\s/g, '')
        .trim();
      if (!/^[A-Z2-7]+=*$/i.test(secret)) throw fail('the enrolment screen shows no key');
      codeLabel = '6-digit code from the app';
      submit = 'Verify and continue';
    } else {
      if (user.totpSecret === null) throw fail('already enrolled, and this run has no TOTP secret');
      secret = user.totpSecret;
      codeLabel = '6-digit code from your authenticator app';
      submit = 'Verify';
    }
    stage = 'TOTP code';
    const signedIn = page.getByText(/^Signed in to /);
    const picker = page.getByRole('heading', { name: 'Choose an organisation', exact: true });
    // One retry in the next 30-second window: a code typed at the very end of its window can expire in flight.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await setValue(page.getByLabel(codeLabel, { exact: true }), totp(secret));
      await page.getByRole('button', { name: submit, exact: true }).click();
      await clearInputs(page);
      try {
        await expect(signedIn.or(picker)).toBeVisible({ timeout: 15_000 });
        break;
      } catch {
        if (attempt === 1) throw fail('the TOTP step did not sign in');
        await sleep(30_000 - (Date.now() % 30_000) + 500);
      }
    }
    stage = 'reading the session';
    if (await picker.isVisible()) throw fail('several organisations; the slice needs exactly one');
    const storage = await readStorage(page);
    const jwt = tokenIn(storage);
    if (jwt === null) throw fail('no session after sign-in');
    const claims = claimsOf(jwt);
    if (claims.aal !== 'aal2') throw fail('the session is not aal2');
    if (typeof claims.sub !== 'string') throw fail('the session has no subject');
    return { storage, jwt, userId: claims.sub };
  } catch (e) {
    if (e instanceof SignInError) throw e;
    throw fail(`failed at ${stage}`);
  } finally {
    await context.close().catch(() => undefined);
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
