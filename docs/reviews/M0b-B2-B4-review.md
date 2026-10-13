# M0b BUILD reviews — B4 (rest) and B2 (2026-10-13)

Spec: `specs/m0b-tenancy.md` revision 6. Reviewers ran read-only. Lead-run evidence: AT-B8 passed live on the
local stack (`node scripts/test-auth-local.mjs`, after `supabase db reset --local`).

## B4: supabase-js, CSP template + plugin, check-headers, check-workflows, ci.yml, staging smoke
Security-reviewer (Sonnet) on `fc20864..a9ed348` plus `m0b/b4-smoke-auth` @ `7fc6c1d`: **CHANGES REQUIRED**
(2 Medium, 4 Low). Both Mediums fixed test-first.

| ID | Sev | Finding | Status |
| --- | --- | --- | --- |
| B4-SEC-1 | Medium | smoke script did not sign out after a TOTP/claims failure (the session stayed live) | **Fixed** `04013ea` (latest token always signed out in a finally; 19 tests red first) |
| B4-SEC-2 | Medium | check-workflows bypasses: smoke secrets matched anywhere in run text (a comment passed); inline `VITE_SUPABASE_*=` in run text; composite action env | **Fixed** (whole run must be the smoke command; run-text deny entry; checkAction rule; 4 tests red first) |
| B4-SEC-3 | Low | publishable-key variable not shape-checked | **Fixed** (smoke env `04013ea`; build plugin refuses a non-`sb_publishable_` key) |
| B4-SEC-4 | Low | ops child env is a deny-list of three names, not an allow-list | Open (owner: M0b REVIEW/FIX or M1 ops hardening) |
| B4-SEC-5 | Low | `sslmode` refusal reads the raw URL (percent-encoding, `?host=`); `require` does not verify the CA | Open (same owner) |
| B4-SEC-6 | Low | smoke step 6 reads the Pages alias, not the deployment URL | Open (optional; the M0a smoke already checks the deployment) |

## AT-B8 finding (lead, fixed)
`[auth.email] enable_signup = false` (spec §4.1) is the CLI's email **provider** switch: GoTrue answered every email
sign-in with `422 email_provider_disabled`. Fixed: `true`; `[auth] enable_signup = false` keeps sign-ups off (live:
`/signup` and `/otp` with `create_user` return `422 signup_disabled`; `/settings` has `disable_signup: true`).
check-boundaries rule 9 pins it. **H8 (staging Auth settings) must mirror this**: email provider on, sign-ups off.
DC-2 pinned live: amr methods `[password]`, `[password, totp]`, `[otp]`.

## B2: recruiter sign-in UI (`m0b/b2-recruiter-auth` @ `91092ac`, 174 recruiter tests)
| Reviewer | Verdict |
| --- | --- |
| security-reviewer (Sonnet) | PASS WITH FINDINGS (5 Low) |
| spec-reviewer (Sonnet) | PASS WITH FINDINGS (2 Medium, 1 Low) |

| ID | Sev | Finding | Status |
| --- | --- | --- | --- |
| B2-SP1 | Medium | no test asserts `session_aal2`, nor an error after TOTP | Sent to the fixer (`m0b/b2-fixes`) |
| B2-SP2 | Medium | form/button wiring to AuthFlow untested (no jsdom) | Sent to the fixer (pure handler tests) |
| B2-SP3 | Low | `resolve` ignores the epoch: a late password sign-in can call `mfa.enroll` after sign-out | Sent to the fixer |
| B2-SEC-2 | Low | `[otp, <unknown>]` counted as OTP-only | Sent to the fixer (every method must be otp/magiclink) |
| B2-SEC-3 | Low | stale step skipped its discard while another step was busy | Sent to the fixer |
| B2-SEC-1 | Low | client allows http for 127.0.0.1/localhost outside dev | Open (unreachable: the build plugin only accepts `https://<ref>.supabase.co`; owner M1) |
| B2-SEC-4 | Low | no `onAuthStateChange`: an expired/revoked session keeps the signed-in UI (RLS still denies data) | Open (owner M1, first data page) |
| B2-SEC-5 | Low | `shouldCreateUser: false` errors reveal whether an account exists (the GoTrue API reveals it anyway) | Open: spec §4.6 says errors keep the state; changing it is a UX/WHAT change → founder FYI, not built |
| — | Note | §4.6 gains a `starting` state (reading a stored session at load) | Spec revision 7 |
