# M0a S2 ∥ S3 writer plan (ready to use once S1.7 merges)

Written 2026-10-11 by a read-only Plan agent against `m0a/integration` @ `18ae1ff` and spec revision 11, recorded by
the lead. It is a working plan, not a spec: spec `specs/m0-foundations.md` wins wherever they differ. Re-check the
precondition SHAs before use. Note: the spec's edge cases are in **§15** (lines ~919–957), not §11 (design tokens).

## Recommendation: 3 writers
W-S2 (ui + vendors + apps), W-S3a (Workers + service), W-S3b (deploy-staging job + staging scripts). S2 stays one
writer (the apps import `@trace/ui/tokens.css`). A 4th writer has no disjoint work.

## Preconditions (lead, in order)
- **P0a** S1.7 integration done (HANDOFF "Next step"), including the CI `rls` job change; `ci.yml` final before W-S3b cuts.
- **P0b** `m0a/s14-lows` merged (N9, final `check-workflows` rules). **P0c** N8 fixed in `scripts/scan-dist.mjs` (deploy step 2 relies on it).
- **P0d** full `pnpm verify` green, spec-reviewer gate passed, `cp` tags set → that tip is `<SHA>` in the prompts.

## Lead-only changes, one commit before `<SHA>` (HOW-level; record in spec rev note §14 + build-notes "Autopilot changes")
- **P1** `packages/config/package.json` `exports`: add `"./vite": "./vite/forbid-server-imports.js"` (the plugin exists and is tested but nothing exports it; tooling configs may import only `@trace/config`, `boundaries.js:104-111`).
- **P2** `packages/ui/package.json` `exports`: add `"./tokens.css": "./src/generated/tokens.css"`.
- **P3** `.prettierignore`: add `packages/ui/src/generated/` (ESLint already ignores it; `tokens:check` compares bytes). Alternative: require Prettier-stable generator output.
- **P4** root `devDependencies`: `"wrangler": "catalog:"`, then `pnpm install` (only the root importer changes; 4.149.0 already locked). Alternative: run wrangler from inside each Worker folder.
- **P5** grants/decisions: (a) W-S3b may create the new `scripts/` files listed below (`check-staging-secrets.mjs` is in spec §2 line ~234 and S1.4 scope but was never written); (b) names `VITE_APP_VERSION` and `--var VERSION:<sha>`; (c) where the smoke step gets Worker URLs (Q2); (d) this split.
- After the merges: `packages/ui/package.json` gets `tokens` and `tokens:check` scripts and `lint` = `eslint . --max-warnings=0 && node scripts/build-tokens.mjs --check` (§5 lines ~310, 317).
- No other dependency changes are needed (each workspace already lists what its stream needs).

## Streams
**W-S2 — UI and apps** (spec §14 line ~885). Owns `packages/ui/{scripts/**,src/**,tokens.extensions.json}`, `packages/vendors/{src/**,README.md}`, `apps/{candidate,recruiter}/{index.html,public/**,src/**,vite.config.ts}`. Lead-only: every `package.json`, `tsconfig*.json`, `vitest.config.ts`, root files, `packages/{shared,config,db-types}`, `scripts/`, `supabase/`, `.github/`, `docs/design/tokens.json`. ATs: AT-20 (`packages/ui/src/tokens.test.ts`, `contrast.test.ts`), AT-21 (existing bundle-size check), AT-22-local (`check-headers.mjs` + `apps/*/src/version-file.test.ts`), AT-9 recruiter part (`apps/recruiter/src/error-reporting.test.ts`), §9.4 producer check; AT-14/AT-16 stay green. Founder-blocked: the candidate `connect-src` edge origin needs the `workers.dev` subdomain (H4); AT-22-local passes without it.

**W-S3a — Workers and service** (spec line ~886). Owns in `workers/edge`, `workers/jobs`, `services/api`: `src/**`, `wrangler.jsonc`, `worker-configuration.d.ts`. ATs: AT-10 (`src/index.test.ts` in each), AT-9 wiring (`workers/jobs/src/error-reporting.test.ts`, `services/api/src/error-reporting.test.ts`). Edge: no secrets, no reporter, no Sentry. No Queue/R2/DO/cron bindings.

**W-S3b — deploy-staging job + staging checks** (spec line ~886). Owns only the `deploy-staging` job + header comment in `.github/workflows/ci.yml`, and (grant P5) new files `scripts/{check-staging-secrets,smoke-staging,staging-catalog-checks}.mjs`, `scripts/test/{check-staging-secrets,smoke-staging,staging-catalog-checks,deploy-staging-job}.test.mjs`, `scripts/test/fixtures/staging/**`. ATs (local parts): AT-12, AT-15; AT-11, AT-18, AT-22-staging and deferred AT-16 via unit-tested proxies. **Cannot run until** H3 (staging env branch policy), H4 (`CLOUDFLARE_API_TOKEN`, revoke the exposed token first, `workers.dev` subdomain), H5 (`SUPABASE_STAGING_DB_URL` name, Postgres major), branch protection answer (AT-13) and the push (AT-1a-CI).

## Risks and ordering traps
1. `vite-config-env.js:1-8` bans `process`, `fs`, `loadEnv` in `vite.config` → read `config.env.VITE_APP_VERSION` in an inline plugin; the version regex is duplicated there (boundaries bar `@trace/shared`), proven by the `AppVersionFile` test.
2. CSP §10.3: no inline script/style, no `style=`, no external fonts; `connect-src` extras must match `CONNECT_SRC_EXTRAS` (`check-headers.mjs:39-41`); exactly one `/*` rule.
3. Bundle: the candidate imports the logger from `@trace/shared/log`, never the package root (pulls zod contracts). Record kB.
4. `check-workflows` (`:540-546` and step checks after `:853`): `CLOUDFLARE_API_TOKEN` only on steps whose run text matches `\bwrangler\b` or `\bcheck-staging-secrets\b`; DB URL only on `supabase db push`/`psql` steps; no secret on or before the last install/build step; any `AWS_*` reference fails; job `name:` = id; `shell: bash`; keep `wrangler` visible in run text.
5. `.claude/settings.json` deny rules block `wrangler deploy*`, `wrangler pages deploy*`, `supabase db push*` even with `--help`: verify flags from installed sources or Context7; never use alternative spellings.
6. Writers never run `pnpm verify` or `test:rls` (they start/reset the shared stack); the lead runs full verify at each merge. The scripts suite once hung on a git credential prompt: set `GIT_TERMINAL_PROMPT=0`.
7. Workers tests: `vitest.config.ts` is lead-only, so `VERSION` overrides go through the fetch `env`; `vars` are not inherited by env blocks; regenerate `worker-configuration.d.ts` (`wrangler types --check` may drift Windows vs Linux).
8. `wrangler deploy` re-bundles instead of deploying the scanned dry-run `dist/` → ask the security-reviewer.
9. "No reporter" guards: candidate via `import.meta.glob` raw source test; edge only type-level (`types: []`); a structural `check-boundaries` rule would be a lead follow-up.
10. `static-module-paths` bans `new URL('..', import.meta.url)`; `check-boundaries` rule 1 bans literal credential names under apps/packages/`workers/edge` (tests included); rule 6 bans `eslint-disable` of `trace/`/`boundaries/` rules.
11. Product rules: no `getUserMedia` in the candidate (rule 8); no headers/IPs in Worker logs; no quality/integrity code; no Sentry on edge (Q17).
12. gitleaks scans every ref: build secret-shaped values at run time. 13. Writer worktrees start at `main`; `pnpm install --frozen-lockfile` first. 14. Linux CI: case-sensitive paths, LF endings.

## Open questions (lead decides HOW-level ones; founder-blocked ones go to FOUNDER-QUEUE)
- Q1 app build version variable: proposed `VITE_APP_VERSION` (HOW-level).
- Q2 smoke step Worker URLs: wrangler output file (`WRANGLER_OUTPUT_FILE_PATH`, verify in source) vs a new GitHub variable (would change §7.3).
- Q3 the P5 grant of new `scripts/` files to W-S3b (spec line ~904 makes `scripts/` lead-only).
- Q4 candidate edge origin left out until H4 and recorded as deferred; static `_headers` cannot carry per-environment origins once prod exists (M8).
- Q5 `tokens.json` `component` section as CSS variables? Proposed: numeric values only.
- Q6 enable Workers `observability` in `wrangler.jsonc`? Proposed: no change in M0a; ask the security-reviewer.
- Q7 does `supabase db push` on CLI 2.120.0 need a no-prompt flag; does ubuntu-24.04 `psql` work against PG17?
- Q8 AT-15 fixtures: synthetic until the first real run (no `wrangler login` on this machine by design).

## Writer prompts
The full ready-to-paste prompts (W-S2, W-S3a, W-S3b; each with setup `git reset --hard <SHA>`, owned files, test-first
steps, done checks, hard rules and report format) are summarised here; the lead expands them from the sections above
when launching. Key fixed decisions inside them:
- Version: apps read only env `VITE_APP_VERSION` (valid `/^[0-9a-f]{7,40}$|^dev$/`, else `dev`); `dist/version.json` = `{"app","version"}` (`AppVersionFile`). Workers: var `VERSION` (`dev` locally; CI `--var VERSION:<40-hex sha>`), declared at top level and in `env.dev` and `env.staging`.
- Workers: `src/app.ts` `createApp(deps)` (Hono): `GET /health` → `healthBody(service, resolveVersion(env.VERSION))` with `cache-control: no-store`; other paths 404 JSON; `onError` → 500 `{"error":"internal"}` with no message/stack; jobs and api report via `reportError(reporter, err, { release })` with `noopErrorReporter` injected; edge has no reporter key.
- W-S2 steps: tokens generator (+`--check`) → contrast pairs → both `vite.config.ts` (react, `forbidServerImports()`, inline version-file plugin) → candidate shell (logger only from `@trace/shared/log`; no reporter/Sentry/analytics/camera) → recruiter `/` and `/health` with error-reporting wiring → `_headers` per §10.3 (connect-src `'self'`; keep the TODO(H4) line) → confirm vendors.
- W-S3b steps: `check-staging-secrets.mjs` (allow-list `{edge:[],jobs:[],api:[]}`, fails closed) → `staging-catalog-checks.mjs --list` → `smoke-staging.mjs` (schemas from `packages/shared/src/contracts.ts`; https, `*.workers.dev`/`*.pages.dev` only, no redirects) → the job in §15.1 order (checkout → setup → build → scan-dist → `supabase db push` → psql catalog checks → deploy Workers → check secrets → Pages create/deploy → smoke) → `deploy-staging-job.test.mjs` (runChecks returns []; step order; no AWS_*).
- All writers: conventional lowercase commits ending with the Co-Authored-By line; never `--no-verify`; no PII; never push/merge/tag; never run `pnpm verify`, `test:rls`, `pnpm add`, supabase or wrangler deploy/secret/pages commands; no subagents; `.claude/allow-red` when stopping red.
