#!/usr/bin/env node
// Staging smoke test (spec specs/m0-foundations.md §7.2 step 8, AT-11, AT-22-staging).
//   node scripts/smoke-staging.mjs --wrangler-output <file> --sha <40-hex commit>
// The URLs come from wrangler's ND-JSON output file (WRANGLER_OUTPUT_FILE_PATH, set on the deploy
// steps): one `deploy` entry per staging Worker (its workers.dev target), and one `pages-deploy`
// plus one `pages-deploy-detailed` entry per app (the deployment URL, its environment and the
// project's production branch). Entry shapes as written by wrangler 4.149.0
// (node_modules/wrangler/wrangler-dist/cli.js: writeOutput, deploy(), pages deploy).
// Fails (exit 1) unless:
//   - every staging Worker and app was deployed exactly once in env staging, to an https origin
//     on the expected host (<worker>.<account>.workers.dev; [<deployment>.]<project>[-<suffix>]
//     .pages.dev), and nothing else was deployed
//   - every Pages deploy went to the `production` environment of a project whose production
//     branch is `main` (a Preview deploy leaves the production alias on the old build); the
//     alias (https://<project>.pages.dev) is smoke-tested too, with the same checks
//   - each Worker's GET /health is 200 with cache-control no-store and a body that parses with
//     HealthResponse (packages/shared/src/contracts.ts; strict), for that service, version == sha
//   - each app's GET /version.json is 200 with a body that parses with AppVersionFile, for that
//     app, version == sha
//   - the §10.3 headers are present and correct on both /version.json and / of each app (the rules
//     of scripts/check-headers.mjs, applied to the served headers)
// Requests never follow redirects (a 3xx fails), time out, and read at most 64 KiB of a body (a
// larger content-length is refused unread; a stream is cancelled at the cap). An endpoint that
// fails is retried (a fresh deploy can take a few seconds to serve everywhere) until an overall
// deadline (6 min); the last attempt's problems are reported, and checks the deadline cut off are
// listed as not run. Bodies are never printed; only status codes, schema issue
// paths and codes, and header names/values that this repository itself sets.
import { readFileSync } from 'node:fs';
import { AppVersionFile, HealthResponse } from '../packages/shared/src/contracts.ts';
import { MANAGED, checkHeadersFile } from './check-headers.mjs';
import { isEntryPoint } from './lib/cli.mjs';

/** Staging Worker names (wrangler.jsonc env.staging.name), by service. */
export const WORKER_NAMES = Object.freeze({
  edge: 'trace-edge-staging',
  jobs: 'trace-jobs-staging',
  api: 'trace-api-staging',
});
/** Staging Pages projects (§7.2 step 7), by app. */
export const APP_PROJECTS = Object.freeze({
  candidate: 'trace-candidate-staging',
  recruiter: 'trace-recruiter-staging',
});

export const SHA_RE = /^[0-9a-f]{40}$/;
export const MAX_BODY_BYTES = 65_536;
export const DEFAULTS = Object.freeze({
  attempts: 12,
  delayMs: 5_000,
  timeoutMs: 15_000,
  /** Overall limit for the whole smoke; the job step's timeout-minutes (8) sits above it. */
  deadlineMs: 360_000,
});

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** null when `raw` is a bare https origin whose host matches `hostRe`, else why not. */
function originProblem(raw, hostRe) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return 'is not a URL';
  }
  if (u.protocol !== 'https:') return 'is not https';
  if (u.username !== '' || u.password !== '') return 'carries credentials';
  if (u.port !== '') return 'names a port';
  if (u.pathname !== '/' || u.search !== '' || u.hash !== '') return 'is not a bare origin';
  if (!hostRe.test(u.hostname)) return 'is on another host';
  return null;
}

/** null when `url` is the workers.dev origin of the staging Worker for `service`. */
export function checkWorkerUrl(service, url) {
  const name = WORKER_NAMES[service];
  const why = originProblem(url, new RegExp(`^${escapeRe(name)}\\.[a-z0-9-]+\\.workers\\.dev$`));
  return why === null
    ? null
    : `${name}: URL ${String(url)} ${why}; it is not https://${name}.<account-subdomain>.workers.dev`;
}

/** null when `url` is a pages.dev origin of the staging project for `app`. */
export function checkAppUrl(app, url) {
  const project = APP_PROJECTS[app];
  const why = originProblem(
    url,
    new RegExp(`^(?:[a-z0-9]+\\.)?${escapeRe(project)}(?:-[a-z0-9]+)?\\.pages\\.dev$`),
  );
  return why === null
    ? null
    : `${project}: URL ${String(url)} ${why}; it is not https://[<deployment>.]${project}[-<suffix>].pages.dev`;
}

const byValue = (obj) => new Map(Object.entries(obj).map(([k, v]) => [v, k]));

/**
 * Reads wrangler's ND-JSON output file.
 * @returns {{ workers: Record<string, string>, apps: Record<string, string>, problems: string[] }}
 */
export function parseWranglerOutput(text) {
  const problems = [];
  const workerOf = byValue(WORKER_NAMES);
  const appOf = byValue(APP_PROJECTS);
  const deploys = new Map(); // worker name → entries
  const pages = new Map(); // project → pages-deploy entries
  const details = new Map(); // project → pages-deploy-detailed entries
  String(text ?? '')
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (line.trim() === '') return;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        entry = null;
      }
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        problems.push(`wrangler output: line ${i + 1}: not a JSON object`);
        return;
      }
      if (entry.type === 'deploy') {
        const name = String(entry.worker_name);
        if (!workerOf.has(name)) {
          problems.push(`unexpected deploy entry for Worker ${name} (only the staging Workers)`);
          return;
        }
        deploys.set(name, [...(deploys.get(name) ?? []), entry]);
      } else if (entry.type === 'pages-deploy' || entry.type === 'pages-deploy-detailed') {
        const project = String(entry.pages_project);
        if (!appOf.has(project)) {
          problems.push(`unexpected ${entry.type} entry for project ${project}`);
          return;
        }
        const map = entry.type === 'pages-deploy' ? pages : details;
        map.set(project, [...(map.get(project) ?? []), entry]);
      }
    });

  const workers = {};
  for (const [service, name] of Object.entries(WORKER_NAMES)) {
    const entries = deploys.get(name) ?? [];
    if (entries.length !== 1) {
      problems.push(
        entries.length === 0
          ? `no deploy entry for ${name} in the wrangler output`
          : `${entries.length} deploy entries for ${name} (expected one)`,
      );
      continue;
    }
    const [e] = entries;
    if (e.wrangler_environment !== 'staging') {
      problems.push(`${name} was deployed with --env ${e.wrangler_environment}, not staging`);
      continue;
    }
    const targets = (Array.isArray(e.targets) ? e.targets : []).filter(
      (t) => typeof t === 'string' && /workers\.dev$/.test(t),
    );
    if (targets.length !== 1) {
      problems.push(`${name}: expected exactly one workers.dev target (found ${targets.length})`);
      continue;
    }
    const why = checkWorkerUrl(service, targets[0]);
    if (why) problems.push(why);
    else workers[service] = targets[0];
  }
  const apps = {};
  const aliases = {};
  for (const [app, project] of Object.entries(APP_PROJECTS)) {
    const entries = pages.get(project) ?? [];
    if (entries.length !== 1) {
      problems.push(
        entries.length === 0
          ? `no pages-deploy entry for ${project} in the wrangler output`
          : `${entries.length} pages-deploy entries for ${project} (expected one)`,
      );
      continue;
    }
    const [e] = entries;
    // A deploy to a project whose production branch is not `main` is a Preview: the production
    // alias keeps serving the old build while the hash URL serves the new one (S3B-2). The
    // `pages-deploy-detailed` entry (wrangler cli.js, Pages deploy: environment,
    // production_branch) is what tells them apart.
    const detail = details.get(project) ?? [];
    if (detail.length !== 1) {
      problems.push(
        detail.length === 0
          ? `no pages-deploy-detailed entry for ${project} in the wrangler output`
          : `${detail.length} pages-deploy-detailed entries for ${project} (expected one)`,
      );
      continue;
    }
    const [d] = detail;
    let bad = false;
    if (d.deployment_id !== e.deployment_id || d.url !== e.url) {
      problems.push(
        `${project}: pages-deploy-detailed is for another deployment than pages-deploy`,
      );
      bad = true;
    }
    if (d.environment !== 'production') {
      problems.push(
        d.environment === 'preview'
          ? `${project}: deployed to the preview environment, not production`
          : `${project}: deployed to environment ${String(d.environment)}, expected production`,
      );
      bad = true;
    }
    if (d.production_branch !== 'main') {
      problems.push(
        `${project}: production branch is ${String(d.production_branch)}, expected main`,
      );
      bad = true;
    }
    const why = checkAppUrl(app, e.url);
    if (why) {
      problems.push(why);
      bad = true;
    }
    if (bad) continue;
    const origin = new URL(e.url);
    apps[app] = origin.origin;
    // The production alias is the project's own pages.dev host: the deployment URL without its
    // leading <deployment> label (which is absent when wrangler already reports the alias).
    const labels = origin.hostname.split('.');
    aliases[app] = `https://${(labels.length === 4 ? labels.slice(1) : labels).join('.')}`;
  }
  return { workers, apps, aliases, problems };
}

/** Zod issues as `path: code` only (never the received value). */
const issueText = (error) =>
  error.issues
    .slice(0, 5)
    .map((i) => `${i.path.length > 0 ? i.path.join('.') : '(root)'}: ${i.code}`)
    .join(', ');

/**
 * GET `url` without following redirects. Returns { res } for a 200, else { problem }.
 * The body is left unread.
 */
async function get(fetch, url, timeoutMs) {
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json, text/html;q=0.9' },
    });
  } catch (err) {
    return { problem: `request failed (${err?.name ?? 'error'})` };
  }
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel();
    return { problem: `redirect (HTTP ${res.status}); redirects are not followed` };
  }
  if (res.status !== 200) {
    await res.body?.cancel();
    return { problem: `HTTP ${res.status}` };
  }
  return { res };
}

/**
 * Reads a JSON body of at most MAX_BODY_BYTES, as a stream: a declared content-length over the cap
 * is refused without reading, and otherwise the read is cancelled the moment the count passes the
 * cap, so an endless body never fills memory (S3B-3). Returns { value } or { problem }.
 */
async function readJson(res) {
  const tooLarge = { problem: `body is larger than ${MAX_BODY_BYTES} bytes` };
  const declared = res.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared.trim()) && Number(declared) > MAX_BODY_BYTES) {
    await res.body?.cancel().catch(() => {});
    return tooLarge;
  }
  const chunks = [];
  if (res.body) {
    const reader = res.body.getReader();
    let total = 0;
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
  const buf = Buffer.concat(chunks);
  try {
    return { value: JSON.parse(buf.toString('utf8')) };
  } catch {
    return { problem: 'body is not JSON' };
  }
}

/** Problems with one Worker's /health (plain messages, no prefix). */
export async function smokeWorker({ service, url, sha, fetch, timeoutMs = DEFAULTS.timeoutMs }) {
  const { res, problem } = await get(fetch, `${url}/health`, timeoutMs);
  if (problem) return [problem];
  const problems = [];
  const cc = res.headers.get('cache-control') ?? '';
  if (!/(^|,)\s*no-store\s*(,|$)/i.test(cc)) problems.push('cache-control must include no-store');
  const body = await readJson(res);
  if (body.problem) return [...problems, body.problem];
  const parsed = HealthResponse.safeParse(body.value);
  if (!parsed.success) {
    return [...problems, `body does not match HealthResponse (${issueText(parsed.error)})`];
  }
  if (parsed.data.service !== service)
    problems.push(`service is ${parsed.data.service}, expected ${service}`);
  if (parsed.data.version !== sha)
    problems.push(`version is ${parsed.data.version}, expected ${sha}`);
  return problems;
}

/** §10.3 problems in a response's headers, via check-headers' rules for a `/*` rule. */
function headerProblems(app, headers) {
  const text = [
    '/*',
    ...MANAGED.flatMap((name) => {
      const value = headers.get(name);
      return value === null ? [] : [`  ${name}: ${value}`];
    }),
    '',
  ].join('\n');
  return checkHeadersFile(app, text).map((m) => m.replace(/^\/\* is missing /, 'missing header '));
}

/**
 * Problems with one app (each prefixed with `<name> <path>:`; `name` is the app, or e.g.
 * `candidate alias` when `url` is the project's production alias).
 */
export async function smokeApp({
  app,
  url,
  sha,
  fetch,
  timeoutMs = DEFAULTS.timeoutMs,
  name = app,
}) {
  const problems = [];
  const v = await get(fetch, `${url}/version.json`, timeoutMs);
  if (v.problem) problems.push(`${name} /version.json: ${v.problem}`);
  else {
    for (const m of headerProblems(app, v.res.headers))
      problems.push(`${name} /version.json: ${m}`);
    const body = await readJson(v.res);
    if (body.problem) problems.push(`${name} /version.json: ${body.problem}`);
    else {
      const parsed = AppVersionFile.safeParse(body.value);
      if (!parsed.success) {
        problems.push(
          `${name} /version.json: body does not match AppVersionFile (${issueText(parsed.error)})`,
        );
      } else {
        if (parsed.data.app !== app)
          problems.push(`${name} /version.json: app is ${parsed.data.app}, expected ${app}`);
        if (parsed.data.version !== sha)
          problems.push(
            `${name} /version.json: version is ${parsed.data.version}, expected ${sha}`,
          );
      }
    }
  }
  const root = await get(fetch, `${url}/`, timeoutMs);
  if (root.problem) problems.push(`${name} /: ${root.problem}`);
  else {
    await root.res.body?.cancel();
    for (const m of headerProblems(app, root.res.headers)) problems.push(`${name} /: ${m}`);
  }
  return problems;
}

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Checks every target, retrying each failing one, within one overall deadline (S3B-4): once
 * `deadlineMs` has passed no further attempt starts, and checks not yet started are reported as
 * not run, so the job always ends with a report instead of hitting its timeout.
 * @param targets {{ workers: Record<string, string>, apps: Record<string, string>,
 *                   aliases: Record<string, string> }}
 */
export async function runSmoke({
  targets,
  sha,
  fetch,
  sleep = realSleep,
  now = Date.now,
  attempts = DEFAULTS.attempts,
  delayMs = DEFAULTS.delayMs,
  timeoutMs = DEFAULTS.timeoutMs,
  deadlineMs = DEFAULTS.deadlineMs,
}) {
  const started = now();
  const deadlineText = `smoke deadline of ${deadlineMs / 1000} s`;
  const checks = [
    ...Object.keys(WORKER_NAMES).map((service) => ({
      label: `${service} /health`,
      prefix: `${service} /health: `,
      run: () => smokeWorker({ service, url: targets.workers[service], sha, fetch, timeoutMs }),
    })),
    ...Object.keys(APP_PROJECTS).map((app) => ({
      label: `${app} /version.json and headers`,
      prefix: '',
      run: () => smokeApp({ app, url: targets.apps[app], sha, fetch, timeoutMs }),
    })),
    // The production alias must serve the same build as the deployment URL (S3B-2).
    ...Object.keys(APP_PROJECTS).map((app) => ({
      label: `${app} production alias /version.json and headers`,
      prefix: '',
      run: () =>
        smokeApp({
          app,
          url: targets.aliases[app],
          sha,
          fetch,
          timeoutMs,
          name: `${app} alias`,
        }),
    })),
  ];
  const violations = [];
  const report = [];
  for (const c of checks) {
    if (now() - started >= deadlineMs) {
      violations.push(`${c.label}: not run: ${deadlineText} was exceeded`);
      continue;
    }
    let problems = [];
    let outOfTime = false;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      problems = await c.run();
      if (problems.length === 0) break;
      if (now() - started >= deadlineMs) {
        outOfTime = true;
        break;
      }
      if (attempt < attempts) await sleep(delayMs);
    }
    if (problems.length === 0) report.push(`${c.label}: ok`);
    else {
      const why = outOfTime ? `${deadlineText} exceeded` : `after ${attempts} attempts`;
      violations.push(`${c.prefix}${problems.join('; ')} (${why})`);
    }
  }
  return { violations, report };
}

/** Parses `--wrangler-output <file> --sha <sha>`. Returns { file, sha } or { error }. */
function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--wrangler-output' || a === '--sha') {
      if (i + 1 >= argv.length) return { error: `${a} needs a value` };
      opts[a.slice(2)] = argv[++i];
    } else return { error: `unknown argument ${a}` };
  }
  if (!opts['wrangler-output']) return { error: '--wrangler-output <file> is required' };
  if (!opts.sha || !SHA_RE.test(opts.sha))
    return { error: '--sha must be the 40-character lower-case hex commit SHA' };
  return { file: opts['wrangler-output'], sha: opts.sha };
}

/** CLI body; resolves to the exit code. */
export async function main({
  argv,
  readFile = (p) => readFileSync(p, 'utf8'),
  fetch = globalThis.fetch,
  sleep = realSleep,
  now = Date.now,
  out = console.log,
  err = console.error,
}) {
  const tag = 'smoke-staging';
  const args = parseArgs(argv);
  if (args.error) {
    err(`${tag}: ${args.error}`);
    err(`${tag}: usage: node scripts/smoke-staging.mjs --wrangler-output <file> --sha <sha>`);
    return 1;
  }
  let text;
  try {
    text = readFile(args.file);
  } catch (e) {
    err(`${tag}: cannot read the wrangler output file (${e?.code ?? e?.message ?? 'error'})`);
    return 1;
  }
  const targets = parseWranglerOutput(text);
  for (const p of targets.problems) err(`${tag}: ${p}`);
  if (targets.problems.length > 0) return 1;
  const { violations, report } = await runSmoke({ targets, sha: args.sha, fetch, sleep, now });
  for (const line of report) out(`${tag}: ${line}`);
  for (const line of violations) err(`${tag}: ${line}`);
  if (violations.length > 0) return 1;
  out(`${tag}: OK (${report.length} endpoints at ${args.sha})`);
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await main({ argv: process.argv.slice(2) });
}
