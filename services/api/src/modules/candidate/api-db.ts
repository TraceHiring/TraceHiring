// The api's own database path (spec §3.3, §4.2, §6.2 path 2; ADR-031; security review m4 R3-2). Login role
// api_login over API_DB_URL; every unit of work is one transaction that first runs `set local role trace_api`, then
// sets `trace.api_org_id` (the org the api resolved from the token-hash lookup, a verified token or a checked path)
// and a server-generated `trace.request_id`, then the statements, then COMMIT. A caller gets a result only after the
// COMMIT succeeded. SQL text is constant; values are bound parameters only.
import postgres from 'postgres';

export type SqlParam = string | number | boolean | null;

/** One open transaction as trace_api. */
export interface SqlTx {
  query<R extends object = Record<string, unknown>>(
    text: string,
    params?: readonly SqlParam[],
  ): Promise<R[]>;
}

/** The only way module code reaches Postgres as trace_api. */
export interface ApiDb {
  /** Runs `fn` in one transaction as trace_api with `trace.api_org_id` = `orgId` (null: unset, nothing visible). */
  withOrg<T>(orgId: string | null, fn: (tx: SqlTx) => Promise<T>): Promise<T>;
}

/** The driver surface ApiDb needs: run `cb` inside BEGIN … COMMIT, rolling back if it throws. */
export type BeginTx = <T>(
  cb: (
    run: (text: string, params: readonly SqlParam[]) => Promise<readonly object[]>,
  ) => Promise<T>,
) => Promise<T>;

export const SET_ROLE_SQL = 'set local role trace_api';
export const SET_CONTEXT_SQL =
  "select set_config('trace.api_org_id', $1, true), set_config('trace.request_id', $2, true)";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const createApiDb = (
  begin: BeginTx,
  newRequestId: () => string = () => crypto.randomUUID(),
): ApiDb => ({
  withOrg: (orgId, fn) => {
    if (orgId !== null && !UUID.test(orgId)) return Promise.reject(new Error('bad_org'));
    return begin(async (run) => {
      await run(SET_ROLE_SQL, []);
      await run(SET_CONTEXT_SQL, [orgId ?? '', newRequestId()]);
      return fn({
        query: async <R extends object>(text: string, params: readonly SqlParam[] = []) =>
          (await run(text, params)) as R[],
      });
    });
  },
});

export interface ApiDbHandle {
  readonly db: ApiDb;
  /** Closes the connection; call it in `finally` (one connection per request, ADR-031). */
  close(): Promise<void>;
}

const LOCAL_DB_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const STRONG_SSLMODES = new Set(['require', 'verify-full']);

/**
 * The TLS mode for the trace_api connection (security review R3 #1, ADR-031; the rule of scripts/ops/lib.mjs
 * pgEnvOf, B0-SEC1). A non-local host gets `require` unless the URL asks for `verify-full`; a weak or unknown
 * sslmode (disable, allow, prefer, verify-ca, which postgres.js does not verify), a repeated one or any other query
 * parameter is refused (null). The local stack may run without TLS. The URL itself never leaves this function.
 */
export const apiDbSsl = (url: string): 'require' | 'verify-full' | false | null => {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if ((u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') || u.hostname === '')
    return null;
  const keys = [...u.searchParams.keys()];
  if (keys.some((k) => k !== 'sslmode') || u.searchParams.getAll('sslmode').length > 1) return null;
  const sslmode = u.searchParams.get('sslmode');
  if (LOCAL_DB_HOSTS.has(u.hostname.toLowerCase())) return false;
  if (sslmode === null) return 'require';
  return STRONG_SSLMODES.has(sslmode) ? (sslmode as 'require' | 'verify-full') : null;
};

/**
 * Opens the trace_api connection, or null when API_DB_URL is not bound or its TLS mode is refused (the caller answers
 * 503 `unavailable`). `ssl` is always passed explicitly, so the URL's sslmode cannot weaken it.
 */
export const openApiDb = (url: string | undefined): ApiDbHandle | null => {
  if (url === undefined || url === '') return null;
  const ssl = apiDbSsl(url);
  if (ssl === null) return null;
  const sql = postgres(url, {
    ssl,
    fetch_types: false,
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
    onnotice: () => {},
  });
  const begin: BeginTx = async (cb) =>
    (await sql.begin((t) =>
      cb(async (text, params) => (await t.unsafe(text, params as SqlParam[])) as readonly object[]),
    )) as Awaited<ReturnType<typeof cb>>;
  return {
    db: createApiDb(begin),
    close: async () => {
      try {
        await sql.end({ timeout: 1 });
      } catch {
        // Closing never decides an answer.
      }
    },
  };
};
