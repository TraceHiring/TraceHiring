# M0a summary: toolchain, pipeline and skeleton

> **DRAFT for the future M0a CLOSE.** Written 2026-10-11 against `m0a/integration` @ `132e2ab` and `milestone/m0a` @ `54bd44d`; **updated 2026-10-12 at the end of BUILD** against `m0a/integration` @ `98feb3c` and `milestone/m0a` @ `f165fe0` (`cp/m0a-05`).
> Not final. S1, S2 (ui + apps) and S3 (Workers + deploy job) are built, reviewed and merged. The REVIEW phase and CLOSE have not happened.
> `TODO(CLOSE)` marks a value (SHA, run URL, count) that only exists at CLOSE.
> Every claim cites `path:line` or a commit SHA. **Line numbers are at `m0a/integration` @ `132e2ab`, except rows marked "(2026-10-12)", whose line numbers are at `98feb3c`.** Re-check each line number before CLOSE. If a cite is missing, do not trust the sentence.
> When this file is copied to `docs/milestones/M0a-summary.md`, delete this block and the "Open questions for the lead" section at the end.

Format source: AUTOPILOT §2 CLOSE (`docs/AUTOPILOT.md:20`), build-order rule 6 (`docs/build-order.md:12`), spec §13.1 (`specs/m0-foundations.md:920`), review-skill gate H6 (`.claude/skills/trace-milestone-review/SKILL.md:145`, "deferred items and known limits"). No earlier summary exists to copy (`docs/milestones/` is absent).

## 1. At a glance

| Field | Value |
| --- | --- |
| Milestone | M0a (`docs/build-order.md:21`) |
| Branches | integration `m0a/integration`; milestone `milestone/m0a` @ `f165fe0` (`cp/m0a-05`, the S3b merge; 2026-10-12) |
| Spec | `specs/m0-foundations.md` revision 16 (S2/S3a/S3b review follow-ups, `specs/m0-foundations.md:3-10`; 2026-10-12). Revision 15 was `132e2ab` (K3 text fixes) |
| Checkpoints | `cp/m0a-00` = `ebfb1c4` (spec approved), `cp/m0a-01` = `bdeb679` (S1.0), `cp/m0a-02` = `3141764` (S1.7 catalog merged, cold-stack full verify green), `cp/m0a-03` = `54bd44d` (S1.7 gate tip; code = `2b81ac4`) (`docs/progress/LOG.md:22`), `cp/m0a-04` = `a45505d` (S2 + S3a merged), `cp/m0a-05` = `f165fe0` (S3b merged; full verify and Linux CI green) (2026-10-12; `git tag --list 'cp/*'`) |
| Folded into one fast-forward | S1.1 to S1.6 never had their own `cp/*` tags (`docs/reviews/M0a-S1.7-gate-spec-review.md:84-85`) |
| Draft PR | https://github.com/TraceHiring/TraceHiring/pull/1 (`m0a/integration` to `main`, a draft that runs CI on every push and is not merged; `main` moves only at CLOSE, `docs/build-notes.md:46`, `:49`; `docs/progress/HANDOFF.md:20`) |
| CI evidence so far | Run 38146227653 on `72f8f1f`: `static`, `rls`, `security`, `migrations` all green (`docs/progress/HANDOFF.md:20-21`). Run 38167417262 on `146d465` green. **Run 38169130226 on `f165fe0`** (S3b merged): `static`, `security`, `migrations` green; `rls` failed once on a runner Docker port-binding error and passed on re-run (2m46s); `deploy-staging` skipped on the PR event, as designed (2026-10-12; HANDOFF of 01:45 IST). **Run 38189415448 on `632cb57`** (the end-of-BUILD rule commits): all four required jobs green (static 4m59s, rls 2m39s, security, migrations), `deploy-staging` skipped. `TODO(CLOSE)`: the run on the CLOSE tip |
| Local verify evidence | Full `pnpm verify` green on `3141764`, `72f8f1f`, `2b81ac4`: scripts 828 passed + 1 skipped, `@trace/shared` 613, `test:rls` 112/112 (floor 112), db-types current, `scan-dist` OK (`docs/progress/HANDOFF.md:17-18`). After J1 (`a2d05fe`) `@trace/shared` is 618 (`docs/progress/LOG.md:22`). **On `f165fe0`** (2026-10-12): scripts 1229 passed + 1 skipped (K4), `test:rls` 112/112, candidate 72.4 kB gzip, headers and `scan-dist` OK. `verify:fast` on `0179e2a`: scripts 1260 passed + 1 skipped. `TODO(CLOSE)`: final counts |
| Review verdict | M0a REVIEW 2026-10-12 (`docs/reviews/M0a.md`): **BLOCK, founder-gated** — no code defect; blocked by the GitHub plan (SEC-1) and the open staging secrets. `TODO(CLOSE)`: the re-review verdict and tag `m0a-reviewed` |
| Dev machine | Node 22.23.3, pnpm 12.11.2, gitleaks 8.30.1, Docker 29.5.2 (`docs/build-notes.md:34`) |

## 2. What was built

### 2.1 Built and through the S1.7 gate, plus the lead's follow-ups

| Step | What exists | Evidence |
| --- | --- | --- |
| S1.0 commit-path safety | Lefthook pre-commit and pre-push gitleaks scans, `.gitleaks.toml`, the Q56 deny rules for local deploys | `bdeb679`; deny list at `.claude/settings.json:7-89`; AT-6 and AT-6c in `scripts/test/hooks.test.mjs` (gate review `:37`) |
| S1.1 to S1.3 workspace | pnpm workspaces: `apps/{candidate,recruiter}`, `packages/{config,db-types,shared,ui,vendors}`, `workers/{edge,jobs}`, `services/api`. ADR-028 (zod, Hono, React Router). `@trace/config` with ESLint boundary rules and fixture tests. Every workspace has a placeholder with a real smoke test | `7a7854e`, `7714277`, `93b1f6f`; `docs/adr/ADR-028-m0-runtime-libraries.md:3`; directory listing checked 2026-10-11 |
| S1.4 scripts | `verify-fast`, `verify-clean-clone`, `check-boundaries`, `check-migrations`, `check-workflows`, `check-bundle-size` (150 KB gzip), `check-headers`, `scan-dist`, `backup.sh`, `scripts/lib/` and their tests | `scripts/` listing; `package.json` `lint` and `build` scripts; AT map in gate review `:29-54` |
| S1.5 CI | `.github/workflows/ci.yml` with `static`, `rls`, `security`, `migrations` jobs (no deploy job yet) and `dependabot.yml` | `22c883c`; `.github/workflows/ci.yml:2`; CI run 38146227653 |
| S1.6 commit lint | commitlint hook accepting `wip`, plus AT-7 | `7bbcabd`; `scripts/test/commitlint.test.mjs` (gate review `:38`) |
| S1.7 database | `supabase/config.toml`, baseline migration `20261011015904_m0a_baseline.sql` (schema and privilege lockdown, no tables), pgTAP harness `scripts/test-rls.mjs`, 16 catalog checks with 85 branch fixtures, floors `catalog-min-count` 112 and `rls-min-count` 0, `packages/db-types` | `supabase/` listing; floors read from `supabase/tests/catalog-min-count` and `rls-min-count`; gate review `:8-10` (manifest 16 IDs / 85 branches); baseline "matches section 8.2 exactly and is safe" (`docs/reviews/M0a-S1.7-database-review.md:9`) |
| S1.7 shared code | PII-redacting logger, redactor, `serializeError`, `ErrorReporter` with `noopErrorReporter`, health and version contracts, zod wire contracts | `d434510`; `packages/shared/src/` listing; AT-8 in `redact.test.ts`, AT-9 unit part in `logger.test.ts` (gate review `:39-40`) |
| CI hygiene | Dependency overrides (handlebars, sharp, undici) and a documented `braces` ignore; SessionStart hook reads the integration handoff | `4d7b0ec`, `5e3f178`, `d9bf35a`; `docs/build-notes.md:632` |
| Gate follow-up K1 | `scripts/check-staging-secrets.mjs`: allow-list `{edge:[],jobs:[],api:[]}`, fails closed; unit tests use recorded-shape `wrangler secret list --format json` output with synthetic names. This is AT-15's local part | `01bfb09`; `scripts/check-staging-secrets.mjs:17-21`; `scripts/test/check-staging-secrets.test.mjs:1-4` |
| Gate follow-up K3 | Spec revision 15: stale text fixed (`claude-*` scripts, advisory ignores and overrides, clean-clone image digest row, MT-11 branch count, the `scan-dist` accepted residuals in section 15) | `132e2ab`; `specs/m0-foundations.md:10-15` |
| Deny rules widened | Wrangler and supabase remote-changing commands under any launcher, ref-rewriting push spellings, hook bypasses. Founder delegation of 21:55 IST. A guard rail, not a boundary: this machine holds no Cloudflare or Supabase staging credential | `b9b870f`; `scripts/test/claude-settings.test.mjs:1-4`; `docs/progress/FOUNDER-QUEUE.md:44` |
| H3 staging branch policy | The `staging` environment deploys only from `main`. Applied with `gh api` after the founder's OK in chat (2026-10-11 22:30 IST) and read back | `docs/progress/FOUNDER-QUEUE.md:43`; `docs/build-notes.md:634` |
| S2/S3 lead preconditions | P1 to P4 (`@trace/config` vite export, `@trace/ui` tokens export, Prettier ignore for generated tokens, `wrangler` as a root dev dependency) | `fa147f8` (`m0a/s2s3-prep` @ `1c7dc63`); `docs/progress/S2-S3-PLAN.md:17-20` |
| End-of-BUILD lead follow-ups (2026-10-12) | (1) **`check-workflows` run-text rule** (S3b review gap): `run:` text may only *read* the names `env:` may not set (`NODE_OPTIONS`, `PATH`, `BASH_ENV`, ...); every `GITHUB_ENV` use is rejected; `GITHUB_PATH` only takes one `echo "$RUNNER_TEMP/<dir>" >> "$GITHUB_PATH"` line, which the setup action now writes. (2) **P2**: `check-workflows` rejects `container:`/`services:` on `deploy-staging` too (the real job was already pinned by `scripts/test/deploy-staging-job.test.mjs:68-74`) | `0179e2a` (`checkRun`, `scripts/check-workflows.mjs:775-831`; 31 tests incl. the real `.github`), `98feb3c`; security review of `0179e2a`: see 2.3 |

Acceptance tests covered locally at the gate: AT-2, AT-3, AT-4, AT-5, AT-6, AT-6c, AT-7, AT-8, AT-9 (unit part), AT-14, AT-16 (local part), AT-17, AT-19, AT-21 and AT-22-local scripts, AT-23, AT-24 (gate review `:30-54`). AT-15's local part was added by K1 (`01bfb09`).

### 2.2 Built in S2 and S3 (all merged 2026-10-12)

| Stream | Scope | Status |
| --- | --- | --- |
| S2 | `packages/ui` tokens pipeline (AT-20), `packages/vendors`, both apps' real shells, `_headers` per spec section 10.3, AT-9 recruiter wiring, AT-21 and AT-22-local final | **Merged 2026-10-12** into `m0a/integration` as `e2133bf` (`m0a/s2-fixes` @ `ca75411` = `m0a/s2-ui` @ `54620e6` + 5 test-only review fixes). Lead follow-ups on integration: `bee2364` S2-R1/R2 (production-build scan, more capture forms), `146d465` `@trace/ui` `tokens`/`tokens:check` + lint (spec §5), `497cba7` `verify:fast` token mapping. Tests at merge: `@trace/ui` 67, candidate 80, recruiter 68. **AT-21:** candidate initial JS **72.4 kB gzip** (budget 150), recruiter 123.5 kB (no budget). **AT-22-local:** `check-headers` OK for both apps (lead run in the W-S2 worktree, 2026-10-12). Deferred CSP origins: candidate edge origin (H4), recruiter Supabase origin (M0b), Sentry ingest (before D1) |
| S3a | `workers/*` and `services/api` real handlers (AT-10, AT-9 jobs and api wiring) | **Merged 2026-10-12** as `c4f0646` (`m0a/s3a-fixes` @ `621c545` = `m0a/s3-workers` @ `e04446e` + fixes `1205dcc`, `621c545`). Tests: edge 29, jobs 34, api 34. Workers `observability` set to `enabled: false` (no Workers Logs until ADR-027 records it). Bundle per Worker ~850 KiB / ~141 KiB gzip (writer's figure; no spec budget). `types:gen` pinned to `--strict-vars=false`. Edge no-reporter: type guard + raw-source scan + `check-boundaries` rule 7 |
| S3b | the `deploy-staging` job in `ci.yml`, `smoke-staging.mjs`, `staging-catalog-checks.mjs`, `check-workflows` over the real deploy job (AT-12 local part), the P2 ban on `container:` and `services:` | **Merged 2026-10-12** as `f165fe0` (`m0a/s3b-fixes` @ `ba3ac88` = `m0a/s3b-deploy` @ `91622ee` + fixes `4327ca8`, `8ee02c5`, `ba3ac88`). Review `docs/reviews/M0a-S3b-deploy-security-review.md`: Opus PASS WITH FINDINGS (S3B-1, S3B-2 Medium), fixes re-reviewed PASS. Q2: URLs from wrangler's output file. Deploys the scanned staging bundle with `--no-bundle`; production Pages assertion + alias smoke; `sslmode` required; `statement_timeout`. **Residuals:** S3B-5 unordered staging deploys (owner M8); first real run untested (`--no-bundle` upload, Q8 Pages default headers). Scripts 1229 + 1 skipped (K4) in the full verify on `f165fe0` |

### 2.3 Review history (all read-only reviewers; reports in `docs/reviews/`)

| Area | Reports and verdicts | Open at this draft |
| --- | --- | --- |
| S1.4 scripts | Re-review `M0a-S1.4-security-rereview.md`: BLOCK (N1, N2 Medium), then all N1 to N7 fixed (`docs/progress/LOG.md:12-13`). Second re-review PASS, new Lows N8, N9 (`LOG.md:14`). `...n8-n9-security-review.md`: PASS WITH FINDINGS, N10 to N13. `...n10-n13-security-rereview.md`: PASS WITH FINDINGS, P1 to P3 | P1 fixed `fa31e0d`. P3 fixed `5211539`. P2 goes to S3. gitleaks allowlist owed (section 5). N13 residuals (section 4.3) |
| S1.7 catalog | `database-review`: BLOCK. `w3b-w2-database-review`: W3b BLOCK, W2 pass. `catalog-fixes-database-review`: BLOCK (D1 High, fixed). `catalog-pass-c`: PASS WITH FINDINGS (E1 Medium, E2, E3). `catalog-pass-d`: PASS (no findings) | D6, D7, D8, E3 deferred with owners (section 4.3) |
| S1.7 redactor | `redactor-security-review`: PASS with 2 Mediums (fixed). `w1-w2-spec-review`: PASS WITH FINDINGS (fixed). `redactor-lows`: PASS WITH FINDINGS F1 to F8 (fixed; F6 has documented residuals). `redactor-f-lows` re-review: G1, G2 (fixed). `redactor-g-lows` re-review: H1 (fixed). `redactor-h1-k2` re-review: J1 (fixed `a2d05fe`) | Checklist items only (section 4.4) |
| S2 ui + apps | `M0a-S2-ui-security-review.md`: Opus PASS WITH FINDINGS (S2-1 to S2-4 Low, test gaps), fixed; Sonnet re-review PASS WITH FINDINGS (S2-R1, S2-R2 Low), fixed by the lead after the merge | None |
| S3a Workers | `M0a-S3a-workers-security-review.md`: Opus PASS WITH FINDINGS (S3A-1 Medium: thrown non-Errors escaped `onError`; S3A-2, S3A-3 Low), fixed; Sonnet re-review PASS (S3A-R1 Info) | Extract the shared Workers app code before M0b (deviation d); Sentry adapter needs `ctx.waitUntil` (before D1) |
| S3b deploy job | `M0a-S3b-deploy-security-review.md`: Opus PASS WITH FINDINGS (S3B-1, S3B-2 Medium; S3B-3 to S3B-7 Low), fixed on `m0a/s3b-fixes` @ `ba3ac88`; Sonnet re-review PASS (2026-10-12) | S3B-5 accepted residual (4.3, L9). The `check-workflows` export gap from its lead follow-ups is closed by `0179e2a` (2.1) |
| End-of-BUILD `check-workflows` rule | `M0a-S3b-deploy-security-review.md` "Lead follow-up": review of `0179e2a` PASS WITH FINDINGS (one Medium: a backslash-newline split name; Lows), fixed test-first in `dbb20c7`; re-review of `dbb20c7` PASS WITH FINDINGS (two Lows), fixed in `41f0bff`. AT-1a-local re-run PASSED on `dbb20c7` (scripts 1290 passed, 0 skipped; `test:rls` 112/112). Linux CI run 38196819481 on `41f0bff` green (static, rls, security, migrations) | Remaining run-text gaps are the accepted residual L12 |
| S1.7 gate | `M0a-S1.7-gate-spec-review.md`: PASS WITH FINDINGS (K1 Medium; K2 to K5 Low). K1 fixed `01bfb09`. K2 fixed `2b81ac4`. K3 fixed `132e2ab`. K4 and K5 recorded | None from the gate. The M0a REVIEW reads spec revision 15 (`specs/m0-foundations.md:1068`) |

## 3. What was deferred, and why

1. **Gates that need a push, a CI run or staging.** The founder chose option (b): push before M0a closes, use the real CI result, and own every such item at M0a CLOSE (`docs/build-notes.md:35`; `specs/m0-foundations.md:903`). The deploy items also wait for the founder's Cloudflare and Supabase secrets and for S3.
2. **Sentry.** Deferred by the founder until before D1. M0a ships the `ErrorReporter` interface and a no-op reporter (`specs/m0-foundations.md:40`; `docs/build-order.md:26`).
3. **Known gaps in the catalog checks.** Three have a later owner (D6, D8 to M6; D7 to the M4/M5 reviewer checklist) and one goes to M0b (E3).
4. **Crafted-input cases.** By the founder's backstop decision, the catalog checks, the redactor and `scan-dist` catch honest mistakes only. Deliberate evasion goes on the reviewer checklist (`docs/build-notes.md:44`).
5. **ABH-80 drill and alert.** The restore drill and the on-call alert belong to M8. M0a owns only "no candidate PII is found in logs (scan)" (`specs/m0-foundations.md:924`; `docs/build-notes.md:40`).

## 4. Deferred gates

Owner for every row in 4.2 is **M0a CLOSE**. Build-order rule 6 requires every deferred gate to pass by the M8 gate at the latest (`docs/build-order.md:12`).

### 4.1 Local runs still to record (no push needed)

| Item | What it proves | Status | What closes it |
| --- | --- | --- | --- |
| AT-1a-local | A clean clone installs with `--frozen-lockfile` and passes typecheck, lint, test and build inside a digest-pinned `node:22.23.3` Linux container (`specs/m0-foundations.md:873`) | **PASSED 2026-10-12 on `a45505d` (`cp/m0a-04`, before S3b)**: `node:22.23.3@sha256:0e5f9065…` container; package tests (config 324, shared 618, ui 67, candidate 80, recruiter 68, jobs 34, api 34, edge 29), scripts 1143 passed **0 skipped**; build: bundle, headers, `scan-dist` OK; host `test:rls` 112/112, db-types current **Re-run PASSED 2026-10-12 on `0179e2a`** (S3b merged + the run-text rule): same image digest; package tests unchanged; scripts **1261 passed, 0 skipped**; build: candidate 72.4 kB gzip, headers, `scan-dist` OK; host `test:rls` 112/112, db-types current | `TODO(CLOSE)`: re-run on the CLOSE tip if code changes after `0179e2a` (`98feb3c` is covered by AT-1b and Linux CI) |
| AT-1b | The same on the founder's Windows machine, in a path with spaces (`specs/m0-foundations.md:874`, `:862`) | **PASSED 2026-10-12 on `8a5706e`** (includes `98feb3c`), clone in a `trace-clean-clone-*` folder next to the checkout, under `Arambh data/Trace data/` (a path with spaces): `pnpm install --frozen-lockfile`, then full `pnpm verify`: package tests as AT-1a, scripts 1262 passed + 1 skipped (K4, below), `test:rls` 112/112, db-types current, candidate 72.4 kB gzip, headers and `scan-dist` OK | Run by the autopilot on the founder's machine. `TODO(CLOSE)`: re-run on the CLOSE tip if code changes |
| **K4 note for AT-1b** | On this Windows machine `scripts/test/scan-dist.test.mjs:689-693` skips its file-symlink case when Windows returns EPERM (symlinks need Developer Mode). A local `pnpm verify` therefore shows "828 passed, 1 skipped". CLAUDE.md says never to finish with a skipped check, so the covering evidence is Linux CI, where the case runs: run 38146227653, `static`: **829 passed, 0 skipped** (`docs/build-notes.md:633`; gate review `:25`) | Recorded as a platform exception | Cite the Linux CI run of the CLOSE tip next to the AT-1b output (`TODO(CLOSE)`). Optional: run AT-1b with Developer Mode on (gate review `:25`) |

### 4.2 Deferred to M0a CLOSE (needs a push, CI or staging)

| # | Item | What it proves | Proxy test now | Why deferred | What closes it |
| --- | --- | --- | --- | --- | --- |
| G1 | **AT-1a-CI** | A fresh Linux checkout runs `pnpm i --frozen-lockfile && pnpm verify` green (exit-gate item 1; `specs/m0-foundations.md:872`) | AT-1a-local (4.1). CI `static` + `rls` already green for S1 on run 38146227653 (gate review `:31`), and for S1 to S3 on run 38169130226 (`f165fe0`; 2026-10-12) | The final run must be on the CLOSE tip | A green `static` and `rls` run on the CLOSE tip. Record the run URL. `TODO(CLOSE)` |
| G2 | **CI `security` re-run** (no secret in history) | gitleaks over full history, `pnpm audit --prod --audit-level=high` and `osv-scanner` are clean on CI (`specs/m0-foundations.md:421`, `:915`) | AT-5: gitleaks is the last step of `pnpm lint` (gate review `:36`). CI `security` green on `72f8f1f` | Same: needs the CLOSE tip | A green `security` run on the CLOSE tip. The `braces` ignore (one `pnpm audit` entry, one `osv-scanner` filter; gate review `:12`) must be listed with its reason (section 6). `TODO(CLOSE)` |
| G3 | **AT-11** | Staging deploys from CI, and every Worker `/health` and each app `/version.json` reports the deployed SHA (`specs/m0-foundations.md:886`, `:455-458`) | AT-10 (each Worker's `/health` carries the injected `VERSION`), written in S3 | The `deploy-staging` job exists since `f165fe0` (2026-10-12) but runs only on a push to `main`. It also needs `CLOUDFLARE_API_TOKEN` (the exposed token must be rolled first, `docs/progress/FOUNDER-QUEUE.md:6`) and the `*.workers.dev` subdomain (`:9`). The H3 branch policy is done (`:43`) | A green `deploy-staging` run on a push to `main` whose smoke step passes. Record the run URL. See open question 1 |
| G4 | **AT-13** | CI blocks a merge on red (`specs/m0-foundations.md:888`) | AT-12 local part plus the rule that nothing merges into `milestone/m0a` or `main` without a green `pnpm verify` (`specs/m0-foundations.md:918`) | Protection needs the real check names, which now exist (`static`, `rls`, `security`, `migrations`). The founder answered option (a) on 2026-10-11, 21:55 IST: PR plus the four required checks; CLOSE merges through a PR (`docs/build-notes.md:49`; `docs/progress/FOUNDER-QUEUE.md:40`) | The autopilot gives the exact `gh api` commands at CLOSE (`specs/m0-foundations.md:469-482`). Paste (1) the branch-protection output and (2) one deliberately red PR shown blocked, then closed. The output of every command goes here (`specs/m0-foundations.md:484`) |
| G5 | **AT-18** | The 16 catalog checks hold on the **hosted staging** database after `db push`, including MT-12 default ACLs (`specs/m0-foundations.md:893`, `:442-445`) | AT-2: `pnpm test:rls` runs all checks and 85 fixtures on the local stack, 112/112 (gate review `:33`) | Needs S3 deploy step 4 and the secret named `SUPABASE_STAGING_DB_URL`; the founder set `SUPABASE_DB_URL` instead (`docs/progress/FOUNDER-QUEUE.md:7`). Staging must run PostgreSQL 17 or later (MAINTAIN and role-option checks; `specs/m0-foundations.md:25`, `:687`). No queue row asks for staging's Postgres major version, although spec H5 does (`specs/m0-foundations.md:214`). The database-reviewer did not check hosted owners, extra roles, the MT-8b day-one owners or the MT-9 literal list (`docs/reviews/M0a-S1.7-catalog-fixes-database-review.md:64`) | A `deploy-staging` run where step 4 prints no violation line and the number of files run equals `manifest.json`. Record the run URL. Compare `[db] major_version` (`specs/m0-foundations.md:492`). Expect to fix forward if hosted Supabase differs from local |
| G6 | **AT-22-staging** | The section 10.3 security headers are present on both staging apps (`specs/m0-foundations.md:898`) | AT-22-local: `check-headers.mjs` in `build` (gate review `:52`; final with S2) | Needs S2 `_headers`, the S3 smoke step and the `workers.dev` subdomain: the candidate app's `connect-src` needs the staging edge origin (`specs/m0-foundations.md:830`; `docs/progress/FOUNDER-QUEUE.md:9`) | Smoke-step output from a staging run. Record the run URL |
| G7 | **AT-12, deferred part** | Deploys run from CI only: the H3 environment branch policy limits `staging` to `main`, and the Q56 deny rules are recorded (`specs/m0-foundations.md:887`) | `check-workflows.mjs` unit tests plus `lint` (local part). Q56 approved; deny rules in `.claude/settings.json:7-89`, widened in `b9b870f` and pinned by `scripts/test/claude-settings.test.mjs` (`docs/build-notes.md:37`) | **H3 is done** (read back: custom branch policies on, one policy `main`; `docs/progress/FOUNDER-QUEUE.md:43`). The real `check-workflows` pass over the S3 deploy job is done: `runChecks` over the real `.github` passes in `scripts/test/check-workflows.test.mjs` ("passes the real ci.yml and setup action") and in `pnpm lint` (2026-10-12). No record shows that the other repo-level settings were applied or checked: default workflow token read-only, secret scanning, push protection (`specs/m0-foundations.md:479-482`) | Paste the read-back `gh api repos/TraceHiring/TraceHiring/environments/staging --jq .deployment_branch_policy` and the repo-level settings output here. `check-workflows` must pass over the S3 deploy job |
| G8 | **AT-15, deferred part** | Edge has no Worker secrets; jobs and api match the allow-list `{edge:[],jobs:[],api:[]}` on the deployed Workers (`specs/m0-foundations.md:890`, `:448-453`) | **Local part now exists:** `scripts/check-staging-secrets.mjs` and its unit tests (`01bfb09`) | S3 deploy step 6, the Cloudflare token, and the first real run. No `wrangler login` on this machine by design, so the fixtures are synthetic until then (`docs/progress/S2-S3-PLAN.md:54`) | Deploy step 6 passes on a staging run (edge `[]`). Record the run URL |
| G9 | **AT-16, deferred part** | No secret in any build output in the deploy job: `gitleaks dir` over `apps/*/dist` and every Worker's `dist` (deploy step 2; `specs/m0-foundations.md:891`, `:440`) | `scan-dist.mjs` runs in `build` and is unit-tested (local part met; gate review `:48`). Hardened by N5, N8, N11 to N13 and P1 | Needs a real staging run. The re-bundle concern (`docs/progress/S2-S3-PLAN.md:40`) was finding S3B-1 and is fixed: the Build step writes the `--dry-run --env staging --outdir dist` bundles before `scan-dist`, and the deploy uploads `dist/index.js` with `--no-bundle` (re-review PASS, `docs/reviews/M0a-S3b-deploy-security-review.md`; 2026-10-12) | Deploy step 2 passes on a staging run, and the security-reviewer confirms the scanned output is what is uploaded |

### 4.3 Deferred to a later milestone, gate, or accepted as a known residual

| # | Item | What it proves | Why deferred | Owner | What closes it |
| --- | --- | --- | --- | --- | --- |
| L1 | **AT-9-sentry and H6** | Sentry `beforeSend` strips request, user and query data and exception values; Sentry projects exist with IP storage off and server-side scrubbing on (`specs/m0-foundations.md:884`, `:215`) | The founder deferred Sentry; M0a ships a no-op reporter and no Sentry package (`specs/m0-foundations.md:40`). Not an M0a blocker | **Before D1** (`docs/build-order.md:38`). D1 now sits right after `m0b-reviewed` (`docs/build-notes.md:50`), so this lands after M0b and before D1 starts | H6 from the founder (projects `trace-recruiter` and `trace-workers`, data region, IP and scrubbing settings). Then `scrubSentryEvent` plus one wiring test each in the recruiter app, jobs and api; DSNs as `staging` variables; the region recorded in ADR-027 (`specs/m0-foundations.md:740-752`). No open FOUNDER-QUEUE row for H6 exists yet; add one before D1 |
| L2 | **D6** (Medium): trigger side effects not followed | A function that writes a `public` table whose trigger writes the other rule-1 schema is not seen by MT-5a to MT-5d (`docs/reviews/M0a-S1.7-catalog-fixes-database-review.md:32`) | The closure has no relation-to-trigger or relation-to-rule edge. Not needed until tables exist | **M6** (the `reports` junction). Hand check by the database-reviewer in **M4 and M5** meanwhile (`specs/m0-foundations.md:683`) | M6 adds name-based relation edges from function bodies and relation to trigger/rule edges |
| L3 | **D7** (Low): reviewer checklist | Operators, casts and domains used inside plpgsql bodies, and dynamic SQL, are not followed (`specs/m0-foundations.md:684`) | Statically undecidable for dynamic SQL; the rest is out of backstop scope | **M4/M5 database-reviewer checklist** | Reviewer rules: no `EXECUTE` in a function that names `quality` or `integrity` even as a literal; no comment markers inside literals in such a body; no schema name held in a variable. **Includes E1 shapes 3, 4 and 5** (dollar-quoted or `E''` literals crafted to fool the comment stripper; `docs/reviews/M0a-S1.7-catalog-pass-c-database-review.md:22`; `docs/reviews/M0a-S1.7-catalog-pass-d-database-rereview.md:43-45`) |
| L4 | **D8** (Low): cascading FK chain | `integrity` <- `public` <- `quality` with `on delete cascade` lets deleting a flag delete a score and is not flagged (`docs/reviews/M0a-S1.7-catalog-fixes-database-review.md:34`) | Needs a recursive check over cascading foreign keys | **M6** | M6 adds the recursive check (`specs/m0-foundations.md:686`) |
| L5 | **E3** (Low): policies on system relations | `supautils.policy_grants` lets `postgres` create policies on 24 `auth.*`, `storage.*`, `realtime.*` tables; MT-11 and MT-5d do not look there (`docs/reviews/M0a-S1.7-catalog-pass-c-database-review.md:24`) | No such policy exists on day one; Trace uses R2 and Durable Objects, not Supabase Storage or Realtime | **M0b** (database-reviewer, together with the MT-10 candidate roles) | MT-11 branch flagging any policy on a system-list relation; MT-5d takes policy hosts from every relation; one fixture (`specs/m0-foundations.md:685`) |
| L6 | **ABH-80, restore drill and on-call alert** | RPO <= 2 min and RTO <= 2 h proven in a drill; alert reaches the phone in under 2 minutes (`docs/build-notes.md:40`; plan-conflicts #16) | Needs production-like infrastructure | **M8** (build-order M8 exit gate) | The M8 drill. M0a owns only the PII-in-logs scan (section 5) |
| L7 | **N13 residuals** (Low, accepted) | `scan-dist` (AT-16) cannot read, under a neutral file name: raw deflate, brotli (found by file name only), lzma-alone, encrypted blobs, compressed streams inside another container. A key hidden that way passes AT-16 (`specs/m0-foundations.md:985`; `docs/reviews/M0a-S1.4-n10-n13-security-rereview.md:22-23`) | The re-review accepted them; they fall under the backstop scope. Spec revision 15 says the summary must list them here | **Reviewer checklist; no milestone owner is named** in the re-review or the spec (see open question 2) | Nothing to close. Deliberate packing is a reviewer-checklist item. Re-check if a milestone adds binary build assets |
| L8 | **N11 declared limit** (Low, accepted) | A key longer than 8,192 bytes (`STDIN_PIECE_OVERLAP`) can still be cut between two stdin pieces; a 9.4 KB PEM was missed at 2 of 12 offsets (`specs/m0-foundations.md:985`; `docs/reviews/M0a-S1.4-n10-n13-security-rereview.md:17-18`; `scripts/scan-dist.mjs:284`) | Declared limit of the piece-overlap design | Same as L7 | Same as L7 |
| L9 | **S3B-5** (accepted residual, 2026-10-12) | Staging deploy runs are serialised (`concurrency: deploy-staging`, no cancel) but not ordered: an older run queued behind a newer one can deploy older code last | GitHub concurrency groups do not order runs; staging only, synthetic data | **M8**, before any production deploy job (`docs/reviews/M0a-S3b-deploy-security-review.md`, "Resolution (lead)") | The production deploy job checks that the commit is still the tip of `main` before it deploys, or uses an ordered mechanism |
| L10 | **First real staging run untested** (2026-10-12) | Three behaviours are only proven by the first `deploy-staging` run: the `--no-bundle` upload of the scanned bundle; the Pages default headers (Q8: the smoke step fails closed if Cloudflare adds or drops a header); and the hosted catalog (G5) | No staging credentials yet (4.5); the job runs only on a push to `main` | **M0a CLOSE** (the run the CLOSE merge triggers; FOUNDER-QUEUE "How the staging gates get evidence") | A green `deploy-staging` run; fix forward by a new PR if it is red |
| L11 | **Deferred CSP origins** (2026-10-12) | The section 10.3 CSPs do not yet allow: the candidate app's staging edge origin (`connect-src`; needs H4), the recruiter app's Supabase origin (M0b adds Supabase Auth), the Sentry ingest origin (before D1) | Each origin depends on a later decision or milestone | H4 (founder) → M0a CLOSE for the edge origin; **M0b** for Supabase; **before D1** for Sentry | Add each origin to the app's `public/_headers` with a `check-headers` test when its owner lands |
| L12 | **`check-workflows` run-text rule is a deny rule** (2026-10-12) | `checkRun` stops `run:` text from setting the `env:` deny names and from writing `GITHUB_ENV`/arbitrary `GITHUB_PATH`, but run text can still do anything else (`exit 0`, write `.npmrc`, build a name at run time) | An allow-list for run text would ban ordinary shell variables; check-workflows is a lint, not a sandbox | **G4** (branch protection: `.github/` changes reach `main` only through a reviewed PR with the required checks) | Nothing to close in the tool; reviewer-checklist item for any `.github/` change |

### 4.4 Reviewer-checklist items (not gates, no tool fix)

These are out of scope for the tools by the backstop decision (`docs/build-notes.md:44`). Each was demonstrated by a reviewer. Mention them when the area is next reviewed.

| Area | Item | Source |
| --- | --- | --- |
| Catalog checks | A schema or setting name held in a variable (`execute format('%I.t', v_schema)`) is not flagged. MT-7 `body_search_path` has no per-function exemption and flags `raise notice` text; role-level `ALTER ... SET search_path` is not covered | `docs/reviews/M0a-S1.7-catalog-pass-d-database-rereview.md:44-47`, `:33-36`, `:54-55` |
| Redactor | `Bearer = v` and `Basic : v` (space after the separator) leak; a key with a 4+ blank gap before `=` or `:` (`password    =v`) leaks, only `Token` was fixed (J1) | `docs/reviews/M0a-S1.7-redactor-h1-k2-security-rereview.md:31-32` |
| Redactor | A secret in a key with no separator (`"otp%3D<v>"`), unquoted multi-word keys (`Address Line 1=<v>`), a quoted key over 64 characters holding an over-long bare key | `docs/reviews/M0a-S1.7-redactor-g-lows-security-rereview.md:32-34` |
| `serializeError` | A message line that is itself a frame with a path location survives; so does a message changed after the stack was read, to its own first lines | `packages/shared/src/log/serialize-error.ts:89-91`; `docs/reviews/M0a-S1.7-redactor-f-lows-security-rereview.md:19-20` |

### 4.5 Founder items that block closing the gates above

All rows are in `docs/progress/FOUNDER-QUEUE.md` (open table, line numbers at `132e2ab`). Names only; never paste values.

| Queue row | Blocks | Note |
| --- | --- | --- |
| `:6` Roll the Cloudflare token that was pasted as a secret name; set `CLOUDFLARE_API_TOKEN`; delete the misnamed secret. **Urgent** | G3, G6, G8, G9 | Treat the old token as exposed |
| `:7` Set `SUPABASE_STAGING_DB_URL`; delete `SUPABASE_DB_URL` | G5 | |
| `:9` H4: the `*.workers.dev` subdomain | G3, G6 | The founder's earlier answer was a template placeholder |
| `:10` Branch protection on `main` | G4 | The row text predates the answer: option (a) is recorded as resolved (`docs/progress/FOUNDER-QUEUE.md:40`), but the M0a REVIEW found protection unavailable on the current GitHub plan (queue row `:15`, SEC-1) |
| `:11` GitHub rules: block force-push and deletion on `main` and `milestone/*`, protect tags | none (hardening) | Only GitHub can enforce this; the autopilot folds it into the `main` protection commands at CLOSE |
| `:8` Attach the Supabase connector | M0b, not M0a | |
| Done since the last handoff | | H3 (`:43`) and the deny-rule widening (`:44`) were delegated to the autopilot and are resolved |

## 5. Owed before CLOSE (work, not gates)

| Item | Detail | Source |
| --- | --- | --- |
| gitleaks allowlist | **Done in `82ed8a7`** (after this draft was written): `.gitleaks.toml` extends `config/gitleaks-8.30.1/gitleaks.toml`, upstream v8.30.1 (sha256 `e163e53b…9caf`) with only `'''(?i)^(?:true\|false\|null)$'''` changed; the `scan-dist` fallback extends it by absolute path; `scripts/test/gitleaks-config.test.mjs` plus new hooks/scan-dist cases; full history (230 commits) and all 5 `dist/` clean. At CLOSE: move this row to section 2.1 and re-check the K4 line numbers in 4.1 | `docs/reviews/M0a-S1.4-n10-n13-security-rereview.md:32-44` |
| P2 | **Done** (2026-10-12): the real job is pinned by `scripts/test/deploy-staging-job.test.mjs:68-74` (W-S3b), and `check-workflows` rejects `container:`/`services:` on `deploy-staging` since `98feb3c`. W-S3b extended `ENV_ALLOW_LIST` with `SUPABASE_STAGING_DB_URL`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (`scripts/check-workflows.mjs:673-693`) | `...n10-n13-security-rereview.md:29` |
| `check-workflows` export gap | **Done** (2026-10-12) in `0179e2a`: run text may not set the `env:` deny names; `GITHUB_ENV` banned; `GITHUB_PATH` restricted (2.1, L12) | `docs/reviews/M0a-S3b-deploy-security-review.md`, "Lead-only follow-ups" |
| Log scan | The M0a REVIEW scans the logs the tests produce for candidate PII (the part of ABH-80 that M0a owns) | `specs/m0-foundations.md:924` |
| AT-1a-local, AT-1b | **Done 2026-10-12** (4.1): AT-1a-local on `0179e2a`, AT-1b on `8a5706e`, both PASSED | `specs/m0-foundations.md:937` |
| Done since the last handoff | K1 (`01bfb09`), K3 (spec revision 15, `132e2ab`), H3, the deny-rule widening and P1 to P4 are finished (section 2.1) | |

## 6. Known limits at this draft

| Limit | Detail | Owner or expiry |
| --- | --- | --- |
| `braces` advisory ignored | `braces` <= 3.0.3 (GHSA-vfj7-8cjw-p6xm, severity high, no fixed release) is ignored in `pnpm audit` (`auditConfig.ignoreGhsas`) and `osv-scanner.toml`. Reached only through eslint-plugin-boundaries at lint time, never shipped (`specs/m0-foundations.md:428` and the lines around it; `docs/build-notes.md:632`). The M8 exit gate wants zero open Critical/High findings (`docs/build-order.md:92`) | `osv-scanner.toml` stops ignoring it on 2027-01-11; the `ignoreGhsas` entry has no date. Review both by then and before M8 |
| Timing tests under load | The redactor's linear-time tests (best of five under 50 ms) failed once in `verify:fast` at 52 to 86 ms while two writers were installing and building, and passed alone. A green full `pnpm verify` counts only when no writer is running (`docs/build-notes.md:634`, item 5) | Lead rule |
| Redactor worst case | The slowest known input is the existing U+FDFA case: 22.1 s on a loaded box, 19.5 s before the F-lows fixes (`docs/reviews/M0a-S1.7-redactor-f-lows-security-rereview.md:18`). The earlier lows review measured about 10 s for one `redact()` over 4,900 U+FDFA strings of 1,999 characters. All shapes are linear | `docs/reviews/M0a-S1.7-redactor-lows-security-review.md:9` |
| Redactor runtimes | Reviewed on Node 22.23.3 on Windows only; the Workers runtime and browsers (Unicode tables) were not checked | `docs/reviews/M0a-S1.7-redactor-g-lows-security-rereview.md:40`; `...f-lows-security-rereview.md:36` |
| No tables yet | Tenancy checks (MT-1, MT-2, MT-11) run but guard nothing until M0b adds tables. `rls-min-count` is 0 until M0b sets it to 50 | `specs/m0-foundations.md:679`, `:1025` |
| `unreachable` branches | None are used (only the manifest `$comment` mentions the word); all 85 branches fire | `supabase/catalog-checks/manifest.json:2`; `docs/reviews/M0a-S1.7-catalog-pass-d-database-rereview.md:11` |

## 7. Autopilot decisions

### 7.1 Founder answers that shaped M0a (`docs/build-notes.md` section 0)

| Date | Decision | Cite |
| --- | --- | --- |
| 2026-10-11 | Q54: drop auto-push; later, session-end plain `git push`, never force | `:33`; CLAUDE.md "No auto-push" |
| 2026-10-11 | H1 toolchain ready; CI option (b): push before M0a closes, real CI result is the exit gate | `:34-35` |
| 2026-10-11 | Q55 (separate prod accounts at M8), Q56 (deny rules, deploys only from CI), Q57 (review-skill rows), D3 (150 KB gzip candidate budget), ABH-80 text and plan-conflicts #16 | `:36-40` |
| 2026-10-11 | Parallelism: 3 writers default, 4 max; read-only helpers up to 6 | `:32` |
| 2026-10-11 12:45 | Rule 1 catalog check: side-by-side `reports` table allowed; push through the `gh` login; work to about 95% usage | `:41-43` |
| 2026-10-11 18:55 | Backstop scope; Sonnet for mechanical writers and small re-reviews, Opus for the lead, specs and first reviews of rules 1 to 9 code; CI draft PR on every push; SessionStart hook reads the integration handoff | `:44-47` |
| 2026-10-11 20:30 | Wrap-up starts at 90% usage | `:48` |
| 2026-10-11 21:55 | `main` protection option (a); Bedrock option (a): in-region Mumbai model, picked at M5; deny-rule widening and the H3 policy delegated to the autopilot | `:49` |
| 2026-10-11 22:05 | D1 right after `m0b-reviewed` as a thin slice | `:50` |
| 2026-10-11 | Sentry deferred until before D1; repo moved to `TraceHiring/TraceHiring` | `docs/build-notes.md:627`, `docs/infra/environments.md` |

### 7.2 Autopilot changes to HOW we build (`docs/build-notes.md:624-635`; line numbers re-checked 2026-10-12)

| Change | Cite |
| --- | --- |
| Autopilot installed: one phase per session, `cp/*` checkpoints, local bundles via `scripts/backup.sh` | `:623` |
| Spec revisions 4 and 5: local `--no-ff` stream merges, S1.7 lead step owning `supabase/`, `db-types`, `shared`; "green" means a full `pnpm verify` | `:625` |
| S1.0: hook starts with the gitleaks scan only; extra deny rules for `--force-with-lease` and push delete; CI also triggers on `milestone/**` | `:626` |
| Sentry deferred; `ErrorReporter` with a no-op reporter | `:627` |
| D1 added to `docs/build-order.md` with the founder's text | `:628` |
| Prettier checks code and config only; three writers for the S1 placeholders; version pins; `vendors -> shared` allowed | `:629` |
| Integration branch merges use `chore: merge ...` messages; one exact-path exemption for the redactor's `sb_secret_` pattern | `:630` |
| Standalone demo prototype in `demo/` for `demo.tracehiring.tech`. It is **not** an M0a deliverable and no product code depends on it | `:631` |
| No handoff mirror on `main`; stream branches may have their own draft PR for Linux CI; dependency overrides and the `braces` ignore; catalog pass D narrowed by the backstop decision | `:632` |
| Windows skip exception (K4); K1 owner is the lead; K2 fixed before `milestone/m0a` moved | `:633` |
| S2 and S3 start: no `scripts/` grant (the lead wrote K1); names `VITE_APP_VERSION` and `VERSION`; W-S2 and W-S3a first as two writers, W-S3b after one has merged; stream branches cut from `fa147f8`; deny-rule widening and H3 done; timing tests under parallel load | `:634` |
| W-S3b started before the S2/S3a merges (disjoint files); a `scripts/` grant to W-S3b for its new files only; Q2 smoke URLs from wrangler's output file | `:635` |

### 7.3 ADRs

- ADR-028 (M0 runtime libraries) was a founder-approved default, not an autopilot ADR (`docs/adr/ADR-028-m0-runtime-libraries.md:3`).
- No ADR marked "Accepted (autopilot)" exists (searched `docs/adr` again on 2026-10-12, after the S2 and S3 merges: S2 and S3 created none). Their HOW-level choices are build-notes rows (7.2) and spec revision 16.

## 8. How to demo

**Now (S1 to S3 merged; 2026-10-12).** Run these in the repo checkout (Docker running for `test:rls`) or a clean clone. Each row cites where the command or its test lives. None of them was run while writing this draft.

| Show | Command | Source |
| --- | --- | --- |
| Fast checks on changed packages | `pnpm verify:fast` | `package.json` scripts; AT-4 `scripts/test/verify-fast.test.mjs` |
| Database rebuilt from zero, 112 catalog assertions, db-types drift | `pnpm test:rls` (Docker must run; `--stop` is the CI form) | `scripts/test-rls.mjs:1-25` |
| `test:rls` fails when Docker is down | Stop Docker, run `pnpm test:rls`: it exits 1 with the Docker message | AT-3, `scripts/test/test-rls.test.mjs` |
| Staged secret is blocked, and a `--no-verify` secret fails lint | The scripts suite: AT-6 and AT-6c | `scripts/test/hooks.test.mjs` |
| Worker secret allow-list fails closed | The scripts suite: AT-15 local part | `scripts/test/check-staging-secrets.test.mjs` |
| Redactor and error reporter | `pnpm --filter @trace/shared test` (618 at `a2d05fe`) | `docs/progress/LOG.md:22` |
| Build output scan | `pnpm build` (runs bundle size, headers and `scan-dist`) | `package.json` `build` script |
| Clean clone on Windows and Linux | `node scripts/verify-clean-clone.mjs` and `--linux` | `scripts/verify-clean-clone.mjs:1-5` |
| CI result | Open draft PR 1 and read the four required jobs (`deploy-staging` shows as skipped on the PR) | https://github.com/TraceHiring/TraceHiring/pull/1 |
| Worker `/health` with the injected version, JSON 404/500 | `pnpm --filter @trace/edge test` (also `@trace/jobs`, `@trace/api`); locally `pnpm --filter @trace/edge dev` then open `/health` | AT-10; `workers/edge/package.json:7` (`wrangler dev`) |
| App shells, tokens, contrast and CSP headers | `pnpm --filter @trace/candidate dev` (Vite); `pnpm build` prints the 150 kB gzip budget check and `check-headers` | AT-20, AT-21, AT-22-local; `apps/candidate/package.json:7` |
| Workflow lint over the real CI file, incl. the deploy job | `node scripts/check-workflows.mjs` (prints `check-workflows: OK`) | AT-12 local part; `scripts/test/check-workflows.test.mjs` |

**After the first staging run (CLOSE).** Planned staging addresses (not live yet): `https://trace-candidate-staging.pages.dev`, `https://trace-recruiter-staging.pages.dev`, and `https://trace-{edge,jobs,api}-staging.<subdomain>.workers.dev/health` (`docs/infra/environments.md`, Resources table). The `<subdomain>` is unknown (`docs/progress/FOUNDER-QUEUE.md:9`). Demo script: `/health` shows the deployed SHA; `/version.json` on each app; security headers via the smoke step.

## 9. Linear

Linear is not connected (`specs/m0-foundations.md:922`). List the issue changes here at CLOSE: ABH-80 (observability part only). `TODO(CLOSE)`

## Open questions for the lead (delete before copying to `docs/milestones/`)

1. **Deploy runs only on a push to `main`, and `main` moves only at CLOSE.** The deploy job's gate is `github.event_name == 'push' && github.ref == 'refs/heads/main'` and the `staging` environment is now limited to `main` (`specs/m0-foundations.md:432-433`; `docs/progress/FOUNDER-QUEUE.md:43`). `main` moves only at CLOSE through a PR (`docs/build-notes.md:46`, `:49`). So G3, G5, G6, G8 and G9 evidence can only come from the run triggered by the CLOSE merge itself. No document says how REVIEW sees that evidence before the merge. One possible order: merge the CLOSE PR, wait for `deploy-staging`, record the run URL here, then tag `m0a-reviewed`, and fix forward by a new PR if the deploy is red. Needs a decision recorded in AUTOPILOT or the spec. **Status 2026-10-12:** asked as a founder-queue row (`docs/progress/FOUNDER-QUEUE.md:11`, "How the staging gates get evidence before `m0a-reviewed`", (a) recommended); still open. The founder also said on 2026-10-12 that the autopilot stops before CLOSE and leaves `main` to the founder.
2. **N13 and N11 residuals have no milestone owner** (L7, L8). Spec revision 15 (`specs/m0-foundations.md:985`) says the summary must list them here and ties them to the backstop scope, but names no owner. Choose one, or accept them as permanent known limits.
3. **FOUNDER-QUEUE hygiene.** Resolved in part (2026-10-12): rows now exist for H5, the staging Postgres major version (`docs/progress/FOUNDER-QUEUE.md:12`), and H6, Sentry (`:13`). **M0a REVIEW (2026-10-12) answered it:** the default workflow token is read-only (read back), but branch protection, rulesets, secret scanning and push protection are **unavailable** on this repo: it is private and owned by the personal account `TraceHiring` on the Free plan (`gh api …/branches/main/protection` → 403 "Upgrade to GitHub Pro or make this repository public"; `security_and_analysis` is null). G4 (AT-13) and the L12 control ("`.github/` changes reach `main` only through a reviewed PR") cannot exist until the founder changes the plan or the owner (`docs/reviews/M0a.md` SEC-1, SEC-2; FOUNDER-QUEUE).
4. **Staging deploy is the first real run of the catalog checks on hosted Supabase.** The database-reviewer did not check the hosted catalog (`docs/reviews/M0a-S1.7-catalog-fixes-database-review.md:64`). Budget a fix-forward pass after the first AT-18 run.
5. **Resolved (2026-10-12).** HANDOFF.md was behind the repo when this draft was first written: it still listed K1 as the next step and the deny-rule widening and H3 as to-do (`docs/progress/HANDOFF.md:52-53`, `:77`), while `01bfb09` and `5e07ece` finished them, and `132e2ab` finished K3 (`:61-62`). The handoffs since then match the repo.
