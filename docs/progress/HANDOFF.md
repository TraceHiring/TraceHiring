# HANDOFF — 2026-10-12 01:45 IST
Reason for stopping: usage guard (the founder's 95% rule; wrap-up started at about 85–90% of the 5-hour window after the founder said "finish the open work, then wrap up").
The next session may be a new Claude Code on another account connected to this folder: start from
`docs/progress/RESUME-PROMPT.md` on `m0a/integration` (its §4 paste prompt).

## Overall progress (build-order.md: M0a → M0b → D1 → M1 … M8 = closed beta → M9 … M13 = paid pilots)
- Milestones closed: **0 of 17** (no `m*-reviewed` tag).
- Checkpoints: `cp/m0a-04` = `a45505d` (S2 + S3a merged). `cp/m0a-05`: see "Where we are".
- **M0a: ~95% of BUILD.** S1, S2, S3a and S3b are all written, reviewed and fixed. What is left before the REVIEW phase:
  - AT-1a-local re-run and AT-1b on the final tip;
  - the `check-workflows` export gap (below);
  - finishing the summary draft.
- Rough estimate: ~6% of the way to closed beta (M8). An estimate, not a measurement.

## Where we are
- Milestone **M0a**, phase **BUILD**. Integration **`m0a/integration`** (checked out in `.claude/worktrees/trace-autopilot-resume-4ece3a`; enter it with `EnterWorktree` path).
- Spec **revision 16** (S2/S3a/S3b review follow-ups; `specs/m0-foundations.md:3-12`).
- `milestone/m0a` @ `a45505d` (`cp/m0a-04`), pushed. `main` unchanged (`fe77a87`).
- **Evidence this session:**
  - Full `pnpm verify` green on `a45505d`: scripts 1142 passed + 1 skipped (K4 Windows symlink case), `test:rls` 112/112, candidate 72.4 kB gzip, headers OK, `scan-dist` clean on 5 `dist/`.
  - Linux CI green on `146d465` (run 38167417262: static, rls, security, migrations).
  - **AT-1a-local PASSED on `a45505d`:** clean clone in the `node:22.23.3` container, scripts 1143 passed **0 skipped**, host `test:rls` 112/112.
- **S3b merge state:** see "Next step" 1. If `m0a/integration` already holds the `chore(ci): merge w-s3b …` commit, S3b is merged.

## Done this session (all on `m0a/integration`; reports in `docs/reviews/`)
- **W-S3a Workers** (`/health`, 404/500 JSON, reporter wiring):
  - Opus review PASS WITH FINDINGS (S3A-1 Medium: a thrown non-Error escaped Hono `onError`).
  - Fixed on `m0a/s3a-fixes` (`1205dcc`, `621c545`); re-review PASS.
  - Merged `c4f0646`.
- **W-S2 UI + apps** (tokens, contrast, shells, CSP):
  - Opus review PASS WITH FINDINGS (S2-1..4 Low), fixed on `m0a/s2-fixes` (`ca75411`).
  - Re-review PASS WITH FINDINGS (S2-R1, S2-R2); the lead fixed both in `bee2364` (the bundle scan now uses the production build).
  - Merged `e2133bf`.
- **W-S3b deploy-staging job** (`m0a/s3b-deploy` @ `91622ee`, Opus writer):
  - It adds `scripts/smoke-staging.mjs` and `scripts/staging-catalog-checks.mjs`, with tests.
  - Q2: URLs come from wrangler's ND-JSON output file. Q7: `--yes` and `-q`.
  - Opus review PASS WITH FINDINGS (S3B-1 and S3B-2 Medium, S3B-3..7 Low).
  - Fixed on `m0a/s3b-fixes` @ `ba3ac88` (scripts 1214 passed + 1 skipped).
  - S3B-5 (unordered staging deploys) is an accepted residual, owner M8.
- **Lead:**
  - `57be0cc` Workers `types:gen --strict-vars=false`.
  - `497cba7` `verify:fast` maps `docs/design/tokens.json` to `@trace/ui`.
  - `cf4b139` `check-boundaries` rule 7: no reporter or Sentry in candidate or edge source.
  - `146d465` `@trace/ui` `tokens`/`tokens:check` scripts, with `lint` running the check.
  - Spec revision 16.
  - Founder queue: the staging DB URL needs `sslmode=require`.
  - Build-notes row: W-S3b's `scripts/` grant.
  - Summary draft updated.

## Branches
| Branch @ tip | State |
| --- | --- |
| `m0a/integration` @ newest `chore(progress)` | all lead work; pushed; draft PR 1 runs CI |
| `milestone/m0a` @ `a45505d` (`cp/m0a-04`) | pushed; fast-forward again after the S3b merge |
| `m0a/s3b-fixes` @ `ba3ac88` (on `m0a/s3b-deploy` @ `91622ee`) | W-S3b + fixes; re-review result below |
| `m0a/s2-fixes` @ `ca75411`, `m0a/s3a-fixes` @ `621c545` | merged |
| `m0a/s2-ui` @ `54620e6`, `m0a/s3-workers` @ `e04446e` | merged via their `-fixes` branches |
| `worktree-agent-*` | writer scratch; do not use |

## Next step (in order)
1. **S3b:** if not yet merged, check the re-review verdict in `docs/reviews/M0a-S3b-deploy-security-review.md`. If it is PASS, run `git merge --no-ff m0a/s3b-fixes` into `m0a/integration` (the subject must be `chore(ci): merge …`; commitlint rejects a `merge` type). Then:
   - run the full `pnpm verify` with no writer running;
   - push, and wait for Linux CI on PR 1;
   - tag `cp/m0a-05`;
   - fast-forward `milestone/m0a`: `EnterWorktree` into `.claude/worktrees/milestone-m0-spec-e4db77`, then `git merge --ff-only cp/m0a-05`, then go back.
2. **`check-workflows` gap (S3b review, lead-only):** `run:` text can `export` names that `ENV_DENY_REASONS` denies (for example `NODE_OPTIONS`). Add a rule test-first, or record it as a residual.
3. **AT-1a-local re-run** (`node scripts/verify-clean-clone.mjs --linux`, ~20 min) and **AT-1b** (`node scripts/verify-clean-clone.mjs`) on the final tip. Record both in `docs/progress/M0a-summary-draft.md` §4.1.
4. Finish the summary draft:
   - the S3b row;
   - residuals S3B-5, the `--no-bundle` first-run risk, Q8 Pages headers;
   - deferred CSP origins.

   Then **stop BUILD.** The REVIEW phase (`trace-milestone-review` skill) runs in a fresh session that did not write the code (AUTOPILOT §2). Do not start M0b.

## Decisions made this session
- **Founder, in chat:** work until 95%, use many agents, and finish the open work before wrapping up. Applied within AUTOPILOT §2 (at most 3 writers at once, disjoint files).
- **W-S3b:** started before the S2/S3a merges, and given a `scripts/` grant for its new files only (`docs/build-notes.md`, last row).
- **Q2:** wrangler output file, so §7.3 is unchanged.
- **S3B-5:** accepted as a residual.
- **Stream fixes go on new `<stream>-fixes` branches:** a pinned agent cannot enter another agent's worktree.
- **Workers `observability: { enabled: false }`:** no Workers Logs until ADR-027 records it.

## Open questions for the founder (`docs/progress/FOUNDER-QUEUE.md`)
- **URGENT (unchanged):**
  - roll the Cloudflare token pasted as a secret *name*;
  - set `CLOUDFLARE_API_TOKEN`;
  - set `SUPABASE_STAGING_DB_URL`, now **with `?sslmode=require`**;
  - the `workers.dev` subdomain (H4);
  - GitHub rules on `main`, `milestone/*` and tags.
- **Unchanged:**
  - staging-gate evidence before `m0a-reviewed`;
  - the staging Postgres major version (H5);
  - H6 Sentry (before D1).

## Gotchas / do not touch
- **Who runs the stack:** only the lead runs `supabase start/stop`, `db reset`, `test db`, `gen types`, `pnpm verify` and `pnpm test:rls`.
- **Timing tests flake under load:** a full `pnpm verify` counts only when no writer is running.
- **Deny rules:** they block any Bash text containing `wrangler deploy `, `supabase db push` and similar (even in grep). Use the Grep tool.
- **Worktree guard:**
  - it refuses `git -C`, `cd <other worktree> && git`, `$(…)`, and Python or heredoc commands that also run git: split such commands up;
  - it refuses a heredoc whose text mentions some git-like words: use the Edit tool.
- **Agents:**
  - writer worktrees start at `main`: tell each writer to `git switch <branch>` after confirming it has no commits of its own;
  - give each writer a new branch, since an agent cannot enter another agent's worktree.
- **Commits:**
  - merge commits use `chore(<scope>): merge …`;
  - write messages to a file and commit with `git commit -F`.
- **Push:** `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push trace <refs>`. Never force.
- **Usage this session:** one Opus review cost about 6–8%, an Opus writer about 10%, a Sonnet fix writer about 4–6%.

## Verify first
- `git fetch trace`
- `git log --oneline -5 m0a/integration`
- `git status`
- `docker ps` (expect `supabase_db_trace`)
- `pnpm -s verify:fast`
- `git log --oneline -1 m0a/s3b-fixes milestone/m0a`
