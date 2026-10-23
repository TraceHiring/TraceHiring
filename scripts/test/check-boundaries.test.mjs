// AT-14 (script part): scripts/check-boundaries.mjs over fixture trees (spec §10.2).
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CREDENTIAL_NAMES,
  CREDENTIAL_PATTERN_EXEMPTIONS,
  EDGE_READ_ONLY_BUCKETS,
  REQUIRED_AUTH_CONFIG,
  SUPABASE_JS_FORBIDDEN_SCOPES,
  VENDOR_MOCK_GUARD_EXEMPTIONS,
  checkAuthConfig,
  checkNoDynamicCode,
  checkSupabaseJsScope,
  checkPackagesReadOnly,
  checkVendorMockGuards,
  checkCredentialNames,
  checkCrlf,
  checkEslintDisables,
  checkNoErrorReporter,
  NO_REPORTER_SCOPES,
  checkSupabaseConfig,
  checkTrackedEnvFiles,
  checkViteNames,
  checkWorkersObservability,
  parseJsonc,
  WORKERS_OBSERVABILITY,
  runChecks,
} from '../check-boundaries.mjs';
import {
  cleanupTempDirs,
  commitAll,
  git,
  initRepo,
  makeTempDir,
  writeFiles,
} from './fixtures/checks/temp-repo.mjs';

afterEach(cleanupTempDirs);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const f = (p, content) => ({ path: p, content });

describe('rule 1: credential names in apps, packages, workers/edge', () => {
  it('covers the api-only signing and link secrets (d1 bindings security review F3)', () => {
    for (const name of ['CANDIDATE_TOKEN_PRIVATE_JWK', 'MEDIA_LINK_HMAC_KEY']) {
      const v = checkCredentialNames([f('workers/edge/src/token.ts', `env.${name};\n`)]);
      expect(v.map((x) => x.rule)).toEqual([1]);
    }
  });
  it.each(CREDENTIAL_NAMES)('flags %s in edge code', (name) => {
    const v = checkCredentialNames([f('workers/edge/src/index.ts', `const x = '${name}';\n`)]);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe(1);
    expect(v[0].path).toBe('workers/edge/src/index.ts');
  });

  it('is case-insensitive', () => {
    expect(
      checkCredentialNames([f('apps/candidate/src/a.ts', 'const jwt_secret = 1;')]),
    ).toHaveLength(1);
  });

  it('flags names in wrangler.jsonc, app code and packages', () => {
    const v = checkCredentialNames([
      f('workers/edge/wrangler.jsonc', '{ "vars": { "DATABASE_URL": "" } }'),
      f('apps/recruiter/src/x.tsx', 'fetch("postgresql://")'),
      f('packages/shared/src/y.ts', 'export const k = "SUPABASE_SECRET_KEY";'),
    ]);
    expect(v.map((x) => x.path)).toEqual([
      'workers/edge/wrangler.jsonc',
      'apps/recruiter/src/x.tsx',
      'packages/shared/src/y.ts',
    ]);
  });

  it('ignores server workers, scripts, docs, specs and Markdown', () => {
    const v = checkCredentialNames([
      f('workers/jobs/src/index.ts', 'SUPABASE_SERVICE_ROLE_KEY'),
      f('services/api/src/index.ts', 'SUPABASE_SERVICE_ROLE_KEY'),
      f('scripts/test/fixtures/checks/x.ts', 'service_role'),
      f('docs/plan.md', 'service_role'),
      f('specs/m0-foundations.md', 'service_role'),
      f('packages/vendors/README.md', 'service_role'),
      f('workers/edgeless/src/a.ts', 'service_role'),
    ]);
    expect(v).toEqual([]);
  });
});

describe('rule 1: the redactor pattern exemption (spec §9.1 vs §10.2)', () => {
  const REDACT = 'packages/shared/src/log/redact.ts';

  // The exemption is the regex-literal text `sb_secret_[\w-]*` only (S1.4 security review M6),
  // so a real key literal in the redactor still fails.
  const PATTERN = String.raw`sb_secret_[\w-]*`;

  it('is exactly one regex-literal form in exactly one file', () => {
    expect(CREDENTIAL_PATTERN_EXEMPTIONS).toEqual({ [REDACT]: [PATTERN] });
    expect(Object.isFrozen(CREDENTIAL_PATTERN_EXEMPTIONS)).toBe(true);
    expect(Object.isFrozen(CREDENTIAL_PATTERN_EXEMPTIONS[REDACT])).toBe(true);
  });

  it('allows the redactor to match sb_secret_ values with the regex-literal form', () => {
    expect(checkCredentialNames([f(REDACT, String.raw`const p = /\bsb_secret_[\w-]*/g;`)])).toEqual(
      [],
    );
    // The redactor's line as it stands (packages/shared/src/log/redact.ts).
    expect(
      checkCredentialNames([f(REDACT, String.raw`  [/\bsb_secret_[\w-]*/g, REDACTED],`)]),
    ).toEqual([]);
  });

  it.each([
    ['a key literal', `const k = '${['sb', 'secret', 'abcdefghijklmnopqrstuvwx'].join('_')}';`],
    ['the bare prefix', "const s = 'sb_secret_';"],
    ['the prefix in another regex form', String.raw`const p = /sb_secret_\w+/;`],
    ['the prefix in another case', String.raw`const p = /SB_SECRET_[\w-]*/;`],
    [
      'a key next to the allowed form',
      String.raw`const p = /sb_secret_[\w-]*/; const k = 'sb_secret_` +
        'abcdefghijklmnopqrst' +
        "';",
    ],
  ])('flags %s in the redactor', (_label, content) => {
    const v = checkCredentialNames([f(REDACT, content)]);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('sb_secret_');
  });

  it('still flags every other credential name in the redactor', () => {
    for (const name of CREDENTIAL_NAMES.filter((n) => n !== 'sb_secret_')) {
      const v = checkCredentialNames([
        f(REDACT, String.raw`const p = /\bsb_secret_[\w-]*/; const q = '` + name + "';"),
      ]);
      expect(v, name).toHaveLength(1);
      expect(v[0].message).toContain(name);
      expect(v[0].message).not.toContain('sb_secret_');
    }
  });

  it('does not extend to any other file, including the redactor tests and look-alike paths', () => {
    for (const p of [
      'packages/shared/src/log/redact.test.ts',
      'packages/shared/src/log/logger.ts',
      'packages/shared/src/redact.ts',
      'apps/candidate/src/log/redact.ts',
      'packages/shared/src/log/redact.ts.bak',
    ]) {
      expect(checkCredentialNames([f(p, "const s = 'sb_secret_';")]), p).toHaveLength(1);
      expect(
        checkCredentialNames([f(p, String.raw`const p = /\bsb_secret_[\w-]*/g;`)]),
        p,
      ).toHaveLength(1);
    }
  });
});

describe('rule 2: tracked .dev.vars* and .env* files', () => {
  it('flags .dev.vars*, .env and .env.* anywhere, allows env.example', () => {
    const v = checkTrackedEnvFiles([
      'env.example',
      'workers/edge/.dev.vars',
      'workers/edge/.dev.vars.staging',
      '.env',
      'apps/candidate/.env.local',
      '.env.example',
      'src/environment.ts',
      '.envrc',
      'workers/jobs/.env-staging',
      '.env_local',
    ]);
    expect(v.map((x) => x.path)).toEqual([
      'workers/edge/.dev.vars',
      'workers/edge/.dev.vars.staging',
      '.env',
      'apps/candidate/.env.local',
      '.env.example',
      '.envrc',
      'workers/jobs/.env-staging',
      '.env_local',
    ]);
    expect(v.every((x) => x.rule === 2)).toBe(true);
  });
});

describe('rule 3: forbidden VITE_* names', () => {
  it.each(['SECRET', 'TOKEN', 'PASSWORD', 'PRIVATE', 'JWT', 'DB', 'KEY'])(
    'flags a VITE_ name containing %s',
    (word) => {
      const v = checkViteNames([
        f('apps/candidate/src/a.ts', `import.meta.env.VITE_MY_${word}_X;`),
      ]);
      expect(v).toHaveLength(1);
      expect(v[0].rule).toBe(3);
      expect(v[0].message).toContain(`VITE_MY_${word}_X`);
    },
  );

  it('allows VITE_SENTRY_DSN and harmless names, and ignores code outside apps/packages', () => {
    const v = checkViteNames([
      f(
        'apps/recruiter/src/a.ts',
        'import.meta.env.VITE_SENTRY_DSN; import.meta.env.VITE_APP_NAME',
      ),
      f('apps/candidate/vite.config.ts', '// envPrefix stays the default `VITE_`'),
      f('workers/edge/src/a.ts', 'VITE_SECRET'),
    ]);
    expect(v).toEqual([]);
  });

  it('checks packages too, since the apps bundle them', () => {
    const v = checkViteNames([f('packages/ui/src/a.ts', 'import.meta.env.VITE_API_KEY')]);
    expect(v).toHaveLength(1);
  });

  it('allows exactly VITE_SUPABASE_PUBLISHABLE_KEY and no other KEY name (M0b §2.7)', () => {
    expect(
      checkViteNames([
        f('apps/recruiter/src/a.ts', 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY'),
      ]),
    ).toEqual([]);
    for (const name of [
      'VITE_SUPABASE_ANON_KEY',
      'VITE_SUPABASE_SECRET_KEY',
      'VITE_SUPABASE_PUBLISHABLE_KEY_2',
      'VITE_SUPABASE_SERVICE_ROLE_KEY',
      'VITE_PUBLISHABLE_KEY',
    ]) {
      const v = checkViteNames([f('apps/recruiter/src/a.ts', `import.meta.env.${name}`)]);
      expect(v, name).toHaveLength(1);
    }
  });
});

describe('rule 9: Supabase Auth settings in supabase/config.toml (M0b §4.1)', () => {
  const realConfig = readFileSync(
    path.join(import.meta.dirname, '..', '..', 'supabase', 'config.toml'),
    'utf8',
  );
  const realTemplate = readFileSync(
    path.join(import.meta.dirname, '..', '..', 'supabase', 'templates', 'magic_link.html'),
    'utf8',
  );

  it('passes the committed config and template', () => {
    expect(checkAuthConfig({ configToml: realConfig, magicLinkTemplate: realTemplate })).toEqual(
      [],
    );
  });

  it.each(Object.keys(REQUIRED_AUTH_CONFIG))('fails when %s drifts', (key) => {
    const [table, name] = [key.slice(0, key.lastIndexOf('.')), key.slice(key.lastIndexOf('.') + 1)];
    const toml = `[${table}]\n${name} = "drifted"\n`;
    const v = checkAuthConfig({ configToml: toml, magicLinkTemplate: realTemplate });
    expect(v.map((x) => x.message).join('\n')).toContain(key);
    expect(v.every((x) => x.rule === 9)).toBe(true);
  });

  it('keeps the email provider on and turns sign-ups off globally (AT-B8 finding)', () => {
    // On the CLI, [auth.email] enable_signup is the email provider switch: false made GoTrue
    // answer every email sign-in with 422 email_provider_disabled. [auth] enable_signup = false
    // is what disables sign-ups.
    expect(REQUIRED_AUTH_CONFIG['auth.email.enable_signup']).toBe('true');
    expect(REQUIRED_AUTH_CONFIG['auth.enable_signup']).toBe('false');
  });

  it('fails when a required key is missing', () => {
    const v = checkAuthConfig({ configToml: '[auth]\n', magicLinkTemplate: realTemplate });
    expect(v.length).toBe(Object.keys(REQUIRED_AUTH_CONFIG).length);
  });

  it('fails when the magic-link template carries no {{ .Token }} code, or is missing', () => {
    const noCode = checkAuthConfig({
      configToml: realConfig,
      magicLinkTemplate: '<a href="{{ .ConfirmationURL }}">Sign in</a>',
    });
    expect(noCode.map((x) => x.rule)).toEqual([9]);
    const missing = checkAuthConfig({ configToml: realConfig, magicLinkTemplate: null });
    expect(missing.map((x) => x.rule)).toEqual([9]);
  });
});

describe('rule 10: supabase-js only in the recruiter app (M0b §4.3)', () => {
  it.each(SUPABASE_JS_FORBIDDEN_SCOPES)('flags an import under %s', (scope) => {
    const v = checkSupabaseJsScope([
      f(`${scope}src/a.ts`, "import { createClient } from '@supabase/supabase-js';"),
    ]);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe(10);
  });

  it('allows the recruiter app and ignores markdown', () => {
    expect(
      checkSupabaseJsScope([
        f(
          'apps/recruiter/src/supabase.ts',
          "import { createClient } from '@supabase/supabase-js';",
        ),
        f('packages/shared/README.md', '@supabase/supabase-js is used by the recruiter app'),
      ]),
    ).toEqual([]);
  });
});

describe('rule 4: supabase/config.toml exposure', () => {
  const okToml = [
    '[api]',
    'enabled = true',
    'schemas = ["public", "graphql_public"]',
    'extra_search_path = ["public", "extensions"]',
    '',
    '[db]',
    'port = 54322',
  ].join('\n');

  it('passes a config that exposes only public schemas', () => {
    expect(checkSupabaseConfig({ configToml: okToml, migrationsDirExists: true })).toEqual([]);
  });

  it.each(['private', 'quality', 'integrity'])('flags %s in [api] schemas', (schema) => {
    const toml = okToml.replace('"graphql_public"', `"graphql_public", "${schema}"`);
    const v = checkSupabaseConfig({ configToml: toml, migrationsDirExists: true });
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe(4);
    expect(v[0].message).toContain(schema);
  });

  it('flags a multi-line extra_search_path and single quotes', () => {
    const toml = okToml.replace(
      'extra_search_path = ["public", "extensions"]',
      "extra_search_path = [\n  'public',\n  'integrity',\n]",
    );
    expect(checkSupabaseConfig({ configToml: toml, migrationsDirExists: true })).toHaveLength(1);
  });

  it('flags a dotted api.schemas key outside the [api] table', () => {
    const toml = 'api.schemas = ["public", "private"]\n';
    expect(checkSupabaseConfig({ configToml: toml, migrationsDirExists: true })).toHaveLength(1);
  });

  it('ignores the names in other tables and comments', () => {
    const toml = okToml + '\n# schemas = ["private"]\n[db.seed]\nsql_paths = ["./quality.sql"]\n';
    expect(checkSupabaseConfig({ configToml: toml, migrationsDirExists: true })).toEqual([]);
  });

  it('allows a missing config.toml only while supabase/migrations is also missing', () => {
    expect(checkSupabaseConfig({ configToml: null, migrationsDirExists: false })).toEqual([]);
    const v = checkSupabaseConfig({ configToml: null, migrationsDirExists: true });
    expect(v).toHaveLength(1);
    expect(v[0].message).toMatch(/config\.toml is missing/);
  });
});

describe('rule 5: CRLF in the index', () => {
  it('parses `git ls-files --eol -z` output', () => {
    const out = [
      'i/lf    w/lf    attr/text=auto eol=lf \tok.ts',
      'i/crlf  w/crlf  attr/                 \tdir with space/bad.ts',
      'i/mixed w/mixed attr/                 \tmixed.txt',
      'i/-text w/-text attr/                 \tlogo.png',
      'i/      w/      attr/                 \tempty.txt',
    ].join('\0');
    const v = checkCrlf(out + '\0');
    expect(v.map((x) => x.path)).toEqual(['dir with space/bad.ts', 'mixed.txt']);
    expect(v.every((x) => x.rule === 5)).toBe(true);
  });
});

describe('rule 6: eslint-disable directives that switch off boundary or Trace rules', () => {
  const src = (code) => [f('apps/candidate/src/a.tsx', code)];

  it.each([
    ['bare block disable', '/* eslint-disable */\nconst a = 1;'],
    ['bare line disable', 'const a = 1; // eslint-disable-line'],
    ['bare next-line disable', '// eslint-disable-next-line\nconst a = 1;'],
    ['bare disable with a reason only', '// eslint-disable-next-line -- because\nconst a = 1;'],
    ['boundaries rule', '// eslint-disable-next-line boundaries/element-types\nimport x from "y";'],
    ['trace rule among others', '/* eslint-disable no-console, trace/log-event-literal */'],
    ['@trace rule', '// eslint-disable-line @trace/no-blend'],
    [
      'JSX comment',
      'const a = <div>{/* eslint-disable-next-line boundaries/entry-point */}</div>;',
    ],
    ['inline config comment', '/* eslint boundaries/element-types: "off" */'],
  ])('flags a %s', (_label, code) => {
    const v = checkEslintDisables(src(code));
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe(6);
  });

  it('allows a disable that names other rules', () => {
    expect(
      checkEslintDisables(
        src('// eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party type\n'),
      ),
    ).toEqual([]);
  });

  it('checks workers and services, but skips generated files ESLint ignores and non-code files', () => {
    const v = checkEslintDisables([
      f('workers/jobs/src/a.ts', '/* eslint-disable */'),
      f('services/api/src/b.ts', '// eslint-disable-next-line trace/x'),
      f('workers/edge/worker-configuration.d.ts', '/* eslint-disable */'),
      f('packages/ui/src/generated/tokens.ts', '/* eslint-disable */'),
      f('packages/db-types/src/database.ts', '/* eslint-disable */'),
      f('packages/vendors/README.md', '/* eslint-disable */'),
      f('scripts/check-x.mjs', '/* eslint-disable */'),
    ]);
    expect(v.map((x) => x.path)).toEqual(['workers/jobs/src/a.ts', 'services/api/src/b.ts']);
  });
});

describe('rule 7: no error reporter or Sentry in the candidate app or the edge Worker', () => {
  it('covers exactly the candidate app and the edge Worker (spec §9.2, §3 D6)', () => {
    expect(NO_REPORTER_SCOPES).toEqual(['apps/candidate/', 'workers/edge/']);
  });

  it.each([
    ['a reportError import', 'import { reportError } from "@trace/shared/log";'],
    ['the noop reporter', 'import { noopErrorReporter } from "@trace/shared";'],
    ['the ErrorReporter type', 'type R = import("@trace/shared/log").ErrorReporter;'],
    ['a Sentry package', 'import * as S from "@sentry/browser";'],
    ['the shared Sentry entry', 'import { createSentryReporter } from "@trace/shared/sentry";'],
    ['a call to the runtime global', 'reportError(new Error("x"));'],
  ])('flags %s in edge or candidate source', (_label, code) => {
    for (const p of ['workers/edge/src/app.ts', 'apps/candidate/src/main.tsx']) {
      const v = checkNoErrorReporter([f(p, code)]);
      expect(v).toHaveLength(1);
      expect(v[0].rule).toBe(7);
      expect(v[0].path).toBe(p);
    }
  });

  it('allows the reporter in the recruiter app, jobs and api, and skips tests, generated and non-code files', () => {
    const code = 'import { reportError, noopErrorReporter } from "@trace/shared/log";';
    expect(
      checkNoErrorReporter([
        f('apps/recruiter/src/error-reporting.ts', code),
        f('workers/jobs/src/app.ts', code),
        f('services/api/src/app.ts', code),
        f('workers/edge/src/no-error-reporter.test.ts', code),
        f('apps/candidate/src/candidate-guards.test.ts', code),
        f('workers/edge/worker-configuration.d.ts', 'declare function reportError(e: any): void;'),
        f('apps/candidate/README.md', code),
      ]),
    ).toEqual([]);
  });

  it('allows plain prose such as "no error reporter"', () => {
    expect(
      checkNoErrorReporter([f('workers/edge/src/app.ts', '// The edge has no error reporter.')]),
    ).toEqual([]);
  });
});

/** The observability block of specs/m0b-tenancy.md §1.1 item 9 (c), as wrangler.jsonc text. */
const OBS_JSONC = `"observability": {
    "enabled": true,
    "head_sampling_rate": 1,
    "redact_query_string": true,
    "logs": { "invocation_logs": false },
    "traces": { "enabled": false },
  },`;

const wrangler = (observability = OBS_JSONC, env = '') => `// A Worker config.
{
  "name": "trace-x", // trailing comment
  "main": "src/index.ts",
  /* block
     comment */
  ${observability}
  "vars": { "VERSION": "dev", "URL": "https://example.test/a//b" },
  "env": { ${env} },
}
`;

describe('rule 8: Workers Logs settings in every Worker wrangler.jsonc (M0b §1.1 9c)', () => {
  const at = (p, content) => checkWorkersObservability([f(p, content)]);

  it('pins exactly the spec values', () => {
    expect(WORKERS_OBSERVABILITY).toEqual({
      enabled: true,
      head_sampling_rate: 1,
      redact_query_string: true,
      logs: { invocation_logs: false },
      traces: { enabled: false },
    });
  });

  it.each([
    'workers/edge/wrangler.jsonc',
    'workers/jobs/wrangler.jsonc',
    'services/api/wrangler.jsonc',
  ])('passes %s with the exact block (comments and trailing commas allowed)', (p) => {
    expect(at(p, wrangler())).toEqual([]);
  });

  it('ignores files that are not a Worker wrangler.jsonc', () => {
    expect(at('workers/edge/src/app.ts', 'observability = false')).toEqual([]);
    expect(at('apps/recruiter/wrangler.jsonc', '{}')).toEqual([]);
  });

  it.each([
    ['missing', ''],
    ['off', '"observability": { "enabled": false },'],
    [
      'invocation logs on',
      OBS_JSONC.replace('"invocation_logs": false', '"invocation_logs": true'),
    ],
    ['invocation logs unset', OBS_JSONC.replace('{ "invocation_logs": false }', '{}')],
    [
      'traces on',
      OBS_JSONC.replace('"traces": { "enabled": false }', '"traces": { "enabled": true }'),
    ],
    ['traces unset', OBS_JSONC.replace('"traces": { "enabled": false },', '')],
    [
      'query strings kept',
      OBS_JSONC.replace('"redact_query_string": true', '"redact_query_string": false'),
    ],
    ['sampled', OBS_JSONC.replace('"head_sampling_rate": 1', '"head_sampling_rate": 0.5')],
    ['an extra key', OBS_JSONC.replace('"logs": {', '"logs": { "destinations": ["x"],')],
  ])('fails when observability is %s', (_label, block) => {
    const v = at('workers/edge/wrangler.jsonc', wrangler(block));
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe(8);
    expect(v[0].path).toBe('workers/edge/wrangler.jsonc');
  });

  it('fails when an env block overrides observability', () => {
    const env = '"staging": { "observability": { "enabled": false } },';
    const v = at('workers/jobs/wrangler.jsonc', wrangler(OBS_JSONC, env));
    expect(v).toHaveLength(1);
    expect(v[0].message).toMatch(/env\.staging/);
  });

  it('fails closed on a file it cannot parse', () => {
    const v = at('services/api/wrangler.jsonc', '{ "observability": ');
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe(8);
  });
});

describe('parseJsonc', () => {
  it('keeps // and /* inside strings and drops real comments and trailing commas', () => {
    expect(parseJsonc('{ "a": "x//y", "b": "/*z*/", /* c */ "c": [1, 2,], // d\n }')).toEqual({
      a: 'x//y',
      b: '/*z*/',
      c: [1, 2],
    });
  });

  it('handles escaped quotes in strings', () => {
    expect(parseJsonc('{ "a": "q\\"//still string" }')).toEqual({ a: 'q"//still string' });
  });

  it('throws on invalid input', () => {
    expect(() => parseJsonc('{ "a": }')).toThrow();
  });
});

describe('runChecks over a fixture repository', () => {
  const cleanTree = {
    'env.example': 'SUPABASE_SERVICE_ROLE_KEY=\n',
    'apps/candidate/src/main.tsx': 'export const name = "Trace";\n',
    'workers/edge/wrangler.jsonc': wrangler(),
    'workers/jobs/src/index.ts': '// server worker\n',
    'docs/plan.md': 'service_role is server-only\n',
  };

  it('passes a clean tree with no supabase/ directory', () => {
    const repo = initRepo();
    writeFiles(repo, cleanTree);
    commitAll(repo);
    expect(runChecks(repo)).toEqual([]);
  });

  it('reports each rule once, including untracked files and CRLF in the index', () => {
    const repo = initRepo();
    writeFiles(repo, {
      ...cleanTree,
      'workers/edge/src/db.ts': 'const u = process.env.DB_URL;\n',
      'workers/edge/.dev.vars': 'X=1\n',
      'apps/candidate/src/env.ts': 'import.meta.env.VITE_SUPABASE_KEY;\n',
      'supabase/migrations/.keep': '',
      'apps/recruiter/src/crlf.ts': 'const a = 1;\r\nconst b = 2;\r\n',
      'services/api/src/c.ts': '/* eslint-disable */\n',
      'workers/jobs/wrangler.jsonc': '{ "observability": { "enabled": false } }\n',
    });
    commitAll(repo);
    // Untracked (but not ignored) files are checked too, so a new file can't slip through before `git add`.
    writeFiles(repo, { 'packages/shared/src/new.ts': 'export const t = "sb_secret_";\n' });
    const v = runChecks(repo);
    expect(v.map((x) => `${x.rule}:${x.path}`).sort()).toEqual(
      [
        '1:workers/edge/src/db.ts',
        '1:packages/shared/src/new.ts',
        '2:workers/edge/.dev.vars',
        '3:apps/candidate/src/env.ts',
        '4:supabase/config.toml',
        '5:apps/recruiter/src/crlf.ts',
        '6:services/api/src/c.ts',
        '8:workers/jobs/wrangler.jsonc',
      ].sort(),
    );
  });

  it('works from a path that contains spaces', () => {
    const parent = makeTempDir('trace check spaces ');
    const repo = path.join(parent, 'repo with space');
    mkdirSync(repo);
    initRepo(repo);
    writeFiles(repo, { ...cleanTree, 'apps/candidate/src/x.ts': 'SUPABASE_JWT\n' });
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'x');
    expect(runChecks(repo).map((x) => x.path)).toEqual(['apps/candidate/src/x.ts']);
  });
});

describe('rule 11: the edge reads PACKAGES only (d1 §4.2; bindings security review F2)', () => {
  const edge = (content) => checkPackagesReadOnly([f('workers/edge/src/session.ts', content)]);
  it.each([
    'await env.PACKAGES.get(key);',
    'await env.PACKAGES?.head(key);',
    'const o = await this.env.PACKAGES.get(`packages/${id}.json`);',
    'interface X { PACKAGES: R2Bucket; PACKAGES2?: R2Bucket }',
  ])('allows %s', (code) => {
    expect(edge(code)).toEqual([]);
  });
  it.each([
    'await env.PACKAGES.put(key, body);',
    'await env.PACKAGES.delete(key);',
    'await env.PACKAGES.list();',
    'await env.PACKAGES.createMultipartUpload(key);',
    "await env.PACKAGES['put'](key, body);",
    'const bucket = env.PACKAGES;',
    'const { put } = env.PACKAGES;',
    'write(env.PACKAGES);',
  ])('flags %s', (code) => {
    const v = edge(code);
    expect(v).toHaveLength(1);
    expect(v[0].rule).toBe(11);
  });
  it('ignores tests, generated types and other Workers', () => {
    expect(
      checkPackagesReadOnly([
        f('workers/edge/src/session.test.ts', 'await env.PACKAGES.put(k, b);'),
        f('workers/edge/worker-configuration.d.ts', 'PACKAGES: R2Bucket;'),
        f('services/api/src/modules/tests/publish.ts', 'await env.PACKAGES.put(k, b);'),
      ]),
    ).toEqual([]);
  });
});

describe('rule 11: the edge reads ITEM_MEDIA only (m1 R5-10)', () => {
  const edge = (content) => checkPackagesReadOnly([f('workers/edge/src/item-media.ts', content)]);
  it('names both edge read-only buckets', () => {
    expect([...EDGE_READ_ONLY_BUCKETS]).toEqual(['PACKAGES', 'ITEM_MEDIA']);
    expect(Object.isFrozen(EDGE_READ_ONLY_BUCKETS)).toBe(true);
  });
  it.each([
    'const obj = await env.ITEM_MEDIA.get(`item-media/${org}/${hash}.png`);',
    'const meta = await env.ITEM_MEDIA?.head(key);',
    'type B = { ITEM_MEDIA: R2Bucket; ITEM_MEDIA_X?: R2Bucket };',
    'interface X { ITEM_MEDIA?: R2Bucket }',
  ])('allows %s', (code) => {
    expect(edge(code)).toEqual([]);
  });
  it.each([
    'await env.ITEM_MEDIA.put(key, body);',
    'await env.ITEM_MEDIA.delete(key);',
    'await env.ITEM_MEDIA.list({ prefix: "item-media/" });',
    'await env.ITEM_MEDIA.createMultipartUpload(key);',
    "await env.ITEM_MEDIA['get'](key);",
    'const media = env.ITEM_MEDIA;',
    'const { ITEM_MEDIA } = env;',
    'serve(env.ITEM_MEDIA, key);',
  ])('flags %s', (code) => {
    const v = edge(code);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ rule: 11, path: 'workers/edge/src/item-media.ts' });
    expect(v[0].message).toMatch(/ITEM_MEDIA other than get\/head/);
  });
  it('reports each bucket once per file', () => {
    const v = edge(
      'await env.PACKAGES.put(a, b); await env.ITEM_MEDIA.put(a, b); env.ITEM_MEDIA.list();',
    );
    expect(v.map((x) => x.message.split(' ')[1])).toEqual(['PACKAGES', 'ITEM_MEDIA']);
  });
  it('ignores tests, generated types and the api (which may write images)', () => {
    expect(
      checkPackagesReadOnly([
        f('workers/edge/src/item-media.test.ts', 'await env.ITEM_MEDIA.put(k, b);'),
        f('workers/edge/worker-configuration.d.ts', 'ITEM_MEDIA: R2Bucket;'),
        f('services/api/src/modules/bank/images.ts', 'await env.ITEM_MEDIA.put(k, b);'),
      ]),
    ).toEqual([]);
  });
});

describe('rule 12: no eval or Function constructor in packages/item-variants (m1 R5-10, §11.2)', () => {
  const variants = (content, p = 'packages/item-variants/src/generate.ts') =>
    checkNoDynamicCode([f(p, content)]);
  it('passes while the package does not exist, and on plain code', () => {
    expect(checkNoDynamicCode([])).toEqual([]);
    expect(
      variants('export const evaluate = (spec: Spec) => spec.min + spec.step * pick(rng);'),
    ).toEqual([]);
    expect(variants('const isFunction = (x: unknown) => typeof x === "function";')).toEqual([]);
  });
  it.each([
    'export const run = (src: string) => eval(src);',
    'const f = eval;',
    'globalThis.eval(src);',
    'const g = new Function("a", "return a * 2");',
    'const h = Function("return 1")();',
    'const k = new Function ("x", body);',
    'const m = Function.call(null, "return 1");',
    'const n = (0, eval)("1");',
  ])('flags %s', (code) => {
    const v = variants(code);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ rule: 12, path: 'packages/item-variants/src/generate.ts' });
  });
  it('checks every source file of the package, tests included, and nothing outside it', () => {
    expect(variants('eval("1")', 'packages/item-variants/src/generate.test.ts')).toHaveLength(1);
    expect(variants('eval("1")', 'packages/item-variants/scripts/x.mjs')).toHaveLength(1);
    expect(variants('eval("1")', 'packages/item-variants/README.md')).toEqual([]);
    expect(variants('eval("1")', 'packages/item-delivery/src/draw.ts')).toEqual([]);
    expect(variants('eval("1")', 'packages/item-variants-old/src/x.ts')).toEqual([]);
  });
  it('fails a fixture repository that adds the package with an eval (runChecks)', () => {
    const repo = initRepo();
    writeFiles(repo, {
      'packages/item-variants/src/index.ts': 'export const run = (s: string) => eval(s);\n',
    });
    commitAll(repo);
    expect(runChecks(repo).map((x) => `${x.rule}:${x.path}`)).toEqual([
      '12:packages/item-variants/src/index.ts',
    ]);
  });
});

describe('rule 13: every vendors Mock* refuses production (m1 R5-10, §11.2; as messaging.ts)', () => {
  const vendors = (content, p = 'packages/vendors/src/llm-drafter.ts') =>
    checkVendorMockGuards([f(p, content)]);
  const GUARD = [
    "const ALLOWED_ENVS: readonly string[] = ['dev', 'staging'];",
    'function assertMockEnv(env: unknown): asserts env is "dev" | "staging" {',
    '  if (typeof env !== "string" || !ALLOWED_ENVS.includes(env)) throw new MockInProductionError();',
    '}',
  ].join('\n');
  const guardedClass = [
    'export class MockLlmDrafter implements LlmDrafter {',
    '  readonly #env: string;',
    '  constructor(env: DrafterEnv) {',
    '    assertMockEnv(env);',
    '    this.#env = env;',
    '  }',
    '  draft(req: DraftRequest) { return Promise.resolve({ items: [], note: "}" }); }',
    '}',
  ].join('\n');

  it('passes a Mock class whose constructor and factory call the env guard', () => {
    const factory = [
      'export function createMockLlmDrafter(env: DrafterEnv): LlmDrafter {',
      '  assertMockEnv(env);',
      '  return new MockLlmDrafter(env);',
      '}',
    ].join('\n');
    expect(vendors(`${GUARD}\n${guardedClass}\n${factory}\n`)).toEqual([]);
    // The guard may be imported from a shared module.
    expect(vendors(`import { assertMockEnv } from './mock-env.js';\n${guardedClass}\n`)).toEqual(
      [],
    );
  });

  it('passes the current vendors sources (messaging.ts guards a non-Mock class; llm-grader.ts is exempt)', () => {
    for (const name of ['messaging.ts', 'llm-grader.ts', 'index.ts']) {
      const p = `packages/vendors/src/${name}`;
      const content = readFileSync(path.join(REPO_ROOT, ...p.split('/')), 'utf8');
      expect(checkVendorMockGuards([f(p, content)]), name).toEqual([]);
    }
  });

  it.each([
    [
      'a Mock class with no constructor',
      `${GUARD}\nexport class MockLlmDrafter { draft() { return 1; } }\n`,
    ],
    [
      'a Mock class whose constructor never calls the guard',
      `${GUARD}\nexport class MockLlmDrafter {\n  constructor(env: string) { this.env = env; }\n}\n`,
    ],
    [
      'a guard call outside the constructor only',
      `${GUARD}\nexport class MockLlmDrafter {\n  constructor() {}\n  draft(env: string) { assertMockEnv(env); }\n}\n`,
    ],
    ['a guarded class but no guard function defined or imported', `${guardedClass}\n`],
    [
      'a deny-list guard (only "production" refused, so an unknown env passes)',
      `function assertMockEnv(env: string) {\n  if (env === 'production') throw new Error('no');\n}\n${guardedClass}\n`,
    ],
    [
      'a guard that never throws',
      `const ALLOWED_ENVS = ['dev', 'staging'];\nfunction assertMockEnv(env: string) {\n  return ALLOWED_ENVS.includes(env);\n}\n${guardedClass}\n`,
    ],
    [
      'a factory that skips the guard',
      `${GUARD}\n${guardedClass}\nexport function createMockLlmDrafter(env: string) {\n  return Object.create(MockLlmDrafter.prototype);\n}\n`,
    ],
    [
      'an arrow factory that skips the guard',
      `${GUARD}\n${guardedClass}\nexport const createMockLlmDrafter = (env: string) => ({ draft: () => 1 });\n`,
    ],
  ])('flags %s', (_name, content) => {
    const v = vendors(content);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ rule: 13, path: 'packages/vendors/src/llm-drafter.ts' });
  });

  it('exempts only MockLlmGrader in llm-grader.ts (its production guard is the jobs wiring graderFor)', () => {
    expect(VENDOR_MOCK_GUARD_EXEMPTIONS).toEqual({
      'packages/vendors/src/llm-grader.ts': ['MockLlmGrader'],
    });
    expect(Object.isFrozen(VENDOR_MOCK_GUARD_EXEMPTIONS)).toBe(true);
    const bare = 'export class MockLlmGrader { grade() { return 1; } }\n';
    expect(vendors(bare, 'packages/vendors/src/llm-grader.ts')).toEqual([]);
    expect(vendors(bare, 'packages/vendors/src/llm-drafter.ts')).toHaveLength(1);
    expect(
      vendors(
        `${bare}export class MockOther { constructor() {} }\n`,
        'packages/vendors/src/llm-grader.ts',
      ),
    ).toHaveLength(1);
  });

  it('ignores tests, other packages and non-Mock names', () => {
    const bare = 'export class MockLlmDrafter { draft() { return 1; } }\n';
    expect(vendors(bare, 'packages/vendors/src/llm-drafter.test.ts')).toEqual([]);
    expect(vendors(bare, 'packages/shared/src/x.ts')).toEqual([]);
    expect(vendors('export class Mocking { x() {} }\nexport class LlmDrafterMock {}\n')).toEqual(
      [],
    );
  });
});
