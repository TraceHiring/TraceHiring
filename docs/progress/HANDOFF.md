# HANDOFF — 2026-10-15 ~14:05 IST
Reason for stopping: founder asked to work until the weekly limit reaches 90%; stopped at weekly ~88% (context ~60%). The 5-hour window was ~37%.
Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`** (its §4 paste prompt).

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13)
- Milestones closed: **0 of 17**. M0a, M0b: built, reviewed, fixed; CLOSE waits for founder gates.
- **Phase: D1 BUILD, Wave 0 (lead-only).** Done: AT-D22; migrations **1-4** placed, reviewed, fixed; all `rls_d1_*` files of spec §3.6 placed (incl. `media_view`, `candidate_denied`, `invariants`); **contracts** `@trace/shared/contracts/{candidate,d1}` + `canonical-json` placed and reviewed; ADR-030 accepted in part. `SIGNAL_CATALOG` and `canonicalNoticeText` placed (`b625788`); **band-engine and e2e skeletons, boundaries, wrangler bindings and the staging-secrets allow-list placed and security-reviewed** (`74c5887`..`97f82dd`). Not done: DC-D5/D6/D8/D9, ci.yml §7.1 deploy changes, skeletons, boundaries, wrangler/CSP/ci changes (Next step).

## Where we are
- **`d1/integration`** (worktree `.claude/worktrees/d1-integration`) tip = this handoff commit; code tip **`97f82dd`**. `verify:fast` exit 0 at `97f82dd`. Linux CI green on `742bf54` (skeletons + bindings + fixes); CI on `97f82dd` was running at stop. **Local `test:rls` not re-run this session: Docker Desktop stopped and hung on restart**; no SQL changed since the last green full verify (`3abf88f`, rls 2610), and CI `rls` passed on `742bf54`. Run a full `pnpm verify` first.
- Linux CI (draft PR TraceHiring/TraceHiring#4): green on `f6a0144` and on `87bbc8d`; **all green on `bbae037`** (static, rls, migrations, security).
- Tag **`cp/d1-01`** = `bbae037` (Wave 0 migrations + tests + contracts; full verify and Linux CI green). Unchanged: `milestone/m0a` `7dc8c0d`, `m0a/integration` `c619525`, `milestone/m0b` = `m0b/integration` `56c2641`, `main` `fe77a87` (never commit on or move `main`).
- Agent branches kept (never delete; all cherry-picked or copied): `worktree-agent-a1597e43a4cfde273` (`d06c4e5`, test drafts), `worktree-agent-a31277c7fe66088f4` (`33af756`, contracts draft), `worktree-agent-a434893532bb816a7` (`c8c0fb3`, contracts fixes).

## Done this session (verified)
- **Session 2 (2026-10-15, same chat after a 5-hour reset):** `74c5887` band-engine + e2e skeletons, boundaries elements, `band-rules-sync` test (Sonnet writer A; Playwright 1.63.0, published 2026-09-04); `c4dddcd` lead: `report-quality`/`report-integrity` are the two rule-1 sides (cases red first), root tsconfig references; `6841d63` wrangler dev/staging bindings per §4.2, DO/`CandidateRpc` stubs, `check-staging-secrets` allow-list = §7.1, `wrangler-bindings.test.mjs` (Sonnet writer B); Opus **security review of the bindings PASS WITH NOTES** (`docs/reviews/D1-security-review-bindings.md`) → `742bf54` (F3 edge secret names, F8 e2e traces off, F1 test title) and `97f82dd` (check-boundaries **rule 11**: edge uses `PACKAGES` only via get/head); writer rules in spec §11 "Binding rules for every writer".
- Verify-first matched the 23:00 handoff; full `pnpm verify` exit 0 at `8b1efd6`.
- `26cd6eb` m3 review items: m-7a (sweep age guard), m-7b (flip consistency), n-1 (consents TRUNCATE trigger isolation) as tests (no red phase possible: mutation runs fail exactly the new assertions); m-6, n-4, n-6 written into spec §5.1 "Transactions and retries".
- `f6a0144` **migration 4** `20261014175327_d1_media_audit.sql` (`private.media_viewer_check`, `media_link_grant`, `media_view_grant`), `rls_d1_media_view` red first; `AUDIT_ACTIONS` 20 → 24 (incl. the missing `invitation.create/revoke`).
- Opus **DB review** (APPROVE WITH MINOR FIXES) + Opus **security review** (PASS WITH NOTES) → `0b9a949`: view grant only for a link issued to the same viewer/media within 330 s and never viewed (per-link advisory lock), reused link ids refused, `mo.org_id = private.api_org_id()`; tests for demoted, removed, re-added, suspended member/org, audit failure, positive controls (73 assertions, new cases red first). Spec §6.2 **"Media link requirements" R3-1..R3-9** for stream R3; `docs/reviews/D1-db-review-m4.md`, `D1-security-review-m4.md`.
- `6b2c657` `rls_d1_candidate_denied` (36) and `rls_d1_invariants` (66), Sonnet-drafted, lead-placed; no rule-5 finding. Notes: `docs/progress/d1-wave0-drafts/m4-tests/NOTES.md`.
- `1a1ce39` ADR-030 **Accepted (autopilot) in part** (token format, ES256 signing, edge verification); gateway/RLS part stays Proposed (M3a).
- `b625788` `@trace/shared/signal-catalog` (`SIGNAL_CATALOG` `d1-signals-v1`, cross-checked with d1-v1.json and `ClientSignal`) and `@trace/shared/canonical-notice` (`canonicalNoticeText`, `noticeSha256`), tests first; spec §4.2 names them.
- `104a98b` + `87bbc8d` **contracts** (Sonnet-drafted, lead decisions in spec §4.2 "Contracts"), Opus spec review PASS WITH FIXES → `131318f` (spec F8, F10), `9890b9e` (code F1–F7, F9, `canonicalJson`), `bbae037` (review record `docs/reviews/D1-contracts-review.md`, `./canonical-json` export).

## Decisions made this session (lead; recorded where named)
- Media: bind the grants to `private.api_org_id()` (security F3 overrules DB n-1); keep the deterministic R2 key of D1-5 and move "no audit row, no bytes" into R3-3 (security F1) — `D1-security-review-m4.md`.
- `jti = crypto.randomUUID()`, `exp` = issue + 300 s exactly — spec §4.5, §6.2 R3-4.
- Contracts: `sessionGrant` returns `sessionId`; `sessionStarted` takes `orgId`; no client answer hash in D1 (§4.4, AT-D25); optional `workspaceId` on test creation; `IntegrityCard.ready.photoMissing`; flag timeline entries must carry a non-connectivity family (stricter than the table) — spec §4.2, contracts NOTES.
- Migration 4 fixed in place (never applied to a shared DB), as migration 3 was.

## Next step (in order)
1. Verify (below), incl. CI on the handoff commit.
2. Full `pnpm verify` on the tip (Docker first; relaunch it if needed) and CI on PR #4. Then tag `cp/d1-02`.
3. Wave 0 remainder (spec §11): **ci.yml per §7.1** (deploy order api → jobs → edge, the new `--var`s from GitHub variables with a "no `d` member in a public JWK" guard, idempotent R2 bucket and queue creation, `d1/**` dispatch; security review F4/F5), jobs `queue`/`scheduled` handlers wrapped by `withErrorReporting` (lead-owned `index.ts`), the recruiter `__API_ORIGIN__` CSP, DC-D5 (media link: R2 stream + `MediaLinkDO` burn + canvas CSP), DC-D6 (Playwright Win/Linux; browsers need a download, ask first), DC-D8 (CPU; may slip to Wave 1), DC-D9 (CI E2E stack); pin app dev ports (review F9).
4. Open DB items carried: m1 m-2 (auto-assign re-add, decide/document), m1 m-4 + m2 n-7 (exact `trace_api` table allow-list in `rls_roles`), m1 m-5 (`test.retire` audit?), m2 m-2 (late `sessionStarted`, decide in R3), m2 n-1 (M3a), m3 n-7 (M4 index).
5. Then Wave 1 writers R1, R3, C1 (max 3, own worktrees reset to an exact SHA). R3 must implement §6.2 R3-1..R3-9.

## Founder items still open (`docs/progress/FOUNDER-QUEUE.md`)
- Confirm the rule-6 decision (non-blocking). Walkthrough continues at **step 6: R2** (enable R2 on the Cloudflare account), then `staging` branch rules for `d1/**`, GitHub plan / branch protection, staging-evidence choice, H8, H11, SES, DNS, AWS OIDC, H9, the reviewer smoke user.

## Gotchas
- Docker Desktop can stop mid-session: relaunch via a node `spawn` script (the worktree guard blocks direct launches); the Supabase containers restart by themselves.
- Ad-hoc pgTAP runs outside `supabase test db` need `create extension if not exists pgtap with schema extensions;` inside the file's transaction (scratch runner pattern: pipe the file to `docker exec -i supabase_db_trace psql -U postgres -X -q -At` from a node `spawnSync`).
- A pgTAP dry run of a changed migration against a DB that already has it: copy it with `create or replace function` and run it plus the test in one rolled-back transaction.
- Warn running agents before `test:rls` (it resets the DB).
- `scripts/test/gitleaks-config.test.mjs` › "finds an api_key value starting with true" flaked once under `verify:fast` load (real gitleaks process); it passed alone and on re-run. If it recurs, raise its timeout.
- JS `String.replace` turns `$$` into `$` in a replacement string: always use a replacer function.
- Worktree guard: no `$(…)`, loops, `cd` + git chains, pipes into docker/psql; commit via `git commit -F <file>`.
- Docker Desktop hung on restart on 2026-10-15 (engine pipe missing for >10 min); `docker ps` can block for minutes, so run it in the background.
- Agents are costly on Pro: an Opus review ≈ 115–220k tokens; a Sonnet writer ≈ 175–230k. This session went from 1% to ~80% of the 5-hour window with 7 agents.

## Verify first
- `git -c credential.helper= -c "credential.helper=!gh auth git-credential" fetch trace` · `git log --oneline -3 d1/integration` · `git status` · `docker ps` · `pnpm -s verify:fast` · `gh pr checks 4 --repo TraceHiring/TraceHiring`
