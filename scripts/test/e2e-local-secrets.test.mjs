// scripts/lib/e2e-local-secrets.mjs: the local-only, run-time values the e2e-local stack hands its Workers
// (specs/d1-demo-slice.md §4.2 bindings, §4.3 keys, §7.2 "Local stack"; spec review r3a #1). Pure functions:
// nothing here starts a process, opens a database or writes a file. Every secret-shaped value is generated at run
// time, so nothing credential-shaped is committed.
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  LOGIN_ROLES,
  candidateTokenKeys,
  dotenvText,
  dropLoginRolesSql,
  jobsDevConfig,
  kidFor,
  loginRolesSql,
  loginUrl,
  workerSecrets,
} from '../lib/e2e-local-secrets.mjs';

const hex = (n) => randomBytes(n).toString('hex');
const B64URL_43 = /^[A-Za-z0-9_-]{43}$/;
/** The local stack's operator URL, assembled at run time (no credential literal in the repo). */
const stackDbUrl = () => {
  const u = new URL(`${['postgres', 'ql'].join('')}://127.0.0.1:54322/postgres`);
  u.username = 'postgres';
  u.password = hex(4);
  return u.toString();
};
const passwordsOf = () => Object.fromEntries(LOGIN_ROLES.map(({ login }) => [login, hex(24)]));

describe('LOGIN_ROLES', () => {
  it('maps each operator login to exactly one trace_* role (spec §3, L-29, MT-14)', () => {
    expect(LOGIN_ROLES).toEqual([
      { login: 'api_login', role: 'trace_api' },
      { login: 'jobs_mirror_login', role: 'trace_worker' },
      { login: 'jobs_quality_login', role: 'trace_quality_worker' },
      { login: 'jobs_integrity_login', role: 'trace_integrity_worker' },
      // M1 R5-11 (DC-M1-6): the AI drafting job and the member provisioning job.
      { login: 'jobs_authoring_login', role: 'trace_authoring_worker' },
      { login: 'jobs_admin_login', role: 'trace_admin_worker' },
    ]);
  });
});

describe('loginRolesSql', () => {
  it('recreates every login with its password and one `inherit false, set true` grant, in one transaction', () => {
    const pw = passwordsOf();
    const sql = loginRolesSql(pw);
    const lines = sql.trim().split('\n');
    expect(lines[0]).toBe('begin;');
    expect(lines.at(-1)).toBe('commit;');
    for (const { login, role } of LOGIN_ROLES) {
      expect(sql).toContain(`drop role if exists ${login};\n`);
      expect(sql).toContain(`create role ${login} login noinherit password '${pw[login]}';\n`);
      expect(sql).toContain(`grant ${role} to ${login} with inherit false, set true;\n`);
    }
    // Nothing but the six logins and their one role each.
    expect(lines).toHaveLength(2 + 3 * LOGIN_ROLES.length);
  });

  it('refuses a missing, short or non-hex password (it is spliced into the SQL text)', () => {
    const pw = passwordsOf();
    expect(() => loginRolesSql({ ...pw, api_login: undefined })).toThrow(/api_login/);
    expect(() => loginRolesSql({ ...pw, jobs_quality_login: hex(8) })).toThrow(
      /jobs_quality_login/,
    );
    expect(() =>
      loginRolesSql({ ...pw, jobs_mirror_login: `${hex(24)}'; drop table x; --` }),
    ).toThrow();
    // The error never carries the value.
    let message = '';
    try {
      loginRolesSql({ ...pw, api_login: `${hex(24)}'` });
    } catch (e) {
      message = e.message;
    }
    expect(message).not.toContain(pw.api_login);
  });
});

describe('dropLoginRolesSql', () => {
  it('drops the six logins (if they exist) in one transaction', () => {
    expect(dropLoginRolesSql()).toBe(
      [
        'begin;',
        ...LOGIN_ROLES.map(({ login }) => `drop role if exists ${login};`),
        'commit;',
        '',
      ].join('\n'),
    );
  });
});

describe('loginUrl', () => {
  it('keeps the stack URL host, port and database and swaps in the login and its password', () => {
    const pw = hex(24);
    const u = new URL(loginUrl(stackDbUrl(), 'api_login', pw));
    expect(u.protocol).toBe('postgresql:');
    expect(u.hostname).toBe('127.0.0.1');
    expect(u.port).toBe('54322');
    expect(u.pathname).toBe('/postgres');
    expect(u.username).toBe('api_login');
    expect(u.password).toBe(pw);
    // No sslmode or other query parameter: the api and jobs clients take a local URL only without a query, and run it
    // over plain TCP (localDbUrlAllowed, ADR-031 amendment 1).
    expect(u.search).toBe('');
  });

  it('refuses a stack URL that is not local or not postgres', () => {
    const remote = new URL(stackDbUrl());
    remote.hostname = 'db.example.test';
    expect(() => loginUrl(remote.toString(), 'api_login', hex(24))).toThrow(/local/);
    expect(() => loginUrl('http://127.0.0.1:54322/postgres', 'api_login', hex(24))).toThrow();
    expect(() => loginUrl('not a url', 'api_login', hex(24))).toThrow();
  });
});

describe('kidFor', () => {
  it('is d1-YYYY-MM in UTC (spec §4.3)', () => {
    expect(kidFor(Date.UTC(2026, 9, 19, 12))).toBe('d1-2026-10');
    expect(kidFor(Date.UTC(2027, 0, 1, 0, 0, 1))).toBe('d1-2027-01');
    // 23:30 on 31 December in UTC is still December, whatever the local zone says.
    expect(kidFor(Date.UTC(2026, 11, 31, 23, 30))).toBe('d1-2026-12');
  });
});

describe('candidateTokenKeys', () => {
  it('makes an ES256 pair: the private JWK the api parses and a one-key public list, signing and verifying', async () => {
    const keys = await candidateTokenKeys(globalThis.crypto.subtle, 'd1-2026-10');
    expect(keys.kid).toBe('d1-2026-10');
    const priv = JSON.parse(keys.privateJwk);
    expect(Object.keys(priv).sort()).toEqual(['alg', 'crv', 'd', 'kid', 'kty', 'use', 'x', 'y']);
    expect(priv).toMatchObject({
      kty: 'EC',
      crv: 'P-256',
      kid: 'd1-2026-10',
      alg: 'ES256',
      use: 'sig',
    });
    for (const c of ['x', 'y', 'd']) expect(priv[c]).toMatch(B64URL_43);
    // The one shape of CANDIDATE_TOKEN_PUBLIC_JWK: a JSON array, signing key first, no private member.
    const list = JSON.parse(keys.publicJwkList);
    expect(list).toEqual([
      {
        kty: 'EC',
        crv: 'P-256',
        x: priv.x,
        y: priv.y,
        kid: 'd1-2026-10',
        alg: 'ES256',
        use: 'sig',
      },
    ]);
    const P256 = { name: 'ECDSA', namedCurve: 'P-256' };
    const ES256 = { name: 'ECDSA', hash: 'SHA-256' };
    const subtle = globalThis.crypto.subtle;
    const signKey = await subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: priv.x, y: priv.y, d: priv.d },
      P256,
      false,
      ['sign'],
    );
    const verifyKey = await subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: list[0].x, y: list[0].y },
      P256,
      false,
      ['verify'],
    );
    const msg = new TextEncoder().encode('e2e-local self-test');
    const sig = await subtle.sign(ES256, signKey, msg);
    expect(await subtle.verify(ES256, verifyKey, sig, msg)).toBe(true);
  });

  it('makes a new pair every time', async () => {
    const a = await candidateTokenKeys(globalThis.crypto.subtle, 'd1-2026-10');
    const b = await candidateTokenKeys(globalThis.crypto.subtle, 'd1-2026-10');
    expect(JSON.parse(a.privateJwk).d).not.toBe(JSON.parse(b.privateJwk).d);
  });

  it('refuses a kid that is not d1-YYYY-MM', async () => {
    await expect(candidateTokenKeys(globalThis.crypto.subtle, 'd1-2026-13')).rejects.toThrow(/kid/);
  });
});

describe('workerSecrets', () => {
  const input = async () => ({
    stack: {
      dbUrl: stackDbUrl(),
      apiUrl: 'http://127.0.0.1:54321',
      publishableKey: `sb_publishable_${hex(8)}`,
    },
    passwords: passwordsOf(),
    keys: await candidateTokenKeys(globalThis.crypto.subtle, 'd1-2026-10'),
    hmacKey: hex(32),
  });

  it('gives each Worker exactly the names its Env reads (spec §4.2 bindings table)', async () => {
    const i = await input();
    const s = workerSecrets(i);
    expect(Object.keys(s.api).sort()).toEqual([
      'API_DB_URL',
      'CANDIDATE_TOKEN_KID',
      'CANDIDATE_TOKEN_PRIVATE_JWK',
      'CANDIDATE_TOKEN_PUBLIC_JWK',
      'MEDIA_LINK_HMAC_KEY',
      'SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_URL',
    ]);
    // The edge holds no secret and no database credential: the public key list only (L-10, D1-3).
    expect(s.edge).toEqual({ CANDIDATE_TOKEN_PUBLIC_JWK: i.keys.publicJwkList });
    expect(Object.keys(s.jobs).sort()).toEqual([
      'JOBS_ADMIN_DB_URL',
      'JOBS_AUTHORING_DB_URL',
      'JOBS_INTEGRITY_DB_URL',
      'JOBS_MIRROR_DB_URL',
      'JOBS_QUALITY_DB_URL',
    ]);
    expect(s.api).toMatchObject({
      CANDIDATE_TOKEN_KID: 'd1-2026-10',
      CANDIDATE_TOKEN_PRIVATE_JWK: i.keys.privateJwk,
      CANDIDATE_TOKEN_PUBLIC_JWK: i.keys.publicJwkList,
      MEDIA_LINK_HMAC_KEY: i.hmacKey,
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_PUBLISHABLE_KEY: i.stack.publishableKey,
    });
  });

  it('connects each Worker path with its own login (one login per role, MT-14)', async () => {
    const i = await input();
    const s = workerSecrets(i);
    const user = (url) => new URL(url).username;
    const pass = (url) => new URL(url).password;
    expect(user(s.api.API_DB_URL)).toBe('api_login');
    expect(pass(s.api.API_DB_URL)).toBe(i.passwords.api_login);
    expect(user(s.jobs.JOBS_MIRROR_DB_URL)).toBe('jobs_mirror_login');
    expect(pass(s.jobs.JOBS_MIRROR_DB_URL)).toBe(i.passwords.jobs_mirror_login);
    expect(user(s.jobs.JOBS_QUALITY_DB_URL)).toBe('jobs_quality_login');
    expect(user(s.jobs.JOBS_INTEGRITY_DB_URL)).toBe('jobs_integrity_login');
    expect(pass(s.jobs.JOBS_INTEGRITY_DB_URL)).toBe(i.passwords.jobs_integrity_login);
    expect(user(s.jobs.JOBS_AUTHORING_DB_URL)).toBe('jobs_authoring_login');
    expect(pass(s.jobs.JOBS_AUTHORING_DB_URL)).toBe(i.passwords.jobs_authoring_login);
    expect(user(s.jobs.JOBS_ADMIN_DB_URL)).toBe('jobs_admin_login');
    expect(pass(s.jobs.JOBS_ADMIN_DB_URL)).toBe(i.passwords.jobs_admin_login);
  });

  it('refuses a short media-link key (the api needs at least 32 characters)', async () => {
    const i = await input();
    expect(() => workerSecrets({ ...i, hmacKey: hex(8) })).toThrow(/MEDIA_LINK_HMAC_KEY/);
  });
});

describe('dotenvText', () => {
  it("writes NAME='value' lines that dotenv reads back verbatim", () => {
    const json = JSON.stringify([{ kty: 'EC', x: hex(4) }]);
    expect(dotenvText({ A_NAME: 'plain', B_JSON: json })).toBe(
      `A_NAME='plain'\nB_JSON='${json}'\n`,
    );
  });

  it('refuses a value dotenv would change or a line break could split ($, quote, newline, empty)', () => {
    expect(() => dotenvText({ A: 'x$y' })).toThrow(/A/);
    expect(() => dotenvText({ A: "it's" })).toThrow(/A/);
    expect(() => dotenvText({ A: 'a\nB=c' })).toThrow(/A/);
    expect(() => dotenvText({ A: '' })).toThrow(/A/);
    expect(() => dotenvText({ 'bad-name': 'x' })).toThrow();
    // The error names the variable, never the value.
    let message = '';
    const value = `${hex(16)}$`;
    try {
      dotenvText({ SECRET_NAME: value });
    } catch (e) {
      message = e.message;
    }
    expect(message).toContain('SECRET_NAME');
    expect(message).not.toContain(value);
  });
});

describe('jobsDevConfig', () => {
  const config = [
    '// comment',
    '{',
    '  "$schema": "./node_modules/wrangler/config-schema.json",',
    '  "name": "trace-jobs",',
    '  "main": "src/index.ts",',
    '  "env": { "dev": { "name": "trace-jobs-dev" } },',
    '}',
    '',
  ].join('\n');

  it('points main at the real entry file and changes nothing else', () => {
    const out = jobsDevConfig(config, 'C:\\repo\\workers\\jobs\\src\\index.ts');
    expect(out).toBe(
      config.replace('"main": "src/index.ts"', '"main": "C:/repo/workers/jobs/src/index.ts"'),
    );
    expect(jobsDevConfig(config, '/repo/workers/jobs/src/index.ts')).toContain(
      '"main": "/repo/workers/jobs/src/index.ts",',
    );
  });

  it('refuses a config whose main is not the one known entry (so a changed config is noticed)', () => {
    expect(() =>
      jobsDevConfig(config.replace('src/index.ts', 'src/other.ts'), '/x/index.ts'),
    ).toThrow(/main/);
    expect(() => jobsDevConfig(`${config}\n"main": "src/index.ts",`, '/x/index.ts')).toThrow(
      /main/,
    );
  });
});
