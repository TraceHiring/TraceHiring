# HANDOFF — 2026-10-23 21:05 IST (M1 BUILD 3 = Wave 2 part 5: A2b merged with mounts; M1-k → M1-l; A2a writer running)
Reason for writing: mid-session checkpoint (the session continues). Start from `docs/progress/RESUME-PROMPT.md` §4 on **`m1/integration`** (worktree `.claude/worktrees/m1-integration`). The repo wins over this file.

## Paused: D1 (founder, 2026-10-22 night: paused, not closed)
D1's remaining steps belong to a D1 chat on `d1/integration` (worktree `.claude/worktrees/d1-integration`). Nothing is committed to `d1/integration` or `main` from M1. Copied from the `d1/integration` HANDOFF (`3c2e42a`, tip `1547fd0`):
- **Next step 1.** Workers Paid answered (2026-10-22 21:20): "not yet"; OPEN-8a stays a founder gate and D1 can close without it. Remaining founder item: **AT-D2 capture**. For it: dispatch staging from `d1/integration` with `run_e2e=true` on the final tip (re-checks AT-D1/AT-D17 after `1d36151`), then the founder runs `pnpm e2e:record` (spec 4p §7.3) with an OS-level screen capture; record file name, SHA-256, `recordedMs`, run id.
- **Next step 2.** Then `docs/milestones/D1-summary.md`, tag the next free `cp/d1-*` number (after `cp/d1-11`, `cp/d1-10`) on the verified tip, and **D1 CLOSE by PR to `main`** only with the founder's go-ahead (AUTOPILOT §2, §6). At the merge the founder adds `e2e-local` back to ruleset 25633431's required checks.
- **Staging re-run already done on the final tip (reuse it):** dispatch **39820502191** on `1547fd0` (run_e2e=true, started before the pause, not touched by M1): all 7 jobs **success** (static, migrations, rls, security, e2e-local, deploy-staging, e2e-staging). Artifact `e2e-staging-results` manifest: spec `d1-slice`, project `staging`, sha `1547fd0…`, 55/55 steps ok, `durationMs` 304726, `recordedMs` 295068 (`record: false`), **AT-D17 `time_to_ready_ms`: A 46307, B 30833, C 69999, D 19441** (max 70.0 s: inside the 90 s gate; the 30 s target is still the M5-owned deviation). If `d1/integration` is still `1547fd0`, this is the "staging re-run on the final tip"; only the AT-D2 capture (record mode) remains.
- **D1 founder items:** AT-D2 screen capture (`pnpm e2e:record`); Workers Paid (OPEN-8a) "not yet", decide before any load test (M3a); Dependabot PRs #7-#12 not merged blind; after D1 merges, `e2e-local` back on the required checks.

## Where we are (verified this chat)
- Milestone **M1 · Test authoring**, phase **BUILD 3 = Wave 2**. Spec `specs/m1-test-authoring.md` rev 5, rows up to **R5-63 (i)**. Reviews: `docs/reviews/M1-wave2-first-reviews.md`.
- `m1/integration` tip **`620065a`** (+ this handoff). `trace/d1/integration` = `1547fd0`, `trace/main` = `da5380d`: unchanged.
- **Full serial verify GREEN on `4fca331`** (21:00 IST): typecheck, lint, `pnpm -r --workspace-concurrency=1 --if-present test`, `vitest run --root scripts`, `pnpm test:rls` (46 files, catalog 150, **rls 3716**, floor raised to 3716 in `620065a`), db-types current, build. **Linux CI green on `4fca331`** (run 39977742509). CI failed on `201aaf7` and `fca81ee` (the M1-k D1-pin problem, fixed by M1-l).

## Done this chat (commits on m1/integration)
- Migration **M1-k** (`0b52059` red → `9a06211`): trace_api column SELECT on `tests (id, org_id, name)`. The full verify then failed `rls_d1_api` 41 ("tests: trace_api has no SELECT privilege", a D1 pin outside the R5-28/R5-50 lists) → **M1-l** `20261023120000_m1_api_test_title_fn.sql` (`d1342de` red → `4fca331`): drops M1-k's grant/policy, adds `private.api_test_title(uuid)` (DEFINER, empty search_path, bound to `api_org_id()`, EXECUTE trace_api only); candidate store calls it. Spec **R5-63 (i)**. Opus DB review of M1-k/M1-l + mounts: **APPROVE** (Low 1 documented in the store header).
- **A2b merged** `f9a6ad4` (`m1/a2b-fix-1` @ `5c2a892`; Opus confirming re-review: spec CONFIRMED WITH NOTES, security CONFIRMED, database CONFIRMED WITH NOTES). Lead: `ea849cd` red (route inventory + log hygiene for the 13 A2b routes; unbound-limiter 503 test), `fca81ee` mounts in `services/api/src/app.ts` (`createTestDraftRoutes`, `createIntegritySettingsRoutes`, `createTemplatesRoutes` with `libraryLimiterFromEnv`, `createMembersRoutes`, `reference` on `createTestsRoutes`) + wrangler `ratelimits` **`LIBRARY_LIMITER` 60/60 s, namespace 1201 dev / 1202 staging** (bindings test pins it).
- Review records `e457d68`, `620065a`.

## In flight at handoff (check first, trust nothing)
1. **A2a writer (Opus) RUNNING** in its own Agent worktree, branch **`m1/a2a-api-bank`** reset to **`620065a`**; brief = common brief + scratchpad stream brief (copied below in "A2a scope"). Commits locally only (never pushes). If this session ended before its report: find its worktree with `git worktree list | grep a2a`, check `git log --oneline 620065a..m1/a2a-api-bank`, push the branch, and resume (re-brief a writer from its last green commit). Then: three Opus first reviews (spec, security, database), fix round test first, confirming re-review, merge with the lead mounts (route inventory + log hygiene + `A2A_NEW_ROUTES`, `LIBRARY_LIMITER` shared with from-template), full serial verify, CI.

## A2a scope (the brief)
`services/api/src/modules/{bank,pools,library,imports,ai-drafts}/**` + guard keys in `modules/tests/org-context.ts` (`item_frozen`, `item_status_change`, `approver_required`, `pool_archived`, `import_not_open`, `library_not_approved`; A2b re-review Note 4). Library browse via 10-arg `library_browse` + `PageCursor` (R5-57 b, reuse `rest-keyset.ts`), `LibraryLimiter` like `templates/routes.ts` (R5-56 g); ai-drafts `topic_sha256` = SHA-256 hex of UTF-8 `scrubDraftTopic(topic)` (R5-61 d) + `AuthoringQueueMessage`; imports image PUT to `ITEM_MEDIA`, rows per §4.3 (AT-M1-11), cancel keeps rows; bank stats (AT-M1-06); a `m1-a2a-routes-mount.test.ts` exporting `A2A_NEW_ROUTES`.

## Stream branches
Merged (do not delete): `m1/a1-packages` · `m1/a5a-fix-1` · `m1/a5b-fix-1` · `m1/a5c-fix-1` · `m1/a4-edge-delivery` `7f2fb9c` · `m1/a4-fix-1` `a0c1d46` · `m1/a3a-jobs-v2` `74d9891` · `m1/a3a-fix-1` `402a3ac` · `m1/a3a-fix-2` `8af7845` · `m1/a3b-jobs-authoring` `2b706d0` · `m1/a3b-fix-1` `1866c92` · `m1/a2b-api-tests` `8f7b52c` · `m1/a2b-fix-1` `5c2a892` (all on `trace`). Unmerged by founder answer (b): `m1/a5a-fix-2/-3/-4` (zip reader, M8). Running: `m1/a2a-api-bank` (local, not pushed yet).

## Next step (one precise action list)
1. Verify first (below). Then "In flight" 1 (A2a report → push branch → reviews → fix → re-review → merge).
2. **Lead, owed before the M1 exit (R5-63 f):** one SQL function for the publish reads (N+1; Workers subrequest limit, OPEN-8a), an atomic `create_test_from_template` RPC (also fixes A2b re-review Low 3: clone/from-template after a failed `pinPresetVersion`), the written paste rule derived in the database (one write; also Note 5), template list paging. R5-61 h: indexed duplicate hash, jobs `SUPABASE_URL` with the M1 staging half (deploy checks refuse extra jobs vars, S3B-1), a drafting lease. R5-62 b: a jobs db-test for the "more than one account" lookup branch. A2b re-review Low 2: staging check of R2 `onlyIf` (missing object `uploadedBefore`; same-bytes rewrite; clock) at the next founder-approved staging dispatch.
3. After each merge: full serial `pnpm verify` (raise `supabase/tests/rls-min-count`, now 3716) and Linux CI on PR #14.
4. Then BUILD 4 = Wave 3 (A7, E2E, measurement) per spec §11.4. DC-M1-2 (built recruiter app under the real CSP) still to run.

## Notes for Wave 2 (carried; not defects now)
- A2 (A2a part): per-route body caps; body reader refuses `__proto__`; ApproveItemRequest body id = path id; option `text` ↔ package `label`; content hash per R5-49 a; RESERVED_NAMES vs ParamName (`reserved_name`); A5c N1 (`fromDraftView(view, integrity)` + `onSaved` → `setPasteWritten` → re-save, recruiter app, lead); A5a S7 (image PUT refusal codes; else `image_refused`).
- A7 (Wave 3): sends `afterSeq` on every v2 GET (R5-59 d); copy warns that finishing an untimed section is final (R5-59 e).
- R2-5 gap: re-copying a retired library copy hands back the retired copy. DC-M1-4 — OPEN-8a founder gate. `ratelimits` on staging (edge and now api) confirmed only by a staging dispatch (ADR-032).

## Founder items
- Unchanged: coverage when tab focus is off (default a); D1 integrity job re-delivered after M1 (default a); M1-15 "shared-device" copy (default: leave out); import cancel keeps rows (default a); M1 staging Hyperdrive configs + secrets (+ jobs `SUPABASE_URL`, + api `MEMBER_INVITE_PEPPER` ≥ 32 bytes); Q-M1-1…Q-M1-4; OPEN-8a Workers Paid; written AI drafts; zip reader answered (b).

## Gotchas
- Worktree guard: no `cd …&&`, `git -C`, `$(...)`, loops, compound or piped node-script commands; write scripts with the Write tool and run them plainly; commit messages via `git commit -F <unique file>`; merges `chore: merge …`. A refused compound command runs NOTHING.
- `node scripts/db-types.mjs` and `pnpm test:rls` RESET the local database: never while a writer runs db-tests. `pnpm exec supabase migration up --local` applies a new migration without a reset.
- D1 pgTAP pins (`rls_d1_*`) change only via an R5-28/R5-50 supersession row and only add-only; a new grant that loosens one needs another design (M1-l).
- RAM: never run workspace tests while writers run; writers run only their own package tests.
- Never hand-edit generated `rls_m1_*.test.sql`: edit `docs/progress/m1-wave0-drafts/pgtap/bodies/*.sql`/`preamble.sql`, run `node docs/progress/m1-wave0-drafts/pgtap/gen.mjs .`, run named files with `node docs/progress/m1-wave0-drafts/pgtap/run.mjs <names>`.

## Verify first
`git fetch trace` · `git log --oneline -3 m1/integration` · `git status` · `git rev-parse --short trace/d1/integration` (`1547fd0`) · `git rev-parse --short trace/main` (`da5380d`) · `git branch -a -v --list '*a2a*'` · `gh run list --repo TraceHiring/TraceHiring --branch m1/integration --limit 3` · `pnpm -s verify:fast` · `docker ps` (supabase_db_trace up)
