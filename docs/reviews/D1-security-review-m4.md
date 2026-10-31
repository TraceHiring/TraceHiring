# D1 migration 4 — security review (2026-10-14)

- **Reviewed:** `f6a0144`: `supabase/migrations/20261014175327_d1_media_audit.sql` (`private.media_viewer_check`, `media_link_grant`, `media_view_grant`), `supabase/tests/rls_d1_media_view.test.sql`, the new audit actions in `packages/shared/src/contracts-tenancy.ts`; against spec `specs/d1-demo-slice.md` §3.4, §4.5, §6.2 (L-2, L-25, L-26, R-7, R-15) and CLAUDE.md rules 5, 7, 8.
- **Reviewer:** Opus `security-reviewer` agent; read-only, with rolled-back psql repros on the local stack.
- **Fixes:** lead (see the Disposition column).

## Verdict: PASS WITH NOTES (2 Medium, 5 Low; nothing blocks)
- Only `trace_api` (and the owner) can execute the two grants; the check, `membership_counts_for` and `audit` are owner-only. `private` is not exposed by PostgREST.
- Every refusal is the same `42501 TRACE_GUARD: media access denied` (unknown media, membership, assignment, fence, suspended org, null viewer or link). Inside one transaction fail-closed holds: an audit write error aborts the call, so there is no key without a row.
- Audit rows hold ids only (no key, signature, token, email or label); the zod schemas match.

## Findings and disposition
| ID | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| F1 | Medium | "No audit row, no key" is not a DB guarantee: the R2 key is deterministic (`media/{org}/{session}/start_photo.jpg`, D1-5) and `trace_api` can read `invitations.session_id`, so api code could build the key and stream bytes without a `media.view` row | **Lead decision: keep the deterministic key** (D1-5 is a founder answer; a random suffix changes the retake and upload design of stream C1). The guarantee moves to binding api requirements R3-3 (stream only the key `media_view_grant` returned; a static test fails on any `media/` key template outside the media read path; the evidence bucket stays private) in spec §6.2, and the migration header no longer claims a DB-level guarantee. Revisit with M4 media |
| F2 | Medium | `media_view_grant` does not tie `p_link_id` to an issued link: a never-issued link, another viewer's link, a stale link and a replay all get the key, so the 5-minute and single-use parts of rule 8 rest on the api alone | **Fix in migration 4:** under a per-link advisory lock, `media_view_grant` requires a `media.link_issued` row for the same org, media, viewer and link id within 330 s (300 s TTL plus skew) and no earlier `media.view` for that link; `media_link_grant` refuses a reused link id. Tests: never issued, other viewer, stale, replay |
| F3 | Low | The functions ignore `private.api_org_id()`: with the setting unset or pointing at another org they still grant | **Fix:** `media_viewer_check` requires `mo.org_id = private.api_org_id()`; tests for unset and other-org |
| F4 | Low | `GET /media/:jti` carries no `Authorization` (by design, for the canvas fetch), so the fetch re-check uses the issue-time `aal`/`amr`; an unburnt URL leaked within 300 s works once for anyone and the audit names the original viewer | **Accepted residual risk**, written into spec §6.2. F2 bounds it in the DB (330 s, single use, same viewer) |
| F5 | Low | The audit actor is asserted by the api (R-7) | **Accepted** (R-7); covered by requirement R3-1 |
| F6 | Low | `link_id` is the `jti` and is readable in `audit_log` by owners and admins, against "neither link, jti nor key is logged" | **Spec fix:** the `jti` alone is not a secret (the HMAC `sig` is); the spec sentence says so |
| F7 | Low | Test gaps: suspended org, audit write failure, `api_org_id` binding | **Fix:** asserted denials added |

## Requirements for stream R3 (`services/api`), now in spec §6.2 "Media link requirements"
R3-1 verified identity only (`p_viewer` = `sub` of a verified JWT; `p_aal` ∈ `aal1`/`aal2`; `p_amr` mapped as `private.membership_counts`); R3-2 one transaction per grant (`set local role trace_api`, `trace.api_org_id`, a server-generated `trace.request_id`), bytes or link only after COMMIT; R3-3 keys (above); R3-4 link format (128-bit `jti`, `sig` = HMAC-SHA-256 over `v1|jti|exp`, integer `exp` within 300 s, constant-time compare, check the DO record's own `exp`, burn before the DB call); R3-5 one uniform 404 for every failure; R3-6 no `/media/` path, `jti`, `sig`, key or link id in logs, Sentry breadcrumbs or headers, plus `no-store`, `no-referrer`, `nosniff`, exact-origin ACAO with `Vary: Origin`; R3-7 rate-limit link issuance per viewer; R3-8 the issue endpoint filters by `org_id = :orgId` (multi-org callers); R3-9 AT-D10 api tests (replay, expiry, tampered `sig`, DB denial, injected COMMIT failure: no bytes).
