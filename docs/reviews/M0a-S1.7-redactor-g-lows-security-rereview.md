# M0a S1.7 redactor G-lows (G1, G2): security re-review of `m0a/redactor-g-lows`

- Date: 2026-10-11, fresh read-only `security-reviewer` (Sonnet; founder model policy: small re-review).
- Scope: `git diff 055eaf6 54ad42a` (`b90329b` G1, `54ad42a` G2): `packages/shared/src/log/redact.ts` (+70/−5),
  `redact.test.ts` (+120/−0). Judged against the founder's backstop-scope decision (2026-10-11, build-notes §0):
  honest mistakes in scope, crafted log text out of scope (reviewer checklist).
- Ran: `redact.ts` at `055eaf6` and `54ad42a` extracted to a scratch dir; `redactString`/`applyPatterns` on both with
  synthetic values built at run time; the G1/G2 repro sets plus 38 extra honest shapes; generator fuzz (20K and 40K
  strings: glued addresses, quoted-key pairs, escaped, JSON-in-JSON, error messages) and a 200K random-alphabet fuzz,
  old vs new; timing over 19 shapes at 100–800 KB (4 shapes to 3.2 MB); `@trace/shared` test, typecheck, lint in the
  writer's worktree.

## Verdict: PASS WITH FINDINGS (G1 and G2 fixed, no regression; 1 Low, pre-existing, outside G1/G2)
- **G1 fixed**: all 17 shapes leak on `055eaf6` and are redacted on `54ad42a` (email–email glued by `_ - + 7 %` or
  U+FFF9+`_`; UPI–UPI; UPI–email; a 5-value chain); idempotent; linear (look-back bounded by the previous match end).
- **G2 fixed**: 5 of 7 repros leaked on `055eaf6` (`failed to parse "otp=…": invalid`, `{"password=…": true}`,
  `{\"token=…\":1}`, `{"otp: …": 1}`, the escaped error message), none on `54ad42a` (the other 2 were already safe);
  also 3 and 7 backslash levels, spaced `=`, `[name]` keys, tabs, fullwidth `=`, Go's `strconv.Atoi: parsing
  "token=…": invalid syntax`. Idempotent.
- No regression: 40K generator strings, old leaks 24,108 → new 0, new-only leaks 0, non-idempotent 0; 200K random
  strings: 1,294 differ, in none does new keep more text (`@`-chains now redact more). The only 2 non-idempotent random
  strings (U+200B plus stray quotes) are identical on old and new (pre-existing, crafted).
- Linear time: no existing `< 50 ms` guard touched; 16 new shapes use the same bound; peak 18.7 ms at 100 KB (old
  14.2 ms); ~2× per doubling from 400 KB to 3.2 MB. `@trace/shared` 601 passed; typecheck and lint clean; no invisible
  characters added (U+FFF9 built with `String.fromCodePoint`).

| # | Sev | file:line (at 54ad42a) | Repro | Fix | Test |
| --- | --- | --- | --- | --- | --- |
| H1 | Low (pre-existing, honest shape: config/settings dumps) | `packages/shared/src/log/redact.ts:407` (the `Bearer\|Basic\|Token` scheme step) | `token = <v>`, `my token = <v>`, `token = "<v>"` (spaces around `=`) → `[REDACTED] <v>`: the scheme rule swallows `token =`, the value survives and the key rule no longer sees the key. `token=<v>` and `Token: <v>` are redacted. Values built at run time | Skip the scheme rule when the next non-space character is `=` or `:` so the key rule handles the pair, e.g. `\s{1,8}(?![\s=:])[^\s"',;]+` (reviewer: right on 9 probes incl. `Token <v>`, `Bearer <v>`, `Basic <v>`, idempotent; not run against the suite) | `token = <v>`, `my token = <v>`, `token = "<v>"`, `Token  :  <v>` redacted, second pass unchanged; keep the `Token`/`Bearer`/`Basic <v>` cases |

## Reviewer checklist (out of scope, no fix asked)
- A key holding the secret with no separator (`"otp%3D<v>": 1`) keeps the key text (value redacted); crafted, same on old.
- Unquoted multi-word keys (`Address Line 1=<v>`: the bare key is `1`): pre-existing, design limit.
- A quoted key over 64 characters whose nested pair holds an over-long bare key: sensitivity is judged on the redacted
  key text; garbage input only.
- The writer's `"st age=-"` case is clean: `bad "st age=<v>": 1` is redacted (the nested scan reads `age=`).

## Not checked
`pnpm verify`, `test:rls`, the database; other packages; the writer's worktree cleanliness (guard refused `git status`);
the H1 fix against the full suite; browser and Workers runtimes (Node 22.23.3 on Windows only); object values, error
stacks and the logger wrapper beyond the existing tests.

## Disposition (lead)
PASS WITH FINDINGS accepted: `m0a/redactor-g-lows` @ `54ad42a` merges into `m0a/integration` (`--no-ff`). H1 (Low,
honest shape) is fixed by the lead test-first on integration before the S1.7 gate.
