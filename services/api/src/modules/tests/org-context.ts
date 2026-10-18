// Org-endpoint context (spec §6.2 "three DB paths", path 1; security review m4 R3-1). Neutral code shared by the
// org modules (tests, invitations, assignments, reports, media, outbox); the two card modules receive only the
// structural `CardSource` built here, never this file.
//
// - The caller's Supabase access token is verified here: signature against the project's JWKS (asymmetric keys,
//   ES256 or RS256; services/api holds no JWT secret), `iss` = `${SUPABASE_URL}/auth/v1`, `aud` includes
//   `authenticated`, `role` = `authenticated`, `exp`, and `aal` in {aal1, aal2}. `amr` becomes the `method` strings of
//   its objects, as private.membership_counts maps them.
// - Org reads and writes then go to PostgREST **as the caller** (the publishable key plus the caller's JWT), so RLS,
//   the audit actor and the aal rules apply; no service key exists here. supabase-js is not a dependency of this
//   Worker, so this is the same REST call over fetch.
// - Failures are constant codes; nothing echoes the token, a claim or a response body.
import { z } from 'zod';
import { base64UrlDecode, utf8 } from '../candidate/encoding.js';

export interface OrgCaller {
  userId: string;
  aal: 'aal1' | 'aal2';
  amr: string[];
  /** The raw access token, forwarded to PostgREST only. */
  jwt: string;
}

export type OrgErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'aal2_required'
  | 'not_found'
  | 'conflict'
  | 'cutoff_required'
  | 'draft_incomplete'
  | 'rate_limited'
  | 'internal'
  | 'unavailable';

export const ORG_ERROR_STATUS: Record<
  OrgErrorCode,
  400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503
> = {
  bad_request: 400,
  unauthorized: 401,
  aal2_required: 403,
  not_found: 404,
  conflict: 409,
  cutoff_required: 422,
  // Publish of a draft the guard trigger would refuse (no section, an empty section, an mcq item without a valid key,
  // a written item without a rubric).
  draft_incomplete: 422,
  rate_limited: 429,
  // Publish failed closed after the guarded UPDATE (spec §6.2: the rebuilt package hash differed; the version is
  // retired).
  internal: 500,
  unavailable: 503,
};

export class OrgError extends Error {
  readonly code: OrgErrorCode;
  readonly status: number;
  constructor(code: OrgErrorCode, status: number = ORG_ERROR_STATUS[code]) {
    super(code);
    this.name = 'OrgError';
    this.code = code;
    this.status = status;
  }
}

export const orgFail = (code: OrgErrorCode, status?: number): never => {
  throw new OrgError(code, status);
};

/** `{ error: { code } }` with no-store; never echoes input (§6.2). */
export const orgErrorResponse = (
  code: OrgErrorCode,
  status: number = ORG_ERROR_STATUS[code],
): Response =>
  new Response(JSON.stringify({ error: { code } }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

// ---- Supabase access-token verification ------------------------------------------------------------------------

const Jwk = z.looseObject({
  kty: z.enum(['EC', 'RSA']),
  kid: z.string().min(1).max(200),
  alg: z.enum(['ES256', 'RS256']).optional(),
  crv: z.string().optional(),
  x: z.string().optional(),
  y: z.string().optional(),
  n: z.string().optional(),
  e: z.string().optional(),
});
const Jwks = z.looseObject({ keys: z.array(z.unknown()).max(20) });

const Header = z.looseObject({ alg: z.enum(['ES256', 'RS256']), kid: z.string().min(1).max(200) });
const Claims = z.looseObject({
  sub: z.uuid(),
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  role: z.literal('authenticated'),
  exp: z.number().int(),
  aal: z.enum(['aal1', 'aal2']),
  amr: z.array(z.unknown()).max(20).optional(),
});

interface CachedKeys {
  at: number;
  keys: Map<string, { alg: 'ES256' | 'RS256'; key: CryptoKey }>;
}
const JWKS_TTL_MS = 10 * 60 * 1000;
const JWKS_REFETCH_MIN_MS = 30 * 1000;

const importJwk = async (raw: unknown) => {
  const jwk = Jwk.safeParse(raw);
  if (!jwk.success) return null;
  const k = jwk.data;
  try {
    if (k.kty === 'EC' && k.crv === 'P-256' && k.x !== undefined && k.y !== undefined) {
      const key = await crypto.subtle.importKey(
        'jwk',
        { kty: 'EC', crv: 'P-256', x: k.x, y: k.y },
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      );
      return { kid: k.kid, alg: 'ES256' as const, key };
    }
    if (k.kty === 'RSA' && k.n !== undefined && k.e !== undefined) {
      const key = await crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256' },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      return { kid: k.kid, alg: 'RS256' as const, key };
    }
  } catch {
    return null;
  }
  return null;
};

const decodePart = (part: string): unknown => {
  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(base64UrlDecode(part)),
    ) as unknown;
  } catch {
    return undefined;
  }
};

/** A fetch that never runs with a foreign `this` (workerd's global fetch refuses to be called as a method). */
export const unbound =
  (f: typeof fetch): typeof fetch =>
  (input, init) =>
    f(input, init);

export interface SupabaseVerifierOptions {
  supabaseUrl: string;
  fetch: typeof fetch;
  now?: () => number;
}

/** A verifier with its own JWKS cache (one per isolate in production; one per test otherwise). */
export const createSupabaseVerifier = (opts: SupabaseVerifierOptions) => {
  const base = opts.supabaseUrl.replace(/\/+$/, '');
  const issuer = `${base}/auth/v1`;
  // Called unbound, never as `opts.fetch(...)`: workerd's fetch throws "Illegal invocation" with a foreign `this`.
  const doFetch = unbound(opts.fetch);
  const now = opts.now ?? (() => Date.now());
  let cache: CachedKeys | null = null;
  let lastFetch = -Infinity;

  const load = async (force: boolean): Promise<CachedKeys | null> => {
    if (cache !== null && !force && now() - cache.at < JWKS_TTL_MS) return cache;
    if (force && now() - lastFetch < JWKS_REFETCH_MIN_MS) return cache;
    lastFetch = now();
    try {
      const res = await doFetch(`${issuer}/.well-known/jwks.json`, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return cache;
      const body = Jwks.safeParse(await res.json());
      if (!body.success) return cache;
      const keys = new Map<string, { alg: 'ES256' | 'RS256'; key: CryptoKey }>();
      for (const raw of body.data.keys) {
        const k = await importJwk(raw);
        if (k !== null) keys.set(k.kid, { alg: k.alg, key: k.key });
      }
      cache = { at: now(), keys };
      return cache;
    } catch {
      return cache;
    }
  };

  return async (authorization: string | undefined): Promise<OrgCaller> => {
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(
      authorization ?? '',
    );
    if (match === null || (match[1] ?? '').length > 8192) return orgFail('unauthorized');
    const jwt = match[1] ?? '';
    const [h, p, s] = jwt.split('.') as [string, string, string];
    const header = Header.safeParse(decodePart(h));
    if (!header.success) return orgFail('unauthorized');
    let keys = await load(false);
    let entry = keys?.keys.get(header.data.kid);
    if (entry === undefined) {
      keys = await load(true);
      entry = keys?.keys.get(header.data.kid);
    }
    if (keys === null) return orgFail('unavailable');
    if (entry === undefined || entry.alg !== header.data.alg) return orgFail('unauthorized');
    let signature: Uint8Array;
    try {
      signature = base64UrlDecode(s);
    } catch {
      return orgFail('unauthorized');
    }
    const algorithm =
      entry.alg === 'ES256' ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' };
    const ok = await crypto.subtle.verify(algorithm, entry.key, signature, utf8(`${h}.${p}`));
    if (!ok) return orgFail('unauthorized');
    const claims = Claims.safeParse(decodePart(p));
    if (!claims.success) return orgFail('unauthorized');
    const c = claims.data;
    const audOk = Array.isArray(c.aud)
      ? c.aud.includes('authenticated')
      : c.aud === 'authenticated';
    if (c.iss !== issuer || !audOk || c.exp * 1000 <= now()) return orgFail('unauthorized');
    const amr = (c.amr ?? []).flatMap((e) =>
      typeof e === 'object' && e !== null && typeof (e as { method?: unknown }).method === 'string'
        ? [(e as { method: string }).method]
        : [],
    );
    return { userId: c.sub, aal: c.aal, amr, jwt };
  };
};

// ---- PostgREST as the caller -----------------------------------------------------------------------------------

export type Query = Readonly<Record<string, string>>;

export interface Rest {
  select<T = Record<string, unknown>>(table: string, query: Query): Promise<T[]>;
  insert<T = Record<string, unknown>>(table: string, body: unknown, query?: Query): Promise<T[]>;
  update<T = Record<string, unknown>>(table: string, query: Query, patch: unknown): Promise<T[]>;
  remove<T = Record<string, unknown>>(table: string, query: Query): Promise<T[]>;
}

/** A PostgREST failure: the HTTP status and the Postgres SQLSTATE (when PostgREST names one); never its message. */
export class RestError extends Error {
  readonly status: number;
  readonly sqlstate: string | null;
  constructor(status: number, sqlstate: string | null) {
    super('rest_failed');
    this.name = 'RestError';
    this.status = status;
    this.sqlstate = sqlstate;
  }
}

const TABLE = /^[a-z_]{1,64}$/;

export interface RestOptions {
  supabaseUrl: string;
  publishableKey: string;
  fetch: typeof fetch;
}

export const createRest = (opts: RestOptions, caller: OrgCaller): Rest => {
  const base = `${opts.supabaseUrl.replace(/\/+$/, '')}/rest/v1`;
  const doFetch = unbound(opts.fetch);
  const call = async <T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    table: string,
    query: Query,
    body?: unknown,
  ): Promise<T[]> => {
    if (!TABLE.test(table)) throw new RestError(400, null);
    const qs = new URLSearchParams(query).toString();
    const headers: Record<string, string> = {
      apikey: opts.publishableKey,
      authorization: `Bearer ${caller.jwt}`,
      accept: 'application/json',
    };
    if (method !== 'GET') {
      headers['content-type'] = 'application/json';
      headers.prefer = 'return=representation';
    }
    let res: Response;
    try {
      res = await doFetch(`${base}/${table}${qs === '' ? '' : `?${qs}`}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new RestError(503, null);
    }
    if (!res.ok) {
      let sqlstate: string | null = null;
      try {
        const err = (await res.json()) as { code?: unknown };
        if (typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code)) sqlstate = err.code;
      } catch {
        // no body
      }
      throw new RestError(res.status, sqlstate);
    }
    const text = await res.text();
    if (text === '') return [];
    const parsed = JSON.parse(text) as unknown;
    return (Array.isArray(parsed) ? parsed : [parsed]) as T[];
  };
  return {
    select: (table, query) => call('GET', table, query),
    insert: (table, body, query = {}) => call('POST', table, query, body),
    update: (table, query, patch) => call('PATCH', table, query, patch),
    remove: (table, query) => call('DELETE', table, query),
  };
};

/** Maps a PostgREST or unexpected failure to an org error code (404 for anything the caller cannot see). */
export const restErrorCode = (err: unknown): OrgErrorCode => {
  if (err instanceof OrgError) return err.code;
  if (err instanceof RestError) {
    if (err.sqlstate === '23505') return 'conflict';
    // A foreign key or guard naming a parent the caller cannot see (a test or membership of another org).
    if (err.sqlstate === '23503') return 'not_found';
    if (
      err.sqlstate === '42501' ||
      err.status === 401 ||
      err.status === 403 ||
      err.status === 404
    ) {
      return 'not_found';
    }
    if (err.status === 400 || err.sqlstate === '22P02' || err.sqlstate === '23514')
      return 'bad_request';
    return 'unavailable';
  }
  return 'unavailable';
};

/**
 * Runs an org handler: an OrgError or RestError becomes its constant `{ error: { code } }` answer; anything else is a
 * bug and is rethrown to the app's error handler (redacted report, constant 500).
 */
export const handleOrg = async (fn: () => Promise<Response>): Promise<Response> => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof OrgError) return orgErrorResponse(err.code, err.status);
    if (err instanceof RestError) return orgErrorResponse(restErrorCode(err));
    throw err;
  }
};

/** A JSON answer with no-store. */
export const orgJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

// ---- Request context for the org modules -----------------------------------------------------------------------

export interface OrgContext {
  caller: OrgCaller;
  rest: Rest;
}

/** What every org module receives. Tests inject their own `context`. */
export interface OrgDeps {
  /** Verifies the request's bearer token and returns the caller and a PostgREST client acting as them. */
  context(request: Request, env: Env): Promise<OrgContext>;
}

/** The production OrgDeps: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY vars, the global fetch. Fails closed. */
export const createOrgDeps = (
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): OrgDeps => {
  const verifiers = new Map<string, ReturnType<typeof createSupabaseVerifier>>();
  return {
    async context(request, env) {
      const url = env.SUPABASE_URL;
      const key = env.SUPABASE_PUBLISHABLE_KEY;
      if (url === undefined || url === '' || key === undefined || key === '') {
        return orgFail('unavailable');
      }
      let verify = verifiers.get(url);
      if (verify === undefined) {
        verify = createSupabaseVerifier({ supabaseUrl: url, fetch: fetcher });
        verifiers.set(url, verify);
      }
      const caller = await verify(request.headers.get('authorization') ?? undefined);
      return {
        caller,
        rest: createRest({ supabaseUrl: url, publishableKey: key, fetch: fetcher }, caller),
      };
    },
  };
};

export const UuidParam = z.uuid();

/** Parses a path id; a malformed id is a 404 like any id the caller cannot see. */
export const pathId = (value: string | undefined): string => {
  const r = UuidParam.safeParse(value);
  return r.success ? r.data : orgFail('not_found');
};

/** `eq.<value>` for a PostgREST filter; values are ids or enum labels checked by the caller. */
export const eq = (value: string | number | boolean): string => `eq.${String(value)}`;

/**
 * The most rows one org list returns (D1 is demo scale; pagination is M2). PostgREST's `max_rows` would cut a longer
 * list silently (DB review r3 m-3), so a list read asks for `LIST_LIMIT` (one past the cap) and `capped` fails
 * closed with 503 `unavailable` instead of serving a cut list.
 */
export const MAX_LIST_ROWS = 500;
export const LIST_LIMIT = String(MAX_LIST_ROWS + 1);
export const capped = <T>(rows: T[]): T[] =>
  rows.length > MAX_LIST_ROWS ? orgFail('unavailable') : rows;

/** PostgREST `max_rows` (`supabase/config.toml` [api]): a read that returns this many rows may have been cut. */
export const PGRST_MAX_ROWS = 1000;

/** Ids per `in.(…)` filter, so a long id list never makes one oversized URL (as reports/read.ts). */
export const IN_CHUNK = 50;
export const chunks = (ids: readonly string[]): string[][] => {
  const unique = [...new Set(ids)];
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) out.push(unique.slice(i, i + IN_CHUNK));
  return out;
};

/**
 * The structural row source the two card modules take (they import no neutral module, rule 1 / L-19). It
 * authenticates the request and selects as the caller; any failure becomes a constant org error code.
 */
export interface CardSource {
  select(request: Request, env: Env, table: string, query: Query): Promise<unknown[]>;
}

export const cardSource = (deps: OrgDeps): CardSource => ({
  async select(request, env, table, query) {
    const ctx = await deps.context(request, env);
    try {
      return await ctx.rest.select(table, query);
    } catch (err) {
      return orgFail(restErrorCode(err));
    }
  },
});
