// D1 staging deploy guard (specs/d1-demo-slice.md §7.1; docs/reviews/D1-security-review-bindings.md
// F4): scripts/check-deploy-vars.mjs fails the deploy before any Worker is deployed when a public
// var is empty, or when CANDIDATE_TOKEN_PUBLIC_JWK is not valid JSON, is not a JSON array of one or two
// public JWKs with the current signing key (CANDIDATE_TOKEN_KID) first (lead decision 2026-10-16: the
// one shape the key script writes and the api/edge parsers accept), has a key without `kid`, or has a
// key with a private member (`d`). All values here are synthetic; no violation may echo a value.
import { describe, expect, it } from 'vitest';
import {
  REQUIRED_VARS,
  checkDeployVars,
  loadWranglerConfigs,
  main,
  parseJwkSet,
} from '../check-deploy-vars.mjs';
import { PENDING_BINDINGS } from '../lib/hyperdrive.mjs';

const PUBLIC_KEY = {
  kty: 'EC',
  crv: 'P-256',
  x: 'synthetic-x',
  y: 'synthetic-y',
  alg: 'ES256',
  use: 'sig',
};
const key = (kid, extra = {}) => ({ ...PUBLIC_KEY, kid, ...extra });
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
// Built at run time so no JWT-shaped literal sits in the repository.
const jwt = (payload) => [b64url({ alg: 'HS256' }), b64url(payload), 'c2lnbmF0dXJl'].join('.');

// Synthetic Hyperdrive ids (ADR-031 amendment 1): the staging blocks of the three wrangler files as the deploy needs them.
const hid = (n) => n.toString(16).padStart(2, '0').repeat(16);
const GOOD_CONFIGS = () => ({
  edge: { env: { dev: {}, staging: {} } },
  api: { env: { dev: {}, staging: { hyperdrive: [{ binding: 'API_DB', id: hid(1) }] } } },
  jobs: {
    env: {
      dev: {},
      staging: {
        hyperdrive: [
          { binding: 'JOBS_MIRROR_DB', id: hid(2) },
          { binding: 'JOBS_QUALITY_DB', id: hid(3) },
          { binding: 'JOBS_INTEGRITY_DB', id: hid(4) },
          // M1 R5-11 (DC-M1-6): the drafting and member provisioning logins.
          { binding: 'JOBS_AUTHORING_DB', id: hid(5) },
          { binding: 'JOBS_ADMIN_DB', id: hid(6) },
          // M2 R5-9: the messaging login.
          { binding: 'JOBS_MESSAGING_DB', id: hid(7) },
        ],
      },
    },
  },
});

const GOOD = () => ({
  CANDIDATE_TOKEN_KID: 'd1-2026-10',
  CANDIDATE_TOKEN_PUBLIC_JWK: JSON.stringify([key('d1-2026-10')]),
  SUPABASE_STAGING_URL: 'https://example-ref.supabase.co',
  SUPABASE_STAGING_PUBLISHABLE_KEY: 'sb_publishable_synthetic',
  API_STAGING_ORIGIN: 'https://trace-api-staging.abhayraj.workers.dev',
});

describe('REQUIRED_VARS', () => {
  it('is the five values the deploy cannot work without', () => {
    expect([...REQUIRED_VARS]).toEqual([
      'CANDIDATE_TOKEN_KID',
      'CANDIDATE_TOKEN_PUBLIC_JWK',
      'SUPABASE_STAGING_URL',
      'SUPABASE_STAGING_PUBLISHABLE_KEY',
      'API_STAGING_ORIGIN',
    ]);
    expect(Object.isFrozen(REQUIRED_VARS)).toBe(true);
  });
});

describe('parseJwkSet', () => {
  it('reads a JSON array of one JWK, or two during rotation, in order', () => {
    expect(parseJwkSet(JSON.stringify([key('a')]))).toEqual({ keys: [key('a')] });
    expect(parseJwkSet(JSON.stringify([key('a'), key('b')]))).toEqual({
      keys: [key('a'), key('b')],
    });
    expect(parseJwkSet(` [\n ${JSON.stringify(key('a'))}\n] `)).toEqual({ keys: [key('a')] });
  });

  it.each([
    ['not JSON', 'not json'],
    ['a string', '"x"'],
    ['null', 'null'],
    ['a number', '1'],
    ['an empty list', '[]'],
    ['three keys', JSON.stringify([key('a'), key('b'), key('c')])],
    ['a list entry that is not an object', JSON.stringify([key('a'), 'x'])],
    ['a list entry that is null', JSON.stringify([key('a'), null])],
    ['a list entry that is a list', JSON.stringify([[key('a')]])],
  ])('rejects %s', (_label, text) => {
    expect(parseJwkSet(text)).toHaveProperty('error');
  });

  // Lead decision 2026-10-16: one shape only. A bare JWK object and a {"keys":[...]} set are
  // refused, whatever they hold, with a message that names the shape and never the value.
  it.each([
    ['a bare JWK object', JSON.stringify(key('d1-2026-10'))],
    ['a {keys} set', JSON.stringify({ keys: [key('d1-2026-10')] })],
    ['an empty {keys} set', '{"keys":[]}'],
    ['an empty object', '{}'],
  ])('refuses %s: it must be a JSON array', (_label, text) => {
    const r = parseJwkSet(text);
    expect(r).toEqual({ error: expect.stringMatching(/must be a JSON array/) });
    expect(r.error).not.toMatch(/d1-2026-10|synthetic/);
  });
});

describe('checkDeployVars', () => {
  it('passes the synthetic good values', () => {
    expect(checkDeployVars(GOOD())).toEqual([]);
  });

  it('passes two keys during rotation when the kid names the first (current) one', () => {
    const env = GOOD();
    env.CANDIDATE_TOKEN_PUBLIC_JWK = JSON.stringify([key('d1-2026-10'), key('d1-2026-09')]);
    expect(checkDeployVars(env)).toEqual([]);
  });

  it('fails two keys when the kid names the second (previous) one: the signing key comes first', () => {
    const env = GOOD();
    env.CANDIDATE_TOKEN_PUBLIC_JWK = JSON.stringify([key('d1-2026-09'), key('d1-2026-10')]);
    const m = checkDeployVars(env).join('\n');
    expect(m).toMatch(/CANDIDATE_TOKEN_KID: .*first/);
    expect(m).not.toMatch(/d1-2026-09|d1-2026-10/);
  });

  it.each([
    ['a bare JWK object', () => JSON.stringify(key('d1-2026-10'))],
    ['a {keys} set', () => JSON.stringify({ keys: [key('d1-2026-10')] })],
  ])('fails %s, without printing it', (_label, text) => {
    const env = GOOD();
    env.CANDIDATE_TOKEN_PUBLIC_JWK = text();
    const m = checkDeployVars(env).join('\n');
    expect(m).toMatch(/CANDIDATE_TOKEN_PUBLIC_JWK: must be a JSON array/);
    expect(m).not.toMatch(/d1-2026-10|synthetic|EC|P-256/);
  });

  it.each(REQUIRED_VARS)('fails when %s is missing', (name) => {
    const env = GOOD();
    delete env[name];
    expect(checkDeployVars(env).join('\n')).toMatch(new RegExp(`${name}: .*empty`));
  });

  it.each(REQUIRED_VARS)('fails when %s is only whitespace', (name) => {
    const env = GOOD();
    env[name] = '  \n ';
    expect(checkDeployVars(env).join('\n')).toMatch(new RegExp(`${name}: .*empty`));
  });

  it('fails a JWK var that is not valid JSON', () => {
    const env = GOOD();
    env.CANDIDATE_TOKEN_PUBLIC_JWK = '{not json';
    expect(checkDeployVars(env).join('\n')).toMatch(/CANDIDATE_TOKEN_PUBLIC_JWK: .*JSON/);
  });

  it('fails a key without a kid, an empty kid and a non-string kid', () => {
    for (const bad of [{ ...PUBLIC_KEY }, key(''), key(7)]) {
      const env = GOOD();
      env.CANDIDATE_TOKEN_PUBLIC_JWK = JSON.stringify([key('d1-2026-10'), bad]);
      expect(checkDeployVars(env).join('\n')).toMatch(/CANDIDATE_TOKEN_PUBLIC_JWK: key 1 .*kid/);
    }
  });

  it('fails a key with a d member, whatever its value, in any position', () => {
    for (const d of ['synthetic-private', '', null, 0]) {
      const env = GOOD();
      env.CANDIDATE_TOKEN_PUBLIC_JWK = JSON.stringify([
        key('d1-2026-10'),
        key('d1-2026-09', { d }),
      ]);
      const m = checkDeployVars(env).join('\n');
      expect(m).toMatch(/CANDIDATE_TOKEN_PUBLIC_JWK: key 1 .*private member "d"/);
      expect(m).not.toMatch(/synthetic-private/);
    }
  });

  it('fails a d member on the first (signing) key too', () => {
    const env = GOOD();
    env.CANDIDATE_TOKEN_PUBLIC_JWK = JSON.stringify([key('d1-2026-10', { d: 'x' })]);
    expect(checkDeployVars(env).join('\n')).toMatch(/key 0 .*private member "d"/);
  });

  it('fails a bare object or a {keys} set even when it holds a private key (refused before reading it)', () => {
    for (const text of [
      JSON.stringify(key('d1-2026-10', { d: 'private-marker' })),
      JSON.stringify({ keys: [key('d1-2026-10', { d: 'private-marker' })] }),
    ]) {
      const env = GOOD();
      env.CANDIDATE_TOKEN_PUBLIC_JWK = text;
      const m = checkDeployVars(env).join('\n');
      expect(m).toMatch(/must be a JSON array/);
      expect(m).not.toMatch(/private-marker/);
    }
  });

  it.each(['p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'])('fails the private member %s', (member) => {
    const env = GOOD();
    env.CANDIDATE_TOKEN_PUBLIC_JWK = JSON.stringify([key('d1-2026-10', { [member]: 'x' })]);
    expect(checkDeployVars(env).join('\n')).toMatch(new RegExp(`private member "${member}"`));
  });

  it('fails two keys that share a kid', () => {
    const env = GOOD();
    env.CANDIDATE_TOKEN_PUBLIC_JWK = JSON.stringify([key('d1-2026-10'), key('d1-2026-10')]);
    expect(checkDeployVars(env).join('\n')).toMatch(/duplicate kid/);
  });

  it('fails when CANDIDATE_TOKEN_KID names no key in the JWK var', () => {
    const env = GOOD();
    env.CANDIDATE_TOKEN_KID = 'd1-2030-01';
    expect(checkDeployVars(env).join('\n')).toMatch(
      /CANDIDATE_TOKEN_KID: .*not .*CANDIDATE_TOKEN_PUBLIC_JWK/,
    );
  });

  it.each([
    ['http', 'http://example-ref.supabase.co'],
    ['not a URL', 'example-ref.supabase.co'],
  ])('fails a Supabase URL that is %s', (_label, url) => {
    const env = GOOD();
    env.SUPABASE_STAGING_URL = url;
    expect(checkDeployVars(env).join('\n')).toMatch(/SUPABASE_STAGING_URL: .*https/);
  });

  it('fails a service-role or secret key in the publishable-key var, without printing it', () => {
    for (const value of ['sb_secret_synthetic', jwt({ role: 'service_role' })]) {
      const env = GOOD();
      env.SUPABASE_STAGING_PUBLISHABLE_KEY = value;
      const m = checkDeployVars(env).join('\n');
      expect(m).toMatch(/SUPABASE_STAGING_PUBLISHABLE_KEY: .*(secret|service)/);
      expect(m).not.toContain(value);
    }
  });

  it('accepts a legacy anon JWT as the publishable key', () => {
    const env = GOOD();
    env.SUPABASE_STAGING_PUBLISHABLE_KEY = jwt({ role: 'anon' });
    expect(checkDeployVars(env)).toEqual([]);
  });

  it('never prints a value in any violation', () => {
    const env = GOOD();
    env.CANDIDATE_TOKEN_PUBLIC_JWK = JSON.stringify([
      key('kid-secret-marker', { d: 'private-marker' }),
    ]);
    env.CANDIDATE_TOKEN_KID = 'other-kid-marker';
    env.SUPABASE_STAGING_URL = 'http://url-marker.example';
    const m = checkDeployVars(env).join('\n');
    expect(m).not.toMatch(/private-marker|url-marker|other-kid-marker|kid-secret-marker/);
  });

  // Security review S3 (docs/reviews/D1-security-review-wave0-rest.md): an allow-list, not only a
  // deny-list of private members.
  it.each([
    ['a jku member', { jku: 'https://keys.example.test/jwks' }],
    ['an x5u member', { x5u: 'https://keys.example.test/cert' }],
    ['a nested private object', { priv: { d: 'private-marker' } }],
  ])('fails a key with %s (only kty, crv, x, y, kid, alg, use are allowed)', (_label, extra) => {
    const env = GOOD();
    env.CANDIDATE_TOKEN_PUBLIC_JWK = JSON.stringify([key('d1-2026-10', extra)]);
    const m = checkDeployVars(env).join('\n');
    expect(m).toMatch(/CANDIDATE_TOKEN_PUBLIC_JWK: key 0 has a member outside/);
    expect(m).not.toMatch(/private-marker|keys\.example/);
  });

  it.each([
    ['kty RSA', { kty: 'RSA' }],
    ['crv P-384', { crv: 'P-384' }],
    ['alg RS256', { alg: 'RS256' }],
    ['no alg', { alg: undefined }],
    ['use enc', { use: 'enc' }],
    ['an empty x', { x: '' }],
    ['a numeric y', { y: 7 }],
  ])('fails a key with %s (an ES256 P-256 signing key only)', (_label, extra) => {
    const env = GOOD();
    env.CANDIDATE_TOKEN_PUBLIC_JWK = JSON.stringify([key('d1-2026-10', extra)]);
    expect(checkDeployVars(env).join('\n')).toMatch(/key 0 is not an ES256 P-256 signing key/);
  });

  it.each(['a', 'd1-2026-13', 'd1-26-10', 'D1-2026-10'])(
    'fails the kid %s, which is not d1-YYYY-MM',
    (kid) => {
      const env = GOOD();
      env.CANDIDATE_TOKEN_KID = kid;
      env.CANDIDATE_TOKEN_PUBLIC_JWK = JSON.stringify([key(kid)]);
      const m = checkDeployVars(env).join('\n');
      expect(m).toMatch(/key 0 .*kid/);
      expect(m).toMatch(/CANDIDATE_TOKEN_KID: must be exactly d1-YYYY-MM/);
    },
  );

  it.each([' d1-2026-10', 'd1-2026-10 ', 'd1-2026-10\n'])(
    'fails a CANDIDATE_TOKEN_KID with surrounding whitespace (%j), which --var would deploy as is',
    (kid) => {
      const env = GOOD();
      env.CANDIDATE_TOKEN_KID = kid;
      expect(checkDeployVars(env).join('\n')).toMatch(
        /CANDIDATE_TOKEN_KID: must be exactly d1-YYYY-MM/,
      );
    },
  );

  // Security review S8: the recruiter build reads it; a wrong label would aim bearer traffic elsewhere.
  it.each([
    ['another account label', 'https://trace-api-staging.other.workers.dev'],
    ['http', 'http://trace-api-staging.abhayraj.workers.dev'],
    ['a trailing slash', 'https://trace-api-staging.abhayraj.workers.dev/'],
    ['the edge Worker', 'https://trace-edge-staging.abhayraj.workers.dev'],
  ])('fails an API_STAGING_ORIGIN that is %s, without printing it', (_label, value) => {
    const env = GOOD();
    env.API_STAGING_ORIGIN = value;
    const m = checkDeployVars(env).join('\n');
    expect(m).toMatch(/API_STAGING_ORIGIN: must be exactly/);
    expect(m).not.toContain(value);
  });

  it('reports every problem, not only the first', () => {
    expect(checkDeployVars({}).length).toBe(REQUIRED_VARS.length);
  });
});

// Security review INF-1 (M1 Wave 0): the deploy checks the public variables before the migrations (--vars) and
// the Hyperdrive bindings only after them (--hyperdrive), so migration M1-a's roles exist on staging before the
// deploy stops for the missing M1 config ids, and the founder can then create them.
describe('main: the two deploy steps (--vars, --hyperdrive)', () => {
  const d1Only = () => {
    const configs = GOOD_CONFIGS();
    configs.jobs.env.staging.hyperdrive = configs.jobs.env.staging.hyperdrive.slice(0, 3);
    return configs;
  };
  const runMain = (argv, env, configs) => {
    const errs = [];
    const outs = [];
    const code = main({
      argv,
      env,
      configs,
      out: (l) => outs.push(l),
      err: (l) => errs.push(l),
    });
    return { code, errs: errs.join('\n'), outs: outs.join('\n') };
  };

  it('--vars checks the public variables only: missing Hyperdrive ids do not fail it', () => {
    expect(runMain(['--vars'], GOOD(), d1Only()).code).toBe(0);
    const bad = runMain(['--vars'], { ...GOOD(), CANDIDATE_TOKEN_KID: '' }, GOOD_CONFIGS());
    expect(bad.code).toBe(1);
    expect(bad.errs).toMatch(/CANDIDATE_TOKEN_KID/);
    expect(bad.errs).not.toMatch(/hyperdrive/);
  });

  it('--hyperdrive checks the Hyperdrive bindings only: it needs no variable', () => {
    expect(runMain(['--hyperdrive'], {}, GOOD_CONFIGS()).code).toBe(0);
    const pending = runMain(['--hyperdrive'], {}, d1Only());
    expect(pending.code).toBe(1);
    expect(pending.errs).toMatch(/jobs: env.staging.hyperdrive must be exactly \[/);
    expect(pending.errs).not.toMatch(/CANDIDATE_TOKEN_KID/);
  });

  it('with no flag runs both checks (a local run)', () => {
    const r = runMain([], { ...GOOD(), CANDIDATE_TOKEN_KID: '' }, d1Only());
    expect(r.code).toBe(1);
    expect(r.errs).toMatch(/CANDIDATE_TOKEN_KID/);
    expect(r.errs).toMatch(/hyperdrive/);
  });

  it.each([[['--vars', '--hyperdrive']], [['--skip']], [['--vars', 'x']], [['vars']]])(
    'refuses the arguments %j with exit 2 and checks nothing',
    (argv) => {
      const r = runMain(argv, GOOD(), GOOD_CONFIGS());
      expect(r.code).toBe(2);
      expect(r.errs).toMatch(/use --vars or --hyperdrive/);
      expect(r.outs).not.toMatch(/OK/);
    },
  );
});

describe('main', () => {
  it('exits 0 and says OK for good values', () => {
    const lines = [];
    expect(
      main({ env: GOOD(), configs: GOOD_CONFIGS(), out: (l) => lines.push(l), err: () => {} }),
    ).toBe(0);
    expect(lines.join('\n')).toMatch(/OK/);
  });

  it('exits 1 and prints each violation on stderr', () => {
    const env = GOOD();
    env.CANDIDATE_TOKEN_PUBLIC_JWK = JSON.stringify([key('d1-2026-10', { d: 'x' })]);
    const errs = [];
    const outs = [];
    expect(main({ env, out: (l) => outs.push(l), err: (l) => errs.push(l) })).toBe(1);
    expect(errs.join('\n')).toMatch(/private member "d"/);
    expect(outs.join('\n')).not.toMatch(/OK/);
  });

  // ADR-031 amendment 1 (d1 revision 4o): the Workers reach staging Postgres only through their Hyperdrive bindings,
  // so a deploy without the four committed config ids fails here, before any migration or Worker deploy.
  it('exits 1 before anything is deployed when the staging Hyperdrive bindings are missing', () => {
    const configs = GOOD_CONFIGS();
    delete configs.jobs.env.staging.hyperdrive;
    const errs = [];
    expect(main({ env: GOOD(), configs, out: () => {}, err: (l) => errs.push(l) })).toBe(1);
    expect(errs.join('\n')).toMatch(
      /jobs: env.staging has no hyperdrive bindings \(JOBS_MIRROR_DB, JOBS_QUALITY_DB, JOBS_INTEGRITY_DB, JOBS_AUTHORING_DB, JOBS_ADMIN_DB, JOBS_MESSAGING_DB\)/,
    );
  });

  // M1 R5-11: the two M1 ids exist only after the founder runs staging-worker-secrets.mjs; until they are committed,
  // the deploy refuses (the repository's own bindings test accepts them as pending, the deploy never does).
  it('exits 1 when only the D1 Hyperdrive bindings are present (the M1 ids are required)', () => {
    const configs = GOOD_CONFIGS();
    configs.jobs.env.staging.hyperdrive = configs.jobs.env.staging.hyperdrive.slice(0, 3);
    const errs = [];
    expect(main({ env: GOOD(), configs, out: () => {}, err: (l) => errs.push(l) })).toBe(1);
    expect(errs.join('\n')).toMatch(
      /jobs: env.staging.hyperdrive must be exactly \[JOBS_MIRROR_DB, JOBS_QUALITY_DB, JOBS_INTEGRITY_DB, JOBS_AUTHORING_DB, JOBS_ADMIN_DB, JOBS_MESSAGING_DB\] in this order$/m,
    );
  });

  it('refuses the repository configs while any Hyperdrive binding is still pending', () => {
    const errs = [];
    const code = main({
      env: GOOD(),
      configs: loadWranglerConfigs(),
      out: () => {},
      err: (l) => errs.push(l),
    });
    if (PENDING_BINDINGS.length === 0) return;
    expect(code).toBe(1);
    expect(errs.join('\n')).toMatch(/jobs: env.staging.hyperdrive must be exactly \[/);
  });

  it('exits 1 on a malformed or shared Hyperdrive id, naming the binding only', () => {
    const configs = GOOD_CONFIGS();
    configs.api.env.staging.hyperdrive[0].id = 'not-an-id';
    configs.jobs.env.staging.hyperdrive[1].id = hid(2);
    const errs = [];
    expect(main({ env: GOOD(), configs, out: () => {}, err: (l) => errs.push(l) })).toBe(1);
    expect(errs.join('\n')).toMatch(/api: hyperdrive API_DB has no 32-character lower-case hex id/);
    expect(errs.join('\n')).toMatch(/jobs: hyperdrive JOBS_QUALITY_DB reuses another binding/);
    expect(errs.join('\n')).not.toMatch(/not-an-id/);
  });

  it('reads the three wrangler.jsonc files of the repository when no configs are given', () => {
    const configs = loadWranglerConfigs();
    expect(Object.keys(configs).sort()).toEqual(['api', 'edge', 'jobs']);
    expect(configs.api.env.staging.name).toBe('trace-api-staging');
  });
});
