# HANDOFF — 2026-10-11 09:10 IST
Reason for stopping: usage (founder: work to ~90%, then wrap up and push). The wrap-up started at 76% of the 5-hour window (Pro), because each review agent costs about 7–9%. The window resets about 13:20 IST.

## Where we are
- Milestone **M0a** (toolchain, pipeline and skeleton). **Phase: BUILD.** S1.0–S1.6 are built and reviewed. **S1.7** (shared code + database): every stream is now written, but nothing is merged yet, because the reviews found issues that must be fixed first.
- **Integration branch: `claude/trace-autopilot-resume-2dac7c`** (NEW), in worktree `.claude/worktrees/trace-autopilot-resume-2dac7c`. It was reset to `97f8a4e`, the tip of the old integration branch `claude/trace-autopilot-production-87e5e2`, which still holds `97f8a4e` and is no longer used. A worktree guard blocks a session from writing into another session's worktree, hence the switch. The 3 commits the session branch held before the reset (`52a4b08`, `0157093`, `fe77a87`) are all on `main`, so nothing was lost.
- HEAD before this handoff: `d7169b0`. Since `97f8a4e`, only review reports under `docs/reviews/` were added. `pnpm verify:fast` exit 0 at 08:37 on `97f8a4e` and at 09:12 on this handoff. Full `pnpm verify` was last green on `0d8b511`. The last tag is `cp/m0a-01`. **The `main` mirror was skipped** (main is checked out in the root folder, which the worktree guard protects), so `main` still shows the old handoff: use RESUME-PROMPT.md from this branch.
- `milestone/m0a` has **not moved** (`adbbb61`); it moves only after the Next-step gate. The spec `specs/m0-foundations.md` is at revision 11 (`10addbe`).

## Done this session (verified)
- **S1.4 second security re-review: PASS** (fresh agent). N1–N4, N6 and N7 are verified fixed, and all 18 regression tests fail on 6fadb17. **N5 is partly fixed; the rest is new Low N8** (a `%PDF`-looking first chunk makes gitleaks `stdin` skip the whole stream, NUL files are dropped, archives are detected by name only). New Low **N9**: `SHELLOPTS`/`BASH_ENV` in `env:`, and `container:` on a required job, get past the N3 shell check. Both are owed before S3. Recorded in `docs/reviews/M0a-S1.4-security-rereview.md` (`98c098f`).
- **S1.7 database review of `cf8626d`, `905be8f` and W3a: BLOCK.** The baseline migration is exact and safe. The catalog checks have gaps:
  - Blocking: escape through system-list schemas (`cron` etc. can be created; `postgres` has CREATE on `_realtime`, `supabase_migrations` and `supabase_functions`) and through INHERITS children.
  - High: a `service_role`-owned SECURITY DEFINER function in `extensions`; MT-7 scans only 3 schemas.
  - Medium: foreign tables.
  - 4 Lows.
  The report and a **7-item fix plan** are in `docs/reviews/M0a-S1.7-database-review.md` (`98c098f`).
- **W1 redactor security review: PASS, with 2 Mediums** to fix before merge:
  - #1: frame-shaped message lines survive under stack keys, and the 2,000-char cap is skipped.
  - #2: a UPI ID before `.` or a dash is not redacted.
  6 Lows (#7, the 50 ms timing flake, is load noise, not ReDoS). Report: `docs/reviews/M0a-S1.7-redactor-security-review.md` (`d7169b0`).
- **W3b finished** (writer agent): MT-5b, 5c, 5d, 10, 11 and 12 plus 22 fixtures; MT-5a confirmed clean with pgTAP. The runner is all green with no cross-branch firing. Assembled with W3a and run through the real generator, the result was 67/67 ok in a rolled-back run.
- **W2 finished** (writer agent): `scripts/test-rls.mjs`, `scripts/db-types.mjs`, tests and stubs. The scripts suite went from 542 to 626, all green; `pnpm lint` and `verify:fast` exit 0 on the branch. The TAP parser counts lines itself, so pgTAP's rolled-back counters (see Gotchas) cannot fool it, and 3 tests pin that.

## Stream branches (all local, clean, unmerged; pushed to `trace` at this wrap-up)
| Stream | Branch @ tip | State |
| --- | --- | --- |
| W1 redactor | `worktree-agent-ae15fb7cd05478040` @ `bcb6d54` | Review PASS; **fix #1 and #2 (and #7) first** |
| W3a checks MT-1,2,3,4,6,7,8,9 | `worktree-agent-a66ca65381173c087` @ `37adfd9` | **Blocked by the DB review fix plan** |
| W3b checks MT-5a–d,10,11,12 | `worktree-agent-a5a761e3d78529f6f` @ `0f62de8` (contains `f8da8a4`) | Done; **DB review BLOCK** (3 High, 3 Medium spec gaps; `docs/reviews/M0a-S1.7-w3b-w2-database-review.md`) |
| W2 harness | `worktree-agent-a9809baf595fe8b13` @ `aabef91` (contains `0d35d0b`, `8c5ef5f`) | Done; **DB review PASS** (Lows W2-1, W2-2) — ready to merge |
| superseded | `worktree-agent-a9e0bdcc6c2fbd966` @ `8c5ef5f`, `worktree-agent-a4f4047327f9e48e5` @ `f8da8a4` | Contained in the two branches above; do not use |

W3b/W2 database review: arrived after the first push and is recorded in `docs/reviews/M0a-S1.7-w3b-w2-database-review.md`. Fold its W3b findings (#1–#8; #5 needs a spec decision first) into the step-2 catalog fix pass and spec rev 12.

## Next step (in order; 2–3 writers max; a review agent costs ~8% of a Pro window)
1. **W1 fixes**, test-first, one commit each, continuing from `bcb6d54`: #1 (tighten the frame regex in `isStackFrame`/`stackFrames`; restore truncation over the cap), #2 (UPI lookahead `(?![\w@]|\.[a-z0-9])`), #7 (min-of-N timing). The exact repros and tests are in the redactor review report.
2. **Catalog-check fix pass** on one branch cut from W3a `37adfd9` with W3b `0f62de8` merged in (the shared scope CTE fix touches both). Follow the 7-item plan in the DB review, test-first: a fixture per new branch, then the check. Then update `manifest.json`, `supabase/tests/catalog-min-count` (exact new count) and spec §8.5 as **revision 12**. Then run a fresh `database-reviewer` (fixes + W3b) and `spec-reviewer` on rev 12.
3. (Folded into step 2: the W3b findings. W2 passed; its Lows W2-1 and W2-2 are done at integration: run `supabase stop` then `pnpm test:rls --stop` once.)
4. **Lead integration** on the integration branch, each with `git merge --no-ff`:
   - merge W1 (fixed), the catalog branch (fixed) and W2 `aabef91`;
   - `node scripts/gen-catalog-tests.mjs`, which writes `supabase/tests/catalog_meta.test.sql`;
   - wire the root `package.json`: `test:rls`, `db:types`, `gen-catalog-tests --check` in `lint`, `pnpm test:rls` in `verify` (the exact strings are in `docs/progress/tools/root-scripts.test.mjs.pending`);
   - move that test to `scripts/test/root-scripts.test.mjs`;
   - CI `rls` job: `node scripts/test-rls.mjs --stop`;
   - run a real `pnpm test:rls`, confirming W2's `-x` exclude list (it excludes `kong` and `postgrest`) and that TAP comes on stdout;
   - full `pnpm verify`.
5. **Gate:** `spec-reviewer` on the whole S1.7 diff. Then in the `milestone/m0a` worktree run `git merge --ff-only <integration tip>`, and tag `cp/m0a-02` (S1.4–S1.6) and `cp/m0a-03` (S1.7).
6. S1.4 Lows N8 and N9 (before S3). Then **S2 ∥ S3** (spec §14).

## Decisions made this session
- **Integration branch** is now `claude/trace-autopilot-resume-2dac7c` (see above).
- **Put off the catalog fixes and the redactor fixes** to the next window instead of starting a third writer at 53–69% usage (AUTOPILOT §2: finish cleanly over half-finishing).
- **New catalog branches** (planned, pending spec rev 12): MT-1 `inheritance_without_rls` and `foreign_table_in_scope`; MT-8b `system_schema_owner`; MT-9 `handmade_in_system_schema` and `handmade_nonadmin_owner`; MT-7 `definer_in_system_schema`; MT-3 `composite_type_column`; MT-6 `composite_column` and `range_column`; MT-4 `column_references`.
- **Stream decisions** (W3b/W2 reports, to record in spec rev 12):
  - MT-5c does not expand members of `postgres` and reads an empty ACL as PUBLIC EXECUTE.
  - MT-11 detects auth calls via `pg_depend`.
  - MT-10 raises an error if a listed role is missing.
  - test-rls adds `--local`, uses a JSON lock with a token, and polls every 2 s.
  - db-types takes the lock and runs `db reset` before `gen types`.

## Open questions for the founder (unchanged; docs/progress/FOUNDER-QUEUE.md)
- **URGENT, from before:** revoke the Cloudflare token that was pasted as a secret *name*, and set `CLOUDFLARE_API_TOKEN` and `SUPABASE_STAGING_DB_URL`. Blocking: any Cloudflare deploy (S3 runs only).
- The `workers.dev` subdomain (H4); what "D1" means; branch protection vs the session-end push. None of these blocks S1.7.

## Gotchas / do not touch
- **Writer worktrees** (`isolation: worktree`) start at `main`: tell every writer to confirm it has no commits of its own, then `git reset --hard <exact SHA>`.
- **The worktree guard** blocks writing into another session's worktree. Work in your own worktree on the integration branch (see RESUME-PROMPT.md).
- **pgTAP counters live in a temp table**, so `rollback to savepoint` undoes them: `finish()` misreports, and `num_failed()` misses fires-failures. Only count TAP lines (pg_prove and test-rls do).
- **Usage:** 5 agents took ~50% of a Pro 5-hour window in 15 minutes; one review agent costs ~7–9%.
- **Shared local stack:** only the lead runs `supabase start`/`db reset`/`test db`/`gen types`. Writers use rolled-back psql only.
- **Windows:** never pipe `docker`/`supabase` output into `head`. commitlint rejects a capitalised subject. Pre-commit gitleaks blocks secret-shaped literals.
- Never re-enable `.git/hooks/post-commit.disabled`; never move `cp/*` tags.

## Verify first
git log --oneline -5 claude/trace-autopilot-resume-2dac7c · git status · `git log -1 --format=%h` on each stream branch above · docker ps (supabase_db_trace) · pnpm -s verify:fast
