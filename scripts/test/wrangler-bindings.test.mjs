// D1 Wave 0: the three wrangler.jsonc files carry exactly the bindings of specs/d1-demo-slice.md
// §4.2 ("Bindings per wrangler.jsonc") in their `dev` and `staging` env blocks (§7.1, L-10, L-11).
// Only binding names, resource names and non-secret var names are checked; no value is a secret.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WORKERS_OBSERVABILITY, parseJsonc } from '../check-boundaries.mjs';
import { PENDING_BINDINGS, hyperdriveProblems } from '../lib/hyperdrive.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (dir) => parseJsonc(readFileSync(path.join(REPO, dir, 'wrangler.jsonc'), 'utf8'));
const CONFIGS = {
  edge: load('workers/edge'),
  api: load('services/api'),
  jobs: load('workers/jobs'),
};
const ENVS = ['dev', 'staging'];
const STAGING_SUBDOMAIN = 'abhayraj.workers.dev';

/** §4.2 table, per Worker. `<env>` is substituted per env block. */
const EXPECTED = {
  edge: {
    durableObjects: { SESSION: 'SessionDO', OTP: 'InviteOtpDO' },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['SessionDO', 'InviteOtpDO'] }],
    r2: { PACKAGES: 'trace-packages-<env>', EVIDENCE: 'trace-evidence-<env>' },
    producers: { MIRROR_QUEUE: 'trace-session-mirror-<env>' },
    consumers: [],
    services: [{ binding: 'API', service: 'trace-api-<env>', entrypoint: 'CandidateRpc' }],
    vars: ['VERSION', 'CANDIDATE_TOKEN_PUBLIC_JWK', 'CANDIDATE_APP_ORIGIN', 'MIRROR_TRANSPORT'],
    crons: undefined,
    // ADR-032 (OPEN-13): the link-route limit, one namespace per env so counters are never shared.
    ratelimits: [
      { name: 'LINK_LIMITER', namespace_id: '<ns>', simple: { limit: 300, period: 10 } },
    ],
  },
  api: {
    durableObjects: { OUTBOX: 'DemoOutboxDO', MEDIA_LINKS: 'MediaLinkDO' },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['DemoOutboxDO', 'MediaLinkDO'] }],
    r2: { PACKAGES: 'trace-packages-<env>', EVIDENCE: 'trace-evidence-<env>' },
    producers: {},
    consumers: [],
    services: [],
    vars: [
      'VERSION',
      'CANDIDATE_TOKEN_KID',
      'CANDIDATE_TOKEN_PUBLIC_JWK',
      'CANDIDATE_APP_ORIGIN',
      'ALLOWED_ORIGINS',
      'TRACE_ENV',
      'DEMO_OUTBOX',
      'SENTRY_DSN_WORKERS',
      'SUPABASE_URL',
      'SUPABASE_PUBLISHABLE_KEY',
    ],
    crons: undefined,
    ratelimits: [],
  },
  jobs: {
    durableObjects: {},
    migrations: undefined,
    r2: { EVIDENCE: 'trace-evidence-<env>' },
    producers: { MIRROR_QUEUE: 'trace-session-mirror-<env>' },
    consumers: [
      {
        queue: 'trace-session-mirror-<env>',
        max_batch_size: 10,
        max_retries: 5,
        dead_letter_queue: 'trace-session-mirror-dlq-<env>',
      },
    ],
    services: [],
    vars: ['VERSION', 'TRACE_ENV', 'SENTRY_DSN_WORKERS'],
    crons: ['* * * * *'],
    ratelimits: [],
  },
};

/** ADR-032: the LINK_LIMITER namespace id per env (unique, so dev and staging never share counters). */
const NAMESPACE = { dev: '1101', staging: '1102' };
const sub = (value, env) =>
  JSON.parse(JSON.stringify(value).replaceAll('<env>', env).replaceAll('<ns>', NAMESPACE[env]));
const block = (worker, env) => CONFIGS[worker].env[env];
const names = (list, key) => (list ?? []).map((entry) => entry[key]);
const sorted = (list) => [...list].sort();

describe.each(Object.keys(EXPECTED))('%s wrangler.jsonc (spec §4.2)', (worker) => {
  describe.each(ENVS)('env.%s', (env) => {
    const exp = EXPECTED[worker];
    const cfg = () => block(worker, env);

    it('is named trace-<worker>-<env>', () => {
      expect(cfg().name).toBe(`trace-${worker === 'api' ? 'api' : worker}-${env}`);
    });

    it('binds exactly the Durable Objects of the table', () => {
      const bound = Object.fromEntries(
        (cfg().durable_objects?.bindings ?? []).map((b) => [b.name, b.class_name]),
      );
      expect(bound).toEqual(exp.durableObjects);
      for (const b of cfg().durable_objects?.bindings ?? []) {
        expect(b.script_name, `${b.name} must live in this Worker`).toBeUndefined();
      }
    });

    it('declares migration v1 with new_sqlite_classes only (SQLite-backed)', () => {
      const migrations = cfg().migrations;
      expect(migrations).toEqual(exp.migrations);
      for (const m of migrations ?? []) expect(m).not.toHaveProperty('new_classes');
    });

    it('binds exactly the R2 buckets of the table', () => {
      const bound = Object.fromEntries(
        (cfg().r2_buckets ?? []).map((b) => [b.binding, b.bucket_name]),
      );
      expect(bound).toEqual(sub(exp.r2, env));
    });

    it('has the queue producers of the table', () => {
      const bound = Object.fromEntries(
        (cfg().queues?.producers ?? []).map((p) => [p.binding, p.queue]),
      );
      expect(bound).toEqual(sub(exp.producers, env));
    });

    it('has the queue consumers of the table (batch 10, 5 retries, a DLQ)', () => {
      expect(cfg().queues?.consumers ?? []).toEqual(sub(exp.consumers, env));
    });

    it('has the service bindings of the table', () => {
      expect(cfg().services ?? []).toEqual(sub(exp.services, env));
    });

    it('has the rate limits of the table (ADR-032)', () => {
      expect(cfg().ratelimits ?? []).toEqual(sub(exp.ratelimits, env));
    });

    it('has the cron triggers of the table', () => {
      expect(cfg().triggers?.crons).toEqual(exp.crons);
    });

    it('has exactly the vars of the table', () => {
      expect(sorted(Object.keys(cfg().vars ?? {}))).toEqual(sorted(exp.vars));
    });

    it('binds no other resource kind', () => {
      const allowed = new Set([
        'name',
        'workers_dev',
        'vars',
        'durable_objects',
        'migrations',
        'r2_buckets',
        'queues',
        'services',
        'triggers',
        'ratelimits',
        // ADR-031 amendment 1: the database logins, staging only (checked below).
        ...(env === 'staging' ? ['hyperdrive'] : []),
      ]);
      for (const key of Object.keys(cfg()))
        expect(allowed.has(key), `env.${env}.${key}`).toBe(true);
    });
  });

  // ADR-031 amendment 1 (revision 4o): staging reaches Postgres only through one Hyperdrive binding per login role;
  // dev and the top level have none (the local stack uses the loopback URL secrets). The founder created the four
  // configs on 2026-10-22 and their ids are committed, so staging must carry them, exact (the deploy's
  // check-deploy-vars applies the same rule). M1 R5-11 (DC-M1-6) adds JOBS_AUTHORING_DB and JOBS_ADMIN_DB, whose
  // configs the founder creates at the next staging go-ahead: until then they are PENDING_BINDINGS and absent here,
  // and the deploy check (no allowPending) refuses a staging deploy without them.
  it('carries exactly the Hyperdrive bindings of scripts/lib/hyperdrive.mjs, staging only', () => {
    expect(
      hyperdriveProblems(worker, CONFIGS[worker], { requireStaging: true, allowPending: true }),
    ).toEqual([]);
  });

  it('commits no binding that is still marked pending (empty PENDING_BINDINGS once the ids land)', () => {
    for (const env of ENVS) {
      const bound = names(block(worker, env).hyperdrive, 'binding');
      for (const b of PENDING_BINDINGS) expect(bound, `env.${env}`).not.toContain(b);
    }
  });

  it('keeps observability exactly as rule 8 requires, with no env override', () => {
    expect(CONFIGS[worker].observability).toEqual(WORKERS_OBSERVABILITY);
    for (const env of ENVS) expect(block(worker, env)).not.toHaveProperty('observability');
  });

  it('names no secret-looking var and holds no credential value', () => {
    const SECRET_NAME = /PRIVATE|SECRET|PASSWORD|HMAC|DB_URL|SERVICE_ROLE|(?<!PUBLISHABLE)_KEY$/;
    const SECRET_VALUE =
      /postgres(ql)?:\/\/|sb_secret_|"d"\s*:|BEGIN [A-Z ]*PRIVATE KEY|eyJ[\w-]{20,}/;
    for (const scope of [CONFIGS[worker], ...ENVS.map((e) => block(worker, e))]) {
      for (const [name, value] of Object.entries(scope.vars ?? {})) {
        expect(name, `var ${name}`).not.toMatch(SECRET_NAME);
        expect(String(value), `value of ${name}`).not.toMatch(SECRET_VALUE);
      }
    }
  });
});

describe('edge Worker rules (L-10, L-11, check-boundaries rule 1 and 7)', () => {
  it('has no TRACE_ENV var at any level', () => {
    for (const scope of [CONFIGS.edge, ...ENVS.map((e) => block('edge', e))]) {
      expect(scope.vars ?? {}).not.toHaveProperty('TRACE_ENV');
    }
  });

  it('MIRROR_TRANSPORT is "queue" in every env, with no JOBS service binding', () => {
    for (const env of ENVS) {
      expect(block('edge', env).vars.MIRROR_TRANSPORT).toBe('queue');
      expect(names(block('edge', env).services, 'binding')).not.toContain('JOBS');
    }
  });

  it('reaches api only through the CandidateRpc service binding to the same env', () => {
    for (const env of ENVS) {
      expect(block('edge', env).services).toEqual([
        { binding: 'API', service: `trace-api-${env}`, entrypoint: 'CandidateRpc' },
      ]);
    }
  });

  it('names no Supabase or database credential and no trace_* role in its config text', () => {
    const text = readFileSync(path.join(REPO, 'workers/edge/wrangler.jsonc'), 'utf8');
    expect(text).not.toMatch(/SUPABASE|DB_URL|service_role|trace_(api|worker|quality|integrity)/i);
  });
});

describe('cross-Worker wiring', () => {
  it.each(ENVS)('env %s: producers and the consumer share one queue and one DLQ', (env) => {
    const queue = `trace-session-mirror-${env}`;
    expect(block('edge', env).queues.producers).toEqual([{ binding: 'MIRROR_QUEUE', queue }]);
    expect(block('jobs', env).queues.producers).toEqual([{ binding: 'MIRROR_QUEUE', queue }]);
    expect(block('jobs', env).queues.consumers).toEqual([
      {
        queue,
        max_batch_size: 10,
        max_retries: 5,
        dead_letter_queue: `trace-session-mirror-dlq-${env}`,
      },
    ]);
  });

  it.each(ENVS)('env %s: the same packages and evidence buckets back edge, api and jobs', (env) => {
    for (const worker of ['edge', 'api']) {
      const buckets = Object.fromEntries(
        block(worker, env).r2_buckets.map((b) => [b.binding, b.bucket_name]),
      );
      expect(buckets).toEqual({
        PACKAGES: `trace-packages-${env}`,
        EVIDENCE: `trace-evidence-${env}`,
      });
    }
    expect(block('jobs', env).r2_buckets).toEqual([
      { binding: 'EVIDENCE', bucket_name: `trace-evidence-${env}` },
    ]);
  });

  it('runs the jobs cron every minute in both envs (L-18)', () => {
    for (const env of ENVS) expect(block('jobs', env).triggers).toEqual({ crons: ['* * * * *'] });
  });

  it('staging origins live on the abhayraj.workers.dev or pages.dev hosts only', () => {
    const origin = /^https:\/\/trace-[a-z-]+-staging\.(abhayraj\.workers\.dev|pages\.dev)$/;
    for (const worker of ['edge', 'api']) {
      expect(block(worker, 'staging').vars.CANDIDATE_APP_ORIGIN).toMatch(origin);
    }
    for (const origin_ of block('api', 'staging').vars.ALLOWED_ORIGINS.split(',')) {
      expect(origin_).toMatch(origin);
    }
    expect(STAGING_SUBDOMAIN).toBe('abhayraj.workers.dev');
  });

  it('api keeps DEMO_OUTBOX off the production value and sets TRACE_ENV per env', () => {
    expect(block('api', 'dev').vars.TRACE_ENV).toBe('dev');
    expect(block('api', 'staging').vars.TRACE_ENV).toBe('staging');
    expect(block('jobs', 'dev').vars.TRACE_ENV).toBe('dev');
    expect(block('jobs', 'staging').vars.TRACE_ENV).toBe('staging');
    for (const env of ENVS) expect(block('api', env).vars.DEMO_OUTBOX).toBe('1');
  });

  it('every Worker has exactly the dev and staging env blocks and no top-level DEMO_OUTBOX (D1-SPEC-4)', () => {
    // A production block (or a top-level var, which a block without its own vars would inherit) could carry
    // DEMO_OUTBOX into production; the runtime guards stay, but the config must not offer it.
    for (const worker of ['edge', 'api', 'jobs']) {
      expect(Object.keys(CONFIGS[worker].env ?? {}).sort(), worker).toEqual(ENVS);
      expect(CONFIGS[worker].vars?.DEMO_OUTBOX, worker).toBeUndefined();
    }
  });

  it('the staging deploy order in specs is api, jobs, edge (service target first)', () => {
    // The deploy job is lead-owned (§7.1); this pins the dependency the order exists for: edge
    // names the api service, so api must exist first. No order list lives in wrangler config.
    expect(block('edge', 'staging').services[0].service).toBe('trace-api-staging');
    for (const worker of ['edge', 'api', 'jobs']) {
      expect(CONFIGS[worker]).not.toHaveProperty('deploy_order');
    }
  });
});
