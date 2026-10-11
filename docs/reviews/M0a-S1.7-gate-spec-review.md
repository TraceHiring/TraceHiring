# M0a S1.7 gate: spec review of `adbbb61..72f8f1f` (S1.0–S1.7)

- Date: 2026-10-11, fresh read-only `spec-reviewer` (Opus; founder model policy: first review of code touching rule 1).
- Scope: `git diff adbbb61 72f8f1f` against `specs/m0-foundations.md` rev 14 (§1, §2, §5, §6, §7.1, §8, §8.5,
  §9.1–9.2, §10, §13, §13.1, §14), CLAUDE.md rules 1–9 and engineering rules, build-notes §0 (incl. the 18:55 IST
  rows), the `docs/build-order.md` M0a exit gate, and the lead commits `5ceff18..72f8f1f`. S1.0–S1.6 and the S1.7
  streams were not re-reviewed line by line (their stream reviews cover that).
- Ran (read-only): `check-workflows` OK; `gen-catalog-tests --check` OK (101); manifest 16 IDs / 85 branches; floors
  112 / 0 (`plan(101)` + `plan(11)`); `git diff 0522dfc^1 0522dfc` empty; esbuild bundles of `packages/shared/src/log`
  at `72f8f1f` and `26855cb` probed with synthetic values (K2); CI run 38146227653 on `72f8f1f`: `static` (scripts 829
  passed, 0 skipped), `rls` (112, floor 112, db-types current), `security` (gitleaks clean, audit 1 ignored, osv 1
  filtered, no issues), `migrations` all green; the lead's `verify-full-1/2` logs (exit 0, test:rls 112/112); a grep
  for real-looking emails/Indian mobiles in code and fixtures: none.

## Verdict: PASS WITH FINDINGS (1 Medium, 4 Low; nothing Blocking or High)
No violation of rules 1–9, tenancy (no tables yet; MT-1/2/11 in place), no-PII, secrets, vendor interfaces, the
no-new-framework rule (ADR-028 covers zod, Hono, React Router) or strict TS. The 18:55 founder decisions are applied
consistently. Spec rev 14 matches the code. `milestone/m0a` may be fast-forwarded once K1 has a recorded owner.

| # | Sev | file:line | Problem | Fix |
| --- | --- | --- | --- | --- |
| K1 | Medium | spec `:250` (§2), `:908` (§14 S1.4), `:427` (§7.2 step 6), `:865` (AT-15); `scripts/check-staging-secrets.mjs` absent | AT-15's local part (the script and its unit tests over recorded `wrangler secret list` output) is missing although it is S1.4 scope; `S2-S3-PLAN.md:21` proposes W-S3b (P5), but §14 `:926-932` makes `scripts/` lead-only | Before S3: (a) the lead writes it test-first (allow-list `{edge:[],jobs:[],api:[]}`, fails closed), or (b) spec rev 15 §14 records the P5 grant and moves AT-15's local part to S3 |
| K2 | Low | `packages/shared/src/log/redact.ts:407` (H1, `72f8f1f`) | **Regression from H1**: `Bearer =<v>`, `Basic =<v>`, `Bearer :<v>`, `Basic :<v>` were `[REDACTED]` at `26855cb` and leak at `72f8f1f` (`bearer`/`basic` are not key stems). H1 itself was not security-reviewed | Apply the look-ahead to `Token` only; add the 4 shapes with an idempotence check; small security re-review |
| K3 | Low | spec text | (a) `:255` says `claude-*.mjs` are unchanged, but `d9bf35a` rewrote the session-start hook and added its test; (b) §7.1 `security`/§2 omit `osv-scanner.toml`, `auditConfig.ignoreGhsas` and `overrides`; (c) `:848` says the AT-1a-local image digest is in §4 (it is only in `scripts/lib/clean-clone.mjs:9-10`); (d) `:575` "MT-11 … has 7" (manifest 11) and `:649-653` still list the rev-7 "51 branch controls" (manifest 85); (e) the N13 residuals are not in §15 | One HOW-level spec revision 15 before CLOSE fixing (a)–(e) |
| K4 | Low | `scripts/test/scan-dist.test.mjs:642-646` | On Windows `ctx.skip` on EPERM: local `pnpm verify` shows "828 passed \| 1 skipped"; CLAUDE.md says never mark work done with skipped checks; Linux CI runs it (829, 0 skipped). The exception is only in a code comment | Record the platform exception with the Linux CI run as evidence in build-notes and next to AT-1b in the M0a summary (or run AT-1b with Developer Mode on) |
| K5 | Low | spec `:924` (§14 checkpoints) | Only `cp/autopilot-installed`, `cp/m0a-00`, `cp/m0a-01` exist; S1.1–S1.6 never reached `milestone/m0a` | When tagging, record which commit each tag marks (green full-verify commits) and that S1.1–S1.6 were folded into the S1.7 fast-forward |

## AT coverage (spec §13)
| AT | Covering test or status |
| --- | --- |
| AT-1a-CI | Deferred/CI; S1 part green (run 38146227653, `static` + `rls` on a fresh checkout); final at CLOSE after S2/S3 |
| AT-1a-local, AT-1b | `scripts/verify-clean-clone.mjs` (`--linux` / host); planning tests in `lib-clean-clone.test.mjs`; not run yet (S4/CLOSE; K4) |
| AT-2 | `test:rls`: `catalog_meta` 101 + `catalog_probe` 11 = 112 (local and CI) |
| AT-3 | `scripts/test/test-rls.test.mjs` (Docker down, zero tests, floors, lock) |
| AT-4 | `scripts/test/verify-fast.test.mjs` |
| AT-5 | last step of `pnpm lint` (pinned by `root-scripts.test.mjs`); CI `security` |
| AT-6, AT-6c | `scripts/test/hooks.test.mjs` |
| AT-7 | `scripts/test/commitlint.test.mjs` |
| AT-8 | `packages/shared/src/log/redact.test.ts` (property tests) + `serializeError` tests; gap K2 |
| AT-9 | unit part `logger.test.ts` (incl. no `@sentry/` in the lockfile); wiring in recruiter/jobs/api: S2/S3 |
| AT-9-sentry | Deferred, owner "before D1" |
| AT-10 | S3 |
| AT-11, AT-18, AT-22-staging | Deferred (S3 + H3–H5) |
| AT-12 | local part `check-workflows.test.mjs` + `lint`; deploy job S3; H3 branch policy deferred |
| AT-13 | Deferred; founder §17 item 8 (branch protection vs session-end push) |
| AT-14 | `packages/config/test/*` + `check-boundaries.test.mjs` |
| AT-15 | **MISSING** local part (K1); deferred part S3 deploy step 6 |
| AT-16 | `scan-dist.test.mjs` + `build`; deferred part S3 deploy step 2 |
| AT-17 | `check-migrations.test.mjs` + `lint`; CI `migrations` |
| AT-19 | `gen-catalog-tests.test.mjs` + `--check` in `lint` |
| AT-20 | S2 |
| AT-21, AT-22-local | `check-bundle-size.test.mjs`, `check-headers.test.mjs` (final with S2) |
| AT-23 | `test-rls.test.mjs`, `db-types.test.mjs`; "database.ts is current" locally and in CI |
| AT-24 | `scripts/test/backup.test.mjs` |

## Exit gate (`docs/build-order.md` M0a)
| Item | Status |
| --- | --- |
| Clean clone → `pnpm i && pnpm verify` green on Linux CI; once on the founder's Windows machine | S1 part met (CI 38146227653); AT-1a/AT-1b at CLOSE (K4) |
| `db reset` from zero, pgTAP harness, catalog meta-tests, `test:rls` fails if Docker is down | **Met** (AT-2, AT-3, AT-19, AT-23) |
| Staging deploys from CI only; every health endpoint shows the deployed commit | Not met: S3 (AT-10, AT-15 incl. K1, P2); deferred AT-11, AT-18, AT-22-staging; founder H3–H5 open |
| No secret in repo history | **Met** (gitleaks in `lint` and CI); owed before CLOSE: the gitleaks default-allowlist regex fix |
| Pre-commit scan blocks a staged secret | **Met** (AT-6, AT-6c) |
| PII-redaction tests pass | **Met for S1** (AT-8, AT-9 unit part); AT-9 wiring S2/S3; ABH-80 log scan at M0a REVIEW; AT-9-sentry before D1 |
| CI blocks merge on red | Local part met (AT-12); AT-13 deferred, founder-blocked |

M0a summary Deferred table must list: AT-1a-CI, AT-11, AT-13, AT-18, AT-22-staging, the deferred parts of AT-12,
AT-15, AT-16; D6 → M6, D7 → M4/M5 checklist, D8 → M6, E3 → M0b, the N13 residuals; AT-9-sentry/H6 → before D1.

## Not checked
`pnpm verify`/`test:rls`/database (relied on the lead's logs and CI 38146227653); line-level S1.0–S1.6 and S1.7
streams; catalog SQL semantics beyond counts and reports; `verify-clean-clone` runs; FOUNDER-QUEUE contents after
`0522dfc`; Workers/browser runtimes for the logger.

## Disposition (lead)
PASS WITH FINDINGS accepted.
- **K2 fixed** in `2b81ac4` (test-first: the 4 shapes failed on `72f8f1f`; look-ahead on `Token` only; `@trace/shared`
  613 passed). Owed: a small security re-review of H1 + K2 (`26855cb..2b81ac4`, Sonnet), first step next session.
- **K1 owner: the lead, option (a)**, before S3 starts: `scripts/check-staging-secrets.mjs` test-first (scripts/ stays
  lead-only; no P5 grant).
- **K3 → spec revision 15**, lead, before M0a CLOSE.
- **K4**: platform exception recorded in build-notes "Autopilot changes" (2026-10-11); the M0a summary repeats it
  next to AT-1b.
- **K5**: tag mapping recorded in `docs/progress/LOG.md`: `cp/m0a-02` = `3141764` (S1.7 catalog merged, cold-stack
  full verify green), `cp/m0a-03` = the gate tip (full verify green); S1.1–S1.6 are folded into this fast-forward.
