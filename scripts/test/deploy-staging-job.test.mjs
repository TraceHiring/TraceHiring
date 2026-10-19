// AT-12 (local part) for the real deploy-staging job in .github/workflows/ci.yml (m0-foundations §7.2,
// §7.3, §15.1 "Deploy to staging"; specs/d1-demo-slice.md §7.1; docs/reviews/D1-security-review-bindings.md
// F4, F5). Parses the workflow with check-workflows' own YAML-subset parser and pins the gate, the step
// order, the exact env of every step (secrets and variables) and the deploy commands.
//
// The scanned-bundle rule (S3B-1, m0-foundations §7.2 step 5): the build step writes each Worker's
// staging bundle into its dist/ (`wrangler deploy --dry-run --env staging --outdir dist`), scan-dist
// scans it, and every real Worker deploy uploads exactly that dist/index.js with --no-bundle, so the
// deployed bytes are the scanned bytes. No step may re-bundle.
//
// One source of truth: DEPLOY_IF, WORKER_DEPLOYS, WORKER_BUILD_CMD, WORKER_DEPLOY_CMD, PUBLIC_DEPLOY_ENV
// and BUILD_ONLY_ENV live in scripts/check-workflows.mjs, which also enforces them on every workflow;
// this file pins those constants to the spec text and checks the real ci.yml against them.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUILD_ONLY_ENV,
  DEPLOY_IF,
  PUBLIC_DEPLOY_ENV,
  REQUIRED_JOBS,
  WORKER_BUILD_CMD,
  WORKER_DEPLOYS,
  WORKER_DEPLOY_CMD,
  checkWorkflow,
  parseYaml,
  runChecks,
  secretRefs,
} from '../check-workflows.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = readFileSync(path.join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
const CI = parseYaml(RAW);
const JOB = CI.jobs['deploy-staging'];
const STEPS = JOB.steps;
const run = (s) => (typeof s.run === 'string' ? s.run : '');
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
/** Run text with shell line continuations joined, one command per line, each normalised. */
const commands = (s) =>
  run(s)
    .replace(/\\\r?\n/g, ' ')
    .split('\n')
    .map(norm)
    .filter((l) => l !== '');

const WORKER_DIRS = 'workers/edge workers/jobs services/api';
const OUTPUT_FILE = '"$RUNNER_TEMP/wrangler-output.ndjson"';
const WORKER_OF = { 'services/api': 'api', 'workers/jobs': 'jobs', 'workers/edge': 'edge' };

/** Which §15.1 state (d1 §7.1 chain) a step moves the job into (null when unknown). */
function stateOf(step) {
  const r = run(step);
  if (typeof step.uses === 'string' && /^actions\/checkout@[0-9a-f]{40}$/.test(step.uses))
    return 'checkout';
  if (step.uses === './.github/actions/setup') return 'setup';
  if (/\bpnpm build\b/.test(r)) return 'built';
  if (/\bnode scripts\/scan-dist\.mjs\b/.test(r)) return 'output_scanned';
  if (/^node scripts\/check-deploy-vars\.mjs$/.test(r.trim())) return 'vars_checked';
  if (/\bsupabase db push\b/.test(r)) return 'migrated';
  if (/\bnode scripts\/staging-catalog-checks\.mjs\b/.test(r)) return 'catalog_checked';
  if (/^node scripts\/ensure-staging-resources\.mjs$/.test(r.trim())) return 'resources_ready';
  if (/\bwrangler deploy\b/.test(r))
    return `workers_deployed (${WORKER_OF[step['working-directory']] ?? '?'})`;
  if (/\bnode scripts\/check-staging-secrets\.mjs\b/.test(r)) return 'secrets_checked';
  if (/\bwrangler pages deploy\b/.test(r)) return 'pages_deployed';
  if (/\bnode scripts\/smoke-staging\.mjs\b/.test(r)) return 'smoke_passed';
  if (/^node scripts\/smoke-staging-auth\.mjs$/.test(r.trim())) return 'org_signin_smoked';
  return null;
}
const stepIn = (state) => STEPS.find((s) => stateOf(s) === state);

const V = (name) => `\${{ vars.${name} }}`;
const S = (name) => `\${{ secrets.${name} }}`;
const CLOUDFLARE = {
  CLOUDFLARE_API_TOKEN: S('CLOUDFLARE_API_TOKEN'),
  CLOUDFLARE_ACCOUNT_ID: V('CLOUDFLARE_ACCOUNT_ID'),
};

/** The exact env: of every step (§7.2, §7.3; d1 §7.1). Nothing else may be set on any step. */
const EXPECTED_ENV = {
  checkout: {},
  setup: {},
  // m0b §2.7 and d1 AT-D22: only the public build variables, from vars (check-workflows
  // BUILD_ONLY_ENV pins the list and its sources).
  built: { ...BUILD_ONLY_ENV },
  output_scanned: {},
  // F4 and S8: exactly the five values check-deploy-vars requires, all public GitHub variables.
  vars_checked: {
    CANDIDATE_TOKEN_KID: V('CANDIDATE_TOKEN_KID'),
    CANDIDATE_TOKEN_PUBLIC_JWK: V('CANDIDATE_TOKEN_PUBLIC_JWK'),
    SUPABASE_STAGING_URL: V('SUPABASE_STAGING_URL'),
    SUPABASE_STAGING_PUBLISHABLE_KEY: V('SUPABASE_STAGING_PUBLISHABLE_KEY'),
    API_STAGING_ORIGIN: V('API_STAGING_ORIGIN'),
  },
  migrated: { SUPABASE_STAGING_DB_URL: S('SUPABASE_STAGING_DB_URL') },
  catalog_checked: { SUPABASE_STAGING_DB_URL: S('SUPABASE_STAGING_DB_URL') },
  resources_ready: { ...CLOUDFLARE },
  'workers_deployed (api)': {
    ...CLOUDFLARE,
    SENTRY_DSN_WORKERS: V('SENTRY_DSN_WORKERS'),
    CANDIDATE_TOKEN_KID: V('CANDIDATE_TOKEN_KID'),
    CANDIDATE_TOKEN_PUBLIC_JWK: V('CANDIDATE_TOKEN_PUBLIC_JWK'),
    SUPABASE_STAGING_URL: V('SUPABASE_STAGING_URL'),
    SUPABASE_STAGING_PUBLISHABLE_KEY: V('SUPABASE_STAGING_PUBLISHABLE_KEY'),
  },
  'workers_deployed (jobs)': { ...CLOUDFLARE, SENTRY_DSN_WORKERS: V('SENTRY_DSN_WORKERS') },
  'workers_deployed (edge)': {
    ...CLOUDFLARE,
    CANDIDATE_TOKEN_PUBLIC_JWK: V('CANDIDATE_TOKEN_PUBLIC_JWK'),
  },
  secrets_checked: { ...CLOUDFLARE },
  pages_deployed: { ...CLOUDFLARE },
  smoke_passed: {},
  org_signin_smoked: {
    SUPABASE_STAGING_URL: V('SUPABASE_STAGING_URL'),
    SUPABASE_STAGING_PUBLISHABLE_KEY: V('SUPABASE_STAGING_PUBLISHABLE_KEY'),
    STAGING_SMOKE_EMAIL: S('STAGING_SMOKE_EMAIL'),
    STAGING_SMOKE_PASSWORD: S('STAGING_SMOKE_PASSWORD'),
    STAGING_SMOKE_TOTP_SECRET: S('STAGING_SMOKE_TOTP_SECRET'),
  },
};

/** The one dry-run line of the build loop (S3B-1: each Worker's staging bundle into its dist/). */
const BUILD_LINE = `(cd "$dir" && ${WORKER_BUILD_CMD})`;

/** The exact deploy command of each Worker: the scanned dist/index.js, --no-bundle, its --var set. */
const DEPLOY_LINES = {
  api:
    'pnpm exec wrangler deploy dist/index.js --no-bundle --env staging --var "VERSION:$GITHUB_SHA" ' +
    '--var "SENTRY_DSN_WORKERS:$SENTRY_DSN_WORKERS" --var "CANDIDATE_TOKEN_KID:$CANDIDATE_TOKEN_KID" ' +
    '--var "CANDIDATE_TOKEN_PUBLIC_JWK:$CANDIDATE_TOKEN_PUBLIC_JWK" --var "SUPABASE_URL:$SUPABASE_STAGING_URL" ' +
    '--var "SUPABASE_PUBLISHABLE_KEY:$SUPABASE_STAGING_PUBLISHABLE_KEY"',
  jobs: 'pnpm exec wrangler deploy dist/index.js --no-bundle --env staging --var "VERSION:$GITHUB_SHA" --var "SENTRY_DSN_WORKERS:$SENTRY_DSN_WORKERS"',
  edge: 'pnpm exec wrangler deploy dist/index.js --no-bundle --env staging --var "VERSION:$GITHUB_SHA" --var "CANDIDATE_TOKEN_PUBLIC_JWK:$CANDIDATE_TOKEN_PUBLIC_JWK"',
};

/** S3B-1 form of a real Worker deploy: the scanned file, no bundling, staging, then --vars only. */
const SCANNED_DEPLOY_RE =
  /^pnpm exec wrangler deploy dist\/index\.js --no-bundle --env staging(?: --var "[A-Z][A-Z0-9_]*:\$[A-Z][A-Z0-9_]*")+$/;

/** Every `wrangler deploy` command in deploy-staging (not `wrangler pages deploy`), with its step. */
const wranglerDeploys = (steps) =>
  steps.flatMap((s) =>
    commands(s)
      .filter((l) => /\bwrangler\s+deploy\b/.test(l))
      .map((line) => ({ step: s, line })),
  );

/**
 * The negative pin (S3B-1): every `wrangler deploy` other than the build step's one dry-run line
 * must be the scanned-bundle form. Returns the offending lines.
 */
const reBundlingDeploys = (steps) =>
  wranglerDeploys(steps)
    .filter(({ step, line }) =>
      line === BUILD_LINE ? stateOf(step) !== 'built' : !SCANNED_DEPLOY_RE.test(line),
    )
    .map(({ line }) => line);

describe('deploy-staging: the whole workflow', () => {
  it('passes every check-workflows rule (runChecks over the real .github/ returns [])', () => {
    expect(runChecks(REPO)).toEqual([]);
  });

  it('is the last job, after the four required jobs, which stay as they are, and e2e-local', () => {
    // e2e-local (d1 §7.1, DC-D9) is not required and deploy-staging does not need it.
    expect(Object.keys(CI.jobs)).toEqual([...REQUIRED_JOBS, 'e2e-local', 'deploy-staging']);
  });

  it('never references AWS_* anywhere in the file', () => {
    expect(RAW).not.toMatch(/AWS_/i);
  });
});

describe('deploy-staging: gate (§7.2; d1 §7.1, D1-16)', () => {
  it('needs the four required jobs and runs on a push to main or a dispatch from d1/** or milestone/**, in this repository', () => {
    expect([...JOB.needs].sort()).toEqual([...REQUIRED_JOBS].sort());
    // The exact expression of specs/d1-demo-slice.md §7.1 (D1-16).
    expect(DEPLOY_IF).toBe(
      "(github.event_name == 'push' && github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch' && (startsWith(github.ref, 'refs/heads/d1/') || startsWith(github.ref, 'refs/heads/milestone/'))) && github.repository == 'TraceHiring/TraceHiring'",
    );
    expect(norm(JOB.if)).toBe(norm(DEPLOY_IF));
  });

  it('can be dispatched by hand, with no input a run could read as text', () => {
    expect(Object.hasOwn(CI.on, 'workflow_dispatch')).toBe(true);
    // The one input is the d1 §7.1 boolean run_e2e (DC-D9): no string a dispatcher could inject.
    expect(CI.on.workflow_dispatch).toEqual({
      inputs: { run_e2e: { description: 'Run the e2e jobs', type: 'boolean', default: true } },
    });
    // Only the e2e-local job's if: reads it; no step, and nothing in deploy-staging, reads an input.
    expect(JSON.stringify(JOB)).not.toMatch(/inputs\./);
    for (const job of Object.values(CI.jobs)) {
      for (const s of job.steps ?? []) expect(JSON.stringify(s)).not.toMatch(/inputs\./);
    }
  });

  it('uses the staging environment, one deploy at a time without cancelling, and read-only permissions', () => {
    expect(JOB.environment).toBe('staging');
    expect(JOB.concurrency).toBe('deploy-staging');
    expect(JOB.permissions).toEqual({ contents: 'read' });
  });

  it('has no job-level env, secrets, container or services (plan P2), and a name equal to its id if any', () => {
    for (const key of ['env', 'secrets', 'container', 'services', 'continue-on-error', 'defaults'])
      expect(JOB[key], key).toBeUndefined();
    if (JOB.name !== undefined) expect(JOB.name).toBe('deploy-staging');
    expect(JOB['runs-on']).toBe('ubuntu-24.04');
    expect(JOB['timeout-minutes']).toBeGreaterThan(0);
  });
});

describe('deploy-staging: steps in §15.1 order (with the d1 §7.1 states)', () => {
  it('checkout → setup → built → output_scanned → vars_checked → migrated → catalog_checked → resources_ready → workers_deployed (api, jobs, edge) → secrets_checked → pages_deployed → smoke_passed → org_signin_smoked', () => {
    expect(STEPS.map(stateOf)).toEqual([
      'checkout',
      'setup',
      'built',
      'output_scanned',
      'vars_checked',
      'migrated',
      'catalog_checked',
      'resources_ready',
      'workers_deployed (api)',
      'workers_deployed (jobs)',
      'workers_deployed (edge)',
      'secrets_checked',
      'pages_deployed',
      'smoke_passed',
      'org_signin_smoked',
    ]);
  });

  it('deploys the Workers in the order of WORKER_DEPLOYS (a service-binding target exists first)', () => {
    expect(WORKER_DEPLOYS.map((w) => w.dir)).toEqual([
      'services/api',
      'workers/jobs',
      'workers/edge',
    ]);
    const deploySteps = STEPS.filter((s) => /^workers_deployed /.test(stateOf(s)));
    expect(deploySteps.map((s) => s['working-directory'])).toEqual(
      WORKER_DEPLOYS.map((w) => w.dir),
    );
  });

  it('checks out without persisting credentials and uses the shared setup', () => {
    expect(STEPS[0].with).toEqual({ 'persist-credentials': false });
    expect(STEPS[1]).toMatchObject({ uses: './.github/actions/setup' });
  });

  it('no step has an if:, a shell other than bash, or continue-on-error', () => {
    for (const s of STEPS) {
      expect(s.if).toBeUndefined();
      expect(s['continue-on-error']).toBeUndefined();
      if (s.shell !== undefined) expect(s.shell).toBe('bash');
    }
  });

  it('only the three Worker deploys set a working-directory, each its own Worker', () => {
    for (const s of STEPS) {
      const state = stateOf(s);
      if (/^workers_deployed /.test(state)) expect(WORKER_OF[s['working-directory']]).toBeDefined();
      else expect(s['working-directory'], state).toBeUndefined();
    }
  });
});

describe('deploy-staging: the exact env of every step (§7.2, §7.3; d1 §7.1)', () => {
  it('each step sets exactly its listed names, each from its listed source', () => {
    for (const s of STEPS) {
      const state = stateOf(s);
      expect(Object.keys(EXPECTED_ENV), String(state)).toContain(state);
      expect(s.env ?? {}, state).toEqual(EXPECTED_ENV[state]);
    }
  });

  it('each step holds exactly the secrets it uses, only in env:, never in run text or with:', () => {
    for (const s of STEPS) {
      const state = stateOf(s);
      const secrets = Object.entries(EXPECTED_ENV[state])
        .filter(([, value]) => value.startsWith('${{ secrets.'))
        .map(([name]) => name)
        .sort();
      expect(secretRefs(s).sort(), state).toEqual(secrets);
      expect(secretRefs(run(s)), state).toEqual([]);
      if (secrets.length > 0) expect(s.with, state).toBeUndefined();
    }
  });

  it('CLOUDFLARE_ACCOUNT_ID comes from vars, only on the steps that call Cloudflare', () => {
    const cloudflare = STEPS.filter((s) => s.env?.CLOUDFLARE_API_TOKEN !== undefined).map(stateOf);
    expect(cloudflare).toEqual([
      'resources_ready',
      'workers_deployed (api)',
      'workers_deployed (jobs)',
      'workers_deployed (edge)',
      'secrets_checked',
      'pages_deployed',
    ]);
    for (const s of STEPS) {
      const env = s.env ?? {};
      if (cloudflare.includes(stateOf(s)))
        expect(env.CLOUDFLARE_ACCOUNT_ID).toBe('${{ vars.CLOUDFLARE_ACCOUNT_ID }}');
      else expect(env.CLOUDFLARE_ACCOUNT_ID, stateOf(s)).toBeUndefined();
    }
  });

  it('every public deploy value is its GitHub variable wherever it is set (F4: never a secret)', () => {
    for (const s of STEPS) {
      for (const [name, value] of Object.entries(s.env ?? {})) {
        if (Object.hasOwn(PUBLIC_DEPLOY_ENV, name))
          expect(value, `${stateOf(s)} ${name}`).toBe(PUBLIC_DEPLOY_ENV[name]);
      }
    }
    for (const name of Object.keys(PUBLIC_DEPLOY_ENV)) expect(RAW).not.toContain(`secrets.${name}`);
  });

  it('each Worker deploy sets exactly the source variables its --var set reads, plus Cloudflare', () => {
    for (const w of WORKER_DEPLOYS) {
      const step = STEPS.find((s) => s['working-directory'] === w.dir);
      const sources = Object.values(w.vars).filter((src) => src !== 'GITHUB_SHA');
      expect(Object.keys(step.env).sort(), w.dir).toEqual(
        [...Object.keys(CLOUDFLARE), ...sources].sort(),
      );
    }
  });
});

describe('deploy-staging: commands', () => {
  it('builds with the app version set to the commit SHA (runner env, not an expression)', () => {
    expect(run(stepIn('built'))).toMatch(/^VITE_APP_VERSION="\$GITHUB_SHA" pnpm build$/m);
  });

  it('never puts a ${{ }} expression in run text (use runner env such as $GITHUB_SHA)', () => {
    for (const s of STEPS) expect(run(s), String(stateOf(s))).not.toContain('${{');
  });

  it('builds the recruiter with its public build variables only, all from vars (m0b §2.7, d1 AT-D22, d1 §7.1 CSP)', () => {
    expect(stepIn('built').env).toEqual({
      VITE_SUPABASE_URL: '${{ vars.SUPABASE_STAGING_URL }}',
      VITE_SUPABASE_PUBLISHABLE_KEY: '${{ vars.SUPABASE_STAGING_PUBLISHABLE_KEY }}',
      VITE_SENTRY_DSN: '${{ vars.VITE_SENTRY_DSN }}',
      // The recruiter CSP's connect-src api origin (https://trace-api-staging.<label>.workers.dev);
      // the headers plugin drops the token when it is unset.
      VITE_API_ORIGIN: '${{ vars.API_STAGING_ORIGIN }}',
      // d1 §6.1, AT-D18: only the staging recruiter build includes the demo outbox.
      VITE_DEMO_OUTBOX: '1',
    });
  });

  it('builds the staging Worker bundles into dist/ with no secret, before the scan (S3B-1)', () => {
    const built = stepIn('built');
    expect(secretRefs(built)).toEqual([]);
    expect(WORKER_BUILD_CMD).toBe(
      'pnpm exec wrangler deploy --dry-run --env staging --outdir dist',
    );
    const r = run(built);
    expect(r.split('\n')[0]).toBe('set -euo pipefail');
    expect(r).toContain(`for dir in ${WORKER_DIRS}; do`);
    // Every Worker that is deployed is built (and so scanned) under --env staging.
    expect(WORKER_DIRS.split(' ').sort()).toEqual(WORKER_DEPLOYS.map((w) => w.dir).sort());
    const dry = r.split('\n').filter((l) => /--dry-run/.test(l));
    expect(dry.map(norm)).toEqual([BUILD_LINE]);
    expect(r.indexOf('pnpm build')).toBeLessThan(r.indexOf('--dry-run'));
    expect(STEPS.indexOf(built)).toBeLessThan(STEPS.indexOf(stepIn('output_scanned')));
  });

  it('scans the build output with exactly node scripts/scan-dist.mjs', () => {
    expect(run(stepIn('output_scanned')).trim()).toBe('node scripts/scan-dist.mjs');
  });

  it('checks the public deploy variables with exactly node scripts/check-deploy-vars.mjs (F4)', () => {
    expect(run(stepIn('vars_checked')).trim()).toBe('node scripts/check-deploy-vars.mjs');
  });

  it('applies migrations with the §7.2 command, non-interactively', () => {
    expect(run(stepIn('migrated'))).toMatch(
      /pnpm exec supabase db push --db-url "\$SUPABASE_STAGING_DB_URL" --yes/,
    );
  });

  it('runs the catalog checks with psql present (the script runs psql per check)', () => {
    const r = run(stepIn('catalog_checked'));
    expect(r).toMatch(/\bpsql --version\b/);
    expect(r).toMatch(/node scripts\/staging-catalog-checks\.mjs$/m);
  });

  it('creates the buckets and queues with exactly node scripts/ensure-staging-resources.mjs (F5)', () => {
    expect(run(stepIn('resources_ready')).trim()).toBe('node scripts/ensure-staging-resources.mjs');
  });

  it('deploys exactly the scanned staging bundle of each Worker, with its exact --var set (S3B-1)', () => {
    expect(WORKER_DEPLOY_CMD).toBe(
      'pnpm exec wrangler deploy dist/index.js --no-bundle --env staging',
    );
    for (const w of WORKER_DEPLOYS) {
      const name = WORKER_OF[w.dir];
      const step = stepIn(`workers_deployed (${name})`);
      // d1 AT-D22 (L-24): jobs and api get the Sentry DSN, the edge never (no reporter on edge,
      // m0-foundations §9.2); the candidate-token public JWK goes to api and edge, its kid and the
      // Supabase pair to api only (d1 §4.2). Each line is the whole command: nothing else runs.
      expect(commands(step), name).toEqual([
        'set -euo pipefail',
        `export WRANGLER_OUTPUT_FILE_PATH=${OUTPUT_FILE}`,
        DEPLOY_LINES[name],
      ]);
      // The pinned text and check-workflows' WORKER_DEPLOYS describe the same command.
      const fromConstant = [
        WORKER_DEPLOY_CMD,
        ...Object.entries(w.vars).map(([n, src]) => `--var "${n}:$${src}"`),
      ].join(' ');
      expect(DEPLOY_LINES[name], name).toBe(fromConstant);
    }
  });

  it('checks the Worker secrets with check-staging-secrets', () => {
    expect(run(stepIn('secrets_checked')).trim()).toBe('node scripts/check-staging-secrets.mjs');
  });

  it('creates each Pages project if missing and deploys both apps on branch main', () => {
    const r = run(stepIn('pages_deployed'));
    expect(r).toContain(`export WRANGLER_OUTPUT_FILE_PATH=${OUTPUT_FILE}`);
    expect(r).toMatch(/pnpm exec wrangler pages project list --json/);
    expect(r).toMatch(/for project in trace-candidate-staging trace-recruiter-staging; do/);
    expect(r).toMatch(
      /pnpm exec wrangler pages project create "\$project" --production-branch main/,
    );
    for (const app of ['candidate', 'recruiter']) {
      expect(r).toContain(
        `pnpm exec wrangler pages deploy apps/${app}/dist --project-name trace-${app}-staging --branch main`,
      );
    }
    const deploys = r.split('\n').filter((l) => /wrangler pages deploy/.test(l));
    expect(deploys).toHaveLength(2);
    for (const l of deploys) expect(l).toMatch(/--branch main$/);
  });

  it('smoke-tests from the same wrangler output file against github.sha', () => {
    expect(norm(run(stepIn('smoke_passed')))).toBe(
      `node scripts/smoke-staging.mjs --wrangler-output ${OUTPUT_FILE} --sha "$GITHUB_SHA"`,
    );
  });

  it('runs the org sign-in smoke with exactly its one command (m0b AT-B9)', () => {
    expect(run(stepIn('org_signin_smoked')).trim()).toBe('node scripts/smoke-staging-auth.mjs');
  });

  it('bounds the catalog-check and smoke steps below the job timeout (S3B-4)', () => {
    expect(JOB['timeout-minutes']).toBe(30);
    expect(stepIn('catalog_checked')['timeout-minutes']).toBe(10);
    expect(stepIn('smoke_passed')['timeout-minutes']).toBe(8);
  });

  it('runs the shell steps with errexit, nounset and pipefail', () => {
    for (const state of [
      'built',
      'workers_deployed (api)',
      'workers_deployed (jobs)',
      'workers_deployed (edge)',
      'pages_deployed',
      'catalog_checked',
    ]) {
      expect(run(stepIn(state)).split('\n')[0], state).toBe('set -euo pipefail');
    }
  });
});

describe('deploy-staging: no step re-bundles (S3B-1 negative pin)', () => {
  /** A deep copy of the job's steps, so a mutation never touches the parsed real file. */
  const copy = () => JSON.parse(JSON.stringify(STEPS));
  const workerStep = (steps, name) =>
    steps.find(
      (s) => s['working-directory'] === Object.keys(WORKER_OF).find((d) => WORKER_OF[d] === name),
    );
  /** The real workflow with its deploy-staging steps replaced, as check-workflows sees it. */
  const checked = (steps) => {
    const doc = JSON.parse(JSON.stringify(CI));
    doc.jobs['deploy-staging'].steps = steps;
    return checkWorkflow(doc, 'ci.yml', { installActions: new Set(['.github/actions/setup']) })
      .map((v) => v.message)
      .join('\n');
  };

  it('every wrangler deploy other than the one dry-run build line is dist/index.js --no-bundle --env staging', () => {
    const lines = wranglerDeploys(STEPS);
    expect(lines.map(({ step, line }) => [stateOf(step), line])).toEqual([
      ['built', BUILD_LINE],
      ['workers_deployed (api)', DEPLOY_LINES.api],
      ['workers_deployed (jobs)', DEPLOY_LINES.jobs],
      ['workers_deployed (edge)', DEPLOY_LINES.edge],
    ]);
    expect(reBundlingDeploys(STEPS)).toEqual([]);
  });

  it('never runs wrangler versions (upload re-bundles) or any wrangler command other than deploy and pages', () => {
    for (const s of STEPS) {
      for (const m of commands(s)
        .join('\n')
        .matchAll(/\bwrangler\s+(\S+)/g)) {
        expect(['deploy', 'pages'], `${stateOf(s)}: ${m[0]}`).toContain(m[1]);
      }
    }
  });

  it.each(['api', 'jobs', 'edge'])(
    'flags the %s deploy without --no-bundle (in this test and in check-workflows)',
    (name) => {
      const steps = copy();
      const s = workerStep(steps, name);
      s.run = s.run.replace(' --no-bundle', '');
      expect(s.run).not.toContain('--no-bundle');
      expect(reBundlingDeploys(steps)).toEqual([DEPLOY_LINES[name].replace(' --no-bundle', '')]);
      expect(checked(steps)).toMatch(/--no-bundle/);
    },
  );

  it.each([
    ['re-bundles from wrangler.jsonc main', (r) => r.replace(' dist/index.js --no-bundle', '')],
    ['deploys the source entry', (r) => r.replace('dist/index.js', 'src/index.ts')],
    ['adds --bundle after the vars', (r) => r.replace(/"\n?$/, '" --bundle\n')],
    ['adds a --define', (r) => r.replace('--env staging', '--env staging --define X:1')],
    [
      'moves --no-bundle after the env',
      (r) => r.replace(' --no-bundle --env staging', ' --env staging --no-bundle'),
    ],
  ])('flags a jobs deploy that %s', (_label, edit) => {
    const steps = copy();
    const s = workerStep(steps, 'jobs');
    const before = s.run;
    s.run = edit(s.run);
    expect(s.run).not.toBe(before);
    expect(reBundlingDeploys(steps)).toHaveLength(1);
    expect(checked(steps)).not.toBe('');
  });

  it('flags a real deploy hidden next to the dry-run build line', () => {
    const steps = copy();
    const built = steps.find((s) => stateOf(s) === 'built');
    built.run += '\npnpm exec wrangler deploy --env staging\n';
    expect(reBundlingDeploys(steps)).toEqual(['pnpm exec wrangler deploy --env staging']);
    expect(checked(steps)).toMatch(/--no-bundle|dry-run/);
  });

  it('flags the dry-run build line anywhere but the build step, and a build line in another form', () => {
    const steps = copy();
    const edge = workerStep(steps, 'edge');
    edge.run += `\n${BUILD_LINE}\n`;
    expect(reBundlingDeploys(steps)).toEqual([BUILD_LINE]);
    const other = copy();
    const built = other.find((s) => stateOf(s) === 'built');
    built.run = built.run.replace('--outdir dist', '--outdir dist --define X:1');
    expect(reBundlingDeploys(other)).toHaveLength(1);
    expect(checked(other)).toMatch(/dry-run/);
  });
});

describe('wrangler --var transport (installed wrangler, S3B-1 deploy of public values)', () => {
  // wrangler splits `--var NAME:VALUE` at the first colon and joins the rest back with ':'
  // (wrangler-dist/cli.js, src/utils/collectKeyValues.ts), so a JSON value full of ':' and '"'
  // reaches the Worker intact. This pins that behaviour against the installed wrangler, so an
  // upgrade that changes it fails here instead of shipping a broken CANDIDATE_TOKEN_PUBLIC_JWK.
  const require = createRequire(import.meta.url);
  const cli = path.join(
    path.dirname(require.resolve('wrangler/package.json')),
    'wrangler-dist',
    'cli.js',
  );

  it('keeps a public JWK JSON value intact through collectKeyValues', async () => {
    const source = readFileSync(cli, 'utf8');
    const m = source.match(/\nfunction collectKeyValues\((\w+)\) \{\n[\s\S]*?\n\}\n/);
    expect(m, 'collectKeyValues not found in the installed wrangler').not.toBeNull();
    const collectKeyValues = new Function(`return (${m[0]})`)();
    // Generated at run time (no key-shaped literal in the repository); public members only.
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]);
    const { kty, crv, x, y } = await crypto.subtle.exportKey('jwk', pair.publicKey);
    // The one shape check-deploy-vars accepts: a JSON array, the signing key first.
    const jwk = JSON.stringify([{ kty, crv, x, y, kid: 'd1-2026-10', alg: 'ES256' }]);
    expect(jwk).toMatch(/:.*:/);
    expect(
      collectKeyValues([
        'VERSION:0123456789abcdef0123456789abcdef01234567',
        `CANDIDATE_TOKEN_PUBLIC_JWK:${jwk}`,
        'SUPABASE_URL:https://example-ref.supabase.co',
      ]),
    ).toEqual({
      VERSION: '0123456789abcdef0123456789abcdef01234567',
      CANDIDATE_TOKEN_PUBLIC_JWK: jwk,
      SUPABASE_URL: 'https://example-ref.supabase.co',
    });
  });
});
