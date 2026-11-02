# D1 Wave 0 tail — security review (2026-10-17)

- **Reviewed:** on `d1/integration`, `29eb2fc..7f9ca97`: the Linux fix of the S5 test (`67ecf0b`), S6 (`59f0fcd`), S2 (`c740713`), the `e2e-local` CI job and `run_e2e` input (`e97d611`), `scripts/e2e-local.mjs` and `e2e/tests/{dc-d6,stack}.spec.ts` (`7f9ca97`).
- **Reviewer:** Opus `security-reviewer` agent, read-only; it ran `checkWorkflow` in memory on modified copies of `ci.yml` to prove L1.
- **Verdict: PASS** (no Blocking, High or Medium; two Low, one Info). All three are fixed below.

## Findings and disposition
| ID | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| L1 | Low | The S2 pin finds deploy lines by the words `wrangler` and `deploy`. The Pages step holds `CLOUDFLARE_API_TOKEN` and its run text was not pinned, so `pnpm exec wrangler de''ploy -c services/api/wrangler.jsonc --env staging`, or `d=deploy` then `wrangler $d …`, re-bundles and deploys a Worker after scan-dist with 0 violations. `joinContinuations` also put a space where bash removes a backslash-newline, so `wrang\`+newline+`ler deploy` was never classified. | **Fixed** (`8845361`, tests first): every deploy-staging step holding the token must be a pinned Worker deploy step, exactly `node scripts/ensure-staging-resources.mjs`, exactly `node scripts/check-staging-secrets.mjs`, or the Pages step whose whole run text is `PAGES_STEP_LINES`. A backslash-newline is now joined with no space, as bash does. Regression tests cover the quote-split, variable, continuation and quoted-word forms, in a step of their own and appended to the Pages step. S2 is closed with this. |
| L2 | Low | On SIGINT/SIGTERM the test-rls lock handler exits at once, so `e2e-local`'s `finally` (stop, logs, state-folder removal) never runs. On POSIX the detached process groups survive, and a later run could get 200 from the orphan and pass against a stale build. CI is not affected (the runner reaps processes). | **Fixed** (tests first): `e2e-local` registers its own signal handler before the lock's. It synchronously kills every process tree (`killNow`: `taskkill /T /F` or `kill(-pgid, SIGKILL)`) and removes the state folder. Before starting anything, the run also fails when any of its health URLs already answers. |
| I1 | Info | For a fork PR, `github.head_ref` is the fork's branch, so a fork could name a branch `d1/x` and opt into the 25-minute job. It would cost minutes only: no secret, no environment, a read-only token. | **Fixed** (`8845361`): `E2E_IF` and `ci.yml` also require `github.event.pull_request.head.repo.full_name == github.repository`; a test rejects the condition without it. |

## Checked and clean (reviewer)
- **S6:** "exists" counts only inside the stderr `[ERROR]` block, with the code of its own kind, and never for a spawn error or a signal. Confirmation fails closed. The wrangler 4.149 `r2 bucket info --json` (no banner) and `queues info` (`Queue Name:`) forms were verified.
- **Worker deploy steps:** whole run text pinned, `--var` values exactly `$SOURCE`, forbidden words caught, `shell:` must be bash, env allow-list holds. The dry-run line is an exact match.
- **Artifact:** traces stay off unless `E2E_TRACE=1` (never set in CI). Videos and `dc-d6.json` hold only synthetic data. Stack logs go through `redact()`. The upload paths and the 7-day retention are pinned, and the actions are SHA-pinned.
- **Not checked by the reviewer:** the test files' contents, `pnpm verify`, `scan-dist` coverage of a Pages `_worker.js` (outside S2).
