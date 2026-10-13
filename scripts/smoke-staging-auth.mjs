#!/usr/bin/env node
// Staging sign-in smoke (specs/m0b-tenancy.md §1.3 row H9, §4.4, AT-B9): an org user can sign in.
//   node scripts/smoke-staging-auth.mjs        (no arguments)
// Environment (all required): SUPABASE_STAGING_URL (https://<20 lowercase letters or digits>.supabase.co),
//   SUPABASE_STAGING_PUBLISHABLE_KEY, STAGING_SMOKE_EMAIL, STAGING_SMOKE_PASSWORD,
//   STAGING_SMOKE_TOTP_SECRET (base32). These are the H9 recruiter's credentials in an empty org.
// Steps (each one request without redirects and with a timeout; the first failure stops the run):
//   1. GET  /auth/v1/settings                       sign-ups are disabled
//   2. POST /auth/v1/token?grant_type=password      password sign-in; exactly one verified TOTP factor
//   3. POST /auth/v1/factors/<id>/challenge + /verify   step up to aal2 (token claims checked)
//   4. GET  /rest/v1/memberships?...user_id=eq.<sub>, GET /rest/v1/orgs   exactly 1 row each, same org
//   5. POST /auth/v1/logout                         runs even when step 4 failed (finding B0-SEC4)
//   6. GET  the deployed recruiter page             its CSP connect-src names the Supabase origin
// Exit codes: 0 ok, 1 a check failed, 2 bad arguments or environment.
// Output: one line. Never a response body, token, email, password, TOTP secret or code, the
// publishable key, or a user or organisation id.
import { isEntryPoint } from './lib/cli.mjs';
import { totp } from './lib/totp.mjs';
import { APP_PROJECTS } from './smoke-staging.mjs';

const TAG = 'smoke-staging-auth';
const REQUEST_TIMEOUT_MS = 15_000;
const REQUIRED_ENV = [
  'SUPABASE_STAGING_URL',
  'SUPABASE_STAGING_PUBLISHABLE_KEY',
  'STAGING_SMOKE_EMAIL',
  'STAGING_SMOKE_PASSWORD',
  'STAGING_SMOKE_TOTP_SECRET',
];
const SUPABASE_URL_RE = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/;
const BASE32_RE = /^[A-Z2-7]{16,128}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const realDeps = () => ({
  env: process.env,
  fetch: globalThis.fetch,
  now: Date.now,
  stdout: process.stdout,
  stderr: process.stderr,
});

const line = (stream, text) => stream.write(`${text}\n`);

/**
 * One request. Never throws; never returns more than the status, the parsed JSON (when asked for)
 * and the response headers. `status` is null for a network error, a timeout or a redirect.
 */
async function request(deps, method, url, headers, { body, json = true } = {}) {
  try {
    const res = await deps.fetch(url, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    let data = null;
    if (json) {
      try {
        data = await res.json();
      } catch {
        // not JSON: treated as an empty body
      }
    } else {
      try {
        await res.body?.cancel();
      } catch {
        // nothing to release
      }
    }
    return { status: res.status, data, headers: res.headers };
  } catch {
    return { status: null, data: null, headers: null };
  }
}

/** The reason text of a failed step: the HTTP status, or a network error. */
const httpReason = (res) => (res.status === null ? 'network error' : `HTTP ${res.status}`);

/** Claims of a JWT payload (no signature check: the server issued it), or null. */
function jwtClaims(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return claims !== null && typeof claims === 'object' && !Array.isArray(claims) ? claims : null;
  } catch {
    return null;
  }
}

const nonEmptyString = (v) => typeof v === 'string' && v !== '';

/** Does the CSP's connect-src directive list `origin`? */
function connectSrcHas(csp, origin) {
  if (typeof csp !== 'string') return false;
  for (const directive of csp.split(';')) {
    const tokens = directive.trim().split(/\s+/);
    if (tokens[0]?.toLowerCase() === 'connect-src') return tokens.slice(1).includes(origin);
  }
  return false;
}

/** Validates the environment. Returns { ok: true, cfg } or { ok: false, message }. */
function readEnv(env) {
  const value = (name) => (env[name] ?? '').trim();
  const missing = REQUIRED_ENV.filter((name) => value(name) === '');
  if (missing.length > 0) {
    return { ok: false, message: `missing environment variable(s): ${missing.join(', ')}` };
  }
  const match = SUPABASE_URL_RE.exec(value('SUPABASE_STAGING_URL'));
  if (!match) {
    return {
      ok: false,
      message: 'SUPABASE_STAGING_URL must be https://<20-character project ref>.supabase.co',
    };
  }
  const secret = value('STAGING_SMOKE_TOTP_SECRET');
  if (!BASE32_RE.test(secret)) {
    return { ok: false, message: 'STAGING_SMOKE_TOTP_SECRET must be a base32 secret' };
  }
  return {
    ok: true,
    cfg: {
      origin: `https://${match[1]}.supabase.co`,
      key: value('SUPABASE_STAGING_PUBLISHABLE_KEY'),
      email: value('STAGING_SMOKE_EMAIL'),
      // A password is used exactly as stored.
      password: env.STAGING_SMOKE_PASSWORD,
      secret,
    },
  };
}

/**
 * Runs the six steps. Returns { failed: <step label> | null, reason, checks, logoutFailure }.
 * `reason` is `HTTP <status>`, `network error` or `unexpected response`.
 */
async function runChecks(deps, cfg) {
  let checks = 0;
  const fail = (step, reason) => ({ failed: step, reason, checks, logoutFailure: null });
  const url = (path) => `${cfg.origin}${path}`;
  const anon = { apikey: cfg.key };
  const bearer = (token) => ({ apikey: cfg.key, Authorization: `Bearer ${token}` });

  // 1. Sign-ups are disabled.
  const settings = await request(deps, 'GET', url('/auth/v1/settings'), anon);
  if (settings.status !== 200) return fail('auth settings', httpReason(settings));
  if (settings.data?.disable_signup !== true) return fail('auth settings', 'unexpected response');
  checks += 1;

  // 2. Password sign-in.
  const signIn = await request(deps, 'POST', url('/auth/v1/token?grant_type=password'), anon, {
    body: { email: cfg.email, password: cfg.password },
  });
  if (signIn.status !== 200) return fail('sign-in', httpReason(signIn));
  const aal1Token = signIn.data?.access_token;
  const userId = signIn.data?.user?.id;
  if (!nonEmptyString(aal1Token) || typeof userId !== 'string' || !UUID_RE.test(userId)) {
    return fail('sign-in', 'unexpected response');
  }
  checks += 1;

  const factors = Array.isArray(signIn.data.user.factors) ? signIn.data.user.factors : [];
  const verified = factors.filter(
    (f) => f?.factor_type === 'totp' && f?.status === 'verified' && typeof f?.id === 'string',
  );
  if (verified.length !== 1 || !UUID_RE.test(verified[0].id)) {
    return fail('TOTP factor', 'unexpected response');
  }
  const factorId = verified[0].id;
  checks += 1;

  // 3. Step up to aal2.
  const challenge = await request(
    deps,
    'POST',
    url(`/auth/v1/factors/${factorId}/challenge`),
    bearer(aal1Token),
    { body: {} },
  );
  if (challenge.status !== 200) return fail('TOTP challenge', httpReason(challenge));
  const challengeId = challenge.data?.id;
  if (!nonEmptyString(challengeId)) return fail('TOTP challenge', 'unexpected response');
  checks += 1;

  const code = await totp({ secret: cfg.secret, timeMs: deps.now() });
  const verify = await request(
    deps,
    'POST',
    url(`/auth/v1/factors/${factorId}/verify`),
    bearer(aal1Token),
    { body: { challenge_id: challengeId, code } },
  );
  if (verify.status !== 200) return fail('TOTP verification', httpReason(verify));
  const aal2Token = verify.data?.access_token;
  const claims = jwtClaims(aal2Token);
  if (
    claims === null ||
    claims.aal !== 'aal2' ||
    String(claims.sub).toLowerCase() !== userId.toLowerCase()
  ) {
    return fail('TOTP verification', 'unexpected response');
  }
  checks += 1;

  // 4. The user's own membership and organisation, read with the aal2 token. A failure here is
  //    held until the session is signed out (step 5).
  const rest = { ...bearer(aal2Token), Accept: 'application/json' };
  let problem = null;
  let orgId = null;
  const memberships = await request(
    deps,
    'GET',
    url(`/rest/v1/memberships?select=id,org_id&user_id=eq.${claims.sub}`),
    rest,
  );
  if (memberships.status !== 200)
    problem = { step: 'memberships', reason: httpReason(memberships) };
  else if (
    !Array.isArray(memberships.data) ||
    memberships.data.length !== 1 ||
    !nonEmptyString(memberships.data[0]?.org_id)
  ) {
    problem = { step: 'memberships', reason: 'unexpected response' };
  } else {
    orgId = memberships.data[0].org_id;
    checks += 1;
    const orgs = await request(deps, 'GET', url('/rest/v1/orgs?select=id'), rest);
    if (orgs.status !== 200) problem = { step: 'orgs', reason: httpReason(orgs) };
    else if (!Array.isArray(orgs.data) || orgs.data.length !== 1 || orgs.data[0]?.id !== orgId) {
      problem = { step: 'orgs', reason: 'unexpected response' };
    } else checks += 1;
  }

  // 5. Sign out, whatever step 4 found.
  const logout = await request(deps, 'POST', url('/auth/v1/logout'), bearer(aal2Token), {
    json: false,
  });
  const logoutOk = logout.status !== null && logout.status >= 200 && logout.status < 300;
  if (problem !== null) {
    return {
      failed: problem.step,
      reason: problem.reason,
      checks,
      logoutFailure: logoutOk ? null : httpReason(logout),
    };
  }
  if (!logoutOk) return fail('sign-out', httpReason(logout));
  checks += 1;

  // 6. The deployed recruiter page lets the browser reach this Supabase project.
  const page = await request(
    deps,
    'GET',
    `https://${APP_PROJECTS.recruiter}.pages.dev/`,
    { Accept: 'text/html' },
    { json: false },
  );
  if (page.status !== 200) return fail('recruiter page', httpReason(page));
  if (!connectSrcHas(page.headers?.get?.('content-security-policy'), cfg.origin)) {
    return fail('recruiter page', 'unexpected response');
  }
  checks += 1;

  return { failed: null, reason: null, checks, logoutFailure: null };
}

/** Returns the exit code: 0 ok, 1 a check failed, 2 bad arguments or environment. */
export async function main({ argv = [], deps = {} } = {}) {
  const d = { ...realDeps(), ...deps };
  if (argv.length > 0) {
    line(d.stderr, `${TAG}: takes no arguments`);
    return 2;
  }
  const env = readEnv(d.env ?? {});
  if (!env.ok) {
    line(d.stderr, `${TAG}: ${env.message}`);
    return 2;
  }
  const result = await runChecks(d, env.cfg);
  if (result.failed !== null) {
    line(d.stderr, `${TAG}: ${result.failed} failed (${result.reason})`);
    if (result.logoutFailure !== null) {
      line(d.stderr, `${TAG}: sign-out failed (${result.logoutFailure})`);
    }
    return 1;
  }
  line(d.stdout, `${TAG}: OK (${result.checks} checks)`);
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await main({ argv: process.argv.slice(2) });
}
