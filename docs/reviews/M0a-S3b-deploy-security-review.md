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

## Re-review of the fixes (Sonnet, 2026-10-12): **PASS**
Diff `git diff 91622ee ba3ac88` (`m0a/s3b-fixes`: `4327ca8`, `8ee02c5`, `ba3ac88`). Scripts: 1214 passed + 1 skipped (K4) in the writer's run.
- **S3B-1, fixed.** The no-secret Build step writes the `--dry-run --env staging --outdir dist` bundles before `scan-dist`, and the deploy uploads `dist/index.js` with `--no-bundle`. Job tests assert the exact lines and the step order.
- **S3B-2, fixed.**
  - One `pages-deploy-detailed` entry per project, with the same deployment, `environment: production` and production branch `main`.
  - The alias is smoked too.
  - Preview and wrong-branch fixtures fail.
- **S3B-3, fixed.** An early `content-length` refusal, a streamed read, and `cancel()` at the cap. Tested with an endless stream.
- **S3B-4, fixed.** `statement_timeout = '60s'`, a 360 s smoke deadline, and step timeouts of 10 and 8 minutes.
- **S3B-6, fixed.** `sslmode` must be `require`, `verify-ca` or `verify-full`, checked before any spawn. The URL is never printed.
- **S3B-7, fixed.** A plain-Node CLI load test.
- **`$GITHUB_SHA`:** no `${{` remains in run text, and a test asserts it.
- **S3B-5:** an accepted residual (owner M8).
- **Info:** `check-bundle-size` and `check-headers` look only at the non-staging build. The staging bundle is covered by `scan-dist`. No action.

## Lead follow-up: the `check-workflows` run-text gap (2026-10-12)
- **`0179e2a`** adds `checkRun`: run text may only read the `ENV_DENY_REASONS` names, every `GITHUB_ENV` use fails, and `GITHUB_PATH` is restricted. **`98feb3c`** applies the `container:`/`services:` ban to `deploy-staging` (N10–N13 re-review P2).
- **Security review of both (Sonnet): PASS WITH FINDINGS.**
  - Medium: a backslash-newline split a denied name, because bash joins the lines before it parses them. Repros: `export NO\<LF>DE_OPTIONS=x`, `echo "X=1" >> "$GITHUB_E\<LF>NV"`, `echo /tmp >> "$GITHUB_PA\<LF>TH"`.
  - Low:
    - `${NAME[0]=x}` was read as a read;
    - quote and backslash splits passed (`NO"DE_OPTIONS=x"`, `PA\TH=/tmp`);
    - any `$RUNNER_TEMP/<dir>` could go on PATH (shim risk);
    - the message said "set or export" for a mere mention;
    - test gaps (`RUNNER_*`, `BASHOPTS`, `DYLD_*`, a lower-case accept case).
  - Not checked: how GitHub reads `Run:` or `Env:`.
  - Residuals: names built at run time, `eval`, `$'\x..'`, `HOME`/`.npmrc` tricks, `github-script`. Accepted: run text is for the protected-branch review (summary L12).
- **Fixed in `dbb20c7`:**
  - names are scanned in the joined text, and again with quotes and backslashes removed;
  - array-element defaults count as assignments;
  - only `.github/actions/setup/action.yml` may write `GITHUB_PATH`, and only `echo "$RUNNER_TEMP/gitleaks" >> "$GITHUB_PATH"`;
  - the message now says the name may only be read;
  - workflow, job, step, action and `runs:` keys must be lower-case (fails closed on `Run:`/`Env:`).
  - Tests first: 51 new or changed cases failed on the old code. `verify:fast`: scripts 1289 passed + 1 skipped (K4).
- **Re-review of `dbb20c7` (Sonnet): PASS WITH FINDINGS** (no Critical, High or Medium). Every earlier repro is now rejected, and `check-workflows` passes on the real files with no new false positive.
  - Low: `export NO$''DE_OPTIONS=x`, `NO$""DE_…` and brace lists (`NO{,}DE_…`, `NO{,x}DE_…`) still passed.
  - Low: `defaults: {Run: {Shell: …}}` (workflow or job level) was outside the key-case check.
  - Info: nested subscripts (`${NODE_OPTIONS[a[0]]=x}`) pass. Accepted: bash does not export arrays.
  - Info: no test for an action's top-level key case.
- **Fixed in the next commit:**
  - the unquoted pass also drops a `$` before a quote;
  - brace lists are scanned once per alternative position (nested lists stay a residual);
  - `checkKeyCase` covers `defaults` and `defaults.run` at both levels;
  - tests cover the action top-level key, the four `defaults` cases and a plain-text accept case (`"it's fine"`, a JSON literal, `{a,b}`).
  - 10 new cases failed first. `verify:fast`: scripts 1299 passed + 1 skipped (K4). Both Lows were small and were fixed exactly as the reviewer suggested, so there is no further re-review.
- **AT-1a-local re-run on `dbb20c7`: PASSED** (scripts 1290 passed, 0 skipped; `test:rls` 112/112).
