// AT-12 (local part) for the real deploy-staging job in .github/workflows/ci.yml (spec §7.2, §7.3,
// §15.1 "Deploy to staging"). Parses the workflow with check-workflows' own YAML-subset parser and
// pins the gate, the step order, the step-scoped secrets and the deploy commands.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEPLOY_IF, REQUIRED_JOBS, parseYaml, runChecks, secretRefs } from '../check-workflows.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = readFileSync(path.join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
const CI = parseYaml(RAW);
const JOB = CI.jobs['deploy-staging'];
const STEPS = JOB.steps;
const run = (s) => (typeof s.run === 'string' ? s.run : '');
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

const WORKER_DIRS = 'workers/edge workers/jobs services/api';
const OUTPUT_FILE = '"$RUNNER_TEMP/wrangler-output.ndjson"';

/** Which §15.1 state a step moves the job into (null when unknown). */
function stateOf(step) {
  const r = run(step);
  if (typeof step.uses === 'string' && /^actions\/checkout@[0-9a-f]{40}$/.test(step.uses))
    return 'checkout';
  if (step.uses === './.github/actions/setup') return 'setup';
  if (/\bpnpm build\b/.test(r)) return 'built';
  if (/\bnode scripts\/scan-dist\.mjs\b/.test(r)) return 'output_scanned';
  if (/\bsupabase db push\b/.test(r)) return 'migrated';
  if (/\bnode scripts\/staging-catalog-checks\.mjs\b/.test(r)) return 'catalog_checked';
  if (/\bwrangler deploy\b/.test(r)) return 'workers_deployed';
  if (/\bnode scripts\/check-staging-secrets\.mjs\b/.test(r)) return 'secrets_checked';
  if (/\bwrangler pages deploy\b/.test(r)) return 'pages_deployed';
  if (/\bnode scripts\/smoke-staging\.mjs\b/.test(r)) return 'smoke_passed';
  if (/^node scripts\/smoke-staging-auth\.mjs$/.test(r.trim())) return 'org_signin_smoked';
  return null;
}
const stepIn = (state) => STEPS.find((s) => stateOf(s) === state);

describe('deploy-staging: the whole workflow', () => {
  it('passes every check-workflows rule (runChecks over the real .github/ returns [])', () => {
    expect(runChecks(REPO)).toEqual([]);
  });

  it('is the last job, after the four required jobs, which stay as they are', () => {
    expect(Object.keys(CI.jobs)).toEqual([...REQUIRED_JOBS, 'deploy-staging']);
  });

  it('never references AWS_* anywhere in the file', () => {
    expect(RAW).not.toMatch(/AWS_/i);
  });
});

describe('deploy-staging: gate (§7.2)', () => {
  it('needs the four required jobs and runs only on a push to main in this repository', () => {
    expect([...JOB.needs].sort()).toEqual([...REQUIRED_JOBS].sort());
    expect(norm(JOB.if)).toBe(norm(DEPLOY_IF));
    expect(DEPLOY_IF).toBe(
      "github.event_name == 'push' && github.ref == 'refs/heads/main' && github.repository == 'TraceHiring/TraceHiring'",
    );
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

describe('deploy-staging: steps in §15.1 order', () => {
  it('checkout → setup → built → output_scanned → migrated → catalog_checked → workers_deployed → secrets_checked → pages_deployed → smoke_passed → org_signin_smoked (m0b AT-B9)', () => {
    expect(STEPS.map(stateOf)).toEqual([
      'checkout',
      'setup',
      'built',
      'output_scanned',
      'migrated',
      'catalog_checked',
      'workers_deployed',
      'secrets_checked',
      'pages_deployed',
      'smoke_passed',
      'org_signin_smoked',
    ]);
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
});

describe('deploy-staging: step-scoped secrets (§7.2, §7.3)', () => {
  const expected = {
    checkout: [],
    setup: [],
    built: [],
    output_scanned: [],
    migrated: ['SUPABASE_STAGING_DB_URL'],
    catalog_checked: ['SUPABASE_STAGING_DB_URL'],
    workers_deployed: ['CLOUDFLARE_API_TOKEN'],
    secrets_checked: ['CLOUDFLARE_API_TOKEN'],
    pages_deployed: ['CLOUDFLARE_API_TOKEN'],
    smoke_passed: [],
    org_signin_smoked: [
      'STAGING_SMOKE_EMAIL',
      'STAGING_SMOKE_PASSWORD',
      'STAGING_SMOKE_TOTP_SECRET',
    ],
  };

  it('each step holds exactly the secrets it uses, and only in env:', () => {
    for (const s of STEPS) {
      const state = stateOf(s);
      expect(secretRefs(s).sort(), state).toEqual(expected[state]);
      for (const name of expected[state]) {
        expect(s.env[name], state).toBe(`\${{ secrets.${name} }}`);
        expect(secretRefs(s.run ?? ''), state).toEqual([]);
        expect(s.with, state).toBeUndefined();
      }
    }
  });

  it('CLOUDFLARE_ACCOUNT_ID comes from vars, only on the Cloudflare steps', () => {
    for (const s of STEPS) {
      const state = stateOf(s);
      const cf = ['workers_deployed', 'secrets_checked', 'pages_deployed'].includes(state);
      const env = s.env ?? {};
      if (cf) {
        // The Workers deploy alone also gets the public Sentry DSN var (d1 AT-D22).
        expect(Object.keys(env).sort(), state).toEqual(
          [
            'CLOUDFLARE_ACCOUNT_ID',
            'CLOUDFLARE_API_TOKEN',
            ...(state === 'workers_deployed' ? ['SENTRY_DSN_WORKERS'] : []),
          ].sort(),
        );
        expect(env.CLOUDFLARE_ACCOUNT_ID).toBe('${{ vars.CLOUDFLARE_ACCOUNT_ID }}');
      } else {
        expect(env.CLOUDFLARE_ACCOUNT_ID, state).toBeUndefined();
      }
    }
  });

  it('the database steps set nothing but the connection string', () => {
    expect(Object.keys(stepIn('migrated').env)).toEqual(['SUPABASE_STAGING_DB_URL']);
    expect(Object.keys(stepIn('catalog_checked').env)).toEqual(['SUPABASE_STAGING_DB_URL']);
  });
});

describe('deploy-staging: commands', () => {
  it('builds with the app version set to the commit SHA (runner env, not an expression)', () => {
    expect(run(stepIn('built'))).toMatch(/^VITE_APP_VERSION="\$GITHUB_SHA" pnpm build$/m);
  });

  it('never puts a ${{ }} expression in run text (use runner env such as $GITHUB_SHA)', () => {
    for (const s of STEPS) expect(run(s), String(stateOf(s))).not.toContain('${{');
  });

  it('builds the staging Worker bundles with no secret, before the scan (S3B-1)', () => {
    const built = stepIn('built');
    expect(secretRefs(built)).toEqual([]);
    // m0b §2.7 and d1 AT-D22: only the three public build variables, from vars (check-workflows
    // BUILD_ONLY_ENV).
    expect(built.env).toEqual({
      VITE_SUPABASE_URL: '${{ vars.SUPABASE_STAGING_URL }}',
      VITE_SUPABASE_PUBLISHABLE_KEY: '${{ vars.SUPABASE_STAGING_PUBLISHABLE_KEY }}',
      VITE_SENTRY_DSN: '${{ vars.VITE_SENTRY_DSN }}',
    });
    const r = run(built);
    expect(r.split('\n')[0]).toBe('set -euo pipefail');
    expect(r).toContain(`for dir in ${WORKER_DIRS}; do`);
    const dry = r.split('\n').filter((l) => /--dry-run/.test(l));
    expect(dry.map(norm)).toEqual([
      '(cd "$dir" && pnpm exec wrangler deploy --dry-run --env staging --outdir dist)',
    ]);
    expect(r.indexOf('pnpm build')).toBeLessThan(r.indexOf('--dry-run'));
    expect(STEPS.indexOf(built)).toBeLessThan(STEPS.indexOf(stepIn('output_scanned')));
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

  it('deploys exactly the scanned staging bundle: dist/index.js, --no-bundle, VERSION from $GITHUB_SHA (S3B-1)', () => {
    const step = stepIn('workers_deployed');
    const r = run(step);
    expect(r).toContain(`export WRANGLER_OUTPUT_FILE_PATH=${OUTPUT_FILE}`);
    // d1 AT-D22 (L-24): jobs and api get the Sentry DSN as a var; the edge Worker never does (no
    // reporter on edge, m0-foundations §9.2). The DSN comes from a public var, never a secret.
    expect(r).toContain('for dir in workers/jobs services/api; do');
    const lines = r.split('\n').filter((l) => /wrangler deploy/.test(l));
    expect(lines.map(norm)).toEqual([
      '(cd workers/edge && pnpm exec wrangler deploy dist/index.js --no-bundle --env staging --var "VERSION:$GITHUB_SHA")',
      '(cd "$dir" && pnpm exec wrangler deploy dist/index.js --no-bundle --env staging --var "VERSION:$GITHUB_SHA" --var "SENTRY_DSN_WORKERS:$SENTRY_DSN_WORKERS")',
    ]);
    expect(step.env.SENTRY_DSN_WORKERS).toBe('${{ vars.SENTRY_DSN_WORKERS }}');
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

  it('bounds the catalog-check and smoke steps below the job timeout (S3B-4)', () => {
    expect(JOB['timeout-minutes']).toBe(30);
    expect(stepIn('catalog_checked')['timeout-minutes']).toBe(10);
    expect(stepIn('smoke_passed')['timeout-minutes']).toBe(8);
  });

  it('runs the shell steps with errexit, nounset and pipefail', () => {
    for (const state of ['built', 'workers_deployed', 'pages_deployed', 'catalog_checked']) {
      expect(run(stepIn(state)).split('\n')[0], state).toBe('set -euo pipefail');
    }
  });
});
