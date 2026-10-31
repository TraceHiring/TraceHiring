// One SQL session per stage (spec d1 §5.1; ADR-031 and its amendment 1; MT-14, L-29). Neutral, lead-wired code
// (rule 1): it knows no score, band or table. Each stage connects with its own login (its Hyperdrive binding on
// staging, its URL secret on the local stack), runs BEGIN, `SET LOCAL ROLE` to its own
// NOLOGIN worker role (the login roles are granted `with inherit false, set true`, so nothing works before it),
// binds `trace.job_org_id` (private.job_org_id(), which every worker policy reads) and a server-generated
// `trace.request_id`, runs the stage on the injected SqlTx, then COMMIT. SQL text is constant; the role name comes
// from the fixed table below, never from input; values are bound parameters only. The connection string never leaves this file.
import type { SqlParam, SqlTx } from '@trace/shared/jobs';
import {
  cappedSocketOption,
  pgConnectionString,
  type ConnectFn,
} from '@trace/workers-http/pg-socket';
import { connect as cfConnect } from 'cloudflare:sockets';
import postgres from 'postgres';

export type StageDbName =
  | 'mirror'
  | 'quality'
  | 'integrity'
  | 'sweep'
  | 'authoring'
  | 'admin'
  | 'authoring_sweep'
  | 'messaging'
  | 'messaging_claim';
type Secret =
  | 'JOBS_MIRROR_DB_URL'
  | 'JOBS_QUALITY_DB_URL'
  | 'JOBS_INTEGRITY_DB_URL'
  | 'JOBS_AUTHORING_DB_URL'
  | 'JOBS_ADMIN_DB_URL'
  | 'JOBS_MESSAGING_DB_URL';
type Binding =
  | 'JOBS_MIRROR_DB'
  | 'JOBS_QUALITY_DB'
  | 'JOBS_INTEGRITY_DB'
  | 'JOBS_AUTHORING_DB'
  | 'JOBS_ADMIN_DB'
  | 'JOBS_MESSAGING_DB';
type WorkerRole =
  | 'trace_worker'
  | 'trace_quality_worker'
  | 'trace_integrity_worker'
  | 'trace_authoring_worker'
  | 'trace_admin_worker'
  | 'trace_messaging_worker';

/**
 * The login of each stage, as a Hyperdrive binding (staging) and a local-stack URL secret, and its worker role; no
 * login role reaches two worker roles (MT-14).
 */
export const STAGE_DB: Readonly<
  Record<StageDbName, { binding: Binding; secret: Secret; role: WorkerRole }>
> = Object.freeze({
  mirror: { binding: 'JOBS_MIRROR_DB', secret: 'JOBS_MIRROR_DB_URL', role: 'trace_worker' },
  quality: {
    binding: 'JOBS_QUALITY_DB',
    secret: 'JOBS_QUALITY_DB_URL',
    role: 'trace_quality_worker',
  },
  integrity: {
    binding: 'JOBS_INTEGRITY_DB',
    secret: 'JOBS_INTEGRITY_DB_URL',
    role: 'trace_integrity_worker',
  },
  // The sweep is neutral and runs as trace_worker (private.sweep_pending is EXECUTE to it only).
  sweep: { binding: 'JOBS_MIRROR_DB', secret: 'JOBS_MIRROR_DB_URL', role: 'trace_worker' },
  // M1 R5-11, R5-13: the AI drafting job (trace-authoring queue) and member provisioning (trace-admin queue).
  authoring: {
    binding: 'JOBS_AUTHORING_DB',
    secret: 'JOBS_AUTHORING_DB_URL',
    role: 'trace_authoring_worker',
  },
  admin: { binding: 'JOBS_ADMIN_DB', secret: 'JOBS_ADMIN_DB_URL', role: 'trace_admin_worker' },
  // R5-64 m: the stranded drafting-job sweep (private.fail_stranded_ai_draft_jobs is EXECUTE to the authoring worker
  // only) reads every org, on the authoring login.
  authoring_sweep: {
    binding: 'JOBS_AUTHORING_DB',
    secret: 'JOBS_AUTHORING_DB_URL',
    role: 'trace_authoring_worker',
  },
  // M2 R5-9: the trace-messages consumer (one org per message) and the cron claim stage (claim_due_messages and
  // close_due_drives read every org), both on the messaging login as trace_messaging_worker.
  messaging: {
    binding: 'JOBS_MESSAGING_DB',
    secret: 'JOBS_MESSAGING_DB_URL',
    role: 'trace_messaging_worker',
  },
  messaging_claim: {
    binding: 'JOBS_MESSAGING_DB',
    secret: 'JOBS_MESSAGING_DB_URL',
    role: 'trace_messaging_worker',
  },
});

const SET_ROLE_SQL: Readonly<Record<WorkerRole, string>> = Object.freeze({
  trace_worker: 'set local role trace_worker',
  trace_quality_worker: 'set local role trace_quality_worker',
  trace_integrity_worker: 'set local role trace_integrity_worker',
  trace_authoring_worker: 'set local role trace_authoring_worker',
  trace_admin_worker: 'set local role trace_admin_worker',
  trace_messaging_worker: 'set local role trace_messaging_worker',
});

export const SET_CONTEXT_SQL =
  "select set_config('trace.job_org_id', $1, true), set_config('trace.request_id', $2, true)";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The stages that may run without an org (`withOrg(null)`): each reads across orgs and returns ids only. */
const CROSS_ORG_STAGES: readonly StageDbName[] = ['sweep', 'authoring_sweep', 'messaging_claim'];

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
    // Only the two sweeps and the messaging claim read across orgs (sweep_pending, fail_stranded_ai_draft_jobs,
    // claim_due_messages and close_due_drives; M2 R5-9); every other stage is bound to one org.
    if (orgId === null ? !CROSS_ORG_STAGES.includes(stage) : !UUID.test(orgId)) {
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

/** The constant error when a stage has neither its Hyperdrive binding nor an allowed local URL. */
export const STAGE_DB_UNAVAILABLE = 'stage_db_unavailable';

/**
 * Runs `fn` on a fresh connection for one stage (one connection per stage, ADR-031) and always closes it. The stage
 * connects through its own Hyperdrive binding (staging) or, on the local stack only, its URL secret (ADR-031
 * amendment 1: a Worker never opens TLS to Postgres itself). Throws STAGE_DB_UNAVAILABLE (a retry, then the DLQ) when
 * neither is usable. Plain TCP (`ssl: false` wins over any sslmode in the string) and one TCP connection per stage
 * (cappedSocket), so a connect failure fails the stage at once instead of a reconnect loop.
 */
export const withStageConnection = async <T>(
  env: Env,
  stage: StageDbName,
  orgId: string | null,
  fn: (tx: SqlTx) => Promise<T>,
  connect: ConnectFn = cfConnect,
): Promise<T> => {
  const { binding, secret } = STAGE_DB[stage];
  const target = pgConnectionString(env[binding], env[secret]);
  if (target === null) throw new Error(STAGE_DB_UNAVAILABLE);
  const sql = postgres(target, {
    ssl: false,
    fetch_types: false,
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
    onnotice: () => {},
    ...cappedSocketOption(connect),
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
