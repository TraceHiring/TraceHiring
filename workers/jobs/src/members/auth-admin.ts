// The Supabase Auth admin API as member provisioning needs it (specs/m1-test-authoring.md M1-20, §7 E26, R5-12,
// R5-61 a): the invitee's Auth user id, found or created outside any database transaction, with the jobs Worker's own
// secret key (SUPABASE_SECRET_KEY_JOBS; never in the browser or a Durable Object, CLAUDE.md).
//
// E26: the caller's lookup (private.auth_user_id_for_invite, which needs a pending invite in the job org but is not
// bound to that invite's address, so this worker could use it as an address lookup; accepted, since it already holds
// this Auth admin API: M1-REV-8, migration M1-v) runs first, and refuses when the invite is no longer pending, before
// any Auth call.
// Only on a miss does the adapter POST /auth/v1/admin/users {email, email_confirm: false} (the shape
// scripts/ops/enrol-smoke-user.mjs uses; no password, no metadata: the display name stays in memberships). A 422
// `email_exists` (the user was created meanwhile) looks up again; still nothing is a constant error, retried. So a try
// that died after creating the user is finished by the next with the same user.
//
// The request follows no redirect (`redirect: 'manual'`: the `apikey` header must never reach another origin; any
// non-2xx, a 3xx included, is AUTH_ADMIN_FAILED) and is aborted after AUTH_ADMIN_TIMEOUT_MS. Errors are constants: a
// response body or a network error can echo the address, so neither is kept.

/** The Auth user id holding the invited address, or null (the invite-bound database lookup). */
export type AuthUserLookup = () => Promise<string | null>;

export interface AuthAdmin {
  /**
   * The Auth user id for `email`: `lookup` first, the user created on a miss, `lookup` again on a 422 email_exists.
   * A lookup error propagates unchanged; anything else throws a constant error.
   */
  ensureUser(email: string, lookup: AuthUserLookup): Promise<string>;
}

export const AUTH_ADMIN_UNAVAILABLE = 'auth_admin_unavailable';
export const AUTH_ADMIN_FAILED = 'auth_admin_failed';
export const AUTH_USER_EXISTS = 'auth_user_exists_unresolved';

/** How long one Auth admin call may take. */
export const AUTH_ADMIN_TIMEOUT_MS = 10_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

export interface SupabaseAuthAdminConfig {
  /** The Supabase project URL (SUPABASE_URL): https, or http on a loopback host (the local stack). */
  url: string | undefined;
  secretKey: string | undefined;
  fetch?: typeof fetch;
}

const endpointOf = (url: string | undefined): string | null => {
  if (url === undefined || url === '') return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const ok =
    u.username === '' &&
    u.password === '' &&
    (u.protocol === 'https:' || (u.protocol === 'http:' && LOOPBACK.has(u.hostname)));
  return ok ? new URL('/auth/v1/admin/users', u.origin).toString() : null;
};

const asUserId = (id: string | null): string | null =>
  id !== null && UUID.test(id) ? id.toLowerCase() : null;

export const createSupabaseAuthAdmin = (cfg: SupabaseAuthAdminConfig): AuthAdmin => ({
  ensureUser: async (email, lookup) => {
    const endpoint = endpointOf(cfg.url);
    const key = cfg.secretKey;
    if (endpoint === null || key === undefined || key === '') {
      throw new Error(AUTH_ADMIN_UNAVAILABLE);
    }
    const found = asUserId(await lookup());
    if (found !== null) return found;

    const doFetch = cfg.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          apikey: key,
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ email, email_confirm: false }),
        redirect: 'manual',
        signal: AbortSignal.timeout(AUTH_ADMIN_TIMEOUT_MS),
      });
    } catch {
      throw new Error(AUTH_ADMIN_FAILED);
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    const field = (name: string): unknown =>
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>)[name]
        : undefined;
    if (res.status === 422 && field('error_code') === 'email_exists') {
      const existing = asUserId(await lookup());
      if (existing === null) throw new Error(AUTH_USER_EXISTS);
      return existing;
    }
    const id = field('id');
    if (res.status < 200 || res.status > 299 || typeof id !== 'string' || !UUID.test(id)) {
      throw new Error(AUTH_ADMIN_FAILED);
    }
    return id.toLowerCase();
  },
});
