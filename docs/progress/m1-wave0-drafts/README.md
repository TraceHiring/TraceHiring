# M1 Wave 0 working drafts (lead only; not applied, not run by CI)

Wave 0 split at the migration boundary (spec `specs/m1-test-authoring.md` §11.4). Part 1 placed migration M1-a
(`supabase/migrations/20261023010000_m1_bank.sql`) with `rls_m1_bank`, `rls_m1_keys`, `rls_m1_variants`, `rls_m1_pools`.

- Part 2 placed M1-b (`supabase/migrations/20261023020000_m1_tests.sql`) with `rls_m1_snapshot`, `rls_m1_publish_v2`,
  `rls_m1_serving`, `rls_m1_settings`, `rls_m1_templates_jobs`, `rls_m1_carried`, `rls_m1_candidate_denied`; its draft
  is removed (the migration is the source).
- `pgtap/`: `preamble.sql` (helpers `try`, `keys`, `id`, personas `u()`, workers `w()`, `api()`, operator `op()`, fixture
  `bank()`), `gen.mjs` (assembles `supabase/tests/<name>.test.sql` from `bodies/<name>.sql` with the plan counted),
  `run.mjs` (regenerate and run named files with `supabase test db --local`; the repo path defaults to the
  m1-integration worktree, override with `TRACE_REPO`). `bodies/` holds the
  sources of the four placed files: edit a body, regenerate, never hand-edit the generated `.test.sql`.
