# D1 CI deploy + jobs wiring — security review (2026-10-15)

- **Reviewed:** the jobs commit (`workers/jobs/src/{index,error-reporting}.ts`, `queue/{consumer,sweep,handlers}.ts`, tests; Sonnet writer `537d7d6`) and the CI commit (`.github/workflows/ci.yml`, `scripts/check-workflows.mjs`, new `scripts/check-deploy-vars.mjs` and `scripts/ensure-staging-resources.mjs`, tests; Sonnet writer `b0d2c8c`), both placed by the lead on `d1/integration`. Against spec §5.1, §7.1, §11, `D1-security-review-bindings.md` F4/F5 and the founder's 2026-10-15 answer (3) (manual `workflow_dispatch` staging deploy from `d1/**` and `milestone/**`).
- **Reviewer:** Opus `security-reviewer`, read-only (no API calls, no runs).

> **Update (lead, same day):** the CI commit was **reverted** (`2e679fc`) after this review: `scripts/test/deploy-staging-job.test.mjs` showed it replaced the scanned-bundle deploy (S3B-1: deploy exactly the `scan-dist`-checked `dist/index.js` with `--no-bundle`) by a re-bundling `wrangler deploy --env staging`, which neither the writer nor this review caught. The jobs commit stays. The CI rework must keep S3B-1 and pass the deploy-job tests; this review's L1/L2 still apply to it.
>
> **Correction (lead, 2026-10-16):** the revert reason above is wrong. `b0d2c8c` already deployed the scanned `dist/index.js` with `--no-bundle` for all three Workers; `deploy-staging-job.test.mjs` failed only because it still pinned the old step chain, `DEPLOY_IF` and env. The rework (`5a775e8` + `6640b42`) updates that test and adds S3B-1 rules to `check-workflows`; it was reviewed in `docs/reviews/D1-security-review-wave0-rest.md`.

## Verdict: PASS WITH NOTES (no Medium or above)
Clean: pull requests and forks cannot reach the deploy job; the token is `contents: read`; every action is SHA-pinned; no `${{ }}` inside `run:`; public values come only from `vars.*` and each secret only on the step that needs it; `check-deploy-vars` fails closed (empty value, bad JSON, missing/duplicate/unmatched `kid`, any private JWK member, non-https URL, a secret-shaped publishable key) and never prints a value; `ensure-staging-resources` only creates hard-coded `*-staging` resources with fixed argv and has no delete path; nothing addresses production. Jobs: constant event names and ids only in logs, invalid messages acked without payload, every stage failure retries (placeholder stages go retry → DLQ), the sweep checks the mirror's ids against the database row and fails closed on missing bindings.

## Findings and disposition
| ID | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| L1 | Low | Anyone with write access can push a `d1/x` branch with an edited ci.yml and dispatch it; the real gate is the `staging` environment branch policy (`main`, `d1/**`, `milestone/**`) | **Accepted** with the GitHub-Free known gap (build-notes §0, 2026-10-15 item 2): `staging` holds staging-scoped credentials only; add required reviewers on `staging` when a paid plan arrives |
| L2 | Low | A dispatch from `d1/**`/`milestone/**` applies migrations that are not on `main`; editing such a migration in place afterwards would leave staging on the old version without any drift report | **Rule (spec §11):** once a branch has been dispatched to staging, its migrations are frozen — fix forward with a new migration, never edit in place (as `check-migrations` already enforces for migrations on `main`) |

Not yet reviewable: the stage implementations (stream R2) — their real error texts (Postgres errors) need a logging review when they land. The placeholder stages and sweep fail every minute once staging is deployed before R2 (fail closed, noisy in Sentry).
