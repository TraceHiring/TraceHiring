# M0a S1.7 redactor Lows: security review of `m0a/w1-lows`

- Date: 2026-10-11, fresh `security-reviewer` agent, read-only (scratch worktrees and probe files removed).
- Scope: `git diff 76dc548 aa99476` (`packages/shared/src/log/**`): fixes for redactor review Lows #3, #4, #6, #8 and W1/W2 spec-review findings M1, L2–L6; spec §9.1–§9.2 revision 12.
- Ran: `@trace/shared` vitest at `aa99476` 465/465; the `aa99476` tests on the `76dc548` code fail 52 (every new #3/#4/#6/#8, M1, L2–L5 test; L6 is coverage only). Both commits compiled and probed with node.

## Verdict: PASS WITH FINDINGS (8 Lows; 5 already on `76dc548`; nothing Blocking/High/Medium)
- #3 fixed for letter–letter and digit–letter boundaries (14 invisible characters tried); gaps F3, F4. #4 fixed (0 leaks over 5 value shapes × 4 key forms × depth 1–7; `76dc548` leaks 10). #6 fixed (chained, `_`, digit, `-`, >32 and >128 prefixes, zone ids, IPv4-mapped/embedded, upper case); older gap F8. #8 fixed for `[name]` keys, quoted keys with spaces, keys >64 chars, `/ ? # @` in passwords; gaps F5 (and F1). M1 fixed (arrays capped at 20, stable on a second pass). L2 partly fixed (F6). L3, L4, L6 fixed. L5 fixed against the spec's version regex (F7 is what that regex still admits).
- ReDoS: 30 adversarial 1 MB shapes; `applyPatterns` ≤ 136 ms, `canonical` ≤ 129 ms, linear. Worst case already present before: one `redact()` on 4,900 strings of 1,999 U+FDFA ≈ 10 s (1.6 ms per string vs 1.1 ms on `76dc548`).
- Deviations accepted: #3 two-pass union (no case where one pass hides a value from the other; ~6× on invisible-dense strings, linear); #8 greedy userinfo (over-redaction only); L4 matches spec rev 12; #6 44-char window equals the longest `IPV6_SHAPE` match; keys over 64 chars treated as sensitive.

| # | Sev | file:line (at `aa99476`) | Repro (values built at run time) | Fix | Test |
| --- | --- | --- | --- | --- | --- |
| F1 | Low (pre-existing) | `redact.ts:278-293` | A non-sensitive key swallows the pair after it: `'{"event":"password=<pw>"}'` and `data:password=<pw>` are unchanged. Also explains 460/200K random strings that are not idempotent (same on `76dc548`) | When the key is not sensitive, resume scanning at the start of the value; bound the value (`{1,256}`) | Both repros + second pass unchanged |
| F2 | Low (pre-existing) | `redact.ts:173` | A quoted value fails open after NFKC expansion: `password="` + 112×U+FDFA + ` <w1> <w2>"` keeps `<w1> <w2>` | No closing quote within the bound → redact to the end of the text | The repro |
| F3 | Low (#3 gap) | `redact.ts:118-121` | An invisible character between two digits is dropped, not marked: `<mobile>​123` keeps the mobile (also U+3164, FE0F, 00AD, 034F, tag characters) | Mark digit–digit runs too; the two-pass union handles the split-inside case | `<mobile><ZW>123`, `<aadhaar><ZW>9` |
| F4 | Low (pre-existing) | `redact.ts:61`, `:118` | Only Default_Ignorable is handled: a PAN or mobile split by U+FFF9, U+0600, U+06DD, U+110BD or U+13430 leaks | `[\p{Default_Ignorable_Code_Point}\p{Cf}]` | Split PAN and mobile per character |
| F5 | Low (#8 gap) | `redact.ts:271` | The lookbehind blocks a scheme after `.`, `-` or a digit: ` ...https://usr:<ab7/cd>@h.example` (also `1.https://`, `-https://`) → `usr:ab7/[REDACTED]` | `(?<![a-z])` or no lookbehind (scheme capped at 32 chars, still linear) | The 3 repros |
| F6 | Low (L2 gap) | `serialize-error.ts:47-61` | A 4-space-indented message line survives: `new Error('dup\n    at <t>.<t>:1:1')`, read `.stack`, set a new message | If the stack header is not the current `name: message`, also require a path/URL location; or document the residual | The repro |
| F7 | Low (L5 gap, spec regex) | `version.ts:3`, `error-reporter.ts:24` | An all-digit PII value matches the version shape: release = a 10-digit mobile or 12-digit Aadhaar reaches `capture()` (needs a misconfigured release) | In `safeContext` also require `/[a-f]/` or `'dev'` (not `redactString`, which redacts 40-char SHAs) | Mobile and Aadhaar releases dropped |
| F8 | Low (pre-existing) | `redact.ts:230-250` | Only an address at the end of a piece matches: `2001:db8:85a3::8a2e:370:7334:closed` unchanged | Also try the piece without a trailing non-hex `:segment` | The repro |

## Not checked
Other engines' Unicode tables (Workers runtime, browsers); `pnpm verify`, lint and typecheck on the branch (vitest only); consumer call sites; fuzzing beyond ~200K random strings.

## Disposition (lead)
PASS WITH FINDINGS, all Low: `m0a/w1-lows` (`aa99476`) merged into `m0a/integration`. F1–F8 go to one writer next session (test-first, one commit each, `packages/shared/src/log/**` only), before the S1.7 gate if the window allows; otherwise onto the M0a deferred list with an owner.
