# HANDOFF — 2026-10-23 10:25 IST (M1 BUILD 1 = Wave 0 part 3 on `m1/integration`; next: Wave 0 tail, then BUILD 2)
Reason for stopping: usage guard (5-hour window ~88%, resets 11:10 IST); Wave 0c's work is placed, reviewed, fixed and fully verified. Start from `docs/progress/RESUME-PROMPT.md` on **`m1/integration`** (worktree `.claude/worktrees/m1-integration`). The repo wins over this file.

## Paused: D1 (founder, 2026-10-22 night: paused, not closed)
D1's remaining steps belong to a D1 chat on `d1/integration` (worktree `.claude/worktrees/d1-integration`). Nothing is committed to `d1/integration` or `main` from M1. Copied from the `d1/integration` HANDOFF (`3c2e42a`, tip `1547fd0`):
- **Next step 1.** Workers Paid answered (2026-10-22 21:20): "not yet"; OPEN-8a stays a founder gate and D1 can close without it. Remaining founder item: **AT-D2 capture**. For it: dispatch staging from `d1/integration` with `run_e2e=true` on the final tip (re-checks AT-D1/AT-D17 after `1d36151`), then the founder runs `pnpm e2e:record` (spec 4p §7.3) with an OS-level screen capture; record file name, SHA-256, `recordedMs`, run id.
- **Next step 2.** Then `docs/milestones/D1-summary.md`, tag the next free `cp/d1-*` number (after `cp/d1-11`, `cp/d1-10`) on the verified tip, and **D1 CLOSE by PR to `main`** only with the founder's go-ahead (AUTOPILOT §2, §6). At the merge the founder adds `e2e-local` back to ruleset 25633431's required checks.
- **Staging re-run already done on the final tip (reuse it):** dispatch **39820502191** on `1547fd0` (run_e2e=true, started before the pause, not touched by M1): all 7 jobs **success** (static, migrations, rls, security, e2e-local, deploy-staging, e2e-staging). Artifact `e2e-staging-results` manifest: spec `d1-slice`, project `staging`, sha `1547fd0…`, 55/55 steps ok, `durationMs` 304726, `recordedMs` 295068 (`record: false`), **AT-D17 `time_to_ready_ms`: A 46307, B 30833, C 69999, D 19441** (max 70.0 s: inside the 90 s gate; the 30 s target is still the M5-owned deviation). If `d1/integration` is still `1547fd0`, this is the "staging re-run on the final tip"; only the AT-D2 capture (record mode) remains.
- **D1 founder items:** AT-D2 screen capture (`pnpm e2e:record`); Workers Paid (OPEN-8a) "not yet", decide before any load test (M3a); Dependabot PRs #7-#12 not merged blind; after D1 merges, `e2e-local` back on the required checks.

## Where we are (verified this chat)
- Milestone **M1 · Test authoring**, phase **BUILD 1 = Wave 0, part 3 done** (all four migrations M1-a…d placed and reviewed). A short Wave 0 tail is left (Next step 1) before BUILD 2.
- `m1/integration` HEAD = this handoff commit; code tip `45a19cc` (+ spec-only `4cce92f`). `d1/integration` = `1547fd0`, `trace/main` = `da5380d`: unchanged.
- `pnpm test:rls` green on `45a19cc`'s tree from a fresh reset: rls_* **3632** (floor 3262 → 3610 → 3632), catalog_* **150**, db-types current. Full verify on `45a19cc`: `pnpm -s typecheck` exit 0; lint, `pnpm -r --workspace-concurrency=1 --if-present test`, `vitest run --root scripts` (2819 passed / 2 skipped), `pnpm -s build` all exit 0 (scratchpad `verify.sh`).
- Linux CI on PR TraceHiring/TraceHiring#14: `7cc340c` all green; `2250ccc` **static red** (db-types type test did not list the M1-c/M1-d tables) → fixed in `45a19cc`; on `45a19cc` migrations, rls, security pass, static was still pending at the handoff. **Check it first** (`gh pr checks 14 --repo TraceHiring/TraceHiring`).
- `verify:fast` at session start on `7cc340c`: exit 0 (319 s).

## Done this chat (tests first; Opus first reviews, fixes test first, a confirming re-review)
- Carried M1-a/M1-b notes: red `8680713`, fix `dfd177e` (spec **R5-49**): written item needs its rubric (`item_version_ready` + publish over approved pool items; D1's shape CHECK already held it), strata whole numbers ≥ 1, publish reads the ruleset `for share`, `item.key_review` audit + AUDIT_ACTIONS (48), sealed-catalog assert.
- M1-c/M1-d: red `fa904d3`, placed `2250ccc` = `supabase/migrations/20261023030000_m1_imports_drafts.sql` + `20261023040000_m1_members.sql` (provisional ts, R5-30); pgTAP `rls_m1_imports`, `rls_m1_ai_drafts`, `rls_m1_members`; preamble `pg_temp.ai_draft` via a running job; hook split `ai_draft_job_has_room` (new stub in M1-a). Supersessions recorded in spec **R5-50** (L-20 six→eight, `rls_memberships:404` explicit 42501, `rls_roles` worker lists, `rls_d1_invariants:23` DB-M1-11).
- `renderCandidateSummary` (AT-M1-31): writer branch `m1/w0c-candidate-summary` (`16abda6`, `90d7d0e`, review fixes `7a3ad3e`, `d7b676e`) merged `66555a1`: `packages/shared/src/candidate-summary.ts` (+ `captureSignalsFor`, `SETTING_CAPTURE_SIGNALS`, `CANDIDATE_SUMMARY_VERSION = 'candidate-summary-1'`), exported from `index.ts`.
- Reviews (reports in the shared notes folder `…/side-session-notes/local_83768b5d-…/review-{spec,sec,db,confirm}-m1cd.md`): Opus spec PASS WITH FIXES, Opus security PASS WITH FIXES (summary PASS), Opus database APPROVE WITH FIXES (1 High, 3 Medium); Sonnet confirming re-review **CONFIRMED WITH NOTES**.
- Fixes: `ee2f7fc` contracts = DB CHECK lists (`contracts-m1-db.test.ts`; `ImportField` + `options`; `ImportJobErrorCode`, `AiDraftErrorCode` enums); red `162e374` + fix `89c1030` (accept re-checks the inviter R2-14; display name 22023; `import_job_open` FOR SHARE; drafting hooks FOR NO KEY UPDATE; open→completed refused; partial index `item_versions_bank_content_idx`); `45a19cc` RLS matrix cells (DB M2), candidate_denied fixtures, synthetic names, db-types pins, floor; spec **R5-51** (decisions + A2 notes), `4cce92f` R5-51 (h).

## Next step (one precise action list)
1. **Wave 0 tail (lead, small, tests first):** (a) confirm CI green on the PR head; (b) a `rls_m1_members` case: an owner invitation cannot be accepted after its owner inviter was removed (confirming re-review Low); (c) a two-connection case in `scripts/test-concurrency-local.mjs` for DB H1 (cancel waits for a running import batch and counts its rows) and DB M1 (two deliveries cannot overfill a count-1 drafting job) — today only function-body pgTAP checks guard them; (d) DC-M1-1 (PostgREST calls an INVOKER function with the caller's JWT, local) recorded in spec §8. Then Wave 0 is done.
2. **BUILD 2 = Wave 1:** pre-flight agent (AUTOPILOT §2 efficiency rules), then writers A1, A6, A5 in `m1/<stream>` worktrees reset to the Wave 0 tip; Opus first reviews per §11.3; fixes test first; confirming re-review; merges; full verify; CI.

## Notes for later streams (from reviews; not defects now)
- **A2 (spec R5-51 f):** pin `provider`, `model_id`, `prompt_version`, `images_ok` in the api; insert jobs with `returning id` and then drop `id` from the import_jobs/ai_draft_jobs insert grants (security L-2); `save_test_draft` reuses an unchanged rubric version (DB L6). DB L2: drafter may over-generate (R5-51 d).
- A3: call `checkMirrorV2()` in the mirror stage; check `poolSectionIds` against `sections.pool_id`; remove the v2 retry guard in `workers/jobs/src/queue/consumer.ts` once v2 is stored. Use `captureSignalsFor` for `TestPackageV2.captureSignals` (A2/A4).
- A5 import: per-XML-part cap ~10–20 MB; render rows only as React text; validate the postMessage shape. A6: rule 13 needs an `assert*Env` call in `MockLlmDrafter`'s constructor.
- Infra Lows: `if:` on deploy steps is not pinned by check-workflows; the edge no-secrets test pattern is looser than rule 11.
- Out of this diff (security review): M0b's owner/admin `active` membership insert for a known user id skips consent (R2-15 model); needs a plan-conflicts/ADR note later.

## Founder items
- New FOUNDER-QUEUE row 2026-10-23: import cancel keeps the rows already imported (default (a); not rules 1-9; not blocking). Unchanged: M1 staging Hyperdrive configs + secrets row; Q-M1-1…Q-M1-4.

## Gotchas
- The worktree guard refuses `cd …&&` + chained git, `$(...)`, `git -C`, and heredocs that mention git; commit messages via `git commit -F <file>`; merge subjects `chore: merge …` (amend a default merge message before pushing).
- Writers share the lead's scratchpad: give lead commit-message files unique names (a writer overwrote `msg1.txt`).
- Python `open(...,'w')` on Windows writes CRLF unless `newline='
'`. The local `postgres` is not a superuser.
- Never hand-edit generated `rls_m1_*.test.sql`: edit `docs/progress/m1-wave0-drafts/pgtap/bodies/*.sql`, then `node docs/progress/m1-wave0-drafts/pgtap/gen.mjs <repo root>`; `node …/pgtap/run.mjs <names>` runs them.
- Run `pnpm -s typecheck` before pushing a migration (db-types type test pins tables/functions; CI static failed once).
- RAM: run tests serially (`pnpm -r --workspace-concurrency=1`), never alongside writers.

## Verify first
`git fetch trace` · `git log --oneline -3 m1/integration` · `git status` · `git rev-parse --short trace/d1/integration` (`1547fd0`) · `git rev-parse --short trace/main` (`da5380d`) · `gh pr checks 14 --repo TraceHiring/TraceHiring` · `pnpm -s verify:fast`
