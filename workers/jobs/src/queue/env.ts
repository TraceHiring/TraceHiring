// Hand-written Env augmentation for the workers/jobs secrets (security review bindings F6; spec §5.1, L-29). They
// are Worker secrets set by an operator, never vars and never in git, so `wrangler types` does not list them. Every
// one is optional: code guards each and fails closed (the stage throws a constant error and is retried), never `!`.
export {};

declare global {
  interface Env {
    /** Login role jobs_mirror_login; every use runs `SET LOCAL ROLE trace_worker` (mirror stage and sweep). */
    JOBS_MIRROR_DB_URL?: string;
    /** Login role jobs_quality_login; every use runs `SET LOCAL ROLE trace_quality_worker`. */
    JOBS_QUALITY_DB_URL?: string;
    /** Login role jobs_integrity_login; every use runs `SET LOCAL ROLE trace_integrity_worker`. */
    JOBS_INTEGRITY_DB_URL?: string;
  }
}
