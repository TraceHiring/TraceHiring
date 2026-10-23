// The Supabase Auth admin adapter of member provisioning (M1-20, E26, R5-12): one POST to /auth/v1/admin/users with the
// jobs secret key, outside any transaction; constant errors that never carry the address; https only (a loopback http
// URL for the local stack).
import { describe, expect, it } from 'vitest';
import {
  AUTH_ADMIN_FAILED,
  AUTH_ADMIN_UNAVAILABLE,
  AUTH_USER_EXISTS,
  createSupabaseAuthAdmin,
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

describe('createSupabaseAuthAdmin', () => {
  it('creates the user with the secret key and returns its id in lower case', async () => {
    const calls: Call[] = [];
    const admin = createSupabaseAuthAdmin({
      url: 'https://project.example.test',
      secretKey: KEY,
      fetch: fetchOf(200, { id: USER.toUpperCase(), email: EMAIL }, calls),
    });
    expect(await admin.ensureUser(EMAIL)).toBe(USER);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://project.example.test/auth/v1/admin/users');
    expect(calls[0]!.init.method).toBe('POST');
    const headers = new Headers(calls[0]!.init.headers);
    expect(headers.get('apikey')).toBe(KEY);
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ email: EMAIL, email_confirm: false });
  });

  it('allows plain http for a loopback host only (the local stack)', async () => {
    const ok = createSupabaseAuthAdmin({
      url: 'http://127.0.0.1:54321',
      secretKey: KEY,
      fetch: fetchOf(200, { id: USER }),
    });
    expect(await ok.ensureUser(EMAIL)).toBe(USER);
    const bad = createSupabaseAuthAdmin({
      url: 'http://project.example.test',
      secretKey: KEY,
      fetch: fetchOf(200, { id: USER }),
    });
    await expect(bad.ensureUser(EMAIL)).rejects.toThrow(AUTH_ADMIN_UNAVAILABLE);
  });

  it.each([
    ['no URL', { url: undefined, secretKey: KEY }],
    ['no key', { url: 'https://project.example.test', secretKey: undefined }],
    ['an empty key', { url: 'https://project.example.test', secretKey: '' }],
    ['a URL that does not parse', { url: 'not a url', secretKey: KEY }],
  ])('fails closed with %s and never calls fetch', async (_label, cfg) => {
    const calls: Call[] = [];
    const admin = createSupabaseAuthAdmin({ ...cfg, fetch: fetchOf(200, { id: USER }, calls) });
    await expect(admin.ensureUser(EMAIL)).rejects.toThrow(AUTH_ADMIN_UNAVAILABLE);
    expect(calls).toHaveLength(0);
  });

  it('E26: an address that already has a user is a constant error (resolved by the lead lookup, see report)', async () => {
    const admin = createSupabaseAuthAdmin({
      url: 'https://project.example.test',
      secretKey: KEY,
      fetch: fetchOf(422, { code: 422, error_code: 'email_exists', msg: `${EMAIL} exists` }),
    });
    const err = await admin.ensureUser(EMAIL).catch((e: unknown) => e as Error);
    expect((err as Error).message).toBe(AUTH_USER_EXISTS);
  });

  it.each([
    ['a server error', 500, { msg: `failed for ${EMAIL}` }],
    ['an answer without a user id', 200, { email: EMAIL }],
    ['an id that is not a uuid', 200, { id: EMAIL }],
  ])('throws a constant error on %s, never the address', async (_label, status, body) => {
    const admin = createSupabaseAuthAdmin({
      url: 'https://project.example.test',
      secretKey: KEY,
      fetch: fetchOf(status, body),
    });
    const err = await admin.ensureUser(EMAIL).catch((e: unknown) => e as Error);
    expect((err as Error).message).toBe(AUTH_ADMIN_FAILED);
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain('example.test');
  });

  it('a network error is the same constant error', async () => {
    const admin = createSupabaseAuthAdmin({
      url: 'https://project.example.test',
      secretKey: KEY,
      fetch: (() => Promise.reject(new Error(`dns ${EMAIL}`))) as typeof fetch,
    });
    const err = await admin.ensureUser(EMAIL).catch((e: unknown) => e as Error);
    expect((err as Error).message).toBe(AUTH_ADMIN_FAILED);
    expect((err as Error).cause).toBeUndefined();
  });
});
