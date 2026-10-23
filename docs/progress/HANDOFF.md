# HANDOFF — 2026-10-23 07:45 IST (M1 BUILD 1 = Wave 0 part 2 done on `m1/integration`; next: Wave 0 part 3)
Reason for stopping: context at 60% (chat rule). Wave 0 split again at the migration boundary (spec §11.4): M1-c and M1-d move to part 3. Start from `docs/progress/RESUME-PROMPT.md` on **`m1/integration`** (worktree `.claude/worktrees/m1-integration`). The repo wins over this file.

## Paused: D1 (founder, 2026-10-22 night: paused, not closed)
D1's remaining steps belong to a D1 chat on `d1/integration` (worktree `.claude/worktrees/d1-integration`). Nothing is committed to `d1/integration` or `main` from M1. Copied from the `d1/integration` HANDOFF (`3c2e42a`, tip `1547fd0`):
- **Next step 1.** Workers Paid answered (2026-10-22 21:20): "not yet"; OPEN-8a stays a founder gate and D1 can close without it. Remaining founder item: **AT-D2 capture**. For it: dispatch staging from `d1/integration` with `run_e2e=true` on the final tip (re-checks AT-D1/AT-D17 after `1d36151`), then the founder runs `pnpm e2e:record` (spec 4p §7.3) with an OS-level screen capture; record file name, SHA-256, `recordedMs`, run id.
- **Next step 2.** Then `docs/milestones/D1-summary.md`, tag the next free `cp/d1-*` number (after `cp/d1-11`, `cp/d1-10`) on the verified tip, and **D1 CLOSE by PR to `main`** only with the founder's go-ahead (AUTOPILOT §2, §6). At the merge the founder adds `e2e-local` back to ruleset 25633431's required checks.
- **Staging re-run already done on the final tip (reuse it):** dispatch **39820502191** on `1547fd0` (run_e2e=true, started before the pause, not touched by M1): all 7 jobs **success** (static, migrations, rls, security, e2e-local, deploy-staging, e2e-staging). Artifact `e2e-staging-results` manifest: spec `d1-slice`, project `staging`, sha `1547fd0…`, 55/55 steps ok, `durationMs` 304726, `recordedMs` 295068 (`record: false`), **AT-D17 `time_to_ready_ms`: A 46307, B 30833, C 69999, D 19441** (max 70.0 s: inside the 90 s gate; the 30 s target is still the M5-owned deviation). If `d1/integration` is still `1547fd0`, this is the "staging re-run on the final tip"; only the AT-D2 capture (record mode) remains.
- **D1 founder items:** AT-D2 screen capture (`pnpm e2e:record`); Workers Paid (OPEN-8a) "not yet", decide before any load test (M3a); Dependabot PRs #7-#12 not merged blind; after D1 merges, `e2e-local` back on the required checks.

## Where we are (verified this chat)
- Milestone **M1 · Test authoring**, phase **BUILD 1 = Wave 0, part 2 of 3 done**. Founder (chat, 2026-10-23): "work in multi agent … time and quality … production ready … if it won't break anything": writers ran in parallel on disjoint files; the lead kept every migration, `supabase test db`, db reset and verify (build-notes "Autopilot changes", second 2026-10-23 row).
- `m1/integration` HEAD = this handoff commit; code tip `018d856`. `d1/integration` = `1547fd0`, `trace/main` = `da5380d`: unchanged.
- `pnpm test:rls` green on `36d7375`'s tree from a fresh reset: rls_* **3262** (floor 2870 → 3262), catalog_* **150** (floor 144 → 150), db-types current. Full `pnpm verify` on `018d856`: typecheck + lint green; `pnpm test` OOM'd in parallel (memory allocation failed), re-run serially `pnpm -r --workspace-concurrency=1 test` exit 0 plus `vitest run --root scripts` 2819 passed / 2 skipped; `pnpm build` exit 0 (check-headers, scan-dist OK); test:rls as above.
- Pushed `76ba806` mid-chat (draft PR TraceHiring/TraceHiring#14 CI); the wrap-up push sends the rest. No staging dispatch.

## Done this chat (each branch: Opus first reviews, fixes test first, a confirming re-review, then `--no-ff`)
- `9cb9ca5` pgTAP red first for M1-b (`rls_m1_snapshot/publish_v2/serving/settings/templates_jobs/carried/candidate_denied`); `76ba806` **migration M1-b** `supabase/migrations/20261023020000_m1_tests.sql` (provisional ts) + rls_roles R5-32 adds + db-types.
- `36d7375` merge `m1/w0-dbfix`: Opus security **BLOCK** (SEC-M1-1 library `param_spec.correctOptionId` key leak; SEC-M1-2..5) and Opus database **APPROVE WITH FIXES** (DB-M1-1 a written section's `paste_rule` must equal settings `paste_written`; snapshot insert while draft; draw cap; truncate; catalog seal; indexes; strata) all fixed in place in M1-a/M1-b; Opus re-review CONFIRMED WITH NOTES.
- `cae300c` merge `m1/w0-contracts`: `contracts-m1.ts`, candidate v2 (TestPackageV2 with `exposureAtPublish` and section `format`, SessionViewV2, ServedItemV2, `section.finish`, `refusedSeqs`, `section_closed` 410, `ItemGetQuery`), mirror v1|v2 union + `checkMirrorV2()`, AUDIT_ACTIONS R5-14/R5-26 (Opus spec PASS WITH FIXES, Sonnet CONFIRMED). `0ab7df3` jobs retry v2 mirror messages until A3; candidate ERROR_STATUS.
- `8362f3a` merge `m1/w0-adr-vendors-carried`: ADR-033 (worker unzips with streaming `Unzip`, page parses with `DOMParser`; spec **R5-48**), VENDOR_INTERFACES + `llm-drafter.ts` types, D1-LEAD-1 perf split, recruiter B2-SEC-1/B2-SEC-4/account copy + `main.tsx` wiring.
- `b811408` merge `m1/w0-mt11-fr1`: M0b FR-1 closed in MT-11 (four new branches).
- `018d856` merge `m1/w0-infra`: R5-11 logins (Hyperdrive ids PENDING), R5-12 secrets list + D1 spec **4q**, R5-13 queues/DLQs/bucket + jobs `queue()` dispatch with throwing stubs, boundary rules 11–15, post-migration "Check the Hyperdrive bindings" CI step (INF-1).
- `4ba07c9` M1-c/M1-d drafts in `docs/progress/m1-wave0-drafts/m1cd/` (helper-written, checked only rolled back; NOT placed, NOT reviewed).

## Next step (one precise action)
**M1 BUILD 1 part 3 (Wave 0c), lead + parallel writers as in part 2:**
1. Carried review notes first, test first, in M1-a/M1-b (in place, R5-30): **Medium** a written bank item can be approved without a rubric and drawn from a pool (`private.item_version_ready` must refuse; publish rubric check over the snapshot rows). Lows: `for share` on the ruleset read in publish; strata counts integers ≥ 1; audit the key review (`item.key_review` + AUDIT_ACTIONS); a spec sentence that item/variant `content_sha256` excludes keys and `correctOptionId` (or recompute the copy hash); a pgTAP assert that the current catalog is sealed.
2. Place M1-c then M1-d from `m1cd/` (read its `notes.md`: the `pg_temp.ai_draft` preamble change; the D1/M0b assertions it changes — `rls_memberships:404`, `rls_d1_idempotency` L-20 policy count — need an R5-28-style supersession row, recorded; `rls_roles` and candidate_denied lists; floors; db-types). Opus database + security first reviews, fixes test first, re-review.
3. Then `renderCandidateSummary` (AT-M1-31) unless a stream owns it; full `pnpm verify`; CI on PR #14; Wave 0 done → BUILD 2 = Wave 1 (A1, A6, A5) after a pre-flight agent.

## Notes for later streams (from reviews; not defects now)
- A3: call `checkMirrorV2()` in the mirror stage (retry → DLQ); check `poolSectionIds` against `sections.pool_id`; remove the v2 retry guard in `workers/jobs/src/queue/consumer.ts` once v2 is stored. Admin consumer treats messages as ids only.
- A5 import: per-XML-part cap ~10–20 MB; render rows only as React text; validate the postMessage shape.
- A6: rule 13 needs an `assert*Env` call in `MockLlmDrafter`'s constructor.
- Infra Lows: `if:` on deploy steps is not pinned by check-workflows; the edge no-secrets test pattern is looser than rule 11. MT-11: ≈0.5 s on 209 clauses; non-equality ties count as correlation.
- DB-M1-11: `rls_d1_invariants.test.sql:23` (`app_roles()` add-only edit from part 1) is outside R5-28's list; record it in the next spec revision.

## Founder items
- New FOUNDER-QUEUE row 2026-10-23: M1 staging Hyperdrive configs + `MEMBER_INVITE_PEPPER` / `SUPABASE_SECRET_KEY_JOBS` (after the D1 CLOSE and a staging go-ahead; not blocking BUILD). Unchanged: Q-M1-1…Q-M1-4.

## Gotchas
- The worktree guard refuses `cd …&&` + git, `$(...)`, chained git calls and heredocs that mention git words; commit messages via `git commit -F <file>`; commitlint body lines ≤ 100 chars; merge subjects `chore: merge …`.
- Python `open(...,'w')` on Windows writes CRLF unless `newline='\n'`.
- The local `postgres` is not a superuser: no `SET SESSION AUTHORIZATION` in pgTAP.
- Never hand-edit generated `rls_m1_*.test.sql`: edit `docs/progress/m1-wave0-drafts/pgtap/bodies/*.sql`, then `node docs/progress/m1-wave0-drafts/pgtap/gen.mjs <repo root>`.
- RAM: parallel writers + verify:fast OOM'd once (exit 134); run verify alone.

## Verify first
`git fetch trace` · `git log --oneline -3 m1/integration` · `git status` · `git rev-parse --short trace/d1/integration` (`1547fd0`) · `git rev-parse --short trace/main` (`da5380d`) · `pnpm -s verify:fast`
