# HANDOFF — 2026-10-11 13:55 IST
Reason for stopping (updated after a late redactor review and merge): usage (founder rule: work each 5-hour window to ~95%, finish wrap-up by 95–96%). Parallel agents took the window from 4% to 72% in ~30 minutes, so wrap-up started early at ~75%. The next session may run on a different Claude account: start from `docs/progress/RESUME-PROMPT.md` on `m0a/integration`.

## Where we are
- Milestone **M0a**, phase **BUILD**, step **S1.7** (shared code + database). All S1.7 code is written and every planned fix pass is done; what remains is **two reviews, one Low-fix writer, the merge of the assembly branch, and the gate**.
- **`m0a/integration` @ `this handoff (last code/spec commit `e383a89`)`** holds only reviewed work: W1 redactor + its Medium fixes (`913353c`), W2 harness (`18ae1ff`), W2-1 lock fix (`0ac043f`), S1.4 N9+N8 (`008515d`), founder answers (`a8c7387`), review records, the S2/S3 plan (`34201ed`) and **spec revision 12** (`e383a89`).
- **`m0a/s17-assembly` @ ``79c2903``** = integration + the catalog fix branch + the S1.7 root wiring (`79c2903`). It is **not** merged into integration yet because the catalog fixes still need a fresh database review. On it: `pnpm test:rls --stop` from a **cold** stack passed (W2-2 done): 2 files, `catalog_*` 101 assertions (floor 101), `rls_*` 0, db-types current. Full `pnpm verify`: **exit 0** at 13:50 IST (typecheck; lint incl. `gen-catalog-tests --check` and full-history gitleaks; tests: scripts 681, shared 325, config 324, others green; test:rls 101/101; build: candidate 67.9 kB gzip of 150 kB, headers OK, scan-dist OK). The stack was left running.
- `milestone/m0a` has **not moved** (`adbbb61`). Last tag `cp/m0a-01`. `main` unchanged (`fe77a87`; the main mirror is skipped because `main` is checked out in the root folder).
- Founder answers this session (recorded in `docs/build-notes.md` §0): rule-1 catalog check allows side by side (MT-5d `outside_host_both`); pushes borrow the `gh` login per command; work each window to ~95%.

## Branches (all local; pushed at this wrap-up unless marked)
| Branch @ tip | What | State |
| --- | --- | --- |
| `m0a/integration` @ `this handoff (last code/spec commit `e383a89`)` | lead integration (reviewed work only) | verify:fast exit 0 after the W1/W2 merges; scripts suites green |
| `m0a/s17-assembly` @ ``79c2903`` | integration + catalog fixes + root wiring (`package.json` `test:rls`, `db:types`, `gen-catalog-tests --check` in lint, `test:rls` in verify; `scripts/test/root-scripts.test.mjs`; `catalog_meta.test.sql` 96 assertions; `catalog-min-count` 101; CI `rls` runs `pnpm test:rls --stop`) | real test:rls green from cold; merge into integration after the database review passes |
| `m0a/catalog-fixes` @ `43d5a30` | `9bac676` (W3a `37adfd9` + W3b `0f62de8`) + pass A `735b609` (first DB review items 1–7) + pass B `897062d` (W3b review #1–#8, founder #5) | runner all green (16 clean, 80 branches fire); **needs a fresh database-reviewer** |
| `m0a/w1-lows` @ `aa99476` (from `76dc548`) | redactor Lows #3, #4, #6, #8 + spec-review findings M1, L2–L6 (shared 325 → 465) | security review **PASS WITH FINDINGS** (F1–F8 Low, `docs/reviews/M0a-S1.7-redactor-lows-security-review.md`); **merged** into integration (`5e80925`, verify:fast exit 0) |
| `m0a/s14-lows` @ `64bd4e3` | N9 + N8 | merged; security re-review PASS WITH FINDINGS (N10–N13 Low) |
| `m0a/w2-fixes` @ `983250b` | W2-1 | merged |
| `m0a/w1-fixes` @ `76dc548` | W1 Mediums | merged |
| writer branches `worktree-agent-{ad19ce26340d917df,a59ecb96849c925c8,ae1f22931a688e4bb,a75a7734641c290c8}` | contained in the branches above | do not use; `worktree-agent-a03904b476099aa9d` (writer E, stopped before any commit) is empty |

## Next step (in order; max 3–4 agents; a review agent costs ~8–10% of a Pro window — check usage often)
1. **Two read-only reviews in parallel:**
   - `database-reviewer` on `git diff 9bac676 43d5a30` (`supabase/catalog-checks/**`, `supabase/tests/catalog_probe.test.sql`) against spec rev 12 §8.5 and both earlier reports. Ask it to check: A's literal `supabase_owner` list (MT-7/MT-9) vs B's SET-ROLE-based escape scope (MT-5a/b, 10, 11) — reconcile if they disagree; A's open gap (a hand-made object `ALTER EXTENSION … ADD`-ed to a `postgres`-owned trusted extension in a system schema is skipped); B's follow-ups (matviews/non-invoker views granted to a worker role are not MT-5c bridges; operators/casts/domains inside plpgsql bodies, dynamic SQL and trigger side effects are not followed; `catalog_probe.test.sql` holds a verbatim copy of `MT-11.sql` between markers, kept identical by hand).
   - (Done this session: the redactor security review, PASS WITH FINDINGS; branch merged.)
   Record each report in `docs/reviews/`. Fix every finding test-first on its branch (catalog → `m0a/catalog-fixes`, then re-merge into `m0a/s17-assembly`; redactor → `m0a/w1-lows`).
2. **Two Low-fix writers in parallel** (owned files disjoint): (a) redactor F1–F8 from `docs/reviews/M0a-S1.7-redactor-lows-security-review.md`, branch from `m0a/integration`, `packages/shared/src/log/**` only, test-first, one commit each, with ~100 KB timing guards for every regex change; (b) **N10–N13** (Low, owed before S3): branch from `64bd4e3`; owned files `scripts/check-workflows.mjs`, `scripts/scan-dist.mjs` and their tests only; the findings, repros and fixes are in `docs/reviews/M0a-S1.4-n8-n9-security-review.md`. Done checks: scripts suite, `check-workflows` OK on the real ci.yml, lint, verify:fast, and `pnpm build` (proves the N13 binary allow-list has no false positive). Then a short security re-review.
3. **Integration:** merge the F1–F8 branch; merge `m0a/s17-assembly` (after step 1 passes); merge the N10–N13 branch; full `pnpm verify` green.
4. **Gate:** `spec-reviewer` on the whole S1.7 diff (`adbbb61..m0a/integration`); then in the `milestone/m0a` worktree (`.claude/worktrees/milestone-m0-spec-e4db77`) `git merge --ff-only m0a/integration`; tag `cp/m0a-02` (S1.4–S1.6) and `cp/m0a-03` (S1.7).
5. **S2 ∥ S3:** follow `docs/progress/S2-S3-PLAN.md` (lead changes P1–P4 first, then 3 writers W-S2, W-S3a, W-S3b). Do not start M0b.

## Decisions made this session
- Writers work only on owned files; the lead merged every stream with `--no-ff` and kept unreviewed work off `m0a/integration` (hence `m0a/s17-assembly`).
- MT branch names and semantics: spec rev 12 §8.5 (header lists counts per ID). Fixture exception: MT-8b `system_schema_owner` runs `create schema cron` without the `mt_` prefix; MT-9 `extension_in_scope` uses `seg`.
- CI `rls` job runs `pnpm test:rls --stop` (pnpm forwards `--stop` to `scripts/test-rls.mjs`).
- Writer E (N10–N13) was stopped before any commit to protect the wrap-up budget.

## Open questions for the founder (unchanged; `docs/progress/FOUNDER-QUEUE.md`)
- **URGENT:** revoke the Cloudflare token pasted as a secret *name*; set `CLOUDFLARE_API_TOKEN` and `SUPABASE_STAGING_DB_URL`. Blocks only the S3 deploy run.
- `workers.dev` subdomain (H4); what "D1" means; branch protection vs the session-end push. None blocks S1.7.

## Gotchas / do not touch
- Usage: parallel Opus agents are expensive (A+B+C+D+3 reviewers ≈ 70% of a Pro window). Check `get_usage` after every agent result.
- Writer worktrees start at `main`: every writer prompt says "confirm no commits of its own, then `git reset --hard <SHA>`".
- Only the lead runs `supabase start/stop`, `db reset`, `test db`, `gen types`, `pnpm verify`, `pnpm test:rls`; writers use rolled-back psql only. The catalog dev runner is `docs/progress/tools/catalog-run.mjs` (copy it to a scratch dir; on `m0a/s17-assembly` the `.pending` root-scripts test has moved to `scripts/test/`).
- pgTAP counters are rolled back by `rollback to savepoint`: count TAP lines only.
- commitlint: lowercase subject, header and body lines ≤ 100 chars; `chore:` for merges (no `merge:` type). Pre-commit gitleaks rejects secret-shaped literals.
- Push: `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push trace <refs>` (founder, 2026-10-11). Never force.
- Windows: never pipe docker/supabase output into `head`; awk `-v` with Windows paths breaks.

## Verify first
`git fetch trace` · `git log --oneline -3 m0a/integration m0a/s17-assembly` · `git status` · `docker ps` (`supabase_db_trace`; start it per RESUME-PROMPT STEP 3 if down) · `pnpm -s verify:fast`
