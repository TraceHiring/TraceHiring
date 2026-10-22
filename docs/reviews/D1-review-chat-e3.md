# D1 Chat E3 review record: staging Postgres through Hyperdrive

Range reviewed: `c6c65df..2cc718a` on `d1/integration`. It covers the lead commits `069391e`, `059fee3`, `62fed49`, `bbbb2b5` and `fe67309`, the merge `f0be0ff` of writer branch `d1/e3-ops-hyperdrive` (`5239daf`, `e496b3b`, `46511ae`), and the docs commit `2cc718a` (ADR-031 amendment 1, spec revision 4o). Both first reviews ran on Opus, read-only, on 2026-10-22.

## Verdicts
- **Security reviewer: PASS WITH NOTES.** No Critical, High or Medium findings; one Low and three Info.
- **Database reviewer: APPROVE WITH MINOR FIXES.** No Blocker or Major findings; four Minor and four Nit.

## Findings and dispositions
| Id | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| SEC L-1 | Low | `localDbUrlAllowed` and postgres.js 3.4.9 read the host differently. The guard takes the host after the last `@`; postgres.js takes everything after the first `@` as a `,`-separated host list, and the capped transport dials the first. So `u@remote:5432,x@127.0.0.1` passed the guard and was dialled in plain TCP. Staging was already protected twice (allow-list, binding wins). | **Fixed** `79e2fd9`, tests first. The guard refuses an authority with more than one `@` or any `,`. A test checks that the host postgres.js dials equals the allowed loopback host. `api-db-tls.test.ts` refuses the hidden-host URL. |
| SEC I-1 | Info | `[::1]` was allowed, but postgres.js splits the host on `:` and could never dial it. | **Fixed** `79e2fd9`: dropped from the guard and from the jobs db-test harness (`e73a12a`). |
| SEC I-2 | Info | The operator's psql session uses `sslmode=require`, with no certificate verification, even though the CA is now downloaded. This predates the diff. | **Deferred** to M8 production ops: allow `sslmode=verify-full&sslrootcert=<path>` in `parseOperatorUrl`. |
| SEC I-3 / DB Minor 4 | Info / Minor | Unconfirmed: `origin_connection_limit` 5 as Cloudflare's minimum, 4 × 5 within Supavisor limits, and the pooler certificate passing `verify-full`. | **Fixed** `e73a12a`: the wording now says "to confirm". Confirmed by the ops script's create call (Hyperdrive tests the origin) and the AT-D1 staging run. |
| DB Minor 1 | Minor | The login roles had no server-side timeouts; a stuck transaction could hold one of a login's 5 origin slots. `SET LOCAL ROLE` does not apply the target role's settings. | **Fixed** `4826152`, tests first. `stagingLoginRolesSql` sets `statement_timeout` 15s, `lock_timeout` 10s and `idle_in_transaction_session_timeout` 30s on each login. `test:rls` step 5d checks `pg_db_role_setting` on the create and alter paths (32 checks). Spec 4o §3 and the runbook are updated. |
| DB Minor 2 | Minor | `transport.db.test.ts` copied the driver options instead of calling `withStageConnection`, and ran only as the operator. | **Fixed** `e73a12a`. The test runs the production path on the harness's inherit-false login: `trace_quality_worker` with `trace.job_org_id` bound, on one connection; `set local role trace_integrity_worker` fails with 42501. |
| DB Minor 3 | Minor | No test for a connection lost mid-transaction. | **Fixed** `79e2fd9`: a fake Postgres peer closes after BEGIN. The unit of work rejects in under 2 s, on one connection, and no COMMIT is sent. Found while doing this: postgres.js 3.4.9 queues `sql.begin`'s ROLLBACK on the closed connection and throws an uncaught `TypeError` from a timer (`connection.js` `nextWrite`). The test pins it. On Workers it shows as an uncaught exception in the invocation log after the work has already failed; watch for it on staging. |
| DB Nit 1 | Nit | `not.toBe('anon')` was weak. | **Fixed** `e73a12a`: `toBe('postgres')`. |
| DB Nit 2 | Nit | `tx.unsafe(text)` with no params uses the simple protocol, so constant text with `commit; …` would end the transaction. All SQL is constant today. | **Deferred** (hardening): `{ simple: false }` in `api-db.ts` and `stage-db.ts` at M3a. |
| DB Nit 3 | Nit | `prepare: false` costs a describe round trip per parameterised query through Hyperdrive. | **Deferred** (performance; measure at M8 load). |
| DB Nit 4 | Nit | Nothing checks at deploy time that `caching.disabled` is still true on the live configs. | **Deferred** to M8: the staging smoke reads each config and asserts it. |

## Not confirmed by either reviewer
Neither reviewer could reach Context7 or the Cloudflare docs. The Hyperdrive API body was confirmed only against the installed wrangler 4.149 and cloudflare SDK 5.2.0 types. These facts are left to the founder's ops run and the AT-D1 staging e2e:
- transaction-mode pinning with `SET LOCAL`;
- rollback of the origin on a client disconnect;
- the pooler certificate passing `verify-full`.
