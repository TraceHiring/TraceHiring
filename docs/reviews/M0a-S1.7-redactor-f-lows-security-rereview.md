# M0a S1.7 redactor Lows: security re-review of `m0a/redactor-f-lows` (F1–F6, F8)

- Date: 2026-10-11, fresh read-only `security-reviewer`.
- Scope: `git diff 6aa191b e38c19e` (7 commits), `packages/shared/src/log/{redact.ts,redact.test.ts,serialize-error.ts,logger.test.ts}`; spec §9.1–§9.2 rev 12.
- Ran: worktree byte-identical to `e38c19e`; `@trace/shared` vitest 561/561, package typecheck and lint clean. The
  `e38c19e` tests on the `6aa191b` code: 51 fail (50 new F1–F6/F8 tests + 1 environmental lockfile test outside the
  repo). 31 repro cases with node on both versions: all leak on old, all redacted on new, second pass unchanged.
  Timing: 55 adversarial shapes at 250 KB–4 MB plus `redact()` on 4,900 strings of 1,999 chars. Fuzzing: 600K random
  strings for idempotence (2 seeds) and 200K strings with synthetic values in noise (old vs new).

## Verdict: PASS WITH FINDINGS (2 Lows, both already present on `6aa191b`; F4 slightly widens G1)
- **F1 fixed**: key + separator match, sticky value regex reads each value once, every match ≥ 2 chars (no stall);
  linear (630 ms at 4 MB); no value escapes through the resume logic (G2 is a separate, older path via quoted keys).
- **F2 fixed. F3 fixed**: no literal invisible characters in the four files (non-ASCII only `§ … – — −` and fullwidth
  letters, as on `6aa191b`); U+FDFA is an escape. **F4 fixed** (Cf removal also turns `<email>￹_<email>` into G1).
- **F5 fixed**: removing the lookbehind is linear (≤ 32 starts per `://`, each ≤ 256 chars); ~1 s at 1–4 MB vs ~30 ms
  before; letter-dense 2,000-char strings 0.5–2.7 ms vs 0.15–0.6 ms. Worst single `redact()` is still the existing
  U+FDFA case (22.1 s new vs 19.5 s old on a loaded box). Optional: skip the step when the text has no `://`.
- **F6 fixed**: both documented residuals reproduce and both leaked on `6aa191b` (not regressions); no cheap complete
  fix (the original message is gone once `.stack` was read); pass-through rows still go through the string patterns.
  Acceptable as Low. (The "name changed" test also passes on old code; "message changed" fails on old.)
- **F8 fixed**: hex-group runs are linear (90 ms at 1 MB); every miss was also missed before; over-redacts `HH:MM:SS:mmm:word` only.
- ReDoS: all shapes linear (~2× per doubling up to 4 MB); worst per 1 MB ≈ 1.2 s in the patterns (F5 shape), ≈ 2 s in
  `canonical` (existing 18× U+FDFA expansion).
- Idempotence: 151/600K change on a second pass (old: 1,209/300K, new: 72/300K on the same seed); 140 of 151 are G1,
  11 only over-redact on pass 2; no output contains U+2063.
- Detection differential (200K): old leaks fixed by new 14,908; new-only leaks 108 (90 PAN glued to a word — not
  PAN-shaped by design; 8 G1 via a Cf character; 4 more G1; 4 digits glued to an IPv6 group; 1 G2; 1 IPv6 glued to text).

| # | Sev | file:line (at e38c19e) | Repro (values built at run time) | Fix | Test |
| --- | --- | --- | --- | --- | --- |
| G1 | Low (old; F4 widens it) | `redact.ts:365`, `:367` (lookbehinds); `:122-125` | `e1 = <5 letters>@<6 letters>.example`, `e2` likewise: `redactString('x '+e1+'_'+e2+' y')` → `x [REDACTED]_<e2> y`; same with `-`, `+` or a digit between them; new-only: `e1+'￹_'+e2` | After an email/UPI match, retry the same pattern sticky (`y`) at the match end, repeating while it matches, instead of letting the lookbehind block that position (linear) | `e1+sep+e2` for sep in `_ - + 7 ￹_`: both redacted; second pass unchanged |
| G2 | Low (old; F1 sibling) | `redact.ts:231-234`, `:250-263` (also `:167`, `:211-222`) | A pair inside a quoted key is never scanned: `failed to parse "otp=<6 digits>": invalid` → `"otp=<6 digits>": [REDACTED]`; also `{"password=<pw>": true}` and `{\"token=<t>\":1}` (redacted without the `:` after the quote) | For a quoted key, also run the pair scan over the key's own text (no quote/backslash inside, so linear) | The 3 repros; second pass unchanged |

## Not checked
Other engines' Unicode tables (Workers, browsers); `pnpm verify`, `test:rls`, the database; consumer call sites; git
state of the review worktree (guard blocks cross-worktree git; nothing written there). Timings from a loaded machine:
compare ratios.

## Disposition (lead)
PASS WITH FINDINGS accepted: `m0a/redactor-f-lows` merges into `m0a/integration`. G1 and G2 (Low, pre-existing) go
to one writer now (test-first, one commit each, `packages/shared/src/log/**` only, linear-time guards), then merge.
