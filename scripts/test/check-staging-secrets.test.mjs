// AT-15 (local part): scripts/check-staging-secrets.mjs fails the deploy unless every staging
// Worker's secrets are in its allow-list (spec §7.2 step 6). Inputs are recorded-shape
// `wrangler secret list --format json` outputs with synthetic names; no Cloudflare call is made.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALLOW_LIST,
  WORKER_DIRS,
  checkWorker,
  main,
  parseSecretList,
  runChecks,
  wranglerRunner,
} from '../check-staging-secrets.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** What wrangler 4.149 prints for `secret list --format json` (`JSON.stringify(list, null, "  ")`). */
const listed = (...names) =>
  `${JSON.stringify(
    names.map((name) => ({ name, type: 'secret_text' })),
    null,
    '  ',
  )}\n`;
const ok = (stdout) => ({ status: 0, stdout, stderr: '' });

describe('ALLOW_LIST', () => {
  it('is exactly the D1 list widened by M1 R5-12 (d1 §7.1 revision 4q): edge none, api 3, jobs 2', () => {
    expect(ALLOW_LIST).toEqual({
      edge: [],
      api: ['CANDIDATE_TOKEN_PRIVATE_JWK', 'MEDIA_LINK_HMAC_KEY', 'MEMBER_INVITE_PEPPER'],
      jobs: ['MEMBER_INVITE_PEPPER', 'SUPABASE_SECRET_KEY_JOBS'],
    });
  });

  it('never lists a public var: a DSN, the Supabase URL or a publishable key', () => {
    const all = Object.values(ALLOW_LIST).flat();
    for (const name of [
      'SENTRY_DSN_WORKERS',
      'VITE_SENTRY_DSN',
      'SUPABASE_URL',
      'SUPABASE_PUBLISHABLE_KEY',
      'CANDIDATE_TOKEN_PUBLIC_JWK',
      'CANDIDATE_TOKEN_KID',
    ])
      expect(all, name).not.toContain(name);
  });

  it('gives each secret to exactly one Worker, except the invite pepper api and jobs share (M1 R5-12)', () => {
    const all = Object.values(ALLOW_LIST).flat();
    const shared = all.filter((name, i) => all.indexOf(name) !== i);
    expect(shared).toEqual(['MEMBER_INVITE_PEPPER']);
    expect(ALLOW_LIST.api).toContain('MEMBER_INVITE_PEPPER');
    expect(ALLOW_LIST.jobs).toContain('MEMBER_INVITE_PEPPER');
    for (const list of Object.values(ALLOW_LIST)) expect(new Set(list).size).toBe(list.length);
  });

  it('keeps the Supabase secret key on jobs only (member provisioning, M1-20), never api or edge', () => {
    expect(ALLOW_LIST.jobs).toContain('SUPABASE_SECRET_KEY_JOBS');
    expect(ALLOW_LIST.api).not.toContain('SUPABASE_SECRET_KEY_JOBS');
    expect(checkWorker('api', ok(listed('SUPABASE_SECRET_KEY_JOBS')))).toEqual([
      expect.stringMatching(/^api: secret SUPABASE_SECRET_KEY_JOBS is not in the allow-list/),
    ]);
  });

  it('cannot be extended at run time', () => {
    expect(Object.isFrozen(ALLOW_LIST)).toBe(true);
    for (const list of Object.values(ALLOW_LIST)) expect(Object.isFrozen(list)).toBe(true);
  });

  it('names a Worker folder with a staging env for every entry', () => {
    expect(Object.keys(WORKER_DIRS)).toEqual(Object.keys(ALLOW_LIST));
    for (const [worker, dir] of Object.entries(WORKER_DIRS)) {
      const config = path.join(REPO, dir, 'wrangler.jsonc');
      expect(existsSync(config), `${worker}: ${dir}/wrangler.jsonc`).toBe(true);
      expect(readFileSync(config, 'utf8')).toContain(`"name": "trace-${worker}-staging"`);
    }
  });
});

describe('parseSecretList', () => {
  it('reads an empty list', () => {
    expect(parseSecretList(listed())).toEqual({ names: [] });
    expect(parseSecretList('[]')).toEqual({ names: [] });
  });

  it('reads secret names', () => {
    expect(parseSecretList(listed('EXAMPLE_ONE', 'EXAMPLE_TWO'))).toEqual({
      names: ['EXAMPLE_ONE', 'EXAMPLE_TWO'],
    });
  });

  it.each([
    ['empty output', ''],
    ['whitespace only', '  \n'],
    ['not JSON', 'Secret Name: EXAMPLE_ONE\n'],
    ['a banner before the JSON', ' ⛅️ wrangler 4.149.0\n[]\n'],
    ['an object instead of a list', '{"name":"EXAMPLE_ONE"}'],
    ['null', 'null'],
    ['an entry without a name', '[{"type":"secret_text"}]'],
    ['a name that is not a string', '[{"name":7}]'],
    ['an empty name', '[{"name":""}]'],
    ['an entry that is not an object', '["EXAMPLE_ONE"]'],
  ])('fails closed on %s', (_label, stdout) => {
    const r = parseSecretList(stdout);
    expect(r.names).toBeUndefined();
    expect(r.error).toMatch(/\S/);
  });
});

describe('checkWorker', () => {
  it('passes an empty list', () => {
    expect(checkWorker('edge', ok(listed()))).toEqual([]);
    expect(checkWorker('jobs', ok(listed()))).toEqual([]);
    expect(checkWorker('api', ok(listed()))).toEqual([]);
  });

  it('fails on any secret outside the allow-list, naming each one', () => {
    const v = checkWorker('jobs', ok(listed('EXAMPLE_ONE', 'EXAMPLE_TWO')));
    expect(v).toHaveLength(2);
    expect(v[0]).toMatch(/^jobs: secret EXAMPLE_ONE is not in the allow-list/);
    expect(v[1]).toMatch(/^jobs: secret EXAMPLE_TWO is not in the allow-list/);
  });

  it('passes the exact D1 secrets of api and jobs and nothing else', () => {
    expect(checkWorker('api', ok(listed(...ALLOW_LIST.api)))).toEqual([]);
    expect(checkWorker('jobs', ok(listed(...ALLOW_LIST.jobs)))).toEqual([]);
    expect(checkWorker('api', ok(listed('MEDIA_LINK_HMAC_KEY')))).toEqual([]);
  });

  it('rejects the secret of one Worker on another Worker', () => {
    expect(checkWorker('jobs', ok(listed('MEDIA_LINK_HMAC_KEY')))).toEqual([
      expect.stringMatching(/^jobs: secret MEDIA_LINK_HMAC_KEY is not in the allow-list/),
    ]);
    expect(checkWorker('jobs', ok(listed('CANDIDATE_TOKEN_PRIVATE_JWK')))).toEqual([
      expect.stringMatching(/^jobs: secret CANDIDATE_TOKEN_PRIVATE_JWK is not in the allow-list/),
    ]);
  });

  // ADR-031 amendment 1, revision 4o: on staging the database logins live in Hyperdrive configs, so a database
  // URL secret on staging is a stale credential.
  it.each([
    ['api', 'API_DB_URL'],
    ['jobs', 'JOBS_MIRROR_DB_URL'],
    ['jobs', 'JOBS_QUALITY_DB_URL'],
    ['jobs', 'JOBS_INTEGRITY_DB_URL'],
    // M1 R5-11: the two new local-only twins are never a staging secret.
    ['jobs', 'JOBS_AUTHORING_DB_URL'],
    ['jobs', 'JOBS_ADMIN_DB_URL'],
  ])('rejects the retired %s secret %s (now a Hyperdrive config)', (worker, name) => {
    expect(ALLOW_LIST[worker]).not.toContain(name);
    expect(checkWorker(worker, ok(listed(name)))).toEqual([
      expect.stringMatching(new RegExp(`^${worker}: secret ${name} is not in the allow-list`)),
    ]);
  });

  it.each([
    ['api', 'SENTRY_DSN_WORKERS'],
    ['api', 'SUPABASE_PUBLISHABLE_KEY'],
    ['jobs', 'SENTRY_DSN_WORKERS'],
    ['api', 'MEDIA_LINK_SECRET'],
  ])('rejects %s secret %s (a var or a retired name, never a secret)', (worker, name) => {
    expect(checkWorker(worker, ok(listed(name)))).toEqual([
      expect.stringMatching(new RegExp(`^${worker}: secret ${name} is not in the allow-list`)),
    ]);
  });

  it.each(Object.values(ALLOW_LIST).flat())('rejects %s on the edge', (name) => {
    expect(checkWorker('edge', ok(listed(name)))).toEqual([
      expect.stringMatching(new RegExp(`^edge: secret ${name} is not in the allow-list`)),
    ]);
  });

  it('fails on an edge secret', () => {
    expect(checkWorker('edge', ok(listed('EXAMPLE_ONE')))).toEqual([
      expect.stringMatching(/^edge: secret EXAMPLE_ONE is not in the allow-list/),
    ]);
  });

  it('accepts a subset of an extended allow-list and rejects the rest', () => {
    const allow = { edge: [], jobs: ['EXAMPLE_ONE', 'EXAMPLE_TWO'], api: [] };
    expect(checkWorker('jobs', ok(listed('EXAMPLE_ONE')), allow)).toEqual([]);
    expect(checkWorker('jobs', ok(listed('EXAMPLE_ONE', 'EXAMPLE_THREE')), allow)).toEqual([
      expect.stringMatching(/^jobs: secret EXAMPLE_THREE is not in the allow-list/),
    ]);
  });

  it('refuses an allow-list that gives edge a secret (edge stays [])', () => {
    const allow = { edge: ['EXAMPLE_ONE'], jobs: [], api: [] };
    expect(checkWorker('edge', ok(listed('EXAMPLE_ONE')), allow)).toEqual([
      expect.stringMatching(/^edge: the allow-list must stay empty/),
    ]);
  });

  it('fails a Worker with no allow-list entry', () => {
    expect(checkWorker('other', ok(listed()))).toEqual([
      expect.stringMatching(/^other: no allow-list entry/),
    ]);
  });

  it('fails closed when wrangler exits non-zero, even with a parseable empty list', () => {
    const v = checkWorker('api', {
      status: 1,
      stdout: '[]',
      stderr: '✘ [ERROR] Authentication error\n',
    });
    expect(v).toEqual([expect.stringMatching(/^api: wrangler secret list failed \(exit 1\)/)]);
    expect(v[0]).toContain('Authentication error');
  });

  it('fails closed when wrangler could not start or was killed', () => {
    expect(
      checkWorker('api', {
        status: null,
        stdout: '',
        stderr: '',
        error: new Error('spawn pnpm ENOENT'),
      }),
    ).toEqual([expect.stringMatching(/^api: wrangler secret list failed \(spawn pnpm ENOENT\)/)]);
    expect(checkWorker('api', { status: null, signal: 'SIGTERM', stdout: '', stderr: '' })).toEqual(
      [expect.stringMatching(/^api: wrangler secret list failed \(signal SIGTERM\)/)],
    );
  });

  it('keeps only one short line of wrangler stderr', () => {
    const [v] = checkWorker('api', {
      status: 1,
      stdout: '',
      stderr: `\n${'x'.repeat(500)}\nsecond line\n`,
    });
    expect(v).not.toContain('second line');
    expect(v.length).toBeLessThan(300);
  });

  it('fails closed on unparseable output', () => {
    expect(checkWorker('jobs', ok('not json'))).toEqual([
      expect.stringMatching(/^jobs: cannot read wrangler secret list output/),
    ]);
  });
});

describe('runChecks', () => {
  it('checks edge, jobs and api in order and reports each', () => {
    const seen = [];
    const { violations, report } = runChecks({
      run: (worker) => {
        seen.push(worker);
        return ok(listed());
      },
    });
    expect(seen).toEqual(['edge', 'jobs', 'api']);
    expect(violations).toEqual([]);
    expect(report).toEqual([
      'edge: 0 secret(s), all in the allow-list',
      'jobs: 0 secret(s), all in the allow-list',
      'api: 0 secret(s), all in the allow-list',
    ]);
  });

  it('collects violations from every Worker instead of stopping at the first', () => {
    const outputs = {
      edge: ok(listed('EXAMPLE_ONE')),
      jobs: { status: 1, stdout: '', stderr: 'boom' },
      api: ok(listed('EXAMPLE_TWO')),
    };
    const { violations, report } = runChecks({ run: (w) => outputs[w] });
    expect(violations).toHaveLength(3);
    expect(violations.map((v) => v.split(':')[0])).toEqual(['edge', 'jobs', 'api']);
    expect(report).toEqual([]);
  });

  it('fails closed when the runner throws', () => {
    const { violations } = runChecks({
      run: () => {
        throw new Error('runner exploded');
      },
    });
    expect(violations).toEqual([
      expect.stringMatching(/^edge: wrangler secret list failed \(runner exploded\)/),
      expect.stringMatching(/^jobs: /),
      expect.stringMatching(/^api: /),
    ]);
  });
});

describe('wranglerRunner', () => {
  it('lists secrets of the staging env from each Worker folder, read-only, without a shell', () => {
    const calls = [];
    const run = wranglerRunner('/repo', (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { status: 0, stdout: '[]', stderr: '' };
    });
    for (const w of ['edge', 'jobs', 'api'])
      expect(run(w)).toEqual({ status: 0, stdout: '[]', stderr: '' });
    expect(calls.map((c) => c.cmd)).toEqual(['pnpm', 'pnpm', 'pnpm']);
    for (const c of calls) {
      expect(c.args).toEqual([
        'exec',
        'wrangler',
        'secret',
        'list',
        '--env',
        'staging',
        '--format',
        'json',
      ]);
      expect(c.opts.shell).toBe(false);
      expect(c.opts.encoding).toBe('utf8');
    }
    expect(calls.map((c) => path.relative('/repo', c.opts.cwd).split(path.sep).join('/'))).toEqual([
      'workers/edge',
      'workers/jobs',
      'services/api',
    ]);
  });
});

describe('main', () => {
  const capture = () => {
    const lines = { out: [], err: [] };
    return { lines, out: (l) => lines.out.push(l), err: (l) => lines.err.push(l) };
  };

  it('returns 0 and prints OK when every Worker passes', () => {
    const c = capture();
    expect(main({ run: () => ok('[]'), out: c.out, err: c.err })).toBe(0);
    expect(c.lines.err).toEqual([]);
    expect(c.lines.out.at(-1)).toBe('check-staging-secrets: OK');
  });

  it('returns 1 and prints each violation on stderr', () => {
    const c = capture();
    expect(
      main({ run: (w) => ok(w === 'api' ? listed('EXAMPLE_ONE') : '[]'), out: c.out, err: c.err }),
    ).toBe(1);
    expect(c.lines.err).toEqual([
      expect.stringMatching(/^check-staging-secrets: api: secret EXAMPLE_ONE/),
    ]);
    expect(c.lines.out).not.toContain('check-staging-secrets: OK');
  });
});
