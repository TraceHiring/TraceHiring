COMMON RULES FOR EVERY TRACE WRITER (read first; they win over anything else in this brief)

Setup (in your own git worktree; you start on some other commit):
1. `git status` must be clean. Create your stream branch: `git switch -c <BRANCH>` (if it exists: `git switch <BRANCH>` and confirm `git log --oneline -3` shows no commits of its own beyond the base), then `git reset --hard <BASE>` and confirm `git log -1 --format=%H` starts with <BASE>.
2. `pnpm install --frozen-lockfile` (the git hooks and tests need node_modules). Never change package.json files or the lockfile.
3. Read in full: `CLAUDE.md` (product rules 1-9 and engineering rules), the spec sections your brief names in `specs/m1-test-authoring.md` (revision 5; the §1.6-§1.8 binding rows win over §3-§13 text), and the module README / neighbouring code you extend.

Scope:
- Change ONLY files inside the directories your brief lists. Everything else is lead-owned (supabase/**, packages/shared/**, packages/db-types/**, root package.json + lockfile, scripts/**, e2e/**, CI workflows, **/wrangler.*, **/worker-configuration.d.ts, services/api/src/{app.ts,org-cors.ts,route-inventory.test.ts,log-hygiene.test.ts,index.ts}, workers/jobs/src/{index.ts,app.ts}, workers/jobs/src/queue/{wiring,env,stage-db}.ts, workers/edge/src/{app,index}.ts, packages/vendors/src/index.ts, apps/**). If you need a lead-owned change (a contract field, a migration, a mount, an env binding, a route-inventory row), do NOT make it: work around it with an injected dependency/interface in your own directories and list it under "Lead asks" in your report with the exact change.
- Modules export factories (routes or consumers) taking injected dependencies; the lead mounts them at merge. Do not edit mount files.

Method (tests first, always):
- First commit: the failing tests (`test(<scope>): …`), run them and record how many are red. Then implement until green; commit at every green step (`feat(<scope>): …` / `fix(<scope>): …`).
- Commits: conventional, lowercase subject ≤ 100 chars, body lines ≤ 100 chars, message via `git commit -F <a uniquely named file outside the repo, e.g. in your temp dir>`. End each message with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `--no-verify`; the pre-commit hook runs gitleaks and prettier (run `npx prettier --write <files>` before committing). No secret-shaped literals (build test keys at run time), no PII: synthetic data only (`[synthetic]` text, example.test addresses).
- Run ONLY your own package's checks, one at a time (this machine is short of RAM): e.g. `pnpm --filter <pkg> exec vitest run <files>`, then the package's whole `vitest run` once at the end, `pnpm --filter <pkg> typecheck`, `pnpm --filter <pkg> lint`. Never run workspace-wide tests, `pnpm verify`, `pnpm verify:fast`, `supabase start/stop`, `db reset`, `pnpm test:rls`, `gen types`. Database probes: only rolled-back psql `docker exec -i supabase_db_trace psql -U postgres -X -q -At -v ON_ERROR_STOP=1` inside `begin; … rollback;`, unless your brief allows a db-test file.
- Never push, never touch other branches or worktrees, never force anything, never read `.env*` files.
- No guessing: if the spec is ambiguous on anything touching rules 1-9, do not decide it: leave that part out, keep the safe D1 behaviour, and list it under "Questions". Other ambiguity: pick the option most consistent with the spec, and list it under "Choices".

Final report (under 600 words): branch and final SHA, red-test count at the red commit, test/typecheck/lint results with counts, what was built (per spec item / AT id), "Lead asks" (exact), "Choices", "Questions", and anything not done.
