#!/usr/bin/env node
// Staging R2 buckets and Queues, created only if missing (specs/d1-demo-slice.md §7.1;
// docs/reviews/D1-security-review-bindings.md F5). Runs in the deploy-staging job before any Worker
// is deployed, because the Workers' bindings and the jobs consumer name these resources.
// `wrangler ... create` is called for each name; an "already exists" answer counts as success, so a
// re-run is idempotent, but only once `wrangler r2 bucket info --json` (same name, APAC location) or
// `wrangler queues info` (its Queue Name line) confirms it (security review S6,
// docs/reviews/D1-security-review-wave0-rest.md). Any other failure fails the deploy. Nothing is ever deleted, listed or
// changed: this script has no code path for it. The buckets get the APAC location hint (the plan's
// `r2_apac` residency, docs/build-notes.md orgs.data_residency), which cannot be changed later, so
// it is set on creation. Runs only in CI, on the step that holds CLOUDFLARE_API_TOKEN.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntryPoint } from './lib/cli.mjs';

/** R2 buckets (api writes PACKAGES, edge writes EVIDENCE; spec §7.1). */
export const BUCKETS = Object.freeze(['trace-packages-staging', 'trace-evidence-staging']);
/** The DLQ first: the main queue's consumer config names it. There is no quality or integrity queue. */
export const QUEUES = Object.freeze([
  'trace-session-mirror-dlq-staging',
  'trace-session-mirror-staging',
]);

const BUCKET_LOCATION = 'apac';
/**
 * Cloudflare's wording or code for "you already have this", per kind (R2 10004, Queues 11009).
 * Matched only in wrangler's error block on stderr (from its `[ERROR]` line on), never on stdout or
 * in a warning before it; a match is then confirmed with an info call (S6).
 */
const EXISTS_RE = Object.freeze({
  bucket: /already exists|\[code: 10004\]/i,
  queue: /already exists|\[code: 11009\]/i,
});

/** ANSI colour sequences: wrangler colours its output in CI, which splits `[ERROR]` (run 39489428243). */
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');
const plain = (text) => String(text ?? '').replace(ANSI_RE, '');

/** stderr (colours removed) from wrangler's first `[ERROR]` line to the end, or '' when there is none. */
const errorBlock = (result) => {
  const lines = plain(result.stderr).split(/\r?\n/);
  const at = lines.findIndex((l) => /\[ERROR\]/.test(l));
  return at < 0 ? '' : lines.slice(at).join('\n');
};

/** Runs one call; a throw becomes a spawn error, like spawnSync's own. */
const call = (run, args) => {
  try {
    return run(args);
  } catch (error) {
    return { status: null, stdout: '', stderr: '', error };
  }
};

/**
 * Confirms that an existing resource is the one the Workers bind to: a bucket by its JSON info
 * (same name, APAC location, which cannot change later), a queue by its exact Queue Name line.
 * Returns '' when confirmed, else the reason.
 */
function confirm(run, kind, name) {
  const args =
    kind === 'bucket'
      ? ['exec', 'wrangler', 'r2', 'bucket', 'info', name, '--json']
      : ['exec', 'wrangler', 'queues', 'info', name];
  const result = call(run, args);
  if (result.error || result.status !== 0) return 'its info call failed';
  const stdout = String(result.stdout ?? '');
  if (kind === 'queue') {
    const lines = stdout.split(/\r?\n/).map((l) => l.trim());
    return lines.includes(`Queue Name: ${name}`) ? '' : 'its info names another queue';
  }
  let info;
  try {
    info = JSON.parse(stdout);
  } catch {
    return 'its info is not JSON';
  }
  if (info === null || typeof info !== 'object' || Array.isArray(info)) {
    return 'its info is not an object';
  }
  if (info.name !== name) return 'its info names another bucket';
  const location = typeof info.location === 'string' ? info.location : '';
  if (location.toLowerCase() !== BUCKET_LOCATION) {
    return `location ${location || '(none)'} is not ${BUCKET_LOCATION}, and a location cannot change`;
  }
  return '';
}

/** First non-empty line of stderr (else stdout), colours removed, cut to 200 characters. */
const firstLine = (result) => {
  const text = `${plain(result.stderr)}\n${plain(result.stdout)}`;
  const line = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
};

/** Creates one resource; returns { violation } or { report }. */
function create(run, kind, name, args) {
  const result = call(run, args);
  if (!result.error && result.status === 0) return { report: `${kind} ${name}: created` };
  if (!result.error && result.status !== null && EXISTS_RE[kind].test(errorBlock(result))) {
    const why = confirm(run, kind, name);
    if (why === '') return { report: `${kind} ${name}: already exists (confirmed)` };
    return { violation: `${kind} ${name}: already exists but could not be confirmed (${why})` };
  }
  const why = result.error
    ? result.error.message
    : result.status === null
      ? `signal ${result.signal ?? 'unknown'}`
      : `exit ${result.status}`;
  const detail = result.error ? '' : firstLine(result);
  // The first line rarely says why (run 39486961836); the Cloudflare codes in the error block do. Codes only.
  const codes = [
    ...new Set([...errorBlock(result).matchAll(/\[code: (\d{1,6})\]/g)].map((m) => m[1])),
  ];
  const tail = codes.length > 0 ? `; Cloudflare codes ${codes.join(', ')}` : '';
  return {
    violation: `${kind} ${name}: create failed (${why})${detail ? `: ${detail}` : ''}${tail}`,
  };
}

/** Runs every create. `run(args)` returns a spawnSync-shaped result; it never gets a delete verb. */
export function ensureResources({ run }) {
  const violations = [];
  const report = [];
  const jobs = [
    ...BUCKETS.map((name) => [
      'bucket',
      name,
      ['exec', 'wrangler', 'r2', 'bucket', 'create', name, '--location', BUCKET_LOCATION],
    ]),
    ...QUEUES.map((name) => ['queue', name, ['exec', 'wrangler', 'queues', 'create', name]]),
  ];
  for (const [kind, name, args] of jobs) {
    const r = create(run, kind, name, args);
    if (r.violation) violations.push(r.violation);
    else report.push(r.report);
  }
  return { violations, report };
}

/** The real runner: pnpm exec wrangler in the repository root, no shell. */
export function wranglerRunner(root, spawn = spawnSync) {
  return (args) => spawn('pnpm', [...args], { cwd: root, encoding: 'utf8', shell: false });
}

/** CLI body; returns the exit code. */
export function main({ run, out = console.log, err = console.error }) {
  const { violations, report } = ensureResources({ run });
  for (const line of report) out(`ensure-staging-resources: ${line}`);
  for (const line of violations) err(`ensure-staging-resources: ${line}`);
  if (violations.length > 0) return 1;
  out('ensure-staging-resources: OK');
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exit(main({ run: wranglerRunner(root) }));
}
