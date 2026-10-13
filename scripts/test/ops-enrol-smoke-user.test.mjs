// scripts/ops/enrol-smoke-user.mjs (specs/m0b-tenancy.md §4.4, R7). Fakes only: no database, no
// network, no process is started. Synthetic values only; every key-shaped string is built at run
// time (the pre-commit gitleaks hook rejects secret-shaped literals).
import { describe, expect, it } from 'vitest';
import { base32Encode, totp } from '../lib/totp.mjs';
import { main } from '../ops/enrol-smoke-user.mjs';

const enc = (s) => Buffer.from(s).toString('base64url');
const PASSWORD = `${enc('synthetic-smoke')}-Aa1`;
const SERVICE_KEY = `${enc('synthetic-demo-service-key')}.${enc('part-two')}`;
const SECRET_KEY = `${enc('synthetic-demo-secret-key')}.${enc('part-two')}`;
const PUBLISHABLE_KEY = `${enc('synthetic-publishable-key')}.${enc('part-two')}`;
const ACCESS_TOKEN = `${enc('synthetic-access-token')}.${enc('part-two')}`;
const TOTP_SECRET = base32Encode(Buffer.from('synthetic-totp-secret'));
const DB_PASSWORD = enc('synthetic-db-password');
const STAGING_DB_URL = `postgresql://postgres:${DB_PASSWORD}@db.example.test:5432/postgres`;
const LOCAL_DB_URL = `postgresql://postgres:${DB_PASSWORD}@127.0.0.1:54322/postgres`;
const STAGING_URL = 'https://stg-project.example.test';

const NEW_USER_ID = '11111111-1111-4111-8111-111111111111';
const SMOKE_ID = '22222222-2222-4222-8222-222222222222';
const OWNER_ID = '33333333-3333-4333-8333-333333333333';
const ORG_ID = '44444444-4444-4444-8444-444444444444';
const MEMBERSHIP_ID = '55555555-5555-4555-8555-555555555555';
const REQUEST_ID = '66666666-6666-4666-8666-666666666666';
const FACTOR_ID = '77777777-7777-4777-8777-777777777777';
const CHALLENGE_ID = '88888888-8888-4888-8888-888888888888';
const NOW = 1_760_000_000_000;

const SMOKE_EMAIL = 'p-smoke@example.test';
const OWNER_EMAIL = 'p-owner@example.test';

const stackText = (api = 'http://127.0.0.1:54321', extra = {}) =>
  Object.entries({
    API_URL: api,
    DB_URL: LOCAL_DB_URL,
    SERVICE_ROLE_KEY: SERVICE_KEY,
    SECRET_KEY,
    ...extra,
  })
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}="${v}"`)
    .join('\n');

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** Scripted deps. `fetchHandlers` maps a URL path to a response (or a function of the request). */
function harness({ env = {}, stack = stackText(), fetchHandlers = {}, sql = {} } = {}) {
  const fetchCalls = [];
  const spawnCalls = [];
  const out = [];
  const err = [];
  const handlers = {
    '/auth/v1/admin/users': json(200, { id: NEW_USER_ID }),
    '/auth/v1/token': json(200, { access_token: ACCESS_TOKEN }),
    '/auth/v1/factors': json(200, { id: FACTOR_ID, type: 'totp', totp: { secret: TOTP_SECRET } }),
    [`/auth/v1/factors/${FACTOR_ID}/challenge`]: json(200, { id: CHALLENGE_ID }),
    [`/auth/v1/factors/${FACTOR_ID}/verify`]: json(200, { access_token: ACCESS_TOKEN }),
    ...fetchHandlers,
  };
  const sqlResults = {
    lookupSmoke: { status: 0, stdout: `${SMOKE_ID}\n`, stderr: '' },
    lookupOwner: { status: 0, stdout: `${OWNER_ID}\n`, stderr: '' },
    createOrg: { status: 0, stdout: `${ORG_ID}\n`, stderr: '' },
    addMember: { status: 0, stdout: `${MEMBERSHIP_ID}\n`, stderr: '' },
    ...sql,
  };
  const deps = {
    env,
    platform: 'linux',
    randomUUID: () => REQUEST_ID,
    now: () => NOW,
    stdout: { write: (s) => out.push(s) },
    stderr: { write: (s) => err.push(s) },
    async fetch(url, init = {}) {
      const u = new URL(url);
      fetchCalls.push({
        url: String(url),
        pathname: u.pathname,
        search: u.search,
        method: init.method,
        headers: init.headers ?? {},
        body: init.body === undefined ? undefined : JSON.parse(init.body),
        raw: init.body,
      });
      const h = handlers[u.pathname];
      if (!h) throw new Error(`unexpected request ${u.pathname}`);
      return typeof h === 'function' ? h() : h;
    },
    spawnSync(cmd, args, opts) {
      spawnCalls.push({ cmd, args, opts });
      if (cmd === 'pnpm' || cmd.startsWith('pnpm ')) {
        return stack === null ? { status: 1, stdout: '' } : { status: 0, stdout: stack };
      }
      if (cmd === 'psql' && args[0] === '--version') return { status: 0, stdout: 'psql 17\n' };
      const vars = {};
      args.forEach((a, i) => {
        if (args[i - 1] === '-v') vars[a.split('=')[0]] = a.split('=').slice(1).join('=');
      });
      if (opts.input.includes('auth.users')) {
        return vars.p_email === SMOKE_EMAIL ? sqlResults.lookupSmoke : sqlResults.lookupOwner;
      }
      if (opts.input.includes('create_org')) return sqlResults.createOrg;
      if (opts.input.includes('add_member')) return sqlResults.addMember;
      throw new Error('unexpected sql');
    },
  };
  const sqlCalls = () =>
    spawnCalls.filter(
      (c) => !(c.cmd === 'pnpm' || c.cmd.startsWith('pnpm ')) && c.args[0] !== '--version',
    );
  return {
    deps,
    fetchCalls,
    spawnCalls,
    sqlCalls,
    stdout: () => out.join(''),
    stderr: () => err.join(''),
    allOutput: () => out.join('') + err.join(''),
  };
}

const varsOf = (args) => {
  const vars = {};
  args.forEach((a, i) => {
    if (args[i - 1] === '-v') vars[a.split('=')[0]] = a.split('=').slice(1).join('=');
  });
  return vars;
};

const LOCAL_ARGV = ['--env', 'local', '--email', SMOKE_EMAIL];
const STAGING_ARGV = ['--env', 'staging', '--email', SMOKE_EMAIL, '--owner-email', OWNER_EMAIL];
const stagingEnv = (over = {}) => ({
  SUPABASE_STAGING_URL: STAGING_URL,
  SUPABASE_STAGING_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
  TRACE_OPERATOR_DB_URL: STAGING_DB_URL,
  SMOKE_PASSWORD: PASSWORD,
  ...over,
});

describe('enrol-smoke-user: arguments', () => {
  it.each([
    [['--env', 'prod', '--email', SMOKE_EMAIL], 'env'],
    [['--env', 'local'], 'email'],
    [['--env', 'local', '--email', 'not-an-email'], 'email'],
    [['--env', 'staging', '--email', SMOKE_EMAIL], 'ownerEmail'],
    [[...LOCAL_ARGV, '--owner-email', OWNER_EMAIL], 'ownerEmail'],
    [
      ['--env', 'staging', '--email', SMOKE_EMAIL, '--owner-email', SMOKE_EMAIL.toUpperCase()],
      'owner',
    ],
  ])('rejects %j (exit 2, names %s, no call made)', async (argv, field) => {
    const h = harness({ env: stagingEnv() });
    expect(await main({ argv, deps: h.deps })).toBe(2);
    expect(h.stderr()).toContain(field);
    expect(h.stdout()).toBe('');
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.spawnCalls).toHaveLength(0);
  });

  it('does not echo a bad email or an unknown flag', async () => {
    const h = harness({ env: stagingEnv() });
    expect(await main({ argv: ['--env', 'local', '--email', 'bad value'], deps: h.deps })).toBe(2);
    expect(h.stderr()).not.toContain('bad value');
    expect(await main({ argv: [...LOCAL_ARGV, '--password', 'abc'], deps: h.deps })).toBe(2);
    expect(h.stderr()).not.toContain('abc');
  });

  it('takes the password only from SMOKE_PASSWORD: missing or short is exit 2', async () => {
    for (const env of [{}, { SMOKE_PASSWORD: '' }, { SMOKE_PASSWORD: 'short' }]) {
      const h = harness({ env });
      expect(await main({ argv: LOCAL_ARGV, deps: h.deps })).toBe(2);
      expect(h.stderr()).toContain('SMOKE_PASSWORD');
      expect(h.stderr()).not.toContain('short');
      expect(h.fetchCalls).toHaveLength(0);
      expect(h.spawnCalls).toHaveLength(0);
    }
  });
});

describe('enrol-smoke-user: --env local', () => {
  const env = { SMOKE_PASSWORD: PASSWORD };

  it('creates one confirmed user through the local admin endpoint and prints only its id', async () => {
    const h = harness({ env });
    expect(await main({ argv: LOCAL_ARGV, deps: h.deps })).toBe(0);
    expect(h.stdout()).toBe(`${NEW_USER_ID}\n`);
    expect(h.stderr()).toBe('');
    expect(h.fetchCalls).toHaveLength(1);
    const [call] = h.fetchCalls;
    expect(call.url).toBe('http://127.0.0.1:54321/auth/v1/admin/users');
    expect(call.method).toBe('POST');
    expect(call.headers.apikey).toBe(SERVICE_KEY);
    expect(call.headers.Authorization).toBe(`Bearer ${SERVICE_KEY}`);
    expect(call.body).toEqual({ email: SMOKE_EMAIL, password: PASSWORD, email_confirm: true });
    // the password and the key never reach a process argument or an output stream
    expect(JSON.stringify(h.spawnCalls.map((c) => c.args))).not.toContain(PASSWORD);
    expect(h.allOutput()).not.toContain(PASSWORD);
    expect(h.allOutput()).not.toContain(SERVICE_KEY);
    expect(h.sqlCalls()).toHaveLength(0);
  });

  it('falls back to SECRET_KEY when SERVICE_ROLE_KEY is not printed', async () => {
    const h = harness({
      env,
      stack: stackText('http://127.0.0.1:54321', { SERVICE_ROLE_KEY: undefined }),
    });
    expect(await main({ argv: LOCAL_ARGV, deps: h.deps })).toBe(0);
    expect(h.fetchCalls[0].headers.apikey).toBe(SECRET_KEY);
    expect(h.allOutput()).not.toContain(SECRET_KEY);
  });

  it.each([
    'http://localhost:54321',
    'http://LOCALHOST:54321',
    'http://127.0.0.2:54321',
    'http://127.0.0.1.example.test:54321',
    'http://127.0.0.1@example.test:54321',
    'http://example.test:54321/127.0.0.1',
    'http://[::1]:54321',
    'http://0.0.0.0:54321',
    'https://stg-project.example.test',
    'not a url',
    '',
  ])('refuses the Auth URL %j before any request (exit 2)', async (api) => {
    const h = harness({ env, stack: stackText(api) });
    expect(await main({ argv: LOCAL_ARGV, deps: h.deps })).toBe(2);
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.stdout()).toBe('');
    expect(h.allOutput()).not.toContain(SERVICE_KEY);
    expect(h.allOutput()).not.toContain(PASSWORD);
  });

  it('fails (exit 1) when the stack is not running or prints no key', async () => {
    for (const stack of [
      null,
      stackText('http://127.0.0.1:54321', { SERVICE_ROLE_KEY: undefined, SECRET_KEY: undefined }),
    ]) {
      const h = harness({ env, stack });
      expect(await main({ argv: LOCAL_ARGV, deps: h.deps })).toBe(1);
      expect(h.fetchCalls).toHaveLength(0);
      expect(h.stdout()).toBe('');
    }
  });

  it('reports a rejected creation by status only', async () => {
    const h = harness({
      env,
      fetchHandlers: {
        '/auth/v1/admin/users': json(422, { msg: `exists ${SMOKE_EMAIL} ${PASSWORD}` }),
      },
    });
    expect(await main({ argv: LOCAL_ARGV, deps: h.deps })).toBe(1);
    expect(h.stderr()).toContain('422');
    expect(h.stdout()).toBe('');
    expect(h.allOutput()).not.toContain(SMOKE_EMAIL);
    expect(h.allOutput()).not.toContain(PASSWORD);
  });

  it('reports a network error without its message', async () => {
    const h = harness({
      env,
      fetchHandlers: {
        '/auth/v1/admin/users': () => {
          throw new Error(`connect failed for ${SERVICE_KEY}`);
        },
      },
    });
    expect(await main({ argv: LOCAL_ARGV, deps: h.deps })).toBe(1);
    expect(h.allOutput()).not.toContain(SERVICE_KEY);
    expect(h.stdout()).toBe('');
  });

  it('does not accept an id that is not a uuid', async () => {
    const h = harness({
      env,
      fetchHandlers: { '/auth/v1/admin/users': json(200, { id: 'surprise' }) },
    });
    expect(await main({ argv: LOCAL_ARGV, deps: h.deps })).toBe(1);
    expect(h.stdout()).toBe('');
    expect(h.allOutput()).not.toContain('surprise');
  });
});

describe('enrol-smoke-user: --env staging', () => {
  it('signs in, enrols and verifies TOTP, creates the org and the membership, prints only the secret', async () => {
    const h = harness({ env: stagingEnv() });
    expect(await main({ argv: STAGING_ARGV, deps: h.deps })).toBe(0);

    // the one output line is the TOTP secret; nothing else secret anywhere
    expect(h.stdout()).toBe(`${TOTP_SECRET}\n`);
    expect(h.stderr()).toBe('');
    for (const secret of [PASSWORD, ACCESS_TOKEN, PUBLISHABLE_KEY, STAGING_DB_URL, DB_PASSWORD]) {
      expect(h.allOutput()).not.toContain(secret);
    }

    const paths = h.fetchCalls.map((c) => `${c.method} ${c.pathname}${c.search}`);
    expect(paths).toEqual([
      'POST /auth/v1/token?grant_type=password',
      'POST /auth/v1/factors',
      `POST /auth/v1/factors/${FACTOR_ID}/challenge`,
      `POST /auth/v1/factors/${FACTOR_ID}/verify`,
    ]);
    const [token, factors, challenge, verify] = h.fetchCalls;
    expect(token.url.startsWith(`${STAGING_URL}/`)).toBe(true);
    expect(token.headers.apikey).toBe(PUBLISHABLE_KEY);
    expect(token.headers.Authorization).toBeUndefined();
    expect(token.body).toEqual({ email: SMOKE_EMAIL, password: PASSWORD });
    for (const call of [factors, challenge, verify]) {
      expect(call.headers.apikey).toBe(PUBLISHABLE_KEY);
      expect(call.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    }
    expect(factors.body).toEqual({ factor_type: 'totp' });
    expect(verify.body).toEqual({
      challenge_id: CHALLENGE_ID,
      code: await totp({ secret: TOTP_SECRET, timeMs: NOW }),
    });
    // no service-role key anywhere
    expect(JSON.stringify(h.fetchCalls.map((c) => c.headers))).not.toContain(SERVICE_KEY);
    // the local stack is never consulted in staging mode
    expect(h.spawnCalls.some((c) => c.cmd === 'pnpm' || c.cmd.startsWith('pnpm '))).toBe(false);
  });

  it('resolves both users by email, then calls create-org and add-member with the right ids', async () => {
    const h = harness({ env: stagingEnv() });
    await main({ argv: STAGING_ARGV, deps: h.deps });
    const calls = h.sqlCalls();
    expect(calls).toHaveLength(4);
    for (const c of calls) {
      expect(c.cmd).toBe('psql');
      expect(c.opts.env).toMatchObject({
        PGHOST: 'db.example.test',
        PGPASSWORD: DB_PASSWORD,
        PGDATABASE: 'postgres',
      });
      expect(JSON.stringify(c.args)).not.toContain(PASSWORD);
      expect(JSON.stringify(c.args)).not.toContain(DB_PASSWORD);
      expect(JSON.stringify(c.args)).not.toContain(PUBLISHABLE_KEY);
    }
    expect(varsOf(calls[0].args).p_email).toBe(SMOKE_EMAIL);
    expect(varsOf(calls[1].args).p_email).toBe(OWNER_EMAIL);
    expect(calls[0].opts.input).toContain('auth.users');
    expect(calls[0].opts.input).not.toContain(SMOKE_EMAIL);
    expect(varsOf(calls[2].args)).toMatchObject({
      p_name: 'Smoke staging',
      p_slug: 'smoke-staging',
      p_kind: 'customer',
      p_owner: OWNER_ID,
      p_display: 'Smoke owner',
      p_rid: REQUEST_ID,
    });
    expect(varsOf(calls[3].args)).toMatchObject({
      p_org: ORG_ID,
      p_user: SMOKE_ID,
      p_roles: '{recruiter}',
      p_rid: REQUEST_ID,
    });
    expect(calls[3].opts.input).toContain('private.add_member');
  });

  it('does not hand SMOKE_PASSWORD to the child processes', async () => {
    const h = harness({ env: stagingEnv() });
    await main({ argv: STAGING_ARGV, deps: h.deps });
    for (const c of h.sqlCalls()) expect(c.opts.env.SMOKE_PASSWORD).toBeUndefined();
  });

  it.each([
    'SUPABASE_STAGING_URL',
    'SUPABASE_STAGING_PUBLISHABLE_KEY',
    'TRACE_OPERATOR_DB_URL',
    'SMOKE_PASSWORD',
  ])('exits 2 naming %s when it is missing, before any call', async (name) => {
    const env = stagingEnv({ [name]: '' });
    const h = harness({ env });
    expect(await main({ argv: STAGING_ARGV, deps: h.deps })).toBe(2);
    expect(h.stderr()).toContain(name);
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.spawnCalls).toHaveLength(0);
    expect(h.stdout()).toBe('');
  });

  it('requires an https staging URL', async () => {
    const h = harness({
      env: stagingEnv({ SUPABASE_STAGING_URL: 'http://stg-project.example.test' }),
    });
    expect(await main({ argv: STAGING_ARGV, deps: h.deps })).toBe(2);
    expect(h.stderr()).toContain('SUPABASE_STAGING_URL');
    expect(h.fetchCalls).toHaveLength(0);
  });

  it('looks both users up before it signs in: a missing user changes nothing', async () => {
    const h = harness({
      env: stagingEnv(),
      sql: { lookupOwner: { status: 0, stdout: '', stderr: '' } },
    });
    expect(await main({ argv: STAGING_ARGV, deps: h.deps })).toBe(1);
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.stdout()).toBe('');
    expect(h.stderr()).not.toContain(OWNER_EMAIL);
  });

  it('prints nothing when sign-in fails, and no response text', async () => {
    const h = harness({
      env: stagingEnv(),
      fetchHandlers: { '/auth/v1/token': json(400, { msg: `bad ${PASSWORD}` }) },
    });
    expect(await main({ argv: STAGING_ARGV, deps: h.deps })).toBe(1);
    expect(h.stdout()).toBe('');
    expect(h.stderr()).toContain('400');
    expect(h.allOutput()).not.toContain(PASSWORD);
    expect(h.fetchCalls).toHaveLength(1);
    expect(h.sqlCalls()).toHaveLength(2); // only the two lookups
  });

  it('prints no secret when the TOTP verification fails', async () => {
    const h = harness({
      env: stagingEnv(),
      fetchHandlers: { [`/auth/v1/factors/${FACTOR_ID}/verify`]: json(400, { msg: 'invalid' }) },
    });
    expect(await main({ argv: STAGING_ARGV, deps: h.deps })).toBe(1);
    expect(h.stdout()).toBe('');
    expect(h.allOutput()).not.toContain(TOTP_SECRET);
    expect(h.sqlCalls()).toHaveLength(2);
  });

  it('prints the secret before the database steps, so a failure there cannot lose it', async () => {
    const h = harness({
      env: stagingEnv(),
      sql: { createOrg: { status: 1, stdout: '', stderr: `ERROR:  23505\n${STAGING_DB_URL}` } },
    });
    expect(await main({ argv: STAGING_ARGV, deps: h.deps })).toBe(1);
    expect(h.stdout()).toBe(`${TOTP_SECRET}\n`);
    expect(h.stderr()).toContain('SQLSTATE 23505');
    expect(h.stderr()).not.toContain(DB_PASSWORD);
    expect(h.stderr()).not.toContain(TOTP_SECRET);
    expect(h.sqlCalls()).toHaveLength(3); // add-member never ran
  });

  it('rejects a malformed factor response without printing it', async () => {
    const h = harness({
      env: stagingEnv(),
      fetchHandlers: {
        '/auth/v1/factors': json(200, { id: FACTOR_ID, totp: { secret: 'not base32 !' } }),
      },
    });
    expect(await main({ argv: STAGING_ARGV, deps: h.deps })).toBe(1);
    expect(h.stdout()).toBe('');
    expect(h.allOutput()).not.toContain('not base32');
  });
});
