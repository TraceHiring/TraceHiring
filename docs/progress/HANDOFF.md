# HANDOFF — 2026-10-11 04:15 IST
Reason for stopping: usage guard (5-hour window at 71% when this was written; Pro plan). The founder asked to stop at 90%.

## Where we are
- Milestone **M0a**: toolchain, pipeline and skeleton. **Phase: BUILD.** S1.1–S1.6 and the S1.7 logger/redactor are built and green. S1.7's database half (`supabase/`, `test-rls`, `db-types`) has not started.
- **Integration branch:** `claude/trace-autopilot-continue-8d4785`, in the worktree of the same name. Every stream is merged into it. **`milestone/m0a` has not moved** (still `adbbb61`): AUTOPILOT §2 lets streams into it only after the reviewers pass, and the S1.4 security fixes still need their re-review (Next step 1).
- Last fully green commit: `0d8b511`. The full `pnpm verify` exited 0 at 04:07 IST in 65 s: typecheck; lint with check-boundaries, check-workflows, check-migrations and a full-history gitleaks scan; 969 tests; build with check-bundle-size, check-headers and scan-dist.
- No new `cp/*` tag; the last is `cp/m0a-01`. Tag `cp/m0a-02` only after Next step 1 passes.
- `demo/` (untracked when this was written): a standalone clickable D1 prototype that a writer agent was still building. See "In progress".

## Done this session (verified)
- **Rescued the crashed session:** WIP commits plus branches `rescue/20261011-0327-{claude-trace-autopilot-continue-317e4c,m0a-s14-checks,m0a-s14-verify}`.
- **Merged:**
  - `m0a/s1-config` (`96f04d5`)
  - `m0a/s15-ci` (`2e5be02`)
  - `m0a/s14-verify` (`408d88b`)
  - `m0a/s14-checks` (`5bdbe9a`)
  - the redactor branch (`8589fba`)
- **Root scripts per spec §5 at the S1.6 stage:** `166e7fe`, `b44fa30`. `lint`, `test`, `build`, `verify` and `verify:fast` are all wired.
- **check-boundaries rule 1:** exempts only the exact text `sb_secret_[\w-]*` in `packages/shared/src/log/redact.ts` (spec §10.2 note, `0d8b511`). `.gitleaks.toml` gains a `supabase-secret-key` rule.
- **Spec review of S1.4–S1.6:** CHANGES REQUIRED. B1, M1, L1, L3 and L5 fixed in `401117e`. L2, L4 and L6 are listed under Gotchas.
- **Security review of the S1.4 scripts:** BLOCK, 2 High + 4 Medium + 4 Low. Fixed test-first in `8ceb906`, `11efe17` and `f96007e`; 449 script tests.
- **Redactor (S1.7):** the earlier BLOCK findings are fixed in `be978bd` (187 shared tests). The **security re-review PASSED**, with follow-ups listed under Next step 3.

## In progress (exact)
- **`demo/`** (founder request, 2026-10-11): `demo/site/` is a static, dependency-free clickable prototype of the D1 workflow, with synthetic data, a mock grader and a simulated server. `demo/serve.mjs` serves it locally and `demo/README.md` has the hosting steps. A writer agent was building it when this was written. If `demo/` is still uncommitted, check it with `node demo/serve.mjs` and `pnpm exec prettier --check demo`, then commit it as `feat(demo): …`.
- Failing tests: none.

## Next step (one precise action)
1. Run a fresh `security-reviewer` on `git diff 0d8b511~4..0d8b511 -- scripts .gitleaks.toml` (the S1.4 security fixes). If it passes:
   - `pnpm verify`;
   - fast-forward `milestone/m0a` to the integration branch, from its worktree `milestone-m0-spec-e4db77`: `git merge --ff-only claude/trace-autopilot-continue-8d4785`;
   - tag `cp/m0a-02`.
2. Then **S1.7, database half** (spec §8, §14 row S1.7): `supabase/` (config.toml, baseline migration, catalog checks, manifest, fixtures, tests, floors), `scripts/test-rls.mjs` and `scripts/gen-catalog-tests.mjs` with tests, `packages/db-types`, `test:rls` in `verify`, and `scripts/test/root-scripts.test.mjs`. Add `gen-catalog-tests --check` to `lint`. The caller of `parseProve` must fail on an empty `[]`. Reviewers: `database-reviewer` and `spec-reviewer`.
3. Redactor follow-ups from the re-review, all in `packages/shared/src/log/redact.ts`:
   - **Medium:** quoted and multi-word `key=value` secrets (`password='…'`, `{'token': '…'}`, escaped JSON, `Basic`/`Token` auth schemes).
   - **Low:** default-ignorable characters and dash variants in number canonicalisation; all `\p{Nd}` digits; IPv6 after a `word:` prefix; URL userinfo; a `stack` string in data; boxed strings and an array's own `slice`.

## Decisions made this session
- **Founder answer:** a showable demo now, hosted at **`demo.tracehiring.tech`**, as a clickable D1 prototype. It lives in `demo/`, outside the product workspaces, and doesn't replace D1. Recorded in `docs/build-notes.md` (Autopilot changes) and FOUNDER-QUEUE.
- Merge commits use `chore: merge …`, because commitlint rejects a `merge:` type.
- `@trace/ui`'s `tokens:check` is removed from `lint` until S2 ships `scripts/build-tokens.mjs`. **Re-add it in the S2 merge.**
- TAP: any TODO directive fails, and floors count only passing assertions (spec §8.3, AT-3).

## Open questions for the founder (all in docs/progress/FOUNDER-QUEUE.md)
- **URGENT:** revoke the Cloudflare API token that was pasted as a GitHub secret *name*, delete that secret, and set `CLOUDFLARE_API_TOKEN` and `SUPABASE_STAGING_DB_URL` correctly. Blocking: any Cloudflare deploy.
- **Where is the DNS for tracehiring.tech managed** (Cloudflare or a registrar)? And confirm `demo.tracehiring.tech`. Blocking: the demo going live. Default: `demo.` subdomain.
- Still open from before: the workers.dev subdomain (H4); the D1 placement; branch protection vs the session-end push; wider deny rules.

## Gotchas / do not touch
- **Harness:** a subagent can write only inside the session's own worktree. To use other worktrees, give agents paths inside this one, or have them use `EnterWorktree`.
- **Spec review L2:** the CI `rls` job runs `pnpm test:rls`, which doesn't exist until S1.7, so it is red on every push until then.
- **Spec review L4:** the `node:22.23.3` digest and the osv-scanner checksum pins are in `scripts/lib/clean-clone.mjs` and `ci.yml`, not in spec §4. Fix the spec text.
- **Spec review L6:** the candidate CSP has no staging edge origin yet (H4). Make `check-headers` require it once H4 is answered.
- **Security review, still open:**
  - the deploy-staging install/build denylist (fix before S3);
  - `if:` inside composite actions used by required jobs;
  - required jobs that call a reusable workflow.
- **Pre-commit gitleaks** flags literal `sb_secret_` + 20 key characters, so tests must build such keys at runtime.
- Never re-enable `.git/hooks/post-commit.disabled`; never move `cp/*` tags.

## Verify first (next session runs these before any change)
git log --oneline -8 claude/trace-autopilot-continue-8d4785 · git status · git log -1 milestone/m0a · pnpm verify:fast · pnpm exec vitest run --root scripts
