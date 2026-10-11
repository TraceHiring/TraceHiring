# M0a W-S3b review: `deploy-staging` job and staging scripts (first review, Opus)

Reviewer: `security-reviewer` agent (Opus), read-only, 2026-10-12. Diff: `git diff 522b234 91622ee` (branch `m0a/s3b-deploy`, writer commits `0fd08b7`, `5eceb1d`, `91622ee`). Wrangler line numbers refer to the installed 4.149.0 `wrangler-dist/cli.js`.

**Verdict: PASS WITH FINDINGS.** Nothing is Blocking or High. There are 2 Medium and 5 Low findings.

## What holds (verified)
- **Gate:** matches §7.2 exactly (`ci.yml:123-131`): `needs`, `if:`, `environment: staging`, `concurrency` without cancel-in-progress, and `permissions: contents: read`.
- **Workflow hygiene:**
  - checkout is SHA-pinned with `persist-credentials: false`;
  - no `pull_request_target` or `workflow_run`;
  - no job-level env, `container:` or `services:`.
- **Secrets:**
  - step-scoped: DB URL on steps 3–4, Cloudflare token on steps 5–7;
  - none on or before install/build, none interpolated into run text;
  - no `set -x`.
- **psql wrapper:**
  - one statement per check (`;` is banned, `gen-catalog-tests.mjs:268`);
  - a lone `COMMIT` makes the trailing `rollback` warn, which fails the run;
  - meta-commands are rejected (`staging-catalog-checks.mjs:60`);
  - no shell; the DB URL is removed from the child environment and redacted (whole URL, password raw and decoded, any `postgres://` URL).
- **Smoke:**
  - https only, on exact Worker / Pages hosts;
  - `redirect: 'manual'`;
  - bodies are never echoed.
- **Tests:** they pin each property, and the fixtures are synthetic.

## Findings
| # | Severity | Where | Problem | Fix |
| --- | --- | --- | --- | --- |
| S3B-1 | Medium | `ci.yml:168`; Workers `build` = `wrangler deploy --dry-run --outdir dist` | Step 5 re-bundles under `--env staging`, so the bytes deployed are not the bytes `scan-dist` scanned (AT-16 deferred part, plan risk 8). An `env.staging` `define`/`alias` would ship unscanned. | In the no-secret Build step, run `wrangler deploy --dry-run --env staging --outdir dist` per Worker. `scan-dist` scans that output. Step 5 deploys that file: `wrangler deploy dist/index.js --no-bundle --env staging` (flags: path 240107, `--no-bundle` 240144, `--outdir` 240149, `--dry-run` 240251). The job test asserts both. |
| S3B-2 | Medium | `smoke-staging.mjs:115-122, 163-166`; `ci.yml:186-192` | The smoke reads only the `pages-deploy` hash URL. If a pre-existing project's production branch is not `main`, the deploy is a Preview and the alias still serves the old build, yet AT-11 and AT-22-staging pass. | Require exactly one `pages-deploy-detailed` entry per project with `environment === 'production'` and `production_branch === 'main'`. Also smoke the `https://<project>.pages.dev` alias. Add a preview fixture that must fail. |
| S3B-3 | Low | `smoke-staging.mjs:206-214` | The 64 KiB body cap is checked only after `arrayBuffer()` has read everything. | Reject early on `content-length`. Otherwise stream with `getReader()` and `cancel()` at cap + 1. Test with an endless stream. |
| S3B-4 | Low | `staging-catalog-checks.mjs:31`, `smoke-staging.mjs:41`, `ci.yml:127` | The worst case (catalog 32 min, smoke ~25.6 min) exceeds `timeout-minutes: 30`, so the problem report is lost. A runaway query keeps running on staging after psql is killed. | Add `set local statement_timeout = '60s';` in `wrapCheck`, an overall smoke deadline (~6 min), and optionally step timeouts. |
| S3B-5 | Low | `ci.yml:123-129` | Concurrency serialises runs but does not order them, so an older commit can deploy after a newer one. | Add a guard step that reads the deployed version. Or accept as a residual and record it. |
| S3B-6 | Low | `staging-catalog-checks.mjs:146-157`; `ci.yml:150` | `sslmode` defaults to `prefer`, so TLS can be stripped on the path to staging Postgres. | Refuse a URL without `sslmode=require` / `verify-ca` / `verify-full` before spawning anything. H5 stores the secret with `sslmode=require` (or `verify-full`). |
| S3B-7 | Low | `smoke-staging.mjs:23` | This is the first `scripts/*.mjs` to import a `.ts` file under plain Node (type stripping). Vitest would hide a break. | A test spawns `node scripts/smoke-staging.mjs --sha bad` and expects exit 1 plus the usage line. |

## Writer deviations (decisions)
- **Q2, URLs from `WRANGLER_OUTPUT_FILE_PATH`:** accept. Verified at 25306, 64635-64646, 180601-180614, 165144-165147, 307889-307895.
- **`--yes` on the migrations push:** accept (a CLI 2.120.0 global flag).
- **`-q` on psql:** accept, and it is required. Without it the BEGIN, SET and ROLLBACK command tags print.
- **Variables set in run text:** accept, with one change: use the runner's `$GITHUB_SHA` instead of `${{ github.sha }}` in run text. No allow-list change is needed.
- **Q8, Pages default headers:** accept. The check fails closed, and the first run will show the real behaviour.
- **`maybeDelegatePagesToWorkers`:** no action. Detection is env-only, and no agent variables are set on runners. Never run `pages project create` from a local agent session.
- **`pages project list --json` + jq:** accept. It fails closed.

## Lead-only follow-ups
- **Spec §7.2:**
  - step 3: `--yes`;
  - step 4: `-q` and `statement_timeout`;
  - step 5: deploy the scanned staging bundle with `--no-bundle` (and update AT-16's wording);
  - step 8: URLs from the output file, a production-environment assertion, and the alias smoke.
- **§7.3 / H5:** the `SUPABASE_STAGING_DB_URL` value needs `sslmode=require` or `verify-full`. This goes to the founder queue.
- **`check-workflows` gap (pre-existing):** run text can `export` names that `ENV_DENY_REASONS` denies (for example `NODE_OPTIONS`). A rule banning such assignments would close it. Owner: M0a lead, before REVIEW, or record it.

## Resolution (lead)
- **S3B-5:** accepted as a staging residual for M0a and recorded in the M0a summary. Owner: M8, before any production deploy job.
- **All other findings and the `$GITHUB_SHA` change:** fixed on `m0a/s3b-fixes` by a Sonnet writer; see the re-review below.
