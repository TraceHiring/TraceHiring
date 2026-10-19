# Spec — M2 · Scheduling & invites

- **Revision 1 (2026-10-19, parallel docs-only SPEC chat, branch `spec/m1-m2` cut from `trace/d1/integration` @ `06a24c9`).** First draft. Questions that touch rules 1–9 or a founder answer are in `docs/progress/SPEC-M1-M2.md` (§2) with the safe default built until answered. M1 (`specs/m1-test-authoring.md`) shares the integration branch and migration order (M1 §11.1).
- Status: **draft, under autopilot review** (the approval line is added at the end of §14 when the reviewers pass).

## 0. Sources and precedence
CLAUDE.md rules 1–9 > `docs/build-notes.md` §0 > `docs/plan-conflicts.md` > `docs/adr/` > `docs/plan.md` > `docs/design/`. M2 text: `docs/build-order.md` "M2 · Scheduling & invites ∥ M1". Plan: §3.1 steps 4–5, §3.2 steps 1, 3–4, 10, §5 module B, §8.1 Messaging/Secrets rows, §9.1 (`drives`, `slots`, `candidates`, `invitations`), §10.1–10.2, §11 #10, #12, #22, #38, §12 (Capacity, Security). Build-notes Q28–Q32 (Can-default, accepted 2026-10-10), Q37 (answer), §4 "M2 — Scheduling & invites". ADRs 017, 023, 025, 027, 029, 030. **D1 is the base** (`specs/d1-demo-slice.md` §3.2 invitations, §4 candidate runtime, `packages/vendors/src/messaging.ts`); M2 extends it additively.

## 1. Scope

### 1.1 Build-order text
ABH-13 bulk invite (CSV/Excel, dedupe by phone/email) · ABH-14 drives, slots, capacity, 15-min start window, lobby 30 min early · ABH-15 reminders + one self-reschedule. `Messaging` interface: email (SES) first; SMS (DLT) and WhatsApp adapters behind flags. H: domain bought (done: `tracehiring.tech`), SES domain verified (done, sandbox) and production access requested (not yet), DLT + WhatsApp registration started (ABH-83, long lead).

**Exit gate:** 2,000 invites queued and delivered (sandbox) < 10 min with per-candidate status; duplicate rows rejected with reasons; reminders fire at the right times in a time-travel test.

### 1.2 "Done when" lines (plan §5 module B)
| Issue | Done when | Proof in M2 |
| --- | --- | --- |
| ABH-13 | 2,000 invites in <10 min; delivery status per candidate; duplicates removed | AT-M2-01 (MEASURE), 02, 03, 04 |
| ABH-14 | 20k candidates start within 60 s with no OTP load in the start minute | Mechanism at small scale (AT-M2-09, 10); the 20k measurement is a **deferred gate → M8 load test** (Q21 answer) |
| ABH-15 | Configurable per drive (reminders T−24 h, T−1 h; one self-reschedule) | AT-M2-05, 06, 07 |
| Messaging | Email via SES first; SMS/WhatsApp behind flags | AT-M2-11, 12, 13, 23 |

### 1.3 Lead decisions (AUTOPILOT §4; HOW-level or recorded Can-default)
| # | Decision | Source |
| --- | --- | --- |
| M2-1 | **"Sandbox" for the 2,000 run = a load-simulation `Messaging` adapter** with realistic latency (p50 300 ms, p99 2 s) and injected failures (2% transient, 0.5% permanent), emitting delivery events through the same ingestion function as SES; plus a **real SES smoke test to the SES mailbox simulator** on staging. SES sandbox sends only to verified addresses at ~1 msg/s, so it cannot carry 2,000 in 10 min. | Q28 |
| M2-2 | **Email only** for invites, reminders and OTP until ABH-83 completes; `SmsMessaging` and `WhatsAppMessaging` exist as mocks behind flags `MESSAGING_SMS_ENABLED`, `MESSAGING_WHATSAPP_ENABLED` (default false; refused in production until a provider ADR exists). The WhatsApp provider gets its own ADR later. | Q29 |
| M2-3 | **Contacts and names are encrypted** (AES-256-GCM, per-org data key wrapped by KMS, envelope encryption) in `services/api` before any insert; Postgres never sees plaintext. Dedupe uses **per-org HMAC-SHA-256 blind indexes** of the normalised email and phone (no cross-tenant matching, ADR-025). A `KeyManager` interface (`packages/vendors`) has a `DevKeyManager` mock (dev/staging only, refused in production) and an `AwsKmsKeyManager` (SigV4, KMS key in ap-south-1). Display hints (`e•••@example.test`, `••••1234`) are stored for list views. | Q30, plan §8.1, §9.1 |
| M2-4 | **Normalisation:** email = trim + lowercase (NFKC), RFC 5321 shape, ≤254 chars; phone = digits only, `+91` default, Indian mobiles `^[6-9][0-9]{9}$`, other countries need an explicit `+CC` and 8–15 digits (E.164). | Q30 |
| M2-5 | **Dedupe within one drive only:** reject on an email match (in file or already invited); a **phone-only match with a different email is held** with reason `phone_shared` and needs a recruiter's confirmation (`phone_dup_confirmed_by`) before it is invited (shared family phones, plan §11 fairness). | Q30 |
| M2-6 | **Under-18 from the file (rule 9, Q37):** the template has an `18 or older` column (`yes`/`no`/blank). `no` → row rejected with reason `minor`, nothing stored. **A date-of-birth column is refused** (file-level error "use the 18-or-older column") until the founder answers SPEC-M2 Q-M2-1. The candidate still self-declares at the age step (D1). | Q37, rule 9 |
| M2-7 | **Bulk parsing in the browser** (CSV by a small RFC 4180 parser, XLSX by the M1 `fflate` reader), rows sent to the api in batches of ≤200; the api re-validates everything; the file never leaves the device. | M1-9 |
| M2-8 | **Drive modes:** `open_window` (start any time from `opens_at` until `deadline_at`; the session then runs its full duration) and `scheduled` (slots). Times are `timestamptz`, displayed in IST. Capacity counts booked invitations. | Q31, plan §3.1 step 4 |
| M2-9 | **Start window and lobby (ABH-14):** for a slot, lobby opens at `starts_at − lobby_opens_minutes` (default 30), start is allowed in `[starts_at, starts_at + start_window_minutes]` (default 15). The OTP is verified **in the lobby**; the start itself needs no OTP and no Postgres read: the session grant carries `startWindow { notBefore, notAfter }` signed in the lobby token, and `SessionDO.start` checks it against its own clock. | plan §11 #38, ADR-016 |
| M2-10 | **Late arrival** (after the start window): blocked with "Your start window has passed", offered the one self-reschedule if unused, else "Contact the recruiter". | Q31 |
| M2-11 | **Self-reschedule:** once per invitation (`self_reschedules_used ≤ 1`), allowed up to 2 h before the current slot or after a missed window, to any future slot of the same drive with space, through a `portal` token (invite link + OTP with purpose `manage`, ADR-030 typ `portal`; M2 adds the reschedule route to the portal route table that ADR-030 left to M3a). Recruiter reschedules are unlimited and audited. Each reschedule rotates the link (new token version) and sends a new invite. | Q31, Q32, ADR-030 |
| M2-12 | **Invite link token** = `base64url(HMAC-SHA-256(LINK_TOKEN_KEY, org_id ‖ invitation_id ‖ token_version))` (43 chars, D1 `LinkToken` shape); only its SHA-256 is stored (as D1). The messaging consumer re-derives the token to render each message, so **no raw token is ever stored or queued**. Rotation = `token_version + 1`. A link never starts a session without an OTP (Q32). Valid until `drive end + 7 days` (status page), revocable. ADR-033 "Accepted (autopilot)" records this (Wave 0). | Q32 |
| M2-13 | **Reminders** are planned rows in `outbound_messages` (`scheduled_for = slot start − offset`; open-window anchors to `deadline_at`); offsets per drive (`reminder_offsets`, default `{24 h, 1 h}`, 0–4 offsets, each 15 min–7 days); a reminder that would fall in the past is skipped; a reschedule cancels planned reminders and plans new ones. A cron (every minute) claims due rows with `FOR UPDATE SKIP LOCKED` and enqueues them. | Q31, ABH-15 |
| M2-14 | **Delivery status per candidate** = the latest `outbound_messages.status` per invitation and purpose (`planned → queued → sent → delivered`, or `bounced`, `complained`, `failed`, `cancelled`), fed by provider events. Message bodies, recipients and OTPs are **never stored** (render at send time). | build-notes §4 |
| M2-15 | **SES events** arrive by SNS HTTPS subscription at `POST /webhooks/ses` in `services/api`: SNS signature v2 (RSA-SHA256) verified with WebCrypto against a certificate fetched only from `https://sns.ap-south-1.amazonaws.com/` and cached; topic ARN allow-list; idempotent on the SNS `MessageId`. | plan §9.2 (signed, idempotent) |
| M2-16 | **SigV4** for SES and KMS uses `aws4fetch` (small, no AWS SDK in Workers); ADR-034 "Accepted (autopilot)" (Wave 0). | ADR-027 (SES/KMS over HTTPS with SigV4) |
| M2-17 | **Pool ratio:** a `scheduled` drive refuses a test version whose pool ratio is below 10× (`private.assert_drive_pool_ratio`, M1); an `open_window` drive shows a warning only. | Q24, ABH-10 |
| M2-18 | **Version pinning:** `drives.default_test_version_id` is the published version used for **new** invites (may move forward to a newer published version of the same test); each invitation pins its version at creation and never changes (Q20). | Q20 |
| M2-19 | **D1's single invite stays** (no drive, `@example.test`, demo outbox) so D1 E2E keeps working; every M2 invitation belongs to a drive and uses encrypted contacts. | D1 E2E |
| M2-20 | **New worker role `trace_messaging_worker`** (NOLOGIN; login `jobs_messaging_login`, operator runbook): claims and updates `outbound_messages`, reads the invitation pins it needs, inserts `message_events`; nothing on `candidates`/`candidate_contacts` except ciphertext SELECT for the recipient it decrypts in memory. | least privilege |
| M2-21 | **Lab mode and bandwidth budget** are stored on `drives` (plan §9.1) and consumed later (M4 lab mode, M8 load planning); in M2 they change nothing. | M1-15 |

### 1.4 Out of scope (owner)
Live drive monitor and stuck-candidate resume links (M6, ABH-59) · public test link (M10, ABH-16) · ATS invites (M12) · real SMS/WhatsApp providers (after ABH-83 + ADR) · candidate status page beyond the reschedule screen (M3b, ABH-24) · capacity booking 48 h ahead / compute upsizing (M8 ops) · the 20k start measurement (M8) · Hindi templates (with M3b's Hindi notice; the `language` column exists).

## 2. Users and permissions
Owner, admin, recruiter (workspace fence): drives, slots, uploads, invitations, reschedule, revoke, phone-duplicate confirmation, read decrypted names (api) and hints. Reviewer: read drives and invitations of assigned tests (status only; no names or hints). Hiring manager, client viewer: nothing. Candidate: own schedule and reschedule via the portal token; never another candidate's data (rule 5: slot availability is shown as available / full only).

## 3. Data model (lead-only migrations; after M1's, M1 §11.1)

### 3.1 Migration files
| Order | File | Creates / changes |
| --- | --- | --- |
| M2-a | `<ts>_m2_contacts.sql` | role `trace_messaging_worker`; `org_keys`; `candidates`; `candidate_contacts` |
| M2-b | `<ts>_m2_drives.sql` | enums `drive_mode`, `drive_status`; `drives`; `slots`; `invite_uploads`, `invite_upload_errors`; `invitations` widened; `reschedule_events`; booking, pool-ratio, dedupe and reschedule triggers; invoker RPCs `public.ingest_invite_batch`, `public.reschedule_invitation` |
| M2-c | `<ts>_m2_messaging.sql` | `message_templates` (+ seed EN), `outbound_messages`, `message_events`; `private.plan_messages()`, `private.claim_due_messages()`, `private.record_message_event()`; view `v_invitation_delivery` (security_invoker) |

Conventions as D1 §3 and M1 §3.1. No column named `dob`, `birth`, `phone`/`email` in plaintext form: plaintext-shaped contact columns are banned by a new catalog check MT-15: no column in `public`, `private`, `quality` or `integrity` may be named `email`, `phone`, `mobile`, `full_name`, `first_name`, `last_name` or `contact_phone`, and the only column matching `%email%` without a `_ct`, `_bidx`, `_hint` or `_sha256` suffix is D1's `invitations.contact_email` (allow-listed with its `@example.test` CHECK as the reason). The lead adds MT-15 in Wave 0 with its tests.

### 3.2 Tables
- **`org_keys`**: PK `(org_id, purpose, key_version)`, `purpose text check in ('contacts','bidx')`, `kms_key_ref text` (ARN or `dev:<n>`), `wrapped_dek text` (base64, ≤1 KB), `created_at`, `retired_at null`. **No app-role grant**; `trace_api` SELECT/INSERT (first use creates version 1, `on conflict do nothing`), `trace_messaging_worker` SELECT. Policies: api arm / worker arm (ADR-029 worker-only pattern).
- **`candidates`**: `id, org_id, workspace_id, full_name_ct text (^v1\.[0-9]+\.[A-Za-z0-9_-]+$, ≤2 KB), key_version int, contact_fingerprint text (64 hex; HMAC of the normalised email, org bidx key), created_by, created_at`. Unique `(org_id, contact_fingerprint)` — the same person invited to two drives of one org is one candidate. **No DOB, age, adult flag (the adult answers stay on `invitations`, D1), gender, college or free text.**
- **`candidate_contacts`**: PK `(org_id, candidate_id)`, `workspace_id, email_ct, phone_ct null, email_bidx (64 hex), phone_bidx null (64 hex), email_hint text (≤80, `^[a-z0-9]•••@[a-z0-9.-]+$`), phone_hint text null (`^••••[0-9]{4}$`), key_version, created_at`. CHECK ciphertext shapes. W: through `ingest_invite_batch` only. S: OW AD RC (staff arm, workspace fence); `trace_messaging_worker` (ciphertext columns for its claimed messages only, via policy on the invitation join). RV, HM, CV, TS, candidate ✗.
- **`drives`**: `id, org_id, workspace_id, test_id, default_test_version_id, name (1–200), mode drive_mode ('open_window','scheduled'), status drive_status ('draft','scheduled','closed','cancelled'), opens_at, deadline_at, timezone text default 'Asia/Kolkata' check = 'Asia/Kolkata' (display only), reminder_offsets interval[] (0–4 values, each 15 min–7 days, distinct), self_reschedule_allowed boolean default true, lab_mode boolean default false, bandwidth_budget_kbps int null, expected_candidates int null (1–100,000), created_by, created_at`. CHECKs: `deadline_at > opens_at`; `mode = 'open_window' or status = 'draft' or exists slots` (trigger). Guard: `default_test_version_id` is a **published** version of `test_id` (composite FK + trigger); moving it is allowed only to a newer published version; for `scheduled` drives the guard calls `private.assert_drive_pool_ratio()` on insert, on `draft → scheduled` and on every change of the default version. Audit `drive.create|schedule|close|cancel|update {…ids}`.
- **`slots`**: `id, org_id, workspace_id, drive_id, starts_at, capacity int (1–20,000), booked int not null default 0 check (0 ≤ booked ≤ capacity), start_window_minutes int default 15 check 5..30, lobby_opens_minutes int default 30 check 15..60, status text check in ('open','closed','cancelled'), created_at`. Unique `(org_id, drive_id, starts_at)`. `booked` is outside every grant; only the booking trigger moves it (row lock). `starts_at` within `[opens_at, deadline_at]` of the drive. A slot with `booked > 0` cannot be cancelled until its invitations are moved (409).
- **`invite_uploads`**: `id, org_id, workspace_id, drive_id, source_kind ('csv','xlsx'), file_sha256 (64 hex; computed in the browser, used only to warn about a re-upload), status ('open','completed','cancelled'), rows_total, rows_invited, rows_rejected, rows_held, created_by, created_at, completed_at`. No file is stored.
- **`invite_upload_errors`**: PK `(org_id, upload_id, row_no)`, `reason text check in ('missing_name','missing_contact','invalid_email','invalid_phone','duplicate_email_in_file','duplicate_phone_in_file','already_invited','phone_shared','minor','bad_adult_value','bad_slot','slot_full','name_too_long','row_limit','unknown_column')`, `held boolean default false` (`phone_shared` rows are held, not final). **No cell value column** (Q30).
- **`invitations`** (D1, widened): new nullable columns `drive_id`, `slot_id`, `upload_id`, `email_bidx`, `phone_bidx` (copied from the contact by the guard), `token_version int not null default 1`, `phone_dup_confirmed_by uuid null`, `self_reschedules_used smallint not null default 0 check 0..1`, `language text not null default 'en' check in ('en','hi')`, `channels text[] not null default '{email}'` (subset of `email,sms,whatsapp`). `contact_email` (D1) becomes nullable with CHECK `contact_email is null or <D1 example.test pattern>`, and `(drive_id is null) = (contact_email is not null)` (D1 ad-hoc rows vs M2 drive rows). `candidate_id` for drive rows has a composite FK to `candidates` (D1 rows keep their pseudonymous ids; a partial FK is enforced by trigger: `drive_id is not null ⇒ candidate exists`). **Unique partial index** `(org_id, drive_id, email_bidx) where drive_id is not null and status <> 'revoked'` (email dedupe, Q30). **Phone rule (trigger):** inserting a drive invitation whose `phone_bidx` matches a live invitation of the same drive with a different `email_bidx` is refused unless `phone_dup_confirmed_by` is set to the caller (`auth.uid()`), audited `invitation.phone_dup_confirmed`. `slot_id` required iff the drive is `scheduled`; the booking trigger increments `slots.booked` on insert and moves it on slot change, decrementing on `revoked`/`expired` (all under the slot row lock; a full slot raises `TRACE_GUARD: slot full`). `expires_at` for drive rows = drive `deadline_at` (or last slot end) + 7 days (set by the guard). **Guard changes (D1 `invitations_guard`):** `authenticated` may also update `slot_id` (recruiter reschedule) and `phone_dup_confirmed_by` (only from null to `auth.uid()`); `trace_api` may update `slot_id`, `token_version` (+1 only), `link_token_hash` (only together with `token_version`) and `self_reschedules_used` (0 → 1 only) for the self-reschedule path; `token_version`/`link_token_hash` rotate on every reschedule; nobody else gains anything. The D1 state machine is unchanged (no `rejected`, rule 2).
- **`reschedule_events`** (append-only, `TRACE_APPEND_ONLY` as D1 `consents`): `id, org_id, workspace_id, invitation_id, actor_kind ('org_user','candidate'), actor_user_id null, from_slot_id, to_slot_id, reason_code ('candidate_self','recruiter','slot_cancelled'), occurred_at`. W: the reschedule paths only. S: OW AD RC; RV (assigned tests, without `actor_user_id`: column grant).
- **`message_templates`** (library org, migration only, immutable): `id, org_id, purpose ('invite','reminder','reschedule','otp'), channel ('email','sms','whatsapp'), language ('en','hi'), version int, subject_template (≤200, email only), body_template (≤5,000), provider_template_ref text null (DLT/WhatsApp ids later), body_sha256`. Variables allowed: `{{candidate_first_name}}, {{org_name}}, {{test_name}}, {{starts_at_ist}}, {{deadline_ist}}, {{duration_minutes}}, {{invite_url}}, {{otp}}, {{device_note}}`. Seed: EN email templates for the four purposes; the invite says date, duration, device needed and what is recorded (plan §3.2 step 1) — the practice-test link arrives with M3b.
- **`outbound_messages`**: `id, org_id, workspace_id, drive_id null, invitation_id, template_id, channel, purpose, idempotency_key text (`${invitation_id}:${purpose}:${token_version}:${scheduled_for_epoch}`), scheduled_for, status text check in ('planned','queued','sent','delivered','bounced','complained','failed','cancelled'), provider text null, provider_message_id text null, attempts smallint default 0 check 0..8, last_error_code text null (enum list), queued_at, sent_at, delivered_at, created_at`. Unique `(org_id, idempotency_key)`, `(provider, provider_message_id)`. Forward-only status (guard; `cancelled` only from `planned`). **No body, subject, recipient, OTP or token column.** W: `private.plan_messages` (trigger), `trace_messaging_worker`, `private.record_message_event`. S: OW AD RC (staff arm); RV assigned (status only).
- **`message_events`** (append-only): `id, org_id, outbound_message_id, provider, provider_event_id (unique per provider), event text check in ('send','delivery','bounce','complaint','reject','delivery_delay'), bounce_kind text null ('permanent','transient','undetermined'), occurred_at, received_at`. No recipient, diagnostic text or provider payload stored.

### 3.3 Functions and triggers (`private`, DEFINER, `search_path = ''` unless INVOKER is stated)
| Name | Behaviour |
| --- | --- |
| `public.ingest_invite_batch(p_upload uuid, p_rows jsonb)` (**INVOKER**, EXECUTE `authenticated`) | ≤200 pre-validated, **pre-encrypted** rows from the api: upserts `candidates` by `contact_fingerprint`, inserts `candidate_contacts` (first time), inserts invitations (label trigger, booking trigger, dedupe), records `invite_upload_errors` for rows refused by a constraint (maps the SQLSTATE/constraint to a reason), idempotent on `(upload_id, row_no)`; returns per-row outcome `{rowNo, invitationId? , reason?, held?}` |
| `public.confirm_phone_duplicates(p_upload uuid, p_row_nos int[])` (INVOKER) | re-runs held rows with `phone_dup_confirmed_by = auth.uid()` |
| `public.reschedule_invitation(p_invitation uuid, p_to_slot uuid)` (INVOKER, recruiter path) | moves the slot (booking trigger), rotates the token, writes `reschedule_events`, re-plans messages |
| `private.self_reschedule(p_org uuid, p_invitation uuid, p_to_slot uuid, p_now timestamptz, p_new_hash text)` (EXECUTE `trace_api`) | the candidate path: checks `self_reschedule_allowed`, `self_reschedules_used = 0`, `p_now ≤ current slot start − 2 h` **or** the current window has passed without a start, target slot in the same drive, open, in the future, with space; then as above with `actor_kind = 'candidate'` |
| `private.plan_messages()` (AFTER INSERT/UPDATE OF `slot_id`, `token_version`, `status` on `invitations`) | invite now (`scheduled_for = now()`), reminders per `reminder_offsets` (skipped if in the past); on reschedule cancels `planned` reminders and plans new ones plus a `reschedule` message; on `revoked`/`expired`/`blocked_age` cancels all `planned` |
| `private.claim_due_messages(p_now timestamptz, p_limit int)` (EXECUTE `trace_messaging_worker`) | `UPDATE … SET status = 'queued' … WHERE status = 'planned' AND scheduled_for <= p_now ORDER BY scheduled_for LIMIT p_limit FOR UPDATE SKIP LOCKED RETURNING …` (ids only); `p_now` must be within 10 min of `now()` unless the session is the operator (tests run as operator for time travel) |
| `private.record_message_event(…)` (EXECUTE `trace_messaging_worker`, `trace_api`) | idempotent insert into `message_events` + forward-only status move on `outbound_messages` |
| `private.resolve_invitation_by_hash` (D1) | widened to return `drive_id`, `slot_id`, the slot times and `self_reschedules_used` (never contacts) |
| `v_invitation_delivery` (security_invoker) | per invitation: label, status, slot, hints (staff only through the column grant), latest status per purpose |

### 3.4 RLS matrix (allowed + denied pgTAP per cell, cross-org and workspace-fenced personas)
| Table | S | I | U | D |
| --- | --- | --- | --- | --- |
| `org_keys` | `trace_api`, `trace_messaging_worker` | `trace_api` | ✗ | ✗ |
| `candidates` | OW AD RC | via `ingest_invite_batch` (OW AD RC) | ✗ | ✗ |
| `candidate_contacts` | OW AD RC; messaging worker (claimed rows) | via `ingest_invite_batch` | ✗ | ✗ |
| `drives`, `slots` | OW AD RC; RV (assigned tests) | OW AD RC | OW AD RC (guard) | OW AD RC (`draft` drives / unbooked slots only) |
| `invite_uploads`, `invite_upload_errors` | OW AD RC | OW AD RC | OW AD RC (cancel) | ✗ |
| `invitations` | D1 + messaging worker (pins, status) | D1 + `ingest_invite_batch` | D1 + slot / phone confirm (staff), self-reschedule (`trace_api`) | ✗ |
| `reschedule_events` | OW AD RC; RV (no `actor_user_id`) | reschedule paths | ✗ | ✗ |
| `message_templates` | OW AD RC (library rows) | ✗ | ✗ | ✗ |
| `outbound_messages` | OW AD RC; RV (status columns) | `plan_messages` | messaging worker; `record_message_event` | ✗ |
| `message_events` | OW AD RC | `record_message_event` | ✗ | ✗ |
`trace_candidate`, `anon`, `service_role`, hiring_manager, client viewer: nothing (`rls_m2_candidate_denied`).

### 3.5 Invariants (new)
I-M2-1 No plaintext name, email or phone in any column (MT-15 + ciphertext CHECKs). I-M2-2 Email dedupe per drive (unique index); phone-only duplicates need a named confirmation (trigger). I-M2-3 `0 ≤ booked ≤ capacity` under concurrency (row lock + CHECK). I-M2-4 `self_reschedules_used ≤ 1`. I-M2-5 An invitation's `test_version_id` never changes; a drive's default version is always a published version of its test; scheduled drives satisfy the 10× pool ratio. I-M2-6 Message idempotency keys unique per org; status forward-only; no message content stored. I-M2-7 Append-only `reschedule_events`, `message_events`. I-M2-8 No `rejected` status or column anywhere (rule 2, MT-6). I-M2-9 No DOB/age column (MT-3); an under-18 row is never stored.

## 4. State machines
- **Drive:** `draft → scheduled` (needs ≥1 slot for `scheduled` mode, pool ratio for `scheduled`) `→ closed` (manual, or automatically after `deadline_at` by the sweep) · `draft|scheduled → cancelled` (cancels planned messages; invitations go `revoked` only by an explicit recruiter bulk action with a reason code, never automatically).
- **Slot:** `open → closed` (full is not a state; it is `booked = capacity`) · `open → cancelled` only when `booked = 0`.
- **Invitation:** D1 states and their forward-only order are unchanged (no `rejected`, rule 2). M2 adds slot moves, which never move the status: a recruiter may move an invitation in `created` or `sent`; the candidate's self-reschedule is allowed in `created`, `sent` or `otp_verified` (after a missed window the status stays `otp_verified` and the new slot's window applies). `started`, `submitted`, `expired`, `revoked` and `blocked_age` cannot be moved.
- **Outbound message:** `planned → queued → sent → delivered | bounced | complained`; `queued|sent → failed` (after 8 attempts or a permanent error); `planned → cancelled`.
- **Upload:** `open → completed | cancelled`.

## 5. Contracts (`packages/shared/src/contracts-m2.ts`, lead, Wave 0)
`DriveMode`, `DriveStatus`, `CreateDriveRequest { name, testId, defaultTestVersionId, mode, opensAt, deadlineAt, reminderOffsetsMinutes: int[] 0–4 (15–10080), selfRescheduleAllowed, labMode, expectedCandidates? }`, `DriveDetail`, `SlotsCreateRequest { slots: {startsAt, capacity}[] 1–500 } | { generator: {firstStartsAt, count 1–500, intervalMinutes 15–1440, capacity} }`, `SlotView { id, startsAt, capacity, booked, startWindowMinutes, lobbyOpensMinutes, status }`, `InviteRow { rowNo, fullName 1–200, email?, phone?, adult18: 'yes' | 'no' | null, slotStartsAt?, language? }` (the api's input after browser parsing; `fullName` Unicode letters, marks, spaces, `.'-`), `InviteBatchRequest { uploadId, rows: InviteRow[] 1–200 }`, `InviteBatchResponse { results: {rowNo, invitationId?, reason?, held?}[] }`, `InvitationRow { invitationId, label, nameDisplay?, emailHint?, phoneHint?, slotStartsAt?, status, delivery: {invite, reminder?, reschedule?: MessageStatus} }` (names decrypted by the api only for OW/AD/RC), `RescheduleRequest { toSlotId }`, `MessageStatus`. Candidate side (in `contracts-candidate.ts`): `InviteResolveRes` gains `schedule: { mode, slotStartsAt?, lobbyOpensAt?, startWindowEndsAt?, deadlineAt?, durationMinutes } | null` and `next` gains `'wait_lobby' | 'reschedule_offer' | 'window_missed' | 'closed'`; `OtpRequestReq` gains `purpose: 'lobby' | 'manage'`; `PortalSlotsRes { slots: { slotId, startsAt, available: boolean }[] }` (**no counts**, rule 5); `PortalRescheduleReq { toSlotId }`; `CandidateTokenClaims` gains optional `sw: { nb: int, na: int }` (start window, epoch seconds) on `lobby`/`session` tokens. `Messaging` v2 (vendors): `send({ orgId, channel, purpose, to, subject?, bodyText, idempotencyKey }) → { provider, providerMessageId, status: 'accepted' }`; `KeyManager { generateDataKey(orgId, purpose) → {plaintext: CryptoKey, wrapped, keyVersion}, unwrap(orgId, purpose, wrapped) → CryptoKey }`.

## 6. Feature behaviour

### 6.1 Drives and slots (ABH-14)
`/drives/new`: test + version (published only), mode, window, reminder offsets (default 24 h + 1 h), self-reschedule toggle, lab mode; slots by list or generator. Publishing the drive (`draft → scheduled`) runs the pool-ratio check for `scheduled` mode. The drive page shows slots (booked/capacity), invitations with per-candidate status, and reminder plan per slot.

### 6.2 Bulk invite (ABH-13)
Templates `trace-invites-v1.csv` / `.xlsx` with columns `full_name, email, phone, 18_or_older, slot_starts_at (scheduled drives; blank = auto-assign the earliest slot with space, in file order), language`. Browser parses (≤ 5,000 rows, ≤ 5 MB), shows counts, posts batches of 200 with concurrency 2. **api per row:** zod shape → normalise (M2-4) → in-batch and in-upload duplicate detection by normalised value (the upload keeps a per-upload in-memory set within the request; across batches the DB index decides) → `adult18 = 'no'` → `minor` (nothing encrypted or stored) → encrypt name/email/phone with the org DEK, compute blind indexes and hints, compute the link token hash for `token_version = 1` → `ingest_invite_batch`. Response lists every row's outcome; the screen shows rejected rows (row number + reason in plain words, **never the cell value**) and held `phone_shared` rows with a "Confirm these are different people" action. Cancelled uploads keep what was invited (each invitation can be revoked).

### 6.3 Messaging pipeline (Messaging interface; ABH-13, ABH-15)
`plan_messages` creates `planned` rows. **Cron** (`workers/jobs` scheduled handler, every minute, `trace_messaging_worker`): `claim_due_messages(now, 500)` → enqueue ids to Queue `trace-messages` (batches of 50). **Consumer:** per message: load pins and ciphertext → unwrap DEK (cache ≤ 5 min per isolate) → decrypt recipient and first name in memory → re-derive the link token (M2-12) → render the template (no HTML injection: variables are text-escaped into a fixed HTML skeleton and a text part) → `Messaging.send` with the idempotency key → mark `sent` + `provider_message_id`; transient errors retry with backoff (Queue retry, max 8 attempts) → `failed`. Rate limit per org and channel (SES account send rate read from config; default 14/s once out of sandbox, 1/s in sandbox; the load-sim adapter declares 50/s). **Nothing decrypted is logged; errors carry codes only.** OTP emails (D1 `MessagingSend` RPC) switch from the demo outbox to the configured email adapter for drive invitations; D1 ad-hoc `@example.test` invitations keep the outbox.

### 6.4 Adapters and environment guards
| Adapter | Envs | Recipient guard |
| --- | --- | --- |
| `OutboxMessaging` (D1) | dev, staging | `@example.test` only (D1) |
| `LoadSimMessaging` (new) | dev, staging, CI | any syntactically valid synthetic address under `@example.test` or `@loadsim.test`; never sends |
| `SesEmailMessaging` (new) | staging (and production after M8) | **non-production: only `@simulator.amazonses.com` addresses and the SES-verified founder test inbox configured as `SES_ALLOWED_TEST_RECIPIENT_SHA256` (hash, no address in config)**; anything else throws `bad_recipient` before any network call (founder gate: no real email to real people before M8) |
| `SmsMessaging`, `WhatsAppMessaging` (mocks) | dev, staging behind flags | `+91999…` reserved test numbers only; production refused |
The factory picks the adapter from `MESSAGING_EMAIL_PROVIDER` (`outbox | loadsim | ses`) and refuses any adapter not allowed in `TRACE_ENV` (boundary check + runtime guard, as D1).

### 6.5 Lobby, start window and late arrival (ABH-14)
`invite/resolve` (D1, edge → api) returns the schedule. Before `lobbyOpensAt`: `next = 'wait_lobby'` with the time (no OTP sent). In the lobby window: OTP (purpose `lobby`) → age → consent → photo (D1 order); the api mints the lobby/session tokens with `sw = {nb: slot start, na: slot start + window}` (open-window: `nb = opens_at`, `na = deadline_at`). `SessionDO.start` refuses outside `[nb, na]` by its own clock (409 `outside_start_window`); the OTP for 20k candidates is spread over the 30-minute lobby, not the start minute. After `na` without a start: `next = 'window_missed'` → `reschedule_offer` if allowed and unused. OTP purpose `lobby` is refused outside the lobby window (`lobby_closed`), so OTP load is bounded to the lobby.

### 6.6 Self-reschedule (ABH-15)
Candidate app screen `/i#<token>` → "Can't make this time?" (shown when allowed) → OTP (purpose `manage`) → portal token (30 min, ADR-030) → `GET /p/slots` (future open slots of the same drive with `available` booleans) → `POST /p/reschedule { toSlotId }` → api `private.self_reschedule` → new invite message with the rotated link; the old link stops working (hash changed). Recruiter: drive page action "Move to slot" (unlimited, reason `recruiter`, audited).

## 7. Edge cases
| # | Case | Behaviour |
| --- | --- | --- |
| E1 | Same email twice in one file | Second row `duplicate_email_in_file` |
| E2 | Email already invited to this drive | `already_invited` (unique index) |
| E3 | Same email in another drive of the org | Allowed; same `candidates` row reused |
| E4 | Same email in another org | Allowed; no cross-org match (per-org bidx keys) |
| E5 | Siblings sharing a phone, different emails | Second row held `phone_shared` until a recruiter confirms; then invited with `phone_dup_confirmed_by` |
| E6 | Two uploads race on the same email | Unique index: one wins, the other row is `already_invited` |
| E7 | Slot fills during an upload | Row `slot_full` (named slot) or next slot with space (auto-assign); no overbooking under concurrency |
| E8 | Reminder offset falls in the past (late invite) | Skipped; invite still sent |
| E9 | Reschedule after T−24 h reminder was sent | Remaining planned reminders cancelled; new ones planned for the new slot; a `reschedule` message sent |
| E10 | Candidate tries a second self-reschedule | 409 `reschedule_used` (DB CHECK backs it) |
| E11 | Self-reschedule within 2 h of the slot | 409 `too_late_to_reschedule`, unless the window was missed |
| E12 | Candidate arrives at minute 16 | `window_missed`; reschedule offer if available |
| E13 | Client clock wrong | Ignored: lobby and window checks use api / DO clocks only |
| E14 | Bounce for an invite | Status `bounced`; recruiter sees it per candidate; no automatic action |
| E15 | SNS replays the same notification | No-op (unique `provider_event_id`) |
| E16 | Forged SNS request | Signature / cert host / topic check fails → 403, nothing written |
| E17 | Queue delivers the same message twice | Idempotency key; the adapter call is skipped if `sent` already |
| E18 | KMS unavailable | Upload batch fails with 503 `crypto_unavailable` (no plaintext fallback); consumer retries |
| E19 | Drive's default version moves to v2 mid-drive | New invites pin v2; existing invites keep v1 (Q20); results record versions |
| E20 | Under-18 row | Rejected `minor`; nothing stored about the person |
| E21 | DOB column present | File refused (M2-6) |
| E22 | Name with Devanagari / Tamil script | Accepted (Unicode letters); rendered correctly in email (UTF-8) |
| E23 | Formula injection in CSV export (later M6) | Not applicable in M2 (no export); hints never start with `=+-@` |
| E24 | Drive cancelled with invitations | Planned messages cancelled; invitations stay as they are until the recruiter revokes them (no automatic status change) |
| E25 | A candidate sees slot availability | Booleans only; never counts or other candidates (rule 5) |

## 8. Day-one checks (BUILD Wave 0)
DC-M2-1 `aws4fetch` SigV4 to SES v2 `SendEmail` and KMS `GenerateDataKey`/`Decrypt` from a Worker in staging with the `trace-staging-app` IAM user (founder gate F-3). DC-M2-2 SNS → Worker subscription confirmation and a mailbox-simulator delivery event round trip. DC-M2-3 Cron + Queue throughput on the current plan for 2,000 messages (Workers Free CPU: OPEN-8a). DC-M2-4 `FOR UPDATE SKIP LOCKED` claim through the Workers Postgres driver (ADR-031). DC-M2-5 WebCrypto AES-GCM + HMAC cost for a 200-row batch within the Workers CPU budget.

## 9. Security notes for reviewers
Encryption boundary (plaintext only in api/jobs memory; DEK cache lifetime; no logging), blind-index key per org, link-token derivation (ADR-033; key compromise exposes links but links still need an OTP), SNS webhook verification, recipient guards in every non-production env, the portal token reschedule route, `ingest_invite_batch` as INVOKER, rate limits on `otp/request` purpose `manage` (D1 per-invitation limits apply), no PII in errors/logs/Sentry (D1 scrubber).

## 10. pgTAP plan (`supabase/tests/rls_m2_*.test.sql`, lead)
`rls_m2_keys` · `rls_m2_candidates` (ciphertext shapes, no plaintext, fence) · `rls_m2_contacts` · `rls_m2_drives` (default version rules, pool ratio for scheduled, states) · `rls_m2_slots` (booking concurrency with two sessions, capacity CHECK, cancel rules) · `rls_m2_invitations` (dedupe index, phone confirmation, version pin, guard per role incl. self-reschedule and rotation) · `rls_m2_uploads` · `rls_m2_reschedule` (append-only, once, 2 h rule with `p_now`) · `rls_m2_messages` (plan/claim/record with operator time travel; forward-only; idempotency; no content columns) · `rls_m2_candidate_denied` · catalog MT-15.

## 11. BUILD plan
Branch and order: M1 §11.1 (`m12/integration`; M2 migrations after M1's). **Wave 0 (lead):** migrations M2-a…c and pgTAP red first; `contracts-m2.ts` and the candidate contract changes; ADR-033 (link token), ADR-034 (`aws4fetch`); MT-15; wrangler: Queue `trace-messages`, cron on `workers/jobs`, secrets `LINK_TOKEN_KEY`, AWS credentials (names only; founder gates); operator runbook for `jobs_messaging_login`.
| Stream | Owns | Needs | Model | Reviews |
| --- | --- | --- | --- | --- |
| B1 crypto + vendors | `packages/pii-crypto/**` (new: normalise, encrypt/decrypt, bidx, hints, link token derive), `packages/vendors/src/{messaging-*,key-manager*}` | contracts | Opus | spec, security |
| B2 api | `services/api/src/modules/{drives,slots,uploads,candidates,messages,webhooks}/**`, `modules/candidate/**` schedule/portal changes | B1, migrations | Opus | spec, security, database |
| B3 jobs | `workers/jobs/src/{messaging,scheduler}/**` | B1, migrations | Opus | spec, security, database |
| B4 edge | `workers/edge/src/lobby/**`, the start-window check in `session-do*` **after M1's A4 merges** | contracts | Opus | spec, security |
| B5 recruiter app | `apps/recruiter/src/drives/**` | contracts (fake fetch) | Sonnet, Opus review | spec, security |
| B6 candidate app | `apps/candidate/src/{schedule,reschedule}/**` | contracts | Sonnet, Opus review | spec, security |
Waves (shared with M1, ≤3 writers): M1 Wave 1 (A1, A6, A2) → M2 Wave 1 (B1, then B2 ∥ B3) → M1 Wave 2 (A3, A4, A5) → M2 Wave 2 (B4, B5, B6) → E2E.

## 12. Acceptance tests
| AT | Gate item | Test file(s) and what it proves |
| --- | --- | --- |
| AT-M2-01 | **Exit / ABH-13: 2,000 invites queued and delivered (sandbox) < 10 min** | MEASURE + E2E `e2e/tests/m2-bulk-2000.spec.ts` (local stack, Linux CI, `MESSAGING_EMAIL_PROVIDER=loadsim`, real cron + Queue in `wrangler dev`): upload a generated 2,000-row CSV to a scheduled drive; asserts 2,000 invitations and 2,000 `invite` messages `delivered` (or `failed` with a code for the injected permanent failures, each visible per candidate) within 600 s of the first batch; records `elapsed_ms` |
| AT-M2-02 | **Per-candidate delivery status** | `services/api/src/modules/messages/status.test.ts` + `rls_m2_messages`: `v_invitation_delivery` shows the latest status per purpose; the drive list API returns it per candidate |
| AT-M2-03 | **Exit: duplicate rows rejected with reasons** | `services/api/src/modules/uploads/rows.test.ts` (every reason in §3.2 from fixtures; responses carry no cell value) + `rls_m2_invitations` (unique index across uploads; concurrent insert) |
| AT-M2-04 | Phone-shared held for confirmation | `rls_m2_invitations` (refused without `phone_dup_confirmed_by`; allowed with the caller's id; audited) + `uploads/confirm.test.ts` |
| AT-M2-05 | **Exit: reminders fire at the right times (time travel)** | `workers/jobs/src/scheduler/time-travel.test.ts` (fake clock over a drive with slots at T, offsets 24 h and 1 h: nothing is claimed before T−24 h, the 24 h reminder at T−24 h, the 1 h reminder at T−1 h, nothing after a reschedule's cancellation, the past-offset skip, open-window anchored to the deadline) + `rls_m2_messages` (`claim_due_messages` with operator `p_now` values) |
| AT-M2-06 | ABH-15 configurable per drive | `rls_m2_drives` + `drives/create.test.ts` (0–4 offsets, bounds, distinct; the plan follows the drive's offsets) |
| AT-M2-07 | One self-reschedule | `rls_m2_reschedule` (second refused; 2 h rule; missed-window path; append-only event) + `modules/candidate/portal.test.ts` |
| AT-M2-08 | Capacity | `rls_m2_slots` (two concurrent bookings on the last seat: one fails; `booked` returns on revoke) |
| AT-M2-09 | 15-min start window, lobby 30 min early | `workers/edge/src/lobby/window.test.ts` (OTP `lobby` refused before lobby opens; start refused before `nb` and after `na` by the DO clock with a skewed client) + `modules/candidate/schedule.test.ts` |
| AT-M2-10 | No OTP load in the start minute (ABH-14 proxy) | `workers/edge/src/lobby/start-path.test.ts`: the start request path makes no OTP call and no api/Postgres call before `SessionDO.start` acknowledges; 20k measurement deferred to M8 (§13) |
| AT-M2-11 | Messaging interface and flags | `packages/vendors/src/messaging-ses.test.ts` (SigV4 request shape against a fixture, no network), `messaging-factory.test.ts` (env × provider matrix; SMS/WhatsApp off by default; production refuses mocks), recipient guards |
| AT-M2-12 | Real SES smoke (sandbox) | `scripts/smoke-ses.mjs` run by `workflow_dispatch` on staging: one email to `success@simulator.amazonses.com` and one to `bounce@…`; the matching `delivery`/`bounce` events arrive via SNS within 5 min; recorded in the M2 summary |
| AT-M2-13 | Webhook signed and idempotent | `services/api/src/modules/webhooks/ses.test.ts` (valid signature accepted; tampered, wrong cert host, wrong topic refused; replay no-op; subscription confirmation only for the allow-listed topic) |
| AT-M2-14 | Pool ≥10× at scheduling (ABH-10, with M1) | `rls_m2_drives`: scheduling a drive on a version with ratio 9.9 or an inline-only section fails; 10× passes; open-window allowed (API returns a warning) |
| AT-M2-15 | Encryption and blind index | `packages/pii-crypto/src/*.test.ts` (round trip, tamper detection, per-org bidx differs, normalisation vectors incl. +91 rules) + `rls_m2_candidates` (no plaintext column; ciphertext CHECKs) + MT-15 |
| AT-M2-16 | Under-18 from the file (rule 9) | `uploads/rows.test.ts` (`no` → `minor`, nothing persisted, no audit detail with the value; DOB column → file refused) |
| AT-M2-17 | Version pinning | `rls_m2_drives` + `rls_m2_invitations` (default version must be published and of the test; moving forward only; existing invitations unchanged) |
| AT-M2-18 | RLS matrix | all `rls_m2_*` files; floor raised |
| AT-M2-19 | No PII in logs, messages or errors | `log-hygiene` tests for the new api and jobs modules (synthetic names/emails never in logs or thrown messages); `rls_m2_messages` column scan (no body/recipient/token) |
| AT-M2-20 | Link token derivation and rotation | `packages/pii-crypto/src/link-token.test.ts` (deterministic, 43 chars, version change → different token; only SHA-256 leaves) + `rls_m2_invitations` (rotation only with version + 1) + edge test (old link after rotation → `not_found`) |
| AT-M2-21 | Candidate isolation (rule 5) | `modules/candidate/portal.test.ts` (slots list has booleans only; another invitation's id in the body is ignored) + `rls_m2_candidate_denied` |
| AT-M2-22 | No reject path (rules 2, 4, 6) | `route-inventory.test.ts` extended; `apps/recruiter/src/drives/m2-guards.test.tsx` |
| AT-M2-23 | No real recipient from non-production | `messaging-factory.test.ts` + `messaging-ses.test.ts` (any non-allowed recipient throws before a network call in dev and staging) |

## 13. Deferred gates (for `docs/milestones/M2-summary.md`)
| Check | Proxy that closes M2 | Owner |
| --- | --- | --- |
| ABH-14: 20k candidates start within 60 s | AT-M2-09, AT-M2-10 | M8 load test (Q21) |
| ABH-13 on real SES (production access, real send rate) | AT-M2-01 (load-sim) + AT-M2-12 (simulator) | M8 (SES production access requested by the founder) |
| SMS (DLT) and WhatsApp real adapters | mocks behind flags (AT-M2-11) | after ABH-83 + a provider ADR (Phase 0 before beta if the founder wants them at M8) |

## 14. OPEN
- OPEN-M2-1: Q-M2-1 (date of birth in the invite file) — founder; default: refuse the column.
- OPEN-M2-2: founder gates F-2…F-5 in `docs/progress/SPEC-M1-M2.md` (AWS credentials for Workers, IAM policy scope, SNS topic, SES production access) — BUILD can proceed on mocks; AT-M2-12 needs them.
- OPEN-M2-3: DC-M2-3/5 Workers CPU (OPEN-8a).
