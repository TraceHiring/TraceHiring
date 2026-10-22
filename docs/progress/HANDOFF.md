# HANDOFF — 2026-10-23 01:45 IST (M1 BUILD 1 = Wave 0, part 1 done on `m1/integration`; next: Wave 0 part 2)
Reason for stopping: context near 60% (chat rule). Wave 0 split at the migration boundary (spec §11.4). Usage at stop: see LOG row. Start from `docs/progress/RESUME-PROMPT.md` on **`m1/integration`** (worktree `.claude/worktrees/m1-integration`). The repo wins over this file and over any memory.

## Paused: D1 (founder, 2026-10-22 night: paused, not closed)
D1's remaining steps belong to a D1 chat on `d1/integration` (worktree `.claude/worktrees/d1-integration`). Nothing is committed to `d1/integration` or `main` from M1. Copied from the `d1/integration` HANDOFF (`3c2e42a`, tip `1547fd0`):
- **Next step 1.** Workers Paid answered (2026-10-22 21:20): "not yet"; OPEN-8a stays a founder gate and D1 can close without it. Remaining founder item: **AT-D2 capture**. For it: dispatch staging from `d1/integration` with `run_e2e=true` on the final tip (re-checks AT-D1/AT-D17 after `1d36151`), then the founder runs `pnpm e2e:record` (spec 4p §7.3) with an OS-level screen capture; record file name, SHA-256, `recordedMs`, run id.
- **Next step 2.** Then `docs/milestones/D1-summary.md`, tag the next free `cp/d1-*` number (after `cp/d1-11`, `cp/d1-10`) on the verified tip, and **D1 CLOSE by PR to `main`** only with the founder's go-ahead (AUTOPILOT §2, §6). At the merge the founder adds `e2e-local` back to ruleset 25633431's required checks.
- **Staging re-run already done on the final tip (reuse it):** dispatch **39820502191** on `1547fd0` (run_e2e=true, started before the pause, not touched by M1): all 7 jobs **success** (static, migrations, rls, security, e2e-local, deploy-staging, e2e-staging). Artifact `e2e-staging-results` manifest: spec `d1-slice`, project `staging`, sha `1547fd0…`, 55/55 steps ok, `durationMs` 304726, `recordedMs` 295068 (`record: false`), **AT-D17 `time_to_ready_ms`: A 46307, B 30833, C 69999, D 19441** (max 70.0 s: inside the 90 s gate; the 30 s target is still the M5-owned deviation). If `d1/integration` is still `1547fd0`, this is the "staging re-run on the final tip"; only the AT-D2 capture (record mode) remains.
- **D1 founder items:** AT-D2 screen capture (`pnpm e2e:record`); Workers Paid (OPEN-8a) "not yet", decide before any load test (M3a); Dependabot PRs #7-#12 not merged blind; after D1 merges, `e2e-local` back on the required checks.

## Where we are (verified this chat)
- Milestone **M1 · Test authoring**, phase **BUILD 1 = Wave 0, part 1 of 2 done** (lead only, no writers). Branch `m1/integration`. HEAD = this handoff commit; parents `3db2585` (db-types type test) → `486f41d` (M1-a migration) → `a7a3d94` (pgTAP red first) → `a6ae915` (M1 SPEC handoff).
- `d1/integration` = `1547fd0`, `trace/main` = `da5380d`: unchanged.
- `pnpm test:rls` green on `486f41d`'s tree (all files, catalog checks, db-types; `rls_*` 2870 passed = new floor; `catalog_*` floor 144 unchanged). Full `pnpm verify` (`--workspace-concurrency=1`) on `3db2585`: typecheck + lint green; `workers/edge` test hit a V8 heap OOM once (RAM, D1-LEAD-1 class), passed alone (24 files, 417 tests); then `pnpm test`, `pnpm test:rls`, `pnpm build` re-run in sequence: exit 0.
- No staging dispatch. No reviews run yet on M1-a (see Next step 3).

## Done this chat (verified)
- `a7a3d94` pgTAP written red first: `supabase/tests/rls_m1_bank` (110), `rls_m1_keys` (47), `rls_m1_variants` (34), `rls_m1_pools` (44); sources + drafts in `docs/progress/m1-wave0-drafts/` (README there).
- `486f41d` migration **M1-a** `supabase/migrations/20261023010000_m1_bank.sql` (provisional timestamp, R5-30): roles `trace_authoring_worker`, `trace_admin_worker`; library org + default workspace; `private.library_org_id()`; `item_status` enum; `skill_taxonomy` (+ seed, moved here from M1-b); `items`; `item_versions` widened + guard v2 (inline rows keep D1's path; bank §4.1 state machine, origin from the write path, approver roles R5-38/R5-40, library expert review); `item_answer_keys` widened + guard v2 (R5-44) + policies recreated with `not library_sourced`; `item_variants`/`item_variant_keys` (±0.10); `item_exposure_events` (append-only) + `v_item_exposure`; `v_item_bank_quant_share` (AT-M1-06 counting view, new); `pools`/`pool_items`; `library_copy_requests` + copy trigger (reuse, rubric copy, 2,000/day cap); `private.library_browse`, `library_exposure` (trace_api); hooks `private.ai_draft_job_running` / `import_job_open` return false until M1-c replaces them.
- R5-28 edits (add-only): `rls_d1_invariants` role list, login lists, I-12 NOT NULL list minus item_versions/item_answer_keys (inline proof in rls_m1_bank/keys). `rls_roles` R5-32 lists extended + 2 rows for the new roles (plan 67). `packages/db-types` regenerated. build-notes "Autopilot changes" row (R5-1, R3-10, split, seed move).
- One D1 test caught a regression and it was fixed in the migration (`rls_d1_consents` TRUNCATE CASCADE): `item_exposure_events` keeps its owner TRUNCATE grant (the ALWAYS trigger refuses it).

## Next step (one precise action)
**M1 BUILD 1 part 2 (Wave 0b), lead only:**
1. pgTAP red first for M1-b from `docs/progress/m1-wave0-drafts/m1b_tests.sql.draft` (applied cleanly locally on top of M1-a, untested): `rls_m1_snapshot`, `rls_m1_publish_v2`, `rls_m1_serving`, `rls_m1_settings` (incl. R5-5/R5-31 flags guard, R5-34), `rls_m1_templates_jobs`, `rls_m1_carried` (each replaced function: one D1 case + one M1 case; B0-SP7 rest), `rls_m1_candidate_denied`; then place M1-b, then M1-c (imports, ai drafts; replace the two hooks; ai_draft⇔job CHECK; AT-M1-07/08 ai cases), M1-d (members, R5-35 fences) with `rls_m1_imports`, `rls_m1_ai_drafts`, `rls_m1_members`. Use the generator (`gen.mjs`/`run.mjs`, preamble) in the drafts folder.
2. Then the rest of §11.2: contracts (`contracts-m1.ts`, candidate v2, mirror v1|v2 union, `refusedSeqs`/`section_closed`, audit actions R5-14/R5-26 — the DB already writes `item.create`, `item.submit`, `item.approve`, `item.not_approved`, `item.retire`, `item.ai_drafted`, `library.copy`, `pool.archive`), ADR-033, logins R5-11, secrets allow-list R5-12 (+ D1 spec 4q row), queues R5-13, boundaries R5-10, `VENDOR_INTERFACES`, carried items (MT-11 FR-1, D1-LEAD-1), floors.
3. Opus database-reviewer + security-reviewer on M1-a…d, spec-reviewer on contracts; fixes test first; confirming re-review; full `pnpm verify`; draft PR `m1/integration → main` (CI only, never merged); fix Linux CI. If one chat cannot hold it, split again at a migration boundary.
Then BUILD 2 = Wave 1 (A1, A6, A5).

## Decisions made this chat (all HOW-level, build-notes row 2026-10-23)
- Wave 0 split (§11.4). Skill taxonomy seed in M1-a. `items.id` and pool/library/copy ids are client-suppliable (uuid, like consents); `item_versions.id` is not (D1 grant kept).
- Operator path (postgres, no JWT) may name `origin` and the approval columns, as it names `created_by` in D1 (fixtures; AT-M1-08's ai_draft fixture).
- An `origin` value outside the CHECK is left for the CHECK (23514, rls_d1_tests:487 unchanged); any value inside it is overwritten from the write path (carried n-3).
- Library copies of written items copy the library rubric into the customer org as `library-<key>` (FK needs a same-org rubric). Library media keys are kept as is (shared library prefix).
- `v_item_bank_quant_share` view added for AT-M1-06's db-backed case.

## Founder items
- Unchanged: Q-M1-1…Q-M1-4 (FOUNDER-QUEUE, defaults built); staging parts of M1 wait for a staging go-ahead.

## Gotchas
- The worktree guard refuses `cd …&&` + git, `$(...)`, shell variables in docker/sed/git commands and chained git calls: run plain commands from the worktree; commit messages via `git commit -F <scratchpad file>`.
- pgTAP runs as a superuser through `supabase test db`; plain `psql -U postgres` cannot `grant trace_* to postgres`. Run one file: `pnpm exec supabase test db --local supabase/tests/<file>`.
- Never hand-edit generated `rls_m1_*.test.sql`: edit `docs/progress/m1-wave0-drafts/pgtap/bodies/<name>.sql`, regenerate.
- `integrity_presets` column is `preset_values` (`values` is reserved).

## Verify first
`git fetch trace` · `git log --oneline -3 m1/integration` · `git status` · `git rev-parse --short trace/d1/integration` (`1547fd0`) · `git rev-parse --short trace/main` (`da5380d`) · `pnpm -s verify:fast`
