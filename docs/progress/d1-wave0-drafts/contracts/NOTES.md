# D1 wire contracts: drafts and open choices

Files (all in `packages/shared/src/`): `contracts-candidate.ts` (+ test), `contracts-d1.ts` (+ test), `contracts-schema-walk.ts` (a test helper, see below). The lead still owns `package.json` exports (`./contracts/candidate`, `./contracts/d1`) and `index.ts`.

Test counts: `contracts-candidate.test.ts` 85, `contracts-d1.test.ts` 113 (198 total). `tsc --noEmit`, `eslint --max-warnings=0` and `prettier --check` pass in `packages/shared`.

## Extra file: `contracts-schema-walk.ts`

A small helper (not product code) that walks a zod v4 schema: `schemaKeys`, `keysMatching(schema, regex)`, `sharedNodes(a, b)`, `allObjectsStrict`. It reads `schema._zod.def`, so it is tied to zod v4 internals. The api and recruiter DTO tests in AT-D3 can reuse it for the same key scans. Keep it, move it, or inline it as you prefer.

## Spec inconsistencies found

1. **`sessionGrant` has no `sessionId`.** §4.2 lists the return without it, but the edge needs `sessionId` for `SessionDO.start`, the R2 photo key and `sessionStarted`. Only `photoPermit` returns it. I added `sessionId` to `SessionGrantRpcOut`. Drop it if the edge is meant to call `photoPermit` again.
2. **`sessionStarted` has no `orgId`.** The input is `{invitationId, sessionId, startedAt}` and no token, but api sets `trace.api_org_id` from a token-hash lookup or a verified lobby token. I added `orgId` (the edge has it from claims).
3. **`SubmitReq` vs the answer hash.** §4.4 says submit compares the rebuilt answers with "the SHA-256 of each answer in `SubmitReq`", and AT-D25 says "the client's answer hash", but §4.2 defines `SubmitReq{streamId, finalSeq}` only. I followed §4.2. If the hash stays, add an optional `answerSha256: [{position, sha256}]`.
4. **Error body shape differs.** Candidate edge errors are `{ "error": "<code>" }` (§4.2) while org api errors are `{ error: { code } }` (§6.2). Kept both as specified (`CandidateErrorBody`, `ApiError`).
5. **Rubric field names.** §5.3 `RubricSnapshot` says `max`/`minHits`; the DB validator (`rubric_criteria_valid`) requires `max_points`, `id`, `label`, `anchors`. The wire uses camelCase `maxPoints`, `anchors`, `minHits`, `id`, `label`; the api maps to the jsonb.
6. **MCQ option text key.** The DB stores options as `{id, text}`; the candidate `TestPackage` uses `{id, label}` (§4.4). Authoring requests and `TestDetailResponse` use `text`; the candidate schemas use `label`. The package builder maps.
7. **`ReportMetaResponse.versions.integrity.rulesetVersion`** is a single object, but `ruleset_versions` has an int `version_no`; `quality.rubricVersion` could be several rubric versions. I typed both as display strings (1..64 chars) so the api can pick the label. No column holds them directly.
8. **Candidate error list has no code for a missing package or DO failure** other than `unavailable` (503); I kept the §4.2 list exactly.

## Field shapes the spec left open (candidate side)

- **Event envelope.** `ClientEvent` is flat: `{seq, t, kind, ...payload}`; signals add `sig` and the §4.6 fields at the same level. `seq` is the stream counter (>= 1), `t` the client's monotonic offset in ms (>= 0). It is a nested discriminated union (`kind`, then `sig`); `ClientSignal` is exported so tests can scan it. `item` is a position >= 1; for signals it is nullable ("or null"), for answer events it is required.
- **Signal numbers.** `len`, `ms` are ints 0..10 000 000; `untrusted_input.count` >= 1; `via` is `keydown | beforeinput | input`; `dt` is `text | files | other`.
- **`answer.choice.option`** is a string 1..64 or `null`. **`answer.text`**: `p`, `d` >= 0 ints, `i` string <= 10 000 (UTF-16 units), `len` optional >= 0.
- **`streamId`** is a uuid (the DO issues it; the spec does not give a format).
- **`SessionView`**: `answers[]` is a union of `{position, text}` and `{position, choice}`; an unanswered item has no entry. `receipt` is optional. `sections` 1..10, `items` 1..100. `state` is `in_progress | submitted | auto_submitted`.
- **`InvitationState`** (resolve output) is the full `invitation_status` enum, including `blocked_age`; `title` and `durationMinutes` are optional.
- **`PhotoRes.bytes`** 1..512 000. **`OtpVerifyRes.expiresAt`** is the lobby token's expiry.
- **`ServedItem` / `TestPackage` items:** `options` iff `kind === 'mcq'` (2..6, `{id, label}`); `maxChars` is not allowed on mcq. `TestPackage` also checks every item's `sectionId` exists; `durationSeconds` 60..7200 (the DB range); `sections` 1..10; `items` 1..100.
- **`CandidateTokenClaims`** adds `exp > iat` and `nonce` <= 128 chars; ids are uuids; times are non-negative ints.
- **RPC link-token input:** `inviteResolve` takes the raw `token` (api hashes it), not a hash. Not-found is not a schema case; the RPC is assumed to throw (edge maps to 404 `invalid_link`).
- **RPC shapes I had to invent:**
  - `messagingSend` in `{invitationId, orgId, code, idempotencyKey}`, out `{ok:true}` (no address either way).
  - `lobbyMint` in `{invitationId, orgId, nonce}` (the edge generates the nonce and keeps its hash), out `{lobbyToken, expiresAt, next}`.
  - `ageDeclare` in `{lobbyToken, adult}`, out `{blocked}` (the edge turns `true` into 403 `not_eligible`).
  - `consentRecord` out `{ok:true}`; `noticeGet` out is `NoticeRes`.
  - `sessionGrant` in `{lobbyToken, rulesAcknowledged:true, photo:{sha256}|{skippedReason}}` (api cannot see R2, so it gets the edge's statement of photo-or-skip).
  - `sessionGrant` out is the §4.2 list plus `sessionId` (see inconsistency 1); the token's `expiresAt` is not returned (the edge reads `exp` from the token).
  - `sessionStarted` out `{startedAt}` (the stored, set-once value).
- **`discardIdentityKeys(input)`** and `IDENTITY_KEYS` are exported so each edge route strips the four identity keys before strict parsing. The schemas have no identity key, which is how "ids are discarded" is documented and tested (every request schema rejects each of the four).
- **`CANDIDATE_ERROR_STATUS`** (code -> HTTP status) and `CANDIDATE_ERROR_CODES` are exported.
- `SessionMirrorMessage` is copied from the §4.4 code block unchanged (it keeps `z.number().int()` rather than `z.int()`, and the loose `z.string()` for keys and hashes).

## Field shapes the spec left open (org side, `contracts-d1.ts`)

- **`TestListResponse`** rows: `{id, name, status (draft|published|retired), versionNo, invitationCount, createdAt}`. Derived from §6.1 ("name, status, invitations").
- **`CreateTestRequest`** `{name, durationMinutes?}` (5..120). No workspace field; the api uses the org's default workspace (`tests.workspace_id` is not null and the spec is silent). The cutoff is not in this request: the draft starts at 40 (§6.2) and `UpdateTestDraftRequest` sets it.
- **`UpdateTestDraftRequest`**: `{name, durationMinutes 5..120, qualityCutoff int 0..100 (required), sections[0..2]}`. A section is `{format, name, weight int 1..100, items[0..10]}`; at most one section per format; total items <= 10; each item's format equals its section's. MCQ item `{format:'mcq', prompt, options[2..6]{id,text}, correctOptionId}` (ids unique, key must be one of them). Written item `{format:'written', prompt, rubric:{criteria[1..8]{id,label,maxPoints 1..100,anchors[1..20],minHits 1..anchors}}}` (criterion ids unique). A half-written draft (no sections, empty sections) validates, as §6.2 says "publish validates".
- **Weights** are ints 1..100 on the wire (§5.4 says integers >= 1); the DB column is `numeric(5,2)`.
- **`TestDetailResponse`** `{test:{id,name,createdAt}, version:{id,versionNo,status,durationMinutes,qualityCutoff,publishedAt|null,sections[{id,position,name,format,weight,items[...]}]}}`. Items repeat the draft item plus `id`/`position`. It carries the answer key, so it is org-side only; `status` draft iff `publishedAt` is null.
- **`PublishTestResponse`** `{testVersionId, versionNo, status:'published', publishedAt, contentSha256, qualityCutoff}`.
- **`AssignmentListResponse`** rows `{id, membershipId, asRole, displayName, createdAt}` (displayName is the org user's, for the "who is assigned" panel). `asRole` is the four `assignments.as_role` values.
- **`CreateInvitationResponse.inviteUrl`** is `string | null`; a refine ties `null` to `blocked_age`. **`InvitationListResponse`** rows `{id, label, status, createdAt, expiresAt}`.
- **`ResultRow`**: `{reportId, label, submittedAt, quality}`, `quality` = `{state:'pending'} | {state:'ready', score, belowCutoff}`. **`ResultsListResponse`** `{cutoff, rows}`. **`ReviewQueueResponse`** `{reports: [ResultRow fields + testId, testName]}` (§6.1 says "same row shape as results"; the test name is needed across tests).
- **`ReportMetaResponse`** is exactly §6.2. Prefix formats: `receiptRefPrefix` 1..8 Crockford chars, `noticeHashPrefix` 1..64 hex chars (lengths are my guess). `versions.quality` is nullable (while the quality card is pending), `versions.integrity` is not.
- **`QualityCard.ready`** `{state, score, sections[{sectionId,name,weight,scoreHundredths}], graderModelId, rubricVersion, scoringVersion}`. `sections` shape is mine (§5.4 says hundredths and weights; `quality_cards.section_scores` is an untyped jsonb array, so `QualityCardRow.section_scores` uses `{sectionId, weight, scoreHundredths}` too, which the quality job must match).
- **`IntegrityCard.ready`** `{state, band, evidenceStrength 0..1, coveragePct 0..100, photoMissing, reasons[], flags[], timeline[], signalsByFamily[], ruleTableVersion, engineVersion}`.
  - `photoMissing` is **not in §6.2's list**; I added it because §6.1 needs it for the "No start photo" panel (`integrity_cards.photo_missing`).
  - A flag is `{ruleId, family (paste|input_origin|focus), tier, atMs, count, observed, signalSeqs<=50, state:'pending'}` (the AT-D19 fields). A timeline entry is the table row camel-cased (`position, entryKind, signalKind, family, ruleId, tier, atMs, count, observed, flagState, signalSeqs`) and obeys the same CHECKs as the table (flag needs rule+tier+state, context none, `connectivity_gap` is context with family `connectivity`). `observed` keys are `len`, `durationMs`, `count` only.
  - `signalsByFamily` rows `{family, flagCount, contextCount}`; `reasons` strings are api-derived (no column).
  - `pending` and `not_used_below_cutoff` are `{state}` only, so no band/flag/timeline key can appear (rule 6).
- **`MediaLinkResponse`** `{url, expiresAt, watermark:{viewerRole (OrgRole from contracts-tenancy), org (name), issuedAt}}`; the R2 key is not a field. **`OutboxListResponse`** `{entries:[{id, createdAt, kind invite|otp, candidateLabel, bodyText}]}`; the spec lists "time, kind, candidate label, body" but `OutboundMessage` has no label field, so the outbox store must keep one.
- **`ApiError`** `{error:{code}}` with `code` matching `^[a-z][a-z0-9_]{0,63}$` (spec-named codes: `cutoff_required`, `aal2_required`, plus the generic ones). No closed enum, because §6.2 does not list them all.
- **Row schemas** `QualityCardRow`, `IntegrityCardRow`, `IntegrityTimelineEntryRow` list every column of migration 3 in snake_case, with the table CHECKs repeated (`meets_cutoff = (score >= quality_cutoff)`; timeline entry rules). Timestamps accept an offset form (PostgREST sends `+00:00`); `evidence_strength` is a JSON number.

## Rule checks in the tests

- Rule 1 (AT-D3): every exported D1 schema (including rows) is scanned at any depth for `overall|combined|total|trust|honesty|composite`; `QualityCard` has no integrity key; `IntegrityCard` has no quality/score/cutoff/grade/rubric/section key; `ResultRow` and review-queue rows have no integrity key; `ReportMetaResponse` has no card/band/flag/timeline key. `QualityCard` and `IntegrityCard` (and the row pairs, plus `ResultRow`/`ReviewQueueResponse`/`ReportMetaResponse` against each card) share no schema object, checked by reference; the D1 file builds shared pieces with factory functions so each use is a fresh node. A guard test proves the walker does detect a shared node.
- Rule 5: `Receipt` is exactly `{receiptRef, submittedAt}`; the candidate responses (`TestPackage`, `SessionView`, `Receipt`, `ServedItem` and the other responses) have no key matching `score|band|grade|outcome|cutoff|answerKey|rubric`; `TestPackage` has none matching `key|correct|answer|rubric|weight|cutoff|score|grade|band|outcome|result`.
- Rule 7: every D1 schema is scanned for `emotion|stress|personality|gaze|ai_?likeness|voiceprint|face...`; `ClientSignal` has only metadata keys (no text/content/clipboard/name/file).
- Rules 2/4/6: no D1 schema has a key matching reject/decision/decide/overturn/appeal/shortlist; below-cutoff and pending integrity payloads cannot hold a band.
- Strictness: every object at every depth of every schema is strict (`allObjectsStrict`).
