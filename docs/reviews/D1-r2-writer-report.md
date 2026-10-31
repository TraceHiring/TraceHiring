# D1 stream R2 (jobs: mirror, quality, integrity, sweep): writer report

- Branch `d1/r2-jobs`, cut from `42fd3e2` (d1/integration with the lead's prep). Writer: Opus 5.5, 2026-10-19.
- Spec: `specs/d1-demo-slice.md` revision 4e, §5.1-§5.4, §3.2-§3.4, §9 (AT-D3, D5, D6, D14, D15, D16, D27), §11.
- No lead-only file was edited (no `package.json`, lockfile, migration, `supabase/**`, `packages/**`, `scripts/**`,
  `.github/**`, `wrangler.jsonc`, `workers/jobs/src/{index.ts,app.ts,queue/**}`, tsconfig).

## 1. Files

| Path (`workers/jobs/`) | What |
| --- | --- |
| `src/mirror/handler.ts` | `runMirror(message, { tx, evidence })`, trace_worker |
| `src/mirror/evidence.ts` | final.json read + SHA-256 check + parse; start photo `head` check (C1b binding) |
| `src/mirror/writes.ts` | the mirror's constant SQL |
| `src/mirror/pipeline.ts` | `createStages({ db: StageDb, evidence, grader })` and `deliverViaService(body, consumerDeps)` |
| `src/quality/{handler,score,mcq,written,store}.ts` | `runQuality(message, { tx, grader })`, trace_quality_worker |
| `src/integrity/{handler,load,band-call,store}.ts` | `runIntegrity(message, { tx, evidence })`, trace_integrity_worker |
| `src/sweep/pending.ts` | `sweepPending(tx, limit)` over `private.sweep_pending`, trace_worker; reuses `PendingStage`/`runSweep` |
| `src/{mirror,quality,integrity}/fake-db.test-helpers.ts` | per-side fake `SqlTx` keyed on each store's SQL constants (guards modelled) |
| `src/{mirror,quality,integrity}/world.test-helpers.ts` | synthetic fixtures; `MemoryEvidence` (in integrity, re-used by neutral tests) |
| `src/quality/score.test.ts`, `src/quality/handler.test.ts` | AT-D15, AT-D3, AT-D16 |
| `src/integrity/handler.test.ts`, `src/integrity/load.test.ts` | AT-D5, AT-D6, AT-D14, AT-D16 (incl. two-stream gseq case) |
| `src/mirror/handler.test.ts`, `src/mirror/pipeline.test.ts` | mirror + C1b residuals, AT-D16, AT-D27 |
| `src/sweep/sweep.test.ts` | AT-D16 sweep case |
| `db-test/harness.ts`, `db-test/fixtures.ts` | real-DB harness (postgres driver, ADR-031) and synthetic seeding |
| `db-test/stages.db.test.ts` | the stages against the real schema, grants, RLS, guards (11 tests) |
| `db-test/memory.db.test.ts` | C1b note 4 memory measurement (3 tests) |
| `vitest.db.config.ts` | Node config for `db-test/**/*.db.test.ts` |

Rule-1 walls: `quality/**` imports only its own files, `@trace/shared*`, `@trace/vendors`; `integrity/**` only its own
files, `@trace/shared*`, `@trace/band-engine` (asserted by `integrity/load.test.ts` from the sources, and by
`node scripts/check-boundaries.mjs` OK and `packages/config/test/rule1-separation.test.ts` 47/47). Neutral code
(`mirror/`, `sweep/`, `db-test/`) never imports `@trace/band-engine` (the rule table for neutral tests comes through
`integrity/world.test-helpers.ts`).

## 2. Decisions (with spec refs)

1. **The mirror writes the rows itself instead of calling `private.mirror_session`** (§5.1 table, §3.4). The carried C1b
   binding says the `media_objects` row is written only when the canonical `start_photo.jpg` exists with the mirrored
   sha256; when that check fails the message still names a photo, and `mirror_session` refuses a message with neither a
   photo nor a skip reason (22023), so it cannot express "photo named but not verified". `writes.ts` follows
   `mirror_session`'s order exactly: lock the invitation `FOR UPDATE` (serialises n-7) -> `session_mirror` key present:
   stop (duplicate) -> `revoked|expired|blocked_age`: `mirror_dead_invitation` (R-14) -> invitation's `session_id` must be
   the message's -> consent row for `(consentId, invitationId, rulesetVersionId)` must exist -> both adult answers
   (rule 9) -> sessions, session_items, responses, media (verified only), reports (both card ids null), invitation
   `submitted` (after the sessions row, L-35), key (`expires_at` = submittedAt + 90 days, as `mirror_session`). Every
   insert is ON CONFLICT DO NOTHING + re-read. `mirror_session` stays in the schema unused by the job (see request R6).
2. The photo row additionally requires the message's `photo.key` to be the canonical key and the object's size to equal
   `photo.bytes` (fail closed). Residuals (a) missing object and (b) other sha256 are tested in unit and DB tests.
3. `final.json`: canonical key only, <= 8 MiB, SHA-256 of the bytes = `finalSha256`, strict `FinalAnswers` parse,
   `sessionId` equal, and each answer's own sha256 re-checked. An answer at an unserved position is malformed. A cleared
   MCQ choice (`choice: null`) stores no response (the `responses` CHECK has no null-choice row): it is unanswered.
4. **Integrity `photoMissing`** (R-11) = message photo null, or the same canonical-key/sha256/size `head` check fails
   (fail closed; only lowers coverage, P10). Integrity cannot read `media_objects` (no grant), so it repeats the check.
5. Quality (§5.4): every item of the pinned version counts (never served = 0); MCQ exact key; written empty means
   `trim() === ''` (grader not called). Grader runs are stored for grader calls only (`grader_kind 'llm'`); MCQ scores are
   not stored as grader runs. `grader_model_id`/`grader_adapter_version` are the grader's (a mix of models is refused);
   with no grader call at all they are `'none'`. `raw_score` = totalPercent/100 (4 dp); `criteria` = `[{id, points, max}]`.
6. `rubric_set_sha256` (n-4) = SHA-256 of `canonicalJson` (from `@trace/shared/canonical-json`) of the stored
   `content_sha256` of the **distinct rubric versions of the pinned version's written items**, sorted ascending (read as
   "used by the scoring", independent of which answers were given). `rubric_version_ids` = the same ids, sorted.
7. Weights: `sections.weight` text must be an integer 1..100 (`'2.00'` -> 2, `'1.50'` refused `quality_bad_weight`).
8. Rubric criteria are read in the api's stored shape `{id, label, max_points, anchors: string[], min_hits}`
   (`services/api/src/modules/tests/authoring.ts`). The org's **seeded default rubric** (`anchors` as an object, no
   `min_hits`, migration 3 `seed_org`) is not gradable and fails closed `quality_bad_rubric` (open question O2).
9. Integrity events (L-14, L-21): signal lines keyed by gseq; heartbeats dropped (coverage is the DO's); offsets from
   `tServer - startedAt` (server time, T3 client `t` unused); lines sorted by gseq so rows and `input_hash` never depend on
   file order; `gseq > lastEventSeq` or a repeated gseq is malformed; gaps -> `connectivity_gap` seq
   `lastEventSeq + 1 + i`, context, family `connectivity`. `input_hash` = SHA-256 of band-engine `canonicalJson(BandInput)`.
10. Rule 6 paths exactly as §5.1 (L-3, L-4, L-28, m-6, n-6): the existing card is read first; final -> skip; awaiting and
    still no quality card -> nothing; the awaiting outcome commits signals + result + card only (no flag, timeline,
    pointer, key; the stage returns normally so that transaction commits); a guard error on the awaiting insert (quality
    card landed after the gate read) -> `integrity_retry` (thrown, rolled back). On the flip run the band is recomputed
    from the same evidence and its `input_hash` must equal the stored result's, else `integrity_input_changed`.
11. Timeline (reviewed only): one entry per flag (signal kind = kind of its first gseq) and per context item, ordered by
    offset then gseq, **capped at 1000 entries** (`position` is smallint): flags always kept, latest context dropped;
    `count` clamped to 32767 (smallint). Context entries carry no rule id (table CHECK). See open question O3.
12. `events.ndjson` bounds: > 20 MiB or > 50 000 lines (the SessionDO's stored-event cap, SEC-C1b-2) is refused
    `integrity_events_too_large`; lines are decoded one by one from the hash-checked bytes; signals are inserted 5 000 per
    statement (memory, §6 below).
13. **jsonb parameters are bound as `$n::text::jsonb`.** Found by the DB tests: postgres.js describes the statement and
    serialises a parameter by the inferred type, so a JSON string bound to `$n::jsonb` was JSON-encoded a second time
    (a jsonb string, failing the rubric CHECK). Casting through text keeps the "jsonb as text" convention driver-proof.
    `services/api` has no `::jsonb` binds today (grep), so nothing else is affected.
14. Errors: every stage error leaves as a constant code; a driver/DB error becomes `mirror_failed` / `quality_failed` /
    `integrity_failed` with only a well-formed SQLSTATE kept in `code` (so 40001 stays visible). No log line in stages.
15. Idempotency keys via `jobKey`; `result_ref` = session id (mirror), quality card id, integrity card id.
16. Sweep: `sweepPending(tx, limit)` (limit 0..500) as trace_worker; `private.sweep_pending` is a cross-org DEFINER, so
    no `trace.job_org_id` is needed for it. Rows are handed to `runSweep` unchanged (it validates them).
17. AT-D27: `pipeline.ts` makes both transports go through `queue/consumer.ts processBatch`; `deliverViaService` wraps
    one body as a one-message batch and answers `'ack' | 'retry'`. `createStages` gives the lead the `Stages` object;
    quality never receives the bucket, integrity never the grader.

## 3. Lead requests (exact diffs; all in lead-only files)

**R1 `workers/jobs/src/index.ts` / `app.ts` wiring** (sketch; the lead owns the final shape). A `StageDb` over the three
secrets, one connection per stage run (ADR-031):
```ts
import postgres from 'postgres';
import { createStages, type StageDb } from './mirror/pipeline.js';
import { sweepPending } from './sweep/pending.js';
const ROLE = { mirror: 'trace_worker', quality: 'trace_quality_worker', integrity: 'trace_integrity_worker' } as const;
const stageDb = (urls: Record<keyof typeof ROLE, string>): StageDb => ({
  run: async (stage, orgId, fn) => {
    const sql = postgres(urls[stage], { ssl: 'require', fetch_types: false, prepare: false, max: 1 });
    try {
      return await sql.begin(async (t) => {
        await t.unsafe(`set local role ${ROLE[stage]}`);
        await t.unsafe("select set_config('trace.job_org_id', $1, true)", [orgId]);
        return fn({ query: async (text, params = []) => (await t.unsafe(text, [...params])) as never });
      });
    } finally { await sql.end({ timeout: 1 }); }
  },
});
// stages: createStages({ db, evidence: env.EVIDENCE (get/head adapter), grader: new MockLlmGrader() })
// pendingStages: (limit) => <one trace_worker transaction without job org> (tx) => sweepPending(tx, limit)
```
`StageDb.run` takes an org id; the sweep needs a trace_worker transaction with `trace.job_org_id` unset (pass `''`).
The R2 adapter: `get(key)` -> `{ size, customMetadata ?? {}, text(), arrayBuffer() }`, `head(key)` -> `{ size, customMetadata ?? {} }`.

**R2 typecheck of db-test** — `workers/jobs/tsconfig.node.json`:
```diff
-  "include": ["vitest.config.ts"]
+  "include": ["vitest.config.ts", "vitest.db.config.ts", "db-test", "worker-configuration.d.ts"]
```
(I checked it with an equivalent scratch tsconfig: clean.)

**R3 run the DB tests with `pnpm test:rls`** — `scripts/test-rls.mjs`, after pgTAP and the concurrency script, run
from `workers/jobs`: `npx vitest run -c vitest.db.config.ts` (needs the local stack; ~8-11 s wall, ~5 s of tests).

**R4 `queue/test-fixtures.ts`**: `signalCatalogVersion: 'd1-signals-1'` should be `'d1-signals-v1'`
(`SIGNAL_CATALOG_VERSION`, what `services/api/src/modules/tests/package.ts` writes); with the old value the integrity
stage throws `integrity_unknown_catalog` (fail closed).

**R5 (optional) poison messages in `queue/consumer.ts`**: `mirror_dead_invitation`, `mirror_bad_message`,
`mirror_final_invalid`, `mirror_final_hash_mismatch` can never succeed; today they are retried 5 times and then go to
the DLQ (R-14 asks for a dead letter, so behaviour is correct, only slower). Acking them with an alert would need a
consumer change.

**R6 `private.mirror_session`** is not called by the job (decision 1). Either keep it (pgTAP covers it), or amend it in a
fix-forward migration to accept `photo: null, photoSkippedReason: null` when the job drops an unverified photo, and the
job can then call it. My preference: keep the job's own writes (they also give ON CONFLICT + re-read semantics).

`fast-check` is not needed: AT-D15 properties run as 500-iteration seeded loops.

## 4. Open questions (implemented fail-closed meanwhile)

- O1 (rule 8 / R-11): a named but unverifiable photo is recorded nowhere and counts as `photo_missing = true` (coverage x
  0.75). Confirm this conservative reading.
- O2 (not rule 1-9): the seeded default rubric of `seed_org` has a different `criteria` shape from the api's rubrics and
  cannot drive `MockLlmGrader` (no `min_hits`, anchors as an object). Items created by the api never use it; should the
  seed be aligned in a fix-forward migration?
- O3 (rule 3, plan §5 F "every flag carries evidence refs"): the timeline is capped at 1000 entries; every flag is kept
  (with <= 50 gseq refs, as the engine gives), only surplus context entries are dropped. Confirm the cap.
- O4: a flip run whose recomputed `input_hash` differs from the stored result (e.g. the start photo object disappeared
  between runs) dead-letters with `integrity_input_changed`; the card stays `awaiting_quality` ("Pending").

## 5. Tests

- `workers/jobs`: `pnpm typecheck`, `pnpm lint`, `pnpm test` green: 12 files, **184 tests** (89 new: quality/score 15,
  quality/handler 14, integrity/handler 22, integrity/load 8, mirror/handler 20, mirror/pipeline 5, sweep 5).
- Repo root: `node scripts/check-boundaries.mjs` OK; `npx vitest run packages/config/test/rule1-separation.test.ts` 47/47.
- **DB tests**: from `workers/jobs`, `npx vitest run -c vitest.db.config.ts` -> 2 files, **14 tests**, ~7.4 s
  (tests ~5 s, ~11 s wall). Override the URL with `JOBS_TEST_DB_URL`. Covered: paste chain (Review, both pointers, three
  keys, `rule_table_version` d1-v1), untrusted (Strong concern; 50 `tab_hidden` context), below cutoff (`not_used`, no
  timeline, integrity pointer null), quality late (awaiting -> sweep lists `quality_score` -> quality -> sweep lists
  `integrity_band` -> one flip, same card id -> sweep quiet), photo with another sha256 (no media row,
  `photo_missing`, coverage 750), replay of all stages (identical snapshot incl. ids), **n-7 two connections READ
  COMMITTED** (one sessions row, same ids), REPEATABLE READ (loser 40001, retry is a duplicate), two concurrent integrity
  runs (one card/result/key), `job_org_id` unset (nothing visible), quality before mirror refused.
- Settings the stages need: only `SET LOCAL ROLE <worker role>` and `set_config('trace.job_org_id', org, true)`
  (`trace.request_id` is read only by audit paths the jobs never hit). The harness creates four temporary login roles
  `jobs_dbtest_<hex>_{worker,quality_worker,integrity_worker,api}` (random password, `inherit false, set true`, one worker
  role each) and drops them; stale ones from a crashed run are dropped at start.
- Cleanup: the D1 tables are immutable/append-only through ENABLE ALWAYS triggers (they fire in replica mode) and DELETE
  is revoked from the owner on the append-only ones. `cleanupOrg` therefore runs one transaction: replica mode, each
  ENABLE ALWAYS user trigger on an org-scoped table disabled and re-enabled ALWAYS (exactly those), DELETE granted to the
  owner only where missing and revoked again, delete the org's rows everywhere (audit_log included). The test asserts
  no row of the org remains and that a fingerprint of every trigger state and owner DELETE right equals the one taken
  before. Verified after the run: 0 test orgs, 0 test roles, 79 ALWAYS triggers, owner DELETE still revoked on
  consents/grader_runs/audit_log.

## 6. Memory measurement (C1b re-review note 4)

`db-test/memory.db.test.ts`, Node 22 (V8), `NODE_OPTIONS="--expose-gc --max-old-space-size=64"` (the whole vitest
worker, ~21 MB of its own heap, ran inside a 64 MB old-space cap; V8 heap limit reported 112 MB). Path measured:
`get -> arrayBuffer -> SHA-256 -> line parse -> computeBand -> flag + timeline rows -> signal insert parameter`.
Figure = heapUsed + external + arrayBuffers above a GC'd baseline (includes uncollected garbage, so an upper bound).

| File | Lines / signals | Peak above baseline | Retained after | Time |
| --- | --- | --- | --- | --- |
| 20 MB of paste lines (129 511 lines) | refused at line 50 001 (`integrity_events_too_large`) after the hash check | within the cap (test passes) | - | - |
| worst accepted: 50 000 paste lines, 7.7 MB | 50 000 / 50 000 | 32-54 MB | ~18 MB | ~0.5 s |
| 50 000 mixed heartbeat/tab_hidden, 7.2 MB | 50 000 / 25 000, 1000 timeline rows | ~32 MB | ~14 MB | ~0.4 s |

The first version (whole-file decode, one insert parameter) on a 20 MB all-paste file peaked at ~184 MB
(retained 59 MB): not acceptable. After decision 12 (line-by-line decode from the bytes, the 50 000-line cap that the
SessionDO already enforces, 5 000-row insert chunks) the worst accepted input stays well under the 128 MB isolate
limit. The remaining fixed cost is the R2 body itself (<= 20 MB, needed whole for the SHA-256; Workers'
`crypto.DigestStream` could stream it later if needed).
