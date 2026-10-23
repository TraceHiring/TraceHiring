// The Supabase Auth admin API as member provisioning needs it (specs/m1-test-authoring.md M1-20, §7 E26, R5-12): create
// the invitee's Auth user, outside any database transaction, with the jobs Worker's own secret key
// (SUPABASE_SECRET_KEY_JOBS; never in the browser or a Durable Object, CLAUDE.md). One call, POST
// /auth/v1/admin/users {email, email_confirm: false} (the shape scripts/ops/enrol-smoke-user.mjs uses; no password, no
// metadata: the display name stays in memberships). The invitee confirms the address when they first sign in.
// Errors are constants: a response body or a network error can echo the address, so neither is kept.
//
// E26 (an Auth user already exists for the address) cannot be resolved through this API without listing users; until a
// lookup exists (lead ask) that case throws AUTH_USER_EXISTS, the message is retried and the last try fails the invite.

export interface AuthAdmin {
  /** The Auth user id for `email`, creating the user when needed. Throws a constant error otherwise. */
  ensureUser(email: string): Promise<string>;
}

export const AUTH_ADMIN_UNAVAILABLE = 'auth_admin_unavailable';
export const AUTH_ADMIN_FAILED = 'auth_admin_failed';
export const AUTH_USER_EXISTS = 'auth_user_exists_unresolved';

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

export const createSupabaseAuthAdmin = (cfg: SupabaseAuthAdminConfig): AuthAdmin => ({
  ensureUser: async (email) => {
    const endpoint = endpointOf(cfg.url);
    const key = cfg.secretKey;
    if (endpoint === null || key === undefined || key === '') {
      throw new Error(AUTH_ADMIN_UNAVAILABLE);
    }
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
      throw new Error(AUTH_USER_EXISTS);
    }
    const id = field('id');
    if (!res.ok || typeof id !== 'string' || !UUID.test(id)) throw new Error(AUTH_ADMIN_FAILED);
    return id.toLowerCase();
  },
});
