// The recruiter app's Supabase client (specs/m0b-tenancy.md §2.7, AT-B11 "unconfigured build"):
// no client unless both build variables are set, and the exact auth options when they are.
import { describe, expect, it, vi } from 'vitest';
import {
  browserSessionStorage,
  CLIENT_AUTH_OPTIONS,
  createMemoryStorage,
  createRecruiterSupabase,
  readSupabaseConfig,
  type ClientStorage,
  type RecruiterSupabase,
} from './supabase-client';

/** A key-shaped string built at run time, so no literal key sits in the repo (gitleaks). */
const publishableKey = (): string => ['sb', 'publishable', 'synthetic', 'value'].join('_');
const HOSTED_URL = `https://${'abcdefghij'}${'klmnopqrst'}.supabase.co`;

function memoryStorage(): ClientStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
  };
}

describe('readSupabaseConfig', () => {
  it('is null when either build variable is unset or empty', () => {
    const key = publishableKey();
    expect(readSupabaseConfig({})).toBeNull();
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: HOSTED_URL })).toBeNull();
    expect(readSupabaseConfig({ VITE_SUPABASE_PUBLISHABLE_KEY: key })).toBeNull();
    expect(
      readSupabaseConfig({ VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: key }),
    ).toBeNull();
    expect(
      readSupabaseConfig({ VITE_SUPABASE_URL: HOSTED_URL, VITE_SUPABASE_PUBLISHABLE_KEY: '  ' }),
    ).toBeNull();
  });

  it('accepts an https URL, and plain http only for the local stack in a dev build (AT-M1-27)', () => {
    const key = publishableKey();
    expect(
      readSupabaseConfig({ VITE_SUPABASE_URL: HOSTED_URL, VITE_SUPABASE_PUBLISHABLE_KEY: key }),
    ).toEqual({ url: HOSTED_URL, publishableKey: key });
    expect(
      readSupabaseConfig({
        VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
        VITE_SUPABASE_PUBLISHABLE_KEY: key,
        traceEnv: 'dev',
      }),
    ).toEqual({ url: 'http://127.0.0.1:54321', publishableKey: key });
    expect(
      readSupabaseConfig({
        VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
        VITE_SUPABASE_PUBLISHABLE_KEY: key,
      }),
    ).toBeNull();
  });

  it('is null for a URL that is not https (or local http), so the build fails closed', () => {
    const key = publishableKey();
    for (const url of [
      'http://abcdefghijklmnopqrst.supabase.co',
      'not a url',
      'ftp://127.0.0.1',
      'javascript:alert(1)',
    ])
      expect(
        readSupabaseConfig({ VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key }),
        url,
      ).toBeNull();
  });
});

describe('createRecruiterSupabase', () => {
  it('creates no client when the build variables are unset', () => {
    const factory = vi.fn();
    expect(createRecruiterSupabase({}, memoryStorage(), factory)).toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  it('creates one client with persistSession on sessionStorage, auto refresh, no URL session, PKCE', () => {
    const storage = memoryStorage();
    const client = {} as RecruiterSupabase;
    const factory = vi.fn(() => client);
    const key = publishableKey();
    const created = createRecruiterSupabase(
      { VITE_SUPABASE_URL: HOSTED_URL, VITE_SUPABASE_PUBLISHABLE_KEY: key },
      storage,
      factory,
    );
    expect(created).toBe(client);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(HOSTED_URL, key, {
      auth: {
        persistSession: true,
        storage,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'pkce',
      },
    });
    const options = (factory.mock.calls[0] as unknown[])[2] as { auth: { storage: unknown } };
    expect(options.auth.storage).toBe(storage);
  });

  it('pins the auth options of spec §2.7', () => {
    expect(CLIENT_AUTH_OPTIONS).toEqual({
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    });
  });
});

describe('storage', () => {
  it('uses the browser sessionStorage when it is available', () => {
    const storage = createMemoryStorage() as unknown as Storage;
    expect(browserSessionStorage({ sessionStorage: storage })).toBe(storage);
  });

  it('falls back to memory when sessionStorage access throws (blocked storage)', () => {
    const source = {
      get sessionStorage(): Storage {
        throw new Error('blocked');
      },
    };
    const storage = browserSessionStorage(source);
    storage.setItem('a', '1');
    expect(storage.getItem('a')).toBe('1');
    storage.removeItem('a');
    expect(storage.getItem('a')).toBeNull();
    storage.setItem('b', '2');
    storage.clear();
    expect(storage.getItem('b')).toBeNull();
  });
});
