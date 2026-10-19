// One SQL session per stage (spec d1 §5.1; ADR-031; MT-14, L-29). Neutral, lead-wired code (rule 1): it knows
// no score, band or table. Each stage connects with its own login secret, runs BEGIN, `SET LOCAL ROLE` to its own
// NOLOGIN worker role (the login roles are granted `with inherit false, set true`, so nothing works before it),
// binds `trace.job_org_id` (private.job_org_id(), which every worker policy reads) and a server-generated
// `trace.request_id`, runs the stage on the injected SqlTx, then COMMIT. SQL text is constant; the role name comes
// from the fixed table below, never from input; values are bound parameters only. The URL never leaves this file.
import type { SqlParam, SqlTx } from '@trace/shared/jobs';
import postgres from 'postgres';

export type StageDbName = 'mirror' | 'quality' | 'integrity' | 'sweep';
type Secret = 'JOBS_MIRROR_DB_URL' | 'JOBS_QUALITY_DB_URL' | 'JOBS_INTEGRITY_DB_URL';
type WorkerRole = 'trace_worker' | 'trace_quality_worker' | 'trace_integrity_worker';

/** The login secret and worker role of each stage; no login role reaches two worker roles (MT-14). */
export const STAGE_DB: Readonly<Record<StageDbName, { secret: Secret; role: WorkerRole }>> =
  Object.freeze({
    mirror: { secret: 'JOBS_MIRROR_DB_URL', role: 'trace_worker' },
    quality: { secret: 'JOBS_QUALITY_DB_URL', role: 'trace_quality_worker' },
    integrity: { secret: 'JOBS_INTEGRITY_DB_URL', role: 'trace_integrity_worker' },
    // The sweep is neutral and runs as trace_worker (private.sweep_pending is EXECUTE to it only).
    sweep: { secret: 'JOBS_MIRROR_DB_URL', role: 'trace_worker' },
  });

const SET_ROLE_SQL: Readonly<Record<WorkerRole, string>> = Object.freeze({
  trace_worker: 'set local role trace_worker',
  trace_quality_worker: 'set local role trace_quality_worker',
  trace_integrity_worker: 'set local role trace_integrity_worker',
});

export const SET_CONTEXT_SQL =
  "select set_config('trace.job_org_id', $1, true), set_config('trace.request_id', $2, true)";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The driver surface a stage session needs: run `cb` inside BEGIN … COMMIT, rolling back if it throws. */
export type BeginTx = <T>(
  cb: (
    run: (text: string, params: readonly SqlParam[]) => Promise<readonly object[]>,
  ) => Promise<T>,
) => Promise<T>;

export interface StageDb {
  /** Runs `fn` in one transaction as the stage's worker role with `trace.job_org_id` = `orgId`. */
  withOrg<T>(orgId: string | null, fn: (tx: SqlTx) => Promise<T>): Promise<T>;
}

export const createStageDb = (
  stage: StageDbName,
  begin: BeginTx,
  newRequestId: () => string = () => crypto.randomUUID(),
): StageDb => ({
  withOrg: (orgId, fn) => {
    // Only the sweep reads across orgs (sweep_pending); every other stage is bound to one org.
    if (orgId === null ? stage !== 'sweep' : !UUID.test(orgId)) {
      return Promise.reject(new Error('bad_org'));
    }
    return begin(async (run) => {
      await run(SET_ROLE_SQL[STAGE_DB[stage].role], []);
      await run(SET_CONTEXT_SQL, [orgId ?? '', newRequestId()]);
      return fn({
        query: async <R extends object>(text: string, params: readonly SqlParam[] = []) =>
          (await run(text, params)) as R[],
      });
    });
  },
});

const LOCAL_DB_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const STRONG_SSLMODES = new Set(['require', 'verify-full']);

/**
 * The TLS mode for a jobs login (the rule of services/api apiDbSsl, security review R3 #1). A non-local host gets
 * `require` unless the URL asks for `verify-full`; a weak or unknown sslmode, a repeated one or any other query
 * parameter is refused (null). The local stack may run without TLS.
 */
export const jobsDbSsl = (url: string): 'require' | 'verify-full' | false | null => {
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

/** The constant error when a stage's login secret is missing or its TLS mode is refused. */
export const STAGE_DB_UNAVAILABLE = 'stage_db_unavailable';

/**
 * Runs `fn` on a fresh connection for one stage (one connection per stage, ADR-031) and always closes it. Throws
 * STAGE_DB_UNAVAILABLE (a retry, then the DLQ) when the secret is not bound or its TLS mode is refused.
 */
export const withStageConnection = async <T>(
  env: Env,
  stage: StageDbName,
  orgId: string | null,
  fn: (tx: SqlTx) => Promise<T>,
): Promise<T> => {
  const url = env[STAGE_DB[stage].secret];
  const ssl = url === undefined || url === '' ? null : jobsDbSsl(url);
  if (url === undefined || ssl === null) throw new Error(STAGE_DB_UNAVAILABLE);
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
  try {
    return await createStageDb(stage, begin).withOrg(orgId, fn);
  } finally {
    try {
      await sql.end({ timeout: 1 });
    } catch {
      // Closing never decides an outcome.
    }
  }
};
