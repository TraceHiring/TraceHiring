#!/usr/bin/env node
// Operator script: smoke users (specs/m0b-tenancy.md §4.4, H9, R4, R7).
//   SMOKE_PASSWORD=... node scripts/ops/enrol-smoke-user.mjs --env local --email <e>
//   SMOKE_PASSWORD=... SUPABASE_STAGING_URL=... SUPABASE_STAGING_PUBLISHABLE_KEY=... \
//     TRACE_OPERATOR_DB_URL=... node scripts/ops/enrol-smoke-user.mjs --env staging \
//       --email <smoke> --owner-email <owner> [--roles recruiter|reviewer]
// Arguments are validated with EnrolSmokeUserArgs; the password comes only from SMOKE_PASSWORD.
// `--roles` (staging only; default recruiter) is exactly one of ROLES.
//   local:   creates one confirmed user through the local Auth admin endpoint with the local stack's
//            demo key (read from `supabase status -o env` at run time, never written anywhere).
//            Refused (exit 2, before any request) unless the Auth URL host is exactly 127.0.0.1.
//            Prints only the new user id.
//   staging: both users already exist (H9 step 1). Resolves their ids through the operator DB, signs
//            in as the smoke user over the public Auth API (publishable key), enrols and verifies
//            TOTP, prints the TOTP secret (the only output, once), then creates the smoke-staging org
//            owned by the owner and adds the smoke user as a recruiter. No service-role key.
//            With `--roles reviewer` (d1 §11 founder gate, the D1 reviewer smoke user): the org must
//            already exist (the recruiter run made it). It resolves the smoke-staging org the owner
//            owns before anything changes, enrols TOTP the same way, prints the secret, and adds the
//            user to that org as a reviewer only; it never creates an org.
// Failures print a fixed message and an HTTP status or SQLSTATE; no response body, URL or value.
import { EnrolSmokeUserArgs, Password } from '../../packages/shared/src/contracts-tenancy.ts';
import { isEntryPoint } from '../lib/cli.mjs';
import { totp } from '../lib/totp.mjs';
import {
  addMember,
  createOrg,
  describeFailure,
  isUuid,
  line,
  localStackEnv,
  lookupUserId,
  parseFlags,
  realDeps,
  runSql,
  validate,
} from './lib.mjs';

const TAG = 'enrol-smoke-user';
const OPTIONS = {
  env: { type: 'string' },
  email: { type: 'string' },
  'owner-email': { type: 'string' },
  roles: { type: 'string' },
};
/** The one role each smoke user gets, and its membership display name (least privilege, m0b R4). */
export const ROLES = Object.freeze({ recruiter: 'Smoke recruiter', reviewer: 'Smoke reviewer' });
const SMOKE_ORG_SLUG = 'smoke-staging';
// The smoke org the owner owns (an active org_owner membership); values only as psql -v variables.
const LOOKUP_SMOKE_ORG_SQL = `select o.id from public.orgs o join public.memberships m on m.org_id = o.id where o.slug = :'p_slug' and m.user_id = :'p_owner'::uuid and m.status = 'active' and 'org_owner' = any(m.roles);\n`;
const BASE32 = /^[A-Z2-7]{16,128}$/;
const REQUEST_TIMEOUT_MS = 15_000;

/** The one host the demo service key may be sent to. */
export function isLocalAuthUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return (
    (u.protocol === 'http:' || u.protocol === 'https:') &&
    u.hostname === '127.0.0.1' &&
    u.username === '' &&
    u.password === ''
  );
}

/** One JSON POST. Never throws and never returns a body unparsed. */
async function post(deps, url, headers, body) {
  try {
    const res = await deps.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      // not JSON: treated as an empty body
    }
    return { ok: res.ok === true, status: res.status, data };
  } catch {
    return { ok: false, status: null, data: null };
  }
}

const httpFailure = (step, res) =>
  `${step} failed (${res.status === null ? 'network error' : `HTTP ${res.status}`})`;

async function enrolLocal({ args, password, deps }) {
  const stack = localStackEnv(deps);
  if (!stack) {
    line(deps.stderr, `${TAG}: the local stack is not running (pnpm exec supabase start)`);
    return 1;
  }
  if (!isLocalAuthUrl(stack.API_URL ?? '')) {
    line(deps.stderr, `${TAG}: refused: the Auth URL host is not 127.0.0.1`);
    return 2;
  }
  const key = stack.SERVICE_ROLE_KEY || stack.SECRET_KEY;
  if (!key) {
    line(deps.stderr, `${TAG}: the local stack printed no service key`);
    return 1;
  }
  const url = new URL('/auth/v1/admin/users', stack.API_URL).toString();
  const res = await post(
    deps,
    url,
    { apikey: key, Authorization: `Bearer ${key}` },
    {
      email: args.email,
      password,
      email_confirm: true,
    },
  );
  if (!res.ok) {
    line(deps.stderr, `${TAG}: ${httpFailure('creating the user', res)}`);
    return 1;
  }
  const id = res.data?.id;
  if (typeof id !== 'string' || !isUuid(id)) {
    line(deps.stderr, `${TAG}: creating the user returned an unexpected response`);
    return 1;
  }
  line(deps.stdout, id.toLowerCase());
  return 0;
}

async function enrolStaging({ args, password, role, deps }) {
  const env = deps.env;
  const missing = [
    'SUPABASE_STAGING_URL',
    'SUPABASE_STAGING_PUBLISHABLE_KEY',
    'TRACE_OPERATOR_DB_URL',
  ].filter((name) => !(env[name] ?? '').trim());
  if (missing.length > 0) {
    line(deps.stderr, `${TAG}: missing environment variable(s): ${missing.join(', ')}`);
    return 2;
  }
  let base;
  try {
    base = new URL(env.SUPABASE_STAGING_URL.trim());
    if (base.protocol !== 'https:' || base.username || base.password) throw new Error('x');
  } catch {
    line(deps.stderr, `${TAG}: SUPABASE_STAGING_URL must be an https URL`);
    return 2;
  }
  const dbUrl = env.TRACE_OPERATOR_DB_URL.trim();
  const publishable = env.SUPABASE_STAGING_PUBLISHABLE_KEY.trim();
  const auth = (path) => new URL(path, base).toString();

  // 1. Both users must exist; resolve them before anything changes.
  const smoke = lookupUserId(args.email, dbUrl, deps);
  if (!smoke.ok) {
    line(deps.stderr, `${TAG}: looking up the smoke user: ${describeFailure(smoke)}`);
    return 1;
  }
  const owner = lookupUserId(args.ownerEmail, dbUrl, deps);
  if (!owner.ok) {
    line(deps.stderr, `${TAG}: looking up the owner: ${describeFailure(owner)}`);
    return 1;
  }
  // A reviewer joins the existing smoke org: find it now, so a missing org changes nothing.
  let existingOrgId = null;
  if (role === 'reviewer') {
    const r = runSql(
      {
        url: dbUrl,
        sql: LOOKUP_SMOKE_ORG_SQL,
        vars: { p_slug: SMOKE_ORG_SLUG, p_owner: owner.id },
      },
      deps,
    );
    if (!r.ok) {
      line(deps.stderr, `${TAG}: looking up the ${SMOKE_ORG_SLUG} org: ${describeFailure(r)}`);
      return 1;
    }
    if (!isUuid(r.out)) {
      line(
        deps.stderr,
        `${TAG}: the owner has no ${SMOKE_ORG_SLUG} org; enrol the recruiter smoke user first (the same command without --roles)`,
      );
      return 1;
    }
    existingOrgId = r.out.toLowerCase();
  }

  // 2. Sign in as the smoke user, enrol a TOTP factor, verify it.
  const signIn = await post(
    deps,
    auth('/auth/v1/token?grant_type=password'),
    { apikey: publishable },
    { email: args.email, password },
  );
  const accessToken = signIn.data?.access_token;
  if (!signIn.ok || typeof accessToken !== 'string' || accessToken === '') {
    line(deps.stderr, `${TAG}: ${httpFailure('sign-in', signIn)}`);
    return 1;
  }
  const authed = { apikey: publishable, Authorization: `Bearer ${accessToken}` };
  const enrol = await post(deps, auth('/auth/v1/factors'), authed, { factor_type: 'totp' });
  const factorId = enrol.data?.id;
  const secret = enrol.data?.totp?.secret;
  if (
    !enrol.ok ||
    typeof factorId !== 'string' ||
    !isUuid(factorId) ||
    typeof secret !== 'string' ||
    !BASE32.test(secret)
  ) {
    line(
      deps.stderr,
      `${TAG}: ${enrol.ok ? 'enrolling TOTP returned an unexpected response' : httpFailure('enrolling TOTP', enrol)}`,
    );
    return 1;
  }
  const challenge = await post(deps, auth(`/auth/v1/factors/${factorId}/challenge`), authed, {});
  const challengeId = challenge.data?.id;
  if (!challenge.ok || typeof challengeId !== 'string' || !isUuid(challengeId)) {
    line(deps.stderr, `${TAG}: ${httpFailure('the TOTP challenge', challenge)}`);
    return 1;
  }
  const code = await totp({ secret, timeMs: (deps.now ?? Date.now)() });
  const verify = await post(deps, auth(`/auth/v1/factors/${factorId}/verify`), authed, {
    challenge_id: challengeId,
    code,
  });
  if (!verify.ok) {
    line(deps.stderr, `${TAG}: ${httpFailure('TOTP verification', verify)}`);
    return 1;
  }

  // 3. The secret is printed now, once: a database failure below must not lose it.
  line(deps.stdout, secret);

  let orgId = existingOrgId;
  if (orgId === null) {
    const org = createOrg(
      {
        name: 'Smoke staging',
        slug: SMOKE_ORG_SLUG,
        kind: 'customer',
        ownerUserId: owner.id,
        displayName: 'Smoke owner',
        requestId: deps.randomUUID(),
      },
      dbUrl,
      deps,
    );
    if (!org.ok) {
      line(deps.stderr, `${TAG}: create-org: ${describeFailure(org)}`);
      return 1;
    }
    orgId = org.id;
  }
  const member = addMember(
    {
      orgId,
      userId: smoke.id,
      roles: [role],
      displayName: ROLES[role],
      requestId: deps.randomUUID(),
    },
    dbUrl,
    deps,
  );
  if (!member.ok) {
    line(deps.stderr, `${TAG}: add-member: ${describeFailure(member)}`);
    return 1;
  }
  return 0;
}

/** Returns the exit code: 0 ok, 1 failure, 2 bad arguments, environment or refusal. */
export async function main({ argv, deps = realDeps() }) {
  let flags;
  try {
    flags = parseFlags(argv, OPTIONS);
  } catch {
    line(deps.stderr, `${TAG}: unknown or malformed argument`);
    return 2;
  }
  // --roles is not part of EnrolSmokeUserArgs (m0b §4.5): it is checked here, staging only, and is
  // exactly one listed role (never an owner or admin role).
  if (flags.roles !== undefined) {
    if (flags.env !== 'staging') {
      line(deps.stderr, `${TAG}: --roles applies to --env staging only`);
      return 2;
    }
    if (!Object.hasOwn(ROLES, flags.roles)) {
      line(deps.stderr, `${TAG}: --roles must be one of: ${Object.keys(ROLES).join(', ')}`);
      return 2;
    }
  }
  const role = flags.roles ?? 'recruiter';
  const input = { env: flags.env, email: flags.email };
  if (flags['owner-email'] !== undefined) input.ownerEmail = flags['owner-email'];
  const parsed = validate(EnrolSmokeUserArgs, input);
  if (!parsed.ok) {
    line(deps.stderr, `${TAG}: invalid argument(s): ${parsed.fields.join(', ')}`);
    return 2;
  }
  const password = deps.env.SMOKE_PASSWORD ?? '';
  if (!Password.safeParse(password).success) {
    line(deps.stderr, `${TAG}: SMOKE_PASSWORD must be set (12 to 128 characters)`);
    return 2;
  }
  const args = parsed.data;
  return args.env === 'local'
    ? enrolLocal({ args, password, deps })
    : enrolStaging({ args, password, role, deps });
}

if (isEntryPoint(import.meta.url)) {
  process.exit(await main({ argv: process.argv.slice(2) }));
}
