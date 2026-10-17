# HANDOFF — 2026-10-18 ~03:00 IST
Reason for stopping: usage guard (Pro plan, founder stop at 95-96% of the 5-hour window; the window resets ~06:20 IST). Start from `docs/progress/RESUME-PROMPT.md` on **`d1/integration`** (its §4 paste prompt). The repo wins over this file and over any memory.

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M13; 17 milestones)
- Closed: **0 of 17** (no `m*-reviewed` tag, `main` still `fe77a87`). M0a and M0b are built, reviewed and fixed but **not CLOSED**. **D1 ≈ 55%**: Wave 0 complete (`cp/d1-03`), R1 merged (`cp/d1-04`), **R3 complete and assembled on `d1/r3-merge`, not yet merged**; C1, Waves 2-3, the staging deploy and the D1 review remain.
- **Path to close M0a and M0b:** unchanged (founder widens the Cloudflare token with R2 + Queues Edit, runs the key script and sets the `staging` variables per `scripts/ops/README.md`; then a `workflow_dispatch`, smoke, re-review, summaries, `--no-ff` into `main` and the `m*-reviewed` tags — **each merge only with the founder's explicit go-ahead**). **Ask the founder before the first staging dispatch.**
- **Current phase: D1 BUILD, Wave 1.**

## Where we are (verified this session)
- **`d1/integration`** @ `6ffe4e1` (+ this handoff commit), clean. `6ffe4e1` fixed the random scan-dist CI failure (20001 > 20000). verify:fast exit 0 (197 s) and **CI green on PR #4** for `6ffe4e1` (static, rls, security, migrations, e2e-local).
- Tags unchanged: `cp/d1-01` `bbae037`, `cp/d1-02` `97f82dd`, `cp/d1-03` `1dff4d6`, `cp/d1-04` `df865ca`.
- Unchanged: `main` `fe77a87`, `milestone/m0a` `7dc8c0d`, `m0a/integration` `c619525`, `milestone/m0b` = `m0b/integration` `56c2641`.
- **R3 assembly branch `d1/r3-merge` @ `dde658e`** (code tip `cbfe5ac`; `dde658e` adds the security review record) (worktree `.claude/worktrees/agent-af098bea644b1ab65`, clean): **verify:fast exit 0 (182 s)**; api 30 files / 340 tests. It holds, in order:
  - R3b reports half (`d1/r3-reports` @ `7f6965c`: reports, report-quality, report-integrity, rule1-separation tests) + merge of `6ffe4e1` (`c3de00f`);
  - lead `9c8db45` report mount + `log-hygiene.test.ts` (AT-D32 api half); `34f834b` spec review record; `6b97647` integrity card fails closed past the 500-entry timeline cap (finding 4a, tests first);
  - merge `4692227` of **`d1/r3-api-r3a2` @ `f3f9c52`** (R3a + R3a2: token, api-db, CandidateRpc, org context, media link, tests/publish, assignments, invitations, outbox route; report `docs/reviews/D1-r3a-writer-report.md`; `7734f06` fixes the unbound-fetch "Illegal invocation" bug);
  - lead `cbfe5ac` full mount in `app.ts`, real `CandidateRpc`/`MediaLinkDO`/`DemoOutboxDO` exports in `index.ts`, `route-inventory.test.ts` (AT-D13: 20-entry allow-list, forbidden-word guard, `/media/:jti` non-GET 404).
- Writer branches (kept, local + pushed at wrap-up): `d1/r3-api` @ `064f5fe` (its worktree `agent-ab9420609f2c22c98` still has an untracked old copy of `modules/media/`: leave it), `d1/r3-api-r3a` @ `51667f6` (the lead's `wip` save of R3a's uncommitted tests module), `d1/r3-api-r3a2` @ `f3f9c52`, `d1/r3-reports` @ `7f6965c`.
- **Reviews of R3:** spec review of the reports half **PASS WITH FIXES** (`docs/reviews/D1-spec-review-r3-reports.md` on `d1/r3-merge`): finding 1 (unbound fetch) fixed, 2 (route inventory) fixed, 4a fixed; 3, 4b, 5 open (below). **Security review of all of R3: SEE "Security review" below.** Not yet run: spec review of the R3a/R3a2 half, database-reviewer.

## Security review
- **Opus security review of all of R3: PASS WITH NOTES** (`docs/reviews/D1-security-review-r3.md` on `d1/r3-merge` @ `dde658e`). No Critical/High. **Due before the merge:** **#1 Medium**: `openApiDb` (`modules/candidate/api-db.ts:61-70`) must enforce TLS for a non-local `API_DB_URL` (refuse missing/weak `sslmode`, reuse `scripts/ops/lib.mjs:125-158`, pass `ssl: 'require'`; test: no sslmode → `null`/503). **#2 Low**: publish (`modules/tests/routes.ts:227-248`) writes the R2 package before any role check: `requireRole(... ['org_owner','admin','recruiter'])` before any bucket call, better put only the package rebuilt from frozen rows after the guarded UPDATE; test: a reviewer's publish leaves `bucket.puts` empty. Notes: N1 org routes need allow-list CORS before R5; N2 demo outbox org-wide (accepted for D1); N3 wrangler `redact_query_string` warning.

## Next step (in order)
1. Verify (below). If anything differs from this file, stop and report.
2. **Finish R3 on `d1/r3-merge`** (work in its worktree `.claude/worktrees/agent-af098bea644b1ab65`):
   a. Fix the security review's findings (above), tests first.
   b. Open spec-review items: **3** amend spec §6.2 (report-quality also reads `sections`, report-meta reads `tests`); **4b** results list takes the 500 newest then sorts by score, and the review queue slices before the time sort: fail closed or document (pagination is M2); **5** extend `log-hygiene.test.ts` to `/media/:jti` (jti, sig, key), invitations (token, inviteUrl) and the outbox (OTP, body).
   c. Run the **spec-reviewer on the R3a/R3a2 half** (tests, assignments, invitations, outbox, media, candidate; AT-D10, D12, D15, D18, D33-D35) and the **database-reviewer** (queries, grants used, trace_api SQL; the writer's psql probes are in its report).
   d. Writer open questions to decide (lead, or FOUNDER-QUEUE if they touch rules 1-9; none does): invite link TTL 7 days; response bodies (201/200 lists, revoke 409); invite failure paths (outbox failure revokes + 503; `sent` failure → 201 with `created`); 403 `aal2_required` on own-membership aal; "Removed member" label; unreferenced rubric rows per draft PUT.
   e. Then merge `d1/r3-merge` into `d1/integration` with `--no-ff`. **The merge message must say that `ec83f46` carries R1's subject (band-engine) but holds R3's candidate token files** (pushed history, not reworded).
   f. Full `pnpm verify` (with `npm_config_workspace_concurrency=1`) + CI on PR #4, tag **`cp/d1-05`**.
3. C1 (edge, Opus writer; spec §11 row "C1"), then Wave 2 (R2, R4, C2), lead wiring, `e2e-local` with the real flow, Wave 3 (R5), then the founder gates for the first staging dispatch. At most 2 agents at once.
4. Carried DB items: m2 m-2 (late `sessionStarted`: R3 chose, check in the R3 DB review), m2 n-1 (M3a), m3 n-7 (M4 index), m2 n-7 two-connection mirror test (R2, AT-D16). Real-DO tests of `DemoOutboxDO`/`MediaLinkDO` need bindings in the api vitest pool config (lead file).

## Decisions this session
- Lead: R3 is assembled on one lead branch `d1/r3-merge` (R3b + R3a2 + lead files) so the reviews see the whole stream before it enters `d1/integration`; both writers merged `6ffe4e1` into their branches (merge commits, no rewrite).
- Lead: R3a's uncommitted tests module was saved as a `wip` commit (`51667f6`) on its own branch before anything else.
- Lead: the route inventory lists `ALL /media/:p` (the router answers non-GET with the R3-6 404) and proves non-GET is 404.

## Founder items (`docs/progress/FOUNDER-QUEUE.md`)
- Unchanged: before the first staging dispatch, widen the Cloudflare token (R2 + Queues Edit); key script + `staging` variables per `scripts/ops/README.md`. S1 residual risk (GitHub Free). H9, H11, SES SMTP, Workers Paid only if DC-D2/D8 need it.

## Gotchas
- **A stale commit-message file commits silently:** the Write tool refuses an unread file, the commit then reuses the old text. Read the file, Write it, commit, check `git log -1`. (This session amended one such unpushed commit.)
- This machine is short of RAM: `npm_config_workspace_concurrency=1` for verify / verify:fast (3-8 min).
- Worktree guard: no `$(…)`, heredocs, loops, `cd` + git or several git calls chained with `;` in one Bash command; use EnterWorktree to move between worktrees; write files with the Write tool.
- Usage on Pro: one Opus writer + one Opus review together took the window from 25% to 63% in ~25 minutes this session.
- Only the lead runs supabase start/stop, db reset, test db, gen types, `pnpm verify`, `test:rls`, `scripts/e2e-local.mjs`.

## Verify first
- `git -c credential.helper= -c "credential.helper=!gh auth git-credential" fetch trace` · `git log --oneline -3 d1/integration` · `git log --oneline -3 d1/r3-merge` (tip `dde658e` or later) · `git status` (clean) · `docker ps` · `npm_config_workspace_concurrency=1 pnpm -s verify:fast` · `gh pr checks 4 --repo TraceHiring/TraceHiring`
