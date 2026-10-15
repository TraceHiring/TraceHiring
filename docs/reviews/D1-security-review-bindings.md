# D1 Worker bindings — security review (2026-10-15)

- **Reviewed:** `6841d63` (three `wrangler.jsonc` dev/staging blocks, generated `worker-configuration.d.ts`, DO and `CandidateRpc` stubs, `check-staging-secrets` allow-list, `scripts/test/wrangler-bindings.test.mjs`, the edge `no-error-reporter` assertion); skimmed `74c5887`, `c4dddcd` (band-engine and e2e skeletons, boundaries). Against spec §4.2, §4.3, §6.2, §7.1, L-10, L-11, R-9, `docs/infra/environments.md` and CLAUDE.md.
- **Reviewer:** Opus `security-reviewer` agent, read-only (no credentials, no deploy). Writers: Sonnet (`b70b20c`, `d3b3d5d`), placed by the lead.

## Verdict: PASS WITH NOTES (no Critical, High or Medium)
No secret, DB credential, Supabase key or private JWK on the edge or its DOs; no secret-shaped value committed; the allow-list is exactly §7.1 and fails closed; `CandidateRpc` and the DO stubs are unreachable over HTTP; every binding is env-separated; `observability` unchanged.

## Findings and disposition
| ID | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| F1 | Low | The edge runtime "bound to nothing but VERSION" check reads the top-level (test pool) config, which is never deployed | **Fixed (title and comment):** the deployed blocks are pinned by the type assertion and `wrangler-bindings.test.mjs`; a pool loading an env block must expect that exact key set, never a looser one |
| F2 | Low | "PACKAGES read-only, asserted by a source test (AT-D31)" has no test | **Fixed:** check-boundaries rule 11 (edge source uses `PACKAGES` only as `.get(`/`.head(` or a type declaration; put, delete, list, bracket access, alias and destructuring are flagged; 13 tests). **C1:** the edge verifies `packageSha256` |
| F3 | Low | Edge lint did not catch `CANDIDATE_TOKEN_PRIVATE_JWK` / `MEDIA_LINK_HMAC_KEY` | **Fixed:** `PRIVATE_JWK` and `HMAC_KEY` added to `CREDENTIAL_NAMES` (test first) |
| F4 | Low | Public-key and Supabase vars are empty placeholders; `wrangler deploy` replaces dashboard vars; a private JWK pasted into the public var would not be caught | **Requirement (lead, ci.yml):** pass them with `--var` from GitHub variables; fail the deploy if any JWK in a public var has a `d` member. **Edge (C1):** refuse a key with `d`; an empty or missing key gives 401/503, never a pass |
| F5 | Low | `ci.yml` deploys edge first, passes none of the new vars, creates no buckets/queues; jobs has no `queue`/`scheduled` handler yet | **Requirement:** no merge to `main` and no staging deploy until ci.yml implements §7.1 (api → jobs → edge, the `--var`s, idempotent bucket/queue creation, R2 enabled by the founder) and stream R2 adds the handlers |
| F6 | Info | Bindings are optional in the generated `Env`; api secrets are not in it | **Writers:** guard each binding and fail closed (503 `unavailable`), never `!`; zod-parse every `CandidateRpc` result at the edge; declare secret names in a hand-written `Env` augmentation, never via a `.dev.vars`-driven `wrangler types` |
| F7 | Info | Every public `CandidateRpc` method is callable by any Worker that binds it; RPC/DO errors skip `withErrorReporting` | **Writers (R3):** helpers `#private`, zod inside each method, no PII in thrown messages; the edge maps every RPC failure to a constant code |
| F8 | Low | Playwright `trace: 'retain-on-failure'` would capture staging passwords, TOTP codes and tokens in uploaded artifacts | **Fixed:** traces off unless `E2E_TRACE=1` locally; staging runs never keep or upload one |
| F9 | Info | Dev CORS origins assume ports 5173/5174 that the apps do not pin | **Requirement (C2/R4 or lead):** pin `server.port`/`preview.port` with `strictPort` per app and match the dev origins |
