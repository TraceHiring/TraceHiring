# HANDOFF — 2026-10-11 08:15 IST
Reason for stopping: usage guard (the founder allowed work up to ~93%; stopped at 86-87% of the 5-hour window, Pro plan, resets about 12:20 IST). After the 08:15 handoff the lead fixed S1.4 re-review N1, N2, N3, N4 and N7 (see Next step 1).

## Where we are
- Milestone **M0a**: toolchain, pipeline and skeleton. **Phase: BUILD.** S1.0–S1.6 are built. **S1.7** is in progress: the shared logger is built (its follow-ups are on a stream branch), and the database half is about half done.
- **Integration branch: `claude/trace-autopilot-production-87e5e2`** (this worktree, `.claude/worktrees/trace-autopilot-production-87e5e2`). It was cut from `da5c5ca`, the last production commit of the old integration branch. The old branch `claude/trace-autopilot-continue-8d4785` ends in a demo WIP commit (`6f53926`) and is **no longer used for production**; the demo lives on `demo/d1-prototype`.
- `milestone/m0a` has **not moved** (`adbbb61`). Its worktree is `.claude/worktrees/milestone-m0-spec-e4db77` and is clean. It moves only after the reviewers pass (Next step 4).
- HEAD before this handoff: `10addbe` docs(specs): revision 11 of the M0a spec. `pnpm verify:fast` exit 0 at 08:05 (55 s). The full `pnpm verify` was last green on `0d8b511` (04:07). No new `cp/*` tag; the last is `cp/m0a-01`.
- Spec `specs/m0-foundations.md` is at **revision 11** (`10addbe`).

## Done this session (verified)
- **Repo check:** the parallel session never ran (no `m0a/s17-redactor` on `trace`). Toolchain: Node 22.23.3, pnpm 12.11.2, Docker 29.5.2, gitleaks 8.30.1.
- **S1.4 security re-review** (fresh `security-reviewer`): **BLOCK**. Two new Mediums: N1, a required job may `needs:` a non-required job; N2, expression mapping keys are never scanned. Lows N3, N4, N5 and N7 are also open; N6 is fixed in spec rev 11. Report: `docs/reviews/M0a-S1.4-security-rereview.md` (in `cf8626d`).
- **S1.7 foundation, `cf8626d`:**
  - `supabase/config.toml` (`project_id = "trace"`, Studio off);
  - baseline migration `supabase/migrations/20261011015904_m0a_baseline.sql`, verbatim from §8.2;
  - `seed.sql`;
  - `supabase/catalog-checks/manifest.json` (16 IDs, 51 branches) and `README.md` (check/fixture rules and day-one facts);
  - floors: `catalog-min-count` 71, `rls-min-count` 0;
  - `supabase/tests/catalog_probe.test.sql` (MT-4b). Its 4 assertions passed via `supabase test db`, and all 4 failed under a mutation;
  - `MT-8b.sql` plus its fixture, as the reference check.
- **`packages/db-types`, `905be8f`:** `database.ts` is the byte-exact CLI output. `index.ts` and 2 tests are green; typecheck and lint pass.
- **Day-one checks:** all done and recorded in spec rev 11 and the catalog README. pgTAP works for the test roles with no fallback, no MT-11 branch is unreachable, and `supabase test db --debug` gives per-assertion TAP.

## Stream branches (each in `.claude/worktrees/agent-<id>`, all clean, none merged; pushed to `trace` as a backup at 08:40, since a worktree may be cleaned up when its session is archived)
| Stream | Branch @ tip | Base | State |
| --- | --- | --- | --- |
| W1 redactor follow-ups | `worktree-agent-ae15fb7cd05478040` @ `bcb6d54` | da5c5ca | **DONE.** All 9 items, test-first; shared tests 187 → 306; the worker's full `pnpm verify` exit 0. **Needs its security-reviewer before merge.** Timing risk: two shapes took 107 ms once under heavy machine load (limit 50 ms); six reruns were clean. |
| W3a catalog checks | `worktree-agent-a66ca65381173c087` @ `37adfd9` | cf8626d | **DONE.** MT-1, 2, 3, 4, 6, 7, 8, 9 with 25 fixtures; runner 33/33 ok; no cross-branch firing; clean with pgTAP present. |
| W2 harness scripts | `worktree-agent-a9e0bdcc6c2fbd966` @ `8c5ef5f` | cf8626d | **PARTIAL.** `scripts/gen-catalog-tests.mjs` + 93 tests done (`0d35d0b`); real pg_prove/gen-types fixtures in `scripts/test/fixtures/rls/`. **Not started:** `scripts/test-rls.mjs`, `scripts/db-types.mjs` and their tests. `pnpm lint`/`verify` not run there. |
| W3b catalog checks | `worktree-agent-a4f4047327f9e48e5` @ `f8da8a4` | cf8626d | **PARTIAL.** MT-5a with 3 fixtures (runner green). **Missing:** MT-5b, 5c, 5d, 10, 11, 12 (22 fixtures); MT-5a's pgTAP-present run and its edge cases. |

## In progress (exact)
- **Dev runner:** `docs/progress/tools/catalog-run.mjs`. Run it from a checkout root: `node docs/progress/tools/catalog-run.mjs . MT-5b …`. It runs each check and fixture in rolled-back transactions against container `supabase_db_trace`, the same way the generated pgTAP file does.
- **Pending test:** `docs/progress/tools/root-scripts.test.mjs.pending` becomes `scripts/test/root-scripts.test.mjs` (§5). It goes in at wiring time; it is red until W2's scripts exist and the root `package.json` is wired.
- The local Supabase stack (`trace`) is running, with the baseline migration applied. Failing tests: none on the integration branch.

## Next step (in order; one writer per item, max 3 writers, watch usage)
1. **Resume streams on their own branches**, each in its existing worktree:
   - **W3b:** write MT-5b, 5c, 5d, 10, 11 and 12 per README and §8.5. Its settled design: MT-11 treats only the deparsed `( SELECT auth.uid() AS …)` / `auth.jwt()` form as wrapped. MT-5c counts relation, column, function, schema and per-schema default ACLs, and expands PUBLIC. MT-5b's BEGIN ATOMIC fixture contains `;`. Then run the runner for all 7 IDs.
   - **W2:** write `test-rls.mjs` (§8.3, revision 11 steps), then `db-types.mjs`, with stubbed tests. Its design: async `run` stub; injected lock dir, clock, sleep and pid-alive check; `parseFloor` from gen-catalog-tests.
   - **S1.4 re-review fixes:** N1, N2 (both Medium), N3, N4 and N7 were **fixed by the lead after this handoff** (`5c96e9f`, `0c29585`, `751ca41`, `99d0b5a`, `271018d`; scripts suite 464/464; Resolution table in the re-review report). Left: **N5** (Low, `scan-dist.mjs`), then a fresh `security-reviewer` on `git diff 6fadb17..271018d -- scripts`.
2. **Run the reviews:** `security-reviewer` on W1's diff (`git diff da5c5ca..bcb6d54 -- packages/shared`), and `database-reviewer` on W3a + W3b + `cf8626d`.
3. **Lead integration** on the integration branch, merging each with `git merge --no-ff`:
   - merge W1, W3a, W3b, W2 and W4;
   - `node scripts/gen-catalog-tests.mjs` to write `catalog_meta.test.sql`;
   - wire the root `package.json`: `test:rls`, `db:types`, `gen-catalog-tests --check` in `lint`, `pnpm test:rls` in `verify`;
   - add `root-scripts.test.mjs`;
   - run `pnpm test:rls` for real (it should give catalog 71 ≥ 71), then the full `pnpm verify`.
4. **Gate:** `spec-reviewer` on the S1.7 diff. Then fast-forward `milestone/m0a` from its worktree with `git merge --ff-only claude/trace-autopilot-production-87e5e2`, and tag `cp/m0a-02` (S1.4–S1.6, reviewed) and `cp/m0a-03` (S1.7).
5. Then **S2 ∥ S3** (spec §14), each a stream cut from `milestone/m0a`.

## Decisions made this session
- **Production integration moves** to `claude/trace-autopilot-production-87e5e2`, from `da5c5ca`. Recorded in spec rev 11.
- **Catalog checks return `(branch, object, detail)`**, and every positive control filters on its own branch. This is stricter than rev 10; recorded in spec rev 11 §8.5.
- **`test-rls` uses `supabase test db --debug`**, fails on a test file that isn't `catalog_*`/`rls_*`, and fails when the file count differs from the `.sql` files under `supabase/tests/`. Recorded in spec rev 11 §8.3.
- **Decisions inside the streams:**
  - MT-2: a stale exemption entry is reported under `missing_org_id`.
  - MT-4: `anon_column` fires only when there is no table-level privilege.
  - MT-6: the `domain_column` > `array_column` > `direct_column` order.
  - MT-8: `schema_missing` uses a rename.
  - gen-catalog-tests rejects a BOM, a stray backslash, and a fixture whose last statement has no `;`.
  - The redactor walks arrays with an index loop instead of `slice.call` (species-safe), and exports `isStackFrame`/`stackFrames`.

## Open questions for the founder (unchanged; docs/progress/FOUNDER-QUEUE.md)
- **URGENT, from before:** revoke the Cloudflare token that was pasted as a secret *name*, and set `CLOUDFLARE_API_TOKEN` and `SUPABASE_STAGING_DB_URL`. Blocking: any Cloudflare deploy (S3 runs only).
- The `workers.dev` subdomain (H4); what "D1" means; branch protection vs the session-end push. None of these blocks S1.7.

## Gotchas / do not touch
- **Harness worktrees** (`isolation: worktree`) are created at **`main`**, not at the integration branch. Tell every writer to `git reset --hard <integration sha>` first; W1–W3 did.
- **Usage:** 4–5 parallel agents burned about 75% of a Pro 5-hour window in about 35 minutes. Plan 2–3 writers per window, and keep about 15% for the handoff.
- **Shared local stack:** only the lead runs `supabase start`/`db reset`/`test db`; writers use rolled-back psql transactions only.
- **Windows:** never pipe `supabase`/`docker` output into `head` (it hangs); write to a file instead.
- **commitlint** rejects a subject that starts with a capital letter, e.g. "S1.7 …" or "M0a …".
- **Pre-commit gitleaks** blocks a literal `sb_secret_` key; build such keys at run time in tests.
- **CI `rls` job** is red until `test:rls` exists (spec review L2).
- Never re-enable `.git/hooks/post-commit.disabled`; never move `cp/*` tags.

## New session or new account
Use the prompt in `docs/progress/RESUME-PROMPT.md` (it handles a fresh worktree created from `main`).

## Verify first (the next session runs these before any change)
git log --oneline -5 claude/trace-autopilot-production-87e5e2 · git status · `git log -1 --format=%h` on each stream branch above · docker ps (supabase_db_trace up?) · pnpm -s verify:fast · node docs/progress/tools/catalog-run.mjs <W3a worktree> MT-1 MT-9
