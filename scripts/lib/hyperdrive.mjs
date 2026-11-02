// The staging Hyperdrive plan (ADR-031 amendment 1; specs/d1-demo-slice.md revision 4o, §3 "Roles", §7.1).
// On staging the Workers reach Postgres only through Cloudflare Hyperdrive: Cloudflare's own TLS client trusts only
// public roots, and Supabase Postgres presents a certificate under its private "Supabase Root 2021 CA", which
// Hyperdrive verifies with the uploaded CA. One Hyperdrive config per database login role (MT-14: no login reaches
// two trace_* roles), one binding per config. Names and ids here are not secrets: a config id only works inside the
// account that owns it, and Cloudflare publishes it in every wrangler config. Pure data and checks; no I/O.
import { LOGIN_ROLES } from './e2e-local-secrets.mjs';

/**
 * The staging Cloudflare account (public: docs/infra/environments.md "Accounts"; a test keeps the two equal). The
 * ops script talks to this account only.
 */
export const CLOUDFLARE_ACCOUNT_ID = '94fef930c2ecd2e37fbd5dc3151d99ba';

/** worker: the folder key of scripts/check-staging-secrets.mjs WORKER_DIRS; binding: the env.staging binding name. */
export const HYPERDRIVE_PLAN = Object.freeze([
  Object.freeze({
    worker: 'api',
    binding: 'API_DB',
    login: 'api_login',
    config: 'trace-staging-api-login',
  }),
  Object.freeze({
    worker: 'jobs',
    binding: 'JOBS_MIRROR_DB',
    login: 'jobs_mirror_login',
    config: 'trace-staging-jobs-mirror-login',
  }),
  Object.freeze({
    worker: 'jobs',
    binding: 'JOBS_QUALITY_DB',
    login: 'jobs_quality_login',
    config: 'trace-staging-jobs-quality-login',
  }),
  Object.freeze({
    worker: 'jobs',
    binding: 'JOBS_INTEGRITY_DB',
    login: 'jobs_integrity_login',
    config: 'trace-staging-jobs-integrity-login',
  }),
]);

/** A Hyperdrive config id as Cloudflare issues it. */
export const HYPERDRIVE_ID_RE = /^[0-9a-f]{32}$/;

/**
 * The origin TLS modes the ops script may ask Hyperdrive for. Both verify the chain against the uploaded Supabase CA;
 * `require` (no verification) is never allowed.
 */
export const HYPERDRIVE_SSLMODES = Object.freeze(['verify-full', 'verify-ca']);

/**
 * Each Hyperdrive config's origin connection cap. To confirm on staging (database review Minor 4): that Cloudflare
 * accepts 5 (the create call fails otherwise), and that 4 x 5 stays within the Supabase session pooler's limits
 * (believed per user and database). The staging e2e run records both.
 */
export const ORIGIN_CONNECTION_LIMIT = 5;

{
  const planned = HYPERDRIVE_PLAN.map((p) => p.login).sort();
  const logins = LOGIN_ROLES.map((r) => r.login).sort();
  if (planned.join() !== logins.join()) {
    throw new Error('hyperdrive: the plan must give each login role exactly one config');
  }
}

/** The bindings one Worker must carry in env.staging, in plan order. */
export const bindingsFor = (worker) => HYPERDRIVE_PLAN.filter((p) => p.worker === worker);

/**
 * Problems with the `hyperdrive` entries of one Worker's parsed wrangler.jsonc (worker: 'api' | 'jobs' | 'edge').
 * `requireStaging` false accepts a staging block with no `hyperdrive` key yet (before the founder has created the
 * configs and their ids are committed); true (the deploy) requires them. Whatever is present must be exact: the
 * plan's bindings with well-formed, distinct ids, no localConnectionString (a credential), and no `hyperdrive` key
 * at the top level or in env.dev (local runs use the local-only URL secrets).
 */
export function hyperdriveProblems(worker, config, { requireStaging }) {
  const problems = [];
  if (config === null || typeof config !== 'object') return [`${worker}: no wrangler config`];
  if (Object.hasOwn(config, 'hyperdrive')) problems.push(`${worker}: hyperdrive at the top level`);
  if (Object.hasOwn(config.env?.dev ?? {}, 'hyperdrive')) {
    problems.push(`${worker}: hyperdrive in env.dev (local runs use the local database URL)`);
  }
  const staging = config.env?.staging;
  const expected = bindingsFor(worker);
  if (staging === undefined) return [...problems, `${worker}: no env.staging block`];
  if (!Object.hasOwn(staging, 'hyperdrive')) {
    if (requireStaging && expected.length > 0) {
      problems.push(
        `${worker}: env.staging has no hyperdrive bindings (${expected.map((e) => e.binding).join(', ')})`,
      );
    }
    return problems;
  }
  const list = staging.hyperdrive;
  if (!Array.isArray(list)) return [...problems, `${worker}: env.staging.hyperdrive is not a list`];
  const names = list.map((e) => (e && typeof e === 'object' ? e.binding : undefined));
  const want = expected.map((e) => e.binding);
  if (names.join() !== want.join()) {
    problems.push(
      `${worker}: env.staging.hyperdrive must be exactly [${want.join(', ')}] in this order`,
    );
  }
  const ids = new Set();
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object') continue;
    const label = `${worker}: hyperdrive ${String(entry.binding)}`;
    const keys = Object.keys(entry).sort();
    if (keys.join() !== 'binding,id') {
      problems.push(`${label} must have only binding and id (no localConnectionString)`);
    }
    if (typeof entry.id !== 'string' || !HYPERDRIVE_ID_RE.test(entry.id)) {
      problems.push(`${label} has no 32-character lower-case hex id`);
    } else if (ids.has(entry.id)) {
      problems.push(`${label} reuses another binding's id (one config per login role)`);
    } else ids.add(entry.id);
  }
  return problems;
}

/** hyperdriveProblems for every Worker ({ edge, api, jobs } parsed configs), plus one id per config across Workers. */
export function allHyperdriveProblems(configs, opts) {
  const problems = [];
  const seen = new Map();
  for (const [worker, config] of Object.entries(configs)) {
    problems.push(...hyperdriveProblems(worker, config, opts));
    for (const entry of config?.env?.staging?.hyperdrive ?? []) {
      if (typeof entry?.id !== 'string') continue;
      const other = seen.get(entry.id);
      if (other !== undefined && other !== worker) {
        problems.push(`${worker}: hyperdrive ${String(entry.binding)} reuses an id of ${other}`);
      }
      seen.set(entry.id, worker);
    }
  }
  return problems;
}
