# HANDOFF — 2026-10-11 20:10 IST
Reason for stopping: usage (~80% of the 5-hour window after the S1.7 gate; founder rule: wrap-up done by 95–96%).
The next session may be on another account: start from `docs/progress/RESUME-PROMPT.md` on `m0a/integration`.

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M8 = closed beta → M9 … M13 = paid pilots)
- Milestones closed: **0 of 17** (no `m*-reviewed` tag). Checkpoints: `cp/autopilot-installed`, `cp/m0a-00`,
  `cp/m0a-01`, **`cp/m0a-02`**, **`cp/m0a-03`** (this session; see LOG.md for what each marks).
- **M0a (toolchain, pipeline, skeleton): ~75%.** S1.0–S1.7 built, reviewed and through the S1.7 gate (spec-reviewer
  PASS WITH FINDINGS). `milestone/m0a` fast-forwarded to the gate tip. S2 (ui tokens + apps) and S3 (Workers +
  staging deploy) not started; their lead preconditions P1–P4 are ready on `m0a/s2s3-prep`.
- Rough estimate: ~4% of the way to closed beta (M8), ~3% to paid pilots (M13). An estimate, not a measurement.

## Where we are
- Milestone **M0a**, phase **BUILD**, S1 done; next is the S2/S3 preparation (Next step). Integration
  **`m0a/integration`** @ the newest `chore(progress)` commit, checked out in
  `.claude/worktrees/trace-autopilot-resume-4ece3a` (enter it with `EnterWorktree` path). Spec rev **14** (`2f15140`).
- Full `pnpm verify` green on `3141764` (from a cold stack), `72f8f1f` and `2b81ac4` (code tip): scripts
  828 + 1 skipped (Windows symlink EPERM, K4; Linux CI runs it: 829/0), `@trace/shared` 613, `test:rls` 112/112
  (floor 112), db-types current, `scan-dist` OK.
- **Draft PR 1** `m0a/integration` → `main` (https://github.com/TraceHiring/TraceHiring/pull/1, never merge) runs CI on
  every push; Auto-fix is on in the desktop app. CI on `72f8f1f` (run 38146227653): static, rls, security, migrations
  all green. PR 2 (`m0a/s17-assembly` → integration) closed as merged.
- `main` unchanged (`fe77a87`). No handoff mirror on `main` any more (founder decision 4; RESUME-PROMPT STEP 5).

## Done this session (verified, all on `m0a/integration`)
- Founder decisions 18:55 IST recorded first (`c7e9646`, build-notes §0): backstop scope, agent models, CI draft PR,
  SessionStart hook. AUTOPILOT §2/§6 and RESUME-PROMPT updated (`e9b1d31`).
- CI: main's stale mirror commits merged with `-s ours` (`0522dfc`, tree unchanged) so PR 1 is mergeable and runs CI;
  Linux fixes: handlebars/sharp/undici patch overrides, braces advisory ignored with reason + expiry 2027-01-11
  (`4d7b0ec`, `5e3f178`).
- SessionStart hook reads the newest `*/integration` handoff, ≤ 9 KB (`d9bf35a`, 9 tests). P3 (`5211539`).
- Catalog pass D (Sonnet writer; E1 narrowed by the backstop decision, E2) → database re-review PASS → merged
  (`3141764`). Spec rev 14 (`2f15140`).
- Redactor G2 (Sonnet writer) → security re-review of G1+G2 PASS WITH FINDINGS (H1 Low) → merged (`26855cb`);
  lead fixed H1 (`72f8f1f`); the gate found H1 regressed `Bearer =v`/`Basic :v` (K2) → fixed (`2b81ac4`).
- Reviews: `docs/reviews/M0a-S1.7-catalog-pass-d-database-rereview.md`, `…-redactor-g-lows-security-rereview.md`,
  `…-gate-spec-review.md`.

## Branches
| Branch @ tip | What | State |
| --- | --- | --- |
| `m0a/integration` @ newest `chore(progress)` | all reviewed work | pushed; PR 1 |
| `milestone/m0a` @ `54bd44d` (`cp/m0a-03`) | fast-forwarded this session | pushed; worktree `.claude/worktrees/milestone-m0-spec-e4db77` |
| `m0a/s2s3-prep` @ `1c7dc63` | S2/S3 lead preconditions P1–P4 | merge next (Next step 3) |
| `m0a/s17-assembly` @ `72f64b4`, `m0a/redactor-g-lows` @ `54ad42a` | done streams | merged |
| `worktree-agent-*` | writer scratch | contained in named branches; do not use |

## Next step (in order; max 2 writers; check usage after every agent result)
1. **J1 is DONE** (`@trace/shared` 618; commit after `4a83998`); start with step 2. Was: the H1/K2 re-review (PASS WITH FINDINGS,
   `docs/reviews/M0a-S1.7-redactor-h1-k2-security-rereview.md`): `Token` + 4–8 spaces/tabs + `=`/`:` + value leaks
   (regression from H1). Add the reviewer's tests, then `sub(/\b(Token\s{4,8}[=:]\s{0,3})[^\s"',;]+/gi, keepPrefix)`
   after the `Token` step in `packages/shared/src/log/redact.ts`; `@trace/shared` suite; note the fix in that review.
2. **K1 (lead, before S3):** `scripts/check-staging-secrets.mjs` test-first (spec §7.2 step 6, AT-15 local part):
   allow-list `{edge:[],jobs:[],api:[]}`, unit tests over recorded `wrangler secret list` output, fails closed.
3. Merge `m0a/s2s3-prep` (P1–P4); record P5 decisions (spec §14 + build-notes "Autopilot changes"; no `scripts/`
   grant: K1 is the lead's). Then S2 ∥ S3 per `docs/progress/S2-S3-PLAN.md` (writers: Sonnet for mechanical
   placeholders, Opus for the deploy job). W-S3b also takes P2 (deploy-staging `container:`/`services:` ban) and
   extends `ENV_ALLOW_LIST` in review. Do not start M0b.

## Owed before M0a CLOSE (lead)
- **K3 → spec revision 15**: (a) `claude-*.mjs` "unchanged" is stale (session-start hook rewritten); (b) §7.1/§2
  mention `osv-scanner.toml`, `auditConfig.ignoreGhsas`, `overrides`; (c) AT-1a-local image digest row in §4; (d)
  MT-11 branch count 11 and the rev-7 "51 branch controls" list → 85; (e) N13 residuals in §15.
- gitleaks allowlist: vendor the v8.30.1 default config with `'''(?i)^(?:true|false|null)$'''`, point `.gitleaks.toml`
  at it, fix the tests that copy only `.gitleaks.toml`, and the scan-dist fallback config (steps in the N10–N13 re-review).
- M0a summary Deferred table: AT-1a-CI, AT-11, AT-13, AT-18, AT-22-staging, deferred parts of AT-12/15/16; D6 → M6,
  D7 → M4/M5 checklist (incl. E1 shapes 3–5), D8 → M6, E3 → M0b, N13 residuals; AT-9-sentry/H6 → before D1; K4 note at AT-1b.

## Decisions made this session
- Backstop scope applied: E1 shapes (3)–(5) → reviewer checklist; E2, G2, H1 fixed (honest shapes).
- Model policy applied: Sonnet writers (pass D, G2) and Sonnet re-reviews; Opus gate review.
- A stream branch may get its own draft PR into integration for Linux CI before the local `--no-ff` merge.
- K1: the lead writes `check-staging-secrets.mjs` (no `scripts/` grant to S3).

## Open questions for the founder (unchanged; `docs/progress/FOUNDER-QUEUE.md`)
- **URGENT:** revoke the Cloudflare token pasted as a secret *name*; set `CLOUDFLARE_API_TOKEN` and `SUPABASE_STAGING_DB_URL`.
- `workers.dev` subdomain (H4); branch protection on `main` vs the session-end push (a/b, AT-13); D1 placement. None
  blocks S2/S3 code; they block the staging deploy and its deferred gates.

## Gotchas / do not touch
- Only the lead runs `supabase start/stop`, `db reset`, `test db`, `gen types`, `pnpm verify`, `pnpm test:rls`; agents
  use rolled-back psql only. Catalog dev runner: `docs/progress/tools/catalog-run.mjs` (copy to scratch).
- Writer worktrees start at `main`: writers `git switch <stream branch>` (if not checked out elsewhere) or
  `git reset --hard <SHA>` after confirming no commits of their own.
- Worktree guard: keep git commands plain; no `node -e`/`$VAR` lines that mention git; write commit messages to a file
  and `git commit -F` (commitlint: lowercase subject, every line ≤ 100). `git show <ref>:.github/…` is mangled by
  MSYS path conversion; use `git diff <a> <b> -- .github/…`.
- Pushing during the session is expected (CI). Push: `git -c credential.helper= -c 'credential.helper=!gh auth git-credential' push trace <refs>`. Never force.
- Usage: one Opus gate review ≈ 15–17% of a Pro window; a Sonnet writer ≈ 5–8%; a Sonnet re-review ≈ 4–5%.

## Verify first
`git fetch trace` · `git log --oneline -3 m0a/integration` · `git status` · `docker ps` (`supabase_db_trace`) · `pnpm -s verify:fast`
