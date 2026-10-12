# HANDOFF — 2026-10-12 09:25 IST
Reason for stopping: the founder asked to wrap up (usage 85% of the 5-hour window, 74% weekly; the 95% rule applies to this session).
The next session may be a new Claude Code on another account: start from `docs/progress/RESUME-PROMPT.md` on **`m0b/integration`** (its §4 paste prompt).

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M8 = closed beta → M9 … M13)
- Milestones closed: **0 of 17** (no `m*-reviewed` tag).
- **M0a: REVIEW done, FIX done, stopped before CLOSE** (founder's decision). Verdict **BLOCK, founder-gated, no code defect** (`docs/reviews/M0a.md`). CLOSE waits for the founder (GitHub plan, staging secrets).
- **M0b: SPEC phase.** `specs/m0b-tenancy.md` revision 2; the 41 findings of the first reviews are resolved; the Sonnet re-review asks for revision 3 (N1–N8, all small). Started before `m0a-reviewed` per the founder's overnight decision; M0b closes only after `m0a-reviewed`.

## Where we are
- **Integration branch: `m0b/integration`** (worktree `.claude/worktrees/m0b-integration`; enter it with `EnterWorktree` path). Cut from `milestone/m0a` @ `7dc8c0d`.
- `milestone/m0a` @ **`7dc8c0d`** = tag **`cp/m0a-06`** (M0a FIX tip; full `pnpm verify` exit 0 with no agent running: scripts 1299 + 1 skipped (K4), `test:rls` 112/112, candidate 72.4 kB, headers + `scan-dist` OK; Linux CI run 38199234040 green).
- `m0a/integration` @ `c619525` (one docs commit after `7dc8c0d`: verify evidence in `docs/reviews/M0a.md` and the summary draft). Its HANDOFF.md is stale (01:45 IST); **this file supersedes it**.
- `main` unchanged @ `fe77a87`. Draft PR 1 (`m0a/integration` → `main`) stays a draft.
- `verify:fast` exit 0 on `57e9693` (09:20 IST, 195 s).

## Done this session (verified)
- **M0a REVIEW** (`5b7ff1f`, `docs/reviews/M0a.md`): 3 fresh Opus reviewers (security, database, spec). Mechanical gates G1–G11 run and quoted. ABH-80 log scan of the verify output and CI logs: 0 PII hits.
  - SEC-1 High: branch protection/rulesets unavailable (private repo, personal account, GitHub Free; `gh api …/branches/main/protection` → 403, re-run by the lead). SEC-2 Medium: secret scanning/push protection unavailable. SEC-3 High (tracked): misnamed staging secrets. → founder.
  - DB-1 Medium, DB-2 Low → M0b (catalog-check gaps; in the M0b spec §5).
  - SPEC-F1..F4 and SEC-4 Lows fixed in `7dc8c0d` (spec rev 17 inline notes, summary cites remapped, build-order/README/founder-steps lines).
- **M0b SPEC:** rev 1 `51a4ef0`; spec-reviewer + database-reviewer (Opus) CHANGES REQUIRED, recorded in `docs/reviews/M0b-spec-review.md` (`51a1e2b`, `c35a005`); rev 2 `d62ec8f`; deviations + H8–H11 logged `4f0ff80`; Sonnet re-review: all 41 RESOLVED, N1–N8 new (recorded in the same file).
- Day-one checks DC-1 (PASS) and DC-5 (TRUNCATE triggers not inherited) run on the local stack.
- **Flaky test fixed** `57e9693`: the scan-dist api_key victim could contain a gitleaks generic-api-key stopword; the fixture now avoids them (tests first).

## Next step (in order)
1. **M0b spec revision 3 (lead):** fix N1–N8 exactly as listed at the end of `docs/reviews/M0b-spec-review.md`. Then one **Opus** re-review pair (spec-reviewer + database-reviewer) on rev 3 (rev 2 changed the security model, so Opus, not Sonnet). Fix, then write "Spec approved by autopilot reviewers" in the spec's Approval section.
2. **M0b BUILD** per spec §11: B0 (lead: DC-2/3/6, `rls_*` tests first, then the three migrations), B1 (catalog checks), B4 (lead files), then writers B2 (Opus, recruiter auth UI), B3 (Sonnet, spike), B5 (Sonnet, workers-http). Max 2 writers at once.
3. Push `m0b/integration` when CI should run; there is no PR for it yet. Open a **draft PR `m0b/integration` → `main`** (never merged) so Linux CI runs, as for M0a.

## Decisions made this session
- Founder (in chat, 08:20 IST): wrap up at 95%; M0a REVIEW+FIX here with fresh Opus reviewers; stop before CLOSE; then M0b; staging secrets not set; ≤ 3 agents, ≤ 2 writers (build-notes §0 "Morning session").
- M0b spec HOW-level deviations (build-notes "Autopilot changes", last row): no T&S read policy until M6; directory via policy; no `active_org_id`; members added `active` in M0b; Workers Logs on with invocation logs off.

## Open questions for the founder (`docs/progress/FOUNDER-QUEUE.md`)
- **NEW, blocks M0a CLOSE:** GitHub plan (row 15): upgrade, move to a paid org, or accept AT-13 as not met. Never make the repo public.
- **NEW, blocks M0b CLOSE:** H8–H11 (row 20): staging Auth settings, smoke user, `SUPABASE_STAGING_URL`/`_PUBLISHABLE_KEY` variables, `trace-dev` migration dry run.
- **Unchanged URGENT:** roll the Cloudflare token pasted as a secret name; set `CLOUDFLARE_API_TOKEN`; `SUPABASE_STAGING_DB_URL` with `?sslmode=require`; H4 `workers.dev` subdomain; H5 staging Postgres version.

## Gotchas / do not touch
- Only the lead runs `supabase start/stop`, `db reset`, `test db`, `gen types`, `pnpm verify`, `pnpm test:rls`. **Run full verify with no agent running** (a commitlint `beforeAll` timed out under the load of 3 reviewers).
- Worktree guard: no `git -C`, `$(…)`, heredocs mentioning git words, or chained git commands; write scripts with the Write tool, then run them.
- Commit messages: body lines ≤ 100 chars (commitlint rejects longer; use `git commit -F <file>`).
- Inserting lines in `docs/build-notes.md` §0 or `FOUNDER-QUEUE.md` shifts line cites in `docs/progress/M0a-summary-draft.md`: append, or replace a blank line.
- `= any((select private.fn()))` fails; use `= any((select private.fn())::uuid[])` (DC-1).
- Push: `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push trace <refs>`; never force.
- Usage: one Opus review ≈ 6–15%; three in parallel took ~35% of the window.

## Verify first
- `git fetch trace` · `git log --oneline -5 m0b/integration` · `git status` · `docker ps` (expect `supabase_db_trace`) · `pnpm -s verify:fast`
- `git log --oneline -1 milestone/m0a` (expect `7dc8c0d`), `git tag -l "cp/m0a-*"` (expect 00–06)
