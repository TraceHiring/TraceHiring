# `services/api` modules

`services/api` is a modular monolith on Cloudflare Workers (ADR-027). Each module lives in
`src/modules/<module>/`. M0a has no modules yet; this file records the rules they must follow.

- **Runtime-agnostic TypeScript.** No Node-only APIs in module code. `src/index.ts` is the thin
  Workers adapter; a later Node entrypoint is a new file, not a rewrite (ADR-027).
- **Quality and integrity never import each other.** Answer Quality and Integrity Signals are two
  separate results (CLAUDE.md rule 1). `quality/**` and `integrity/**` may not import each other,
  here or in `workers/jobs/src/` (spec `specs/m0-foundations.md` §10.1, enforced by ESLint
  boundaries). No code path combines the two, and an integrity decision never edits a quality score.
- **Allowed package imports:** `@trace/shared`, `@trace/vendors`, `@trace/db-types` only (§10.1).
- **Vendors behind interfaces.** Modules call `@trace/vendors` interfaces, never a vendor SDK
  directly (CLAUDE.md engineering rules).
- **Credentials come from the Worker's environment**, never from code or config in git. This
  service and `workers/jobs` are the only scripts that may ever be bound a database credential
  (ADR-027 service-role boundary); none is bound in M0a (spec §3 D6).
