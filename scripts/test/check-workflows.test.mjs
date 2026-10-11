// AT-12 (local part): scripts/check-workflows.mjs and its YAML-subset parser (spec §7.1, §7.2).
import { spawnSync } from 'node:child_process';
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
    ['workflow_dispatch', ['pull_request', 'workflow_dispatch']],
  ])('rejects a trigger outside the §7.1 list (%s)', (label, on) => {
    const d = doc();
    d.on = on;
    expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(new RegExp(`trigger ${label}`));
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

    it('treats github.token like secrets.GITHUB_TOKEN', () => {
      const d = doc();
      d.jobs.static.steps[2].env = { T: '${{ github.token }}' };
      d.jobs['deploy-staging'].steps[6].env.GH = "${{ github['token'] }}";
      const m = msgs(checkWorkflow(d, 'ci.yml', ctx));
      expect(m).toMatch(/jobs\.static\.steps\[2\].*GITHUB_TOKEN/);
      expect(m).toMatch(/deploy-staging\.steps\[6\].*GITHUB_TOKEN.*staging list/);
    });

    it('treats toJSON(secrets) as a reference to every secret', () => {
      const d = doc();
      d.jobs['deploy-staging'].steps[6].env.ALL = '${{ toJSON(secrets) }}';
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/steps\[6\].*secrets/);
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
      d.jobs['deploy-staging'].steps[6].if = "Secrets.CLOUDFLARE_API_TOKEN != ''";
      expect(msgs(checkWorkflow(d, 'ci.yml', ctx))).toMatch(/steps\[6\].*only in env: or with:/);
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
        '      - uses: ./.github/actions/setup\n      - run: pnpm build',
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
