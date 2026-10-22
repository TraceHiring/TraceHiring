# M1 Wave 0 working drafts (lead only; not applied, not run by CI)

Wave 0 split at the migration boundary (spec `specs/m1-test-authoring.md` §11.4). Part 1 placed migration M1-a
(`supabase/migrations/20261023010000_m1_bank.sql`) with `rls_m1_bank`, `rls_m1_keys`, `rls_m1_variants`, `rls_m1_pools`.

- `m1b_tests.sql.draft`: the M1-b migration draft (jobs, role templates, sections and test_versions widened, publish
  guard v2 and the snapshot, the settings catalog, presets, admin locks, ruleset settings and derivation, session_items
  v2 with the serving gate and exposure trigger, `assert_drive_pool_ratio`, the R5-5 flags guard, library reference,
  seeds). It applied cleanly on the local stack on top of M1-a. It has NO pgTAP yet: write `rls_m1_snapshot`,
  `rls_m1_publish_v2`, `rls_m1_serving`, `rls_m1_settings`, `rls_m1_templates_jobs`, `rls_m1_carried` and extend
  `rls_m1_candidate_denied` red first, then place it as `supabase/migrations/<ts>_m1_tests.sql` (provisional ts, R5-30).
- `pgtap/`: `preamble.sql` (helpers `try`, `keys`, `id`, personas `u()`, workers `w()`, `api()`, operator `op()`, fixture
  `bank()`), `gen.mjs` (assembles `supabase/tests/<name>.test.sql` from `bodies/<name>.sql` with the plan counted),
  `run.mjs` (regenerate and run named files with `supabase test db --local`; edit its `repo` path). `bodies/` holds the
  sources of the four placed files: edit a body, regenerate, never hand-edit the generated `.test.sql`.
