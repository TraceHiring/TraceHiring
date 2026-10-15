// D1 staging deploy guard (specs/d1-demo-slice.md §7.1; docs/reviews/D1-security-review-bindings.md
// F4): scripts/check-deploy-vars.mjs fails the deploy before any Worker is deployed when a public
// var is empty, or when CANDIDATE_TOKEN_PUBLIC_JWK is not valid JSON, has a key without `kid`, or has
// a key with a private member (`d`). All values here are synthetic; no violation may echo a value.
import { describe, expect, it } from 'vitest';
import { REQUIRED_VARS, checkDeployVars, main, parseJwkSet } from '../check-deploy-vars.mjs';

const PUBLIC_KEY = { kty: 'EC', crv: 'P-256', x: 'synthetic-x', y: 'synthetic-y' };
const key = (kid, extra = {}) => ({ ...PUBLIC_KEY, kid, ...extra });
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
// Built at run time so no JWT-shaped literal sits in the repository.
const jwt = (payload) => [b64url({ alg: 'HS256' }), b64url(payload), 'c2lnbmF0dXJl'].join('.');

const GOOD = () => ({
  CANDIDATE_TOKEN_KID: 'd1-2026-10',
  CANDIDATE_TOKEN_PUBLIC_JWK: JSON.stringify(key('d1-2026-10')),
  SUPABASE_STAGING_URL: 'https://example-ref.supabase.co',
  SUPABASE_STAGING_PUBLISHABLE_KEY: 'sb_publishable_synthetic',
});

describe('REQUIRED_VARS', () => {
  it('is the four values the deploy cannot work without', () => {
    expect([...REQUIRED_VARS]).toEqual([
      'CANDIDATE_TOKEN_KID',
      'CANDIDATE_TOKEN_PUBLIC_JWK',
      'SUPABASE_STAGING_URL',
      'SUPABASE_STAGING_PUBLISHABLE_KEY',
    ]);
    expect(Object.isFrozen(REQUIRED_VARS)).toBe(true);
  });
});

describe('parseJwkSet', () => {
  it('reads one JWK, a list of JWKs and a {keys} set', () => {
    expect(parseJwkSet(JSON.stringify(key('a')))).toEqual({ keys: [key('a')] });
    expect(parseJwkSet(JSON.stringify([key('a'), key('b')]))).toEqual({
      keys: [key('a'), key('b')],
    });
    expect(parseJwkSet(JSON.stringify({ keys: [key('a')] }))).toEqual({ keys: [key('a')] });
  });

  it.each([
    ['not JSON', 'not json'],
    ['a string', '"x"'],
    ['null', 'null'],
    ['a number', '1'],
    ['an empty list', '[]'],
    ['an empty set', '{"keys":[]}'],
    ['three keys', JSON.stringify([key('a'), key('b'), key('c')])],
    ['a list entry that is not an object', JSON.stringify([key('a'), 'x'])],
  ])('rejects %s', (_label, text) => {
    expect(parseJwkSet(text)).toHaveProperty('error');
  });
});

describe('checkDeployVars', () => {
  it('passes the synthetic good values', () => {
    expect(checkDeployVars(GOOD())).toEqual([]);
  });

  it('passes two keys during rotation when the kid names one of them', () => {
    const env = GOOD();
    env.CANDIDATE_TOKEN_PUBLIC_JWK = JSON.stringify([key('d1-2026-09'), key('d1-2026-10')]);
    expect(checkDeployVars(env)).toEqual([]);
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

  it('fails the single-key and {keys} forms with a d member too', () => {
    for (const text of [
      JSON.stringify(key('d1-2026-10', { d: 'x' })),
      JSON.stringify({ keys: [key('d1-2026-10', { d: 'x' })] }),
    ]) {
      const env = GOOD();
      env.CANDIDATE_TOKEN_PUBLIC_JWK = text;
      expect(checkDeployVars(env).join('\n')).toMatch(/private member "d"/);
    }
  });

  it.each(['p', 'q', 'dp', 'dq', 'qi', 'k'])('fails the private member %s', (member) => {
    const env = GOOD();
    env.CANDIDATE_TOKEN_PUBLIC_JWK = JSON.stringify(key('d1-2026-10', { [member]: 'x' }));
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
    env.CANDIDATE_TOKEN_PUBLIC_JWK = JSON.stringify(
      key('kid-secret-marker', { d: 'private-marker' }),
    );
    env.CANDIDATE_TOKEN_KID = 'other-kid-marker';
    env.SUPABASE_STAGING_URL = 'http://url-marker.example';
    const m = checkDeployVars(env).join('\n');
    expect(m).not.toMatch(/private-marker|url-marker|other-kid-marker|kid-secret-marker/);
  });

  it('reports every problem, not only the first', () => {
    expect(checkDeployVars({}).length).toBe(REQUIRED_VARS.length);
  });
});

describe('main', () => {
  it('exits 0 and says OK for good values', () => {
    const lines = [];
    expect(main({ env: GOOD(), out: (l) => lines.push(l), err: () => {} })).toBe(0);
    expect(lines.join('\n')).toMatch(/OK/);
  });

  it('exits 1 and prints each violation on stderr', () => {
    const env = GOOD();
    env.CANDIDATE_TOKEN_PUBLIC_JWK = JSON.stringify(key('d1-2026-10', { d: 'x' }));
    const errs = [];
    const outs = [];
    expect(main({ env, out: (l) => outs.push(l), err: (l) => errs.push(l) })).toBe(1);
    expect(errs.join('\n')).toMatch(/private member "d"/);
    expect(outs.join('\n')).not.toMatch(/OK/);
  });
});
