// AT-12 (local part): scripts/check-workflows.mjs and its YAML-subset parser (spec §7.1, §7.2).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEPLOY_IF,
  REQUIRED_JOBS,
  YamlError,
  checkAction,
  checkWorkflow,
  parseYaml,
  runChecks,
} from '../check-workflows.mjs';
import { cleanupTempDirs, makeTempDir, writeFiles } from './fixtures/checks/temp-repo.mjs';

afterEach(cleanupTempDirs);

const fixture = (name) =>
  readFileSync(
    fileURLToPath(new URL(`./fixtures/checks/workflows/${name}`, import.meta.url)),
    'utf8',
  );
const CI = fixture('ci.yml');
const ACTION = fixture('setup-action.yml');
const SHA = '1111111111111111111111111111111111111111';
const ctx = { installActions: new Set(['.github/actions/setup']) };
const doc = () => parseYaml(CI);
const msgs = (v) => v.map((x) => x.message).join('\n');

describe('parseYaml (the subset GitHub workflows use)', () => {
  it('reads nested mappings, sequences and scalars', () => {
    const y = [
      '# comment',
      'name: ci # trailing comment',
      'on:',
      '  push:',
      '    branches:',
      '    - main',
      "    - 'milestone/**'",
      'n: 0',
      't: true',
      'f: false',
      'e:',
      'url: https://example.invalid/a#b',
      'q: "a \\"quoted\\" \\u0041 # not a comment"',
      "s: 'it''s'",
      'list:',
      '  - a',
      '  - k: v',
      '    k2: v2',
      '  - - nested',
      '  -',
      '    deep: 1',
    ].join('\n');
    expect(parseYaml(y)).toEqual({
      name: 'ci',
      on: { push: { branches: ['main', 'milestone/**'] } },
      n: 0,
      t: true,
      f: false,
      e: null,
      url: 'https://example.invalid/a#b',
      q: 'a "quoted" A # not a comment',
      s: "it's",
      list: ['a', { k: 'v', k2: 'v2' }, ['nested'], { deep: 1 }],
    });
  });

  it('reads block scalars with chomping, keeping # lines as content', () => {
    const y = [
      'a: |',
      '  line 1',
      '  # not a comment',
      '',
      '    indented',
      'b: |-',
      '  x',
      'c: >',
      '  folded',
      '  text',
      '',
      '  para',
      'd: |+',
      '  keep',
      '',
      'e: end',
    ].join('\n');
    expect(parseYaml(y)).toEqual({
      a: 'line 1\n# not a comment\n\n  indented\n',
      b: 'x',
      c: 'folded text\npara\n',
      d: 'keep\n\n',
      e: 'end',
    });
  });

  it('reads flow collections, also across lines', () => {
    const y = [
      'needs: [a, "b", c]',
      'with: { x: 1, y: [p, q] }',
      'multi: [',
      '  one,',
      '  two,',
      ']',
    ];
    expect(parseYaml(y.join('\n'))).toEqual({
      needs: ['a', 'b', 'c'],
      with: { x: 1, y: ['p', 'q'] },
      multi: ['one', 'two'],
    });
  });

  it('folds a multi-line plain scalar', () => {
    expect(parseYaml("if: github.event_name == 'push' &&\n  github.ref == 'x'\nz: 1")).toEqual({
      if: "github.event_name == 'push' && github.ref == 'x'",
      z: 1,
    });
  });

  it('reads the fixture workflow', () => {
    const d = doc();
    expect(Object.keys(d.jobs)).toEqual([...REQUIRED_JOBS, 'deploy-staging']);
    expect(d.permissions).toEqual({ contents: 'read' });
    expect(d.jobs.static.steps[0].with['persist-credentials']).toBe(false);
    expect(d.jobs['deploy-staging'].if).toBe(DEPLOY_IF);
  });

  it.each([
    ['duplicate keys', 'a: 1\na: 2'],
    ['anchors', 'a: &x 1'],
    ['aliases', 'a: *x'],
    ['tags', 'a: !!str 1'],
    ['merge keys', 'b: {}\n<<: b'],
    ['tabs in indentation', 'a:\n\tb: 1'],
    ['bad indentation', 'a:\n    b: 1\n  c: 2'],
    ['an unterminated quote', 'a: "x'],
    ['an unterminated flow', 'a: [x, y'],
    ['multiple documents', 'a: 1\n---\nb: 2'],
    ['a complex key', '? a\n: b'],
  ])('rejects %s', (_label, y) => {
    expect(() => parseYaml(y)).toThrow(YamlError);
  });
});

describe('checkWorkflow', () => {
  it('passes the fixture workflow and composite action', () => {
    expect(checkWorkflow(doc(), 'ci.yml', ctx)).toEqual([]);
    expect(checkAction(parseYaml(ACTION), 'action.yml')).toEqual([]);
  });

  it('passes a workflow without a deploy-staging job (S1.5 shape)', () => {
    const d = doc();
    delete d.jobs['deploy-staging'];
    expect(checkWorkflow(d, 'ci.yml', ctx)).toEqual([]);
  });

  it.each([
    ['a tag', 'actions/checkout@v7'],
    ['a short SHA', 'actions/checkout@1111111'],
    ['a branch', 'actions/checkout@main'],
    ['no ref', 'actions/checkout'],
    ['an uppercase SHA', `actions/checkout@${SHA.replace(/1/g, 'A')}`],
    ['a docker tag', 'docker://alpine:3'],
  ])('rejects a uses: pinned to %s', (_label, ref) => {
    const d = doc();
    d.jobs.static.steps[0].uses = ref;
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/not pinned to a full commit SHA/);
  });

  it('accepts a docker image pinned by digest and a reusable workflow pinned by SHA', () => {
    const d = doc();
    d.jobs.extra = {
      'runs-on': 'ubuntu-24.04',
      steps: [{ uses: `docker://alpine@sha256:${'a'.repeat(64)}` }],
    };
    d.jobs.reuse = { uses: `org/repo/.github/workflows/x.yml@${SHA}` };
    expect(checkWorkflow(d, 'ci.yml', ctx)).toEqual([]);
    d.jobs.reuse.uses = 'org/repo/.github/workflows/x.yml@v1';
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/jobs\.reuse.*not pinned/);
  });

  it.each([
    ['missing', undefined],
    ['read-all', 'read-all'],
    ['write-all', 'write-all'],
    ['broader', { contents: 'write' }],
    ['extra scope', { contents: 'read', 'id-token': 'write' }],
  ])('rejects workflow permissions that are %s', (_label, perms) => {
    const d = doc();
    if (perms === undefined) delete d.permissions;
    else d.permissions = perms;
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/permissions/);
  });

  it.each([
    ['write', { contents: 'write' }],
    ['another scope', { 'pull-requests': 'read' }],
    ['write-all', 'write-all'],
  ])('rejects job permissions broader than the workflow (%s)', (_label, perms) => {
    const d = doc();
    d.jobs.rls.permissions = perms;
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/jobs\.rls.*permissions/);
  });

  it('accepts narrower job permissions', () => {
    const d = doc();
    d.jobs.rls.permissions = { contents: 'none' };
    d.jobs.security.permissions = {};
    expect(checkWorkflow(d, 'ci.yml', ctx)).toEqual([]);
  });

  it.each([
    ['missing', undefined],
    ['true', true],
    ['the string true', 'true'],
  ])('rejects checkout with persist-credentials %s', (_label, value) => {
    const d = doc();
    if (value === undefined) delete d.jobs.static.steps[0].with['persist-credentials'];
    else d.jobs.static.steps[0].with['persist-credentials'] = value;
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/persist-credentials: false/);
  });

  it('rejects a checkout with no with: block at all', () => {
    const d = doc();
    delete d.jobs.rls.steps[0].with;
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/persist-credentials/);
  });

  it.each([
    ['string', 'pull_request_target'],
    ['list', ['push', 'workflow_run']],
    ['mapping', { pull_request_target: { types: ['opened'] } }],
  ])('rejects dangerous triggers given as a %s', (_label, on) => {
    const d = doc();
    d.on = on;
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/pull_request_target|workflow_run/);
  });

  it('rejects continue-on-error on a job or a step', () => {
    const d = doc();
    d.jobs.static['continue-on-error'] = true;
    d.jobs.rls.steps[2]['continue-on-error'] = '${{ always() }}';
    const m = msgs(checkWorkflow(d, 'ci.yml', ctx));
    expect(m).toMatch(/jobs\.static.*continue-on-error/);
    expect(m).toMatch(/jobs\.rls\.steps\[2\].*continue-on-error/);
    const ok = doc();
    ok.jobs.static['continue-on-error'] = false;
    expect(checkWorkflow(ok, 'ci.yml', ctx)).toEqual([]);
  });

  it('rejects an if: on a required job, since a skipped job reports success', () => {
    const d = doc();
    d.jobs.migrations.if = "github.actor != 'x'";
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/jobs\.migrations.*if:/);
  });

  describe('secrets', () => {
    it('rejects secrets in workflow-level or job-level env', () => {
      const d = doc();
      d.env.TOKEN = '${{ secrets.CLOUDFLARE_API_TOKEN }}';
      d.jobs['deploy-staging'].env = { DB: '${{ secrets.SUPABASE_STAGING_DB_URL }}' };
      const m = msgs(checkWorkflow(d, 'ci.yml', ctx));
      expect(m).toMatch(/env.*secrets/);
      expect(m).toMatch(/jobs\.deploy-staging.*secrets/);
    });

    it('rejects secrets in any job other than deploy-staging', () => {
      const d = doc();
      d.jobs.static.steps[2].env = { T: '${{ secrets.GITHUB_TOKEN }}' };
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/jobs\.static\.steps\[2\].*secrets/);
    });

    it('rejects secrets: inherit and job-level secrets', () => {
      const d = doc();
      d.jobs.reuse = { uses: `org/repo/.github/workflows/x.yml@${SHA}`, secrets: 'inherit' };
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/jobs\.reuse.*secrets/);
    });

    it('rejects a secret inlined in run: or if:', () => {
      const d = doc();
      d.jobs['deploy-staging'].steps[5].run =
        'wrangler deploy --token ${{ secrets.CLOUDFLARE_API_TOKEN }}';
      d.jobs['deploy-staging'].steps[6].if = "secrets.CLOUDFLARE_API_TOKEN != ''";
      const m = msgs(checkWorkflow(d, 'ci.yml', ctx));
      expect(m).toMatch(/steps\[5\].*only in env: or with:/);
      expect(m).toMatch(/steps\[6\].*only in env: or with:/);
    });

    it('rejects a secret on or before the install/build steps', () => {
      const d = doc();
      d.jobs['deploy-staging'].steps[1].with = { token: '${{ secrets.CLOUDFLARE_API_TOKEN }}' };
      d.jobs['deploy-staging'].steps[2].env = {
        CLOUDFLARE_API_TOKEN: '${{ secrets.CLOUDFLARE_API_TOKEN }}',
      };
      const m = msgs(checkWorkflow(d, 'ci.yml', ctx));
      expect(m).toMatch(/steps\[1\].*install/);
      expect(m).toMatch(/steps\[2\].*install/);
    });

    it('scopes each staging secret to the steps that need it', () => {
      const d = doc();
      d.jobs['deploy-staging'].steps[3].env = {
        SUPABASE_STAGING_DB_URL: '${{ secrets.SUPABASE_STAGING_DB_URL }}',
      };
      d.jobs['deploy-staging'].steps[4].env.CLOUDFLARE_API_TOKEN =
        '${{ secrets.CLOUDFLARE_API_TOKEN }}';
      d.jobs['deploy-staging'].steps[6].env.OTHER = '${{ secrets.SOME_OTHER_SECRET }}';
      const m = msgs(checkWorkflow(d, 'ci.yml', ctx));
      expect(m).toMatch(/steps\[3\].*SUPABASE_STAGING_DB_URL/);
      expect(m).toMatch(/steps\[4\].*CLOUDFLARE_API_TOKEN/);
      expect(m).toMatch(/steps\[6\].*SOME_OTHER_SECRET/);
    });

    it('treats toJSON(secrets) as a reference to every secret', () => {
      const d = doc();
      d.jobs['deploy-staging'].steps[6].env.ALL = '${{ toJSON(secrets) }}';
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/steps\[6\].*secrets/);
    });
  });

  describe('deploy-staging gate (§7.2)', () => {
    const deploy = (mutate) => {
      const d = doc();
      mutate(d.jobs['deploy-staging']);
      return msgs(checkWorkflow(d, 'ci.yml', ctx));
    };

    it('accepts the if: wrapped in ${{ }} and object forms of environment and concurrency', () => {
      expect(
        deploy((j) => {
          j.if = `\${{ ${DEPLOY_IF} }}`;
          j.environment = { name: 'staging', url: 'https://example.invalid' };
          j.concurrency = { group: 'deploy-staging', 'cancel-in-progress': false };
        }),
      ).toBe('');
    });

    it.each([
      ['needs missing a job', (j) => (j.needs = ['static', 'rls', 'security'])],
      ['no needs', (j) => delete j.needs],
      ['a weaker if:', (j) => (j.if = "github.ref == 'refs/heads/main'")],
      ['no if:', (j) => delete j.if],
      ['another environment', (j) => (j.environment = 'production')],
      ['no environment', (j) => delete j.environment],
      ['another concurrency group', (j) => (j.concurrency = 'deploy')],
      [
        'cancel-in-progress',
        (j) => (j.concurrency = { group: 'deploy-staging', 'cancel-in-progress': true }),
      ],
    ])('rejects %s', (_label, mutate) => {
      expect(deploy(mutate)).toMatch(/deploy-staging/);
    });
  });
});

describe('checkAction (local composite actions)', () => {
  it('rejects an unpinned uses, a secret and continue-on-error', () => {
    const a = parseYaml(ACTION);
    a.runs.steps[0].uses = 'pnpm/action-setup@v6';
    a.runs.steps[2].env = { T: '${{ secrets.X }}' };
    a.runs.steps[1]['continue-on-error'] = true;
    const m = msgs(checkAction(a, 'action.yml'));
    expect(m).toMatch(/not pinned/);
    expect(m).toMatch(/secrets/);
    expect(m).toMatch(/continue-on-error/);
  });

  it('rejects a non-composite local action', () => {
    expect(msgs(checkAction({ runs: { using: 'node24', main: 'x.js' } }, 'a.yml'))).toMatch(
      /composite/,
    );
  });
});

describe('runChecks over a fixture repository', () => {
  const repo = (files) => {
    const root = makeTempDir();
    writeFiles(root, files);
    return root;
  };

  it('passes the fixture workflow and action', () => {
    const root = repo({
      '.github/workflows/ci.yml': CI,
      '.github/actions/setup/action.yml': ACTION,
    });
    expect(runChecks(root)).toEqual([]);
  });

  it('fails when there is no workflow at all', () => {
    expect(msgs(runChecks(repo({ 'README.md': 'x' })))).toMatch(/no workflow files/);
  });

  it('fails when a required job is missing from every workflow', () => {
    const d = CI.replace(/\n {2}rls:\n[\s\S]*?\n\n/, '\n');
    const root = repo({
      '.github/workflows/ci.yml': d,
      '.github/actions/setup/action.yml': ACTION,
    });
    expect(msgs(runChecks(root))).toMatch(/required job "rls"/);
  });

  it('fails when a local action is missing or itself breaks a rule', () => {
    const missing = repo({ '.github/workflows/ci.yml': CI });
    expect(msgs(runChecks(missing))).toMatch(/\.github\/actions\/setup.*not found/);
    const bad = repo({
      '.github/workflows/ci.yml': CI,
      '.github/actions/setup/action.yml': ACTION.replace(/action-setup@2+/, 'action-setup@v6'),
    });
    expect(msgs(runChecks(bad))).toMatch(/action\.yml.*not pinned/);
  });

  it('counts an install inside a local action, so a secret passed to it fails', () => {
    const d = CI.replace(
      '      - uses: ./.github/actions/setup\n      - run: pnpm build',
      // No build step after it: only the install inside the action makes step 1 an install step.
      '      - uses: ./.github/actions/setup\n        env:\n          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
    );
    expect(d).not.toBe(CI);
    const root = repo({
      '.github/workflows/ci.yml': d,
      '.github/actions/setup/action.yml': ACTION,
    });
    expect(msgs(runChecks(root))).toMatch(/deploy-staging\.steps\[1\].*install/);
  });

  it('reports a YAML error as a violation, and checks .yaml files too', () => {
    const root = repo({
      '.github/workflows/ci.yml': CI,
      '.github/workflows/other.yaml': 'on: push\non: pull_request\n',
      '.github/actions/setup/action.yml': ACTION,
    });
    expect(msgs(runChecks(root))).toMatch(/duplicate key "on"/);
  });

  it('applies the rules to every workflow file', () => {
    const root = repo({
      '.github/workflows/ci.yml': CI,
      '.github/workflows/extra.yml': [
        'on: workflow_run',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  x:',
        '    runs-on: ubuntu-24.04',
        '    steps:',
        '      - uses: actions/checkout@v7',
      ].join('\n'),
      '.github/actions/setup/action.yml': ACTION,
    });
    const m = msgs(runChecks(root));
    expect(m).toMatch(/extra\.yml.*workflow_run/);
    expect(m).toMatch(/extra\.yml.*not pinned/);
    expect(m).toMatch(/extra\.yml.*persist-credentials/);
  });
});
