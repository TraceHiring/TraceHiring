// D1 staging deploy guard (specs/d1-demo-slice.md §7.1; docs/reviews/D1-security-review-bindings.md
// F4): scripts/check-deploy-vars.mjs fails the deploy before any Worker is deployed when a public
// var is empty, or when CANDIDATE_TOKEN_PUBLIC_JWK is not valid JSON, is not a JSON array of one or two
// public JWKs with the current signing key (CANDIDATE_TOKEN_KID) first (lead decision 2026-10-16: the
// one shape the key script writes and the api/edge parsers accept), has a key without `kid`, or has a
// key with a private member (`d`). All values here are synthetic; no violation may echo a value.
import { describe, expect, it } from 'vitest';
import { REQUIRED_VARS, checkDeployVars, main, parseJwkSet } from '../check-deploy-vars.mjs';

const PUBLIC_KEY = { kty: 'EC', crv: 'P-256', x: 'synthetic-x', y: 'synthetic-y' };
const key = (kid, extra = {}) => ({ ...PUBLIC_KEY, kid, ...extra });
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
// Built at run time so no JWT-shaped literal sits in the repository.
const jwt = (payload) => [b64url({ alg: 'HS256' }), b64url(payload), 'c2lnbmF0dXJl'].join('.');

const GOOD = () => ({
  CANDIDATE_TOKEN_KID: 'd1-2026-10',
  CANDIDATE_TOKEN_PUBLIC_JWK: JSON.stringify([key('d1-2026-10')]),
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
    env.CANDIDATE_TOKEN_PUBLIC_JWK = JSON.stringify([key('d1-2026-10', { d: 'x' })]);
    const errs = [];
    const outs = [];
    expect(main({ env, out: (l) => outs.push(l), err: (l) => errs.push(l) })).toBe(1);
    expect(errs.join('\n')).toMatch(/private member "d"/);
    expect(outs.join('\n')).not.toMatch(/OK/);
  });
});
