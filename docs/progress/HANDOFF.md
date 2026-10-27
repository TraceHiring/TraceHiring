# HANDOFF — 2026-10-27 12:55 IST (M2 BUILD 1 Wave 0a done and green; next chat: Wave 0b on m2/integration)
Reason for stopping: Wave 0a is done (spec §11.2 allows the 0a/0b split at the migration boundary); context ~55%, so
Wave 0b (a second large migration plus wiring) starts in a fresh chat. Max account; 5-hour window ~10% at stop (reset
16:40 IST), weekly ~70%. Start from `docs/progress/RESUME-PROMPT.md` §4 on **`m1/integration`** (worktree
`.claude/worktrees/m1-integration`); M2 work lives on **`m2/integration`** (worktree `.claude/worktrees/m2-integration`).
The repo wins.

## Paused: D1 (founder, 2026-10-22: paused, not closed)
D1's remaining steps belong to a D1 chat on `d1/integration` (worktree `.claude/worktrees/d1-integration`). Nothing is committed to `d1/integration` or `main` from M1 or M2. Copied from the `d1/integration` HANDOFF (`3c2e42a`, tip `1547fd0`):
- **Next step 1.** Workers Paid answered (2026-10-22 21:20): "not yet"; OPEN-8a stays a founder gate and D1 can close without it. Remaining founder item: **AT-D2 capture**. For it: dispatch staging from `d1/integration` with `run_e2e=true` on the final tip (re-checks AT-D1/AT-D17 after `1d36151`), then the founder runs `pnpm e2e:record` (spec 4p §7.3) with an OS-level screen capture; record file name, SHA-256, `recordedMs`, run id.
- **Next step 2.** Then `docs/milestones/D1-summary.md`, tag the next free `cp/d1-*` number (after `cp/d1-11`, `cp/d1-10`) on the verified tip, and **D1 CLOSE by PR to `main`** only with the founder's go-ahead (AUTOPILOT §2, §6). At the merge the founder adds `e2e-local` back to ruleset 25633431's required checks.
- **Staging re-run already done on the final tip (reuse it):** dispatch **39820502191** on `1547fd0` (run_e2e=true): all 7 jobs **success**; artifact `e2e-staging-results`: spec `d1-slice`, 55/55 steps ok, `durationMs` 304726, `recordedMs` 295068 (`record: false`), **AT-D17 `time_to_ready_ms`: A 46307, B 30833, C 69999, D 19441** (max 70.0 s, inside the 90 s gate; the 30 s target is the M5-owned deviation). If `d1/integration` is still `1547fd0`, only the AT-D2 capture (record mode) remains.
- **D1 founder items:** AT-D2 screen capture (`pnpm e2e:record`); Workers Paid (OPEN-8a) "not yet", decide before any load test (M3a); Dependabot PRs #7-#12 not merged blind; after D1 merges, `e2e-local` back on the required checks.

## Where we are (verified this chat)
- **M1 · Test authoring:** FIX done → **CLOSE founder-gated** (D1 CLOSE + go-ahead). `m1/integration` = this handoff
  commit on `9a96929` (no M1 code changed this chat). CI stays on draft PR TraceHiring/TraceHiring#14.
- **M2 · Scheduling & invites: BUILD 1 = Wave 0, part 0a done.** `m2/integration` tip **`2d5d98a`** on trace.
  Draft CI PR **TraceHiring/TraceHiring#16** (`m2/integration → main`, **never merge**, opened this chat).
- Verify-first at chat start: m1 `9a96929` = trace, m2 `7b73de0` = trace, d1 `1547fd0`, main `da5380d`, both trees
  clean, `pnpm -s verify:fast` exit 0 (287 s), docker `supabase_db_trace` healthy.
- Local serial gate on `4979752` (all green): `pnpm -r --workspace-concurrency=1 typecheck` 0, `pnpm lint` 0,
  `pnpm -r --workspace-concurrency=1 test` 0, `vitest run --root scripts --maxWorkers=1` 2832 passed, `pnpm test:rls` 0
  (61 files, catalog 153, rls 4249, db-types current), `pnpm -r --workspace-concurrency=1 build` 0. `2d5d98a` adds docs only.
- **Linux CI on #16:** at handoff the run on `4979752` showed 2 passing, 2 pending, 0 failing (not final); a second run
  started for `2d5d98a`. **Unknown whether green** — check first (Next step 1).

## Done this chat (all on `m2/integration`)
| Commit | What |
| --- | --- |
| `981ae4f` | Red pgTAP first: `docs/progress/m2-wave0-drafts/pgtap/{gen.mjs,run.mjs,preamble.sql,bodies/}` (copied from M1, M2 fixtures added) → `supabase/tests/rls_m2_{keys,candidates,contacts,drives,slots,invitations,uploads,reschedule,candidate_denied}.test.sql`; R5-8/R5-41 expected-value extensions in `rls_roles` (plan 70), `rls_d1_api:405`, `rls_d1_invariants` |
| `f938032` | Migration **M2-a** `supabase/migrations/20261027040000_m2_contacts.sql`: role `trace_messaging_worker`, `org_keys`, `candidates`, `candidate_contacts` |
| `2bbcb67` | Migration **M2-b** `20261027050000_m2_drives.sql` (drives, slots, uploads, invitations widened + `session_grant_exp` backfill/CHECK, re-derived `invitations_label/guard/audit`, booking, `reschedule_events`, `ingest_invite_batch`, `reschedule_invitation`, `self_reschedule`, `invitation_window`, `invitation_recipient_ct`, `portal_slots`, widened `resolve_invitation_by_hash`); **MT-15** + 2 fixtures; floors catalog 153, rls 4249; `rls_d1_age:347` now expects exactly `invitations.phone_bidx`; db-types regenerated |
| `4979752` | `packages/db-types/src/index.test.ts` (M2 tables, 2 RPCs, 2 enums); `scripts/test/staging-catalog-checks.test.mjs` (19 checks) |
| `2d5d98a` | ADR-034 (`aws4fetch` 1.0.20, MIT), ADR-030 amendment 1, ADR README rows, build-notes "Autopilot changes" row |

## Decisions made this chat (lead, AUTOPILOT §4; recorded in the M2-b header and build-notes 2026-10-27)
- `invite_uploads.rows_refused` replaces spec §3.2's `rows_rejected` (D1 invariant I-2 and I-M2-8 ban any `%reject%` column).
- `invitations.upload_row_no` (+ unique with `upload_id`) makes ingest replay idempotent per row (R3-4) without blind-index reads (R3-9).
- `private.portal_slots(p_org, p_invitation)` (trace_api) serves the portal slot list, booleans only (R5-24, rule 5).
- `ingest_invite_batch` row contract: `{rowNo, reason}` for api-decided refusals, else `{rowNo, fullNameCt, fingerprint,
  keyVersion, emailCt, emailBidx, emailHint, phoneCt?, phoneBidx?, phoneHint?, adult: true|null, slotStartsAt|null,
  language, linkTokenHash, confirmPhoneDuplicate}`; returns `[{rowNo, invitationId} | {rowNo, reason, held}]`. B2 builds
  `services/api` against this (record it in `contracts-m2.ts` in 0b).
- Staff SELECT on invitations gains `drive_id, upload_id, upload_row_no` only; trace_api gains SELECT `drive_id, slot_id,
  session_grant_exp`, UPDATE `session_grant_exp`.

## In flight at handoff
- **No agent is running. No uncommitted work** in `m1-integration` or `m2-integration`. `.claude/allow-red` removed.
- Linux CI runs on PR #16 for `4979752` and `2d5d98a` (results unknown at handoff).
- Unmerged CI-only branches (do not merge): `m1/e2e-specs-2` `b54091e`, `-3` `1dc427e`, `-4` `62215c1`.

## Stream branches
M1 merged (do not delete): `m1/a1-packages` · `m1/a5a-fix-1` · `m1/a5b-fix-1` · `m1/a5c-fix-1` · `m1/a4-edge-delivery` · `m1/a4-fix-1` · `m1/a3a-jobs-v2` · `m1/a3a-fix-1` · `m1/a3a-fix-2` · `m1/a3b-jobs-authoring` · `m1/a3b-fix-1` · `m1/a2b-api-tests` · `m1/a2b-fix-1` · `m1/a2a-api-bank` · `m1/a2a-fix-1` · `m1/a2a-fix-1-r2` · `m1/a7-candidate` `b89e2ea` · `m1/a7-fix-1` `91d91be` · `m1/a5d-wizard` `2489db3` · `m1/a5d-fix-1` `07a21d9` · `m1/a5d-fix-2` `abe6064` · `m1/e2e-specs` `cf90491` · `m1/e2e-specs-fix-1` `57973f1` · `m1/a8-templates-rpc` `701df43` · `m1/a8-fix-1` `88557c1` · `m1/a9-bank-rpc` `a585f41` (all on `trace`). Unmerged by founder answer (b): `m1/a5a-fix-2/-3/-4` (zip reader, M8). **M2: no stream branch yet** (`m2/integration` only).

## Next step (one precise action list)
1. Verify first (below). Read CI on PR #16 (`ccd_pr get_status` or `gh pr checks 16`); fix any Linux failure first
   (AUTOPILOT §6), test first.
2. **M2 BUILD 1, Wave 0b on `m2/integration`** (lead only, spec §11.2 remainder): red pgTAP body `rls_m2_messages` (+
   extend `rls_m2_candidate_denied` lists, `rls_roles` messaging-worker table list and EXECUTE set per R5-8/R5-45/R5-47)
   in `docs/progress/m2-wave0-drafts/pgtap/`, then migration **M2-c** `<ts>_m2_messaging.sql` after `20261027050000`
   (message_templates + EN seed with `{{equipment_note}}`, outbound_messages, message_events, message_events_unmatched,
   plan_messages trigger on `UPDATE OF slot_id, status` + insert, claim_due_messages, close_due_drives,
   purge_unmatched_events, rotate_link_for_send, record_send, record_message_event, message_template, drive_invitations;
   worker SELECT on candidates/contacts ciphertext for claimed rows; the guard's messaging-worker branch already exists
   in M2-b); AT-M2-02/05/20/26/35 cases; two-connection last-seat race (AT-M2-08) in `scripts/test-concurrency-local.mjs`.
   Then `contracts-m2.ts` (`./contracts/m2`) + candidate contract changes (R5-23, R5-57, R5-66 c) with contract tests;
   wiring R5-9 (LOGIN_ROLES, HYPERDRIVE_PLAN + PENDING, staging-worker-secrets, check-deploy-vars,
   test-staging-roles-local, jobs wrangler/env/stage-db, cron `messaging_claim`, queue `trace-messages-<env>` + DLQ);
   R5-27 secrets lists + D1 spec 4r row; R5-36 pii-crypto boundaries + module README; `KeyManager` in
   `VENDOR_INTERFACES`; R5-28 `e2e-m2-bulk` job + `e2e-local.mjs --test-scheduled` (tests first) + DC-M2-6; R5-37 route
   inventory; DC-M2-3…5 measured locally and recorded in spec §8; then the Wave 1 pre-flight agent. Full serial verify,
   CI green on #16.
3. **M1 CLOSE is founder-gated** (D1 CLOSE + go-ahead): then merge `main` into `m1/integration`, re-timestamp M1
   migrations (M1-a … M1-v), re-derive the seven replaced guards, full verify, `docs/milestones/M1-summary.md` §9,
   CLOSE PR, tag `m1-reviewed`. Do not start it before both gates.
4. Dependency bumps owed (M2 R5-33): vitest 4.1.12 + undici 7.30.1 on/after 2026-10-29; fast-uri 3.1.9 on/after
   2026-11-02; happy-dom 21.x before 2026-11-23; lead commits on `m1/integration`, then `chore: merge m1/integration`
   into `m2/integration`; delete the matching osv ignores.
5. Staging-only checks need a founder-approved staging dispatch: M1 (A2b Low 2 R2 `onlyIf`, DC-M1-1/5/6 staging halves,
   AT-M1-10 on staging, largest from-template call under 8 s); M2 (AT-M2-12, DC-M2-1/2, DC-M2-3/5 staging halves).

## Founder items
- Unchanged M1 items: coverage when tab focus is off (default a); D1 integrity job re-delivered after M1 (default a); M1-15 "shared-device" copy (default: leave out); import cancel keeps rows (default a); M1 staging Hyperdrive configs + secrets; Q-M1-1…Q-M1-4; OPEN-8a Workers Paid; written AI drafts; zip reader answered (b).
- M2 (rows on `m2/integration`'s `docs/progress/FOUNDER-QUEUE.md`): Q-M2-1…Q-M2-4 (Q-M2-4 Excel invite files; default CSV only); F-2…F-5 (F-5 SES production access can be requested now, not blocking) + the `jobs_messaging_login` Hyperdrive config. No new founder item this chat.

## Gotchas
- Worktree guard: no `cd …&&`, `git -C`, `$(...)`, `xargs`, loops, compound or piped node-script commands; write scripts with the Write tool (scratchpad) and run them plainly; commit messages via `git commit -F <unique file>`; merges `chore: merge …`. A session isolated in one worktree cannot write another: use EnterWorktree to switch.
- `node scripts/db-types.mjs` and `pnpm test:rls` RESET the local database: never while a writer or reviewer runs db-tests or psql probes. `pnpm exec supabase migration up --local` applies a new migration without a reset; quick grant deltas: `docker cp` + `MSYS_NO_PATHCONV=1 docker exec supabase_db_trace psql -U postgres -X -q -v ON_ERROR_STOP=1 -f /tmp/x.sql`, then put the same change in the migration file.
- M2 pgTAP: edit `docs/progress/m2-wave0-drafts/pgtap/{preamble.sql,bodies/*.sql}` and run `node docs/progress/m2-wave0-drafts/pgtap/run.mjs <names>` (regenerates and runs); never hand-edit `rls_m2_*.test.sql`. Assertions that read a table must run as a persona that can (use `pg_temp.op()`); trace_api cannot read slots.
- `invitations_guard` (M2-b) computes the changed-column set once (`v_changed`); new columns must be added to its immutable list or a role branch. `invitations_guard` identifies callers only by `current_setting('role')`; never design a "trusted caller" GUC (R5-42).
- An append-only table referenced by an FK needs `grant update (id) … to postgres` (consents / reschedule_events).
- **RAM:** run the gate serially: `pnpm -r --workspace-concurrency=1 typecheck`, `pnpm lint`, `pnpm -r --workspace-concurrency=1 test`, `pnpm exec vitest run --root scripts --maxWorkers=1`, `pnpm test:rls`, `pnpm -r --workspace-concurrency=1 build`.
- e2e-local dispatch from an `m1/**` or `m2/**` branch runs no staging job (deploy-staging needs `main`, `d1/**` or `milestone/**`).

## Verify first
`git fetch trace` · `git log --oneline -3 m1/integration` · `git rev-parse --short trace/m2/integration` (`2d5d98a`) · `git status` (both worktrees) · `git rev-parse --short trace/d1/integration` (`1547fd0`) · `git rev-parse --short trace/main` (`da5380d`) · `pnpm -s verify:fast` · `docker ps` (supabase_db_trace up) · CI on PR #16
