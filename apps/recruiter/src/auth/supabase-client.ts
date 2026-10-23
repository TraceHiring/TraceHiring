// The recruiter app's Supabase client (specs/m0b-tenancy.md §2.7, §4.2, §4.3).
// A client exists only when both build variables are set; otherwise the app shows the
// `unconfigured` state. The rest of the app sees only `RecruiterSupabase`, the narrow slice of
// supabase-js the sign-in flow calls, so tests inject a fake and never reach the network.
import { createClient } from '@supabase/supabase-js';

/**
 * The build's Trace environment, as main.tsx reads it from the build: plain http (loopback only) is
 * allowed only when it is exactly `dev` (e2e-local and the local stack), the same rule as the
 * headers plugin (d1 spec rev 4i). Unset, `staging`, `production` or anything else: https only
 * (M0b B2-SEC-1, M1 AT-M1-27).
 */
export interface BuildEnv {
  readonly traceEnv?: string | undefined;
}

/** The build variables this module reads (declared in vite-env.d.ts), plus the build environment. */
export interface SupabaseEnv extends BuildEnv {
  readonly VITE_SUPABASE_URL?: string | undefined;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string | undefined;
}

/** The api origin build variable (declared in vite-env.d.ts), plus the build environment. */
export interface ApiEnv extends BuildEnv {
  readonly VITE_API_ORIGIN?: string | undefined;
}

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

/** The part of `Storage` the app and supabase-js use (the browser passes `sessionStorage`). */
export interface ClientStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

/** A storage that lives only in memory: used when `sessionStorage` is unavailable. */
export function createMemoryStorage(): ClientStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
    clear: () => {
      items.clear();
    },
  };
}

/** The browser's `sessionStorage`, or memory when it is blocked (the session then ends on reload). */
export function browserSessionStorage(source: { readonly sessionStorage: Storage }): ClientStorage {
  try {
    return source.sessionStorage;
  } catch {
    return createMemoryStorage();
  }
}

/** Spec §2.7, exactly: the session lives in `sessionStorage` (passed as `storage`). */
export const CLIENT_AUTH_OPTIONS = {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: false,
  flowType: 'pkce',
} as const;

export interface ClientOptions {
  auth: typeof CLIENT_AUTH_OPTIONS & { storage: ClientStorage };
}

/** A supabase-js result. The error is opaque on purpose: its text is never read or shown. */
export interface Outcome<T> {
  data: T;
  error: unknown;
}

export interface SessionData {
  session: { user: { id: string } } | null;
}

export interface AssuranceData {
  currentLevel: string | null;
  /** The JWT's `amr`: supabase-js types it as entries or as bare method names. */
  currentAuthenticationMethods: readonly ({ method: string } | string)[];
}

export interface FactorsData {
  /** Verified TOTP factors only (supabase-js `listFactors().data.totp`). */
  totp: readonly { id: string }[];
}

export interface EnrolData {
  id: string;
  totp: { qr_code: string; secret: string };
}

/** One supabase-js auth event: its name (`SIGNED_OUT`, `TOKEN_REFRESHED`, …) and the session, if any. */
export type AuthEventListener = (event: string, session: { user: { id: string } } | null) => void;

/** What `onAuthStateChange` returns; `unsubscribe` stops the events. */
export interface AuthSubscription {
  data: { subscription: { unsubscribe(): void } };
}

/** A PostgREST read: `.from(table).select(columns)` filtered by `.eq` or `.in`. */
export interface RowSelect {
  eq(column: string, value: string): PromiseLike<Outcome<unknown[] | null>>;
  in(column: string, values: readonly string[]): PromiseLike<Outcome<unknown[] | null>>;
}

/** The supabase-js calls the recruiter sign-in flow makes (spec §4.2), and nothing else. */
export interface RecruiterSupabase {
  auth: {
    signInWithOtp(params: {
      email: string;
      options: { shouldCreateUser: false };
    }): Promise<Outcome<unknown>>;
    verifyOtp(params: { email: string; token: string; type: 'email' }): Promise<Outcome<unknown>>;
    signInWithPassword(params: { email: string; password: string }): Promise<Outcome<unknown>>;
    getSession(): Promise<Outcome<SessionData | null>>;
    signOut(): Promise<{ error: unknown }>;
    /** supabase-js auth events (M0b B2-SEC-4); the flow reads only the event name and whether a session exists. */
    onAuthStateChange(callback: AuthEventListener): AuthSubscription;
    mfa: {
      getAuthenticatorAssuranceLevel(): Promise<Outcome<AssuranceData | null>>;
      listFactors(): Promise<Outcome<FactorsData | null>>;
      enroll(params: { factorType: 'totp' }): Promise<Outcome<EnrolData | null>>;
      challengeAndVerify(params: { factorId: string; code: string }): Promise<Outcome<unknown>>;
    };
  };
  from(table: 'memberships' | 'orgs'): { select(columns: string): RowSelect };
}

export type ClientFactory = (
  url: string,
  publishableKey: string,
  options: ClientOptions,
) => RecruiterSupabase;

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

/** https, or plain http to the local stack's loopback host in a build whose environment is exactly `dev`. */
function allowedUrl(url: string, env: BuildEnv): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'https:') return true;
  return parsed.protocol === 'http:' && env.traceEnv === 'dev' && LOCAL_HOSTS.has(parsed.hostname);
}

/** Both variables set and non-blank, and the URL https (plain http only for the local stack in dev). */
export function readSupabaseConfig(env: SupabaseEnv): SupabaseConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim() ?? '';
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  if (url === '' || publishableKey === '') return null;
  return allowedUrl(url, env) ? { url, publishableKey } : null;
}

/** The api origin under the same rule as the Supabase URL; null (not configured) otherwise. */
export function readApiOrigin(env: ApiEnv): string | null {
  const origin = env.VITE_API_ORIGIN?.trim() ?? '';
  if (origin === '') return null;
  return allowedUrl(origin, env) ? origin : null;
}

/** supabase-js `createClient`, narrowed to the calls the app makes. */
export const createSupabaseClient: ClientFactory = (url, publishableKey, options) => {
  const client = createClient(url, publishableKey, options);
  return {
    auth: {
      signInWithOtp: (params) => client.auth.signInWithOtp(params),
      verifyOtp: (params) => client.auth.verifyOtp(params),
      signInWithPassword: (params) => client.auth.signInWithPassword(params),
      getSession: () => client.auth.getSession(),
      signOut: () => client.auth.signOut(),
      onAuthStateChange: (callback) =>
        client.auth.onAuthStateChange((event, session) => {
          callback(event, session);
        }),
      mfa: {
        getAuthenticatorAssuranceLevel: () => client.auth.mfa.getAuthenticatorAssuranceLevel(),
        listFactors: () => client.auth.mfa.listFactors(),
        enroll: (params) => client.auth.mfa.enroll(params),
        challengeAndVerify: (params) => client.auth.mfa.challengeAndVerify(params),
      },
    },
    from: (table) => ({
      select: (columns) => {
        const query = client.from(table).select(columns);
        return {
          eq: (column, value) => query.eq(column, value),
          in: (column, values) => query.in(column, values),
        };
      },
    }),
  };
};

/** The app's client, or null (state `unconfigured`) when the build variables are unset. */
export function createRecruiterSupabase(
  env: SupabaseEnv,
  storage: ClientStorage,
  factory: ClientFactory = createSupabaseClient,
): RecruiterSupabase | null {
  const config = readSupabaseConfig(env);
  if (config === null) return null;
  return factory(config.url, config.publishableKey, {
    auth: { ...CLIENT_AUTH_OPTIONS, storage },
  });
}
