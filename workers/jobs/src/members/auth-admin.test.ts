// The Supabase Auth admin adapter of member provisioning (M1-20, E26, R5-12, R5-61 a): the invite-bound lookup first
// (private.auth_user_id_for_invite, injected), then one POST to /auth/v1/admin/users with the jobs secret key only on a
// miss, outside any transaction, and on a 422 `email_exists` the lookup again; constant errors that never carry the
// address; https only (a loopback http URL for the local stack); no redirect is followed and the call times out.
import { describe, expect, it } from 'vitest';
import {
  AUTH_ADMIN_FAILED,
  AUTH_ADMIN_TIMEOUT_MS,
  AUTH_ADMIN_UNAVAILABLE,
  AUTH_USER_EXISTS,
  createSupabaseAuthAdmin,
  type AuthUserLookup,
} from './auth-admin.js';

const EMAIL = 'p-invitee@example.test';
const KEY = ['sb', 'secret', 'synthetic'].join('_');
const USER = '5b2d8f3e-9c47-4a6b-8e15-7d0a2c94b301';

interface Call {
  url: string;
  init: RequestInit;
}

const fetchOf = (status: number, body: unknown, calls: Call[] = []): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

/** A lookup that answers from `answers` in turn (the last answer repeats) and counts its calls. */
const lookupOf = (...answers: (string | null)[]): AuthUserLookup & { calls: number } => {
  const l = Object.assign(
    async () => {
      const a = answers[Math.min(l.calls, answers.length - 1)] ?? null;
      l.calls += 1;
      return a;
    },
    { calls: 0 },
  );
  return l;
};

const admin = (status: number, body: unknown, calls: Call[] = []) =>
  createSupabaseAuthAdmin({
    url: 'https://project.example.test',
    secretKey: KEY,
    fetch: fetchOf(status, body, calls),
  });

describe('createSupabaseAuthAdmin', () => {
  it('creates the user with the secret key on a lookup miss and returns its id in lower case', async () => {
    const calls: Call[] = [];
    const lookup = lookupOf(null);
    const a = admin(200, { id: USER.toUpperCase(), email: EMAIL }, calls);
    expect(await a.ensureUser(EMAIL, lookup)).toBe(USER);
    expect(lookup.calls).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://project.example.test/auth/v1/admin/users');
    expect(calls[0]!.init.method).toBe('POST');
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get('apikey')).toBe(KEY);
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ email: EMAIL, email_confirm: false });
  });

  it('E26: looks up first; a user found there is returned without any Auth call', async () => {
    const calls: Call[] = [];
    const lookup = lookupOf(USER);
    expect(await admin(200, { id: USER }, calls).ensureUser(EMAIL, lookup)).toBe(USER);
    expect(lookup.calls).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it('E26: on a 422 email_exists the existing id comes from the second lookup', async () => {
    const calls: Call[] = [];
    const lookup = lookupOf(null, USER);
    const a = admin(422, { code: 422, error_code: 'email_exists', msg: `${EMAIL} exists` }, calls);
    expect(await a.ensureUser(EMAIL, lookup)).toBe(USER);
    expect(lookup.calls).toBe(2);
    expect(calls).toHaveLength(1);
  });

  it('E26: a 422 whose second lookup still finds no user is a constant error (retried)', async () => {
    const lookup = lookupOf(null, null);
    const a = admin(422, { code: 422, error_code: 'email_exists', msg: `${EMAIL} exists` });
    const err = await a.ensureUser(EMAIL, lookup).catch((e: unknown) => e as Error);
    expect((err as Error).message).toBe(AUTH_USER_EXISTS);
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain('example.test');
  });

  it('a lookup refusal (the invite is no longer pending) propagates unchanged, before any Auth call', async () => {
    const calls: Call[] = [];
    const refusal = Object.assign(
      new Error('TRACE_GUARD: the invite is not pending in the job org'),
      { code: '42501' },
    );
    const a = admin(200, { id: USER }, calls);
    await expect(a.ensureUser(EMAIL, () => Promise.reject(refusal))).rejects.toBe(refusal);
    expect(calls).toHaveLength(0);
  });

  it('allows plain http for a loopback host only (the local stack)', async () => {
    const ok = createSupabaseAuthAdmin({
      url: 'http://127.0.0.1:54321',
      secretKey: KEY,
      fetch: fetchOf(200, { id: USER }),
    });
    expect(await ok.ensureUser(EMAIL, lookupOf(null))).toBe(USER);
    const bad = createSupabaseAuthAdmin({
      url: 'http://project.example.test',
      secretKey: KEY,
      fetch: fetchOf(200, { id: USER }),
    });
    await expect(bad.ensureUser(EMAIL, lookupOf(null))).rejects.toThrow(AUTH_ADMIN_UNAVAILABLE);
  });

  it.each([
    ['no URL', { url: undefined, secretKey: KEY }],
    ['no key', { url: 'https://project.example.test', secretKey: undefined }],
    ['an empty key', { url: 'https://project.example.test', secretKey: '' }],
    ['a URL that does not parse', { url: 'not a url', secretKey: KEY }],
  ])('fails closed with %s and never looks up or calls fetch', async (_label, cfg) => {
    const calls: Call[] = [];
    const lookup = lookupOf(USER);
    const a = createSupabaseAuthAdmin({ ...cfg, fetch: fetchOf(200, { id: USER }, calls) });
    await expect(a.ensureUser(EMAIL, lookup)).rejects.toThrow(AUTH_ADMIN_UNAVAILABLE);
    expect(calls).toHaveLength(0);
    expect(lookup.calls).toBe(0);
  });

  it('follows no redirect: the request says manual, and a 307 is a constant error', async () => {
    const calls: Call[] = [];
    const a = createSupabaseAuthAdmin({
      url: 'https://project.example.test',
      secretKey: KEY,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} });
        return new Response(null, {
          status: 307,
          headers: { location: 'https://elsewhere.example.test/auth/v1/admin/users' },
        });
      }) as typeof fetch,
    });
    const err = await a.ensureUser(EMAIL, lookupOf(null)).catch((e: unknown) => e as Error);
    expect((err as Error).message).toBe(AUTH_ADMIN_FAILED);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.redirect).toBe('manual');
  });

  it('bounds the request with a 10 s timeout signal', async () => {
    const calls: Call[] = [];
    await admin(200, { id: USER }, calls).ensureUser(EMAIL, lookupOf(null));
    expect(AUTH_ADMIN_TIMEOUT_MS).toBe(10_000);
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ['a server error', 500, { msg: `failed for ${EMAIL}` }],
    ['a 422 that is not email_exists', 422, { error_code: 'validation_failed', msg: EMAIL }],
    ['an answer without a user id', 200, { email: EMAIL }],
    ['an id that is not a uuid', 200, { id: EMAIL }],
  ])('throws a constant error on %s, never the address', async (_label, status, body) => {
    const err = await admin(status, body)
      .ensureUser(EMAIL, lookupOf(null))
      .catch((e: unknown) => e as Error);
    expect((err as Error).message).toBe(AUTH_ADMIN_FAILED);
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain('example.test');
  });

  it('a network error or a timeout is the same constant error', async () => {
    for (const thrown of [
      new Error(`dns ${EMAIL}`),
      new DOMException('timed out', 'TimeoutError'),
    ]) {
      const a = createSupabaseAuthAdmin({
        url: 'https://project.example.test',
        secretKey: KEY,
        fetch: (() => Promise.reject(thrown)) as typeof fetch,
      });
      const err = await a.ensureUser(EMAIL, lookupOf(null)).catch((e: unknown) => e as Error);
      expect((err as Error).message).toBe(AUTH_ADMIN_FAILED);
      expect((err as Error).cause).toBeUndefined();
    }
  });
});
