#!/usr/bin/env node
// Worker secret allow-list check (spec specs/m0-foundations.md §7.2 step 6, AT-15).
// For each staging Worker it runs `pnpm exec wrangler secret list --env staging --format json`
// in that Worker's folder and fails (exit 1) unless every secret name is in the Worker's
// allow-list. D1 (specs/d1-demo-slice.md §7.1, L-10) lists the api and jobs secrets explicitly; edge
// stays [] for good. A DSN or a publishable key is a var, never a secret, so never on a list. Fails closed: a failed or killed command, output that is not wrangler's JSON
// list, or a Worker with no allow-list entry is a violation, never a pass.
// wrangler never returns secret values, so only names are printed.
// Runs only in CI, on the deploy-staging step that holds CLOUDFLARE_API_TOKEN (spec §7.2); this
// machine has no Cloudflare credential by design. Optional argument: the repository root.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntryPoint } from './lib/cli.mjs';

/**
 * Secret names each staging Worker may hold (m0 §7.2 step 6; d1 §7.1). Changing it is a spec change.
 * The Supabase URL and publishable key, SENTRY_DSN_WORKERS and VITE_SENTRY_DSN are public vars (L-10).
 * On staging the database logins live in Hyperdrive configs reached through Hyperdrive bindings (ADR-031
 * amendment 1, d1 revision 4o), so API_DB_URL and the three JOBS_*_DB_URL secrets are retired there; a leftover
 * one is a stale credential and fails this check (scripts/ops/staging-worker-secrets.mjs deletes them).
 */
export const ALLOW_LIST = Object.freeze({
  edge: Object.freeze([]),
  jobs: Object.freeze([]),
  api: Object.freeze(['CANDIDATE_TOKEN_PRIVATE_JWK', 'MEDIA_LINK_HMAC_KEY']),
});

/** Where each Worker's wrangler.jsonc lives, in check order. */
export const WORKER_DIRS = Object.freeze({
  edge: 'workers/edge',
  jobs: 'workers/jobs',
  api: 'services/api',
});

const WRANGLER_ARGS = Object.freeze([
  'exec',
  'wrangler',
  'secret',
  'list',
  '--env',
  'staging',
  '--format',
  'json',
]);

/** First non-empty stderr line, cut to 200 characters. */
const firstLine = (text) => {
  const line = (text ?? '').split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
};

/** wrangler's JSON list → { names } or { error }. Anything else fails closed. */
export function parseSecretList(stdout) {
  let list;
  try {
    list = JSON.parse(stdout);
  } catch {
    return { error: 'not JSON' };
  }
  if (!Array.isArray(list)) return { error: 'not a JSON list' };
  const names = [];
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
      return { error: 'an entry is not an object' };
    if (typeof entry.name !== 'string' || entry.name === '')
      return { error: 'an entry has no name' };
    names.push(entry.name);
  }
  return { names };
}

/**
 * Violations for one Worker, given its `wrangler secret list` result
 * ({ status, signal?, stdout, stderr, error? }, as spawnSync returns it).
 */
export function checkWorker(worker, result, allowList = ALLOW_LIST) {
  if (!Object.hasOwn(allowList, worker)) return [`${worker}: no allow-list entry (spec §7.2)`];
  if (worker === 'edge' && allowList.edge.length > 0)
    return ['edge: the allow-list must stay empty (spec §7.2: edge holds no secrets)'];
  if (result.error || result.status !== 0) {
    const why = result.error
      ? result.error.message
      : result.status === null
        ? `signal ${result.signal ?? 'unknown'}`
        : `exit ${result.status}`;
    const detail = firstLine(result.stderr);
    return [`${worker}: wrangler secret list failed (${why})${detail ? `: ${detail}` : ''}`];
  }
  const parsed = parseSecretList(result.stdout);
  if (parsed.error) return [`${worker}: cannot read wrangler secret list output (${parsed.error})`];
  const allowed = new Set(allowList[worker]);
  return parsed.names
    .filter((name) => !allowed.has(name))
    .map((name) => `${worker}: secret ${name} is not in the allow-list (spec §7.2 step 6)`);
}

/** Runs the check for every Worker. `run(worker)` returns a spawnSync-shaped result. */
export function runChecks({ run, allowList = ALLOW_LIST }) {
  const violations = [];
  const report = [];
  for (const worker of Object.keys(WORKER_DIRS)) {
    let result;
    try {
      result = run(worker);
    } catch (error) {
      result = { status: null, stdout: '', stderr: '', error };
    }
    const v = checkWorker(worker, result, allowList);
    if (v.length > 0) violations.push(...v);
    else {
      const count = parseSecretList(result.stdout).names.length;
      report.push(`${worker}: ${count} secret(s), all in the allow-list`);
    }
  }
  return { violations, report };
}

/** The real runner: wrangler in each Worker's folder, no shell. */
export function wranglerRunner(root, spawn = spawnSync) {
  return (worker) =>
    spawn('pnpm', [...WRANGLER_ARGS], {
      cwd: path.join(root, WORKER_DIRS[worker]),
      encoding: 'utf8',
      shell: false,
    });
}

/** CLI body; returns the exit code. */
export function main({ run, out = console.log, err = console.error }) {
  const { violations, report } = runChecks({ run });
  for (const line of report) out(`check-staging-secrets: ${line}`);
  for (const line of violations) err(`check-staging-secrets: ${line}`);
  if (violations.length > 0) return 1;
  out('check-staging-secrets: OK');
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  const root = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exit(main({ run: wranglerRunner(root) }));
}
