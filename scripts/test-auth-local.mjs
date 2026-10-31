#!/usr/bin/env node
// AT-B8 (specs/m0b-tenancy.md §7, DC-2): local org sign-in end to end, and the claim shapes the
// rls_* files pin. Run by scripts/test-rls.mjs after pgTAP, on the freshly reset local stack with
// kong, PostgREST and mailpit on. Standalone it needs `pnpm exec supabase db reset --local` first:
// it creates two fixed synthetic users.
//   1. enrol-smoke-user --env local for p-owner@example.test and p-recruiter@example.test (one
//      generated password), create-org smoke-local owned by the owner, add-member the recruiter
//      as `recruiter` only (the operator scripts themselves, through their main()).
//   2. Owner: password sign-in → aal1, amr [password], sees no org (a privileged role needs aal2)
//      → TOTP enrol + verify → aal2, amr [password, totp], sees exactly its org through PostgREST.
//   3. Recruiter: email OTP, the 6-digit code read from mailpit → aal1, amr [otp], sees its org.
//   4. audit_log: one auth.sign_in per sign-in and one auth.step_up after the TOTP verification.
//   5. DC-M1-1 (specs/m1-test-authoring.md §8): the owner calls the INVOKER public.import_item_batch
//      through PostgREST; aal1 is refused (RLS hides the job), aal2 is accepted and the guards apply.
// amr is compared as a set of methods (GoTrue orders it newest first). Output: one line, OK or the
// failed step with an HTTP status or a short reason; never a body, token, key, password, code or id.
import { randomBytes, randomUUID } from 'node:crypto';
import { isEntryPoint } from './lib/cli.mjs';
import { totp } from './lib/totp.mjs';
import { main as addMember } from './ops/add-member.mjs';
import { main as createOrg } from './ops/create-org.mjs';
import { main as enrolSmokeUser } from './ops/enrol-smoke-user.mjs';
import { isUuid, localStackEnv, realDeps, runSql } from './ops/lib.mjs';

const TAG = 'test-auth-local';
export const OWNER_EMAIL = 'p-owner@example.test';
export const RECRUITER_EMAIL = 'p-recruiter@example.test';
const TIMEOUT_MS = 15_000;
const MAIL_WAIT_MS = 15_000;

class StepFailure extends Error {}
const fail = (step, why) => {
  throw new StepFailure(`${step} failed (${why})`);
};

/** The JWT payload, or null. No signature check: the token came straight from local GoTrue. */
export function claimsOf(token) {
  try {
    const part = String(token).split('.')[1] ?? '';
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** The sorted, de-duplicated amr methods of a claims object. */
export const amrMethods = (claims) =>
  [...new Set((Array.isArray(claims?.amr) ? claims.amr : []).map((a) => a?.method))].sort();

/** The 6-digit code in a sign-in email's text, or null. */
export function codeIn(text) {
  const m = /(?:^|\D)(\d{6})(?:\D|$)/.exec(String(text ?? ''));
  return m ? m[1] : null;
}

async function http(deps, method, url, { headers = {}, body } = {}) {
  try {
    const res = await deps.fetch(url, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      // not JSON
    }
    return { status: res.status, ok: res.ok === true, data };
  } catch {
    return { status: null, ok: false, data: null };
  }
}

const statusOf = (r) => (r.status === null ? 'network error' : `HTTP ${r.status}`);

/** Runs an operator script's main() with extra env; returns the single id it prints. */
async function operator(step, main, argv, deps, extraEnv = {}) {
  const out = [];
  const err = [];
  const code = await main({
    argv,
    deps: {
      ...deps,
      env: { ...deps.env, ...extraEnv },
      stdout: { write: (s) => out.push(s) },
      stderr: { write: (s) => err.push(s) },
    },
  });
  const id = out.join('').trim();
  if (code !== 0 || !isUuid(id)) {
    // The operator scripts print only fixed messages and a SQLSTATE or HTTP status (never a value).
    const why = err.join('').trim().split(/\r?\n/)[0] ?? '';
    fail(step, `exit ${code}${why ? `; ${why}` : ''}`);
  }
  return id.toLowerCase();
}

function expectSession(step, token, { aal, amr, sub }) {
  const c = claimsOf(token);
  if (c === null) fail(step, 'no token');
  if (c.aal !== aal) fail(step, `aal is ${String(c.aal)}, expected ${aal}`);
  const got = amrMethods(c);
  if (JSON.stringify(got) !== JSON.stringify([...amr].sort()))
    fail(step, `amr methods are [${got.join(', ')}], expected [${[...amr].sort().join(', ')}]`);
  if (c.sub !== sub) fail(step, 'sub is not the user');
  if (c.role !== 'authenticated') fail(step, 'role is not authenticated');
}

async function orgIdsSeen(step, api, key, token, deps) {
  const r = await http(deps, 'GET', `${api}/rest/v1/orgs?select=id`, {
    headers: { apikey: key, Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!r.ok || !Array.isArray(r.data)) fail(step, statusOf(r));
  return r.data.map((row) => row?.id);
}

async function readCode(mailpit, email, deps) {
  const deadline = Date.now() + MAIL_WAIT_MS;
  while (Date.now() < deadline) {
    const list = await http(deps, 'GET', `${mailpit}/api/v1/messages?limit=50`);
    const messages = Array.isArray(list.data?.messages) ? list.data.messages : [];
    const mine = messages.find((m) =>
      (m?.To ?? []).some((t) => String(t?.Address).toLowerCase() === email),
    );
    if (mine?.ID) {
      const msg = await http(
        deps,
        'GET',
        `${mailpit}/api/v1/message/${encodeURIComponent(mine.ID)}`,
      );
      const code = codeIn(msg.data?.Text) ?? codeIn(msg.data?.HTML);
      if (code) return code;
      fail('reading the sign-in code', 'no 6-digit code in the email');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return fail('reading the sign-in code', 'no email arrived in mailpit');
}

async function run(deps) {
  // 0. The local stack, with the API gateway and the mail catcher.
  const stack = localStackEnv(deps);
  if (stack === null) fail('reading supabase status', 'is the local stack running?');
  const api = String(stack.API_URL ?? '').replace(/\/$/, '');
  const key = stack.PUBLISHABLE_KEY || stack.ANON_KEY;
  const mailpit = String(stack.MAILPIT_URL || stack.INBUCKET_URL || '').replace(/\/$/, '');
  let apiHost = '';
  try {
    apiHost = new URL(api).hostname;
  } catch {
    // reported below
  }
  if (apiHost !== '127.0.0.1' || !key || !mailpit)
    fail('reading supabase status', 'API_URL, the publishable key or MAILPIT_URL is missing');
  const health = await http(deps, 'GET', `${api}/auth/v1/health`, { headers: { apikey: key } });
  if (!health.ok)
    fail(
      'reaching the API gateway',
      `${statusOf(health)}; restart the stack: pnpm exec supabase stop, then pnpm test:rls`,
    );

  // 1. Users, org and membership through the operator scripts.
  const password = `Tr${randomBytes(12).toString('hex')}9`;
  const smoke = { SMOKE_PASSWORD: password };
  const ownerId = await operator(
    'enrol-smoke-user (owner)',
    enrolSmokeUser,
    ['--env', 'local', '--email', OWNER_EMAIL],
    deps,
    smoke,
  );
  const recruiterId = await operator(
    'enrol-smoke-user (recruiter)',
    enrolSmokeUser,
    ['--env', 'local', '--email', RECRUITER_EMAIL],
    deps,
    smoke,
  );
  const orgId = await operator(
    'create-org',
    createOrg,
    [
      '--name',
      'Smoke local',
      '--slug',
      'smoke-local',
      '--kind',
      'customer',
      '--owner-user-id',
      ownerId,
      '--display-name',
      'Smoke owner',
      '--request-id',
      randomUUID(),
    ],
    deps,
  );
  await operator(
    'add-member',
    addMember,
    [
      '--org-id',
      orgId,
      '--user-id',
      recruiterId,
      '--roles',
      'recruiter',
      '--display-name',
      'Smoke recruiter',
      '--request-id',
      randomUUID(),
    ],
    deps,
  );

  // 2. Owner: password → aal1 sees nothing → TOTP → aal2 sees exactly its org.
  const pw = await http(deps, 'POST', `${api}/auth/v1/token?grant_type=password`, {
    headers: { apikey: key },
    body: { email: OWNER_EMAIL, password },
  });
  const t1 = pw.data?.access_token;
  if (!pw.ok || typeof t1 !== 'string') fail('password sign-in', statusOf(pw));
  expectSession('password sign-in', t1, { aal: 'aal1', amr: ['password'], sub: ownerId });
  const seen1 = await orgIdsSeen('reading orgs at aal1', api, key, t1, deps);
  if (seen1.length !== 0) fail('reading orgs at aal1', `saw ${seen1.length} org(s), expected 0`);

  const authed = { apikey: key, Authorization: `Bearer ${t1}` };
  const enrol = await http(deps, 'POST', `${api}/auth/v1/factors`, {
    headers: authed,
    body: { factor_type: 'totp' },
  });
  const factorId = enrol.data?.id;
  const secret = enrol.data?.totp?.secret;
  if (!enrol.ok || typeof factorId !== 'string' || typeof secret !== 'string')
    fail('TOTP enrolment', statusOf(enrol));
  const ch = await http(deps, 'POST', `${api}/auth/v1/factors/${factorId}/challenge`, {
    headers: authed,
    body: {},
  });
  if (!ch.ok || typeof ch.data?.id !== 'string') fail('TOTP challenge', statusOf(ch));
  const code = await totp({ secret, timeMs: Date.now() });
  const ver = await http(deps, 'POST', `${api}/auth/v1/factors/${factorId}/verify`, {
    headers: authed,
    body: { challenge_id: ch.data.id, code },
  });
  const t2 = ver.data?.access_token;
  if (!ver.ok || typeof t2 !== 'string') fail('TOTP verification', statusOf(ver));
  expectSession('TOTP verification', t2, {
    aal: 'aal2',
    amr: ['password', 'totp'],
    sub: ownerId,
  });
  const seen2 = await orgIdsSeen('reading orgs at aal2', api, key, t2, deps);
  if (seen2.length !== 1 || seen2[0] !== orgId)
    fail('reading orgs at aal2', `saw ${seen2.length} org(s), expected exactly its own`);

  // 3. Recruiter: email OTP → aal1 sees its org (a recruiter-only member needs no aal2).
  const otp = await http(deps, 'POST', `${api}/auth/v1/otp`, {
    headers: { apikey: key },
    body: { email: RECRUITER_EMAIL, create_user: false },
  });
  if (!otp.ok) fail('requesting the email code', statusOf(otp));
  const token = await readCode(mailpit, RECRUITER_EMAIL, deps);
  const vo = await http(deps, 'POST', `${api}/auth/v1/verify`, {
    headers: { apikey: key },
    body: { type: 'email', email: RECRUITER_EMAIL, token },
  });
  const t3 = vo.data?.access_token;
  if (!vo.ok || typeof t3 !== 'string') fail('verifying the email code', statusOf(vo));
  expectSession('verifying the email code', t3, { aal: 'aal1', amr: ['otp'], sub: recruiterId });
  const seen3 = await orgIdsSeen('reading orgs as the recruiter', api, key, t3, deps);
  if (seen3.length !== 1 || seen3[0] !== orgId)
    fail('reading orgs as the recruiter', `saw ${seen3.length} org(s), expected exactly 1`);

  // 4. The sign-in audit events (spec §2.5).
  const q = runSql(
    {
      url: stack.DB_URL,
      sql: `select actor_user_id || ' ' || action || ' ' || count(*) from public.audit_log where action in ('auth.sign_in', 'auth.step_up') group by actor_user_id, action order by 1;\n`,
      vars: {},
    },
    deps,
  );
  if (!q.ok) fail('reading audit_log', q.sqlstate ? `SQLSTATE ${q.sqlstate}` : 'no SQLSTATE');
  const want = [
    `${ownerId} auth.sign_in 1`,
    `${ownerId} auth.step_up 1`,
    `${recruiterId} auth.sign_in 1`,
  ].sort();
  const got = q.out.split(/\r?\n/).filter(Boolean).sort();
  if (JSON.stringify(got) !== JSON.stringify(want))
    fail(
      'checking the sign-in audit events',
      `${got.length} event group(s), expected 3 exact ones`,
    );

  // 5. DC-M1-1 (specs/m1-test-authoring.md §8): PostgREST runs a public SECURITY INVOKER function with the
  //    caller's JWT, so RLS and the guards apply inside it. The operator opens an import job in the org; the
  //    owner's batch is refused at aal1 (RLS hides the job from a privileged role below aal2) and accepted at
  //    aal2; the operator then reads what the guards wrote.
  const job = runSql(
    {
      url: stack.DB_URL,
      sql: [
        'insert into public.import_jobs (org_id, workspace_id, source_kind, template_version, created_by)',
        "select w.org_id, w.id, 'xlsx', 'trace-items-v1', :'owner_id' from public.workspaces as w",
        "where w.org_id = :'org_id' and w.is_default returning id;\n",
      ].join('\n'),
      vars: { org_id: orgId, owner_id: ownerId },
    },
    deps,
  );
  const jobId = job.ok ? job.out.trim() : '';
  if (!isUuid(jobId))
    fail('opening an import job', job.sqlstate ? `SQLSTATE ${job.sqlstate}` : 'no job id');
  const rpc = (bearer) =>
    http(deps, 'POST', `${api}/rest/v1/rpc/import_item_batch`, {
      headers: { apikey: key, Authorization: `Bearer ${bearer}` },
      body: { p_job: jobId, p_rows: INVOKER_ROWS },
    });
  const low = await rpc(t1);
  const high = await rpc(t2);
  const after = runSql(
    {
      url: stack.DB_URL,
      sql: "select j.status || ' ' || (select count(*) from public.import_row_errors as e where e.import_job_id = j.id) from public.import_jobs as j where j.id = :'job_id';\n",
      vars: { job_id: jobId },
    },
    deps,
  );
  const problem = invokerVerdict({
    low: low.status,
    lowData: low.data,
    high: high.status,
    highData: high.data,
    after: after.ok ? after.out.trim() : null,
  });
  if (problem !== null) fail('calling an INVOKER function through PostgREST (DC-M1-1)', problem);
  return 'password, TOTP and email-code sign-ins, claims, audit events and an INVOKER rpc';
}

/** DC-M1-1: one error-only import row (no item content needed); the batch stores it as an import_row_errors row. */
export const INVOKER_ROWS = Object.freeze([
  Object.freeze({
    rowNo: 2,
    errors: Object.freeze([Object.freeze({ field: 'stem', code: 'missing_field' })]),
  }),
]);

/**
 * DC-M1-1 verdict, or null. aal2 must be accepted with exactly the error row back; aal1 must be refused with 409
 * (23503 'import job not found': RLS hid the job inside the INVOKER function); the job must be validating with one
 * stored error row. Never echoes a body (the refusal body is compared, not printed).
 */
export function invokerVerdict({ low, lowData, high, highData, after }) {
  if (high !== 200) return `the aal2 call returned HTTP ${high ?? 'network error'}`;
  const e = Array.isArray(highData?.errors) ? highData.errors : [];
  if (
    highData?.accepted !== 0 ||
    e.length !== 1 ||
    e[0]?.rowNo !== 2 ||
    e[0]?.field !== 'stem' ||
    e[0]?.code !== 'missing_field'
  )
    return 'the aal2 call returned an unexpected result';
  if (low !== 409)
    return `the aal1 call returned HTTP ${low ?? 'network error'}, expected 409 (RLS hides the job)`;
  // PostgREST answers 409 for 23505 too: the code and the guard's message must both be the hidden job's.
  if (lowData?.code !== '23503' || lowData?.message !== 'TRACE_GUARD: import job not found')
    return 'the aal1 call was refused for another reason (expected 23503, job not found)';
  if (after !== 'validating 1') return 'the job is not validating with one stored error row';
  return null;
}

/** Returns the exit code: 0 ok, 1 failure. */
export async function main({ deps = realDeps() } = {}) {
  try {
    const what = await run(deps);
    deps.stdout.write(`${TAG}: OK (${what})\n`);
    return 0;
  } catch (e) {
    const msg = e instanceof StepFailure ? e.message : 'unexpected error';
    deps.stdout.write(`${TAG}: ${msg}\n`);
    return 1;
  }
}

if (isEntryPoint(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  });
}
