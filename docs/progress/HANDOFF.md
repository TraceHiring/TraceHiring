# HANDOFF — 2026-10-13 20:25 IST
Reason for stopping: phase done. **M0b FIX is complete** and AUTOPILOT §2 allows one phase per session. Usage at stop: about 80% of the 5-hour window (Pro plan, resets about 23:20 IST); weekly about 66%.
The next session may be a new Claude Code on another account. Start from `docs/progress/RESUME-PROMPT.md` on **`m0b/integration`** (its §4 paste prompt).

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M8 = closed beta → M9 … M13)
- Milestones closed: **0 of 17** (no `m*-reviewed` tag). Rough share of the whole build done: about 10%.
- **M0a:** REVIEW and FIX are done; it stopped before CLOSE (founder gate). `milestone/m0a` @ `7dc8c0d` = `cp/m0a-06`.
- **M0b:** BUILD, REVIEW and **FIX are done**. The code verdict is **PASS WITH CONDITIONS with no open Medium** (`docs/reviews/M0b.md`, sections "FIX" and "Re-review of the FIX"). The milestone stays INCOMPLETE until CLOSE, because the staging run (AT-B9, AT-B10) and `m0a-reviewed` are founder gates.

## Where we are
- **`m0b/integration`** (worktree `.claude/worktrees/m0b-integration`; enter it with `EnterWorktree` path). Its tip is this handoff commit, on top of `01b177c` docs(reviews): record the m0b fix re-review and gates.
- **`milestone/m0b` @ `01b177c` = `cp/m0b-04`**: fast-forwarded this session from `4cb6775` (`cp/m0b-02`). **Stray tag:** `cp/m0b-03` also points at `4cb6775` (= `cp/m0b-02`). A failed fetch refspec in a chained command created it. It is local only: it is deliberately not pushed, and the wrap-up pushed tags by name. The tag rules forbid deleting it, so the founder may delete it locally (`git tag -d cp/m0b-03`), or leave it. The FIX checkpoint is `cp/m0b-04`.
- Draft PR **TraceHiring/TraceHiring#3** (`m0b/integration` → `main`) is for CI only and is never merged.
- Stream branches are all merged and kept: `m0b/b0-db` `dc4731a`, `m0b/b2-recruiter-auth` `91092ac`, `m0b/b2-fixes` `8f47fff`, `m0b/b4-smoke-auth` `04013ea`, plus the older `b0-rls-tests`, `b3-token-spike`, `b4-ops-scripts` and `b5-*`. This session created no stream branches.
- Unchanged: `milestone/m0a` @ `7dc8c0d`, `m0a/integration` @ `c619525`, `main` @ `fe77a87`.
- The local stack runs db, auth, kong, rest and mailpit (left up by `pnpm test:rls`).

## Done this session (verified)
- Resume check: the repo matched the handoff (`b3f8809` = remote; `milestone/m0b` = `cp/m0b-02` = `4cb6775`). `verify:fast` exit 0 (212 s).
- FIX, one commit per finding, tests first:
  - `1cc45e0` M0B-DB-2 (Medium): MT-11 now uses a caller-helper allow-list, plus the new branches `or_arm_without_caller` and `caller_only_null_tested`. 3 fixtures were seen failing; 2 negative controls added.
  - `8c36e48` M0B-SP-1: the spike requires `42501`; re-run 27/0/0.
  - `66c8459` B0-SP3: 2 audit cases and a spec §2.5 sentence.
  - `c4db45c` B0-DB7: migration `20261013133323_m0b_staff_grant_checks.sql`; 3 staff cases seen failing.
  - `545e1c2` B0-SP7: 6 cheap matrix cases.
  - `ccb584a` M0B-DB-5: `scripts/test-concurrency-local.mjs` (two psql sessions, run by `test:rls`) **proved** that both owner demotions committed under REPEATABLE READ. Migration `20261013133832_m0b_owner_change_isolation.sql` adds `memberships_isolation_guard`.
  - `0080700`: record and spec revision 8.
- Re-review: one fresh Sonnet database-reviewer returned PASS WITH FINDINGS (3 Lows). FR-2 and FR-3 were fixed in `45bb351` (`is_operator` added to the allow-list; comment). FR-1 goes to **M1**. Recorded in `01b177c`.
- Gates on `45bb351`, no agent running: full `pnpm verify` exit 0 (scripts 1559 + 1 skipped K4; catalog **138**, rls **697**; AT-B8 and the concurrency test OK). The first run failed the known redactor 50 ms timing at 50.2 ms; the re-run was green. Linux CI was green on `ccb584a` (38407442501) and on `01b177c` (38415375246).
- Not fixed, with owners: **M0B-DB-1 → M7** (DR runbook) and **B0-SP7 rest → M1**. All other Lows keep the owners in `docs/reviews/M0b.md`.

## Next step (in order)
1. **M0b cannot CLOSE until the founder gates are met:** `m0a-reviewed` (M0a CLOSE needs the GitHub plan, FOUNDER-QUEUE row 15) and the staging run of AT-B9 and AT-B10 (rows 20–21: H3–H5, H8–H11). Do not merge into `main` and do not tag `m*-reviewed` without the founder.
2. **No unblocked autopilot phase is left without a founder answer.** D1 starts "right after `m0b-reviewed`, before M1" (`docs/build-order.md:36-38`, founder 2026-10-11), and Sentry (H6) must land before D1. The next session should ask the founder once (FOUNDER-QUEUE row added this session): may D1 SPEC start before `m0b-reviewed`, as M0b did before `m0a-reviewed`? If the answer is yes, run D1 SPEC in a fresh session on a new `d1/integration` cut from `milestone/m0b` (`cp/m0b-04`). If not, work the founder rows for CLOSE.
3. Carry FR-1 (MT-11 caller calls that bind no row) into the M1 spec, before M1 adds tables.

## Decisions made this session (HOW-level, AUTOPILOT §4)
- `private.valid_roles` was left off the MT-11 allow-list, because it is immutable and caller-independent. `private.caller_roles` was added, and `private.is_operator` was added after the re-review.
- M0B-DB-5 was fixed by refusing owner or status changes outside READ COMMITTED (`0A000`, a separate trigger, fix-forward migration). No current path uses another isolation level; the reviewer verified the role and database defaults.
- M0B-DB-1 goes to M7 rather than M0b FIX (the review allows either); B0-SP7 rest goes to M1.
- Fix-forward migrations, not edits to the reviewed ones.

## Open questions for the founder (`docs/progress/FOUNDER-QUEUE.md`)
- **New:** may D1 SPEC start before `m0b-reviewed`? Options (a) start D1 SPEC now, (b) wait and work the CLOSE rows, (c) start M1 SPEC.
- Unchanged: the GitHub plan (row 15, blocks M0a CLOSE); H8–H11 (row 20) and the H8 reminder (row 21); the URGENT Cloudflare token roll, `CLOUDFLARE_API_TOKEN`, `SUPABASE_STAGING_DB_URL`, H4, H5, H6 Sentry; B2-SEC-5 FYI (row 22); the session time-box FYI.

## Gotchas / do not touch
- Only the lead runs `supabase start/stop`, `db reset`, `test db`, `gen types`, `pnpm verify` and `pnpm test:rls`. Run the full verify **with no agent running**. The redactor 50 ms timing test can fail at about 50.2 ms under load; re-run before suspecting code.
- Running a single pgTAP file by hand: pgTAP is absent outside `supabase test db`. Insert `create extension if not exists pgtap with schema extensions;` after the file's `begin;` (it rolls back with the file).
- In node `String.replace`, `$$` in a replacement string becomes `$`: use the Edit tool for SQL with `$$`.
- Worktree guard: no `git -C`, no `$(…)`, no heredocs containing backticks with git in the same command, and no pipes around git. commitlint body lines must be at most 100 characters.
- Push and fetch: `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push trace <refs>`.

## Verify first
- `git fetch` (with the `-c` pair) · `git log --oneline -3 m0b/integration` · `git status` · `docker ps` · `pnpm -s verify:fast` · PR #3 checks
