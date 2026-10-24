#!/usr/bin/env node
// E2E staging preflight and recording launcher (specs/d1-demo-slice.md §7.1, §7.3; AT-D1, AT-D2).
//   pnpm e2e:staging:preflight   = node scripts/e2e-staging-preflight.mjs
//   pnpm e2e:record              = node scripts/e2e-staging-preflight.mjs --record
// Preflight (the e2e-staging job's first own step, and step 1 of the recording procedure) fails fast
// (exit 1) unless
//   - every public variable of the e2e-staging contract is set and well formed: the four staging
//     origins exactly as scripts/check-workflows.mjs pins them (E2E_STAGING_PREFLIGHT_ENV), the
//     staging Supabase URL (https://<20-character ref>.supabase.co), a publishable key
//     (sb_publishable_…, never a secret key) and E2E_SHA (the 40-hex deployed commit);
//   - GET <api>/health and <edge>/health answer 200 with a HealthResponse body for that service, and
//     GET <candidate>/version.json and <recruiter>/version.json answer 200 with an AppVersionFile body
//     for that app, each with version == E2E_SHA (the stack serves the commit under test).
// It needs no secret and sends none. Output names a variable and the rule, an endpoint and a status or
// schema issue, never a received value (the expected origins and the SHAs are public).
// --record runs the slice spec (e2e/tests/d1-slice.spec.ts) with E2E_RECORD=1, which the Playwright
// config turns into the recording mode (headed, slowMo, captions; stream R5), against the stack the
// environment names: E2E_LOCAL=1 means project `local` (the running local stack; no preflight),
// anything else means project `staging` with E2E_STAGING=1, after this preflight and a check that the
// six credentials are set (names only). The credentials reach Playwright through its environment
// only, never an argument or an output line. It never turns traces on.
// After Playwright passes, --record reads the run's manifest (e2e/test-results/d1-manifest.json) and exits 1
// unless it is this run's record-mode manifest for the project and its recordedMs (first recorded context
// opened to last context closed) is within 270 000-330 000 ms: the span the one OS-level screen capture
// that is the AT-D2 deliverable must cover (§7.3, D1-SPEC-2).
import { spawn as realSpawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppVersionFile, HealthResponse } from '../packages/shared/src/contracts.ts';
import { isEntryPoint } from './lib/cli.mjs';
import { MAX_BODY_BYTES, SHA_RE } from './smoke-staging.mjs';

const TAG = 'e2e-staging-preflight';

/** The four staging origins (H4 label `abhayraj`), exactly as ci.yml's e2e-staging job sets them. */
export const STAGING_ORIGINS = Object.freeze({
  E2E_CANDIDATE_URL: 'https://trace-candidate-staging.pages.dev',
  E2E_RECRUITER_URL: 'https://trace-recruiter-staging.pages.dev',
  E2E_API_URL: 'https://trace-api-staging.abhayraj.workers.dev',
  E2E_EDGE_URL: 'https://trace-edge-staging.abhayraj.workers.dev',
});
/** The public half of the e2e-staging env contract: what the preflight checks. */
export const CONTRACT = Object.freeze([
  ...Object.keys(STAGING_ORIGINS),
  'E2E_SUPABASE_URL',
  'E2E_SUPABASE_PUBLISHABLE_KEY',
  'E2E_SHA',
]);
/** The six credentials the Playwright step gets (checked for presence only, in --record mode). */
export const CREDENTIALS = Object.freeze([
  'E2E_RECRUITER_EMAIL',
  'E2E_RECRUITER_PASSWORD',
  'E2E_RECRUITER_TOTP_SECRET',
  'E2E_REVIEWER_EMAIL',
  'E2E_REVIEWER_PASSWORD',
  'E2E_REVIEWER_TOTP_SECRET',
]);
/** The one serial slice spec (D1-17), relative to e2e/. */
export const SLICE_SPEC = 'tests/d1-slice.spec.ts';
/** Playwright's CLI, as scripts/e2e-local.mjs runs it (relative to the repository root). */
export const PLAYWRIGHT_CLI = 'e2e/node_modules/@playwright/test/cli.js';

/** AT-D2 (§7.3, D1-SPEC-2): the recorded span of a record-mode run, in ms, both bounds included. */
export const RECORDED_MS_MIN = 270_000;
export const RECORDED_MS_MAX = 330_000;
/** Where the slice writes its manifest (the Playwright outputDir), relative to the repository root. */
export const MANIFEST_FILE = 'e2e/test-results/d1-manifest.json';

const SUPABASE_URL_RE = /^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/;
const PUBLISHABLE_KEY_RE = /^sb_publishable_[A-Za-z0-9_-]{20,}$/;
const TIMEOUT_MS = 15_000;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const isSet = (env, name) => typeof env[name] === 'string' && env[name].trim() !== '';

/** Problems with the public contract in `env`: `NAME: rule`, never a value. */
export function checkContract(env) {
  const out = [];
  for (const name of CONTRACT) {
    if (!isSet(env, name)) out.push(`${name}: is not set`);
  }
  for (const [name, origin] of Object.entries(STAGING_ORIGINS)) {
    if (isSet(env, name) && env[name] !== origin) out.push(`${name}: must be exactly ${origin}`);
  }
  if (isSet(env, 'E2E_SUPABASE_URL') && !SUPABASE_URL_RE.test(env.E2E_SUPABASE_URL)) {
    out.push('E2E_SUPABASE_URL: must be https://<20-character project ref>.supabase.co');
  }
  if (isSet(env, 'E2E_SUPABASE_PUBLISHABLE_KEY')) {
    const key = env.E2E_SUPABASE_PUBLISHABLE_KEY;
    if (key.trim().startsWith('sb_secret_'))
      out.push('E2E_SUPABASE_PUBLISHABLE_KEY: is a secret key, not a publishable one');
    else if (!PUBLISHABLE_KEY_RE.test(key))
      out.push(
        'E2E_SUPABASE_PUBLISHABLE_KEY: must be a publishable key (sb_publishable_ and at least 20 more characters)',
      );
  }
  if (isSet(env, 'E2E_SHA') && !SHA_RE.test(env.E2E_SHA)) {
    out.push('E2E_SHA: must be the 40-character lower-case hex commit SHA');
  }
  return out;
}

/** Zod issues as `path: code` only (never the received value). */
const issueText = (error) =>
  error.issues
    .slice(0, 5)
    .map((i) => `${i.path.length > 0 ? i.path.join('.') : '(root)'}: ${i.code}`)
    .join(', ');

/**
 * GET `url` (no redirect followed, a timeout, at most MAX_BODY_BYTES read) and parse its JSON body.
 * Returns { value } or { problem }; a problem never holds the body.
 */
async function getJson(fetch, url) {
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
  } catch (err) {
    return { problem: `request failed (${err?.name ?? 'error'})` };
  }
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel().catch(() => {});
    return { problem: `redirect (HTTP ${res.status}); redirects are not followed` };
  }
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => {});
    return { problem: `HTTP ${res.status}` };
  }
  const tooLarge = { problem: `body is larger than ${MAX_BODY_BYTES} bytes` };
  const chunks = [];
  let total = 0;
  if (res.body) {
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          await reader.cancel().catch(() => {});
          return tooLarge;
        }
        chunks.push(value);
      }
    } catch (err) {
      return { problem: `body could not be read (${err?.name ?? 'error'})` };
    }
  }
  try {
    return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { problem: 'body is not JSON' };
  }
}

/** Problems with the deployed stack at E2E_SHA (the contract must already be clean). */
export async function checkStack({ env, fetch }) {
  const sha = env.E2E_SHA;
  const versionProblem = (version) =>
    version === sha ? [] : [`version is ${version}, expected ${sha} (E2E_SHA)`];
  const checks = [
    ...[
      ['api', env.E2E_API_URL],
      ['edge', env.E2E_EDGE_URL],
    ].map(([service, origin]) => async () => {
      const r = await getJson(fetch, `${origin}/health`);
      if (r.problem) return [`${service} /health: ${r.problem}`];
      const parsed = HealthResponse.safeParse(r.value);
      if (!parsed.success)
        return [
          `${service} /health: body does not match HealthResponse (${issueText(parsed.error)})`,
        ];
      if (parsed.data.service !== service)
        return [`${service} /health: service is ${parsed.data.service}, expected ${service}`];
      return versionProblem(parsed.data.version).map((m) => `${service} /health: ${m}`);
    }),
    ...[
      ['candidate', env.E2E_CANDIDATE_URL],
      ['recruiter', env.E2E_RECRUITER_URL],
    ].map(([app, origin]) => async () => {
      const r = await getJson(fetch, `${origin}/version.json`);
      if (r.problem) return [`${app} /version.json: ${r.problem}`];
      const parsed = AppVersionFile.safeParse(r.value);
      if (!parsed.success)
        return [
          `${app} /version.json: body does not match AppVersionFile (${issueText(parsed.error)})`,
        ];
      if (parsed.data.app !== app)
        return [`${app} /version.json: app is ${parsed.data.app}, expected ${app}`];
      return versionProblem(parsed.data.version).map((m) => `${app} /version.json: ${m}`);
    }),
  ];
  const out = [];
  for (const check of checks) out.push(...(await check()));
  return out;
}

/**
 * Problems with a record-mode manifest (§7.3, D1-SPEC-2): it must be this run's (started at or after
 * `launchedAtMs`), a record-mode run of `project`, and its integer recordedMs within the window. Names
 * the field and the rule; the only value it repeats is recordedMs (a duration).
 */
export function checkRecordedManifest(manifest, { project, launchedAtMs }) {
  if (manifest === null || typeof manifest !== 'object')
    return [`${MANIFEST_FILE}: missing or not JSON`];
  const out = [];
  const started = typeof manifest.startedAt === 'string' ? Date.parse(manifest.startedAt) : NaN;
  if (!(started >= launchedAtMs))
    out.push(`${MANIFEST_FILE}: startedAt is older than this run (a stale manifest)`);
  if (manifest.record !== true)
    out.push(`${MANIFEST_FILE}: not a record-mode run (record must be true)`);
  if (manifest.project !== project) out.push(`${MANIFEST_FILE}: project must be ${project}`);
  const ms = manifest.recordedMs;
  if (!Number.isInteger(ms)) {
    out.push(`${MANIFEST_FILE}: recordedMs must be an integer number of ms`);
  } else if (ms < RECORDED_MS_MIN || ms > RECORDED_MS_MAX) {
    out.push(
      `${MANIFEST_FILE}: recordedMs ${ms} is outside ${RECORDED_MS_MIN}-${RECORDED_MS_MAX} (AT-D2: 4:30 to 5:30)`,
    );
  }
  return out;
}

/** Reads and parses a JSON file; null when it is missing or not JSON. */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Runs a child with inherited stdio; resolves to its exit code (1 on a signal or spawn error). */
function spawnInherit(cmd, args, opts) {
  return new Promise((resolve) => {
    const child = realSpawn(cmd, args, { ...opts, stdio: 'inherit', shell: false });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(typeof code === 'number' ? code : 1));
  });
}

/** CLI body; resolves to the exit code: 0 ok, 1 a check (or Playwright) failed, 2 bad arguments. */
export async function main({
  argv,
  env = process.env,
  fetch = globalThis.fetch,
  spawn = spawnInherit,
  readManifest = readJson,
  now = Date.now,
  root = REPO_ROOT,
  out = console.log,
  err = console.error,
}) {
  const record = argv.length === 1 && argv[0] === '--record';
  if (argv.length > 0 && !record) {
    err(`${TAG}: unknown argument; usage: ${TAG}.mjs [--record]`);
    return 2;
  }
  const local = record && env.E2E_LOCAL === '1';
  if (!local) {
    const problems = checkContract(env);
    if (record) {
      for (const name of CREDENTIALS) if (!isSet(env, name)) problems.push(`${name}: is not set`);
    }
    if (problems.length === 0) problems.push(...(await checkStack({ env, fetch })));
    for (const p of problems) err(`${TAG}: ${p}`);
    if (problems.length > 0) {
      err(`${TAG}: ${problems.length} problem(s); the staging E2E did not start (d1 §7.1)`);
      return 1;
    }
    out(`${TAG}: OK (api, edge, candidate, recruiter serve ${env.E2E_SHA})`);
  }
  if (!record) return 0;

  const project = local ? 'local' : 'staging';
  const childEnv = { ...env, E2E_RECORD: '1' };
  if (local) delete childEnv.E2E_STAGING;
  else childEnv.E2E_STAGING = '1';
  delete childEnv.E2E_TRACE;
  out(`${TAG}: recording ${SLICE_SPEC} against ${project}`);
  const launchedAtMs = now();
  const code = await spawn(
    process.execPath,
    [path.join(root, PLAYWRIGHT_CLI), 'test', SLICE_SPEC, '--project', project],
    { cwd: path.join(root, 'e2e'), env: childEnv },
  );
  if (code !== 0) return code;
  const manifest = readManifest(path.join(root, MANIFEST_FILE));
  const problems = checkRecordedManifest(manifest, { project, launchedAtMs });
  for (const p of problems) err(`${TAG}: ${p}`);
  if (problems.length > 0) {
    err(`${TAG}: the recording does not meet AT-D2 (d1 §7.3); record again`);
    return 1;
  }
  out(
    `${TAG}: OK recordedMs ${manifest.recordedMs} (AT-D2 window ${RECORDED_MS_MIN}-${RECORDED_MS_MAX})`,
  );
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await main({ argv: process.argv.slice(2) });
}
