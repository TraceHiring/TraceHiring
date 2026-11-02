// scripts/lib/hyperdrive.mjs (ADR-031 amendment 1; specs/d1-demo-slice.md revision 4o §7.1). Synthetic ids only.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LOGIN_ROLES } from '../lib/e2e-local-secrets.mjs';
import {
  CLOUDFLARE_ACCOUNT_ID,
  HYPERDRIVE_PLAN,
  HYPERDRIVE_SSLMODES,
  ORIGIN_CONNECTION_LIMIT,
  allHyperdriveProblems,
  bindingsFor,
  hyperdriveProblems,
} from '../lib/hyperdrive.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Made-up ids, built at run time.
const id = (n) => n.toString(16).padStart(2, '0').repeat(16);
const staging = (entries) => ({ env: { dev: {}, staging: { hyperdrive: entries } } });
const apiOk = () => staging([{ binding: 'API_DB', id: id(1) }]);
const jobsOk = () =>
  staging([
    { binding: 'JOBS_MIRROR_DB', id: id(2) },
    { binding: 'JOBS_QUALITY_DB', id: id(3) },
    { binding: 'JOBS_INTEGRITY_DB', id: id(4) },
  ]);
const STRICT = { requireStaging: true };

describe('HYPERDRIVE_PLAN', () => {
  it('gives each login role exactly one config and one binding, api one and jobs three', () => {
    expect(HYPERDRIVE_PLAN.map((p) => p.login).sort()).toEqual(
      LOGIN_ROLES.map((r) => r.login).sort(),
    );
    expect(bindingsFor('api').map((p) => p.binding)).toEqual(['API_DB']);
    expect(bindingsFor('jobs').map((p) => p.binding)).toEqual([
      'JOBS_MIRROR_DB',
      'JOBS_QUALITY_DB',
      'JOBS_INTEGRITY_DB',
    ]);
    expect(bindingsFor('edge')).toEqual([]);
  });

  it('names every config trace-staging-<login> and every binding uniquely', () => {
    for (const p of HYPERDRIVE_PLAN) {
      expect(p.config).toBe(`trace-staging-${p.login.replaceAll('_', '-')}`);
    }
    const bindings = HYPERDRIVE_PLAN.map((p) => p.binding);
    expect(new Set(bindings).size).toBe(bindings.length);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(HYPERDRIVE_PLAN)).toBe(true);
    for (const p of HYPERDRIVE_PLAN) expect(Object.isFrozen(p)).toBe(true);
    expect(Object.isFrozen(HYPERDRIVE_SSLMODES)).toBe(true);
  });

  it('allows only the verifying origin TLS modes and the minimum connection cap', () => {
    expect([...HYPERDRIVE_SSLMODES]).toEqual(['verify-full', 'verify-ca']);
    expect(ORIGIN_CONNECTION_LIMIT).toBe(5);
  });

  it('pins the account id of docs/infra/environments.md', () => {
    const doc = readFileSync(path.join(REPO, 'docs/infra/environments.md'), 'utf8');
    expect(doc).toContain(`account ID \`${CLOUDFLARE_ACCOUNT_ID}\``);
  });
});

describe('hyperdriveProblems', () => {
  it('accepts the exact plan with well-formed distinct ids', () => {
    expect(hyperdriveProblems('api', apiOk(), STRICT)).toEqual([]);
    expect(hyperdriveProblems('jobs', jobsOk(), STRICT)).toEqual([]);
    expect(hyperdriveProblems('edge', { env: { dev: {}, staging: {} } }, STRICT)).toEqual([]);
  });

  it('before the configs exist, accepts a staging block without hyperdrive unless the deploy requires it', () => {
    const none = { env: { dev: {}, staging: {} } };
    expect(hyperdriveProblems('api', none, { requireStaging: false })).toEqual([]);
    expect(hyperdriveProblems('api', none, STRICT)).toEqual([
      'api: env.staging has no hyperdrive bindings (API_DB)',
    ]);
  });

  it('refuses hyperdrive at the top level or in env.dev', () => {
    const cfg = { ...apiOk(), hyperdrive: [] };
    cfg.env.dev = { hyperdrive: [] };
    expect(hyperdriveProblems('api', cfg, STRICT)).toEqual([
      'api: hyperdrive at the top level',
      'api: hyperdrive in env.dev (local runs use the local database URL)',
    ]);
  });

  it('refuses a missing, extra, renamed or reordered binding', () => {
    expect(
      hyperdriveProblems('jobs', staging([{ binding: 'JOBS_MIRROR_DB', id: id(2) }]), STRICT),
    ).toEqual([
      'jobs: env.staging.hyperdrive must be exactly [JOBS_MIRROR_DB, JOBS_QUALITY_DB, JOBS_INTEGRITY_DB] in this order',
    ]);
    expect(
      hyperdriveProblems('api', staging([{ binding: 'HYPERDRIVE', id: id(1) }]), STRICT),
    ).toEqual(['api: env.staging.hyperdrive must be exactly [API_DB] in this order']);
    expect(hyperdriveProblems('edge', staging([{ binding: 'API_DB', id: id(1) }]), STRICT)).toEqual(
      ['edge: env.staging.hyperdrive must be exactly [] in this order'],
    );
  });

  it('refuses a localConnectionString, a malformed id and a reused id', () => {
    const local = staging([{ binding: 'API_DB', id: id(1), localConnectionString: 'x' }]);
    expect(hyperdriveProblems('api', local, STRICT)).toEqual([
      'api: hyperdrive API_DB must have only binding and id (no localConnectionString)',
    ]);
    for (const bad of ['', 'ABCDEF'.repeat(5) + 'AB', id(1).slice(1), 7, undefined]) {
      expect(
        hyperdriveProblems('api', staging([{ binding: 'API_DB', id: bad }]), STRICT),
      ).toContain('api: hyperdrive API_DB has no 32-character lower-case hex id');
    }
    const reused = jobsOk();
    reused.env.staging.hyperdrive[2].id = id(2);
    expect(hyperdriveProblems('jobs', reused, STRICT)).toEqual([
      "jobs: hyperdrive JOBS_INTEGRITY_DB reuses another binding's id (one config per login role)",
    ]);
  });

  it('refuses a non-list and a missing staging block', () => {
    expect(hyperdriveProblems('api', { env: { staging: { hyperdrive: {} } } }, STRICT)).toEqual([
      'api: env.staging.hyperdrive is not a list',
    ]);
    expect(hyperdriveProblems('api', { env: {} }, STRICT)).toEqual(['api: no env.staging block']);
    expect(hyperdriveProblems('api', null, STRICT)).toEqual(['api: no wrangler config']);
  });
});

describe('allHyperdriveProblems', () => {
  it('passes the whole plan and refuses one id across two Workers', () => {
    const edge = { env: { dev: {}, staging: {} } };
    expect(allHyperdriveProblems({ edge, api: apiOk(), jobs: jobsOk() }, STRICT)).toEqual([]);
    const jobs = jobsOk();
    jobs.env.staging.hyperdrive[0].id = id(1);
    expect(allHyperdriveProblems({ edge, api: apiOk(), jobs }, STRICT)).toEqual([
      'jobs: hyperdrive JOBS_MIRROR_DB reuses an id of api',
    ]);
  });
});
