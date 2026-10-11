#!/usr/bin/env node
// Worker secret allow-list check (spec specs/m0-foundations.md §7.2 step 6, AT-15).
// For each staging Worker it runs `pnpm exec wrangler secret list --env staging --format json`
// in that Worker's folder and fails (exit 1) unless every secret name is in the Worker's
// allow-list. M0a's lists are all empty; M0b and later extend jobs and api explicitly, and edge
// stays [] for good. Fails closed: a failed or killed command, output that is not wrangler's JSON
// list, or a Worker with no allow-list entry is a violation, never a pass.
// wrangler never returns secret values, so only names are printed.
// Runs only in CI, on the deploy-staging step that holds CLOUDFLARE_API_TOKEN (spec §7.2); this
// machine has no Cloudflare credential by design. Optional argument: the repository root.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntryPoint } from './lib/cli.mjs';

/** Secret names each staging Worker may hold (§7.2 step 6). Changing it is a spec change. */
export const ALLOW_LIST = Object.freeze({
  edge: Object.freeze([]),
  jobs: Object.freeze([]),
  api: Object.freeze([]),
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
