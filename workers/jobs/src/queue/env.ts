// Hand-written Env augmentation for the workers/jobs secrets (security review bindings F6; spec §5.1, L-29). They
// are Worker secrets set by an operator, never vars and never in git, so `wrangler types` does not list them. Every
// one is optional: code guards each and fails closed (the stage throws a constant error and is retried), never `!`.
export {};

declare global {
  interface Env {
    // Staging: one Hyperdrive binding per login role (wrangler.jsonc env.staging; ADR-031 amendment 1). Each wins
    // over the URL secret of the same login, which is for the local stack only (a loopback host; refused elsewhere).
    /** jobs_mirror_login through Hyperdrive (mirror stage and sweep). */
    JOBS_MIRROR_DB?: Hyperdrive;
    /** jobs_quality_login through Hyperdrive. */
    JOBS_QUALITY_DB?: Hyperdrive;
    /** jobs_integrity_login through Hyperdrive. */
    JOBS_INTEGRITY_DB?: Hyperdrive;
    // M1 R5-11 (DC-M1-6): bound in env.staging once the founder has created their configs (PENDING_BINDINGS in
    // scripts/lib/hyperdrive.mjs); until then absent, and their jobs fail closed.
    /** jobs_authoring_login through Hyperdrive (AI drafting job). */
    JOBS_AUTHORING_DB?: Hyperdrive;
    /** jobs_admin_login through Hyperdrive (member provisioning job). */
    JOBS_ADMIN_DB?: Hyperdrive;
    /** Login role jobs_mirror_login; every use runs `SET LOCAL ROLE trace_worker` (mirror stage and sweep). */
    JOBS_MIRROR_DB_URL?: string;
    /** Login role jobs_quality_login; every use runs `SET LOCAL ROLE trace_quality_worker`. */
    JOBS_QUALITY_DB_URL?: string;
    /** Login role jobs_integrity_login; every use runs `SET LOCAL ROLE trace_integrity_worker`. */
    JOBS_INTEGRITY_DB_URL?: string;
    /** Login role jobs_authoring_login; every use runs `SET LOCAL ROLE trace_authoring_worker`. Local only. */
    JOBS_AUTHORING_DB_URL?: string;
    /** Login role jobs_admin_login; every use runs `SET LOCAL ROLE trace_admin_worker`. Local only. */
    JOBS_ADMIN_DB_URL?: string;
  }
}
