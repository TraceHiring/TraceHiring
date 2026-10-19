// scripts/ops/staging-worker-secrets.mjs (specs/d1-demo-slice.md §3 login roles, §7.1 secrets and allow-list,
// ADR-031). Fakes only: no psql, no wrangler, no database, no network; every process call goes to a scripted
// spawnSync. Synthetic values only: the project refs are made up and every credential-shaped string is built at
// run time, so a leak is easy to spot and nothing secret-shaped is committed.
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { apiDbSsl } from '../../services/api/src/modules/candidate/api-db.ts';
import { jobsDbSsl } from '../../workers/jobs/src/queue/stage-db.ts';
import { ALLOW_LIST, WORKER_DIRS } from '../check-staging-secrets.mjs';
import { LOGIN_ROLES } from '../lib/e2e-local-secrets.mjs';
import {
  PLAN,
  generateValues,
  main,
  parseCli,
  parseOperatorUrl,
  scramSha256Verifier,
  secretValues,
  stagingLoginRolesSql,
  workerDbUrl,
} from '../ops/staging-worker-secrets.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REF = 'abcdefghijklmnopqrst';
const OTHER_REF = 'tsrqponmlkjihgfedcba';
const POOLER = 'aws-0-ap-south-1.pooler.supabase.com';
const PG = ['postgres', 'ql'].join('');
// The operator's password, made at run time.
const OP_PW = ['op', Math.abs(0x7ace).toString(36), 'x9'].join('-');

/** A postgres URL assembled at run time (no credential literal in the repository). */
function pgUrl({
  user,
  pw = OP_PW,
  host,
  port = '5432',
  db = 'postgres',
  query = 'sslmode=require',
}) {
  const u = new URL(`${PG}://${host}${port === '' ? '' : `:${port}`}/${db}`);
  u.username = user;
  if (pw !== '') u.password = pw;
  u.search = query;
  return u.toString();
}
const poolerUrl = (over = {}) => pgUrl({ user: `postgres.${REF}`, host: POOLER, ...over });
const directUrl = (over = {}) =>
  pgUrl({ user: 'postgres', host: `db.${REF}.supabase.co`, ...over });

const hexOf = (n, fill) => Buffer.alloc(n, fill).toString('hex');
// Fill bytes 0xa1.. so the hex has letters (the upper-case refusal must change something).
const passwordsOf = (seed = 0xa1) =>
  Object.fromEntries(LOGIN_ROLES.map(({ login }, i) => [login, hexOf(32, seed + i)]));
const saltsOf = () =>
  Object.fromEntries(LOGIN_ROLES.map(({ login }, i) => [login, Buffer.alloc(16, 0xa0 + i)]));

// --- arguments ------------------------------------------------------------------------------------

describe('parseCli', () => {
  it('accepts --env staging with --dry-run or --yes, or neither', () => {
    expect(parseCli(['--env', 'staging'])).toEqual({ ok: true, dryRun: false, yes: false });
    expect(parseCli(['--env=staging', '--dry-run'])).toEqual({
      ok: true,
      dryRun: true,
      yes: false,
    });
    expect(parseCli(['--yes', '--env', 'staging'])).toEqual({ ok: true, dryRun: false, yes: true });
  });

  it.each([
    ['no --env', []],
    ['--env production', ['--env', 'production']],
    ['--env prod', ['--env', 'prod']],
    ['--env local', ['--env', 'local']],
    ['--env dev', ['--env', 'dev']],
    ['--env STAGING', ['--env', 'STAGING']],
    ['an unknown flag', ['--env', 'staging', '--only', 'api']],
    ['a positional', ['--env', 'staging', 'extra']],
    ['--dry-run and --yes together', ['--env', 'staging', '--dry-run', '--yes']],
    ['--env without a value', ['--env']],
  ])('refuses %s', (_name, argv) => {
    const r = parseCli(argv);
    expect(r.ok).toBe(false);
    expect(typeof r.why).toBe('string');
  });

  it('never echoes an argument value', () => {
    const marker = `zz${OP_PW}`;
    const r = parseCli(['--env', marker]);
    expect(r.ok).toBe(false);
    expect(r.why).not.toContain(marker);
  });
});

// --- the operator URL -----------------------------------------------------------------------------

describe('parseOperatorUrl', () => {
  it('accepts the staging session pooler as postgres.<ref>, port 5432, TLS', () => {
    expect(parseOperatorUrl(poolerUrl(), REF)).toEqual({
      ok: true,
      kind: 'pooler',
      ref: REF,
      host: POOLER,
    });
  });

  it('accepts the direct host db.<ref>.supabase.co as postgres', () => {
    expect(parseOperatorUrl(directUrl(), REF)).toEqual({
      ok: true,
      kind: 'direct',
      ref: REF,
      host: `db.${REF}.supabase.co`,
    });
    expect(parseOperatorUrl(directUrl({ port: '' }), REF).ok).toBe(true);
  });

  it.each(['require', 'verify-ca', 'verify-full'])('accepts sslmode=%s', (mode) => {
    expect(parseOperatorUrl(poolerUrl({ query: `sslmode=${mode}` }), REF).ok).toBe(true);
  });

  it.each([
    ['a missing value', () => ''],
    ['spaces only', () => '   '],
    ['text that is not a URL', () => 'not a url'],
    ['http', () => `http://${POOLER}:5432/postgres`],
    ['https', () => `https://db.${REF}.supabase.co/`],
    ['loopback 127.0.0.1', () => pgUrl({ user: 'postgres', host: '127.0.0.1', port: '54322' })],
    ['loopback localhost', () => pgUrl({ user: 'postgres', host: 'localhost' })],
    ['loopback ::1', () => pgUrl({ user: 'postgres', host: '[::1]' })],
    ['loopback 127.0.0.2', () => pgUrl({ user: 'postgres', host: '127.0.0.2' })],
    ['a non-Supabase host', () => pgUrl({ user: 'postgres', host: 'db.example.test' })],
    ['a look-alike host', () => pgUrl({ user: `postgres.${REF}`, host: `${POOLER}.example.test` })],
    ['the transaction pooler port 6543', () => poolerUrl({ port: '6543' })],
    ['the pooler without an explicit port', () => poolerUrl({ port: '' })],
    ['the direct host on another port', () => directUrl({ port: '6543' })],
    ['no sslmode (TLS not stated)', () => poolerUrl({ query: '' })],
    ['sslmode=disable', () => poolerUrl({ query: 'sslmode=disable' })],
    ['sslmode=prefer', () => poolerUrl({ query: 'sslmode=prefer' })],
    ['sslmode=allow', () => poolerUrl({ query: 'sslmode=allow' })],
    ['sslmode twice', () => poolerUrl({ query: 'sslmode=require&sslmode=require' })],
    ['another query parameter', () => poolerUrl({ query: 'sslmode=require&options=x' })],
    ['a user other than postgres (pooler)', () => poolerUrl({ user: `api_login.${REF}` })],
    ['a pooler user without the ref', () => poolerUrl({ user: 'postgres' })],
    ['a user other than postgres (direct)', () => directUrl({ user: 'api_login' })],
    ['no password', () => poolerUrl({ pw: '' })],
    ['another database', () => poolerUrl({ db: 'template1' })],
    ['another project (pooler)', () => pgUrl({ user: `postgres.${OTHER_REF}`, host: POOLER })],
    ['another project (direct)', () => directUrl().replace(REF, OTHER_REF)],
    [
      'a production-looking host',
      () => pgUrl({ user: 'postgres.prodabcdefghijklmnop', host: POOLER }),
    ],
  ])('refuses %s', (_name, make) => {
    const raw = make();
    const r = parseOperatorUrl(raw, REF);
    expect(r.ok).toBe(false);
    expect(typeof r.why).toBe('string');
    expect(r.why).not.toContain(OP_PW);
    if (raw.trim() !== '') expect(r.why).not.toContain(raw);
  });

  it('sends a loopback URL to the local stack script', () => {
    const r = parseOperatorUrl(pgUrl({ user: 'postgres', host: '127.0.0.1', port: '54322' }), REF);
    expect(r.why).toMatch(/e2e-local/);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not 20 characters', 'abc'],
    ['upper case', REF.toUpperCase()],
  ])('refuses when the expected staging ref is %s', (_name, ref) => {
    expect(parseOperatorUrl(poolerUrl(), ref).ok).toBe(false);
  });
});

// --- SCRAM verifier and SQL -----------------------------------------------------------------------

describe('scramSha256Verifier', () => {
  it('matches the RFC 7677 SCRAM-SHA-256 example exchange', () => {
    // RFC 7677 §3: user "user", password "pencil", salt and nonces as below, 4096 iterations.
    const salt = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
    const v = scramSha256Verifier('pencil', salt);
    const m = /^SCRAM-SHA-256\$4096:([^$]+)\$([^:]+):(.+)$/.exec(v);
    expect(m).not.toBeNull();
    expect(m[1]).toBe('W22ZaJ0SNY7soEsUEjb6gQ==');
    const stored = Buffer.from(m[2], 'base64');
    const server = Buffer.from(m[3], 'base64');
    const cnonce = 'rOprNGfwEbeRWgbNEkqO';
    const snonce = `${cnonce}%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0`;
    const authMessage = [
      `n=user,r=${cnonce}`,
      `r=${snonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096`,
      `c=biws,r=${snonce}`,
    ].join(',');
    // The server's check: ClientKey = proof XOR HMAC(StoredKey, AuthMessage); H(ClientKey) == StoredKey.
    const proof = Buffer.from('dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=', 'base64');
    const clientSig = createHmac('sha256', stored).update(authMessage).digest();
    const clientKey = Buffer.from(proof.map((b, i) => b ^ clientSig[i]));
    expect(createHash('sha256').update(clientKey).digest().equals(stored)).toBe(true);
    const serverSig = createHmac('sha256', server).update(authMessage).digest('base64');
    expect(serverSig).toBe('6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
  });

  it('refuses a salt that is not 16 bytes', () => {
    expect(() => scramSha256Verifier('pencil', Buffer.alloc(8))).toThrow();
  });
});

describe('stagingLoginRolesSql', () => {
  const passwords = passwordsOf();
  const sql = stagingLoginRolesSql({ passwords, salts: saltsOf() });

  it('is one transaction', () => {
    expect(sql.startsWith('begin;\n')).toBe(true);
    expect(sql.trimEnd().endsWith('commit;')).toBe(true);
    expect(sql.match(/\bbegin;/g)).toHaveLength(1);
    expect(sql.match(/\bcommit;/g)).toHaveLength(1);
  });

  it('first refuses (TR001) when a trace_* role is missing, before any role is touched', () => {
    const guard = sql.indexOf("errcode = 'TR001'");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(sql.search(/create role|alter role|grant /));
    for (const { role } of LOGIN_ROLES) expect(sql).toContain(`'${role}'`);
  });

  it.each(LOGIN_ROLES.map((r) => [r.login, r.role]))(
    'creates %s if missing, else sets a new password, and grants only %s',
    (login, role) => {
      expect(sql).toContain(`where rolname = '${login}'`);
      expect(sql).toMatch(
        new RegExp(`alter role ${login} with login noinherit password 'SCRAM-SHA-256\\$4096:`),
      );
      expect(sql).toMatch(
        new RegExp(`create role ${login} with login noinherit password 'SCRAM-SHA-256\\$4096:`),
      );
      expect(sql).toContain(`grant ${role} to ${login} with inherit false, set true;`);
      expect(sql.match(new RegExp(`grant \\w+ to ${login}\\b`, 'g'))).toHaveLength(1);
    },
  );

  it('ends with a membership check (TR002) after the grants', () => {
    const check = sql.indexOf("errcode = 'TR002'");
    expect(check).toBeGreaterThan(sql.lastIndexOf('grant '));
    expect(sql).toContain('inherit_option');
    expect(sql).toContain('set_option');
  });

  it('never drops or revokes anything', () => {
    expect(sql).not.toMatch(/\bdrop\b/i);
    expect(sql).not.toMatch(/\brevoke\b/i);
  });

  it('holds only SCRAM verifiers, never a plain password', () => {
    for (const pw of Object.values(passwords)) expect(sql).not.toContain(pw);
    expect(sql.match(/'SCRAM-SHA-256\$4096:/g)).toHaveLength(8);
  });

  it('gives each login its own verifier', () => {
    const verifiers = new Set(sql.match(/SCRAM-SHA-256\$[^']+/g));
    expect(verifiers.size).toBe(4);
  });

  it.each([
    ['not hex', (pw) => `${pw.slice(0, -1)}g`],
    ['upper-case hex', (pw) => pw.toUpperCase()],
    ['too short', (pw) => pw.slice(0, 63)],
    ['a quote', (pw) => `${pw}'`],
    ['missing', () => undefined],
  ])('refuses a password that is %s, naming the login only', (_name, change) => {
    const bad = { ...passwords, jobs_quality_login: change(passwords.jobs_quality_login) };
    let error;
    try {
      stagingLoginRolesSql({ passwords: bad, salts: saltsOf() });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('jobs_quality_login');
    if (typeof bad.jobs_quality_login === 'string') {
      expect(error.message).not.toContain(bad.jobs_quality_login);
    }
  });

  it('refuses a missing salt', () => {
    const salts = saltsOf();
    delete salts.api_login;
    expect(() => stagingLoginRolesSql({ passwords, salts })).toThrow(/api_login/);
  });
});

// --- Worker URLs and the plan ---------------------------------------------------------------------

describe('workerDbUrl', () => {
  const pw = hexOf(32, 7);

  it('pooler: <login>.<ref> on the same pooler host, port 5432, sslmode=require', () => {
    const target = parseOperatorUrl(poolerUrl(), REF);
    const url = workerDbUrl(target, 'api_login', pw);
    expect(url).toBe(`${PG}://api_login.${REF}:${pw}@${POOLER}:5432/postgres?sslmode=require`);
  });

  it('direct: <login> on db.<ref>.supabase.co, port 5432, sslmode=require', () => {
    const target = parseOperatorUrl(directUrl(), REF);
    const url = workerDbUrl(target, 'jobs_mirror_login', pw);
    expect(url).toBe(
      `${PG}://jobs_mirror_login:${pw}@db.${REF}.supabase.co:5432/postgres?sslmode=require`,
    );
  });

  it('is accepted by the TLS rule of both Workers (apiDbSsl, jobsDbSsl) as require', () => {
    for (const raw of [poolerUrl(), directUrl()]) {
      const url = workerDbUrl(parseOperatorUrl(raw, REF), 'api_login', pw);
      expect(apiDbSsl(url)).toBe('require');
      expect(jobsDbSsl(url)).toBe('require');
    }
  });

  it('refuses an unknown login and a non-hex password, without the value', () => {
    const target = parseOperatorUrl(poolerUrl(), REF);
    expect(() => workerDbUrl(target, 'postgres', pw)).toThrow();
    let error;
    try {
      workerDbUrl(target, 'api_login', `${pw}@x`);
    } catch (e) {
      error = e;
    }
    expect(error.message).not.toContain(pw);
  });
});

describe('PLAN', () => {
  it('sets the three DB URLs and the HMAC key, and nothing else', () => {
    const names = PLAN.flatMap((w) => w.secrets.map((s) => s.name)).sort();
    expect(names).toEqual(
      [
        'API_DB_URL',
        'JOBS_INTEGRITY_DB_URL',
        'JOBS_MIRROR_DB_URL',
        'JOBS_QUALITY_DB_URL',
        'MEDIA_LINK_HMAC_KEY',
      ].sort(),
    );
    expect(names).not.toContain('CANDIDATE_TOKEN_PRIVATE_JWK');
  });

  it('puts each secret in the right Worker folder, all on the check-staging-secrets allow-list', () => {
    expect(PLAN.map((w) => [w.worker, w.dir])).toEqual([
      ['api', WORKER_DIRS.api],
      ['jobs', WORKER_DIRS.jobs],
    ]);
    for (const w of PLAN) {
      for (const s of w.secrets) expect(ALLOW_LIST[w.worker]).toContain(s.name);
    }
  });

  it('never touches the edge Worker', () => {
    expect(PLAN.some((w) => w.worker === 'edge' || w.dir === WORKER_DIRS.edge)).toBe(false);
  });

  it('maps each login to its own secret, once', () => {
    const logins = PLAN.flatMap((w) => w.secrets.map((s) => s.login)).filter(Boolean);
    expect(logins.sort()).toEqual(LOGIN_ROLES.map((r) => r.login).sort());
    const byLogin = Object.fromEntries(
      PLAN.flatMap((w) => w.secrets.filter((s) => s.login).map((s) => [s.login, s.name])),
    );
    expect(byLogin).toEqual({
      api_login: 'API_DB_URL',
      jobs_mirror_login: 'JOBS_MIRROR_DB_URL',
      jobs_quality_login: 'JOBS_QUALITY_DB_URL',
      jobs_integrity_login: 'JOBS_INTEGRITY_DB_URL',
    });
  });

  it('names the staging Worker of each folder as its wrangler.jsonc does', () => {
    for (const w of PLAN) {
      const text = readFileSync(join(ROOT, w.dir, 'wrangler.jsonc'), 'utf8');
      expect(text).toContain(`"name": "${w.workerName}"`);
      expect(w.workerName).toMatch(/-staging$/);
    }
  });
});

describe('generateValues and secretValues', () => {
  it('makes four 32-byte hex passwords, a 32-byte hex HMAC key and 16-byte salts', () => {
    let n = 0;
    const randomBytes = (size) => Buffer.alloc(size, ++n);
    const v = generateValues(randomBytes);
    expect(Object.keys(v.passwords).sort()).toEqual(LOGIN_ROLES.map((r) => r.login).sort());
    for (const pw of Object.values(v.passwords)) expect(pw).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(Object.values(v.passwords)).size).toBe(4);
    expect(v.hmacKey).toMatch(/^[0-9a-f]{64}$/);
    for (const s of Object.values(v.salts)) expect(s.length).toBe(16);
  });

  it('builds one value per planned secret; the HMAC key is what services/api imports (>= 32 chars)', () => {
    const v = generateValues((size) => Buffer.alloc(size, 3));
    const target = parseOperatorUrl(poolerUrl(), REF);
    const values = secretValues(target, v);
    expect(Object.keys(values).sort()).toEqual(
      PLAN.flatMap((w) => w.secrets.map((s) => s.name)).sort(),
    );
    expect(values.MEDIA_LINK_HMAC_KEY).toBe(v.hmacKey);
    expect(values.MEDIA_LINK_HMAC_KEY.length).toBeGreaterThanOrEqual(32);
    expect(values.API_DB_URL).toBe(workerDbUrl(target, 'api_login', v.passwords.api_login));
  });
});

// --- main, with an injected sink and spawn stub ---------------------------------------------------

/** A deps object whose spawnSync is scripted; every call and every printed line is recorded. */
function harness({
  platform = 'linux',
  env = { TRACE_OPERATOR_DB_URL: poolerUrl(), SUPABASE_STAGING_PROJECT_REF: REF },
  hasPsql = true,
  psql = { status: 0, stdout: '', stderr: '' },
  list = () => ({ status: 0, stdout: '[]', stderr: '' }),
  put = () => ({ status: 0, stdout: 'Success! Uploaded secret', stderr: '' }),
} = {}) {
  const calls = [];
  const out = [];
  const err = [];
  let n = 0;
  const generated = [];
  const deps = {
    env: { PATH: '/usr/bin', ...env },
    platform,
    repoRoot: ROOT,
    stdout: { write: (s) => out.push(String(s)) },
    stderr: { write: (s) => err.push(String(s)) },
    randomBytes: (size) => {
      n += 1;
      const b = Buffer.alloc(size, 0x10 + n);
      generated.push(b.toString('hex'));
      return b;
    },
    spawnSync(cmd, args, opts) {
      const line = [cmd, ...(args ?? [])].join(' ');
      calls.push({ cmd, args, opts, line });
      if (cmd === 'psql' && args[0] === '--version') {
        return hasPsql
          ? { status: 0, stdout: 'psql (PostgreSQL) 17.0\n' }
          : { error: new Error('x') };
      }
      if (cmd === 'psql') return psql;
      if (line.includes('secret list')) return list(line, opts);
      if (line.includes('secret put')) return put(line, opts);
      return { status: 127, stdout: '', stderr: '' };
    },
  };
  const psqlRuns = () => calls.filter((c) => c.cmd === 'psql' && c.args[0] !== '--version');
  const lists = () => calls.filter((c) => c.line.includes('secret list'));
  const puts = () => calls.filter((c) => c.line.includes('secret put'));
  const printed = () => out.join('') + err.join('');
  return { deps, calls, psqlRuns, lists, puts, generated, out, err, printed };
}

/** Every string that must never be printed, thrown or put on a command line. */
function secretsOf(h) {
  const values = [OP_PW, poolerUrl(), ...h.generated];
  for (const run of h.puts()) values.push(run.opts.input);
  for (const run of h.psqlRuns()) {
    values.push(...(run.opts.input.match(/SCRAM-SHA-256\$[^']+/g) ?? []));
  }
  return values.filter((v) => typeof v === 'string' && v.length >= 8);
}

describe('main', () => {
  it('with --yes: checks, rotates the passwords in one psql run, then puts five secrets', async () => {
    const h = harness();
    const code = await main({ argv: ['--env', 'staging', '--yes'], deps: h.deps });
    expect(code).toBe(0);
    // order: psql probe, both Workers listed, one psql transaction (runSql probes again), then the puts
    const kinds = h.calls.map((c) =>
      c.cmd === 'psql'
        ? c.args[0] === '--version'
          ? 'probe'
          : 'psql'
        : c.line.includes('list')
          ? 'list'
          : 'put',
    );
    expect(kinds).toEqual([
      'probe',
      'list',
      'list',
      'probe',
      'psql',
      'put',
      'put',
      'put',
      'put',
      'put',
    ]);
    expect(h.psqlRuns()).toHaveLength(1);
    const run = h.psqlRuns()[0];
    expect(run.args).toEqual(expect.arrayContaining(['-v', 'ON_ERROR_STOP=1', '-f', '-']));
    expect(run.opts.input).toContain('begin;');
    expect(run.opts.input).toContain('grant trace_api to api_login with inherit false, set true;');
    expect(run.opts.env.PGSSLMODE).toBe('require');
    expect(run.opts.env.PGUSER).toBe(`postgres.${REF}`);
    expect(run.opts.env.TRACE_OPERATOR_DB_URL).toBeUndefined();
  });

  it('puts each value on stdin only, in the right folder, with --env staging', async () => {
    const h = harness();
    await main({ argv: ['--env', 'staging', '--yes'], deps: h.deps });
    const puts = h.puts();
    const target = parseOperatorUrl(poolerUrl(), REF);
    const expected = PLAN.flatMap((w) => w.secrets.map((s) => [w.dir, s.name]));
    expect(puts.map((p) => [p.opts.cwd, p.args.at(-3)])).toEqual(
      expected.map(([dir, name]) => [join(ROOT, dir), name]),
    );
    for (const p of puts) {
      expect(p.cmd).toBe('pnpm');
      expect(p.args).toEqual(['exec', 'wrangler', 'secret', 'put', p.args[4], '--env', 'staging']);
      expect(p.opts.shell).toBe(false);
      expect(typeof p.opts.input).toBe('string');
      expect(p.opts.input.length).toBeGreaterThanOrEqual(32);
      expect(p.opts.env.TRACE_OPERATOR_DB_URL).toBeUndefined();
    }
    const api = puts.find((p) => p.args[4] === 'API_DB_URL');
    expect(api.opts.input.startsWith(`${PG}://api_login.${REF}:`)).toBe(true);
    expect(api.opts.input.endsWith(`@${target.host}:5432/postgres?sslmode=require`)).toBe(true);
    expect(apiDbSsl(api.opts.input)).toBe('require');
    for (const name of ['JOBS_MIRROR_DB_URL', 'JOBS_QUALITY_DB_URL', 'JOBS_INTEGRITY_DB_URL']) {
      expect(jobsDbSsl(puts.find((p) => p.args[4] === name).opts.input)).toBe('require');
    }
  });

  it('keeps wrangler from writing a debug log to disk (no WRANGLER_LOG, logs off, sanitised)', async () => {
    const h = harness({
      env: {
        TRACE_OPERATOR_DB_URL: poolerUrl(),
        SUPABASE_STAGING_PROJECT_REF: REF,
        WRANGLER_LOG: 'debug',
        WRANGLER_WRITE_LOGS: 'true',
        WRANGLER_LOG_SANITIZE: 'false',
      },
    });
    expect(await main({ argv: ['--env', 'staging', '--yes'], deps: h.deps })).toBe(0);
    const runs = [...h.lists(), ...h.puts()];
    expect(runs).toHaveLength(7);
    for (const r of runs) {
      expect(r.opts.env.WRANGLER_LOG).toBeUndefined();
      expect(r.opts.env.WRANGLER_WRITE_LOGS).toBe('false');
      expect(r.opts.env.WRANGLER_LOG_SANITIZE).toBe('true');
    }
  });

  it('the database receives the password the Worker URL carries (as its SCRAM verifier only)', async () => {
    const h = harness();
    await main({ argv: ['--env', 'staging', '--yes'], deps: h.deps });
    const sql = h.psqlRuns()[0].opts.input;
    const api = new URL(h.puts().find((p) => p.args[4] === 'API_DB_URL').opts.input);
    expect(sql).not.toContain(api.password);
    const m = new RegExp(`create role api_login with login noinherit password '(SCRAM[^']+)'`).exec(
      sql,
    );
    const salt = Buffer.from(/\$4096:([^$]+)\$/.exec(m[1])[1], 'base64');
    expect(scramSha256Verifier(api.password, salt)).toBe(m[1]);
  });

  it('on Windows runs pnpm through a constant shell command line, the value still on stdin', async () => {
    const h = harness({ platform: 'win32' });
    expect(await main({ argv: ['--env', 'staging', '--yes'], deps: h.deps })).toBe(0);
    for (const p of [...h.lists(), ...h.puts()]) {
      expect(p.opts.shell).toBe(true);
      expect(p.args).toEqual([]);
      expect(p.cmd).toMatch(
        /^pnpm exec wrangler secret (list|put [A-Z_]+) --env staging( --format json)?$/,
      );
    }
    for (const p of h.puts()) expect(p.opts.input.length).toBeGreaterThanOrEqual(32);
  });

  it('never prints, throws or puts on a command line any generated or operator value', async () => {
    const h = harness({
      put: (line) =>
        line.includes('JOBS_QUALITY_DB_URL')
          ? { status: 1, stdout: `echo ${OP_PW}`, stderr: `boom ${OP_PW}` }
          : { status: 0, stdout: '', stderr: '' },
    });
    await main({ argv: ['--env', 'staging', '--yes'], deps: h.deps });
    const leaks = secretsOf(h);
    expect(leaks.length).toBeGreaterThan(6);
    for (const v of leaks) {
      expect(h.printed()).not.toContain(v);
      for (const c of h.calls) expect(c.line).not.toContain(v);
    }
  });

  it('--dry-run prints only the plan: roles, secrets and Workers; no DB write, no wrangler call', async () => {
    const h = harness();
    expect(await main({ argv: ['--env', 'staging', '--dry-run'], deps: h.deps })).toBe(0);
    expect(h.psqlRuns()).toHaveLength(0);
    expect(h.lists()).toHaveLength(0);
    expect(h.puts()).toHaveLength(0);
    const text = h.printed();
    for (const { login, role } of LOGIN_ROLES) {
      expect(text).toContain(login);
      expect(text).toContain(role);
    }
    for (const w of PLAN) {
      expect(text).toContain(w.workerName);
      for (const s of w.secrets) expect(text).toContain(s.name);
    }
    expect(text).toMatch(/dry run/i);
    expect(text).not.toContain(OP_PW);
    expect(text).not.toContain(REF);
    for (const g of h.generated) expect(text).not.toContain(g);
  });

  it('without --yes prints the plan, changes nothing and asks for --yes (exit 2)', async () => {
    const h = harness();
    expect(await main({ argv: ['--env', 'staging'], deps: h.deps })).toBe(2);
    expect(h.psqlRuns()).toHaveLength(0);
    expect(h.lists()).toHaveLength(0);
    expect(h.puts()).toHaveLength(0);
    expect(h.printed()).toMatch(/re-run with --yes/);
  });

  it.each([
    ['--env production', ['--env', 'production', '--yes']],
    ['no --env', ['--yes']],
  ])('refuses %s before anything runs (exit 2)', async (_name, argv) => {
    const h = harness();
    expect(await main({ argv, deps: h.deps })).toBe(2);
    expect(h.calls).toHaveLength(0);
  });

  it.each([
    [
      'TRACE_OPERATOR_DB_URL is missing',
      { SUPABASE_STAGING_PROJECT_REF: REF },
      'TRACE_OPERATOR_DB_URL',
    ],
    [
      'SUPABASE_STAGING_PROJECT_REF is missing',
      { TRACE_OPERATOR_DB_URL: poolerUrl() },
      'SUPABASE_STAGING_PROJECT_REF',
    ],
    [
      'the URL is loopback',
      {
        TRACE_OPERATOR_DB_URL: pgUrl({ user: 'postgres', host: '127.0.0.1', port: '54322' }),
        SUPABASE_STAGING_PROJECT_REF: REF,
      },
      'e2e-local',
    ],
    [
      'the URL is another project',
      { TRACE_OPERATOR_DB_URL: poolerUrl(), SUPABASE_STAGING_PROJECT_REF: OTHER_REF },
      'SUPABASE_STAGING_PROJECT_REF',
    ],
  ])('refuses when %s (exit 2, nothing runs, the variable named)', async (_n, env, named) => {
    const h = harness({ env });
    expect(await main({ argv: ['--env', 'staging', '--dry-run'], deps: h.deps })).toBe(2);
    expect(h.psqlRuns()).toHaveLength(0);
    expect(h.puts()).toHaveLength(0);
    expect(h.err.join('')).toContain(named);
    expect(h.printed()).not.toContain(OP_PW);
  });

  it('refuses without psql (exit 2), before any wrangler call', async () => {
    const h = harness({ hasPsql: false });
    expect(await main({ argv: ['--env', 'staging', '--yes'], deps: h.deps })).toBe(2);
    expect(h.lists()).toHaveLength(0);
    expect(h.err.join('')).toMatch(/psql/);
  });

  it('stops before the database when a Worker does not exist yet (wrangler would create a draft)', async () => {
    const h = harness({
      list: (line, opts) =>
        opts.cwd.endsWith(join('workers', 'jobs'))
          ? {
              status: 1,
              stdout: '',
              stderr: `X [ERROR] Worker "trace-jobs-staging" (env: staging) not found. ${OP_PW}`,
            }
          : { status: 0, stdout: '[]', stderr: '' },
    });
    expect(await main({ argv: ['--env', 'staging', '--yes'], deps: h.deps })).toBe(2);
    expect(h.psqlRuns()).toHaveLength(0);
    expect(h.puts()).toHaveLength(0);
    const text = h.err.join('');
    expect(text).toContain('trace-jobs-staging');
    expect(text).toMatch(/first staging deploy/);
    expect(text).not.toContain(OP_PW);
  });

  it('stops before the database when wrangler cannot list secrets (not logged in), output suppressed', async () => {
    const marker = 'wrangler-said-something';
    const h = harness({ list: () => ({ status: 1, stdout: marker, stderr: marker }) });
    expect(await main({ argv: ['--env', 'staging', '--yes'], deps: h.deps })).toBe(2);
    expect(h.psqlRuns()).toHaveLength(0);
    expect(h.printed()).not.toContain(marker);
    expect(h.err.join('')).toMatch(/wrangler whoami|wrangler login/);
  });

  it('names the missing-migrations case (TR001) and sets no secret', async () => {
    const h = harness({
      psql: { status: 3, stdout: '', stderr: `psql:<stdin>:9: ERROR:  TR001 ${OP_PW}` },
    });
    expect(await main({ argv: ['--env', 'staging', '--yes'], deps: h.deps })).toBe(1);
    expect(h.puts()).toHaveLength(0);
    expect(h.err.join('')).toMatch(/migrations/);
    expect(h.printed()).not.toContain(OP_PW);
  });

  it('names the unexpected-membership case (TR002) and sets no secret', async () => {
    const h = harness({ psql: { status: 3, stdout: '', stderr: 'ERROR:  TR002' } });
    expect(await main({ argv: ['--env', 'staging', '--yes'], deps: h.deps })).toBe(1);
    expect(h.puts()).toHaveLength(0);
    expect(h.err.join('')).toMatch(/membership|attribute/);
  });

  it('a database failure reports only the SQLSTATE and says nothing was changed', async () => {
    const h = harness({ psql: { status: 2, stdout: '', stderr: `ERROR:  42501 ${OP_PW}` } });
    expect(await main({ argv: ['--env', 'staging', '--yes'], deps: h.deps })).toBe(1);
    expect(h.puts()).toHaveLength(0);
    const text = h.err.join('');
    expect(text).toContain('42501');
    expect(text).toMatch(/rolled back|nothing was changed/i);
    expect(text).not.toContain(OP_PW);
  });

  it('a failed secret put stops, names what is stale and asks for a re-run (exit 1)', async () => {
    const h = harness({
      put: (line) =>
        line.includes('JOBS_MIRROR_DB_URL')
          ? { status: 1, stdout: '', stderr: 'latest version not deployed' }
          : { status: 0, stdout: '', stderr: '' },
    });
    expect(await main({ argv: ['--env', 'staging', '--yes'], deps: h.deps })).toBe(1);
    expect(h.puts().map((p) => p.args[4])).toEqual([
      'API_DB_URL',
      'MEDIA_LINK_HMAC_KEY',
      'JOBS_MIRROR_DB_URL',
    ]);
    const text = h.err.join('');
    for (const name of ['JOBS_MIRROR_DB_URL', 'JOBS_QUALITY_DB_URL', 'JOBS_INTEGRITY_DB_URL']) {
      expect(text).toContain(name);
    }
    expect(text).toMatch(/re-run/);
    expect(text).not.toContain('latest version not deployed');
  });

  it('a put that throws is a failure too, with no value in the message', async () => {
    const h = harness({
      put: () => {
        throw new Error(`spawn failed ${OP_PW}`);
      },
    });
    expect(await main({ argv: ['--env', 'staging', '--yes'], deps: h.deps })).toBe(1);
    expect(h.printed()).not.toContain(OP_PW);
  });

  it('prints a success summary with names only', async () => {
    const h = harness();
    await main({ argv: ['--env', 'staging', '--yes'], deps: h.deps });
    const text = h.out.join('');
    for (const w of PLAN) for (const s of w.secrets) expect(text).toContain(s.name);
    expect(text).toMatch(/check-staging-secrets/);
  });
});
