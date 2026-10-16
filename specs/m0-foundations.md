# Spec — M0 Foundations · part **M0a: toolchain, pipeline and skeleton**

- **Status:** revision 18 (autopilot, 2026-10-13; m0b R5: §7.3 gains the three smoke secrets and the two M0b build variables, written inline so no line moves). Revision 17 (autopilot, 2026-10-12; M0a REVIEW Lows, written inline in §7.4, §9.2 and §10.3 so no line moves). Revision 16 (autopilot, 2026-10-12). Revision 16 applies HOW-level follow-ups from the S2 and S3a stream reviews (below). Revision 15 fixes spec text that went stale during S1.7 and the first Linux CI runs (gate finding K3, below). Revision 14 applies catalog pass D under the founder's backstop-scope decision (below). Revision 13 applies the catalog re-review fixes (pass C, below). Revision 12 applies the S1.7 review fixes and one founder answer (below). Revision 8 was **approved by the autopilot reviewers**; revisions 9, 10 and 11 only apply founder answers and day-one results (see below and the end of this file). Revision 3 was **approved by the founder 2026-10-10**. Revision 4 applies three founder instructions from 2026-10-11 and does not change the product scope: the Q54 answer (**drop auto-push, work locally only**), the autopilot (`docs/AUTOPILOT.md`), and the parallelism policy (AUTOPILOT §2). 
- **Milestone:** M0a (`docs/build-order.md` → M0 → M0a). Branch `milestone/m0a`, created from `main` at `b7af663`, with `main` at `4863db2` merged in. Tag `m0a-reviewed` after a `trace-milestone-review` PASS.
- **Revision 16 changes (2026-10-12, S2 and S3a stream reviews).** HOW-level follow-ups from `docs/reviews/M0a-S2-ui-security-review.md` and `docs/reviews/M0a-S3a-workers-security-review.md`. No product scope change.
  - **§5 `verify:fast` (S2 follow-up 2):** `docs/design/tokens.json` is an input of `@trace/ui` (§11), so a change to it selects `@trace/ui` and its dependents instead of counting as docs (`PACKAGE_INPUTS` in `scripts/verify-fast.mjs`).
  - **§5 Workers `types:gen` (S3a deviation a):** `wrangler types --strict-vars=false`, so `VERSION` is typed `string`, not the literal `"dev"`; `wrangler types --check` reads the flags from the generated file's header.
  - **§7.2 deploy job (W-S3b review, `docs/reviews/M0a-S3b-deploy-security-review.md`):** step 3 `--yes`; step 4 `-q`, `statement_timeout` and a required `sslmode`; step 5 deploys the scanned staging bundle with `--no-bundle`; step 8 reads URLs from the wrangler output file, asserts a production Pages deploy and checks the alias. Accepted residual S3B-5: runs are serialised but not ordered, so an older commit can deploy after a newer one (owner M8, before any production deploy job).
  - **§10.2 rule 7 (S3a S3A-3, plan risk 9):** `check-boundaries.mjs` fails if non-test source of the candidate app or the edge Worker names an error reporter or Sentry. Rule 6 (S1.4) is listed there too.
- **Revision 15 changes (2026-10-11, S1.7 gate finding K3).** Text fixes from `docs/reviews/M0a-S1.7-gate-spec-review.md` (K3 (a)–(e)): lines that went stale while S1.7 and the first Linux CI runs happened. No product scope change, no behaviour change, no new check.
  - **§2 `claude-*` scripts (K3 a):** they are no longer "unchanged". `claude-session-start.mjs` was rewritten in `d9bf35a`: it shows `docs/progress/HANDOFF.md` from the newest `*/integration` branch, not from the checkout, and keeps its output within 9,000 bytes (9 tests in `scripts/test/session-start.test.mjs`). `claude-usage-guard.mjs` now warns at 90% and 95% of a usage limit (`4a83998`; it was 80% and 90%). `claude-statusline.mjs` and `claude-stop-gate.sh` behave as before.
  - **§2, §4 and §7.1 dependency advisories (K3 b):** the layout lists `osv-scanner.toml` and describes the `overrides` (handlebars 4.7.10, sharp 0.35.5, undici 7.29.1) and `auditConfig.ignoreGhsas` (braces, GHSA-vfj7-8cjw-p6xm) in `pnpm-workspace.yaml`. §7.1 says how the `security` job uses them. The braces ignore ends on 2027-01-11 in `osv-scanner.toml`. The §4 osv-scanner row records the pin (v2.6.0, SHA-256 checked in `ci.yml`).
  - **§4 clean-clone image (K3 c):** AT-1a-local says the image digest is recorded in §4, but it was only in `scripts/lib/clean-clone.mjs`. §4 now has the row.
  - **§8.5 counts (K3 d):** MT-11 has 11 branches (the text said 7). The thresholds list shows the 85 branch controls of the manifest, per ID, in place of the revision 7 list of 51. The floor stays 112.
  - **§15 accepted residuals (K3 e):** the `scan-dist.mjs` residuals from the N10–N13 security re-review are recorded: compressed or encrypted content it cannot recognise under a neutral file name.
- **Revision 14 changes (2026-10-11, S1.7 catalog fix pass D).** HOW-level fixes from `docs/reviews/M0a-S1.7-catalog-pass-c-database-review.md` (E1, E2), narrowed by the founder's decision (build-notes §0 "Backstop scope"): the catalog checks, the redactor and `scan-dist` are **backstops for honest mistakes**; adversarially crafted SQL or log text is out of scope and goes on the reviewer checklist; rule 1's real enforcement is the M0b role/grant model. No product scope change.
  - **§8.5 MT-5a–5d reach (E1):** a bare schema literal counts when it is an argument of `format()`, `quote_ident()` or `set_config()` (revision 13: `format()` only).
  - **§8.5 MT-7 `body_search_path` (E1):** a function body that changes the search path is flagged.
  - **§8.5 MT-11 (E2):** `qual_without_column` and `auth_only_clause` apply to permissive policies only; a restrictive policy only narrows access (Supabase's aal2 MFA pattern, build-notes Q8).
  - **Floor:** `catalog-min-count` **112**. **Checklist:** E1 shapes (3)–(5) (literals crafted to fool the comment stripper) join the D7 reviewer item. **E3 → M0b** (policies on `auth.*`/`storage.*`/`realtime.*` relations; Known gaps).
- **Revision 13 changes (2026-10-11, S1.7 catalog fix pass C).** HOW-level fixes from `docs/reviews/M0a-S1.7-catalog-fixes-database-review.md` (D1–D11); no product scope change.
  - **§8.5 escape scope (D5):** "ours" means `postgres` is a **member** of the owner (INHERIT, SET or ADMIN), not "can SET ROLE to" it: in PostgreSQL 17 `create role` run as `postgres` grants ADMIN only, and an ADMIN-only member can grant itself SET.
  - **§8.5 new branches:** MT-5d `system_table_trigger` (D1, High: a trigger on any table `postgres` holds TRIGGER on, Supabase's `auth.*`/`storage.*` included, is a host); MT-9 `extension_owner` (D2: an extension owned by a role `postgres` is a member of); MT-5c `owner_rights_relation` (D3: matviews and non-invoker views outside the two schemas act with their owner's rights); MT-11 `auth_only_clause` (D4: a clause that references no column of its table and only calls `auth` functions; `qual_without_column` now exempts only functions in schema `private`, matched by name, so a column-free clause calling a `public` function is flagged). MT-5a–5d `prosrc_reference` strips comments and accepts a `'quality'`/`'integrity'` literal only after `format(` in the same statement (D10). Counts: 80 → **84** branch controls (MT-5c 6, MT-5d 12, MT-9 6, MT-11 11; others unchanged); `catalog-min-count` 101 → **105** (16 clean + 84 + 5 probe assertions).
  - **§8.5 `--check` (D9):** copied text must stay identical: every `-- shared:<name>` block across checks (and the IDs its begin line lists), and every `-- MT-<id> copy` block in `supabase/tests/*.sql` against its check.
  - **PostgreSQL ≥ 17 (D11):** MAINTAIN, `inherit_option`/`set_option` and `pg_has_role(…, 'SET')` need it; AT-18 confirms staging runs 17.
  - **Deferred with owners (D6–D8):** see "Known gaps" at the end of §8.5.
- **Revision 12 changes (2026-10-11, S1.7 catalog fix pass).** HOW-level fixes from the S1.7 database reviews (`docs/reviews/M0a-S1.7-database-review.md`, `docs/reviews/M0a-S1.7-w3b-w2-database-review.md`), plus one founder answer; no product scope change.
  - **§8.5 scope:** `pg_inherits` descendants join partitions; the system-list schemas where `postgres` can create are inspected for hand-made objects (MT-7, MT-9) and MT-8b checks every system-list schema's owner.
  - **§8.5 branches:** 51 → 80 (MT-1 4, MT-2 3, MT-3 3, MT-4 6, MT-5a 6, MT-5b 5, MT-5c 5, MT-5d 11, MT-6 6, MT-7 3, MT-8 4, MT-8b 2, MT-9 5, MT-10 4, MT-11 10, MT-12 3); `catalog-min-count` 71 → 101.
  - **Founder answer (2026-10-11, rule 1, `docs/build-notes.md` §0):** side by side is allowed. See the MT-5d row.
  - **§9.1 idempotence:** a `code` value kept by a first `redact()` pass may be redacted by a second pass (over-redaction only), because trusting `code` on any error-shaped plain object would weaken the stem rule. Everything else stays idempotent and the property test generates Errors.
- **Revision 11 changes (2026-10-11, S1.7 database half).** Day-one results and HOW-level changes only (AUTOPILOT §4); no product scope change.
  - **Day-one results (§8.2), local stack on CLI 2.120.0, PostgreSQL 17.11:** `postgres` is not a superuser and owns what migrations create; pgTAP is installed by `supabase test db` `with schema extensions`, owned by `supabase_admin`, and `anon`/`authenticated` keep EXECUTE (no fallback needed); `supabase test db` recurses into sub-directories and runs every `.sql` file; `postgres` has CREATE on `extensions`; `pg_read_all_data` members are `postgres` (ADMIN), `supabase_etl_admin` and `supabase_read_only_user`, `pg_write_all_data` has none and `postgres` lacks ADMIN on it (the MT-5c fixture uses `pg_read_all_data`); PostgreSQL accepts every MT-11 `CREATE POLICY` form, so no branch is `unreachable`; every schema on the stack is on the §8.5 system list; `supabase start -x` names are `gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`, and `gen types --local` works with `postgres-meta` excluded. Recorded in `supabase/catalog-checks/README.md`.
  - **§8.3 step 5:** the harness runs `supabase test db --debug`. Without `--debug`, pg_prove prints only one status line per file, so assertions could not be counted by prefix. The harness also fails on a test file whose name is not `catalog_*` or `rls_*`, and when the number of files run differs from the `.sql` files under `supabase/tests/`.
  - **§8.5 output and assertions:** every check returns `(branch, object, detail)`, and each positive-control assertion filters on `branch = '<branch>'`. The spec text asserted only that the check returns rows, so one branch's fixture could have hidden a broken predicate on another. This is stricter than revision 10.
  - **§10.2:** the exempt regex text is `sb_secret_[\w-]*` (the backslash was missing; S1.4 security re-review N6).
  - **Integration branch:** the earlier integration branch `claude/trace-autopilot-continue-8d4785` ends in a demo WIP commit. Production work continues on `claude/trace-autopilot-production-87e5e2`, cut from `da5c5ca` (its last production commit); the demo lives on `demo/d1-prototype`.
- **Revision 10 changes (2026-10-11, infra-setup session).** Founder instructions for the one-time infra setup. No product scope change.
  - **Repo moved:** the GitHub home is now **`TraceHiring/TraceHiring`** (private), not `AbhayRajGit/Tracehiring` (founder, 2026-10-11). H3 and the §7.2 deploy gate use the new name.
  - **Sentry deferred until before D1** (founder, 2026-10-11). M0a ships an `ErrorReporter` interface with a **no-op** implementation instead of the Sentry SDK (§9.2). The Sentry adapter, `scrubSentryEvent`, H6, the `SENTRY_DSN_*` variables and the Sentry CSP host move to a deferred item owned by "before D1". Sentry is **not** an M0a exit-gate blocker; it **is** a blocker before D1. Which milestone "D1" is, is not defined in the repo and is a founder-queue item.
  - **Staging names recorded:** every staging/dev resource name, region and plan is in `docs/infra/environments.md`. D5's names are unchanged.
- **Revision 9 changes (2026-10-11).** Founder answers (build-notes §0, 2026-10-11) and the S1.0 day-one results. No product scope change.
  - **H1 done.** Node 22.23.3, pnpm 12.11.2, gitleaks 8.30.1, Docker 29.5.2, verified by the autopilot.
  - **CI exit gates: option (b).** At the end of every session the autopilot pushes `main`, the milestone branch and all tags to `trace` with plain `git push` (AUTOPILOT §6). CI runs on push, and M0a's exit gate uses the real CI result. Every item in the §13.1 "Deferred" column is now owned by **M0a CLOSE**. The repo is private.
  - **CI trigger** (§7.1): `push` to `main` **and to `milestone/**`**, plus `pull_request`, so the milestone branch gets a real CI run when it is pushed. The deploy gate (§7.2) is unchanged: push to `main` only.
  - **Q56 / H7 approved:** the deny rules are in `.claude/settings.json` (S1.0). **Q55 approved** (D5). **D3 approved** (150 KB gzip). **Q57 approved.**
  - **ABH-80 "Done when"** is now known (build-notes §0; plan-conflicts #16). M0a owns only "no candidate PII is found in logs (scan)"; §13.1 cites it.
  - **Day-one results (S1.0):** pnpm 12's build-script allow-list is `allowBuilds:` in `pnpm-workspace.yaml` (so S1.0 creates that file with `lefthook: true`; S1.1 adds the workspace globs and catalog); `gitleaks git` scans every ref by default (no `--log-opts` needed); `gitleaks git --pre-commit --staged` exists as specified; `lefthook install` on 2.2.1 leaves `post-commit.disabled` alone. On Windows, lefthook runs each command as `sh -c "<cmd>"`, so a hook command may not contain double quotes.
  - **Pre-push scan (§6):** a lefthook `pre-push` command and an explicit step in AUTOPILOT §6 run the full-history gitleaks scan before every push (security review of S1.0, High).
  - **New edge case (§15):** a checkout with no `node_modules` can't find lefthook, and lefthook's generated hook then prints "Can't find lefthook in PATH" and lets the commit through.
  - **New open item (§17 item 8):** branch protection that requires PRs on `main` would reject the session-end `git push` of `main`. AT-13 needs a design that fits both. The founder queue holds the options, and the autopilot waits for an explicit answer.
- **Revision 8 changes (2026-10-11).** These are the Low notes from the approving reviews of revision 7.
  - **App smoke tests** use `react-dom/server` `renderToString` in Node, so no DOM library is needed.
  - **MT-12 branches redefined:**
    - (a) the global function entry is missing;
    - (b1) a global entry grants to PUBLIC;
    - (b2) a per-schema entry grants to a listed role.
  - **Day-one ADMIN check:** confirm that `postgres` holds ADMIN OPTION on `pg_read_all_data` and `pg_write_all_data` (MT-5c fixture).
  - **MT-11 fixture:** the "SELECT or DELETE without USING" fixture uses whichever command PostgreSQL accepts.
  - **`unreachable` branches:** allowed only for the named MT-11 branches, and only with the recorded PostgreSQL error. A branch that is reachable at the base can never become unreachable later.
- **Revision 7 changes (2026-10-11).** This revision fixes the findings on revision 6. `spec-reviewer` found 1 Blocking, 2 Medium and 1 Low. `database-reviewer` approved, with 7 Low.
  - **Every checkpoint can now go green:**
    - S1.1–S1.3 form one checkpoint, so `@trace/config` exists before any workspace config uses it.
    - Every placeholder has one real smoke test; there is no `passWithNoTests`.
    - The Worker and service placeholders include `wrangler.jsonc` and the committed `wrangler types` output.
    - A check joins `verify` only once both the script and the files it checks exist. That means `check-workflows` joins at S1.5, and `check-boundaries` treats a missing `config.toml` like `check-migrations` does.
  - **§14 table:** now has a Scope column, so every row has the same number of cells.
  - **Missing base manifest:** counts as the empty set.
  - **Owners:** AT-6 and AT-6c are owned by S1.4, AT-7 by S1.6.
  - **Branch controls:**
    - MT-1 now has 2 branches, MT-2 3, MT-5b 3, MT-5c 3 and MT-6 4, giving 51 branch controls and a floor of 71.
    - The spec now gives the MT-12(a) PUBLIC fixture recipe.
    - MT-12(b) no longer flags PostgreSQL's built-in PUBLIC USAGE on types.
    - A day-one check confirms the MT-11 fixtures can be created.
    - The stale sentence about positive controls is fixed.
- **Revision 6 changes (2026-10-11).** This revision fixes the re-review findings on revision 5. `spec-reviewer` found 1 Blocking, 2 Medium and 5 Low; `database-reviewer` found 2 Medium and 8 Low.
  - **Making `pnpm verify` reachable at every step:**
    - §5 now says how `verify` grows step by step.
    - S1.2 writes buildable placeholders for every workspace, so S3 builds without S2.
    - `check-migrations` accepts a missing `supabase/migrations/` until `supabase/config.toml` exists.
  - **Positive controls per branch.** There is now one positive control **per branch** of every multi-branch check, and the manifest lists the branches. The floor is recomputed to 65.
  - **MT-1 and MT-2 fixtures** are split.
  - **Floor and manifest comparison:**
    - the base is resolved the same way as for `check-migrations`;
    - a floor that is missing at the base counts as 0;
    - the base manifest must be a subset of the current one.
  - **Checks tightened:**
    - MT-9's `extensions` branch is limited to objects owned by `postgres`, because Supabase's own helpers are owned by `supabase_admin`;
    - MT-12(b) also catches grants to PUBLIC;
    - MT-4(b) uses `aclexplode`;
    - MT-5c covers `pg_read_all_data` and `pg_write_all_data`, and does not expand the owner.
  - **Frozen set:** the union of the base tip and every `m*-reviewed` tag that is an ancestor of HEAD.
  - **`test:rls` lock:** moved to the OS temp dir, keyed by project, so clean clones share it.
  - **Prettier:** ignores `database.ts`.
  - **Ownership and lists:**
    - S2 owns `packages/ui/` and `packages/vendors/`, except the lead-only files;
    - the §7 banner points to §13.1;
    - a new edge case covers a gitleaks finding on another stream's branch.
- **Revision 5 changes (2026-10-11).** This revision fixes every finding from the autopilot's two reviews of revision 4: `spec-reviewer` found 3 Blocking, 7 Medium and 7 Low; `database-reviewer` found 2 Blocking, 7 Medium and 10 Low.
  - **`check-migrations`:**
    - The base comes from `--base`, then `MIGRATIONS_BASE`, then `main`. A missing ref fails loudly, never passes vacuously.
    - `verify-clean-clone` creates `main`, and CI uses `origin/main`.
    - The script diffs against the working tree, compares with the base tip, and has a frozen set that holds on `main` itself (§8.4).
  - **Clean-clone container:** it installs gitleaks with checksum verification, and its image is pinned by digest (AT-1a-local).
  - **Catalog checks get positive controls.** Each check has a fixture that must make it fire, so none can pass vacuously.
  - **New checks:**
    - MT-5d (foreign keys, triggers and policies that cross schemas);
    - MT-8b (unknown schemas);
    - MT-12 (`pg_default_acl`).
  - **Tightened checks:**
    - MT-4, MT-5a/b/c, MT-6, MT-7, MT-9, MT-10 and MT-11;
    - the extension-member exemption.
  - **Floors:**
    - a required-ID manifest;
    - floors that can only go up, enforced against the base;
    - the staging run uses `psql -X -v ON_ERROR_STOP=1`.
  - **`test:rls`:**
    - holds a lock shared by all worktrees, because they share one local stack;
    - checks db-types drift against a temp file, with `--schema public`.
  - **pgTAP day-one check:** confirms that test roles keep EXECUTE after the global revoke, with a fallback if they don't.
  - **Lead session (S1.7) now owns:**
    - the whole `supabase/` skeleton and harness;
    - `packages/db-types`;
    - the logger, redactor and Sentry scrubber (revision 10: the `ErrorReporter` interface and no-op reporter instead; the scrubber moves to before D1).
  - **Streams:** S2 (`ui`, `vendors`, apps) and S3 (Workers, services, deploy job) need nothing from each other.
  - **Green sub-step** means a full `pnpm verify` before any `cp/*` tag.
  - **Secrets:** the edge cases cover a secret that is reachable from a tag, a rescue branch or a bundle.
  - **AT-16:** has a local proxy (`scan-dist.mjs` in `build`).
  - **AT-22:** split into a local half and a staging half.
  - **One list of deferred items:** with an owner that waits for the founder's answer.
  - **§7.4:** describes how the first push works with local `--no-ff` merges; "linear history" is dropped.
  - **Smaller fixes:**
    - AT-6 and AT-6c read the real commands from config;
    - AT-24 sets bundle mtimes and needs `sh`;
    - reviewers run on every step;
    - stale references fixed;
    - an approval section added.
- **Revision 4 changes (2026-10-11):**
  - **Q54 = drop.** The auto-push hook was disabled on 2026-10-11 (`.git/hooks/post-commit.disabled`), and CLAUDE.md line 41 was replaced in `b4c56a4`. `scripts/git-autopush.sh`, AT-6b and the push-path state machine are gone (§2, §6, §13, §15).
  - **Local-only mode.** Nothing is pushed until the founder says so:
    - streams merge into `milestone/m0a` with `git merge --no-ff`, and `milestone/m0a` merges into `main` the same way at CLOSE, not by PR (AUTOPILOT §2);
    - every green sub-step gets a `cp/m0a-<NN>` tag (AUTOPILOT §5).
  - **CI and staging stay in scope.** `ci.yml` and the staging deploy are written and unit-tested locally, but they can only run once the founder pushes to GitHub and completes H3–H6. Until then their exit-gate items are **Deferred gates** with local proxy tests (§13.1). Whether M0a may close that way is a founder-queue item.
  - **New local proxies:**
    - `lint` runs a full-history gitleaks scan (AT-5, AT-6c);
    - `scripts/verify-clean-clone.mjs` covers AT-1a-local and AT-1b;
    - AT-24 tests `scripts/backup.sh`.
  - `verify:fast` no longer falls back to `trace/main`. `lint` now runs `check-migrations.mjs --base main`, because CI's `migrations` job doesn't run locally.
  - **Parallelism policy.** Root `package.json`, the lockfile, migrations and the `packages/shared` contracts are changed only by the lead session (§14). S1 therefore now creates every workspace's `package.json` and the lockfile, and a new lead step **S1.7** writes the baseline migration and the shared contracts before S2 ∥ S3 start.
  - The founder prerequisites H1–H7 are tracked in `docs/progress/FOUNDER-QUEUE.md`, together with what each one blocks.
- **Revision 3 changes:**
  - Added §13.1, which maps each M0a exit-gate item to its acceptance tests.
  - Added §9.4 (zod contracts), §15.1 (state machines) and §15.2 (plan §11 rows that touch M0a).
  - §6: the current hook logs to the wrong file in worktrees.
  - §14: worktree paths, lockfile rule and the 3-writer cap.
  - §17: ABH-80's "Done when" line isn't in the repo, and Linear isn't connected.
  - No decision from revision 2 was changed.
- **Sources:**
  - CLAUDE.md
  - `docs/build-order.md` M0a and rules 5–6
  - `docs/build-notes.md` §0 (decisions), §3 (layout and toolchain), Q5, Q12–Q17, Q54–Q57
  - [ADR-027](../docs/adr/ADR-027-phase0-compute-on-workers.md)
  - plan §8, §10.1, §12
  - `.claude/skills/trace-milestone-review/SKILL.md` gates G1–G11
- **M0b** (tenancy schema, ≥50 RLS tests, org auth, audit log, candidate-token spike) gets its own section after `m0a-reviewed`. See §16.

---

## 1. Scope

### In scope
1. **pnpm monorepo** with every workspace listed in build-order M0a. Each Worker ships only a health endpoint and each app only a shell page.
2. **Toolchain:**
   - strict TypeScript, ESLint and Prettier, all shared from `packages/config`
   - Vitest, including tests that run in the Workers runtime
   - git hooks
   - LF line-ending normalisation
3. **Root scripts:** `pnpm verify` and `pnpm verify:fast`, plus the helper scripts they call.
4. **Supabase skeleton:**
   - `config.toml`
   - one **baseline migration**: schema and privilege lockdown only, no tables
   - the **pgTAP harness**
   - **catalog checks** (§8.5) that guard tenancy, rules 1, 2, 7 and 9, and view and function safety for every future table
5. **CI (GitHub Actions):** static, RLS-harness, security and migration jobs, then **deploy to staging from CI only**. Staging gets Pages ×2, Workers ×3 and Supabase migrations, and the catalog checks are re-run against the staging database.
6. **Observability skeleton:**
   - a PII-redacting JSON logger
   - an `ErrorReporter` interface used by the recruiter app, `workers/jobs` and `services/api`, with a **no-op** implementation in M0a (revision 10; the Sentry adapter comes before D1, §9.2) — **never on `workers/edge` or the candidate app** (build-notes Q17)
   - a health-check contract
7. **Design tokens pipeline:** `docs/design/tokens.json` is turned into CSS variables and TS constants, with a contrast test.
8. **Boundary enforcement:**
   - ESLint import boundaries
   - a secret-boundary script, plus a deploy-time check of which secrets are bound to each Worker (ADR-027, CLAUDE.md Tenancy)
   - a workflow-safety check
   - browser security headers on both apps
9. **ADR-028, "M0 runtime libraries"** (zod, Hono, React Router), per build-notes Q13 (accepted).

### Out of scope (later)
- Any table, RLS policy, auth or audit log → **M0b**.
- The Sentry SDK and adapter for the recruiter app, jobs and api → **before D1** (revision 10, §9.2). Not an M0a blocker.
- A Sentry SDK on the candidate app or edge → only after counsel approves (build-notes Q17). Until then, edge logs to Workers Logs and the candidate app logs to the console.
- PostHog (M6); Playwright and axe (M3a/M3b).
- Queues, R2 and Durable Object bindings → each arrives with the milestone that first needs it, after the free-plan check (build-notes risk 19).
- IaC: there is no `infra/` folder. Cloudflare is configured through `wrangler.jsonc` and GitHub through the recorded `gh api` commands in §7.4.

### Founder prerequisites (H)
Every open H item is a row in `docs/progress/FOUNDER-QUEUE.md`. The "Blocks" column below says which step waits for it. Everything else goes ahead (AUTOPILOT §3).

| # | Item | Done when | Blocks |
| --- | --- | --- | --- |
| H1 | ~~Machine fixed per build-notes Q5~~ **Done 2026-10-11:** Node 22.23.3, pnpm 12.11.2 via Corepack, Docker 29.5.2 running, gitleaks 8.30.1 (verified by the autopilot) | Recorded | — |
| H2 | ~~Answer Q54~~ **Done 2026-10-11: drop auto-push, work locally only** (build-notes §0) | Recorded | — |
| H3 | *(needed: the founder chose option (b), 2026-10-11; the repo is private)* GitHub, on **`TraceHiring/TraceHiring`** (revision 10; was `AbhayRajGit/Tracehiring`):<br>• create environment `staging` with **deployment branches limited to `main`**<br>• add the secrets and variables in §7.3 (names and owners: `docs/infra/environments.md`)<br>• set the repo's default `GITHUB_TOKEN` permission to **read-only**<br>• enable **secret scanning and push protection** if your plan offers them for this repo<br>• ~~tell me whether the repo is public or private~~ private | `gh api repos/TraceHiring/TraceHiring/environments/staging` shows the branch policy | Running CI and the staging deploy (AT-1a-CI, AT-11, AT-13, AT-18, AT-22-staging) |
| H4 | Cloudflare:<br>• account with a registered `*.workers.dev` subdomain<br>• an API token limited to this account with Workers Scripts: Edit, Cloudflare Pages: Edit, Account Settings: Read | Token stored as a `staging` secret | Running the staging deploy (AT-11) |
| H5 | Supabase:<br>• `trace-dev` and `trace-staging` in Mumbai (`ap-south-1`)<br>• the **staging session-pooler connection string** (with password), stored as a secret. CI needs no Supabase personal access token (security review #9).<br>• in `trace-staging` API settings, exposed schemas = `public` only; tell me the Postgres major version (for `[db] major_version`, §8.1) | Stored as a `staging` secret | Staging migrations (AT-18) |
| H6 | **Deferred until before D1** (founder, 2026-10-11; revision 10). Sentry:<br>• projects `trace-recruiter` and `trace-workers`<br>• pick the **data region** (there is no India region; tell me which)<br>• turn on **"Prevent storing of IP addresses"** and **server-side data scrubbing** in both projects | DSNs stored as `staging` variables; region recorded in ADR-027 | **Nothing in M0a.** Blocks the pre-D1 Sentry adapter (AT-9-sentry, §9.2). |
| H7 | ~~Approve the Q56 deny rules~~ **Approved 2026-10-11:** staging deploys only from CI, never from a local session | Rules added in S1.0 | — |

---

## 2. File layout (what M0a creates)

```
/
├─ package.json                 private; scripts §5; "packageManager": "pnpm@12.11.2"; engines node ">=22.22 <23"; "prepare": "lefthook install"
├─ pnpm-workspace.yaml          apps/*, packages/*, workers/*, services/*; catalog (§4); build-script allow-list; overrides (patch pins for handlebars, sharp, undici) and auditConfig.ignoreGhsas (braces): §7.1
├─ osv-scanner.toml             ignored advisories for the CI osv-scanner step: braces (GHSA-vfj7-8cjw-p6xm), with a reason, until 2027-01-11 (§7.1)
├─ pnpm-lock.yaml   .node-version (22.23.3)   .npmrc (engine-strict=true, shell-emulator=true)
├─ .gitattributes               exists since b4c56a4 (*.sh text eol=lf); S1.2 extends it: * text=auto eol=lf; *.png *.ico *.woff2 binary
├─ .gitignore                   + .dev.vars* , .wrangler/, dist/, coverage/, .claude/worktrees/, .claude/.last-green, .claude/.stop-gate-tries
├─ .editorconfig  .prettierrc.json  .prettierignore  eslint.config.js  tsconfig.json (solution file)
├─ lefthook.yml  commitlint.config.js  .gitleaks.toml
├─ .github/
│  ├─ workflows/ci.yml          one workflow: required checks + guarded deploy-staging job (§7)
│  └─ dependabot.yml            ecosystems: github-actions, npm (grouped by catalog)
├─ apps/
│  ├─ candidate/                Vite + React shell ("/" shows product name + version); public/_headers; no Sentry, no analytics
│  └─ recruiter/                Vite + React + React Router shell ("/", "/health"); public/_headers; ErrorReporter (no-op until D1)
├─ packages/
│  ├─ config/                   tsconfig.base.json, eslint/ (flat config + boundaries + log-message rule), vitest presets; rule fixture tests
│  ├─ shared/                   src/log/ (logger, redactor, error serialiser), src/health.ts (zod), src/version.ts; tests
│  ├─ ui/                       scripts/build-tokens.mjs, tokens.extensions.json, src/generated/{tokens.css,tokens.ts}, src/contrast.ts; tests
│  ├─ vendors/                  README + empty barrel; each interface + mock arrives with its first milestone (Messaging M2, LlmDrafter M1, …)
│  └─ db-types/                 src/database.ts from `pnpm exec supabase gen types typescript --local`; drift-checked
├─ workers/
│  ├─ edge/                     Hono: GET /health. wrangler.jsonc (envs dev, staging). No secrets, no Sentry
│  └─ jobs/                     Hono: GET /health. ErrorReporter (no-op until D1). No queue/cron bindings yet
├─ services/api/                Hono: GET /health; src/modules/ (empty + README on module rules); ErrorReporter (no-op until D1)
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/<ts>_m0a_baseline.sql
│  ├─ seed.sql                  empty; comment: synthetic data only
│  ├─ catalog-checks/           MT-*.sql — plain "violation" queries (return rows = violation); single source of truth (§8.5)
│  │  ├─ manifest.json          required check IDs (§8.5)
│  │  └─ fixtures/MT-*.violation.sql   positive controls: each creates one violating object (§8.5)
│  └─ tests/
│     ├─ catalog_meta.test.sql      GENERATED from catalog-checks/ by scripts/gen-catalog-tests.mjs; drift-checked
│     ├─ catalog_probe.test.sql     hand-written probes (MT-4b)
│     ├─ catalog-min-count          floor for catalog_* assertions (may only go up)
│     └─ rls-min-count              floor for rls_* assertions: "0" in M0a, "50" from M0b (may only go up)
├─ scripts/
│  ├─ verify-fast.mjs  test-rls.mjs  gen-catalog-tests.mjs  check-migrations.mjs  check-boundaries.mjs
│  ├─ check-workflows.mjs  check-bundle-size.mjs  check-headers.mjs  check-staging-secrets.mjs
│  ├─ scan-dist.mjs             gitleaks dir over every dist/ (AT-16 local)
│  ├─ verify-clean-clone.mjs    clone HEAD into a temp dir, then `pnpm i --frozen-lockfile && pnpm verify` there (AT-1a-local, AT-1b)
│  ├─ lib/ (git, workspace map, TAP parser)   test/*.test.mjs (Vitest; includes backup.test.mjs for AT-24)
│  ├─ backup.sh                 existing (autopilot, b4c56a4); gains a test (AT-24), behaviour unchanged
│  ├─ claude-session-start.mjs  SessionStart hook, rewritten in d9bf35a: shows HANDOFF.md from the newest */integration branch, output within 9,000 bytes; tested by test/session-start.test.mjs
│  ├─ claude-usage-guard.mjs    PostToolUse hook; warns at 90% (finish the step, then wrap up) and 95% (stop now) of a usage limit since 4a83998
│  └─ claude-statusline.mjs, claude-stop-gate.sh   existing; behaviour unchanged
├─ docs/adr/ADR-028-m0-runtime-libraries.md
└─ docs/milestones/M0a-summary.md   (end of milestone; includes the Deferred gates table)
```

**Package names:** `@trace/candidate`, `@trace/recruiter`, `@trace/config`, `@trace/shared`, `@trace/ui`, `@trace/vendors`, `@trace/db-types`, `@trace/edge`, `@trace/jobs`, `@trace/api`.

Internal libraries are source-only: `exports` points at `src/index.ts`, they have no `build` script, and the apps and Workers bundle them.

---

## 3. Decisions specific to M0a

| # | Decision | Why |
| --- | --- | --- |
| D1 | Workers use **Hono**. Apps use **React Router 8 in library (data-router) mode**. | No SSR is needed. ADR-028 records both, plus zod. |
| D2 | Styling is CSS Modules on generated CSS variables. No Tailwind, no CSS-in-JS. | Keeps the candidate bundle light. Tailwind would need an ADR. |
| D3 | Candidate app: initial JS ≤ **150 KB gzip**, enforced in CI. | Protects the plan §12 target of p95 < 3 s on 4G. You can change the number. |
| D4 | `tokens.json` stays the design source. Additions go in `packages/ui/tokens.extensions.json`, marked *pending design sign-off*: `color.border.input` = `#8A8F98` (3.25:1 on white) and `color.focus.ring` = accent. | `border.default` is 1.30:1, which fails WCAG 1.4.11 for form controls. |
| D5 | Staging resources are named `trace-<app>-staging` (Pages) and `trace-<worker>-staging` (Workers). **Prod at M8 lives in a separate Supabase org and a separate Cloudflare account** (build-notes Q55), so a staging credential can never reach prod. | Isolation comes from authorisation, not just naming (security review #9). |
| D6 | No Worker in M0a holds any Supabase credential. | Nothing calls the database at runtime yet. The boundary checks still run, so the rule is enforced before the first key exists. |
| D7 | The Supabase CLI always runs as `pnpm exec supabase` (pinned 2.120.0) in scripts and CI, never the global binary. | The machine's global CLI is 2.109.1. |

---

## 4. Toolchain pins (checked against npm and nodejs.org on 2026-10-10)

Shared versions live in the `catalog:` of `pnpm-workspace.yaml`. Dependabot groups updates by catalog entry.

| Tool | Pin | Constraint that fixes the major version |
| --- | --- | --- |
| Node | 22.23.3 | Founder decision. React Router 8.4.0 needs `>=22.22.0`. |
| pnpm | 12.11.2 | — |
| TypeScript | **6.0.3** (not 7.0.2) | typescript-eslint 8.71.1 needs `<6.1.0` |
| typescript-eslint | 8.71.1 | — |
| ESLint / @eslint/js | **9.39.5** (not 10.12.0) | eslint-plugin-jsx-a11y 6.10.2 supports at most ESLint 9 |
| eslint-plugin-jsx-a11y / react-hooks / boundaries | 6.10.2 / 7.1.1 / 7.2.0 | — |
| Prettier | 3.9.10 | — |
| Vitest | **4.1.11** (not 5.0.3) | @cloudflare/vitest-pool-workers 0.23.0 needs `^4.1.0` |
| @cloudflare/vitest-pool-workers | 0.23.0 | — |
| wrangler | 4.149.0 | Workers types come from `wrangler types`; output is committed and drift-checked |
| Vite / @vitejs/plugin-react | 8.3.4 / 6.1.2 | The plugin needs `vite ^8` |
| React / React DOM | 19.3.0 | React Router 8 needs `>=19.2.7` |
| React Router | 8.4.0 | — |
| Hono | 4.13.13 | — |
| zod | 4.6.5 | — |
| ~~@sentry/react / @sentry/cloudflare~~ | ~~11.6.0~~ | **Not installed in M0a** (revision 10). Re-checked and pinned when the Sentry adapter lands before D1. |
| Supabase CLI (`supabase` devDependency) | 2.120.0 | D7 |
| lefthook | 2.2.1 | — |
| @commitlint/cli + config-conventional | 21.2.3 | — |
| gitleaks | 8.30.1 | winget locally. CI downloads the release binary with checksum verification **in the shared setup**, so every job has it (AT-6 runs in `static`). |
| osv-scanner | v2.6.0. The SHA-256 of the `osv-scanner_linux_amd64` release binary is checked in `ci.yml` before the binary runs | Not on npm. Reads `osv-scanner.toml` (§7.1) |
| Clean-clone container image (AT-1a-local) | `node:22.23.3@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8` | The multi-arch image index digest from `docker buildx imagetools inspect node:22.23.3`, read on 2026-10-11 (`scripts/lib/clean-clone.mjs`). Change it together with the Node pin above. |

TypeScript base config:
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`
- `verbatimModuleSyntax`, `isolatedModules`
- `module: ESNext`, `moduleResolution: bundler`, `target: ES2022`, `skipLibCheck`

**Day-one checks** (verified, never assumed):
- the key name pnpm 12 uses for the build-script allow-list (`workerd`, `esbuild`, `supabase`)
- the exact `gitleaks git` pre-commit flags in 8.30.1 `--help`
- whether `supabase test db` recurses into sub-directories (the design below doesn't need it to)
- the `supabase start -x` service names on 2.120.0

---

## 5. Root scripts

| Script | Command |
| --- | --- |
| `typecheck` | `pnpm -r --if-present typecheck` (each package: `tsc --noEmit -p .`; Workers also check that `wrangler types` output is current) |
| `lint` | `pnpm -r --if-present lint && prettier --check . && node scripts/check-boundaries.mjs && node scripts/check-workflows.mjs && node scripts/gen-catalog-tests.mjs --check && node scripts/check-migrations.mjs && gitleaks git --redact --no-banner` (each package: `eslint . --max-warnings=0`; `@trace/ui` also runs `tokens:check`). `check-migrations` takes its base from `MIGRATIONS_BASE` (default `main`; §8.4). The last command scans the **full local history of every ref** for secrets (the local proxy for AT-5) and fails if gitleaks is missing. Day-one check: confirm that gitleaks 8.30.1 `git` mode scans `--all` by default, and pass `--log-opts="--all"` if it doesn't. |
| `test` | `pnpm -r --if-present test && vitest run --root scripts` |
| `test:rls` | `node scripts/test-rls.mjs` (§8.3) |
| `build` | `pnpm -r --if-present build && node scripts/check-bundle-size.mjs && node scripts/check-headers.mjs && node scripts/scan-dist.mjs`. `scan-dist.mjs` runs `gitleaks dir --redact --no-banner` over every app and Worker `dist/`. It fails on a finding, or if it finds no `dist/` at all (AT-16 local). |
| **`verify`** | `pnpm typecheck && pnpm lint && pnpm test && pnpm test:rls && pnpm build` (exactly the CLAUDE.md list). `test:rls` joins `verify` in S1.7, the step that creates the database. Before S1.7, `verify` is the other four. |
| **`verify:fast`** | `node scripts/verify-fast.mjs` (Stop hook) |

**How `verify` grows during M0a.** A check joins `lint`, `test` or `build` only once both the script and the files it checks exist. So `pnpm verify` never calls a missing script and never fails on a missing target. Until S1.7, `check-boundaries` (item 4) and `check-migrations` read a missing `supabase/config.toml` as "no database yet". From S1.7 on, both require it. A step is green when `pnpm verify`, as it stands at that step, passes (§14).

| After step | `pnpm verify` runs |
| --- | --- |
| S1.0 | Nothing yet, because `verify` isn't defined. S1.0 is green when AT-6 (run by hand, output recorded) and a full-history `gitleaks git` scan both pass. |
| S1.1–S1.3 (one checkpoint) | `typecheck`; `lint` (ESLint, Prettier, full-history gitleaks); `test`, which is `pnpm -r test` with one smoke test per placeholder; and `build`, which is `pnpm -r build` |
| S1.4 | the above, plus: `vitest run --root scripts` in `test`; `check-boundaries` and `check-migrations` in `lint`; `check-bundle-size`, `check-headers` and `scan-dist` in `build` |
| S1.5 | the above, plus `check-workflows` in `lint`, now that `ci.yml` exists |
| S1.6 | the above, plus the commitlint tests (AT-7) |
| S1.7 onward | the full list in the table above. `gen-catalog-tests --check` joins `lint`, and `test:rls` joins `verify`. |

S1.7 adds `scripts/test/root-scripts.test.mjs`. It fails if the root `lint`, `build` or `verify` scripts lack any command in the table above.

### `verify:fast` algorithm
1. **Pick the base:**
   - `git merge-base HEAD main`
   - if that fails, treat everything as changed. There is no remote fallback: we work locally, so a remote-tracking ref may be stale.
2. **Collect changed files:** `git diff --name-only <base>` (working tree versus base) plus `git ls-files -o --exclude-standard`.
3. **Run everything** if any changed path is a global file:
   - root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`
   - anything under `packages/config/` or `scripts/`
   - anything outside a workspace directory, except `docs/**`, `specs/**` and `*.md`
4. **Docs-only changes:** run `prettier --check` on those files only. *(Revision 16)* `docs/design/tokens.json` is not docs here: it selects `@trace/ui` (step 5).
5. **Otherwise:** run `typecheck`, `lint` and `test` for the changed packages and their dependents (`pnpm --filter "...<pkg>"`), then `prettier --check` on the changed files.
6. **Hard limits:** no Docker, no `build`, no network. Exit non-zero on any failure. Print the last 60 lines of output. Target: under 2 minutes.

---

## 6. Git hooks (`lefthook.yml`)

> **Revision 9:** the founder allowed plain pushes at session end (option (b), 2026-10-11). Nothing pushes *automatically*, but there is now a push path, guarded by the `pre-push` scan below and the explicit scan in AUTOPILOT §6.
>
> **Q54 = drop (founder, 2026-10-11).** *(Revision 8 text.)* There is no automatic push path. The old auto-push hook was renamed to `.git/hooks/post-commit.disabled` on 2026-10-11, so git no longer runs it. S1.0 is still the first commit of M0a: it puts the secret scan in front of every later commit. Day-one check: confirm that `lefthook install` on 2.2.1 leaves `post-commit.disabled` alone.

| Hook | Command | Behaviour |
| --- | --- | --- |
| `pre-commit` | `gitleaks git --pre-commit --staged --redact --no-banner` | **Fails** if gitleaks is missing (prints an install hint). Never skips. |
| `pre-commit` | `prettier --check {staged_files}` | Joins in S1.1, when Prettier is installed (revision 9). |
| `commit-msg` | `commitlint --edit {1}` | Conventional commits. `wip` is allowed. Joins in S1.6 (revision 9). |
| `post-commit` | — | None. Nothing pushes automatically. |
| `pre-push` *(revision 9)* | `gitleaks git --redact --no-banner` | Full-history scan of every ref before a push leaves the machine; fails if gitleaks is missing. Added because the founder allowed plain pushes (option (b)) and cherry-picks, rebases, merges and `--no-verify` commits never run pre-commit. AUTOPILOT §6 also runs the same scan explicitly before the session-end push, so a checkout without `node_modules` is still covered. |

`lefthook install` runs from the root `prepare` script, so a fresh clone gets the hooks on `pnpm i`.

**Commits that skip the hook.** `--no-verify` and `LEFTHOOK=0` both skip the pre-commit scan, and cherry-picks, rebases and merges never run it. *Revision 9:* before anything is pushed, the `pre-push` hook and the explicit AUTOPILOT §6 step scan the full history of every ref, so a skipped commit can't reach GitHub unscanned. Nothing leaves the machine automatically, and a skipped commit is caught in two places before anything is shared:
- `pnpm lint`, and therefore `pnpm verify`, runs `gitleaks git` over the full local history (§5). Every merge into `milestone/m0a` and `main` needs a green `pnpm verify` (AUTOPILOT §2), so the commit cannot be merged.
- On every session-end push (revision 9; previously "once the founder pushes"), CI's `security` job runs the same scan (§7).

Fixing a finding locally is safe because the pre-push scan and the AUTOPILOT §6 scan stop a commit with a finding before it leaves the machine (revision 9). Rotate the secret anyway.

---

## 7. CI and deploy

> **Push at session end (founder, 2026-10-11, option (b)).** The autopilot pushes `main`, the milestone branch and all tags with plain `git push` at the end of every session, so CI runs for real and M0a's exit gate uses the real CI result. Staging deploys still need H3–H5 (H6 Sentry deferred until before D1, revision 10). The paragraph below is kept from revision 8; "Deferred" items are now owned by M0a CLOSE.
>
> *(Revision 8 text.)* Nothing is pushed until the founder says so, so nothing in this section runs during M0a unless that changes. S1 and S3 still write `ci.yml` and the deploy job in full, and these unit tests check them locally:
> - `check-workflows.mjs`, which checks the workflow file;
> - `check-staging-secrets.mjs`, which checks the Worker secret allow-list.
>
> Everything that needs a real push, CI run or staging is listed once, in §13.1 under "Deferred". Those items run the first time the founder pushes and completes H3–H6. Who owns them depends on the founder's answer (§13.1).

### 7.1 `ci.yml`: one workflow, so no `workflow_run` trigger exists to abuse
- **Triggers:** `pull_request`, and `push` to `main` and to `milestone/**` (revision 9: the milestone branch is pushed at the end of every session and needs a real CI run).
- **Permissions:** workflow-level `permissions: contents: read`.
- **Pinning:** every `uses:` is pinned to a full commit SHA, `actions/*` included. `check-workflows.mjs` enforces this, and Dependabot keeps the SHAs current.
- **Checkout:** always `persist-credentials: false`, with `fetch-depth: 0` in `static` and `security`. `static` sets `MIGRATIONS_BASE=origin/main`, because a PR checkout has no local `main` (§8.4).
- **Shared setup:** `pnpm/action-setup` (reads `packageManager`), `actions/setup-node` (`.node-version`, pnpm cache), the checksum-verified gitleaks binary, then `pnpm install --frozen-lockfile`. **No secrets in the environment during install.**

| Job | Steps |
| --- | --- |
| `static` *(required)* | typecheck → lint → test → build (includes bundle budget and header checks) |
| `rls` *(required)* | `pnpm test:rls`, which includes the db-types drift check (§8.3 step 6) |
| `security` *(required)* | `gitleaks git --redact` over **full history** (`fetch-depth: 0`) · `pnpm audit --prod --audit-level=high` · `osv-scanner scan -r .` (v2.6.0, binary checksum-verified; §4). Both scanners honour the advisory ignores described after this table. |
| `migrations` *(required)* | `node scripts/check-migrations.mjs --base origin/main` (§8.4), with `fetch-depth: 0` |
| `deploy-staging` | Gated and step-scoped; see §7.2. |

**Advisory ignores and overrides (revision 15).** The first Linux CI runs failed on dependency advisories. The fixes are in two root files, and the `docs/build-notes.md` "Autopilot changes" row of 2026-10-11 records the decision.
- **`overrides` in `pnpm-workspace.yaml`:** three transitive dependencies are pinned to patch releases that fix their advisories: handlebars 4.7.10, sharp 0.35.5, undici 7.29.1. A comment above the key names the package that pins the old version, so each override can be removed when that stops.
- **One ignore, in both scanners:** braces ≤ 3.0.3 (GHSA-vfj7-8cjw-p6xm, high) has no fixed release. It is reached only through eslint-plugin-boundaries > micromatch at lint time, with patterns from this repository's own ESLint config, and is never shipped. `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` covers `pnpm audit`, and `[[IgnoredVulns]]` in `osv-scanner.toml` covers osv-scanner. Both carry the reason.
- **Expiry:** `osv-scanner.toml` sets `ignoreUntil = 2027-01-11`, so osv-scanner stops ignoring braces on that date. The `ignoreGhsas` entry has no date; its comment says it stays until a fix exists and is then removed. Review both by 2027-01-11 and remove them together when braces ships a fix.
- **Rule:** `osv-scanner.toml` says every entry needs a reason and an expiry, so it is re-checked instead of forgotten. `pnpm-workspace.yaml` is a lead-only file (§14).

### 7.2 `deploy-staging` job

> **Superseded in part (2026-10-16):** from D1 the gate, the step order (api → jobs → edge, plus `vars_checked` and `resources_ready`) and the manual `workflow_dispatch` from `d1/**` and `milestone/**` follow `specs/d1-demo-slice.md` §7.1; `scripts/check-workflows.mjs` and `scripts/test/deploy-staging-job.test.mjs` pin the current job. The S3B-1 rule here (deploy the scanned `dist/index.js` with `--no-bundle`) is unchanged and is now enforced by `check-workflows`.
- **Gate:** `needs: [static, rls, security, migrations]` and `if: github.event_name == 'push' && github.ref == 'refs/heads/main' && github.repository == 'TraceHiring/TraceHiring'` (revision 10).
- **Environment:** `environment: staging`. Its branch policy allows only `main` (H3).
- **Concurrency:** `concurrency: deploy-staging`, without cancel-in-progress.
- **Pull requests, including fork PRs, can never reach this job or its secrets.**

**Each secret is set only on the step that uses it, never at job level:**

1. **Checkout, setup, install, build.** No secrets.
2. **Scan the build output:** `gitleaks dir` over `apps/*/dist` and every Worker's `dist`. A finding fails the job.
3. **Apply migrations:** `pnpm exec supabase db push --db-url "$SUPABASE_STAGING_DB_URL" --yes` (*revision 16:* `--yes` makes the push non-interactive on CLI 2.120.0). Only this step and step 4 get `SUPABASE_STAGING_DB_URL`.
4. **Run the catalog checks against staging** (§8.5).
   - Each `supabase/catalog-checks/MT-*.sql` runs through `psql -X -q -v ON_ERROR_STOP=1 -At`, inside `begin; set transaction read only; set local statement_timeout = '60s'; … rollback;` (*revision 16:* `-q` stops psql printing command tags; the timeout stops a runaway query on staging; the URL must carry `sslmode=require`, `verify-ca` or `verify-full`, or the script refuses it; S3b review S3B-4, S3B-6). The positive-control fixtures do not run here.
   - Any output line or non-zero exit fails the deploy.
   - The step also asserts that the number of files run equals `manifest.json`.
   - MT-12 reads `pg_default_acl` directly, so drift in staging's default ACLs is caught even before the first table exists (database review F9).
5. **Deploy the Workers:** `wrangler deploy --env staging` for edge, jobs and api, with `VERSION=<sha>`. *(Revision 16, S3B-1)* The no-secret build step first writes each Worker's staging bundle (`--dry-run --env staging --outdir dist`), step 2 scans it, and this step uploads exactly that file with `--no-bundle`, so the deployed bytes are the scanned bytes. Only this step and steps 6–7 get `CLOUDFLARE_API_TOKEN`.
6. **Check Worker secrets:** `node scripts/check-staging-secrets.mjs` reads `wrangler secret list` for each staging Worker and **fails unless the set is a subset of the allow-list**:
   - edge: `[]`
   - jobs: `[]`
   - api: `[]`

   M0b and later extend the allow-list explicitly. Edge stays `[]`.
7. **Deploy Pages:** `wrangler pages deploy … --project-name trace-{candidate,recruiter}-staging --branch main`. The Pages project is created first if it is missing.
8. **Smoke test** *(revision 16: URLs come from wrangler's ND-JSON output file, `WRANGLER_OUTPUT_FILE_PATH`; each Pages deploy must report `environment: production` with production branch `main`, and the `<project>.pages.dev` alias is checked as well as the deployment URL; S3B-2)*:
   - each Worker's `/health` returns a schema-valid body with `version == <sha>`;
   - each app's `/version.json` returns `<sha>`;
   - the security headers in §10.3 are present on both apps.

### 7.3 GitHub `staging` environment
| Kind | Names |
| --- | --- |
| Secrets | `CLOUDFLARE_API_TOKEN`, `SUPABASE_STAGING_DB_URL`; from M0b (revision 18, m0b AT-B10 [R5]): `STAGING_SMOKE_EMAIL`, `STAGING_SMOKE_PASSWORD`, `STAGING_SMOKE_TOTP_SECRET`, held only by the org sign-in smoke step (`node scripts/smoke-staging-auth.mjs`; `check-workflows` `STAGING_SECRET_USERS`) |
| Variables | `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_STAGING_PROJECT_REF`, `SUPABASE_STAGING_URL`, `SUPABASE_STAGING_PUBLISHABLE_KEY` (revision 10; public values, used from M0b) |
| Variables before D1 | `SENTRY_DSN_RECRUITER`, `SENTRY_DSN_WORKERS` (deferred with H6) |

**No secret ever reaches an app build.** From D1 the recruiter build gets `VITE_SENTRY_DSN`, which is a public value; in M0a it gets no `VITE_*` value at all. From M0b (revision 18) the deploy-staging build step alone sets `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the two public variables above (`check-workflows` `BUILD_ONLY_ENV`). Where each value lives: `docs/infra/environments.md`.

### 7.4 Repository settings and the first push (you run these; I give the exact commands after the first CI run, when the check names exist)
**First push.** The local `main` holds `--no-ff` merge commits. Push it **before** branch protection is turned on: `git push trace main`, plus the milestone branches if you want them on GitHub. Then apply the protection below. From then on, changes reach `main` by PR.

**Branch protection on `main`:**
- required checks `static`, `rls`, `security` and `migrations`, **strict**: the branch must be up to date with `main` before merging, so `migrations` re-runs on the latest base
- PR required to merge
- stale approvals dismissed
- no force-push or deletion
- linear history **not** required, because milestone merges are `--no-ff` merge commits

**Repo-level settings:** *(Revision 17, M0a REVIEW SEC-1/SEC-2: on the current owner and plan, a private repo of the personal account `TraceHiring` on GitHub Free, branch protection, rulesets, secret scanning and push protection are unavailable (`gh api` 403); the read-only default token is set. Founder gate in FOUNDER-QUEUE; AT-13 stays unmet until it is answered. Compensating controls meanwhile: gitleaks pre-commit and in `pnpm lint`, the CI `security` job, and the rule that `main` moves only at CLOSE.)*
- default workflow token read-only
- `staging` environment branch policy set to `main`
- secret scanning and push protection on (H3)

The output of every command goes into the M0a summary.

---

## 8. Supabase skeleton (owned by the lead session in S1.7)

### 8.1 `config.toml`
- Start from the `supabase init` defaults, with `project_id = "trace"` and Studio off locally.
- `[db] major_version` is pinned to staging's Postgres major version, which the founder reports with H5. Until then it keeps the CLI 2.120.0 default, and the first staging run (AT-18) compares the two.
- **`[api] schemas` and `extra_search_path` must not include `private`, `quality` or `integrity`.** `check-boundaries.mjs` asserts this.
- On staging, the exposed schemas are set in the dashboard and must be `public` only (H5).

### 8.2 Baseline migration `<ts>_m0a_baseline.sql`
Created with `pnpm exec supabase migration new m0a_baseline`, so the timestamp is UTC; never hand-named. It contains no tables, and `database-reviewer` reviews it in S1.7.

```sql
-- Reserved schemas, so boundaries and catalog checks exist before any table does (build-notes Q12).
create schema if not exists private;   -- SECURITY DEFINER helpers (M0b); never exposed through PostgREST
create schema if not exists quality;   -- Answer Quality (M5)
create schema if not exists integrity; -- Integrity Signals (M4)
revoke all on schema private, quality, integrity from public, anon, authenticated, service_role;
revoke create on schema public from public, anon, authenticated, service_role;

-- Functions: remove the built-in global EXECUTE-to-PUBLIC default.
-- A per-schema revoke cannot do this (PostgreSQL ALTER DEFAULT PRIVILEGES semantics).
alter default privileges for role postgres revoke execute on functions from public;

-- Remove Supabase's per-schema defaults: from M0b on, every grant is explicit, including to service_role.
alter default privileges for role postgres in schema public, private, quality, integrity
  revoke all on tables    from anon, authenticated, service_role;
alter default privileges for role postgres in schema public, private, quality, integrity
  revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public, private, quality, integrity
  revoke execute on functions from anon, authenticated, service_role;
```

`create schema if not exists` would quietly accept a schema that already exists with another owner. MT-8 checks schema ownership, so that case fails.

**Rules every later migration follows.** `database-reviewer` enforces them, and the catalog checks cover them where a query can.
- **Creating migrations:**
  - Every migration is created with `pnpm exec supabase migration new`.
  - A migration that isn't yet on `main` may be amended in place. Once it is on `main`, it is frozen (§8.4).
  - After the first `db push` to staging, never roll back past an applied migration; fix forward.
  - Whoever changes a migration regenerates `packages/db-types` in the same commit (`pnpm db:types`; drift is checked in §8.3 step 6).
- **Functions:**
  - Every function is followed by `revoke execute on function … from public, anon, authenticated, service_role;` and then explicit grants.
  - SECURITY DEFINER functions live only in `private` (MT-7).
- **Extensions:**
  - Extensions are always created `with schema extensions`.
  - An extension created by a migration gets explicit EXECUTE grants on the functions that roles need, because the global revoke above removes PUBLIC EXECUTE from them.
- **Views:**
  - Views are always created exactly `with (security_invoker = true)` (MT-10).
  - No materialized views in `public` (MT-10).
- **Grants:** every grant to a worker role is explicit.

**Day-one checks on the local stack.** S1.7 runs these before its checkpoint:
- `postgres` owns the objects that migrations create on CLI 2.120.0.
- pgTAP still works for the test roles. Find which schema `supabase test db` installs pgTAP into. Then, after `db reset` and `test db`, check that `has_function_privilege('authenticated', '<that schema>.is(anyelement,anyelement,text)', 'EXECUTE')` is true.
  - If pgTAP lands in `public`, or the test roles lose EXECUTE, the harness creates pgTAP `with schema extensions` before the run.
  - In that case, each test file grants EXECUTE on the pgTAP functions to the test roles inside its own rolled-back transaction.
  - The result goes into §8.3 and the M0a summary.
- Revoking the `service_role` defaults doesn't break any Supabase service that M0b needs.
- List the objects in `extensions` that are not extension members, with their owners. They are expected to be Supabase's own helpers, owned by `supabase_admin` (MT-9). Also record whether `postgres` has CREATE on `extensions`, which the MT-9 fixture needs. Record the members of `pg_read_all_data` and `pg_write_all_data` for MT-5c's list. Also check that `postgres` holds ADMIN OPTION on both roles, which the MT-5c fixture needs. If it doesn't, record the fallback path the fixture uses.
- The list of system schemas in §8.5 matches `select nspname from pg_namespace` on the local stack. Any extra Supabase schema is added to the list with a note.

MT-4b proves the default ACLs **non-vacuously**, even in M0a, and every other catalog check has a positive control (§8.5).

### 8.3 Harness (`scripts/test-rls.mjs`)
1. **Docker.** `docker info` must succeed. If it fails, exit 1 with: "Docker is not running — RLS tests cannot run. Start Docker Desktop. This check never skips."
2. **Lock.** Every run that uses the local stack shares it (project `trace`): all worktrees, and any clean clone made by `verify-clean-clone`. The harness therefore takes an exclusive lock file at `<os.tmpdir()>/trace-supabase-<project_id>.lock`, keyed by the `project_id` read from `config.toml`. The lock records the PID and the checkout path.
   - It waits up to 15 minutes. Then it fails, naming the holder. It never skips.
   - A lock whose PID is dead is taken over, with a warning.
   - The lock is released on exit, on failure and on a signal.
3. **Start.** `pnpm exec supabase start`, excluding services M0a doesn't need. Auth stays on.
4. **Reset.** `pnpm exec supabase db reset` rebuilds from zero.
5. **Test.** `pnpm exec supabase test db --debug` (revision 11: `--debug` makes pg_prove print every assertion), then parse the TAP output from stdout. Raw stderr is never echoed, because it can hold a connection URL.
   - It fails on any `not ok`, a plan mismatch, or a file with zero tests.
   - It counts assertions **by file prefix**:
     - `catalog_*` against `catalog-min-count`
     - `rls_*` against `rls-min-count`
   - Catalog checks therefore **cannot** count toward the ≥ 50 RLS tests M0b needs.
6. **db-types drift.** `pnpm exec supabase gen types typescript --local --schema public` writes to a temp file. The run fails if that file differs from `packages/db-types/src/database.ts`. It never overwrites the tracked file; `pnpm db:types` regenerates it on purpose and writes the CLI output unformatted. The file is listed in `.prettierignore`, so the comparison is exact.
7. **Release** the lock.

In CI, the harness runs with `--stop`.

### 8.4 `check-migrations.mjs`
**Base.** The base is `--base <ref>`, otherwise the env var `MIGRATIONS_BASE`, otherwise `main`.
- If the base ref doesn't resolve, or `git merge-base` fails, the script **exits 1** and names the ref. It never passes vacuously.
- `verify-clean-clone.mjs` creates `main` from `origin/main` after cloning.
- CI uses `origin/main` with `fetch-depth: 0` (§7.1).

**Checks:**
1. Every entry in `supabase/migrations/` is a file named `^\d{14}_m\d{1,2}[ab]?_[a-z0-9_]+\.sql$`. No sub-directories or other files are allowed. If `supabase/migrations/` is missing, that counts as "no migrations" only while `supabase/config.toml` is also missing (before S1.7). Once `config.toml` exists, a missing migrations directory fails.
2. The 14 digits parse as a real UTC `YYYYMMDDHHMMSS`, no later than **now + 1 day**. That stops a far-future timestamp from blocking all later migrations.
3. Version numbers are unique.
4. **Changes.** Compare `git merge-base <base> HEAD` with the **working tree** (`git diff --no-renames --name-status <merge-base>`), plus untracked files (`git ls-files -o --exclude-standard supabase/migrations`).
   - No existing migration may be modified or deleted. A rename shows up as a deletion plus an addition.
   - Every new version must be newer than the newest version at the **base tip** (`git ls-tree <base> supabase/migrations`), not just at the merge-base.
5. **Frozen set.** Take the union of the migrations at the base tip and the migrations at every `m*-reviewed` tag that is an ancestor of HEAD. Every one of them must be byte-identical in the working tree. This still holds when the script runs on `main` itself, where the merge-base is HEAD.
6. CLOSE re-runs `pnpm verify` on the merge result before tagging. Once the repo is pushed, strict status checks (§7.4) add the CI re-run.
7. The script has unit tests that use fixture git repositories. They cover:
   - a missing base ref;
   - running on `main`;
   - an untracked new migration;
   - an edit to a frozen migration;
   - a new migration older than the base tip;
   - the cases in checks 1–3.

### 8.5 Catalog checks
**Single source of truth.**
- Each check is a plain SQL file, `supabase/catalog-checks/MT-<id>.sql`. It returns one row per violation, and no rows when clean.
- `manifest.json` lists the required IDs (MT-1, 2, 3, 4, 5a, 5b, 5c, 5d, 6, 7, 8, 8b, 9, 10, 11 and 12). For each ID it also lists the **branches**, one for each independent predicate in the table below; MT-11, for example, has 11.
- Every branch has a **positive control**, `fixtures/MT-<id>.<branch>.violation.sql`. It creates a minimal object that violates that branch only, so no single predicate can be broken unnoticed.

**Where the checks run:**
- **Locally and in CI:** `gen-catalog-tests.mjs` writes the committed file `tests/catalog_meta.test.sql`. For each check it emits two assertions:
  - `select is_empty($q$<check>$q$, 'MT-<id>: clean');`
  - for each branch fixture: `savepoint mt; <fixture SQL inlined>; reset role; select isnt_empty($q$select * from (<check>) as v where v.branch = '<branch>'$q$, 'MT-<id>.<branch>: fires'); rollback to savepoint mt;`
  - *Revision 11:* every check returns the columns `(branch text, object text, detail text)`, so each assertion proves its own predicate. The file rules are in `supabase/catalog-checks/README.md`.
- **`gen-catalog-tests.mjs --check` fails if:**
  - the generated file is stale;
  - a manifest ID has no check, or a listed branch has no fixture;
  - a check file isn't in the manifest;
  - either floor file is lower than its value at the base. This is how "floors only go up" is enforced. The rules:
    - The base is resolved the same way as for `check-migrations` (`--base`, then `MIGRATIONS_BASE`, then `main`), and a ref that doesn't resolve fails.
    - A floor file missing at the base counts as 0. That is the first-run case in M0a.
    - On `main`, the floors are also compared against every `m*-reviewed` tag that is an ancestor of HEAD.
  - the manifest at the base (its IDs and branches) is not a subset of the current one. A manifest missing at the base counts as the empty set, which is the case throughout M0a. That stops a check being swapped for another while the count stays the same.
  - *(revision 13, D9)* a `-- shared:<name> begin (the same text in <IDs>)` … `-- shared:<name> end` block differs between the checks that hold it, or sits in a different set of checks than its begin line lists; or a `-- MT-<id> copy begin` … `end` block in `supabase/tests/*.sql` (the probe's negative controls) differs from its check after LF, trim and trailing-`;` normalisation. Both modes report this.
- **Against staging:** step 4 of §7.2 runs the check files only, without the fixtures.

**What they inspect.** The scope is every relation, function, policy, trigger, constraint and type in the schemas `public`, `private`, `quality` and `integrity`. It also covers every member of `pg_partition_tree()` of a partitioned table in those schemas, and *(revision 12)* every `pg_inherits` descendant (recursive) of a relation in scope, whatever schema the partition or child lives in. MT-8b makes sure no other non-system schema exists and *(revision 12)* that every system-list schema has its day-one owner; MT-9 and MT-7 also inspect the system-list schemas where `postgres` can create (revision 12, see their rows).

**What they skip:**
- **System schemas.** This is the complete list, for both the local stack and hosted Supabase, and it is checked on day one (§8.2):
  - `pg_catalog`, `information_schema`, `pg_toast*`, `pg_temp*`
  - `auth`, `storage`, `extensions`, `realtime`, `_realtime`
  - `graphql`, `graphql_public`, `supabase_functions`, `supabase_migrations`
  - `vault`, `pgsodium`, `pgsodium_masks`, `net`, `cron`, `pgbouncer`, `_analytics`
- **Extension members.** An object is skipped only if both of these hold:
  - it has a `pg_depend` row with `deptype = 'e'`, matched on both `classid` and `objid`;
  - it lives in its extension's own namespace (`pg_extension.extnamespace`).

  An object added to an extension from another schema (`ALTER EXTENSION … ADD`) is still checked.

| ID | Violation query finds… | Guards |
| --- | --- | --- |
| MT-1 | a table (`relkind in ('r','p')`, partitions and INHERITS children included) with `relrowsecurity = false`; or *(revision 12)* any foreign table (`relkind = 'f'`) in scope, because a foreign table cannot have RLS | Tenancy |
| MT-2 | a table without a column `org_id` with `atttypid = 'uuid'::regtype and attnotnull and not attisdropped`. Exemptions are a literal list inside `MT-2.sql`, each entry citing an ADR. The list is empty in M0a, and the check also fails if a listed table doesn't exist. | Tenancy |
| MT-3 | a column (`attnum > 0 and not attisdropped`) of any table, view, materialized view or *(revision 12)* standalone composite type (`relkind = 'c'`) whose `lower(attname)` is LIKE `%dob%`, `%birth%`, `%honesty%`, `%trust\_score%`, `%cheat%`, `%emotion%`, `%voiceprint%`, `%face\_template%` or `%gaze\_flag%` (underscores escaped). **`%reject%` applies only to schema `integrity`**, because quality-cutoff rejection and item review are legitimate elsewhere. | Rules 2, 7, 9 |
| MT-4 | (a) for `anon`, any table privilege (`has_table_privilege(…, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`), column privilege (`has_any_column_privilege(…, 'SELECT,INSERT,UPDATE,REFERENCES')`), `has_sequence_privilege(…, 'USAGE,SELECT,UPDATE')`, or `has_function_privilege(…, 'EXECUTE')` for `prokind in ('f','p','a','w')`; (b) any `aclexplode(relacl)` grantee other than the owner holding TRUNCATE, TRIGGER or REFERENCES on an in-scope table. This reads ACL entries, not `has_table_privilege`, so superusers don't show up. TRUNCATE matters because it ignores RLS. *(Revision 12:)* (a) and (b) also include MAINTAIN; (c) any `aclexplode(attacl)` REFERENCES entry for a non-owner on a column of an in-scope table (branch `column_references`). | Tenancy |
| MT-4b *(pgTAP only, `catalog_probe.test.sql`)* | Inside the rolled-back transaction, a throwaway table, sequence and function is created as `postgres` in each of the four schemas. The test asserts that `anon`, `authenticated` and `service_role` have no privilege on any of them, and that `PUBLIC` has no `EXECUTE`. | **Proves the default ACLs now, not only when the first table appears** |
| MT-5a | a view or materialized view, in **any** non-system schema, whose recursive dependency closure reaches both `quality` and `integrity`. The closure follows `pg_rewrite.ev_class → pg_depend(classid = 'pg_rewrite')`, excluding the rule's self-reference, through `pg_class` and `pg_proc` refs. A function counts as reaching a schema if `pg_depend` says so, **or** its `prosrc` names it (case-insensitive: `quality.`, `"quality".`, or `'quality'` as an argument of `format()`, `quote_ident()` or `set_config()` (*revision 14*; revision 13: `format()` only)), **or** its `proconfig` `search_path` includes it. *(Revision 12:)* MT-5a, 5b, 5c and 5d share one closure text (between `-- shared:graph` and `-- shared:closure` marker lines; the `-- shared:escape` block is also shared with MT-10 and MT-11). The closure also follows calls named in a function body (`schema.name(`, or an unqualified `name(` resolved through the caller's `search_path` setting, `public, extensions` when it has none; all overloads; built-ins skipped), operators (`oprcode`) and domains; casts need no edge because PostgreSQL records a cast in an expression as its cast function in `pg_depend`. Roots include views in the system-list schemas whose owner `postgres` is a member of, with INHERIT, SET or ADMIN (*revision 13*; revision 12 said "can SET ROLE to") (branch `system_schema_view`). New branches: `system_schema_view`, `via_operator`, `via_domain`. | Rule 1 |
| MT-5b | a non-extension function that reaches both schemas, using the same rule as MT-5a (plpgsql bodies are not in `pg_depend`) *(Revision 12:)* new branches `system_schema_function` and `prosrc_call` (a function calling another function that reaches the other schema). | Rule 1 |
| MT-5c | any role other than the owner and superusers that holds privileges on objects in both `quality` and `integrity`. Grantees are expanded recursively through `pg_auth_members`, for any membership with inherit or set. The owner's own ACL entry is not expanded to its members. The check also flags any non-superuser member of `pg_read_all_data` or `pg_write_all_data`, except the Supabase roles on a literal list inside `MT-5c.sql`, which the day-one check records. *(Revision 12:)* EXECUTE on a SECURITY DEFINER function (outside `pg_catalog` and `information_schema`) counts as holding every schema its closure reaches (`definer_bridge`); memberships with ADMIN OPTION only are expanded too, including for `pg_read_all_data`/`pg_write_all_data` (`admin_membership`). *(Revision 13, `owner_rights_relation`:)* a materialized view, or a view without the literal `security_invoker=true`, outside `quality`, `integrity`, `pg_catalog` and `information_schema` runs with its owner's rights, so a grantee on it (its `relacl`, `acldefault('r', owner)` when null, and column ACLs) holds every schema its closure reaches. | Rule 1 (separate worker roles, Q12) |
| MT-5d | a foreign key between a `quality` relation and an `integrity` relation; a trigger on a table in one schema whose function reaches the other (MT-5a rule); or a policy whose expression depends on the other schema (`pg_depend` with `classid = 'pg_policy'`, plus the MT-5a function rule) *(Revision 12:)* in-scope relations include every `pg_inherits` descendant, and a relation reaches a schema when any member of its inheritance tree lives there (`inheritance_link`). Any table rewrite rule other than `_RETURN` on an in-scope relation is flagged (`table_rule`; Trace never needs table rules). Hosts also include column defaults and generated columns (`column_default`), CHECK constraints (`check_constraint`), index expressions (`index_expression`) and domain-typed columns (`column_domain`); trigger functions are followed through call chains (`trigger_call_chain`). **Founder answer (2026-10-11):** the plan's `reports` table holds the quality card and the integrity card side by side (rule 5). Any code host (trigger, policy, rewrite rule, column default or generated column, CHECK constraint, index expression, domain-typed column) on a relation in any in-scope schema, `public` and `private` included, whose closure reaches **both** `quality` and `integrity` is flagged (`outside_host_both`). Hosts inside `quality` or `integrity` that reach the other schema stay flagged. A plain table outside the two schemas may have foreign keys into both; foreign keys directly between a `quality` and an `integrity` relation stay flagged. *(Revision 13, `system_table_trigger`:)* trigger hosts are taken from **every** relation, not only in-scope ones (`postgres` holds TRIGGER on Supabase's `auth.*`, `storage.*`, `realtime.*` tables), so a trigger outside the scope whose WHEN clause or function reaches both schemas is flagged. | Rule 1 |
| MT-6 | an enum with a label where `lower(enumlabel) like '%reject%'`, if the enum type is in `integrity` or is used by a column of a table in `integrity`. The column can use it directly, through an array type (`typelem`), through a domain (`typbasetype`) or *(revision 12)* through composite attributes (`typrelid`) and ranges/multiranges (`pg_range`), in any combination (with a depth guard). | Rule 2 |
| MT-7 | a `SECURITY DEFINER` function whose `proconfig` does not contain exactly `search_path=""`; or **any** `SECURITY DEFINER` function outside `private` (functions in `public` are callable as PostgREST RPCs). *(Revision 12:)* `outside_private` and the new `definer_in_system_schema` cover every schema, not only the four: a SECURITY DEFINER function in any other schema is flagged unless it is an extension member, is owned by a `supabase_owner` role, or is on the `supabase_object` list (both lists as in MT-9). `missing_search_path` stays scoped to the four schemas. *(Revision 14, E1:)* `body_search_path` flags a function in the same scope whose body (comments stripped, string literals kept; C and internal functions skipped) changes the search path: `SET [LOCAL\|SESSION] search_path` (also quoted) or `set_config('search_path', …)`, case-insensitive. Known false positive, accepted: an `UPDATE … SET search_path = …` on a column of that name. | database-reviewer standard |
| MT-8 | one of `private`, `quality`, `integrity` is missing or isn't owned by `postgres`; `USAGE` on them for `anon` or `authenticated`; or `CREATE` on `public` for `public`, `anon`, `authenticated` or `service_role` | Rule 1, tenancy |
| MT-8b | a schema that is neither one of the four in-scope schemas nor on the system list; or *(revision 12, `system_schema_owner`)* a system-list schema whose owner differs from its day-one owner: `postgres` for `extensions`, `_realtime` and `supabase_migrations`; `pgbouncer` for `pgbouncer`; `supabase_admin` for all others, including `pg_toast*`/`pg_temp*` and the absent `cron`, `net`, `pgsodium`, `pgsodium_masks` and `_analytics` (a migration that creates one of those absent schemas is caught) | Scope can't be escaped |
| MT-9 | an in-scope relation or function not owned by `postgres`; a `pg_extension` whose `extnamespace` is in scope; or a relation or function in `extensions` that is **owned by `postgres`** and is not an extension member, meaning our own migrations made it. Supabase's own non-member helpers in `extensions` (such as `grant_pg_net_access` and `pgrst_ddl_watch`) are owned by `supabase_admin`, so they are excluded. A day-one check lists them (§8.2). *(Revision 12:)* the hand-made rule covers every system-list schema where `has_schema_privilege('postgres', …, 'CREATE')` is true (computed, not a literal list; locally `extensions`, `_realtime`, `supabase_migrations`, `supabase_functions`). It flags relations, functions and types (excluding relation row types and arrays) that are not members of any extension, whose owner is not in `supabase_owner`, and that are not on `supabase_object`. Owned by `postgres` → `handmade_in_extensions` / `handmade_in_system_schema`; any other owner → `handmade_nonadmin_owner`. `supabase_owner` (shared with MT-7): `supabase_admin`, `supabase_auth_admin`, `supabase_storage_admin`, `supabase_realtime_admin`, `supabase_replication_admin`, `supabase_etl_admin`, `supabase_read_only_user`, `dashboard_user`, `pgbouncer`, each trusted only while `postgres` is not a member (supautils makes those memberships superuser-only). `supabase_object` (by name): `supabase_migrations.{schema_migrations, schema_migrations_pkey, seed_files, seed_files_pkey}` and, owned by `supabase_functions_admin` (of which `postgres` is a member, so that role is trusted by object name only), `supabase_functions.{hooks, hooks_pkey, hooks_id_seq, supabase_functions_hooks_h_table_id_h_name_idx, supabase_functions_hooks_request_id_idx, migrations, migrations_pkey, http_request()}`. *(Revision 13, `extension_owner`:)* any `pg_extension`, in any schema, whose owner `postgres` is a member of (`ALTER EXTENSION … ADD` needs extension ownership, so an extension member made by our migrations would otherwise be skipped; e.g. the trusted `lo`). | Default-ACL integrity (database review F2) |
| MT-10 | a view (`relkind = 'v'`) whose `reloptions` lacks the literal `security_invoker=true` (migrations must write exactly that; `on`, `1` and `yes` count as violations); a materialized view in `public`; or a materialized view with any privilege for `anon` or `authenticated` (M0b adds the candidate roles) *(Revision 12:)* also views in the system-list schemas reachable by `postgres` (`system_schema_view`). | Views can't bypass RLS (rule 5) |
| MT-11 | a policy with `polcmd = '*'` (FOR ALL); an INSERT policy without `polwithcheck`; an UPDATE policy without both `polqual` and `polwithcheck`; a SELECT or DELETE policy without `polqual`; a policy whose `polroles` contains `0` (PUBLIC); a policy whose qual or with-check is literally `true` on a table that isn't on the reference-table list inside `MT-11.sql` (empty in M0a); or a policy calling `auth.uid()` or `auth.jwt()` outside a scalar sub-select (`(select auth.uid())`) *(Revision 12:)* clauses are read as node trees: `auth_call_unwrapped` flags an `auth.uid()`/`auth.jwt()` call that is not inside a scalar sub-select, so `(select (auth.jwt() ->> 'org_id')::uuid)` passes (negative control in `catalog_probe.test.sql`). New branches: `system_schema_policy`, `inherited_table_policy`, and `qual_without_column` (a clause that is not literally `true`, references no column of its table and calls no function with oid ≥ 16384; the reference-table list exempts it too). *(Revision 13:)* `qual_without_column` exempts only calls to functions in schema `private` (matched by name); `auth_only_clause` flags the same column-free clause when it calls `auth` functions only (`(select auth.uid()) is not null`, `auth.role() = 'authenticated'`: every logged-in user of any org). *(Revision 14, E2:)* both column-free findings apply to **permissive** policies only (`polpermissive`); a restrictive policy only narrows access, so `as restrictive … using ((select auth.jwt() ->> 'aal') = 'aal2')` passes (control in `catalog_probe.test.sql`). | Separate per-operation policies (CLAUDE.md) |
| MT-12 | in `pg_default_acl` for `defaclrole = 'postgres'::regrole`: (a) the global (`defaclnamespace = 0`) function entry is missing (the row is deleted when it equals the built-in default, which includes EXECUTE for PUBLIC); (b) any global entry, or any per-schema entry for an in-scope schema, grants anything, of any `objtype`, to PUBLIC (grantee 0), `anon`, `authenticated` or `service_role`. One exception: USAGE on types (`objtype 'T'`) to PUBLIC is PostgreSQL's built-in type default, so it is not flagged. Branches: (a), (b1) global entry, (b2) per-schema entry. | Default ACLs stay locked, on staging too |

**Positive controls.** There is one fixture per branch, as listed in the `manifest.json` (§8.5); MT-4b is its own probe. Examples:
- MT-1: a compliant partitioned parent (RLS on, `org_id uuid not null`) with a partition in a non-scope schema that has RLS off. Partitions don't inherit `relrowsecurity`, so this proves the `pg_partition_tree` path.
- MT-2: a plain table without `org_id`.
- MT-9, hand-made branch: a function created as `postgres` in `extensions`. If `postgres` lacks CREATE there, the day-one check records which non-postgres path the fixture uses instead.
- MT-5a: a view joining `quality` and `integrity`. MT-5b: a plpgsql function that reads both.
- MT-7: a SECURITY DEFINER function without `search_path`.
- MT-11: a FOR ALL policy. MT-6: an `integrity` enum with `auto_reject`.
- MT-10: a view without `security_invoker`. MT-8b: `create schema reports`.
- *(Revision 12)* MT-8b `system_schema_owner`: `create schema cron`. This is the one fixture without the `mt_` name prefix; Trace never installs `pg_cron`. MT-9 `extension_in_scope`: `create extension seg` in `private` (an extension Trace will not install; the earlier `pg_trgm` fixture would abort the generated file once a migration installs `pg_trgm`).
- MT-12(b2): `alter default privileges for role postgres in schema public grant select on tables to anon`, inside the savepoint.
- MT-12(a): `alter default privileges for role postgres grant execute on functions to public`. That makes the global row equal the default, so PostgreSQL deletes it.
- MT-12(b1), a global entry granting to PUBLIC: PostgreSQL deletes a `pg_default_acl` row that equals the built-in default. The fixture therefore keeps the row different from the default:
  ```sql
  alter default privileges for role postgres grant execute on functions to public;
  alter default privileges for role postgres revoke execute on functions from postgres;
  ```
  The row becomes `{=X/postgres}`.
- MT-11: check on day one that PostgreSQL accepts `CREATE POLICY` without `WITH CHECK` (INSERT) and without `USING` (SELECT, DELETE). The "SELECT or DELETE without USING" fixture uses whichever of the two commands PostgreSQL accepts. If PostgreSQL rejects every form of a branch, that branch is marked `unreachable` in the manifest, with the recorded PostgreSQL error text, and gets no fixture. `gen-catalog-tests --check` accepts `unreachable` only on the named MT-11 branches, only with that error text, and never for a branch that is reachable at the base. S1.7 sets the floor to the real count after this check.

**Thresholds:**
- `catalog-min-count` is set to the exact number of assertions written in S1.7. The expected number is **71**: 16 clean checks, 51 branch controls and 4 MT-4b probes. *Revision 12:* **101**: 16 clean checks, 80 branch controls (counts per ID in the revision 12 header) and 5 probe assertions (the 4 MT-4b probes plus the MT-11 negative control). *Revision 13:* **105**: 16 clean checks, 84 branch controls, 5 probe assertions. *Revision 14:* **112**: 16 clean checks, 85 branch controls (MT-7: 4), 11 probe assertions (the 5 earlier ones plus 6 from pass D: MT-11 restrictive/permissive controls, MT-5b reach shapes and control, MT-7 shapes and control). The 85 branch controls are, per ID (the length of each `branches` list in `manifest.json`):
  - MT-1: 4, MT-2: 3, MT-3: 3, MT-4: 6
  - MT-5a: 6, MT-5b: 5, MT-5c: 6, MT-5d: 12
  - MT-6: 6, MT-7: 4, MT-8: 4, MT-8b: 2
  - MT-9: 6, MT-10: 4, MT-11: 11, MT-12: 3

  The generated `catalog_meta.test.sql` plans 101 assertions (16 clean checks and the 85 branch controls), and `catalog_probe.test.sql` plans 11. Together they make the 112 in `catalog-min-count`.

  `manifest.json` is the authority on branches.
- `rls-min-count` is **0** in M0a and **50** from M0b.
- Both floors only go up, which `gen-catalog-tests.mjs --check` enforces.

**Known gaps, deferred with owners (revision 13; the M0a summary lists them in its Deferred gates table):**
- **D6 → M6** (Medium): the closure has no edge from a relation to its triggers or rules, so a function that writes a `public` table whose trigger writes the other schema is not followed. M6 (the `reports` junction) adds name-based relation edges from bodies and relation → trigger/rule edges; until then the database-reviewer checks this by hand in M4 and M5.
- **D7 → M4/M5 database-reviewer checklist** (Low): operators, casts and domains used inside plpgsql bodies, and dynamic SQL, are not followed. Reviewer rule: no `EXECUTE` in a function that names `quality` or `integrity`, and no `set_config('search_path', …)` / `quote_ident('quality'|'integrity')` in bodies (revision 13's D10 rule reads a bare schema literal only after `format(`; its comment stripper does not parse dollar quotes or `E''` escapes inside a body). *Revision 14:* the checks now cover `quote_ident(`/`set_config(` literals and search-path changes in bodies (pass D). Still on this checklist, out of scope for the checks by founder decision (backstop scope, 2026-10-11): a schema name held in a variable (`v := 'quality'; execute format('%I.t', v)`), and string literals crafted to fool the comment stripper (dollar-quoted or `E''` literals containing `--` or `/*`; review E1 shapes 3–5). Reviewer rule: no `EXECUTE` in a function that names either schema even as a literal, and no comment markers inside literals in such a body.
- **E3 → M0b** (Low, database-reviewer with the MT-10 candidate roles): `supautils.policy_grants` lets `postgres` create policies on 24 `auth.*`/`storage.*`/`realtime.*` tables; MT-11 should flag any policy on a system-list relation (Trace uses R2 and Durable Objects, not Supabase Storage/Realtime), and MT-5d should take policy hosts from every relation, as for triggers. No day-one policy exists there.
- **D8 → M6** (Low): a chain of cascading foreign keys through a third table (`integrity` ← `public` ← `quality`, `on delete cascade`) is not flagged; M6 adds a recursive check over cascading foreign keys.
- PostgreSQL ≥ 17 is required by MT-4 (MAINTAIN) and the membership options; on 15/16 those checks error (loud, not silent).

**M0b adds:**
- Per-partition append-only checks for `audit_log`. No role other than the owner may have UPDATE, DELETE or TRUNCATE on any member of `pg_partition_tree('public.audit_log')`, and every partition gets a BEFORE TRUNCATE trigger (database review F4).
- The candidate roles in MT-10.

---

## 9. Observability

### 9.1 Logger and redactor (`@trace/shared/log`)
**Log line format.** JSON lines with these fields:
- `ts`, `level`, `service`, `version`
- `event`: a **string literal**, enforced by an ESLint rule in `@trace/config`; no template strings or concatenation
- optional `requestId` and `orgId` (IDs only)
- `data`, which is redacted

The logger has no dependencies and runs in the browser, Workers and Node.

**Key rules.** Keys are normalised (lowercased, `_`, `-` and spaces removed), then matched on **stems**. Any key containing one of these stems is replaced with `"[REDACTED]"`:
- **Contact and identity:** `name`, `email`, `phone`, `mobile`, `whatsapp`, `address`, `pincode`, `dob`, `birth`, `age`, `gender`
- **Government IDs and protected traits:** `aadhaar`, `aadhar`, `pan`, `passport`, `voter`, `epic`, `caste`, `religion`, `disability`
- **Background and network:** `college`, `ip`, `forwardedfor`, `connectingip`, `realip`
- **Credentials and secrets:** `otp`, `code`, `password`, `passcode`, `pin`, `token`, `secret`, `key`, `authorization`, `cookie`, `session`, `nonce`, `invite`, `signedurl`, `jwt`
- **Answer content and media:** `answer`, `finaltext`, `transcript`, `scratchpad`, `jdtext`, `photo`, `image`, `audio`, `video`, `accommodation`

There is an allow-list of safe exact keys that contain a stem, such as `orgId`, `requestId`, `sessionId` and `keyVersion`. It is covered by tests.

**Value patterns.** These are redacted inside any string:
- email addresses; UPI IDs (`handle@psp` with no dot)
- Indian mobile numbers in every common format: optional `+91`, `91`, `0091` or `0`, 10 digits starting 6–9, with spaces or dashes
- Aadhaar (12 digits starting 2–9, optionally 4-4-4) and the 16-digit VID
- PAN (`[A-Z]{5}\d{4}[A-Z]`), passport (`[A-Z]\d{7}`), voter EPIC (`[A-Z]{3}\d{7}`), IFSC (`[A-Z]{4}0[A-Z0-9]{6}`), and 9–18-digit bank account numbers when they sit next to account keywords
- IPv4 and IPv6 addresses
- JWTs, `Bearer …`, `sb_secret_…`, `postgres(ql)://…` URLs, and hex or base64 strings of 32 characters or more

**Caps.** Strings are capped at 2,000 characters and objects at depth 6. Anything beyond a cap becomes `"[TRUNCATED]"` and is **never passed through**. The redactor is cycle-safe.

**Errors.** Errors are logged by `serializeError()` as `{ name, code, stack (frames only) }`. **Messages are dropped**, because PostgREST, Postgres and zod messages can echo input such as `Key (email)=(…)`.

**Tests:**
- unit tests for every rule, using **values synthesised at test time** (no literal PII-like fixtures, so gitleaks stays clean);
- property tests that redaction never throws, is idempotent, and never outputs input beyond the caps.

### 9.2 Error reporting (recruiter app, `workers/jobs`, `services/api` only)

**M0a (revision 10): `ErrorReporter` with a no-op implementation.** Sentry is deferred until before D1 (founder, 2026-10-11).
- `packages/shared/src/log/error-reporter.ts` exports the interface `ErrorReporter { capture(err: SerializedError, ctx?: { release: string }): void }` and `noopErrorReporter`, which does nothing. It is written in S1.7 with the logger, the redactor and `serializeError`.
- The three consumers report errors **only** through an injected `ErrorReporter`, and only with `serializeError(err)` output that has passed the redactor. No raw `Error`, message text, request, user or query data reaches a reporter.
- M0a installs no Sentry package, sets no DSN and adds no Sentry host to the CSP.
- AT-9 tests this contract (§13). The Sentry adapter must keep the same interface, so swapping it in changes no call site.
- `workers/edge` and the candidate app have no reporter at all; they log only through the redacting logger.

**Before D1: the Sentry adapter** (deferred item; owner "before D1"; needs H6). Everything below is kept from revision 9 as the adapter's spec. It is not built in M0a.

The scrubber is `scrubSentryEvent()` in `packages/shared/src/log/sentry-scrub.ts`. The Sentry adapter implements `ErrorReporter`, and the three consumers share it.

- `sendDefaultPii: false`; no Session Replay; `tracesSampleRate: 0`; `release` = the commit SHA.
- **`beforeSend` and `beforeBreadcrumb`:**
  - delete `event.request.headers`, `cookies`, `query_string`, `data` and `event.user`;
  - strip query strings from every URL, including breadcrumb URLs;
  - replace `exception.values[].value` with `serializeError`'s `code`, or `"[REDACTED]"`;
  - run the redactor over everything that remains.
- **Server side** (H6): "Prevent storing IP addresses" and data scrubbing are on, and the region is recorded in ADR-027 as a processor outside India.
- **No DSN:** the SDK is not initialised. That is allowed locally and in tests; from D1, staging always has a DSN.
- **Not on `workers/edge` or the candidate app.** They log only through the redacting logger, to Workers Logs (edge) and the console (candidate app). Workers Logs is also recorded in ADR-027 as a processor outside India. *(Revision 17, M0a REVIEW SPEC-F2:)* Workers Logs are currently **off** on all three Workers (`observability: { enabled: false }`, chosen in the S3a review), so staging keeps no Worker logs. M0b decides: turn them on (ADR-027 already lists Workers Logs as a processor) or record that they stay off. Owner M0b.

### 9.3 Health contract (`@trace/shared/health`)
`HealthResponse = z.object({ status: z.literal("ok"), service: z.enum(["edge","jobs","api"]), version: z.string().regex(/^[0-9a-f]{7,40}$|^dev$/), time: z.iso.datetime() })`

- `GET /health` returns it with `cache-control: no-store`.
- Apps emit a static `/version.json` at build time.
- Deep database checks arrive in M0b.

### 9.4 Contracts (zod, in `@trace/shared`)
M0a has no business API. These are its only wire contracts. Each one is exported from `@trace/shared` and validated in tests on both the producer and the consumer side.

```ts
export const Version = z.string().regex(/^[0-9a-f]{7,40}$|^dev$/);
export const HealthResponse = z.object({
  status: z.literal("ok"),
  service: z.enum(["edge", "jobs", "api"]),
  version: Version,
  time: z.iso.datetime(),
}).strict();
export const AppVersionFile = z.object({         // apps/*/dist/version.json
  app: z.enum(["candidate", "recruiter"]),
  version: Version,
}).strict();
export const LogLine = z.object({                // one JSON line per log call
  ts: z.iso.datetime(),
  level: z.enum(["debug", "info", "warn", "error"]),
  service: z.string().min(1),
  version: Version,
  event: z.string().regex(/^[a-z0-9_.]+$/),      // literal at the call site (ESLint)
  requestId: z.string().uuid().optional(),
  orgId: z.string().uuid().optional(),
  data: z.unknown().optional(),                  // always post-redaction
}).strict();
```

The `/health` responders, the deploy smoke step (§7.2 step 8) and the logger's own output tests all parse with these schemas. An unknown key fails, because every schema is `.strict()`.

---

## 10. Boundaries

### 10.1 ESLint (`eslint-plugin-boundaries` 7.2.0 + custom rules in `@trace/config`)
- **Allowed imports:**
  - apps → `ui`, `shared`, `db-types`
  - edge → `shared`, `vendors`, `db-types`
  - jobs and api → `shared`, `vendors`, `db-types`
  - ui → `shared`
  - shared → no other package
  - no package may import an app, a Worker or a service
- **Quality and integrity stay apart:** under `services/api/src/modules/` and `workers/jobs/src/`, `quality/**` and `integrity/**` may not import each other (rule 1). A fixture test proves this, since the directories don't exist yet.
- **Logger events:** the `event` argument must be a string literal (§9.1).
- **Vite config:** in `vite.config.ts`, `define` may not read `process.env`, and `envPrefix` must stay `VITE_`.

### 10.2 `scripts/check-boundaries.mjs` (has unit tests over fixture trees)
It fails if any of the following holds:
1. Code or `wrangler.jsonc` under `apps/**`, `packages/**` or `workers/edge/**` mentions any of these:
   - `service_role`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`
   - `sb_secret_`, `JWT_SECRET`, `SUPABASE_JWT`
   - `postgres://`, `postgresql://`, `DB_URL`, `DATABASE_URL`
   - *Exemption (autopilot, S1.4 integration):* `packages/shared/src/log/redact.ts` may contain the exact regex text `sb_secret_[\w-]*`, and nothing else credential-shaped, because §9.1 requires the redactor to match `sb_secret_…` values. That text is cut out before the check, so a key literal there still fails. The exemption is one frozen entry in `check-boundaries.mjs`, pinned by tests; `.gitleaks.toml` adds a `supabase-secret-key` rule so scans detect real keys (S1.4 security review M6).
2. Git tracks a `.dev.vars*` file, or any `.env*` file other than `env.example`.
3. An app references a `VITE_*` name containing `SECRET`, `TOKEN`, `PASSWORD`, `PRIVATE`, `JWT`, `DB`, or `KEY` (other than `VITE_SENTRY_DSN`).
4. `supabase/config.toml` exposes `private`, `quality` or `integrity` (§8.1). A missing `config.toml` passes only while `supabase/migrations/` is also missing, which is the state before S1.7 (§5).
5. A text file in the index has CRLF line endings (`git ls-files --eol`).
6. *(S1.4 security review)* An `eslint-disable` comment in `apps/`, `packages/`, `workers/` or `services/` source switches off a `boundaries/` or `trace/` rule, or names no rule.
7. *(Revision 16, S3a review S3A-3, plan risk 9)* Non-test source under `apps/candidate/**` or `workers/edge/**` names `reportError`, `noopErrorReporter`, `ErrorReporter` or `@sentry/` (§9.2: only the recruiter app, `workers/jobs` and `services/api` report errors). Test files, generated files and Markdown are skipped.

**At deploy time,** `check-staging-secrets.mjs` (§7.2 step 6) catches secrets bound outside the code, through `wrangler secret put` or the dashboard.

### 10.3 Browser security headers (`public/_headers` in both apps; `check-headers.mjs` asserts them in each `dist/`)
**Both apps:**
- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' <app-specific>; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`

**`connect-src` per app:**
- candidate: self plus the staging edge origin *(revision 17, M0a REVIEW SPEC-F3: deferred until H4 names the `workers.dev` subdomain; until then the file ships `connect-src 'self'` and `check-headers` accepts it. Owner M0a CLOSE, with H4)*
- recruiter: self and the Supabase staging origin (M0b); the Sentry ingest host is added with the adapter before D1 (revision 10)

**`Permissions-Policy` per app:**
- candidate: `camera=(self), microphone=(self), geolocation=()`. M3b's consent-gating test enforces the "no access before consent" rule. *(Autopilot, 2026-10-11, S1 security review: geolocation is denied, since the product never needs it and the candidate page handles DPDP-covered PII.)*
- recruiter: `camera=(), microphone=(), geolocation=()`

---

## 11. Design tokens (`@trace/ui`)

- `scripts/build-tokens.mjs` reads `docs/design/tokens.json` plus `tokens.extensions.json` and writes:
  - `src/generated/tokens.css`, e.g. `:root { --color-bg-canvas: #F6F6F3; … --space-16: 16px; --radius-md: 8px; --type-body-size: 14px; … }`
  - `src/generated/tokens.ts`, which includes `type Band = "clear" | "review" | "concern" | "insufficient"`
- Both generated files are committed. `tokens:check` regenerates them and diffs.
- **Contrast test** (`src/contrast.ts` declares the pairs):
  - Text pairs, ≥ 4.5:1:
    - `text.primary`, `text.secondary` and `text.tertiary` on canvas and on surface
    - each `band.*.fg` on its `band.*.bg`
    - `text.inverse` on `accent.default`
  - UI pairs, ≥ 3:1: `border.input` and `focus.ring` on surface.
  - `signalFamily.identity` (1.90:1) and `signalFamily.environment` (3.25:1) are legend dots that always sit next to a text label. They are documented in the file and not declared as UI pairs.
- **Fonts:** IBM Plex Sans, IBM Plex Mono and IBM Plex Sans Devanagari are self-hosted in M3b. M0a uses a CSS font stack only.

---

## 12. Windows specifics (this machine)

- **Line endings:** add `.gitattributes`, then make a one-off `git add --renormalize .` commit. After that, Prettier passes identically on Windows and on Linux CI.
- **Shell:** `.npmrc` sets `shell-emulator=true`. Script logic is Node `.mjs`. The only sh scripts are `scripts/backup.sh` (run as `sh scripts/backup.sh`) and the existing `claude-stop-gate.sh`; `.gitattributes` keeps `*.sh` at LF.
- **Path with spaces:** on day one I run `pnpm test:rls` from this spaced path. If Supabase's Docker bind mounts fail, I report it to you before trying any workaround.
- **Ignores:** `.claude/worktrees/` is added to the ignores for git, Prettier, ESLint and Vitest.
- **AT-1b:** `node scripts/verify-clean-clone.mjs` runs on this machine and its output is recorded in the M0a summary. The clone goes into a temp directory under the repo's parent folder, so the run also uses a path with spaces. Once H1 is done, the autopilot runs it; you don't have to.

---

## 13. Acceptance tests

"Local" means the test runs inside `pnpm verify` or `verify-clean-clone.mjs` on this machine. "Deferred" means it needs a real push, CI run or staging. All deferred items are listed in §13.1.

| AT | Exit-gate item / behaviour | How |
| --- | --- | --- |
| AT-1a-CI | Clean clone → `pnpm i && pnpm verify` green on Linux | CI `static` + `rls` on a fresh checkout with `--frozen-lockfile`. **Deferred.** |
| AT-1a-local | Clean clone → `pnpm i --frozen-lockfile && pnpm verify` green on Linux | `verify-clean-clone.mjs --linux`:<br>• clones HEAD into a temp dir;<br>• runs `git branch main origin/main` if the source has `main`;<br>• in a `node:22.23.3@sha256:<digest>` container, downloads gitleaks 8.30.1 with checksum verification (same as CI's shared setup), then runs `pnpm i --frozen-lockfile`, `typecheck`, `lint`, `test` and `build`.<br>`test:rls` runs on the host, because it needs the host Docker engine. The digest is pinned at implementation time and recorded in §4. The output is recorded in the summary. |
| AT-1b | The same on the founder's Windows machine | `verify-clean-clone.mjs` runs the full `pnpm verify` in a host clone; the output is recorded in the summary |
| AT-2 | `supabase db reset` from zero: every catalog check is clean, every positive control fires, and the MT-4b probes pass | `pnpm test:rls` (local, inside `pnpm verify`; CI repeats it) |
| AT-3 | `test:rls` fails, and never skips, when Docker is down, a floor is missed, or a file has 0 tests. Catalog assertions never count toward `rls-min-count`. A second concurrent run waits for the lock, whether it comes from a worktree or a clean clone. | Unit tests with a stubbed `docker info`, TAP fixtures and a held lock file |
| AT-4 | `verify:fast` selects the changed packages and their dependents; global files → full run; docs-only → Prettier only | Unit tests over fixture git repos |
| AT-5 | No secret in repo history | `pnpm lint` runs gitleaks over the full history of every ref (§5). CI `security` repeats it after the first push. |
| AT-6 | The pre-commit hook blocks a staged secret | Temp repo with a fake key shape generated at runtime. The test reads the command from `lefthook.yml` (or calls `lefthook run pre-commit`), so it checks the real configuration. Expects a non-zero exit. |
| AT-6c | A commit made with `--no-verify` that holds a secret makes `pnpm lint` fail | Temp repo with a fake key shape generated at runtime. The test runs the gitleaks command read from `scripts.lint` in the root `package.json`. Expects a non-zero exit. |
| AT-7 | commitlint rejects `update stuff` and accepts `feat(api): x` and `wip(api): x` | Unit test |
| AT-8 | Redactor: key stems, Indian ID and value patterns, caps → `[TRUNCATED]`, idempotence, error messages dropped | Vitest + property tests in `@trace/shared` |
| AT-9 | *(revision 10)* Errors reach an `ErrorReporter` only as redacted `serializeError` output (no message text, request, user or query data); the M0a reporter is `noopErrorReporter`; no Sentry package is installed | Vitest with a spy reporter and an error built from values synthesised at test time, plus one wiring test each in the recruiter app, jobs and api; a test that no `@sentry/*` package is in any lockfile importer |
| AT-9-sentry | *(deferred, owner "before D1", needs H6)* Sentry `beforeSend` strips request, user and query data and exception values | Vitest of `scrubSentryEvent` with synthetic events, plus one wiring test each in the recruiter app, jobs and api |
| AT-10 | Every Worker's `/health` returns a schema-valid body that carries the injected `VERSION` | Vitest (pool-workers) |
| AT-11 | Staging deploys from CI, and every endpoint reports the deployed SHA | `deploy-staging` smoke step; run URL recorded. **Deferred.** |
| AT-12 | **Deploys run from CI only**: the deploy job runs only on push to `main` in this repo; secrets are step-scoped; every action is SHA-pinned; workflow permissions are read-only; required jobs have no `continue-on-error` | Local: `check-workflows.mjs` unit tests + lint. **Deferred part:** the H3 environment branch policy is recorded. Q56 deny rules are recorded if approved. |
| AT-13 | CI blocks merge on red | Branch-protection output (§7.4), plus one deliberately red PR shown blocked, then closed. **Deferred.** |
| AT-14 | The boundary rules fire (imports, secret names, `.dev.vars*`, `VITE_` names, exposed schemas, CRLF) | ESLint fixture tests + `check-boundaries.mjs` unit tests |
| AT-15 | Edge has no Worker secrets; jobs and api match the allow-list | Local: `check-staging-secrets.mjs` unit tests over recorded `wrangler secret list` outputs. **Deferred part:** deploy step 6. |
| AT-16 | No secret in any build output | Local: `scan-dist.mjs` in `build`, unit-tested with a fixture `dist/` holding a fake key generated at runtime. **Deferred part:** deploy step 2. |
| AT-17 | Migration rules: name, real timestamp ≤ now + 1 day, unique versions, changes against the working tree, base-tip ordering, frozen set, a missing base fails, and a missing `supabase/migrations/` is allowed only before `supabase/config.toml` exists | `check-migrations.mjs` unit tests, plus the run in `lint`; CI repeats it |
| AT-18 | The catalog checks hold on **staging** after `db push` | Deploy step 4. **Deferred.** |
| AT-19 | The generated catalog test file is current; every manifest ID has a check, and every listed branch has a fixture; no floor went down (the base is resolved as in `check-migrations`, and a floor missing at the base counts as 0); the base manifest is a subset of the current one (a manifest missing at the base counts as empty) | `gen-catalog-tests.mjs --check` in `lint`, + unit tests |
| AT-20 | Token files are current; contrast pairs pass | `@trace/ui` tests |
| AT-21 | Candidate app initial JS ≤ 150 KB gzip | `check-bundle-size.mjs` |
| AT-22-local | Security headers are present in both `dist/` outputs | `check-headers.mjs` in `build` |
| AT-22-staging | Security headers are present on both staging apps | Smoke step. **Deferred.** |
| AT-23 | db-types are current | `test:rls` step 6 compares against a temp file (local); CI repeats it |
| AT-24 | `scripts/backup.sh` writes a bundle that `git bundle verify` accepts, holds every branch and tag, and keeps only the newest 10 | Vitest over a temp repo with 12 dummy bundles whose mtimes are set in the past. The test finds `sh` on `PATH`, falling back to Git for Windows' `usr/bin`. It fails, never skips, if `sh` is missing. |

### 13.1 Exit gate → acceptance tests (build-order M0a, as merged in `b7af663`)
The third column is the **single list of deferred items**. **Owner of every deferred item: M0a CLOSE** (founder chose option (b), 2026-10-11). They run on the real CI after the session-end push; the deploy items also need H3–H5.

*Revision 10:* **Sentry is not an M0a exit-gate item.** H6 and AT-9-sentry are deferred with owner **"before D1"** (founder, 2026-10-11). They go in the M0a summary's Deferred gates table with that owner, and they block D1.

| Exit-gate item | Covered locally by | Deferred (needs a push, CI or staging) |
| --- | --- | --- |
| Clean clone → `pnpm i && pnpm verify` green on Linux CI | AT-1a-local | AT-1a-CI |
| …and once on the founder's Windows machine | AT-1b | — |
| `supabase db reset` rebuilds from zero and the pgTAP harness runs; catalog meta-tests pass | AT-2, AT-19, AT-23 | — |
| `test:rls` fails if Docker is down | AT-3 | — |
| Staging deploys from CI only | AT-12, AT-15, AT-16 (local parts) | AT-11, AT-18, AT-22-staging, the deferred parts of AT-12, AT-15 and AT-16 |
| Every health endpoint responds with the deployed commit | AT-10 | AT-11 |
| No secret in repo history (gitleaks clean) | AT-5 | the CI `security` re-run |
| The pre-commit scan blocks a staged secret | AT-6, AT-6c | — |
| PII-redaction tests pass | AT-8, AT-9 (`ErrorReporter` contract) | AT-9-sentry, owner "before D1" (not M0a CLOSE) |
| CI blocks merge on red | AT-12 local part. The local rule that nothing merges into `milestone/m0a` or `main` without a green `pnpm verify` (AUTOPILOT §2) also covers it. | AT-13 |

Every deferred item goes in the **Deferred gates** table of `docs/milestones/M0a-summary.md` (build-order rule 6), with its proxy test and owner.

**"Done when" lines.** M0a carries part of ABH-80 (observability), and build-order names no other issue for M0a. ABH-80's "Done when" text is not in the repo (see the build-notes paragraph that starts "Build-order makes each ABH issue's 'Done when'"), and Linear isn't connected. Until the founder pastes that line, AT-8, AT-9, AT-10 and AT-22-local stand in for it. §17 item 7 tracks the gap.

*Revision 9:* the founder pasted it on 2026-10-11 (build-notes §0): "RPO ≤ 15 minutes and RTO ≤ 2 hours are proven in a restore drill; the on-call alert reaches the phone in under 2 minutes; no candidate PII is found in logs (scan)." RPO/RTO are resolved by plan-conflicts #16 (RPO ≤ 2 min, RTO ≤ 2 h) and, with the alert, belong to M8. M0a owns **"no candidate PII is found in logs (scan)"**: AT-8 and AT-9 prove the redactor and the `ErrorReporter` contract (revision 10), and the M0a REVIEW scans the logs the tests produce.

---

## 14. Work plan and streams (parallelism policy: AUTOPILOT §2)

| Step | Who | Scope | Owns | Depends on |
| --- | --- | --- | --- | --- |
| **S1.0** | Lead | **Commit-path safety**, the first commit of M0a | root `package.json` (minimal), `lefthook.yml`, `.gitleaks.toml`, and the `.claude/settings.json` deny rules if Q56 is approved | H1, (H7) |
| S1 | Lead | **Foundation** (checkpoints as in §5):<br>• **S1.1–S1.3**, one checkpoint:<br>&nbsp;&nbsp;– ADR-028<br>&nbsp;&nbsp;– the workspace, catalog, `.npmrc`, `.node-version`, and `.gitattributes` + renormalise<br>&nbsp;&nbsp;– `@trace/config` + rule fixture tests<br>&nbsp;&nbsp;– for **every workspace**: its `package.json` with its final M0a dependencies, `tsconfig.json` and Vitest config, then `pnpm i`, so the lockfile is complete<br>&nbsp;&nbsp;– a **placeholder** per workspace that typechecks, builds and has one real smoke test:<br>&nbsp;&nbsp;&nbsp;&nbsp;· libraries: `src/index.ts`, and the test imports it<br>&nbsp;&nbsp;&nbsp;&nbsp;· Workers and the service: `wrangler.jsonc`, the committed `wrangler types` output, and a fetch handler that returns 404, which the test asserts<br>&nbsp;&nbsp;&nbsp;&nbsp;· apps: `index.html`, `src/main.tsx` rendering the product name, asserted with `react-dom/server` `renderToString` in Node (no DOM library), and `public/_headers` with the §10.3 headers<br>&nbsp;&nbsp;– no `passWithNoTests` anywhere. The streams replace the placeholders.<br>• **S1.4**:<br>&nbsp;&nbsp;– the `verify-fast`, `check-*` (including `check-migrations` and `check-workflows`), `scan-dist` and `verify-clean-clone` scripts + tests<br>&nbsp;&nbsp;– `scripts/lib/` (git, workspace map, TAP parser) + tests<br>&nbsp;&nbsp;– the automated AT-6 and AT-6c, and the `backup.sh` test (AT-24)<br>• **S1.5** `ci.yml` (no deploy job yet) and `dependabot.yml`; `check-workflows` joins `lint`<br>• **S1.6** commitlint + AT-7 | root files; every workspace's `package.json`, `tsconfig.json`, Vitest config and placeholder; `pnpm-lock.yaml`; `packages/config/`; `scripts/` except `test-rls.mjs` and `gen-catalog-tests.mjs`; `.github/`; `docs/adr/ADR-028*` | S1.0 |
| **S1.7** | Lead | **Shared code and the database**, before any stream starts:<br>• `packages/shared/src/`: the §9.4 zod contracts, `health.ts`, `version.ts`, the `log/` module (logger, redactor, `serializeError`, `error-reporter.ts` with `noopErrorReporter`; revision 10) and the package's `index.ts` and exports, with all their tests (AT-8, AT-9 unit part)<br>• all of `supabase/`: `config.toml`, the baseline migration, catalog checks, manifest and fixtures, `tests/`, floors<br>• `scripts/test-rls.mjs` and `scripts/gen-catalog-tests.mjs`, with their tests<br>• all of `packages/db-types/`<br>• adding `test:rls` to `verify`<br>• the §8.2 day-one checks, run on the local stack before the checkpoint | the files listed | S1 |
| S2 | Stream | **UI and apps** (parallel with S3) | `packages/ui/`, `packages/vendors/` and `apps/*/`, except the lead-only files in each (`package.json`, `tsconfig.json`, Vitest config) | S1.7 merged |
| S3 | Stream | **Workers, services and deploy** (parallel with S2) | `workers/*/` and `services/*/` (same exclusions), and the `deploy-staging` job in `ci.yml` | S1.7 merged. H3–H5 are needed only to *run* the deploy (H6 deferred, revision 10) (§13.1), not to write and unit-test it. |
| S4 | Lead | **Close-out** (the AUTOPILOT CLOSE phase, after REVIEW passes) | `docs/milestones/M0a-summary.md` | S2 + S3 merged; `pnpm verify` green; AT-1a-local and AT-1b recorded; ~~the founder's answer to "Local-only mode vs CI exit gates"~~ answered 2026-10-11: option (b), so the real CI results (and, for the deploy items, H3–H5; H6 is deferred until before D1, revision 10) |

**Parallelism.** S1.0, S1 and S1.7 run in the lead session alone. After that, **S2 ∥ S3** run as 2 writers, which is under the default of 3. They share no files and neither needs the other's output: both consume only what S1.7 delivered. Read-only helpers (reviewers, research) may run up to 6 at once. If S2 and S3 hit a merge conflict, the rest of the session drops to 2 writers or fewer.

**Each stream:**
- runs in its own worktree under `.claude/worktrees/m0a-<stream>`, on branch `m0a/<stream>` cut from `milestone/m0a`;
- merges into `milestone/m0a` locally with `git merge --no-ff`, only after its reviewers pass and `pnpm verify` is green (AUTOPILOT §2).

At CLOSE, `milestone/m0a` merges into `main` the same way. `pnpm verify` re-runs on the merge result, and only then is the merge tagged `m0a-reviewed`.

**Checkpoints.** A sub-step is **green** only when the full `pnpm verify`, as it exists at that step, passes. That includes the full-history gitleaks scan, and `test:rls` from S1.7 on. `verify:fast` alone never counts.

After every green sub-step (S1.0, S1.1–S1.3, S1.4, S1.5, S1.6, S1.7, and each stream merge), commit on `milestone/m0a` and tag `cp/m0a-<NN>`. Tags are numbered from `01`, in order (AUTOPILOT §5).

**Lead-only files.** Neither stream may edit:
- the root `package.json`, any workspace `package.json`, `tsconfig.json` or Vitest config, `pnpm-lock.yaml` and `pnpm-workspace.yaml`;
- anything under `supabase/`, `packages/shared/`, `packages/db-types/` or `packages/config/`;
- `scripts/`;
- the `ci.yml` jobs other than `deploy-staging`.

If a stream needs one of these changed (a new dependency, a contract field, a migration), it stops at a green commit and reports the need. The lead makes the change on `milestone/m0a`, either after the stream merges or before the stream restarts from an updated `milestone/m0a`. A stream never runs `pnpm add`, and never regenerates or hand-merges the lockfile. `spec-reviewer` fails any stream diff that touches a lead-only path.

**Every step, lead or stream:**
- TDD for script, logger, redactor and harness logic. Then `pnpm verify` before the checkpoint or merge.
- A fresh `spec-reviewer` runs on the diff.
- `database-reviewer` reviews the S1.7 database work (baseline migration, catalog checks, fixtures and harness).
- `security-reviewer` reviews the hooks (S1.0), CI and deploy (S1.5, S3), boundaries and the `check-*` scripts (S1.4), the redactor and `ErrorReporter` (S1.7; the Sentry scrubber before D1), and the headers (S2).

**Then:** the M0a REVIEW phase runs in a fresh session that did not write the code (AUTOPILOT §2). It needs build-notes Q57 (the review skill's sub-milestone rows), which is in the founder queue.

---

## 15. Edge cases and failure modes

- **Docker down:** `test:rls` fails loudly. `verify:fast` never needs Docker, so the Stop hook still works.
- **No local `main`:** `verify-fast` runs everything. `check-migrations` exits 1 and names the missing ref, so it never passes vacuously. `verify-clean-clone` creates `main` from `origin/main`, and CI uses `origin/main`.
- **gitleaks missing:** the pre-commit hook and `pnpm lint` both fail with an install hint. Nothing commits cleanly or merges until gitleaks is installed.
- **Commit made with `--no-verify` or `LEFTHOOK=0`:** nothing pushes automatically; `pnpm lint`'s full-history scan fails before the next merge (AT-6c); and the pre-push scan plus the AUTOPILOT §6 scan fail before the next push (revision 9).
- **The full-history scan finds a secret.**
  - In every case, rotate the secret first.
  - If the commit exists only on an unmerged stream branch, rewrite that branch; nothing else references it.
  - If it is reachable from `main`, `milestone/m0a` (both are pushed at session end since revision 9), a `cp/*` tag, a `rescue/*` branch, or a bundle in `../trace-backups/`, the autopilot stops and adds a founder-queue item. AUTOPILOT §5 forbids deleting tags, and RESTORE.md forbids deleting rescue branches without the founder, so the founder decides how to purge the refs and bundles.
- **Two runs of `test:rls` at once** (from two worktrees, or from a worktree and a clean clone): the second waits for the lock in the OS temp dir (§8.3), then runs. It never skips.
- **A gitleaks finding on another stream's branch:** worktrees share refs, and the full-history scan covers every ref, so a finding in one stream fails the other stream's `pnpm verify` too. The affected stream stops and reports. The lead handles the finding (see the secret edge case above), and the other stream does not chase it.
- **A stream needs a lead-only file changed:** it stops at a green commit and reports; the lead makes the change (§14). `spec-reviewer` blocks any stream diff that touches a lead-only path.
- **Backups:** `scripts/backup.sh` bundles every branch and tag into `../trace-backups/` at the end of every session and keeps the newest 10 (AT-24). For restoring, see `docs/progress/RESTORE.md`.
- **Fork PR whose branch is named `main`:** the deploy job's `if:` requires `event_name == 'push'` and this repository, so it never runs (AT-12).
- **A Worker secret added through the dashboard:** deploy step 6 fails (AT-15).
- **Build output that `scan-dist.mjs` cannot read (accepted residuals, N10–N13 security re-review; revision 15).** AT-16 fails a `dist/` that holds a file it recognises as compressed (by file name, by leading bytes, as a zlib stream, or by a zip end record), and it scans text stored as UTF-16 or UTF-32. It cannot recognise, and so cannot scan, these shapes under a neutral file name: raw deflate, brotli (found by file name only), lzma-alone, encrypted blobs, and compressed streams inside another container. A key hidden that way passes AT-16. The re-review accepted these residuals. They fall under the backstop scope (build-notes §0, 2026-10-11): `scan-dist` catches honest mistakes, and deliberate packing goes on the reviewer checklist. The M0a summary must list them in its Deferred gates table. The same re-review (N11) records one more declared limit: a key longer than 8,192 bytes (`STDIN_PIECE_OVERLAP`) can still be cut between two stdin pieces.
- **Staging default ACLs differ from local:** MT-12 in deploy step 4 fails (AT-18).
- **A staging migration goes wrong:** fix forward with a new migration. Never roll back past an applied migration (§8.2).
- **Pages project missing:** it is created idempotently. A token without the needed scope fails with the scope named.
- **Free-plan limits:** M0a uses only Workers, Pages and Supabase.
- **No `node_modules` in a checkout (revision 9):** git hooks live in the shared `.git/hooks`, and lefthook's generated hook looks for the lefthook binary in the committing checkout. If it can't find one, it prints "Can't find lefthook in PATH" and **lets the commit through**. Rule: run `pnpm install` in a worktree before committing in it. Backstop: `pnpm lint`'s full-history scan (every ref) and CI `security`.
- **Migrations and parallel streams:** streams never add migrations; only the lead does (S1.7). `check-migrations` checks ordering, immutability and the frozen set on every `pnpm verify`.

### 15.1 State machines
M0a has no domain entities. It has two process flows with states that the tests pin down.

**Commit and merge path (Q54 = drop).**
- Commit: `staged → pre_commit_scanned → (clean) committed | (finding, or gitleaks missing) rejected`.
- Merge: `committed → verified (pnpm verify, including the full-history scan) → merged --no-ff → checkpoint tagged`.

Rules:
- `rejected` leaves the staged changes untouched.
- A commit that skipped `pre_commit_scanned` (`--no-verify`) can't reach `merged`, because `verified` re-scans the full history (AT-6c).
- Nothing in either flow pushes. *Revision 9:* push is a separate, explicit step at session end: `committed → full-history scan (AUTOPILOT §6, then lefthook pre-push) → (clean) pushed | (finding, or gitleaks missing) push refused`.

**Deploy to staging.** `queued → built → output_scanned → migrated → catalog_checked → workers_deployed → secrets_checked → pages_deployed → smoke_passed`.
- Any failure goes to terminal `failed`. Steps that already ran are not rolled back.
- Migrations are forward-only, and a re-run of the job is idempotent.
- Only `push` to `main` in this repo enters `queued` (AT-12).

### 15.2 Plan §11 rows that touch M0a
Most rows in the register belong to later milestones. M0a lays groundwork for three of them:
- **#13 and #14 (privacy):** the PII redactor, error-message dropping and the `ErrorReporter` contract (AT-8, AT-9; Sentry scrubbing AT-9-sentry before D1) keep candidate data out of logs from day one.
- **#43 (residency stated precisely):** every processor outside India is recorded in ADR-027 (§9.2: Workers Logs, currently off — revision 17, M0b decides; the Sentry region when the adapter lands before D1).
- **#39 (database outage mid-drive):** not M0a. The edge Worker gets no database credential (D6), which keeps the Durable Object path independent of Postgres in M3.

---

## 16. What M0b will add (orientation only; specced after `m0a-reviewed`)

- **Tables:** `orgs`, `workspaces`, `teams`, `memberships`, `audit_log` (monthly partitions; per-partition append-only checks and TRUNCATE triggers), `platform_staff`, `staff_access_grants`, `idempotency_keys`.
- **Helpers and roles:**
  - `private` helpers, each with explicit EXECUTE grants
  - roles `trace_candidate`, `trace_candidate_gateway` and `trace_worker`, plus the scoring and integrity worker roles
- **Auth and org creation:** Supabase Auth with email OTP or password + TOTP, AAL2 for owner, admin and reviewer; an audited `create_org()` path.
- **Tests:** ≥ 50 `rls_*` pgTAP assertions with allowed and denied cases for every role, including cross-org; `rls-min-count` set to 50.
- **Spike and ADR:** a spike that mints a candidate token against the local stack (build-notes Q6); the ADR for resolving org roles from tables (Q3).

The data model is in `docs/build-notes.md` §4, M0 table.

---

## 17. Open items needing you
Each of these is a row in `docs/progress/FOUNDER-QUEUE.md`, with exact steps:
1. **H1 (toolchain).** Blocks all of BUILD.
2. **Local-only mode vs CI exit gates.** Can M0a close with the §13.1 deferred items deferred, or will you push to GitHub before M0a closes? Blocks M0a CLOSE. If you push, H3–H6 apply, and `gh auth login` is needed for the §7.4 commands.
3. **Q57:** approve the review-skill update for the sub-milestones. Blocks the M0a REVIEW phase.
4. **H7 / Q56:** deny rules for local deploys. Optional.
5. **Q55:** separate Supabase org and Cloudflare account for prod at M8 (D5). Not needed before M8.
6. **D3:** the 150 KB budget for the candidate app stands unless you give another number. Blocks nothing.
7. ~~ABH-80's "Done when" line~~ **Pasted 2026-10-11** (§13.1).
8. **Branch protection vs the session-end push (revision 9).** §7.4 requires PRs on `main`, but the founder's session-end `git push` of `main` is a direct push. Needs a design before S1.5 / AT-13. The founder queue holds the options; the autopilot waits for an explicit answer.

*Revision 9:* items 1–6 were answered on 2026-10-11 (H1 done; option (b); Q57, Q56, Q55 and D3 approved).

9. **What "D1" is (revision 10).** The founder deferred Sentry "until before D1". D1 is not defined in the plan, build-order or build-notes. The deferred Sentry items (H6, AT-9-sentry) need a concrete milestone as owner. Blocks nothing in M0a.

---

## Approval
- Revision 3: approved by the founder, 2026-10-10.
- Revision 4: reviewed 2026-10-11 by `spec-reviewer` and `database-reviewer`. Both returned CHANGES REQUIRED, and every finding is fixed in revision 5.
- Revision 5: re-reviewed 2026-10-11.
  - `spec-reviewer`: CHANGES REQUIRED (1 Blocking, 2 Medium, 5 Low).
  - `database-reviewer`: CHANGES REQUIRED (2 Medium, 8 Low).
  - Every finding is fixed in revision 6.
- Revision 6: re-reviewed 2026-10-11.
  - `database-reviewer`: **APPROVE**, with 7 Low.
  - `spec-reviewer`: CHANGES REQUIRED (1 Blocking, 2 Medium, 1 Low).
  - Every finding is fixed in revision 7.
- Revision 7: re-reviewed 2026-10-11.
  - `spec-reviewer`: **APPROVE**, with 1 optional Low.
  - `database-reviewer`: **APPROVE**, with 3 Low.
  - All of these are applied in revision 8.
- Revision 8 contains only those Low text fixes.
- Revision 9 (2026-10-11) applies founder answers and day-one results only; `spec-reviewer` checks it together with the S1.0 diff.
- Revision 10 (2026-10-11) applies the infra-setup instructions only (repo move, Sentry deferral, staging names); `spec-reviewer` checks it.
- Revision 14 (2026-10-11) applies catalog pass D (E1 narrowed by the founder's backstop-scope decision, E2) and records E3 → M0b; `database-reviewer` re-reviews pass D (`docs/reviews/M0a-S1.7-catalog-pass-d-database-rereview.md`) and `spec-reviewer` checks it at the S1.7 gate.
- Revision 15 (2026-10-11) applies the S1.7 gate's finding K3 (spec text only; `docs/reviews/M0a-S1.7-gate-spec-review.md`). It is read by the M0a REVIEW phase (§14).

**Spec approved by autopilot reviewers** on 2026-10-11 (AUTOPILOT §2): `spec-reviewer` and `database-reviewer`, after five review rounds (revisions 4–7). Product scope and exit gate are unchanged from the founder-approved revision 3. Open founder decisions are in `docs/progress/FOUNDER-QUEUE.md` (§17).
