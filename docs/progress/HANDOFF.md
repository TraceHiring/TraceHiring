# HANDOFF — 2026-10-23 18:00 IST (M1 BUILD 3 = Wave 2: A4, A3a, A3b merged; lead migrations M1-f, M1-g; A2b in flight; A2a not started)
Reason for stopping: usage guard (Max account; weekly limit at 90%+ → no new agents; the founder asked to stop at 95% of the 5-hour window). Start from `docs/progress/RESUME-PROMPT.md` §4 on **`m1/integration`** (worktree `.claude/worktrees/m1-integration`). The repo wins over this file.

## Paused: D1 (founder, 2026-10-22 night: paused, not closed)
D1's remaining steps belong to a D1 chat on `d1/integration` (worktree `.claude/worktrees/d1-integration`). Nothing is committed to `d1/integration` or `main` from M1. Copied from the `d1/integration` HANDOFF (`3c2e42a`, tip `1547fd0`):
- **Next step 1.** Workers Paid answered (2026-10-22 21:20): "not yet"; OPEN-8a stays a founder gate and D1 can close without it. Remaining founder item: **AT-D2 capture**. For it: dispatch staging from `d1/integration` with `run_e2e=true` on the final tip (re-checks AT-D1/AT-D17 after `1d36151`), then the founder runs `pnpm e2e:record` (spec 4p §7.3) with an OS-level screen capture; record file name, SHA-256, `recordedMs`, run id.
- **Next step 2.** Then `docs/milestones/D1-summary.md`, tag the next free `cp/d1-*` number (after `cp/d1-11`, `cp/d1-10`) on the verified tip, and **D1 CLOSE by PR to `main`** only with the founder's go-ahead (AUTOPILOT §2, §6). At the merge the founder adds `e2e-local` back to ruleset 25633431's required checks.
- **Staging re-run already done on the final tip (reuse it):** dispatch **39820502191** on `1547fd0` (run_e2e=true, started before the pause, not touched by M1): all 7 jobs **success** (static, migrations, rls, security, e2e-local, deploy-staging, e2e-staging). Artifact `e2e-staging-results` manifest: spec `d1-slice`, project `staging`, sha `1547fd0…`, 55/55 steps ok, `durationMs` 304726, `recordedMs` 295068 (`record: false`), **AT-D17 `time_to_ready_ms`: A 46307, B 30833, C 69999, D 19441** (max 70.0 s: inside the 90 s gate; the 30 s target is still the M5-owned deviation). If `d1/integration` is still `1547fd0`, this is the "staging re-run on the final tip"; only the AT-D2 capture (record mode) remains.
- **D1 founder items:** AT-D2 screen capture (`pnpm e2e:record`); Workers Paid (OPEN-8a) "not yet", decide before any load test (M3a); Dependabot PRs #7-#12 not merged blind; after D1 merges, `e2e-local` back on the required checks.

## Where we are (verified this chat)
- Milestone **M1 · Test authoring**, phase **BUILD 3 = Wave 2**. Spec `specs/m1-test-authoring.md` rev 5, rows up to **R5-61**. Reviews: `docs/reviews/M1-wave2-first-reviews.md`.
- `m1/integration` code tip **`9042121`** (+ this handoff). `trace/d1/integration` = `1547fd0`, `trace/main` = `da5380d`: unchanged.
- **Linux CI green** on `933cb02` (A4 merge, run 39948813746) and `5b6d36b` (M1-g, run 39950848684); run 39953115454 on `b6cc5d1` (A3 merges) was in progress at writing — check it.
- `verify:fast` last green on `6775e7b` (start of chat). Local tests per merge: edge start/limits/mirror/log-hygiene/clock, jobs typecheck+lint+index/queue 146+build, pgTAP files touched by M1-f/M1-g. **Full serial `pnpm verify` and `pnpm test:rls` have NOT run this chat** (writers were running; test:rls resets the DB). The `rls-min-count` floor (3665) was not raised.

## Done this chat (commits on m1/integration)
- **R5-58** (`69c7e9e` red → `5a9b6c9`, `c466451`, `6775e7b`): `TestPackageV2.items[].skillKey/difficultyBand` optional, both or neither; required for items of a stratified draw (settles R5-57 e).
- **R5-59/R5-60** spec rows (`893657a`) from the first reviews of A4 and M1-e; FOUNDER-QUEUE row "coverage when tab focus is off".
- **Migration M1-f** `20261023060000_m1_digest_fixes.sql` (`a87b611` red → `09e4ed8`): digest = `section:item` lines only (new shared vector `82eef2b9…`; exposure out, a live test can be republished), `library_browse` half cursor returns no row, `ai_draft_jobs.difficulty` unconstrained numeric + two-decimal CHECK, pgTAP gaps.
- **A4 merged** `a246771` (`m1/a4-fix-1` @ `a0c1d46`: R5-59 — answers only to served positions v1+v2, captureSignals drop, not-entered GET 409, seed comment; lead patch start.test) + `933cb02` (four hollow D1 edge tests now serve before answering; 11 red first).
- **Migration M1-g** `20261023070000_m1_members_drafts_fixes.sql` (`8600b10` red → `5b6d36b`): `private.auth_user_id_for_invite` (E26), trigger `ai_draft_jobs_outcome`, `drafts_discarded` uncapped; spec **R5-61**; FOUNDER-QUEUE row "D1 integrity job re-delivered after M1".
- **A3a merged** `29a063c` (`m1/a3a-fix-1` @ `402a3ac`; jobs v2 mirror/quality/integrity; layout check at quality start; `m1-scoring-v1`; new `db-test/stages-v2.db.test.ts` 10/10).
- **A3b merged** `b6cc5d1` (`m1/a3b-fix-1` @ `1866c92`; drafting + members; E26 lookup-first; lead mount in `workers/jobs/src/index.ts`).
- `9042121`: invite email HMAC moved to `@trace/shared/invite-email` (jobs re-export it).

## In flight at handoff (check first, trust nothing)
1. **Writer A2b (Opus) — RUNNING at writing**, branch **`m1/a2b-api-tests`** (local branch in its own agent worktree, base `09e4ed8`; last seen `11c59ac` "test(api): m1 templates and jd blueprint red"). Owns `services/api/src/modules/{tests,candidate,templates,integrity-settings,members}/**`. Its brief: foundation first (`modules/tests/{org-context,http,rest*}`: rpc, guard-message mapping, keyset filters with exact `created_at` strings, per-route body caps, `__proto__` refusal), publish v2 (R5-56 a/d, R5-57 a, R5-58, R5-60 a/e: digest of `{sectionId,itemVersionId}`, retry only on 40001 + `TRACE_GUARD: the package was built from another snapshot`, ≤ 3, then `conflict`), TestDraftView (R5-53), templates, integrity-settings (admin lock value), members (email HMAC = `@trace/shared/invite-email` definition: trim + lower-case, HMAC-SHA-256 with the pepper's UTF-8, hex). **Next:** if its report is not recorded here, read `git log` of `m1/a2b-api-tests` (local, and `trace` if pushed); then Opus first reviews (spec, security, database), fixes test first, confirming re-review, merge with the lead mounts (`app.ts`, route inventory, log hygiene, `index.ts`) and switch members to `@trace/shared/invite-email`.

## Stream branches
Merged (do not delete): `m1/a1-packages` · `m1/a5a-fix-1` · `m1/a5b-fix-1` · `m1/a5c-fix-1` · `m1/a4-edge-delivery` `7f2fb9c` · `m1/a4-fix-1` `a0c1d46` · `m1/a3a-jobs-v2` `74d9891` · `m1/a3a-fix-1` `402a3ac` · `m1/a3b-jobs-authoring` `2b706d0` · `m1/a3b-fix-1` `1866c92` (all on `trace`). Unmerged by founder answer (b): `m1/a5a-fix-2/-3/-4` (zip reader, deferred to M8). Open: `m1/a2b-api-tests`.

## Next step (one precise action list)
1. Verify first (below). Record A2b's state (In flight 1).
2. **A2b**: Opus first reviews (spec, security, database; one diff `09e4ed8..<A2b tip>`), fix round test first, confirming re-review, merge + lead mounts.
3. **A2a** writer (Opus; reset to the tip that holds A2b's foundation — A2b's merge, or A2b's foundation commit): `services/api/src/modules/{bank,pools,library,imports,ai-drafts}/**`; library browse via the 10-arg `library_browse` + `PageCursor` (R5-57 b; keep `created_at` exact), `LibraryLimiter` (R5-56 g), ai-drafts writes `topic_sha256` = SHA-256 hex of UTF-8 `scrubDraftTopic(topic)` (R5-61 d) and enqueues `AuthoringQueueMessage`; carried A2 notes below. Then its reviews and merge.
4. **Full serial `pnpm verify`** (incl. `pnpm test:rls`; raise `supabase/tests/rls-min-count` to the new count) and Linux CI on PR #14 — owed for every Wave 2 merge of this chat.
5. **Carried, owed before the M1 exit** (record in the spec as R5-62 when done): (a) the A3a layout check moves to the mirror stage with a column-level `trace_worker` SELECT on `sections (id, test_version_id, position, draw_count)` and `item_versions (id, section_id, test_version_id)` + pgTAP, closing a two-body re-delivery (A3a confirming re-review Low); (b) A3b: re-check the inviter (still admin) before the Auth call, and a db-test for the "more than one account" branch; (c) R5-61 h deferred items (indexed duplicate hash, jobs `SUPABASE_URL` with the M1 staging half — the deploy checks refuse extra jobs vars today, a drafting lease).
6. Then BUILD 4 = Wave 3 (A7, E2E, measurement) per spec §11.4. DC-M1-2 (built recruiter app under the real CSP) still to run.

## Notes for Wave 2 (carried; not defects now)
- A2: per-route body caps; body reader refuses `__proto__`; ApproveItemRequest body id = path id; route inventory gains the two DELETE paths and R5-55 a routes; parse the built package with TestPackageV2; option `text` ↔ package `label`; content hash per R5-49 a; RESERVED_NAMES vs ParamName (`reserved_name`); IntegritySettingsView carries an admin lock's value (E16); v2 written section paste_rule = settings.paste_written (DB-M1-1); A5c N1 (`fromDraftView(view, integrity)` + `onSaved` → `setPasteWritten` → re-save, recruiter app, lead); A5a S7 (image PUT refusal codes; else `image_refused`).
- A7 (Wave 3): sends `afterSeq` on every v2 GET (R5-59 d); copy warns that finishing an untimed section is final (R5-59 e).
- R2-5 gap: re-copying a retired library copy hands back the retired copy. DC-M1-4 — OPEN-8a founder gate.

## Founder items
- New this chat (defaults in use, not blocking): **coverage when tab focus is off** (default a: keep D1); **D1 integrity job re-delivered after M1** (default a: DLQ, never overwrite; the spec reviewer reads R5-52 f as wanting an ack of a provably identical stored result).
- Unchanged: M1-15 "shared-device" copy (default: leave out); import cancel keeps rows (default a); M1 staging Hyperdrive configs + secrets (+ jobs `SUPABASE_URL`); Q-M1-1…Q-M1-4; OPEN-8a Workers Paid; written AI drafts; zip reader answered (b).

## Gotchas
- Worktree guard: no `cd …&&`, `git -C`, `$(...)`, loops or compound git commands; commit messages via `git commit -F <unique file>`; merges `chore: merge …`. A refused compound command runs NOTHING (check `git log`).
- `node scripts/db-types.mjs` and `pnpm test:rls` RESET the local database: never while a writer runs db-tests. `pnpm exec supabase migration up --local` applies a new migration without a reset.
- RAM: never run workspace tests while writers run; writers run only their own package tests.
- Never hand-edit generated `rls_m1_*.test.sql`: edit `docs/progress/m1-wave0-drafts/pgtap/bodies/*.sql`/`preamble.sql`, run `node docs/progress/m1-wave0-drafts/pgtap/gen.mjs .`, run named files with `node docs/progress/m1-wave0-drafts/pgtap/run.mjs <names>`.

## Verify first
`git fetch trace` · `git log --oneline -3 m1/integration` (tip = this handoff on `9042121`) · `git status` · `git rev-parse --short trace/d1/integration` (`1547fd0`) · `git rev-parse --short trace/main` (`da5380d`) · `git branch -a -v --list '*a2b*'` · `gh run list --repo TraceHiring/TraceHiring --branch m1/integration --limit 3` · `pnpm -s verify:fast` · `docker ps` (supabase_db_trace up)
