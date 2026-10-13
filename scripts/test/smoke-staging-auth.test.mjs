// scripts/smoke-staging-auth.mjs (specs/m0b-tenancy.md §1.3 H9, §4.4, AT-B9). A fake fetch keyed by
// method + path: no network, no process is started. Synthetic values only; every key-shaped or
// secret-shaped string is built at run time (the pre-commit gitleaks hook rejects such literals).
import { describe, expect, it } from 'vitest';
import { base32Encode, totp } from '../lib/totp.mjs';
import { main } from '../smoke-staging-auth.mjs';

const enc = (s) => Buffer.from(s).toString('base64url');
const jwt = (claims) => `${enc('{"alg":"none"}')}.${enc(JSON.stringify(claims))}.${enc('sig')}`;

const REF = 'abcdefghij0123456789';
const ORIGIN = `https://${REF}.supabase.co`;
const PAGE_URL = 'https://trace-recruiter-staging.pages.dev/';
const PASSWORD = `${enc('synthetic-smoke')}-Aa1`;
const KEY = `sb_publishable_${enc('synthetic-publishable-key')}`;
const EMAIL = 'marker-smoke@example.test';
const TOTP_SECRET = base32Encode(Buffer.from('synthetic-totp-secret'));
const BODY_MARKER = enc('synthetic-response-body-marker');
const NOW = 1_760_000_000_000;

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '99999999-9999-4999-8999-999999999999';
const ORG_ID = '22222222-2222-4222-8222-222222222222';
const MEMBERSHIP_ID = '33333333-3333-4333-8333-333333333333';
const FACTOR_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_FACTOR_ID = '55555555-5555-4555-8555-555555555555';
const CHALLENGE_ID = '66666666-6666-4666-8666-666666666666';

const AAL1_TOKEN = jwt({ sub: USER_ID, aal: 'aal1', marker: enc('aal1-token') });
const AAL2_TOKEN = jwt({ sub: USER_ID, aal: 'aal2', marker: enc('aal2-token') });
const WRONG_SUB_TOKEN = jwt({ sub: OTHER_ID, aal: 'aal2', marker: enc('wrong-sub-token') });
const CODE = await totp({ secret: TOTP_SECRET, timeMs: NOW });

const ENV = Object.freeze({
  SUPABASE_STAGING_URL: ORIGIN,
  SUPABASE_STAGING_PUBLISHABLE_KEY: KEY,
  STAGING_SMOKE_EMAIL: EMAIL,
  STAGING_SMOKE_PASSWORD: PASSWORD,
  STAGING_SMOKE_TOTP_SECRET: TOTP_SECRET,
});

/** Values that must never reach stdout or stderr. */
const SENSITIVE = [
  PASSWORD,
  KEY,
  EMAIL,
  TOTP_SECRET,
  CODE,
  AAL1_TOKEN,
  AAL2_TOKEN,
  WRONG_SUB_TOKEN,
  USER_ID,
  ORG_ID,
  MEMBERSHIP_ID,
  FACTOR_ID,
  CHALLENGE_ID,
  BODY_MARKER,
  REF,
];

const reply = (status, body, headers = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const CSP = `default-src 'self'; connect-src 'self' ${ORIGIN}; frame-ancestors 'none'`;
const user = (factors) => ({ id: USER_ID, factors });
const totpFactor = (id = FACTOR_ID, status = 'verified') => ({
  id,
  factor_type: 'totp',
  status,
});

/** The happy-path responses, by `METHOD /path`. */
const happy = () => ({
  'GET /auth/v1/settings': () => reply(200, { disable_signup: true, external: {} }),
  'POST /auth/v1/token': () => reply(200, { access_token: AAL1_TOKEN, user: user([totpFactor()]) }),
  [`POST /auth/v1/factors/${FACTOR_ID}/challenge`]: () => reply(200, { id: CHALLENGE_ID }),
  [`POST /auth/v1/factors/${FACTOR_ID}/verify`]: () => reply(200, { access_token: AAL2_TOKEN }),
  'GET /rest/v1/memberships': () => reply(200, [{ id: MEMBERSHIP_ID, org_id: ORG_ID }]),
  'GET /rest/v1/orgs': () => reply(200, [{ id: ORG_ID }]),
  'POST /auth/v1/logout': () => new Response(null, { status: 204 }),
  'GET /': () =>
    new Response('<html></html>', { status: 200, headers: { 'content-security-policy': CSP } }),
});

/** Runs main() with scripted deps. `handlers` replace happy-path entries by key. */
async function run({ env = ENV, handlers = {}, argv = [], now = () => NOW } = {}) {
  const calls = [];
  const out = [];
  const err = [];
  const table = { ...happy(), ...handlers };
  const deps = {
    env,
    now,
    stdout: { write: (s) => out.push(s) },
    stderr: { write: (s) => err.push(s) },
    async fetch(url, init = {}) {
      const u = new URL(url);
      const key = `${init.method} ${u.pathname}`;
      calls.push({
        key,
        url: String(url),
        host: u.host,
        method: init.method,
        search: u.search,
        headers: init.headers ?? {},
        body: init.body === undefined ? undefined : JSON.parse(init.body),
        redirect: init.redirect,
        signal: init.signal,
      });
      const handler = table[key];
      if (!handler) throw new Error('unscripted request');
      return handler();
    },
  };
  const code = await main({ argv, deps });
  return { code, calls, out: out.join(''), err: err.join(''), keys: calls.map((c) => c.key) };
}

const expectNoLeak = (r) => {
  const text = r.out + r.err;
  for (const secret of SENSITIVE) expect(text).not.toContain(secret);
};

const networkError = () => {
  throw new TypeError('fetch failed');
};

describe('happy path', () => {
  it('signs in, steps up to aal2, reads its own rows, signs out and checks the page', async () => {
    const r = await run();
    expect(r.code).toBe(0);
    expect(r.out).toBe('smoke-staging-auth: OK (9 checks)\n');
    expect(r.err).toBe('');
    expect(r.keys).toEqual([
      'GET /auth/v1/settings',
      'POST /auth/v1/token',
      `POST /auth/v1/factors/${FACTOR_ID}/challenge`,
      `POST /auth/v1/factors/${FACTOR_ID}/verify`,
      'GET /rest/v1/memberships',
      'GET /rest/v1/orgs',
      'POST /auth/v1/logout',
      'GET /',
    ]);
    expectNoLeak(r);
  });

  it('sends every request without redirects and with a timeout signal', async () => {
    const r = await run();
    for (const c of r.calls) {
      expect(c.redirect).toBe('error');
      expect(c.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('1: settings with the publishable key', async () => {
    const [c] = (await run()).calls;
    expect(c.url).toBe(`${ORIGIN}/auth/v1/settings`);
    expect(c.method).toBe('GET');
    expect(c.headers).toEqual({ apikey: KEY });
    expect(c.body).toBeUndefined();
  });

  it('2: password sign-in', async () => {
    const c = (await run()).calls[1];
    expect(c.url).toBe(`${ORIGIN}/auth/v1/token?grant_type=password`);
    expect(c.method).toBe('POST');
    expect(c.headers).toEqual({ apikey: KEY, 'Content-Type': 'application/json' });
    expect(c.body).toEqual({ email: EMAIL, password: PASSWORD });
  });

  it('3: challenge and verify use the aal1 token and a deterministic TOTP code', async () => {
    const r = await run();
    const challenge = r.calls[2];
    expect(challenge.url).toBe(`${ORIGIN}/auth/v1/factors/${FACTOR_ID}/challenge`);
    expect(challenge.headers).toEqual({
      apikey: KEY,
      Authorization: `Bearer ${AAL1_TOKEN}`,
      'Content-Type': 'application/json',
    });
    expect(challenge.body).toEqual({});
    const verify = r.calls[3];
    expect(verify.url).toBe(`${ORIGIN}/auth/v1/factors/${FACTOR_ID}/verify`);
    expect(verify.headers).toEqual(challenge.headers);
    expect(verify.body).toEqual({ challenge_id: CHALLENGE_ID, code: CODE });
    expect(CODE).toMatch(/^[0-9]{6}$/);
  });

  it('4: memberships filtered by the user id, then orgs, with the aal2 token', async () => {
    const r = await run();
    const headers = {
      apikey: KEY,
      Authorization: `Bearer ${AAL2_TOKEN}`,
      Accept: 'application/json',
    };
    const memberships = r.calls[4];
    expect(memberships.method).toBe('GET');
    expect(memberships.url).toBe(
      `${ORIGIN}/rest/v1/memberships?select=id,org_id&user_id=eq.${USER_ID}`,
    );
    expect(memberships.headers).toEqual(headers);
    const orgs = r.calls[5];
    expect(orgs.method).toBe('GET');
    expect(orgs.url).toBe(`${ORIGIN}/rest/v1/orgs?select=id`);
    expect(orgs.headers).toEqual(headers);
  });

  it('5: logout with the aal2 token', async () => {
    const c = (await run()).calls[6];
    expect(c.url).toBe(`${ORIGIN}/auth/v1/logout`);
    expect(c.method).toBe('POST');
    expect(c.headers.Authorization).toBe(`Bearer ${AAL2_TOKEN}`);
    expect(c.headers.apikey).toBe(KEY);
  });

  it('6: the recruiter Pages project, no credentials sent', async () => {
    const c = (await run()).calls[7];
    expect(c.url).toBe(PAGE_URL);
    expect(c.method).toBe('GET');
    expect(c.headers).toEqual({ Accept: 'text/html' });
  });

  it('accepts a trailing slash on the Supabase URL', async () => {
    const r = await run({ env: { ...ENV, SUPABASE_STAGING_URL: `${ORIGIN}/` } });
    expect(r.code).toBe(0);
    expect(r.calls[0].url).toBe(`${ORIGIN}/auth/v1/settings`);
  });

  it('accepts a connect-src that lists other origins too', async () => {
    const csp = `connect-src 'self' https://other.example.test ${ORIGIN}`;
    const r = await run({
      handlers: {
        'GET /': () =>
          new Response('', { status: 200, headers: { 'content-security-policy': csp } }),
      },
    });
    expect(r.code).toBe(0);
  });

  it('uses the one verified TOTP factor among unverified and non-TOTP ones', async () => {
    const factors = [
      { id: OTHER_FACTOR_ID, factor_type: 'totp', status: 'unverified' },
      { id: OTHER_FACTOR_ID, factor_type: 'phone', status: 'verified' },
      totpFactor(),
    ];
    const r = await run({
      handlers: {
        'POST /auth/v1/token': () => reply(200, { access_token: AAL1_TOKEN, user: user(factors) }),
      },
    });
    expect(r.code).toBe(0);
  });
});

describe('failure branches', () => {
  // [name, handlers, expected stderr line, requests made (keys), logout among them]
  const SETTINGS = 'GET /auth/v1/settings';
  const TOKEN = 'POST /auth/v1/token';
  const CHALLENGE = `POST /auth/v1/factors/${FACTOR_ID}/challenge`;
  const VERIFY = `POST /auth/v1/factors/${FACTOR_ID}/verify`;
  const MEMBERSHIPS = 'GET /rest/v1/memberships';
  const ORGS = 'GET /rest/v1/orgs';
  const LOGOUT = 'POST /auth/v1/logout';
  const PAGE = 'GET /';

  const cases = [
    [
      'settings HTTP 500',
      { [SETTINGS]: () => reply(500, { msg: BODY_MARKER }) },
      'auth settings failed (HTTP 500)',
      1,
    ],
    [
      'sign-ups enabled',
      { [SETTINGS]: () => reply(200, { disable_signup: false }) },
      'auth settings failed (unexpected response)',
      1,
    ],
    [
      'settings without the flag',
      { [SETTINGS]: () => reply(200, {}) },
      'auth settings failed (unexpected response)',
      1,
    ],
    [
      'settings network error',
      { [SETTINGS]: networkError },
      'auth settings failed (network error)',
      1,
    ],
    [
      'sign-in HTTP 400',
      { [TOKEN]: () => reply(400, { error_description: BODY_MARKER }) },
      'sign-in failed (HTTP 400)',
      2,
    ],
    ['sign-in network error', { [TOKEN]: networkError }, 'sign-in failed (network error)', 2],
    [
      'sign-in without a token',
      { [TOKEN]: () => reply(200, { user: user([totpFactor()]) }) },
      'sign-in failed (unexpected response)',
      2,
    ],
    [
      'sign-in with a non-UUID user id',
      {
        [TOKEN]: () =>
          reply(200, {
            access_token: AAL1_TOKEN,
            user: { id: 'not-a-uuid', factors: [totpFactor()] },
          }),
      },
      'sign-in failed (unexpected response)',
      2,
    ],
    [
      'no factors',
      { [TOKEN]: () => reply(200, { access_token: AAL1_TOKEN, user: user([]) }) },
      'TOTP factor failed (unexpected response)',
      2,
    ],
    [
      'only an unverified factor',
      {
        [TOKEN]: () =>
          reply(200, {
            access_token: AAL1_TOKEN,
            user: user([totpFactor(FACTOR_ID, 'unverified')]),
          }),
      },
      'TOTP factor failed (unexpected response)',
      2,
    ],
    [
      'two verified factors',
      {
        [TOKEN]: () =>
          reply(200, {
            access_token: AAL1_TOKEN,
            user: user([totpFactor(), totpFactor(OTHER_FACTOR_ID)]),
          }),
      },
      'TOTP factor failed (unexpected response)',
      2,
    ],
    [
      'challenge HTTP 422',
      { [CHALLENGE]: () => reply(422, { msg: BODY_MARKER }) },
      'TOTP challenge failed (HTTP 422)',
      3,
    ],
    [
      'challenge without an id',
      { [CHALLENGE]: () => reply(200, {}) },
      'TOTP challenge failed (unexpected response)',
      3,
    ],
    [
      'challenge network error',
      { [CHALLENGE]: networkError },
      'TOTP challenge failed (network error)',
      3,
    ],
    [
      'verify HTTP 400',
      { [VERIFY]: () => reply(400, { msg: BODY_MARKER }) },
      'TOTP verification failed (HTTP 400)',
      4,
    ],
    [
      'verify without a token',
      { [VERIFY]: () => reply(200, {}) },
      'TOTP verification failed (unexpected response)',
      4,
    ],
    [
      'verify token is not a JWT',
      { [VERIFY]: () => reply(200, { access_token: 'not-a-jwt' }) },
      'TOTP verification failed (unexpected response)',
      4,
    ],
    [
      'verify token is aal1',
      { [VERIFY]: () => reply(200, { access_token: AAL1_TOKEN }) },
      'TOTP verification failed (unexpected response)',
      4,
    ],
    [
      'verify token has another sub',
      { [VERIFY]: () => reply(200, { access_token: WRONG_SUB_TOKEN }) },
      'TOTP verification failed (unexpected response)',
      4,
    ],
  ];

  // Failures before a session exists (no sign-in token): nothing to sign out.
  const NO_SESSION = new Set([
    'settings HTTP 500',
    'sign-ups enabled',
    'settings without the flag',
    'settings network error',
    'sign-in HTTP 400',
    'sign-in network error',
    'sign-in without a token',
  ]);
  const noSession = cases.filter(([name]) => NO_SESSION.has(name));
  const withSession = cases.filter(([name]) => !NO_SESSION.has(name));
  // verify answers with a token that then fails the claim check: that token is the session
  const LATEST_TOKEN = {
    'verify token is not a JWT': 'not-a-jwt',
    'verify token is aal1': AAL1_TOKEN,
    'verify token has another sub': WRONG_SUB_TOKEN,
  };

  it.each(noSession)('%s: no session, no sign-out', async (_name, handlers, expected, requests) => {
    const r = await run({ handlers });
    expect(r.code).toBe(1);
    expect(r.err).toBe(`smoke-staging-auth: ${expected}\n`);
    expect(r.out).toBe('');
    expect(r.calls).toHaveLength(requests);
    expect(r.keys).not.toContain(LOGOUT);
    expectNoLeak(r);
  });

  // B4-SEC-1: once step 2 succeeded, whatever fails, the session is signed out with the latest token.
  it.each(withSession)(
    '%s: signs out with the latest token',
    async (name, handlers, expected, requests) => {
      const r = await run({ handlers });
      expect(r.code).toBe(1);
      expect(r.err).toBe(`smoke-staging-auth: ${expected}\n`);
      expect(r.out).toBe('');
      expect(r.calls).toHaveLength(requests + 1);
      expect(r.keys.filter((k) => k === LOGOUT)).toHaveLength(1);
      const last = r.calls.at(-1);
      expect(last.key).toBe(LOGOUT);
      expect(last.headers.Authorization).toBe(`Bearer ${LATEST_TOKEN[name] ?? AAL1_TOKEN}`);
      expect(last.headers.apikey).toBe(KEY);
      expectNoLeak(r);
    },
  );

  it('signs out when a fetch handler throws mid-flow', async () => {
    const r = await run({
      handlers: {
        [VERIFY]: () => {
          throw new Error(BODY_MARKER);
        },
      },
    });
    expect(r.code).toBe(1);
    expect(r.err).toBe('smoke-staging-auth: TOTP verification failed (network error)\n');
    expect(r.keys.at(-1)).toBe(LOGOUT);
    expect(r.calls.at(-1).headers.Authorization).toBe(`Bearer ${AAL1_TOKEN}`);
    expectNoLeak(r);
  });

  it('signs out when computing the TOTP code throws', async () => {
    // A clock that is not a number makes totp() throw after the challenge was issued.
    const r = await run({ now: () => Number.NaN });
    expect(r.code).toBe(1);
    expect(r.err).toBe('smoke-staging-auth: TOTP verification failed (unexpected response)\n');
    expect(r.keys.at(-1)).toBe(LOGOUT);
    expect(r.calls.at(-1).headers.Authorization).toBe(`Bearer ${AAL1_TOKEN}`);
    expectNoLeak(r);
  });

  it('signs out with the verify token when a later step throws', async () => {
    const r = await run({
      handlers: {
        [MEMBERSHIPS]: () => {
          throw new Error(BODY_MARKER);
        },
      },
    });
    expect(r.code).toBe(1);
    expect(r.err).toBe('smoke-staging-auth: memberships failed (network error)\n');
    expect(r.calls.at(-1).key).toBe(LOGOUT);
    expect(r.calls.at(-1).headers.Authorization).toBe(`Bearer ${AAL2_TOKEN}`);
    expectNoLeak(r);
  });

  const rowCases = [
    [
      'memberships HTTP 403',
      { [MEMBERSHIPS]: () => reply(403, { msg: BODY_MARKER }) },
      'memberships failed (HTTP 403)',
    ],
    [
      'memberships network error',
      { [MEMBERSHIPS]: networkError },
      'memberships failed (network error)',
    ],
    [
      'memberships 0 rows',
      { [MEMBERSHIPS]: () => reply(200, []) },
      'memberships failed (unexpected response)',
    ],
    [
      'memberships 2 rows',
      {
        [MEMBERSHIPS]: () =>
          reply(200, [
            { id: MEMBERSHIP_ID, org_id: ORG_ID },
            { id: OTHER_ID, org_id: ORG_ID },
          ]),
      },
      'memberships failed (unexpected response)',
    ],
    [
      'memberships row without an org',
      { [MEMBERSHIPS]: () => reply(200, [{ id: MEMBERSHIP_ID }]) },
      'memberships failed (unexpected response)',
    ],
    [
      'memberships not an array',
      { [MEMBERSHIPS]: () => reply(200, { code: BODY_MARKER }) },
      'memberships failed (unexpected response)',
    ],
    ['orgs HTTP 500', { [ORGS]: () => reply(500, { msg: BODY_MARKER }) }, 'orgs failed (HTTP 500)'],
    ['orgs 0 rows', { [ORGS]: () => reply(200, []) }, 'orgs failed (unexpected response)'],
    [
      'orgs 2 rows',
      { [ORGS]: () => reply(200, [{ id: ORG_ID }, { id: OTHER_ID }]) },
      'orgs failed (unexpected response)',
    ],
    [
      'orgs row is another org',
      { [ORGS]: () => reply(200, [{ id: OTHER_ID }]) },
      'orgs failed (unexpected response)',
    ],
  ];

  it.each(rowCases)('%s still signs out, then reports it', async (_name, handlers, expected) => {
    const r = await run({ handlers });
    expect(r.code).toBe(1);
    expect(r.err).toBe(`smoke-staging-auth: ${expected}\n`);
    expect(r.keys.at(-1)).toBe(LOGOUT);
    expect(r.keys).not.toContain(PAGE);
    expect(r.calls.at(-1).headers.Authorization).toBe(`Bearer ${AAL2_TOKEN}`);
    expectNoLeak(r);
  });

  it('reports the step 4 failure first when the sign-out fails too', async () => {
    const r = await run({
      handlers: {
        [MEMBERSHIPS]: () => reply(200, []),
        [LOGOUT]: () => reply(500, { msg: BODY_MARKER }),
      },
    });
    expect(r.code).toBe(1);
    expect(r.err).toBe(
      'smoke-staging-auth: memberships failed (unexpected response)\n' +
        'smoke-staging-auth: sign-out failed (HTTP 500)\n',
    );
    expectNoLeak(r);
  });

  it('a failed sign-out fails the run before the page check', async () => {
    const r = await run({ handlers: { [LOGOUT]: () => reply(500, { msg: BODY_MARKER }) } });
    expect(r.code).toBe(1);
    expect(r.err).toBe('smoke-staging-auth: sign-out failed (HTTP 500)\n');
    expect(r.keys).not.toContain(PAGE);
    expectNoLeak(r);
  });

  it('a sign-out network error fails the run', async () => {
    const r = await run({ handlers: { [LOGOUT]: networkError } });
    expect(r.code).toBe(1);
    expect(r.err).toBe('smoke-staging-auth: sign-out failed (network error)\n');
    expectNoLeak(r);
  });

  const pageCases = [
    [
      'the page is HTTP 404',
      { [PAGE]: () => new Response('missing', { status: 404 }) },
      'recruiter page failed (HTTP 404)',
    ],
    [
      'the page is a redirect error',
      { [PAGE]: networkError },
      'recruiter page failed (network error)',
    ],
    [
      'the page has no CSP',
      { [PAGE]: () => new Response('', { status: 200 }) },
      'recruiter page failed (unexpected response)',
    ],
    [
      'the CSP has no connect-src',
      {
        [PAGE]: () =>
          new Response('', {
            status: 200,
            headers: { 'content-security-policy': "default-src 'self'" },
          }),
      },
      'recruiter page failed (unexpected response)',
    ],
    [
      'connect-src lacks the origin',
      {
        [PAGE]: () =>
          new Response('', {
            status: 200,
            headers: { 'content-security-policy': "connect-src 'self'" },
          }),
      },
      'recruiter page failed (unexpected response)',
    ],
    [
      'another directive names the origin',
      {
        [PAGE]: () =>
          new Response('', {
            status: 200,
            headers: { 'content-security-policy': `connect-src 'self'; img-src ${ORIGIN}` },
          }),
      },
      'recruiter page failed (unexpected response)',
    ],
    [
      'connect-src names another project',
      {
        [PAGE]: () =>
          new Response('', {
            status: 200,
            headers: {
              'content-security-policy': `connect-src 'self' https://zzzzzzzzzz0123456789.supabase.co`,
            },
          }),
      },
      'recruiter page failed (unexpected response)',
    ],
  ];

  it.each(pageCases)('%s', async (_name, handlers, expected) => {
    const r = await run({ handlers });
    expect(r.code).toBe(1);
    expect(r.err).toBe(`smoke-staging-auth: ${expected}\n`);
    expect(r.out).toBe('');
    expect(r.keys.at(-1)).toBe(PAGE);
    expect(r.keys).toContain(LOGOUT);
    expectNoLeak(r);
  });
});

describe('arguments and environment', () => {
  it('an unknown argument is exit 2 and no request is made', async () => {
    const r = await run({ argv: ['--verbose'] });
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
    expect(r.err).toBe('smoke-staging-auth: takes no arguments\n');
    expect(r.err).not.toContain('verbose');
  });

  it.each(Object.keys(ENV))('names %s when it is the missing variable', async (name) => {
    const env = { ...ENV };
    delete env[name];
    const r = await run({ env });
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
    expect(r.err).toBe(`smoke-staging-auth: missing environment variable(s): ${name}\n`);
    expectNoLeak(r);
  });

  it('treats a blank variable as missing', async () => {
    const r = await run({ env: { ...ENV, STAGING_SMOKE_EMAIL: '   ' } });
    expect(r.code).toBe(2);
    expect(r.err).toBe(
      'smoke-staging-auth: missing environment variable(s): STAGING_SMOKE_EMAIL\n',
    );
  });

  it('lists every missing name and nothing else', async () => {
    const r = await run({ env: {} });
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
    expect(r.err).toBe(
      `smoke-staging-auth: missing environment variable(s): ${Object.keys(ENV).join(', ')}\n`,
    );
  });

  it.each([
    ['http', `http://${REF}.supabase.co`],
    ['a path', `${ORIGIN}/auth/v1`],
    ['a query', `${ORIGIN}?x=1`],
    ['a port', `${ORIGIN}:443`],
    ['credentials', `https://user:pw@${REF}.supabase.co`],
    ['another domain', `https://${REF}.supabase.com`],
    ['a subdomain', `https://x.${REF}.supabase.co`],
    ['an uppercase ref', `https://${REF.toUpperCase()}.supabase.co`],
    ['a 19-character ref', `https://${REF.slice(1)}.supabase.co`],
    ['a 21-character ref', `https://${REF}a.supabase.co`],
    ['a ref with a dash', `https://${REF.slice(1)}-.supabase.co`],
    ['an unrelated host', 'https://staging.example.test'],
    ['no scheme', `${REF}.supabase.co`],
  ])('rejects a Supabase URL with %s without echoing it', async (_name, url) => {
    const r = await run({ env: { ...ENV, SUPABASE_STAGING_URL: url } });
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
    expect(r.err).toBe(
      'smoke-staging-auth: SUPABASE_STAGING_URL must be https://<20-character project ref>.supabase.co\n',
    );
    expect(r.err).not.toContain(url);
    expectNoLeak(r);
  });

  it.each([
    ['an sb_secret_ key', () => `sb_secret_${enc('synthetic-secret-key-marker')}`],
    ['a JWT-shaped key', () => jwt({ role: 'anon', marker: enc('synthetic-anon') })],
    ['a too-short publishable key', () => 'sb_publishable_short'],
    ['a key with a stray character', () => `${KEY}!`],
    ['a key with an inner space', () => `${KEY.slice(0, 20)} ${KEY.slice(20)}`],
  ])('rejects %s without echoing it', async (_name, make) => {
    const key = make();
    const r = await run({ env: { ...ENV, SUPABASE_STAGING_PUBLISHABLE_KEY: key } });
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
    expect(r.err).toBe(
      'smoke-staging-auth: SUPABASE_STAGING_PUBLISHABLE_KEY must be an sb_publishable_ key\n',
    );
    expect(r.err).not.toContain(key);
    expectNoLeak(r);
  });

  it.each([
    ['lower case', TOTP_SECRET.toLowerCase()],
    ['too short', TOTP_SECRET.slice(0, 15)],
    ['outside the base32 alphabet', `${TOTP_SECRET.slice(0, 20)}1`],
    ['padded', `${TOTP_SECRET}====`],
    ['spaced', `${TOTP_SECRET.slice(0, 8)} ${TOTP_SECRET.slice(8)}`],
    ['too long', 'A'.repeat(129)],
  ])('rejects a TOTP secret that is %s without echoing it', async (_name, secret) => {
    const r = await run({ env: { ...ENV, STAGING_SMOKE_TOTP_SECRET: secret } });
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
    expect(r.err).toBe('smoke-staging-auth: STAGING_SMOKE_TOTP_SECRET must be a base32 secret\n');
    expect(r.err).not.toContain(secret);
    expectNoLeak(r);
  });
});
