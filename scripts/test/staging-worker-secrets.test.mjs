// scripts/ops/staging-worker-secrets.mjs (specs/d1-demo-slice.md §3 login roles, §7.1 secrets and allow-list,
// ADR-031 amendment 1: on staging the Workers reach Postgres only through Hyperdrive). Fakes only: no psql, no
// wrangler, no database, no network; every process call goes to a scripted spawnSync and every Cloudflare call to a
// scripted fetch. Synthetic values only: the project refs, config ids, CA id and token are made up and every
// credential-shaped string is built at run time, so a leak is easy to spot and nothing secret-shaped is committed.
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALLOW_LIST, WORKER_DIRS } from '../check-staging-secrets.mjs';
import { LOGIN_ROLES } from '../lib/e2e-local-secrets.mjs';
import {
  CLOUDFLARE_ACCOUNT_ID,
  HYPERDRIVE_ID_RE,
  HYPERDRIVE_PLAN,
  ORIGIN_CONNECTION_LIMIT,
  hyperdriveProblems,
} from '../lib/hyperdrive.mjs';
import {
  HYPERDRIVE_CONFIGS_URL,
  LOGIN_TIMEOUTS,
  PLAN,
  POOLER_SETTLE_MS,
  RETIRED_SECRETS,
  STAGING_PROJECT_REF,
  generateValues,
  hyperdriveBody,
  main,
  parseAuthToken,
  parseCli,
  parseOperatorUrl,
  scramSha256Verifier,
  stagingLoginRolesSql,
  wranglerSnippets,
} from '../ops/staging-worker-secrets.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REF = 'abcdefghijklmnopqrst';
const OTHER_REF = 'tsrqponmlkjihgfedcba';
const POOLER = 'aws-0-ap-south-1.pooler.supabase.com';
const PG = ['postgres', 'ql'].join('');
// The operator's password, made at run time.
const OP_PW = ['op', Math.abs(0x7ace).toString(36), 'x9'].join('-');
const hexOf = (n, fill) => Buffer.alloc(n, fill).toString('hex');
// A CA certificate id as `wrangler cert upload certificate-authority` prints it (synthetic, built at run time).
const CA_ID = [hexOf(4, 0x1c), hexOf(2, 0x2d), hexOf(2, 0x4e), hexOf(2, 0x8f), hexOf(6, 0x3a)].join(
  '-',
);
// The wrangler OAuth token, made at run time.
const TOKEN = ['cf', hexOf(20, 0x5e)].join('-');
/** A Hyperdrive config id as Cloudflare issues it (32 lower-case hex). */
const idOf = (i) => hexOf(16, 0xc1 + i);

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

// Fill bytes 0xa1.. so the hex has letters (the upper-case refusal must change something).
const passwordsOf = (seed = 0xa1) =>
  Object.fromEntries(LOGIN_ROLES.map(({ login }, i) => [login, hexOf(32, seed + i)]));
const saltsOf = () =>
  Object.fromEntries(LOGIN_ROLES.map(({ login }, i) => [login, Buffer.alloc(16, 0xa0 + i)]));

// --- arguments ------------------------------------------------------------------------------------

const CA = ['--ca-certificate-id', CA_ID];

describe('parseCli', () => {
  it('accepts --env staging with --dry-run or --yes and the CA id; sslmode defaults to verify-full', () => {
    expect(parseCli(['--env', 'staging', '--dry-run', ...CA])).toEqual({
      ok: true,
      dryRun: true,
      yes: false,
      caId: CA_ID,
      sslmode: 'verify-full',
    });
    expect(parseCli(['--yes', '--env=staging', `--ca-certificate-id=${CA_ID}`])).toEqual({
      ok: true,
      dryRun: false,
      yes: true,
      caId: CA_ID,
      sslmode: 'verify-full',
    });
  });

  it('takes --sslmode verify-ca or verify-full', () => {
    expect(parseCli(['--env', 'staging', '--yes', ...CA, '--sslmode', 'verify-ca']).sslmode).toBe(
      'verify-ca',
    );
    expect(parseCli(['--env', 'staging', '--yes', ...CA, '--sslmode=verify-full']).sslmode).toBe(
      'verify-full',
    );
  });

  it('lower-cases the CA id (Cloudflare prints it lower case)', () => {
    expect(
      parseCli(['--env', 'staging', '--yes', '--ca-certificate-id', CA_ID.toUpperCase()]).caId,
    ).toBe(CA_ID);
  });

  it('without --dry-run or --yes (plan only) the CA id may be left out', () => {
    expect(parseCli(['--env', 'staging'])).toEqual({
      ok: true,
      dryRun: false,
      yes: false,
      caId: null,
      sslmode: 'verify-full',
    });
  });

  it.each([
    ['no --env', [...CA]],
    ['--env production', ['--env', 'production', ...CA]],
    ['--env prod', ['--env', 'prod', ...CA]],
    ['--env local', ['--env', 'local', ...CA]],
    ['--env dev', ['--env', 'dev', ...CA]],
    ['--env STAGING', ['--env', 'STAGING', ...CA]],
    ['an unknown flag', ['--env', 'staging', ...CA, '--only', 'api']],
    ['a positional', ['--env', 'staging', ...CA, 'extra']],
    ['--dry-run and --yes together', ['--env', 'staging', '--dry-run', '--yes', ...CA]],
    ['--env without a value', ['--env']],
    ['--yes without --ca-certificate-id', ['--env', 'staging', '--yes']],
    ['--dry-run without --ca-certificate-id', ['--env', 'staging', '--dry-run']],
    ['a CA id that is not a UUID', ['--env', 'staging', '--yes', '--ca-certificate-id', 'ca-1']],
    ['a CA id with extra text', ['--env', 'staging', '--yes', '--ca-certificate-id', `${CA_ID}0`]],
    ['a CA id without a value', ['--env', 'staging', '--yes', '--ca-certificate-id']],
    ['an empty CA id', ['--env', 'staging', '--yes', '--ca-certificate-id=']],
    ['a malformed CA id without --yes', ['--env', 'staging', '--ca-certificate-id', 'x']],
    [
      '--sslmode require (no verification)',
      ['--env', 'staging', '--yes', ...CA, '--sslmode', 'require'],
    ],
    ['--sslmode disable', ['--env', 'staging', '--yes', ...CA, '--sslmode', 'disable']],
    ['--sslmode prefer', ['--env', 'staging', '--yes', ...CA, '--sslmode', 'prefer']],
    ['--sslmode VERIFY-FULL', ['--env', 'staging', '--yes', ...CA, '--sslmode', 'VERIFY-FULL']],
    ['--sslmode without a value', ['--env', 'staging', '--yes', ...CA, '--sslmode']],
  ])('refuses %s', (_name, argv) => {
    const r = parseCli(argv);
    expect(r.ok).toBe(false);
    expect(typeof r.why).toBe('string');
  });

  it('names the allowed sslmodes and says require is never allowed', () => {
    const r = parseCli(['--env', 'staging', '--yes', ...CA, '--sslmode', 'require']);
    expect(r.why).toMatch(/verify-full/);
    expect(r.why).toMatch(/verify-ca/);
  });

  it('never echoes an argument value', () => {
    const marker = `zz${OP_PW}`;
    for (const argv of [
      ['--env', marker],
      ['--env', 'staging', '--yes', '--ca-certificate-id', marker],
      ['--env', 'staging', '--yes', ...CA, '--sslmode', marker],
    ]) {
      const r = parseCli(argv);
      expect(r.ok).toBe(false);
      expect(r.why).not.toContain(marker);
    }
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

  // Database review Minor 1: a stuck transaction must not hold one of a login's 5 Hyperdrive origin slots for long.
  // SET LOCAL ROLE does not apply the target role's settings, so they sit on the login itself.
  it.each(LOGIN_ROLES.map((r) => [r.login]))(
    'gives %s its server-side timeouts, after its grant',
    (login) => {
      for (const [name, value] of Object.entries(LOGIN_TIMEOUTS)) {
        const line = `alter role ${login} set ${name} = '${value}';`;
        expect(sql).toContain(line);
        expect(sql.indexOf(line)).toBeGreaterThan(sql.indexOf(`to ${login} with inherit false`));
      }
    },
  );

  it('pins the timeout values', () => {
    expect(LOGIN_TIMEOUTS).toEqual({
      statement_timeout: '15s',
      lock_timeout: '10s',
      idle_in_transaction_session_timeout: '30s',
    });
  });

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

// --- Hyperdrive bodies, the token, the snippets and the plan ---------------------------------------

describe('hyperdriveBody', () => {
  const pw = hexOf(32, 0xb7);
  const [api] = HYPERDRIVE_PLAN;
  const opts = { caId: CA_ID, sslmode: 'verify-full' };

  it('pooler: the exact create/update body, user <login>.<ref>, caching off, the CA verified, limit 5', () => {
    const target = parseOperatorUrl(poolerUrl(), REF);
    expect(hyperdriveBody(target, api, pw, opts)).toEqual({
      name: 'trace-staging-api-login',
      origin: {
        scheme: 'postgresql',
        host: POOLER,
        port: 5432,
        database: 'postgres',
        user: `api_login.${REF}`,
        password: pw,
      },
      caching: { disabled: true },
      mtls: { ca_certificate_id: CA_ID, sslmode: 'verify-full' },
      origin_connection_limit: 5,
    });
  });

  it('direct: user <login> on db.<ref>.supabase.co; --sslmode verify-ca passes through', () => {
    const target = parseOperatorUrl(directUrl(), REF);
    const jobs = HYPERDRIVE_PLAN.find((p) => p.login === 'jobs_mirror_login');
    expect(hyperdriveBody(target, jobs, pw, { caId: CA_ID, sslmode: 'verify-ca' })).toEqual({
      name: 'trace-staging-jobs-mirror-login',
      origin: {
        scheme: 'postgresql',
        host: `db.${REF}.supabase.co`,
        port: 5432,
        database: 'postgres',
        user: 'jobs_mirror_login',
        password: pw,
      },
      caching: { disabled: true },
      mtls: { ca_certificate_id: CA_ID, sslmode: 'verify-ca' },
      origin_connection_limit: 5,
    });
  });

  it('defaults the sslmode to verify-full', () => {
    const target = parseOperatorUrl(poolerUrl(), REF);
    expect(hyperdriveBody(target, api, pw, { caId: CA_ID }).mtls.sslmode).toBe('verify-full');
  });

  it.each(HYPERDRIVE_PLAN.map((p) => [p.config, p]))(
    '%s carries its own login and name',
    (_n, entry) => {
      const target = parseOperatorUrl(poolerUrl(), REF);
      const body = hyperdriveBody(target, entry, pw, opts);
      expect(body.name).toBe(entry.config);
      expect(body.origin.user).toBe(`${entry.login}.${REF}`);
    },
  );

  it('keeps caching off with no other cache key (cached reads would cross role and org scoping)', () => {
    const body = hyperdriveBody(parseOperatorUrl(poolerUrl(), REF), api, pw, opts);
    expect(body.caching).toEqual({ disabled: true });
    expect(Object.keys(body).sort()).toEqual(
      ['caching', 'mtls', 'name', 'origin', 'origin_connection_limit'].sort(),
    );
    expect(body.origin_connection_limit).toBe(ORIGIN_CONNECTION_LIMIT);
  });

  it.each([
    ['an entry that is not in the plan', { ...api, config: 'trace-staging-other' }, pw, opts],
    ['a password that is not hex', api, `${pw.slice(0, -1)}g`, opts],
    ['a short password', api, pw.slice(0, 40), opts],
    ['a missing password', api, undefined, opts],
    ['a CA id that is not a UUID', api, pw, { caId: 'ca-1', sslmode: 'verify-full' }],
    ['a missing CA id', api, pw, { sslmode: 'verify-full' }],
    ['sslmode require', api, pw, { caId: CA_ID, sslmode: 'require' }],
  ])('refuses %s, without the value in the message', (_n, entry, password, o) => {
    let error;
    try {
      hyperdriveBody(parseOperatorUrl(poolerUrl(), REF), entry, password, o);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain(pw);
  });
});

describe('parseAuthToken', () => {
  const json = (o) => `${JSON.stringify(o, null, 2)}\n`;

  it('accepts a wrangler OAuth login', () => {
    expect(parseAuthToken(json({ type: 'oauth', token: TOKEN }))).toEqual({
      ok: true,
      type: 'oauth',
      token: TOKEN,
    });
  });

  it('accepts CLOUDFLARE_API_TOKEN (type api_token)', () => {
    expect(parseAuthToken(json({ type: 'api_token', token: TOKEN }))).toEqual({
      ok: true,
      type: 'api_token',
      token: TOKEN,
    });
  });

  it('reads the JSON object even with a line of wrangler noise around it', () => {
    expect(parseAuthToken(`note\n${json({ type: 'oauth', token: TOKEN })}`).token).toBe(TOKEN);
  });

  it.each([
    ['a global API key (api_key)', json({ type: 'api_key', key: TOKEN, email: 'x@example.test' })],
    ['an empty token', json({ type: 'oauth', token: '' })],
    ['a token with a space', json({ type: 'oauth', token: `${TOKEN} x` })],
    ['a token with a newline', json({ type: 'oauth', token: `${TOKEN}\nx` })],
    ['a token that is not a string', json({ type: 'oauth', token: 7 })],
    ['an unknown type', json({ type: 'other', token: TOKEN })],
    ['no type', json({ token: TOKEN })],
    ['not JSON', `Not logged in ${TOKEN}`],
    ['empty output', ''],
    ['undefined', undefined],
    ['a JSON list', '[]'],
    ['null', 'null'],
  ])('refuses %s, without the token', (_n, stdout) => {
    const r = parseAuthToken(stdout);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});

describe('wranglerSnippets', () => {
  const ids = Object.fromEntries(HYPERDRIVE_PLAN.map((p, i) => [p.binding, idOf(i)]));

  it('gives one paste-ready hyperdrive line per Worker, in plan order', () => {
    expect(wranglerSnippets(ids)).toEqual([
      {
        worker: 'api',
        file: 'services/api/wrangler.jsonc',
        line: `"hyperdrive": [{ "binding": "API_DB", "id": "${ids.API_DB}" }]`,
      },
      {
        worker: 'jobs',
        file: 'workers/jobs/wrangler.jsonc',
        line: `"hyperdrive": [{ "binding": "JOBS_MIRROR_DB", "id": "${ids.JOBS_MIRROR_DB}" }, { "binding": "JOBS_QUALITY_DB", "id": "${ids.JOBS_QUALITY_DB}" }, { "binding": "JOBS_INTEGRITY_DB", "id": "${ids.JOBS_INTEGRITY_DB}" }]`,
      },
    ]);
  });

  it('is what the deploy check (hyperdriveProblems, staging required) accepts', () => {
    for (const { worker, line } of wranglerSnippets(ids)) {
      const staging = JSON.parse(`{${line}}`);
      expect(hyperdriveProblems(worker, { env: { staging } }, { requireStaging: true })).toEqual(
        [],
      );
    }
  });

  it.each([
    ['a missing id', { ...ids, JOBS_QUALITY_DB: undefined }],
    ['an upper-case id', { ...ids, API_DB: ids.API_DB.toUpperCase() }],
    ['a short id', { ...ids, API_DB: ids.API_DB.slice(1) }],
  ])('refuses %s', (_n, bad) => {
    expect(() => wranglerSnippets(bad)).toThrow();
  });
});

describe('PLAN, RETIRED_SECRETS and the Hyperdrive plan', () => {
  it('sets one Worker secret, MEDIA_LINK_HMAC_KEY on api, and no database URL', () => {
    expect(PLAN.flatMap((w) => w.secrets.map((s) => [w.worker, s.name, s.login]))).toEqual([
      ['api', 'MEDIA_LINK_HMAC_KEY', null],
    ]);
  });

  it('covers both Workers in their folders, every planned secret on the allow-list', () => {
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
    expect(HYPERDRIVE_PLAN.some((p) => p.worker === 'edge')).toBe(false);
  });

  it('names the staging Worker of each folder as its wrangler.jsonc does', () => {
    for (const w of PLAN) {
      const text = readFileSync(join(ROOT, w.dir, 'wrangler.jsonc'), 'utf8');
      expect(text).toContain(`"name": "${w.workerName}"`);
      expect(w.workerName).toMatch(/-staging$/);
    }
  });

  it('retires exactly the four database URL secrets, none of them on the allow-list', () => {
    expect(RETIRED_SECRETS).toEqual({
      api: ['API_DB_URL'],
      jobs: ['JOBS_MIRROR_DB_URL', 'JOBS_QUALITY_DB_URL', 'JOBS_INTEGRITY_DB_URL'],
    });
    expect(Object.isFrozen(RETIRED_SECRETS)).toBe(true);
    for (const [worker, names] of Object.entries(RETIRED_SECRETS)) {
      expect(Object.isFrozen(names)).toBe(true);
      for (const name of names) expect(ALLOW_LIST[worker]).not.toContain(name);
    }
  });

  it('gives each login exactly one Hyperdrive config on a planned Worker', () => {
    expect(HYPERDRIVE_PLAN.map((p) => p.login).sort()).toEqual(
      LOGIN_ROLES.map((r) => r.login).sort(),
    );
    const workers = new Set(PLAN.map((w) => w.worker));
    for (const p of HYPERDRIVE_PLAN) expect(workers.has(p.worker)).toBe(true);
  });

  it('talks to the pinned staging account only', () => {
    expect(HYPERDRIVE_CONFIGS_URL).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/hyperdrive/configs`,
    );
  });
});

describe('generateValues', () => {
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
});

// --- main, with an injected sink, spawn stub and fetch stub -----------------------------------------

// main checks against the pinned staging ref (SEC-W3-4); the ref is public (docs/infra/environments.md).
const SREF = STAGING_PROJECT_REF;
const stagingPooler = (over = {}) => poolerUrl({ user: `postgres.${SREF}`, ...over });
const BASE = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/hyperdrive/configs`;
const YES = ['--env', 'staging', '--yes', ...CA];
const DRY = ['--env', 'staging', '--dry-run', ...CA];
const tokenJson = (o) => ({ status: 0, stdout: `${JSON.stringify(o, null, 2)}\n`, stderr: '' });

/** A Cloudflare v4 envelope. */
const cfOk = (result, extra = {}) => ({
  status: 200,
  json: { success: true, errors: [], messages: [], result, ...extra },
});
const listOf = (configs) =>
  cfOk(configs, {
    result_info: {
      page: 1,
      per_page: 20,
      count: configs.length,
      total_count: configs.length,
      total_pages: 1,
    },
  });
const cfFail = (status, codes, message) => ({
  status,
  json: {
    success: false,
    errors: codes.map((code) => ({ code, message })),
    messages: [],
    result: null,
  },
});

/**
 * A deps object whose spawnSync and fetch are scripted; every call, every request and every printed line is
 * recorded. `existing` is the account's Hyperdrive configs; `cf(method, url, body)` may answer a request instead
 * (return undefined for the default: list `existing`, create with idOf(plan index), update echoes the id).
 */
function harness({
  platform = 'linux',
  env = { TRACE_OPERATOR_DB_URL: stagingPooler(), SUPABASE_STAGING_PROJECT_REF: SREF },
  hasPsql = true,
  psql = { status: 0, stdout: '', stderr: '' },
  list = () => ({ status: 0, stdout: '[]', stderr: '' }),
  put = () => ({ status: 0, stdout: 'Success! Uploaded secret', stderr: '' }),
  del = () => ({ status: 0, stdout: 'Success! Deleted secret', stderr: '' }),
  token = () => tokenJson({ type: 'oauth', token: TOKEN }),
  existing = [],
  cf,
} = {}) {
  const calls = [];
  const fetches = [];
  const events = [];
  const out = [];
  const err = [];
  let n = 0;
  const generated = [];
  const sleeps = [];
  const deps = {
    // Instant and recorded: the pooler-cache waits (step 4) never slow a test.
    sleep: async (ms) => {
      sleeps.push(ms);
    },
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
        events.push('probe');
        return hasPsql
          ? { status: 0, stdout: 'psql (PostgreSQL) 17.0\n' }
          : { error: new Error('x') };
      }
      if (cmd === 'psql') {
        events.push('psql');
        return psql;
      }
      for (const [kind, fn] of [
        ['auth token', token],
        ['secret list', list],
        ['secret put', put],
        ['secret delete', del],
      ]) {
        if (line.includes(kind)) {
          events.push(kind.split(' ')[1]);
          return fn(line, opts);
        }
      }
      events.push('other');
      return { status: 127, stdout: '', stderr: '' };
    },
    async fetch(url, init = {}) {
      const method = init.method ?? 'GET';
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      fetches.push({ url: String(url), init, method, body });
      events.push(method);
      let r = cf ? cf(method, String(url), body) : undefined;
      if (r === undefined) {
        if (method === 'GET') r = listOf(existing);
        else if (method === 'POST') {
          r = cfOk({ id: idOf(HYPERDRIVE_PLAN.findIndex((p) => p.config === body.name)) });
        } else r = cfOk({ id: String(url).split('/').at(-1), name: body.name });
      }
      if (r instanceof Error) throw r;
      const text = typeof r.raw === 'string' ? r.raw : JSON.stringify(r.json);
      return {
        status: r.status,
        ok: r.status >= 200 && r.status < 300,
        text: async () => text,
        json: async () => JSON.parse(text),
      };
    },
  };
  const psqlRuns = () => calls.filter((c) => c.cmd === 'psql' && c.args[0] !== '--version');
  const wranglers = () => calls.filter((c) => c.line.includes('wrangler'));
  const of = (kind) => () => calls.filter((c) => c.line.includes(kind));
  const writes = () => fetches.filter((f) => f.method !== 'GET');
  const printed = () => out.join('') + err.join('');
  return {
    deps,
    calls,
    fetches,
    events,
    psqlRuns,
    wranglers,
    lists: of('secret list'),
    puts: of('secret put'),
    deletes: of('secret delete'),
    tokens: of('auth token'),
    writes,
    generated,
    sleeps,
    out,
    err,
    printed,
  };
}

/** Every string that must never be printed, thrown, put on a command line or in a URL. */
function secretsOf(h) {
  const values = [OP_PW, stagingPooler(), TOKEN, ...h.generated];
  for (const run of h.puts()) values.push(run.opts.input);
  for (const run of h.psqlRuns()) {
    values.push(...(run.opts.input.match(/SCRAM-SHA-256\$[^']+/g) ?? []));
  }
  for (const f of h.writes()) values.push(f.body?.origin?.password);
  return values.filter((v) => typeof v === 'string' && v.length >= 8);
}

const entryOf = (name) => HYPERDRIVE_PLAN.find((p) => p.config === name);
// A `secret list` that shows one retired name of each Worker (each Worker deletes only its own).
const BOTH_RETIRED = '[{"name":"API_DB_URL"},{"name":"JOBS_MIRROR_DB_URL"}]';

describe('main', () => {
  it('with --yes: checks, proves Cloudflare access, rotates the passwords, writes the four configs and the key', async () => {
    const h = harness();
    expect(await main({ argv: YES, deps: h.deps })).toBe(0);
    // psql probe, both Workers listed, the token, the config list (nothing changed so far), one psql transaction
    // (runSql probes again), the four configs, the HMAC key; no delete (no retired secret was listed)
    expect(h.events).toEqual([
      'probe',
      'list',
      'list',
      'token',
      'GET',
      'probe',
      'psql',
      'POST',
      'POST',
      'POST',
      'POST',
      'put',
    ]);
    const run = h.psqlRuns()[0];
    expect(run.args).toEqual(expect.arrayContaining(['-v', 'ON_ERROR_STOP=1', '-f', '-']));
    expect(run.opts.input).toContain('begin;');
    expect(run.opts.input).toContain('grant trace_api to api_login with inherit false, set true;');
    expect(run.opts.env.PGSSLMODE).toBe('require');
    expect(run.opts.env.PGUSER).toBe(`postgres.${SREF}`);
    expect(run.opts.env.TRACE_OPERATOR_DB_URL).toBeUndefined();
    expect(h.writes().map((f) => f.body.name)).toEqual(HYPERDRIVE_PLAN.map((p) => p.config));
  });

  it('calls only the pinned account Hyperdrive endpoints: Bearer token, JSON, no redirects, a timeout', async () => {
    const h = harness({
      existing: [{ id: idOf(10), name: 'trace-staging-jobs-quality-login' }],
    });
    expect(await main({ argv: YES, deps: h.deps })).toBe(0);
    expect(h.fetches.map((f) => [f.method, f.url])).toEqual([
      ['GET', BASE],
      ['POST', BASE],
      ['POST', BASE],
      ['PUT', `${BASE}/${idOf(10)}`],
      ['POST', BASE],
    ]);
    for (const f of h.fetches) {
      expect(f.init.headers).toEqual({
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      });
      expect(f.init.redirect).toBe('error');
      expect(f.init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(h.fetches[0].init.body).toBeUndefined();
  });

  it('updates a config only on an exact name match, else creates it', async () => {
    const h = harness({
      existing: [
        { id: idOf(10), name: 'trace-staging-api-login' },
        { id: idOf(11), name: 'trace-staging-jobs-mirror-login-old' },
        { id: idOf(12), name: 'TRACE-STAGING-JOBS-QUALITY-LOGIN' },
        { id: idOf(13), name: ' trace-staging-jobs-integrity-login' },
        { id: idOf(14), name: 'someone-elses-config' },
      ],
    });
    expect(await main({ argv: YES, deps: h.deps })).toBe(0);
    expect(h.writes().map((f) => [f.method, f.url, f.body.name])).toEqual([
      ['PUT', `${BASE}/${idOf(10)}`, 'trace-staging-api-login'],
      ['POST', BASE, 'trace-staging-jobs-mirror-login'],
      ['POST', BASE, 'trace-staging-jobs-quality-login'],
      ['POST', BASE, 'trace-staging-jobs-integrity-login'],
    ]);
  });

  it('sends each config the exact body, with the password the database received (as a SCRAM verifier)', async () => {
    const h = harness();
    expect(await main({ argv: YES, deps: h.deps })).toBe(0);
    const target = parseOperatorUrl(stagingPooler(), SREF);
    const sql = h.psqlRuns()[0].opts.input;
    for (const f of h.writes()) {
      const entry = entryOf(f.body.name);
      const pw = f.body.origin.password;
      expect(f.body).toEqual(
        hyperdriveBody(target, entry, pw, { caId: CA_ID, sslmode: 'verify-full' }),
      );
      expect(f.body.origin.user).toBe(`${entry.login}.${SREF}`);
      expect(sql).not.toContain(pw);
      const m = new RegExp(
        `create role ${entry.login} with login noinherit password '(SCRAM[^']+)'`,
      ).exec(sql);
      const salt = Buffer.from(/\$4096:([^$]+)\$/.exec(m[1])[1], 'base64');
      expect(scramSha256Verifier(pw, salt)).toBe(m[1]);
    }
    expect(new Set(h.writes().map((f) => f.body.origin.password)).size).toBe(4);
  });

  it('passes --sslmode verify-ca and the direct host through to every config', async () => {
    const direct = pgUrl({ user: 'postgres', host: `db.${SREF}.supabase.co` });
    const h = harness({ env: { TRACE_OPERATOR_DB_URL: direct } });
    expect(await main({ argv: [...YES, '--sslmode', 'verify-ca'], deps: h.deps })).toBe(0);
    for (const f of h.writes()) {
      expect(f.body.mtls).toEqual({ ca_certificate_id: CA_ID, sslmode: 'verify-ca' });
      expect(f.body.origin.host).toBe(`db.${SREF}.supabase.co`);
      expect(f.body.origin.user).toBe(entryOf(f.body.name).login);
      expect(f.body.caching).toEqual({ disabled: true });
      expect(f.body.origin_connection_limit).toBe(5);
    }
  });

  it('puts MEDIA_LINK_HMAC_KEY on api, the value on stdin only', async () => {
    const h = harness();
    expect(await main({ argv: YES, deps: h.deps })).toBe(0);
    const puts = h.puts();
    expect(puts).toHaveLength(1);
    const [p] = puts;
    expect(p.cmd).toBe('pnpm');
    expect(p.args).toEqual([
      'exec',
      'wrangler',
      'secret',
      'put',
      'MEDIA_LINK_HMAC_KEY',
      '--env',
      'staging',
    ]);
    expect(p.opts.cwd).toBe(join(ROOT, WORKER_DIRS.api));
    expect(p.opts.shell).toBe(false);
    expect(p.opts.input).toMatch(/^[0-9a-f]{64}$/);
    expect(h.generated).toContain(p.opts.input);
    expect(h.writes().map((f) => f.body.origin.password)).not.toContain(p.opts.input);
    expect(p.opts.env.TRACE_OPERATOR_DB_URL).toBeUndefined();
  });

  it('deletes each retired database URL secret a Worker still holds, and nothing else', async () => {
    const listed = (...names) => ({
      status: 0,
      stdout: JSON.stringify(names.map((name) => ({ name, type: 'secret_text' }))),
      stderr: '',
    });
    const h = harness({
      list: (_line, opts) =>
        opts.cwd.endsWith(join('services', 'api'))
          ? listed('API_DB_URL', 'CANDIDATE_TOKEN_PRIVATE_JWK', 'MEDIA_LINK_HMAC_KEY')
          : listed('JOBS_MIRROR_DB_URL', 'JOBS_INTEGRITY_DB_URL'),
    });
    expect(await main({ argv: YES, deps: h.deps })).toBe(0);
    expect(h.events.slice(-4)).toEqual(['put', 'delete', 'delete', 'delete']);
    expect(h.deletes().map((d) => [d.opts.cwd, d.args])).toEqual(
      [
        [WORKER_DIRS.api, 'API_DB_URL'],
        [WORKER_DIRS.jobs, 'JOBS_MIRROR_DB_URL'],
        [WORKER_DIRS.jobs, 'JOBS_INTEGRITY_DB_URL'],
      ].map(([dir, name]) => [
        join(ROOT, dir),
        ['exec', 'wrangler', 'secret', 'delete', name, '--env', 'staging'],
      ]),
    );
    for (const d of h.deletes()) {
      expect(d.opts.input).toBe('');
      expect(d.opts.shell).toBe(false);
    }
    expect(h.out.join('')).toMatch(/deleted the retired secret API_DB_URL/);
  });

  it('a failed delete of a retired secret stops with exit 1 and names it', async () => {
    const h = harness({
      list: () => ({ status: 0, stdout: '[{"name":"API_DB_URL"}]', stderr: '' }),
      del: () => ({ status: 1, stdout: '', stderr: `boom ${OP_PW}` }),
    });
    expect(await main({ argv: YES, deps: h.deps })).toBe(1);
    const text = h.err.join('');
    expect(text).toContain('API_DB_URL');
    expect(text).toMatch(/check-staging-secrets/);
    expect(text).not.toContain('boom');
    expect(h.printed()).not.toContain(OP_PW);
  });

  it('prints one id line per config and the wrangler.jsonc snippets for the lead', async () => {
    const h = harness({ existing: [{ id: idOf(10), name: 'trace-staging-jobs-mirror-login' }] });
    expect(await main({ argv: YES, deps: h.deps })).toBe(0);
    const text = h.out.join('');
    const ids = {
      API_DB: idOf(0),
      JOBS_MIRROR_DB: idOf(10),
      JOBS_QUALITY_DB: idOf(2),
      JOBS_INTEGRITY_DB: idOf(3),
    };
    for (const p of HYPERDRIVE_PLAN) {
      expect(text).toContain(
        `staging-worker-secrets: hyperdrive ${p.binding} (${p.worker}) id=${ids[p.binding]}\n`,
      );
    }
    for (const s of wranglerSnippets(ids)) {
      expect(text).toContain(s.file);
      expect(text).toContain(s.line);
    }
    expect(text).toMatch(
      /send these ids to the lead; the next staging dispatch needs them committed/,
    );
  });

  it('keeps wrangler from writing a debug log to disk on every call (no WRANGLER_LOG, logs off, sanitised)', async () => {
    const h = harness({
      env: {
        TRACE_OPERATOR_DB_URL: stagingPooler(),
        SUPABASE_STAGING_PROJECT_REF: SREF,
        WRANGLER_LOG: 'debug',
        WRANGLER_WRITE_LOGS: 'true',
        WRANGLER_LOG_SANITIZE: 'false',
      },
      list: () => ({ status: 0, stdout: BOTH_RETIRED, stderr: '' }),
    });
    expect(await main({ argv: YES, deps: h.deps })).toBe(0);
    const runs = h.wranglers();
    expect(runs.map((r) => r.args.slice(2, 4).join(' '))).toEqual([
      'secret list',
      'secret list',
      'auth token',
      'secret put',
      'secret delete',
      'secret delete',
    ]);
    for (const r of runs) {
      expect(r.opts.env.WRANGLER_LOG).toBeUndefined();
      expect(r.opts.env.WRANGLER_WRITE_LOGS).toBe('false');
      expect(r.opts.env.WRANGLER_LOG_SANITIZE).toBe('true');
      expect(r.opts.env.TRACE_OPERATOR_DB_URL).toBeUndefined();
    }
  });

  it('reads the token with `wrangler auth token --json` in services/api', async () => {
    const h = harness();
    expect(await main({ argv: YES, deps: h.deps })).toBe(0);
    const [t] = h.tokens();
    expect(t.args).toEqual(['exec', 'wrangler', 'auth', 'token', '--json']);
    expect(t.opts.cwd).toBe(join(ROOT, WORKER_DIRS.api));
    expect(t.opts.input).toBe('');
  });

  it('accepts CLOUDFLARE_API_TOKEN (api_token) as the Bearer token', async () => {
    const other = ['cfat', hexOf(20, 0x6b)].join('-');
    const h = harness({ token: () => tokenJson({ type: 'api_token', token: other }) });
    expect(await main({ argv: YES, deps: h.deps })).toBe(0);
    for (const f of h.fetches) expect(f.init.headers.Authorization).toBe(`Bearer ${other}`);
    expect(h.printed()).not.toContain(other);
  });

  it.each([
    [
      'a global API key login',
      () => tokenJson({ type: 'api_key', key: TOKEN, email: 'x@example.test' }),
    ],
    ['output that is not JSON', () => ({ status: 0, stdout: `token: ${TOKEN}`, stderr: '' })],
    ['an empty token', () => tokenJson({ type: 'oauth', token: '' })],
    [
      'a failed wrangler run',
      () => ({ status: 1, stdout: TOKEN, stderr: `Not logged in ${TOKEN}` }),
    ],
    [
      'a wrangler that cannot start',
      () => {
        throw new Error(`spawn failed ${TOKEN}`);
      },
    ],
  ])('refuses %s before any Cloudflare call or database change (exit 2)', async (_n, token) => {
    const h = harness({ token });
    expect(await main({ argv: YES, deps: h.deps })).toBe(2);
    expect(h.fetches).toHaveLength(0);
    expect(h.psqlRuns()).toHaveLength(0);
    expect(h.puts()).toHaveLength(0);
    expect(h.err.join('')).toMatch(/pnpm exec wrangler login/);
    expect(h.err.join('')).toMatch(/nothing was changed/i);
    expect(h.printed()).not.toContain(TOKEN);
  });

  it('a failed config list stops before the database (exit 2): HTTP status and error codes only', async () => {
    const h = harness({
      cf: (method) =>
        method === 'GET'
          ? cfFail(403, [10000, 9109], `Authentication error ${OP_PW} ${TOKEN}`)
          : undefined,
    });
    expect(await main({ argv: YES, deps: h.deps })).toBe(2);
    expect(h.psqlRuns()).toHaveLength(0);
    expect(h.writes()).toHaveLength(0);
    expect(h.puts()).toHaveLength(0);
    const text = h.err.join('');
    expect(text).toContain('403');
    expect(text).toContain('10000');
    expect(text).toContain('9109');
    expect(text).toMatch(/nothing was changed/i);
    expect(h.printed()).not.toMatch(/Authentication error/);
    expect(h.printed()).not.toContain(OP_PW);
    expect(h.printed()).not.toContain(TOKEN);
  });

  it.each([
    ['HTTP 200 with success false', () => ({ status: 200, json: { success: false, errors: [] } })],
    ['a body that is not JSON', () => ({ status: 502, raw: `<html>${TOKEN} ${OP_PW}</html>` })],
    ['a result that is not a list', () => cfOk({ configs: [] })],
    ['a network failure', () => new Error(`connect failed ${TOKEN}`)],
  ])('a config list with %s stops before the database (exit 2)', async (_n, answer) => {
    const h = harness({ cf: (method) => (method === 'GET' ? answer() : undefined) });
    expect(await main({ argv: YES, deps: h.deps })).toBe(2);
    expect(h.psqlRuns()).toHaveLength(0);
    expect(h.writes()).toHaveLength(0);
    expect(h.printed()).not.toContain(TOKEN);
    expect(h.printed()).not.toContain(OP_PW);
    expect(h.printed()).not.toContain('<html>');
  });

  it.each([
    [
      'more than one page (total_pages 2)',
      () =>
        cfOk([{ id: idOf(10), name: 'x' }], {
          result_info: { page: 1, per_page: 1, count: 1, total_count: 2, total_pages: 2 },
        }),
      /more Hyperdrive configs than one page/,
    ],
    [
      'more than one page (total_count above the result)',
      () =>
        cfOk([{ id: idOf(10), name: 'x' }], {
          result_info: { page: 1, per_page: 20, count: 1, total_count: 30 },
        }),
      /more Hyperdrive configs than one page/,
    ],
    [
      'two configs with a planned name',
      () =>
        listOf([
          { id: idOf(10), name: 'trace-staging-jobs-quality-login' },
          { id: idOf(11), name: 'trace-staging-jobs-quality-login' },
        ]),
      /trace-staging-jobs-quality-login/,
    ],
    [
      'a planned config with a malformed id',
      () => listOf([{ id: 'not-an-id', name: 'trace-staging-api-login' }]),
      /trace-staging-api-login/,
    ],
  ])('fails closed on %s, before the database (exit 1)', async (_n, answer, named) => {
    const h = harness({ cf: (method) => (method === 'GET' ? answer() : undefined) });
    expect(await main({ argv: YES, deps: h.deps })).toBe(1);
    expect(h.psqlRuns()).toHaveLength(0);
    expect(h.writes()).toHaveLength(0);
    expect(h.puts()).toHaveLength(0);
    expect(h.err.join('')).toMatch(named);
    expect(h.err.join('')).toMatch(/nothing was changed/i);
  });

  it('a config that fails mid-way names it and the stale ones, hints at the CA and sslmode (exit 1)', async () => {
    const leak = `could not connect ${OP_PW} ${TOKEN}`;
    const h = harness({
      existing: [{ id: idOf(12), name: 'trace-staging-jobs-quality-login' }],
      cf: (method, _url, body) =>
        method !== 'GET' && body.name === 'trace-staging-jobs-quality-login'
          ? cfFail(400, [2008], leak)
          : undefined,
    });
    expect(await main({ argv: YES, deps: h.deps })).toBe(1);
    expect(h.writes().map((f) => f.body.name)).toEqual([
      'trace-staging-api-login',
      'trace-staging-jobs-mirror-login',
      'trace-staging-jobs-quality-login',
    ]);
    expect(h.puts()).toHaveLength(0);
    expect(h.deletes()).toHaveLength(0);
    const text = h.err.join('');
    expect(text).toContain('trace-staging-jobs-quality-login');
    expect(text).toContain('trace-staging-jobs-integrity-login');
    expect(text).not.toContain('trace-staging-api-login');
    expect(text).not.toContain('trace-staging-jobs-mirror-login');
    expect(text).toContain('400');
    expect(text).toContain('2008');
    expect(text).toMatch(/--ca-certificate-id/);
    expect(text).toMatch(/--sslmode verify-ca/);
    expect(text).toMatch(/re-run with --yes/i);
    expect(text).not.toContain('could not connect');
    for (const v of secretsOf(h)) expect(h.printed()).not.toContain(v);
  });

  // Staging run 2026-10-22: the Supabase Shared Pooler caches credentials briefly, so right after the rotation it
  // still checks the old password and Hyperdrive's connection test answers 400 / 2013 (invalid credentials). The
  // script waits for the cache (a settle delay, then spaced retries on 2013 only) instead of failing at once.
  describe('the Supabase pooler credential cache (Cloudflare error 2013)', () => {
    const failTimes = (times, code = 2013, only = null) => {
      const seen = new Map();
      return (method, _url, body) => {
        if (method === 'GET' || (only !== null && body.name !== only)) return undefined;
        const k = (seen.get(body.name) ?? 0) + 1;
        seen.set(body.name, k);
        return k <= times
          ? cfFail(400, [code], `password authentication failed ${OP_PW}`)
          : undefined;
      };
    };
    const writesOf = (h, name) => h.writes().filter((f) => f.body.name === name);

    it('waits a settle delay after the database step, before the first config call', async () => {
      const h = harness();
      expect(await main({ argv: YES, deps: h.deps })).toBe(0);
      expect(h.sleeps).toEqual([POOLER_SETTLE_MS]);
      expect(POOLER_SETTLE_MS).toBe(20_000);
    });

    it('retries a config on 2013 after a spaced wait, then goes on', async () => {
      const h = harness({ cf: failTimes(1, 2013, 'trace-staging-api-login') });
      expect(await main({ argv: YES, deps: h.deps })).toBe(0);
      expect(writesOf(h, 'trace-staging-api-login')).toHaveLength(2);
      expect(h.sleeps).toEqual([20_000, 30_000]);
      expect(h.printed()).toMatch(
        /waiting 30 s for the Supabase pooler to pick up the new password of api_login \(error 2013, attempt 2 of 4\)/,
      );
      // The same password is sent again: the database already holds it.
      const [a, b] = writesOf(h, 'trace-staging-api-login');
      expect(a.body.origin.password).toBe(b.body.origin.password);
      expect(h.puts()).toHaveLength(1);
      for (const v of secretsOf(h)) expect(h.printed()).not.toContain(v);
    });

    it('gives up after 4 attempts on one config: wait 5 minutes, then re-run once (exit 1)', async () => {
      const h = harness({ cf: failTimes(9, 2013, 'trace-staging-api-login') });
      expect(await main({ argv: YES, deps: h.deps })).toBe(1);
      expect(writesOf(h, 'trace-staging-api-login')).toHaveLength(4);
      expect(writesOf(h, 'trace-staging-jobs-mirror-login')).toHaveLength(0);
      expect(h.sleeps).toEqual([20_000, 30_000, 45_000, 60_000]);
      const text = h.err.join('');
      expect(text).toContain('2013');
      expect(text).toMatch(/wait 5 minutes/i);
      expect(text).toMatch(/re-run --yes once/i);
      expect(text).not.toMatch(/--ca-certificate-id/);
      expect(text).not.toContain('password authentication failed');
      expect(h.puts()).toHaveLength(0);
      for (const v of secretsOf(h)) expect(h.printed()).not.toContain(v);
    });

    it('never retries another error code: 2011 fails after one call, with the CA and sslmode hint', async () => {
      const h = harness({ cf: failTimes(9, 2011, 'trace-staging-api-login') });
      expect(await main({ argv: YES, deps: h.deps })).toBe(1);
      expect(writesOf(h, 'trace-staging-api-login')).toHaveLength(1);
      expect(h.sleeps).toEqual([20_000]);
      expect(h.err.join('')).toMatch(/--ca-certificate-id/);
    });

    it('caps the retries of the whole run at 8, so a real credential problem cannot hammer the pooler', async () => {
      const h = harness({ cf: failTimes(3) });
      expect(await main({ argv: YES, deps: h.deps })).toBe(1);
      expect(h.sleeps.slice(1)).toHaveLength(8);
      // configs 1 and 2 take 3 retries each and succeed; config 3 fails once more than the 2 retries left
      expect(writesOf(h, 'trace-staging-api-login')).toHaveLength(4);
      expect(writesOf(h, 'trace-staging-jobs-mirror-login')).toHaveLength(4);
      expect(writesOf(h, 'trace-staging-jobs-quality-login')).toHaveLength(3);
      expect(writesOf(h, 'trace-staging-jobs-integrity-login')).toHaveLength(0);
      expect(h.err.join('')).toMatch(/wait 5 minutes/i);
    });

    it('a dry run never waits', async () => {
      const h = harness();
      expect(await main({ argv: DRY, deps: h.deps })).toBe(0);
      expect(h.sleeps).toEqual([]);
    });
  });

  it.each([
    [
      'HTTP 200 with success false',
      () => ({ status: 200, json: { success: false, errors: [{ code: 1 }] } }),
    ],
    ['a created id that is malformed', () => cfOk({ id: 'XYZ' })],
    ['no result', () => cfOk(null)],
    ['a network failure', () => new Error(`timeout ${TOKEN}`)],
  ])('a create with %s is a failure naming the config (exit 1)', async (_n, answer) => {
    const h = harness({ cf: (method) => (method === 'POST' ? answer() : undefined) });
    expect(await main({ argv: YES, deps: h.deps })).toBe(1);
    expect(h.writes()).toHaveLength(1);
    expect(h.puts()).toHaveLength(0);
    expect(h.err.join('')).toContain('trace-staging-api-login');
    expect(h.printed()).not.toContain(TOKEN);
  });

  it('on Windows runs pnpm through a constant shell command line, values still on stdin', async () => {
    const h = harness({
      platform: 'win32',
      list: () => ({ status: 0, stdout: BOTH_RETIRED, stderr: '' }),
    });
    expect(await main({ argv: YES, deps: h.deps })).toBe(0);
    const runs = h.wranglers();
    expect(runs).toHaveLength(6);
    for (const p of runs) {
      expect(p.opts.shell).toBe(true);
      expect(p.args).toEqual([]);
      expect(p.cmd).toMatch(
        /^pnpm exec wrangler (secret (list|put [A-Z_]+|delete [A-Z_]+) --env staging( --format json)?|auth token --json)$/,
      );
    }
    for (const p of h.puts()) expect(p.opts.input).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never prints, throws or puts on a command line or in a URL any operator, generated or token value', async () => {
    for (const over of [
      {},
      { put: () => ({ status: 1, stdout: `echo ${OP_PW}`, stderr: `boom ${OP_PW}` }) },
      {
        cf: (method) =>
          method === 'PUT' || method === 'POST'
            ? cfFail(500, [7003], `${OP_PW} ${TOKEN}`)
            : undefined,
      },
    ]) {
      const h = harness(over);
      await main({ argv: YES, deps: h.deps });
      const leaks = secretsOf(h);
      expect(leaks.length).toBeGreaterThan(6);
      for (const v of leaks) {
        expect(h.printed()).not.toContain(v);
        for (const c of h.calls) {
          expect(c.line).not.toContain(v);
          expect(JSON.stringify(c.args)).not.toContain(v);
        }
        for (const f of h.fetches) expect(f.url).not.toContain(v);
      }
      for (const c of h.calls) expect(JSON.stringify(c.opts?.env ?? {})).not.toContain(TOKEN);
    }
  });

  it('--dry-run prints only the plan; nothing but `psql --version` runs and nothing is fetched', async () => {
    const h = harness();
    expect(await main({ argv: DRY, deps: h.deps })).toBe(0);
    expect(h.events).toEqual(['probe']);
    expect(h.fetches).toHaveLength(0);
    const text = h.printed();
    for (const { login, role } of LOGIN_ROLES) {
      expect(text).toContain(login);
      expect(text).toContain(role);
    }
    for (const p of HYPERDRIVE_PLAN) {
      expect(text).toContain(p.config);
      expect(text).toContain(p.binding);
    }
    for (const w of PLAN) expect(text).toContain(w.workerName);
    expect(text).toContain('MEDIA_LINK_HMAC_KEY');
    for (const name of Object.values(RETIRED_SECRETS).flat()) expect(text).toContain(name);
    expect(text).toContain(CA_ID);
    expect(text).toContain('verify-full');
    expect(text).toMatch(/caching disabled/);
    expect(text).toMatch(/connection limit 5/);
    expect(text).toMatch(/session pooler/);
    expect(text).toContain('Not touched: CANDIDATE_TOKEN_PRIVATE_JWK and trace-edge-staging');
    expect(text).toMatch(/dry run/i);
    // SEC-W3-3: the old-password window covers four config updates in a row, each testing the connection.
    expect(text).toMatch(/tens of seconds/);
    expect(text).not.toMatch(/a few seconds/);
    expect(text).not.toContain(OP_PW);
    expect(text).not.toContain(SREF);
    for (const g of h.generated) expect(text).not.toContain(g);
  });

  it('--dry-run shows --sslmode verify-ca', async () => {
    const h = harness();
    expect(await main({ argv: [...DRY, '--sslmode', 'verify-ca'], deps: h.deps })).toBe(0);
    expect(h.printed()).toContain('verify-ca');
    expect(h.printed()).not.toContain('verify-full');
  });

  it('without --yes prints the plan, changes nothing and asks for --yes (exit 2)', async () => {
    const h = harness();
    expect(await main({ argv: ['--env', 'staging'], deps: h.deps })).toBe(2);
    expect(h.events).toEqual(['probe']);
    expect(h.fetches).toHaveLength(0);
    expect(h.printed()).toMatch(/re-run with --yes/);
  });

  it.each([
    ['--env production', ['--env', 'production', '--yes', ...CA]],
    ['no --env', ['--yes', ...CA]],
    ['--yes without a CA id', ['--env', 'staging', '--yes']],
    ['--sslmode require', [...YES, '--sslmode', 'require']],
  ])('refuses %s before anything runs (exit 2)', async (_name, argv) => {
    const h = harness();
    expect(await main({ argv, deps: h.deps })).toBe(2);
    expect(h.calls).toHaveLength(0);
    expect(h.fetches).toHaveLength(0);
  });

  it.each([
    [
      'TRACE_OPERATOR_DB_URL is missing',
      { SUPABASE_STAGING_PROJECT_REF: SREF },
      'TRACE_OPERATOR_DB_URL',
    ],
    [
      'SUPABASE_STAGING_PROJECT_REF is set to another project',
      { TRACE_OPERATOR_DB_URL: stagingPooler(), SUPABASE_STAGING_PROJECT_REF: OTHER_REF },
      'SUPABASE_STAGING_PROJECT_REF',
    ],
    [
      'the URL is loopback',
      {
        TRACE_OPERATOR_DB_URL: pgUrl({ user: 'postgres', host: '127.0.0.1', port: '54322' }),
        SUPABASE_STAGING_PROJECT_REF: SREF,
      },
      'e2e-local',
    ],
    [
      'the URL is another project',
      { TRACE_OPERATOR_DB_URL: pgUrl({ user: `postgres.${OTHER_REF}`, host: POOLER }) },
      'staging project',
    ],
  ])('refuses when %s (exit 2, nothing runs, the variable named)', async (_n, env, named) => {
    const h = harness({ env });
    expect(await main({ argv: DRY, deps: h.deps })).toBe(2);
    expect(h.psqlRuns()).toHaveLength(0);
    expect(h.wranglers()).toHaveLength(0);
    expect(h.fetches).toHaveLength(0);
    expect(h.err.join('')).toContain(named);
    expect(h.printed()).not.toContain(OP_PW);
  });

  it('refuses without psql (exit 2), before any wrangler or Cloudflare call', async () => {
    const h = harness({ hasPsql: false });
    expect(await main({ argv: YES, deps: h.deps })).toBe(2);
    expect(h.wranglers()).toHaveLength(0);
    expect(h.fetches).toHaveLength(0);
    expect(h.err.join('')).toMatch(/psql/);
  });

  it('stops before the token and the database when a Worker does not exist yet', async () => {
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
    expect(await main({ argv: YES, deps: h.deps })).toBe(2);
    expect(h.tokens()).toHaveLength(0);
    expect(h.fetches).toHaveLength(0);
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
    expect(await main({ argv: YES, deps: h.deps })).toBe(2);
    expect(h.psqlRuns()).toHaveLength(0);
    expect(h.fetches).toHaveLength(0);
    expect(h.printed()).not.toContain(marker);
    expect(h.err.join('')).toMatch(/wrangler whoami|wrangler login/);
  });

  it('stops before the database when the secret list is not wrangler JSON (exit 2)', async () => {
    const h = harness({ list: () => ({ status: 0, stdout: 'Secret Name: X', stderr: '' }) });
    expect(await main({ argv: YES, deps: h.deps })).toBe(2);
    expect(h.psqlRuns()).toHaveLength(0);
    expect(h.fetches).toHaveLength(0);
    expect(h.err.join('')).toContain('trace-api-staging');
  });

  it('names the missing-migrations case (TR001) and changes no config or secret', async () => {
    const h = harness({
      psql: { status: 3, stdout: '', stderr: `psql:<stdin>:9: ERROR:  TR001 ${OP_PW}` },
    });
    expect(await main({ argv: YES, deps: h.deps })).toBe(1);
    expect(h.writes()).toHaveLength(0);
    expect(h.puts()).toHaveLength(0);
    expect(h.err.join('')).toMatch(/migrations/);
    expect(h.printed()).not.toContain(OP_PW);
  });

  it('names the unexpected-membership case (TR002) and changes no config or secret', async () => {
    const h = harness({ psql: { status: 3, stdout: '', stderr: 'ERROR:  TR002' } });
    expect(await main({ argv: YES, deps: h.deps })).toBe(1);
    expect(h.writes()).toHaveLength(0);
    expect(h.puts()).toHaveLength(0);
    expect(h.err.join('')).toMatch(/membership|attribute/);
  });

  it('a database failure reports only the SQLSTATE and says nothing was changed', async () => {
    const h = harness({ psql: { status: 2, stdout: '', stderr: `ERROR:  42501 ${OP_PW}` } });
    expect(await main({ argv: YES, deps: h.deps })).toBe(1);
    expect(h.writes()).toHaveLength(0);
    expect(h.puts()).toHaveLength(0);
    const text = h.err.join('');
    expect(text).toContain('42501');
    expect(text).toMatch(/rolled back|nothing was changed/i);
    expect(text).not.toContain(OP_PW);
  });

  it.each([
    [
      'psql exits 2 with no SQLSTATE (connection lost)',
      { status: 2, stdout: '', stderr: `server closed the connection unexpectedly ${OP_PW}` },
    ],
    [
      'psql is killed by the spawn timeout',
      {
        status: null,
        signal: 'SIGTERM',
        error: Object.assign(new Error('spawnSync psql ETIMEDOUT'), { code: 'ETIMEDOUT' }),
        stdout: '',
        stderr: '',
      },
    ],
  ])(
    'when %s the outcome is unknown: no "rolled back", the four configs and the key may be stale',
    async (_n, psql) => {
      const h = harness({ psql });
      expect(await main({ argv: YES, deps: h.deps })).toBe(1);
      expect(h.writes()).toHaveLength(0);
      expect(h.puts()).toHaveLength(0);
      const text = h.err.join('');
      expect(text).not.toMatch(/rolled back|nothing was changed/i);
      expect(text).toMatch(/unknown/i);
      expect(text).toMatch(/passwords may have changed/i);
      for (const p of HYPERDRIVE_PLAN) expect(text).toContain(p.config);
      expect(text).toContain('MEDIA_LINK_HMAC_KEY');
      expect(text).toMatch(/re-run with --yes/i);
      expect(h.printed()).not.toContain(OP_PW);
    },
  );

  it('a failed HMAC key put stops after the configs, names the secret and asks for a re-run (exit 1)', async () => {
    const h = harness({
      list: () => ({ status: 0, stdout: '[{"name":"API_DB_URL"}]', stderr: '' }),
      put: () => ({ status: 1, stdout: '', stderr: 'latest version not deployed' }),
    });
    expect(await main({ argv: YES, deps: h.deps })).toBe(1);
    expect(h.writes()).toHaveLength(4);
    expect(h.deletes()).toHaveLength(0);
    const text = h.err.join('');
    expect(text).toContain('MEDIA_LINK_HMAC_KEY');
    expect(text).toMatch(/re-run/);
    expect(text).not.toContain('latest version not deployed');
  });

  it('a put that throws is a failure too, with no value in the message', async () => {
    const h = harness({
      put: () => {
        throw new Error(`spawn failed ${OP_PW}`);
      },
    });
    expect(await main({ argv: YES, deps: h.deps })).toBe(1);
    expect(h.printed()).not.toContain(OP_PW);
  });

  it('works without SUPABASE_STAGING_PROJECT_REF (the ref is pinned in the script)', async () => {
    const h = harness({ env: { TRACE_OPERATOR_DB_URL: stagingPooler() } });
    expect(await main({ argv: DRY, deps: h.deps })).toBe(0);
  });

  it('pins the staging ref that docs/infra/environments.md records', () => {
    const doc = readFileSync(join(ROOT, 'docs', 'infra', 'environments.md'), 'utf8');
    const row = doc.split(/\r?\n/).find((l) => l.startsWith('| `SUPABASE_STAGING_PROJECT_REF` |'));
    expect(row).toContain(`\`${STAGING_PROJECT_REF}\``);
    expect(STAGING_PROJECT_REF).toMatch(/^[a-z0-9]{20}$/);
  });

  it('every planned id fits the Cloudflare shape the deploy check expects', () => {
    for (let i = 0; i < 20; i += 1) expect(idOf(i)).toMatch(HYPERDRIVE_ID_RE);
  });
});
