# Spec — M0 Foundations · part **M0a: toolchain, pipeline and skeleton**

- **Status:** **approved by the founder 2026-10-10**, revision 3. Revision 2 fixed every finding from the spec, security and database reviews of revision 1. Revision 3 is a refresh after the docs merge to `main` (`b7af663`); see "Revision 3 changes" below. No code is written until you approve this spec.
- **Milestone:** M0a (`docs/build-order.md` → M0 → M0a). Branch `milestone/m0a` (created from `main` at `b7af663`). Tag `m0a-reviewed` after a `trace-milestone-review` PASS.
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
   - Sentry on the recruiter app, `workers/jobs` and `services/api` only, scrubbed — **not on `workers/edge` and not on the candidate app** (build-notes Q17)
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
- A Sentry SDK on the candidate app or edge → only after counsel approves (build-notes Q17). Until then, edge logs to Workers Logs and the candidate app logs to the console.
- PostHog (M6); Playwright and axe (M3a/M3b).
- Queues, R2 and Durable Object bindings → each arrives with the milestone that first needs it, after the free-plan check (build-notes risk 19).
- IaC: there is no `infra/` folder. Cloudflare is configured through `wrangler.jsonc` and GitHub through the recorded `gh api` commands in §7.4.

### Founder prerequisites (H) — all before M0a starts
| # | Item | Done when |
| --- | --- | --- |
| H1 | Machine fixed per build-notes Q5: Node 22.23.3, pnpm 12.11.2 via Corepack, Docker engine running, gitleaks | You confirm. I re-run the version check at session start. |
| H2 | **Answer Q54** (keep or drop the auto-push hook). The first M0a step (S1.0) installs the secret-scan gate and depends on the answer. | Answer recorded in build-notes §0 |
| H3 | GitHub, on `AbhayRajGit/Tracehiring`:<br>• create environment `staging` with **deployment branches limited to `main`**<br>• add the secrets and variables in §7.3<br>• set the repo's default `GITHUB_TOKEN` permission to **read-only**<br>• enable **secret scanning and push protection** if your plan offers them for this repo<br>• tell me whether the repo is public or private | `gh api repos/AbhayRajGit/Tracehiring/environments/staging` shows the branch policy |
| H4 | Cloudflare:<br>• account with a registered `*.workers.dev` subdomain<br>• an API token limited to this account with Workers Scripts: Edit, Cloudflare Pages: Edit, Account Settings: Read | Token stored as a `staging` secret |
| H5 | Supabase:<br>• `trace-dev` and `trace-staging` in Mumbai (`ap-south-1`)<br>• the **staging session-pooler connection string** (with password), stored as a secret. CI needs no Supabase personal access token (security review #9). | Stored as a `staging` secret |
| H6 | Sentry:<br>• projects `trace-recruiter` and `trace-workers`<br>• pick the **data region** (there is no India region; tell me which)<br>• turn on **"Prevent storing of IP addresses"** and **server-side data scrubbing** in both projects | DSNs stored as `staging` variables; region recorded in ADR-027 |
| H7 | *(optional, recommended)* Approve the `.claude/settings.json` deny rules in build-notes Q56, so staging deploys can't run from a local session | Rules added in S1.0 |

---

## 2. File layout (what M0a creates)

```
/
├─ package.json                 private; scripts §5; "packageManager": "pnpm@12.11.2"; engines node ">=22.22 <23"; "prepare": "lefthook install"
├─ pnpm-workspace.yaml          apps/*, packages/*, workers/*, services/*; catalog (§4); build-script allow-list
├─ pnpm-lock.yaml   .node-version (22.23.3)   .npmrc (engine-strict=true, shell-emulator=true)
├─ .gitattributes               * text=auto eol=lf; *.png *.ico *.woff2 binary
├─ .gitignore                   + .dev.vars* , .wrangler/, dist/, coverage/, .claude/worktrees/, .claude/.last-green, .claude/.stop-gate-tries
├─ .editorconfig  .prettierrc.json  .prettierignore  eslint.config.js  tsconfig.json (solution file)
├─ lefthook.yml  commitlint.config.js  .gitleaks.toml
├─ .github/
│  ├─ workflows/ci.yml          one workflow: required checks + guarded deploy-staging job (§7)
│  └─ dependabot.yml            ecosystems: github-actions, npm (grouped by catalog)
├─ apps/
│  ├─ candidate/                Vite + React shell ("/" shows product name + version); public/_headers; no Sentry, no analytics
│  └─ recruiter/                Vite + React + React Router shell ("/", "/health"); public/_headers; Sentry (scrubbed)
├─ packages/
│  ├─ config/                   tsconfig.base.json, eslint/ (flat config + boundaries + log-message rule), vitest presets; rule fixture tests
│  ├─ shared/                   src/log/ (logger, redactor, error serialiser), src/health.ts (zod), src/version.ts; tests
│  ├─ ui/                       scripts/build-tokens.mjs, tokens.extensions.json, src/generated/{tokens.css,tokens.ts}, src/contrast.ts; tests
│  ├─ vendors/                  README + empty barrel; each interface + mock arrives with its first milestone (Messaging M2, LlmDrafter M1, …)
│  └─ db-types/                 src/database.ts from `pnpm exec supabase gen types typescript --local`; drift-checked
├─ workers/
│  ├─ edge/                     Hono: GET /health. wrangler.jsonc (envs dev, staging). No secrets, no Sentry
│  └─ jobs/                     Hono: GET /health. Sentry (scrubbed). No queue/cron bindings yet
├─ services/api/                Hono: GET /health; src/modules/ (empty + README on module rules); Sentry (scrubbed)
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/<ts>_m0a_baseline.sql
│  ├─ seed.sql                  empty; comment: synthetic data only
│  ├─ catalog-checks/           MT-*.sql — plain "violation" queries (return rows = violation); single source of truth (§8.5)
│  └─ tests/
│     ├─ catalog_meta.test.sql      GENERATED from catalog-checks/ by scripts/gen-catalog-tests.mjs; drift-checked
│     ├─ catalog_probe.test.sql     hand-written probes (MT-4b)
│     ├─ catalog-min-count          floor for catalog_* assertions (may only go up)
│     └─ rls-min-count              floor for rls_* assertions: "0" in M0a, "50" from M0b (may only go up)
├─ scripts/
│  ├─ verify-fast.mjs  test-rls.mjs  gen-catalog-tests.mjs  check-migrations.mjs  check-boundaries.mjs
│  ├─ check-workflows.mjs  check-bundle-size.mjs  check-headers.mjs  check-staging-secrets.mjs
│  ├─ lib/ (git, workspace map, TAP parser)   test/*.test.mjs (Vitest)
│  ├─ git-autopush.sh           only if Q54 = keep (§6)
│  └─ claude-*.mjs, claude-stop-gate.sh       existing, unchanged
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
| @sentry/react / @sentry/cloudflare | 11.6.0 | @sentry/react supports React Router 8.x and Node 22.12+ |
| Supabase CLI (`supabase` devDependency) | 2.120.0 | D7 |
| lefthook | 2.2.1 | — |
| @commitlint/cli + config-conventional | 21.2.3 | — |
| gitleaks | 8.30.1 | winget locally. CI downloads the release binary with checksum verification **in the shared setup**, so every job has it (AT-6 runs in `static`). |
| osv-scanner | pinned by checksum at implementation time | Not on npm |

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
| `lint` | `pnpm -r --if-present lint && prettier --check . && node scripts/check-boundaries.mjs && node scripts/check-workflows.mjs && node scripts/gen-catalog-tests.mjs --check` (each package: `eslint . --max-warnings=0`; `@trace/ui` also runs `tokens:check`) |
| `test` | `pnpm -r --if-present test && vitest run --root scripts` |
| `test:rls` | `node scripts/test-rls.mjs` (§8.3) |
| `build` | `pnpm -r --if-present build && node scripts/check-bundle-size.mjs && node scripts/check-headers.mjs` |
| **`verify`** | `pnpm typecheck && pnpm lint && pnpm test && pnpm test:rls && pnpm build` (exactly the CLAUDE.md list) |
| **`verify:fast`** | `node scripts/verify-fast.mjs` (Stop hook) |

### `verify:fast` algorithm
1. **Pick the base:**
   - `git merge-base HEAD main`
   - if that fails, `git merge-base HEAD trace/main`
   - if that also fails, treat everything as changed.
2. **Collect changed files:** `git diff --name-only <base>` (working tree versus base) plus `git ls-files -o --exclude-standard`.
3. **Run everything** if any changed path is a global file:
   - root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.json`, `eslint.config.js`, `.prettierrc.json`
   - anything under `packages/config/` or `scripts/`
   - anything outside a workspace directory, except `docs/**`, `specs/**` and `*.md`
4. **Docs-only changes:** run `prettier --check` on those files only.
5. **Otherwise:** run `typecheck`, `lint` and `test` for the changed packages and their dependents (`pnpm --filter "...<pkg>"`), then `prettier --check` on the changed files.
6. **Hard limits:** no Docker, no `build`, no network. Exit non-zero on any failure. Print the last 60 lines of output. Target: under 2 minutes.

---

## 6. Git hooks and the push path (`lefthook.yml`)

> **Depends on Q54 (H2).** `lefthook install` renames existing hooks to `*.old`, which would silently disable today's auto-push hook. The auto-push hook also pushes commits that no secret scan has seen. **S1.0 (§14) is therefore the first commit of M0a.** It closes that gap before any other M0a commit is made.

| Hook | Command | Behaviour |
| --- | --- | --- |
| `pre-commit` | `gitleaks git --pre-commit --staged --redact --no-banner` | **Fails** if gitleaks is missing (prints an install hint). Never skips. |
| `pre-commit` | `prettier --check {staged_files}` | — |
| `commit-msg` | `commitlint --edit {1}` | Conventional commits. `wip` is allowed. |
| `post-commit` (**Q54 = keep**) | `sh scripts/git-autopush.sh` | See below. |
| `post-commit` (**Q54 = drop**) | — | The CLAUDE.md line 41 edit happens in the same commit. |

What `scripts/git-autopush.sh` does when Q54 = keep:
1. It runs `gitleaks git --log-opts="<upstream>..HEAD"` over every commit not yet on the remote. If the branch has no upstream, it scans everything not on `trace/main`.
2. **On any finding it refuses to push.** It prints which commit holds the finding and tells you to rotate the secret and fix the commit locally. That fix is safe because the commit was never pushed.
3. This scan covers commits made with `--no-verify`, `LEFTHOOK=0` or before the hooks existed, because the scan runs on what is about to be pushed, not only on the staged files.
4. It logs to `$(git rev-parse --git-common-dir)/autopush.log`, so every worktree writes to the `.git/autopush.log` that CLAUDE.md line 41 names.
5. It never force-pushes.

`lefthook install` runs from the root `prepare` script, so a fresh clone gets the hooks on `pnpm i`.

**Today's hook, checked 2026-10-10.** The hook is `.git/hooks/post-commit`. It is untracked and shared by every worktree.
- **Line 6:** `git push -u trace "$branch"`. There is no scan.
- **Line 5:** logs to `$(git rev-parse --git-dir)/autopush.log`. In a linked worktree that path resolves to `.git/worktrees/<name>/autopush.log`, not the `.git/autopush.log` that CLAUDE.md line 41 names. A failed push from a worktree is therefore logged where nobody looks.

Point 4 above fixes the log path. Until S1.0 lands, the hook stays as it is (founder instruction: don't change it).

---

## 7. CI and deploy

### 7.1 `ci.yml`: one workflow, so no `workflow_run` trigger exists to abuse
- **Triggers:** `pull_request` and `push` to `main`.
- **Permissions:** workflow-level `permissions: contents: read`.
- **Pinning:** every `uses:` is pinned to a full commit SHA, `actions/*` included. `check-workflows.mjs` enforces this, and Dependabot keeps the SHAs current.
- **Checkout:** always `persist-credentials: false`.
- **Shared setup:** `pnpm/action-setup` (reads `packageManager`), `actions/setup-node` (`.node-version`, pnpm cache), the checksum-verified gitleaks binary, then `pnpm install --frozen-lockfile`. **No secrets in the environment during install.**

| Job | Steps |
| --- | --- |
| `static` *(required)* | typecheck → lint → test → build (includes bundle budget and header checks) |
| `rls` *(required)* | `pnpm test:rls` → `pnpm exec supabase gen types typescript --local` → `git diff --exit-code packages/db-types` |
| `security` *(required)* | `gitleaks git --redact` over **full history** (`fetch-depth: 0`) · `pnpm audit --prod --audit-level=high` · `osv-scanner scan -r .` |
| `migrations` *(required)* | `node scripts/check-migrations.mjs --base origin/main` (§8.4) |
| `deploy-staging` | Gated and step-scoped; see §7.2. |

### 7.2 `deploy-staging` job
- **Gate:** `needs: [static, rls, security, migrations]` and `if: github.event_name == 'push' && github.ref == 'refs/heads/main' && github.repository == 'AbhayRajGit/Tracehiring'`.
- **Environment:** `environment: staging`. Its branch policy allows only `main` (H3).
- **Concurrency:** `concurrency: deploy-staging`, without cancel-in-progress.
- **Pull requests, including fork PRs, can never reach this job or its secrets.**

**Each secret is set only on the step that uses it, never at job level:**

1. **Checkout, setup, install, build.** No secrets.
2. **Scan the build output:** `gitleaks dir` over `apps/*/dist` and every Worker's `dist`. A finding fails the job.
3. **Apply migrations:** `pnpm exec supabase db push --db-url "$SUPABASE_STAGING_DB_URL"`. Only this step and step 4 get `SUPABASE_STAGING_DB_URL`.
4. **Run the catalog checks against staging** (§8.5). Each `supabase/catalog-checks/MT-*.sql` runs through `psql` in a read-only transaction (`set transaction read only`). Any returned row fails the deploy, so drift in staging's default ACLs is caught (database review F9).
5. **Deploy the Workers:** `wrangler deploy --env staging` for edge, jobs and api, with `VERSION=<sha>`. Only this step and steps 6–7 get `CLOUDFLARE_API_TOKEN`.
6. **Check Worker secrets:** `node scripts/check-staging-secrets.mjs` reads `wrangler secret list` for each staging Worker and **fails unless the set is a subset of the allow-list**:
   - edge: `[]`
   - jobs: `[]`
   - api: `[]`

   M0b and later extend the allow-list explicitly. Edge stays `[]`.
7. **Deploy Pages:** `wrangler pages deploy … --project-name trace-{candidate,recruiter}-staging --branch main`. The Pages project is created first if it is missing.
8. **Smoke test:**
   - each Worker's `/health` returns a schema-valid body with `version == <sha>`;
   - each app's `/version.json` returns `<sha>`;
   - the security headers in §10.3 are present on both apps.

### 7.3 GitHub `staging` environment
| Kind | Names |
| --- | --- |
| Secrets | `CLOUDFLARE_API_TOKEN`, `SUPABASE_STAGING_DB_URL` |
| Variables | `CLOUDFLARE_ACCOUNT_ID`, `SENTRY_DSN_RECRUITER`, `SENTRY_DSN_WORKERS` |

**No secret ever reaches an app build.** The recruiter build gets only `VITE_SENTRY_DSN`, which is a public value.

### 7.4 Repository settings (you run these; I give the exact commands after the first CI run, when the check names exist)
**Branch protection on `main`:**
- required checks `static`, `rls`, `security`, `migrations`, **strict** (the branch must be up to date with `main` before merging, so `migrations` re-runs on the latest base)
- PR required to merge
- stale approvals dismissed
- no force-push or deletion
- linear history

**Repo-level settings:**
- default workflow token read-only
- `staging` environment branch policy set to `main`
- secret scanning and push protection on (H3)

The output of every command goes into the M0a summary.

---

## 8. Supabase skeleton

### 8.1 `config.toml`
`supabase init` defaults, with `project_id = "trace"` and Studio off locally. **`[api] schemas` and `extra_search_path` must not include `private`, `quality` or `integrity`.** `check-boundaries.mjs` asserts this.

### 8.2 Baseline migration `<ts>_m0a_baseline.sql`
Reviewed by `database-reviewer` before merge. It contains no tables.

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

**Rules every later migration follows.** `database-reviewer` enforces them, and MT-4, MT-7, MT-9 and MT-10 check them.
- Every function is followed by `revoke execute on function … from public, anon, authenticated, service_role;` and then explicit grants.
- Extensions are always created `with schema extensions`.
- Views are always created `with (security_invoker = true)`.
- No materialized views in `public`.
- Every grant to a worker role is explicit.

**Day-one checks on the local stack:**
- that `postgres` owns objects created by migrations on CLI 2.120.0;
- which schema `supabase test db` installs pgTAP into;
- that revoking `service_role` defaults doesn't break any Supabase service M0b needs.

MT-4b proves the default ACLs **non-vacuously**, even in M0a (§8.5).

### 8.3 Harness (`scripts/test-rls.mjs`)
1. `docker info` must succeed. Otherwise exit 1 with: "Docker is not running — RLS tests cannot run. Start Docker Desktop. This check never skips."
2. `pnpm exec supabase start`, excluding services M0a doesn't need. Auth stays on.
3. `pnpm exec supabase db reset`: rebuilds from zero.
4. `pnpm exec supabase test db`, then parse the TAP output.
   - It fails on any `not ok`, a plan mismatch, or a file with zero tests.
   - It counts assertions **by file prefix**:
     - `catalog_*` against `catalog-min-count`
     - `rls_*` against `rls-min-count`
   - Catalog checks therefore **cannot** count toward the ≥ 50 RLS tests M0b needs.
5. In CI it runs with `--stop`.

### 8.4 `check-migrations.mjs`
1. Every entry in `supabase/migrations/` is a file named `^\d{14}_m\d{1,2}[ab]?_[a-z0-9_]+\.sql$`. No sub-directories or other files are allowed.
2. The 14 digits parse as a real UTC `YYYYMMDDHHMMSS`, no later than **now + 1 day**. That stops a far-future timestamp from blocking all later migrations.
3. Version numbers are unique.
4. It compares against `git merge-base <base> HEAD` using `git diff --no-renames --name-status`:
   - no existing migration may be modified or deleted (a rename shows up as a deletion plus an addition);
   - every new version must be newer than the newest version on the base.
5. Strict status checks (§7.4) make sure this runs against the latest `main`.
6. The script has unit tests that use fixture git repositories.

### 8.5 Catalog checks
**Single source of truth.** Each check is a plain SQL file in `supabase/catalog-checks/MT-<n>.sql`. A file returns one row per violation and no rows when clean. Where the checks run:
- **Locally and in CI:** `gen-catalog-tests.mjs` wraps each file as `select is_empty($q$…$q$, 'MT-n: …')` in the generated `tests/catalog_meta.test.sql`. That file is committed, and `--check` fails if it is stale.
- **Against staging:** step 4 of §7.2 runs the same files.

**What they inspect.** Unless a check says otherwise, the scope is every relation and function in the schemas `public`, `private`, `quality` and `integrity`, plus every member of `pg_partition_tree()` of any partitioned table in those schemas, whatever schema the partition lives in.

**What they skip:**
- **extension members**: objects with `pg_depend.deptype = 'e'`;
- **system objects**: `pg_catalog`, `information_schema`, and Supabase's own schemas (`auth`, `storage`, `extensions`, `realtime`, `graphql*`, `supabase_*`, `vault`, `pgsodium*`, `net`, `cron`).

| ID | Violation query finds… | Guards |
| --- | --- | --- |
| MT-1 | a table (`relkind in ('r','p')`, partitions included) with `relrowsecurity = false` | Tenancy |
| MT-2 | a table without a column `org_id` with `atttypid = 'uuid'::regtype and attnotnull and not attisdropped` | Tenancy |
| MT-3 | a column (`attnum > 0 and not attisdropped`) of any table, view or materialized view whose `lower(attname)` is LIKE `%dob%`, `%birth%`, `%honesty%`, `%trust\_score%`, `%cheat%`, `%emotion%`, `%voiceprint%`, `%face\_template%` or `%gaze\_flag%` (underscores escaped). **`%reject%` applies only to schema `integrity`**, because quality-cutoff rejection and item review are legitimate elsewhere. | Rules 2, 7, 9 |
| MT-4 | for `anon`, any table privilege (`has_table_privilege(…, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')`) or column privilege (`has_any_column_privilege(…, 'SELECT,INSERT,UPDATE,REFERENCES')`); `has_sequence_privilege(…, 'USAGE,SELECT,UPDATE')`; or `has_function_privilege(…, 'EXECUTE')` for `prokind in ('f','p')` | Tenancy |
| MT-4b *(pgTAP only, `catalog_probe.test.sql`)* | Inside the rolled-back transaction, a throwaway table, sequence and function is created in each of the four schemas. The test asserts that `anon`, `authenticated` and `service_role` have no privilege on any of them, and that `PUBLIC` has no `EXECUTE`. | **Proves the default ACLs now, not only when the first table appears** |
| MT-5a | a view or materialized view, in **any** non-system schema, whose recursive dependency closure reaches objects in both `quality` and `integrity`. The closure follows `pg_rewrite.ev_class → pg_depend(classid = 'pg_rewrite')`, excluding the rule's self-reference, through `pg_class` and `pg_proc` refs. | Rule 1 |
| MT-5b | a non-extension function whose `prosrc` matches both `quality\.` and `integrity\.` (plpgsql bodies are not in `pg_depend`) | Rule 1 |
| MT-5c | any role other than the owner holding privileges on objects in both `quality` and `integrity` | Rule 1 (separate worker roles, Q12) |
| MT-6 | an enum label starting with `reject` on an enum in schema `integrity`, or used by a column of a table in `integrity` | Rule 2 |
| MT-7 | a `SECURITY DEFINER` function whose `proconfig` does not contain exactly `search_path=""` | database-reviewer standard |
| MT-8 | a missing `private`, `quality` or `integrity` schema; `USAGE` on them for `anon` or `authenticated`; or `CREATE` on `public` for `public`, `anon`, `authenticated` or `service_role` | Rule 1, tenancy |
| MT-9 | a relation or function not owned by `postgres`, or a `pg_extension` whose `extnamespace` is in scope | Default-ACL integrity (database review F2) |
| MT-10 | a view (`relkind = 'v'`) whose `reloptions` lacks `security_invoker=true`; or a materialized view with any privilege for `anon` or `authenticated` | Views can't bypass RLS (rule 5) |
| MT-11 | a policy with `polcmd = '*'` (FOR ALL); an INSERT policy without `polwithcheck`; or an UPDATE policy without both `polqual` and `polwithcheck` | Separate per-operation policies (CLAUDE.md) |

**Thresholds:**
- `catalog-min-count` is set to the number of assertions written in M0a. That is 15: MT-1…MT-11 with MT-5 split into three, plus four MT-4b probes. It may only go up.
- `rls-min-count` is **0** in M0a and **50** from M0b.

**M0b adds:** per-partition append-only checks for `audit_log`. No role other than the owner may have UPDATE, DELETE or TRUNCATE on any member of `pg_partition_tree('public.audit_log')`, and every partition gets a BEFORE TRUNCATE trigger (database review F4).

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

### 9.2 Sentry (recruiter app, `workers/jobs`, `services/api` only)
- `sendDefaultPii: false`; no Session Replay; `tracesSampleRate: 0`; `release` = the commit SHA.
- **`beforeSend` and `beforeBreadcrumb`:**
  - delete `event.request.headers`, `cookies`, `query_string`, `data` and `event.user`;
  - strip query strings from every URL, including breadcrumb URLs;
  - replace `exception.values[].value` with `serializeError`'s `code`, or `"[REDACTED]"`;
  - run the redactor over everything that remains.
- **Server side** (H6): "Prevent storing IP addresses" and data scrubbing are on, and the region is recorded in ADR-027 as a processor outside India.
- **No DSN:** the SDK is not initialised. That is allowed locally and in tests; staging always has a DSN.
- **Not on `workers/edge` or the candidate app.** They log only through the redacting logger, to Workers Logs (edge) and the console (candidate app). Workers Logs is also recorded in ADR-027 as a processor outside India.

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
2. Git tracks a `.dev.vars*` file, or any `.env*` file other than `env.example`.
3. An app references a `VITE_*` name containing `SECRET`, `TOKEN`, `PASSWORD`, `PRIVATE`, `JWT`, `DB`, or `KEY` (other than `VITE_SENTRY_DSN`).
4. `supabase/config.toml` exposes `private`, `quality` or `integrity` (§8.1).
5. A text file in the index has CRLF line endings (`git ls-files --eol`).

**At deploy time,** `check-staging-secrets.mjs` (§7.2 step 6) catches secrets bound outside the code, through `wrangler secret put` or the dashboard.

### 10.3 Browser security headers (`public/_headers` in both apps; `check-headers.mjs` asserts them in each `dist/`)
**Both apps:**
- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' <app-specific>; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`

**`connect-src` per app:**
- candidate: self plus the staging edge origin
- recruiter: self, the Supabase staging origin (M0b) and the Sentry ingest host

**`Permissions-Policy` per app:**
- candidate: `camera=(self), microphone=(self)`. M3b's consent-gating test enforces the "no access before consent" rule.
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
- **Shell:** `.npmrc` sets `shell-emulator=true`. Script logic is Node `.mjs`; `git-autopush.sh` is the only sh script, and git runs it through its own shell.
- **Path with spaces:** on day one I run `pnpm test:rls` from this spaced path. If Supabase's Docker bind mounts fail, I report it to you before trying any workaround.
- **Ignores:** `.claude/worktrees/` is added to the ignores for git, Prettier, ESLint and Vitest.
- **AT-1b:** you run `pnpm i && pnpm verify` once on this machine, and the output is recorded in the M0a summary.

---

## 13. Acceptance tests

| AT | Exit-gate item / behaviour | How |
| --- | --- | --- |
| AT-1a | Clean clone → `pnpm i && pnpm verify` green | CI `static` + `rls` on a fresh checkout with `--frozen-lockfile` |
| AT-1b | Same on the founder's Windows machine | Recorded run (manual, once) |
| AT-2 | `supabase db reset` from zero; the catalog checks pass, including the MT-4b probes | `pnpm test:rls` in CI |
| AT-3 | `test:rls` fails, and never skips, when Docker is down, a floor is missed, or a file has 0 tests; catalog assertions never count toward `rls-min-count` | Unit tests with a stubbed `docker info` and TAP fixtures |
| AT-4 | `verify:fast` selects the changed packages and their dependents; global files → full run; docs-only → Prettier only | Unit tests over fixture git repos |
| AT-5 | No secret in repo history | CI `security`: full-history gitleaks |
| AT-6 | The pre-commit hook blocks a staged secret | Temp repo + a runtime-generated fake key shape → non-zero exit (gitleaks is in the shared CI setup) |
| AT-6b | *(Q54 = keep)* `git-autopush.sh` refuses to push an unpushed commit that contains a secret, including one made with `--no-verify` | Temp repo with a local bare remote; assert the remote is unchanged |
| AT-7 | commitlint rejects `update stuff`; accepts `feat(api): x` and `wip(api): x` | Unit test |
| AT-8 | Redactor: key stems, Indian ID and value patterns, caps → `[TRUNCATED]`, idempotence, error messages dropped | Vitest + property tests in `@trace/shared` |
| AT-9 | Sentry `beforeSend` strips request, user and query data and exception values | Vitest with synthetic events (recruiter, jobs, api) |
| AT-10 | Every Worker's `/health` returns a schema-valid body | Vitest (pool-workers) |
| AT-11 | Staging deploys from CI and every endpoint reports the deployed SHA | `deploy-staging` smoke step; run URL recorded |
| AT-12 | **Deploys run from CI only**: the deploy job runs only on push to `main` in this repo; secrets are step-scoped; every action is SHA-pinned; workflow permissions are read-only | `check-workflows.mjs` unit tests + lint; environment branch policy recorded (H3); Q56 deny rules recorded if approved |
| AT-13 | CI blocks merge on red | Branch-protection output (§7.4) + one deliberately red PR shown blocked, then closed |
| AT-14 | The boundary rules fire (imports, secret names, `.dev.vars*`, `VITE_` names, exposed schemas, CRLF) | ESLint fixture tests + `check-boundaries.mjs` unit tests |
| AT-15 | Edge has no Worker secrets; jobs and api match the allow-list | `check-staging-secrets.mjs` unit tests + deploy step 6 |
| AT-16 | No secret in any build output | Deploy step 2 (`gitleaks dir` over `dist/`) |
| AT-17 | Migration rules: name, real timestamp ≤ now + 1 day, unique versions, immutability, ordering | `check-migrations.mjs` unit tests + CI |
| AT-18 | Catalog checks hold on **staging** after `db push` | Deploy step 4 |
| AT-19 | The generated catalog test file is current | `gen-catalog-tests.mjs --check` in lint |
| AT-20 | Token files are current; contrast pairs pass | `@trace/ui` tests |
| AT-21 | Candidate app initial JS ≤ 150 KB gzip | `check-bundle-size.mjs` |
| AT-22 | Security headers are present in both `dist/` outputs and on staging | `check-headers.mjs` + smoke step |
| AT-23 | db-types are current | CI `rls` drift check |

### 13.1 Exit gate → acceptance tests (build-order M0a, as merged in `b7af663`)
| Exit-gate item | Covered by |
| --- | --- |
| Clean clone → `pnpm i && pnpm verify` green on Linux CI | AT-1a |
| …and once on the founder's Windows machine | AT-1b |
| `supabase db reset` rebuilds from zero and the pgTAP harness runs; catalog meta-tests pass | AT-2, AT-19, AT-23 |
| `test:rls` fails if Docker is down | AT-3 |
| Staging deploys from CI only | AT-11, AT-12, AT-15, AT-16, AT-18 |
| Every health endpoint responds with the deployed commit | AT-10, AT-11 |
| No secret in repo history (gitleaks clean) | AT-5 |
| The pre-commit scan blocks a staged secret | AT-6, AT-6b |
| PII-redaction tests pass | AT-8, AT-9 |
| CI blocks merge on red | AT-13 |

**"Done when" lines.** M0a carries part of ABH-80 (observability). The build-order gives no other issue for M0a. ABH-80's "Done when" text is not in the repo (build-notes line 167), and Linear isn't connected in this session. Until you paste that line, AT-8, AT-9, AT-10 and AT-22 stand in for it, and §17 item 6 tracks the gap.

**Deferred gates from M0a:** none expected. Any that appear go in `docs/milestones/M0a-summary.md` (build-order rule 6).

---

## 14. Work plan and streams (max 3 writers; in practice 1 writer, then 2 in parallel)

| Step | Stream | Owns | Depends on |
| --- | --- | --- | --- |
| **S1.0** | **Push-path safety** (first commit of M0a) | root `package.json` (minimal), `lefthook.yml`, `.gitleaks.toml`, `scripts/git-autopush.sh` (if kept), `.claude/settings.json` deny rules (if Q56 is approved) | H1, H2, (H7) |
| S1 | **Foundation**:<br>S1.1 ADR-028<br>S1.2 workspace, catalog, `.npmrc`, `.node-version`, `.gitattributes` + renormalise<br>S1.3 `@trace/config` + rule fixture tests<br>S1.4 `verify-fast`, `check-*` and `gen-catalog-tests` scripts + tests<br>S1.5 `ci.yml` (no deploy job yet), `dependabot.yml`<br>S1.6 commitlint | root files, `packages/config/`, `scripts/`, `.github/`, `docs/adr/ADR-028*` | S1.0 |
| S2 | **Libraries + apps** (parallel with S3) | `packages/shared/`, `packages/ui/`, `packages/vendors/`, `apps/` | S1 merged |
| S3 | **Workers + database + deploy** (parallel with S2) | `workers/`, `services/`, `supabase/`, `packages/db-types/`, `scripts/test-rls.mjs`, the `deploy-staging` job in `ci.yml` | S1 merged; H3–H6 |
| S4 | **Close-out** | `docs/milestones/M0a-summary.md` | S2 + S3 merged; `pnpm verify` green; AT-1b recorded |

**Parallelism and ownership.** S1.0 and S1 run alone. After that, only **S2 ∥ S3** run in parallel, so there are 2 writers. That fits both the build-order cap of 3 and your cap of 4. Each stream:
- runs in its own worktree under `.claude/worktrees/m0a-<stream>`, on branch `m0a/<stream>`;
- merges into `milestone/m0a` by PR, and `milestone/m0a` merges to `main` by PR at the end.

**Shared files neither parallel stream may edit:**
- root `package.json` scripts
- `ci.yml` jobs other than `deploy-staging`
- `packages/config/`

If S2 or S3 needs a change there, it goes back through a small S1 follow-up PR.

**The one shared file that is unavoidable is `pnpm-lock.yaml`.** S1 pins every M0a dependency in the catalog up front. The stream that merges second rebases and regenerates the lockfile with `pnpm i`; it never hand-merges it.

**Every stream:**
- TDD for script, logger and redactor logic, then `pnpm verify` before the PR.
- A fresh `spec-reviewer` runs on the diff.
- `database-reviewer` reviews the baseline migration and the catalog checks.
- `security-reviewer` reviews hooks, CI and deploy, boundaries, redactor, Sentry and headers.

**Then:** the M0a review runs in a new session (kickoff Prompt 4). See build-notes Q57 for the review skill's sub-milestone rows.

---

## 15. Edge cases and failure modes

- **Docker down:** `test:rls` fails loudly. `verify:fast` never needs Docker, so the Stop hook still works.
- **No `main` locally:** `verify-fast` falls back to `trace/main`, and failing that runs everything. It never passes vacuously.
- **gitleaks missing:** the pre-commit hook fails with an install hint. If kept, the auto-push scan also fails, and the commit stays local and unpushed until gitleaks is installed.
- **Commit made with `--no-verify` or `LEFTHOOK=0`:** the auto-push scan catches it before anything leaves the machine (AT-6b).
- **Fork PR whose branch is named `main`:** the deploy job's `if:` requires `event_name == 'push'` and this repository, so it never runs (AT-12).
- **A Worker secret added through the dashboard:** deploy step 6 fails (AT-15).
- **Staging default ACLs differ from local:** deploy step 4 fails (AT-18).
- **Pages project missing:** it is created idempotently. A token without the needed scope fails with the scope named.
- **Free-plan limits:** M0a uses only Workers, Pages and Supabase.
- **Parallel streams adding migrations:** only S3 adds migrations in M0a. `check-migrations` checks ordering, and strict status checks re-run it on the latest `main`.

### 15.1 State machines
M0a has no domain entities. It has two process flows with states that the tests pin down.

**Push path (Q54 = keep).** `committed → scanning → (clean) pushed | (finding) held_local | (gitleaks missing) held_local | (push error) push_failed_logged`.
- `held_local` and `push_failed_logged` never undo the commit.
- The next commit retries the push.
- Nothing in the flow reaches `pushed` without passing through `scanning`. AT-6b tests that.

**Deploy to staging.** `queued → built → output_scanned → migrated → catalog_checked → workers_deployed → secrets_checked → pages_deployed → smoke_passed`.
- Any failure goes to terminal `failed`. Steps that already ran are not rolled back.
- Migrations are forward-only, and a re-run of the job is idempotent.
- Only `push` to `main` in this repo enters `queued` (AT-12).

### 15.2 Plan §11 rows that touch M0a
Most rows in the register belong to later milestones. M0a lays groundwork for three of them:
- **#13 and #14 (privacy):** the PII redactor, error-message dropping and Sentry scrubbing (AT-8, AT-9) keep candidate data out of logs from day one.
- **#43 (residency stated precisely):** every processor outside India is recorded in ADR-027 (§9.2: the Sentry region and Workers Logs).
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

1. **Q54:** keep or drop the auto-push hook. This blocks S1.0.
2. **H1–H6** (§1), and H7 (Q56) if you want it.
3. **Q55:** separate Supabase org and Cloudflare account for prod at M8 (D5).
4. **D3:** confirm the 150 KB budget for the candidate app, or give another number.
5. **Q57:** approve the review-skill update for the sub-milestones before the M0a review runs.
6. **ABH-80's "Done when" line:** paste it, or connect Linear, so §13.1 can cite it exactly.
7. **`gh` on this machine is not signed in.** Step 2 merges only through PRs, so the CLI needs `gh auth login` (you run it) before S1.0 opens its first PR.
