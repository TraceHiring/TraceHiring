#!/usr/bin/env node
// Staging R2 buckets and Queues, created only if missing (specs/d1-demo-slice.md §7.1;
// docs/reviews/D1-security-review-bindings.md F5). Runs in the deploy-staging job before any Worker
// is deployed, because the Workers' bindings and the jobs consumer name these resources.
// `wrangler ... create` is called for each name; an "already exists" answer counts as success, so a
// re-run is idempotent. Any other failure fails the deploy. Nothing is ever deleted, listed or
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
/** Cloudflare's wording and codes for "you already have this" (R2 10004, Queues 11009). */
const EXISTS_RE = /already exists|\[code: (?:10004|11009)\]/i;

/** First non-empty line of stderr (else stdout), cut to 200 characters. */
const firstLine = (result) => {
  const text = `${result.stderr ?? ''}\n${result.stdout ?? ''}`;
  const line = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
};

/** Creates one resource; returns { violation } or { report }. */
function create(run, kind, name, args) {
  let result;
  try {
    result = run(args);
  } catch (error) {
    result = { status: null, stdout: '', stderr: '', error };
  }
  if (!result.error && result.status === 0) return { report: `${kind} ${name}: created` };
  const output = `${result.stderr ?? ''}\n${result.stdout ?? ''}`;
  if (!result.error && EXISTS_RE.test(output)) return { report: `${kind} ${name}: already exists` };
  const why = result.error
    ? result.error.message
    : result.status === null
      ? `signal ${result.signal ?? 'unknown'}`
      : `exit ${result.status}`;
  const detail = result.error ? '' : firstLine(result);
  return { violation: `${kind} ${name}: create failed (${why})${detail ? `: ${detail}` : ''}` };
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
