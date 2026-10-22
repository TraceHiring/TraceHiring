# M0b stream B3 review — candidate token spike + ADR-030

Branch `m0b/b3-token-spike` @ `136f9d1` (Sonnet writer, cut from `m0b/integration` @ `5e85fc7`): `docs/spikes/m0b-candidate-token/spike.mjs`, its `README.md`, `docs/adr/ADR-030-candidate-token.md`. Writer's run: 19 PASS, 0 FAIL, 8 SKIPPED (the eight M0b tables do not exist until B0; re-run after B0). `verify:fast` exit 0 in the writer's worktree.

## security-reviewer (Sonnet, 2026-10-12): PASS WITH FINDINGS
Checked clean: no secret, key material, full JWT or personal data in the three files (synthetic UUIDs only); private key non-extractable, never printed or written; claims reach psql only as `-v claims=` / `:'claims'` (no interpolation, no shell); one `begin; … rollback;` with a second run proving nothing is left behind; verification pins ES256 and checks the signature before decoding claims; `alg=none`, foreign key, tampered payload and wrong `typ` rejected; ADR decisions match build-notes Q6/Q7; PUBLIC holds EXECUTE on `auth.jwt()` (owner `supabase_auth_admin`) and `postgres` cannot revoke it (probe), so a future removal fails closed.

| # | Sev | Where | Problem | Fix |
| --- | --- | --- | --- | --- |
| B3-S1 | Medium | ADR-030 decision 1 vs the `session` row | A candidate-serving Durable Object is said to re-issue the session token, but decision 1 keeps the private key out of candidate-facing Workers/DOs | The DO asks the issuer worker over a service binding (session id + new deadline only); the issuer derives every claim from its own store |
| B3-S2 | Medium | ADR-030 (README) | `trace_candidate` can overwrite `request.jwt.claims` with `set_config` **and** with plain `SET LOCAL`, so revoking `set_config` cannot fix it; the risk covers any SQL run as `trace_candidate` with attacker-influenced text | Record both paths; M3a acceptance tests: constant SQL only in the gateway DB layer (lint + test); a catalog check that nothing reachable by `trace_candidate` uses `execute`/`set_config` (allow-list); random v4 candidate ids |
| B3-S3 | Low | ADR-030, spike | `nonce`, DO-id derivation, `kid` lookup and per-`typ` lifetime undefined | Define them as M3a requirements |
| B3-S4 | Low | ADR-030 | `typ` enforced only by the edge route table; `auth.uid()` = `sub` = `candidate_id`, so a role-less policy would evaluate for candidates | Write-path policies/readers assert `typ`; every policy names its role; per-`typ` allowed/denied tests |

Lead decision: all four applied to ADR-030 as M3a requirements before the merge (the ADR stays Proposed).

## spec-reviewer (Sonnet, 2026-10-12): PASS WITH FINDINGS
Verified: only the three owned paths changed; every §8 step is in `spike.mjs` (exact table and policy text; claims from the verified token; one allowed / one denied asserted as total 1, own 1, other 0; SKIPPED lines real, not faked); the README's token length and PASS count are consistent with a genuine run; `spike.mjs` is prettier-clean on the re-included path; ADR status, gateway role, token types and the open M3a question match the spec. Its read-only docker probe was refused by the session's permission check, and it did not work around that.

| # | Sev | Where | Problem | Lead decision |
| --- | --- | --- | --- | --- |
| B3-P1 | Medium | ADR-030 | Same as B3-S1 | Fixed with B3-S1 |
| B3-P2 | Low | ADR-030 zod block | Tighter than §8 (`strictObject`, `nonce.min(16)`, `.int()`, `sub === candidate_id`) | **Accepted as written**: the ADR discloses the tightenings and leaves them to the M3a SPEC |
| B3-P3 | Low | README, ADR decision 5 | ACL/grant claims not recorded by the script | ADR now cites the security review's probe for the `auth` USAGE/EXECUTE facts |
| B3-P4 | Low | `spike.mjs:552` | `rows=0` passes for any empty table once B0 lands | Recorded in ADR-030 "Still to do in M0b": tighten before the re-run |
| B3-P5 | Low | ADR-030 | The M0b-table re-run sat under "Open for M3a"; §8 puts it in M0b | Moved to "Still to do in M0b" |

Merged into `m0b/integration` as `d6e4833` (`--no-ff`); ADR fixes in the commit after it; `docs/adr/README.md` gains the ADR-030 row (Proposed) and its header allows Proposed rows. Full `pnpm verify` on the merged tip is still to run (no agent may be running).
