# Spec — M1 · Test authoring

- **Revision 1 (2026-10-19, parallel docs-only SPEC chat, branch `spec/m1-m2` cut from `trace/d1/integration` @ `06a24c9`).** First draft. Questions that touch rules 1–9 or a founder answer are **not decided here**; they are in `docs/progress/SPEC-M1-M2.md` (§2) with the safe default this spec builds until the founder answers. M2 (`specs/m2-scheduling-invites.md`) is specified in the same chat and shares §11's migration order.
- Status: **draft, under autopilot review** (the approval line is added at the end of §14 when the reviewers pass).

## 0. Sources and precedence
CLAUDE.md rules 1–9 > `docs/build-notes.md` §0 founder answers > `docs/plan-conflicts.md` > `docs/adr/` > `docs/plan.md` > `docs/design/` (AUTOPILOT §1). M1 text: `docs/build-order.md` "M1 · Test authoring ∥ M2". Plan: §3.1 steps 1–3, §4 (formats, content pipeline), §5 module A, §8.2 rule 4, §9.1 (`jobs`, `tests`, `sections`, `items`, `item_variants`, `pools`), §11 #22, #31. Build-notes: Q18–Q27 (all "Can-default", accepted as written by the founder on 2026-10-10, §0 row "Can-default"), Q20 (answer), Q21 (answer), §4 "M1 — Test authoring" and the invariants list. Design: screen 04 (`docs/design/screens/04-assessment-setup-integrity.png`; plan wins where they differ, build-notes Q33/Q34). **D1 is the base:** every D1 table, trigger and contract named here is the one in `specs/d1-demo-slice.md` §3 and in migrations `20261014065417_d1_authoring.sql` … `20261014175327_d1_media_audit.sql`; M1 extends them additively (fix forward, never edit a placed migration).

## 1. Scope

### 1.1 Build-order text (verbatim scope)
ABH-5 role templates + JD → blueprint · ABH-10 pools, sections, shuffle, per-section timers, server-side item delivery model · ABH-9 Excel/Word import · ABH-8 AI drafting with human approval (via `LlmGrader`/Bedrock interface) · ABH-7 parameterised quant variants · ABH-6 item-bank tooling (content itself is a human task). Integrity presets + per-signal settings + admin locks (screen 04). A test version — items, settings and ruleset — is immutable from publish; editing a published test creates a new draft version; each invitation keeps the version it was sent with (Q20). Wedge first: role templates for BPO Voice and Customer Support (plan-conflicts #13).

**Exit gate:** ABH-5/7/8/9/10 "Done when" tests pass (ABH-5's 5-recruiter measurement may be a deferred gate, rule 6); an AI-drafted item cannot be served without an approver ID (DB constraint + test); editing a published version is rejected by the database; 500-item import with images < 5 min (measured).

### 1.2 "Done when" lines (plan §5 module A) and where each is proven (§12 has the tests)
| Issue | Done when | Proof in M1 |
| --- | --- | --- |
| ABH-5 | 5 recruiters each publish a test from a template in a median of ≤5 min | Automated timed-publish proxy (AT-M1-01); the real 5-recruiter measurement is a **deferred gate, owner ≤ M8** (Q21 answer) |
| ABH-6 | Every item expert-reviewed, tagged by skill and difficulty, with exposure counter | DB constraints + counter trigger (AT-M1-02, 03) |
| ABH-7 | ≥40% of quant items vary per candidate; difficulty within ±0.1 of the parent item | Generator constraint + DB trigger + the share metric query (AT-M1-04, 05, 06); the ≥40% **content** target and the **empirical** difficulty check are deferred gates (§13) |
| ABH-8 | No AI item reaches a candidate without an approver logged | DB CHECK + publish guard + serving trigger + audit row (AT-M1-07, 08, 09) — also the exit-gate item |
| ABH-9 | 500 items with images in <5 min; error shown for each bad row | Measured E2E (AT-M1-10) + per-row error tests (AT-M1-11) |
| ABH-10 | Pool ≥10× the items each candidate draws for drives | Frozen `min_pool_ratio` at publish + `private.assert_drive_pool_ratio()` (AT-M1-12); M2's drive trigger calls it (M2 AT-M2-14) |
| Q20 | Published version immutable; edit → new draft; invitation keeps its version | AT-M1-13, 14 (exit-gate item "editing a published version is rejected by the database") |
| Presets | Strict / Standard / Open-book, per-signal settings, admin locks | AT-M1-15, 16, 17 |

### 1.3 Lead decisions (AUTOPILOT §4; each is HOW-level or a recorded Can-default)
| # | Decision | Source |
| --- | --- | --- |
| M1-1 | **Bank model.** New `items` (identity) table; `item_versions` becomes the immutable versioned content for **both** bank items (`section_id is null`) and D1-style inline section items (`section_id` set). A section either serves its inline items (D1 mode, `draw_count is null`) **or** draws from one pool (`pool_id` set, `draw_count` set); never both (publish guard). | build-notes §4 M1, D1 §3.2 "M1 adds `items`" |
| M1-2 | **Item lifecycle** `draft → in_review → approved → retired`, plus `rejected` (terminal). Content is immutable once a version leaves `draft`; an edit creates a new `item_versions` row (`version_no + 1`) with `approved_by = null` (Q23). Build-notes' `live` state is dropped: "approved" is the only servable state and "live" would carry no extra rule. | Q23 |
| M1-3 | **Who approves.** Approver = an active member holding `admin`, `recruiter` or `reviewer` in the item's org, at that role's aal (ADR-029). Self-approval of one's own draft is allowed and audited with `self_approved: true` (one-seat orgs). In a `trace_library` org the approver (`reviewed_by`) and the answer-key reviewer (`key_reviewed_by`) must both differ from `created_by` (expert review, ABH-6). Imported items are approved by the importer at import (Q23). | Q23 |
| M1-4 | **Library (Q27).** Library content lives in the reserved `trace_library` org (M0b `org_kind`). Customers never read library tables. They see library stems and metadata only through rate-limited api endpoints (never keys). Using a library item **copies** it into the customer org (`origin = 'library'`, `source_item_version_id`), once per org per library version; its answer key is copied with `library_sourced = true` and is **invisible to every org role** (RLS), readable by `trace_quality_worker` only. Every downstream table stays single-tenant. Copies are capped (2,000 library item versions per org per UTC day, audited `library.copy`). Until the founder delivers the sample items, the library holds clearly labelled **synthetic placeholders** (seed and tests only). | Q27, plan §11 #22 |
| M1-5 | **Skills and difficulty.** `skill` is a key from the versioned library taxonomy (§3.2 `skill_taxonomy`); `difficulty` is an expert-tagged `numeric(3,2)` in 0.00–1.00 (Q21 answer: the empirical check comes later). `approved` requires both. | Q21, ABH-6 |
| M1-6 | **Exposure counter** `item_exposure (org_id, item_id, served_count)` incremented by an AFTER INSERT trigger on `session_items` (exactly once, because `session_items` is insert-once); a library-sourced copy also increments the library item's counter in the library org (definer trigger). Frozen `item_versions` rows are never updated for stats. | ABH-6, exactly-once rule |
| M1-7 | **Parameterised variants (Q25).** A restricted expression language (§6.3) evaluated by a hand-written parser in `packages/item-variants` (no `eval`, no `Function`), exact rational arithmetic, a seeded PRNG. Variants are **pre-generated and stored** (`item_variants`, keys in `item_variant_keys`) when the item version leaves `draft`, so later stages (wrong-variant detection M10, voice retakes M3b) can name a variant id. M1 builds MCQ quant variants only (written and code variants are Phase 1, plan §5 A). | Q25 |
| M1-8 | **AI drafting (Q22).** A separate `LlmDrafter` interface in `packages/vendors` with a deterministic `MockLlmDrafter`; the Bedrock adapter is written when ABH-87 lands (in-region ap-south-1 model, build-notes §0 "Branch protection, Bedrock"). Drafts run in a queue job (`workers/jobs/src/drafting/`), pass duplicate and readability checks, and land as `origin = 'ai_draft'`, `status = 'in_review'`. The "second model solves it" step is the AI-solvability meter (M10). | Q22, Q23 |
| M1-9 | **Import (Q25).** Trace-published `.xlsx` and `.docx` templates. **Parsing runs in the recruiter's browser** (a Web Worker using `fflate` to unzip and `DOMParser` for the sheet / document XML; no other dependency); the original file never leaves the device, so there is no file to store or purge. The api re-validates **every** row server-side (zod + business rules) in batches of ≤100 and stores per-row errors as codes, never cell values. Images are uploaded one by one through the api (magic bytes, ≤1 MB, ≤4096 px) to a private, content-addressed R2 prefix. `fflate` needs an ADR (ADR-032, "Accepted (autopilot)", written in Wave 0). | Q25, CLAUDE.md stack rule |
| M1-10 | **Draws (Q24).** Pure function `drawSection()` in `packages/item-delivery`: stratified by the section blueprint's skill × difficulty band (0.2 wide), random without replacement, PRNG seeded by `SHA-256(session_id ‖ section_id)`, so a retried draw is identical. Item order and MCQ option order are shuffled with the same seeded stream when the section asks for it. The DO draws at **section start** and holds the draw. "Lowest exposure first" from Q24 is **not** used: exposure frozen at publish would give every candidate the same low-exposure items (plan §11 #23 collusion); a uniform random draw spreads exposure evenly, and exposure caps are M10. | Q24 (deviation recorded for build-notes) |
| M1-11 | **Timers and navigation (Q26).** Either every section has `time_limit_seconds` (then `total_time_seconds` = their sum, checked at publish) or none does (D1 single test timer). Unused section time does not carry over; a closed section never reopens; within a section MCQ allows back-navigation, written is one-way. Section weights are stored as today (`weight > 0`); the score normaliser divides by their sum (D1 §5.4), so "sum to 100" is shown in the editor, not enforced. | Q26 |
| M1-12 | **Package v2.** The R2 test package (`packages/{test_version_id}.json`) gains `v: 2` with pools, variants, shuffle flags, section timers, navigation, image refs and per-format paste rules (§5). The DO accepts v1 and v2. No answer key is ever in a package. | D1 §4.4, Q43 |
| M1-13 | **Presets (Q18) and settings.** Versioned `integrity_setting_defs` and `integrity_presets` in the library org (written by migration only); per-test choice in `ruleset_versions.settings`; admin locks in `org_integrity_locks`, validated by trigger on every write. The D1 five-key `signal_settings` is **derived** in SQL from `settings` by one immutable function, so the band engine's inputs keep one source. A setting can only switch a signal on or off; it never changes a rule's tier, threshold or `validated` flag (rule 3). | Q18, rule 3 |
| M1-14 | **Always-locked settings.** `integrity_review_scope` = `shortlist_only` (rule 6), `accommodations` = `on` (screen 04, RPwD), `id_verification` = `off` (Phase 2 add-on, plan-conflicts #6). "Automatic rejection: Not available" is static copy, never a setting (rule 2). | rules 2, 6 |
| M1-15 | **Lab mode lives on drives (M2),** not on the test (plan §9.1 lists lab mode under `drives`/`slots`; plan wins over screen 04). The integrity step shows "Lab / shared-device mode: set per drive". | plan §9.1 |
| M1-16 | **Role templates (ABH-5).** `role_templates` are versioned blueprints in the library org (customer orgs may add their own). Wedge seed: **BPO Voice** and **Customer Support** (plan-conflicts #13). A blueprint section whose format is not yet servable (voice, typing: M3b/M5) is listed with `available: false` and skipped when the draft is created, with a visible note. | plan-conflicts #13 |
| M1-17 | **JD → blueprint is deterministic in M1:** the api scores the JD text against each template's keyword list (normalised token overlap) and proposes the best template above a threshold, else asks the recruiter to pick. No LLM call, no vendor. **The JD text is not stored** (only `jd_sha256` and the match result), so no stray personal data in a JD is kept. | data minimisation (plan §10.2) |
| M1-18 | **Multi-statement writes from the api use `SECURITY INVOKER` functions in `public`** called through PostgREST with the caller's JWT (RLS, guards and `auth.uid()` apply; atomic). Privileged steps stay `private` definer functions or guarded table writes (D1 §3 convention; MT-7). No new role is given the right to act as an org user. | D1 §3, ADR-029 |
| M1-19 | **New worker role `trace_authoring_worker`** (NOLOGIN, login `jobs_authoring_login` by the operator runbook) for the drafting job: grants only on `ai_draft_jobs` (UPDATE status columns), `item_versions`/`items`/`item_answer_keys` INSERT of `origin = 'ai_draft'` rows (guard), and the dedupe read it needs. It holds nothing in `quality`/`integrity`. | least privilege, MT-14 |
| M1-20 | **Member invitations (carried, M0b D16a).** Admin invites a member by email; `workers/jobs` (never `services/api`, which serves candidate RPCs) creates the Auth user with the Supabase admin API and inserts an `invited` membership through `private.provision_invited_member()`; the invitee accepts by a guarded update of their own row `invited → active`. | m0b-tenancy.md:44, 169-170; CLAUDE.md service keys rule |

### 1.4 Out of scope (owner)
AI-solvability meter, canaries, exposure caps, drift report, wrong-variant detection, written/code variants, item stats (M10) · voice and typing **serving** and their formats in `section_format` (M3b/M5) · notice rendered per ruleset in the consent screen, Hindi (M3b, see §6.7) · capture changes behind the new settings, explain probe, face/voice detectors (M4) · real Bedrock drafting adapter (after ABH-87) · drives, slots, invites, pool-ratio enforcement at scheduling (M2 calls M1's function) · code questions (M9) · "Preview as candidate" (M3b practice test).

### 1.5 Carried items owned by M1 (from earlier reviews)
| Ref | Item | M1 action |
| --- | --- | --- |
| D1 db-review-m1 n-3 | `origin` in the `item_versions` INSERT grant is harmless only while the CHECK pins `'human'` | Drop `origin` from the `authenticated` INSERT grant when the CHECK widens; the guard sets `origin` from the write path (§3.4) |
| D1 db-review-m1 n-4 | Org-level rubrics are editable across workspaces until referenced | Kept org-level (unchanged); multi-client orgs revisit in M12 (noted, no change) |
| D1 db-review-r3 n-4 | Migration comment on consent ids (`invites_sessions.sql:998-999`) is wrong | Corrected in the M1 migration header comment (no SQL change) |
| M0b B0-SP7 (rest) | Gateway `SET ROLE` path not executed in pgTAP; pure-owner persona for grant revoke and teams | pgTAP cases added in `rls_m1_carried.test.sql` (lead) |
| M0b B2-SEC-1 | Recruiter client allows `http` for localhost outside dev | Refuse outside `dev` builds (`apps/recruiter/src/auth/**`, lead) |
| M0b B2-SEC-4 | No `onAuthStateChange`: an expired session keeps the signed-in UI | Subscribe and route to sign-in on `SIGNED_OUT`/`TOKEN_REFRESHED` failure (lead, first data page) |
| FOUNDER-QUEUE 2026-10-13 (resolved 10-15) | Email-code form reveals whether an account exists | Always "If this address has an account, a code is on its way" (lead) |
| M0b B0-SEC7 | First free-value writer of `audit_log.details` | M1 writes no free text into `details` (ids, enums, counts only); AT-M1-25 asserts it |
| M0b D16a | Invitations of org members | M1-20 |

## 2. Users and permissions (delta from D1 §3.3)
Owner, admin, recruiter: author tests, bank items, pools, imports, AI drafts (recruiter within their workspace fence, M0b D16b). Reviewer: read assigned tests (as D1) **and approve items** (`in_review → approved/rejected`) in their workspace. Admin only: integrity locks, member invitations. Hiring manager, client viewer, candidate: nothing in M1. Library org members are Trace content staff (memberships in the `trace_library` org); there is no cross-org role.

## 3. Data model (all migrations lead-only, §11)

### 3.1 Migration files (M1 first, then M2; order in §11.1)
| Order | File | Creates / changes |
| --- | --- | --- |
| M1-a | `<ts>_m1_bank.sql` | enums `item_status`, `item_origin`; `skill_taxonomy`; `items`; `item_versions` widened; `item_variants`; `item_variant_keys`; `item_answer_keys` widened; `item_exposure`; `pools`, `pool_items`; guards, audit, grants, policies |
| M1-b | `<ts>_m1_tests.sql` | `jobs`, `role_templates`; `tests.job_id`; `sections` widened; `section_pool_snapshot`; `test_versions` publish guard v2 (`min_pool_ratio`, package v2 checks); `integrity_setting_defs`, `integrity_presets`, `org_integrity_locks`; `ruleset_versions.settings` + derivation; `session_items` widened + serving trigger; `private.assert_drive_pool_ratio()`; seed of library defs, presets, wedge templates, skills |
| M1-c | `<ts>_m1_imports_drafts.sql` | role `trace_authoring_worker`; `import_jobs`, `import_row_errors`; `ai_draft_jobs`; invoker RPCs `public.import_item_batch`, `public.copy_library_items`, `public.save_test_draft` |
| M1-d | `<ts>_m1_members.sql` | `member_invites`; `memberships_guard` v2 (`invited` path); `private.provision_invited_member()`; role `trace_admin_worker` |

Conventions are D1 §3 unchanged (schema reference: `org_id` + `unique (org_id, id)`, composite FKs `on delete restrict`, one BEFORE `<table>_guard` + AFTER `<table>_audit`, `security definer set search_path = ''`, `enable always`, explicit column grants, one policy per operation per role set, arms `staff` / `reviewer` / `worker` / `api`, error contract `TRACE_GUARD: …` 42501). No column matches MT-3. No new `updated_at`; state changes are audited.

### 3.2 New tables
- **`skill_taxonomy`** (library org only): `id, org_id, skill_key text (^[a-z][a-z0-9_]{1,40}$), label (1–120), format_hint section_format null, version int ≥1, retired_at null`. Unique `(org_id, skill_key)`. W: migration seed only (wedge: `quant`, `logical`, `verbal`, `reading`, `written_communication`, `customer_service_sjt`, `computer_basics`, `spoken_english`, `typing`). S: every member of any active org (it is non-sensitive reference data) through `private.library_org_id()`; no write grant.
- **`items`**: `id, org_id, workspace_id, format section_format, skill_key text not null, created_by, created_at, archived_at null`. Guard: `skill_key` exists in the taxonomy (definer lookup); `format`, `workspace_id` immutable. W: staff arm (owner/admin/recruiter) via the bank editor; `trace_authoring_worker` (drafts).
- **`item_variants`**: `id, org_id, workspace_id, item_version_id, variant_no int ≥1, params jsonb (≤2 KB, scalars only), stem text (1–4000), options jsonb (mcq_options_valid), difficulty numeric(3,2), content_sha256`. Unique `(org_id, item_version_id, variant_no)`, `(org_id, id)`. FK composite to `item_versions`. **Trigger:** `abs(difficulty − parent.difficulty) ≤ 0.10` (ABH-7); insert only while the parent version is `draft` **or** in the same transaction that moves it out of `draft` (generation, §6.3); immutable afterwards (no UPDATE/DELETE).
- **`item_variant_keys`**: PK `(org_id, item_variant_id)`, `workspace_id, key jsonb ({option_id}), library_sourced boolean not null default false, created_by`. Guard: `option_id` is one of the variant's options (`TRACE_BAD_ANSWER_KEY`). RLS as `item_answer_keys` (below).
- **`item_exposure`**: PK `(org_id, item_id)`, `served_count bigint not null default 0 check ≥ 0`, `last_served_at`. W: only the `session_items_exposure` trigger (definer). S: staff arm (non-library orgs); library org members for library items.
- **`pools`**: `id, org_id, workspace_id, name (1–120), format section_format, skill_key null, status text check in ('active','archived'), created_by, created_at`. **`pool_items`**: PK `(org_id, pool_id, item_version_id)`, `workspace_id` (copied). Guard: the item version is `approved`, same org, same format as the pool; a pool is editable (it is a working set); what a test serves is frozen in `section_pool_snapshot` at publish.
- **`section_pool_snapshot`**: PK `(org_id, section_id, item_version_id)`, `workspace_id, test_id, test_version_id`. W: only the publish guard (definer), from `pool_items` of the section's pool **or** the section's inline items; immutable (no UPDATE/DELETE grant; BEFORE trigger raises). S: staff, reviewer arms; `trace_quality_worker`.
- **`jobs`** (recruiting job, plan §3.1 step 1): `id, org_id, workspace_id, title (1–200), role_template_version_id null, jd_sha256 text null (64 hex), match_score numeric(4,3) null, created_by, created_at, archived_at`. No JD text column (M1-17).
- **`role_templates`**: `id, org_id, template_key (^[a-z][a-z0-9_]{1,40}$), version int, name (1–120), keywords text[] (1–80 items, each 2–40 chars), blueprint jsonb (validated by `private.blueprint_valid()`), preset_key text, status text check in ('draft','published','retired'), created_by, published_at`. Unique `(org_id, template_key, version)`. Immutable from `published`. Library templates are read by customers through the api only.
- **`integrity_setting_defs`** (library org, migration only): `setting_key, catalog_version, value_kind text check in ('on_off','on_off_warn','paste_rule','fixed'), allowed_values text[], default_value text, always_locked boolean, available_from text (milestone that makes it run: 'D1','M3b','M4','phase2'), maps_to_signals text[]` (D1 signal names it switches). PK `(org_id, catalog_version, setting_key)`.
- **`integrity_presets`** (library org, migration only): `preset_key in ('strict','standard','open_book'), version, catalog_version, values jsonb (setting_key → value)`. PK `(org_id, preset_key, version)`.
- **`org_integrity_locks`**: `id, org_id, setting_key, locked_value text, locked_by, locked_at`. Unique `(org_id, setting_key)`. W: admin (aal2) INSERT/DELETE; no UPDATE (delete + insert). Guard: key exists, value allowed, `always_locked` keys refuse a lock row (they are locked by definition). Audit `integrity_lock.create` / `.delete` `{setting_key}`.
- **`import_jobs`**: `id, org_id, workspace_id, source_kind text check in ('xlsx','docx'), template_version text, status text check in ('open','validating','completed','cancelled','failed'), rows_total int, rows_ok int, rows_error int, images_ok int, created_by, created_at, completed_at`. **`import_row_errors`**: PK `(org_id, import_job_id, row_no, field)`, `error_code text` (enum list in §4.3), never a cell value (no free-text column).
- **`ai_draft_jobs`**: `id, org_id, workspace_id, requested_by, format, skill_key, difficulty numeric(3,2), count int 1–10, topic_sha256 text, provider text, model_id text, prompt_version text, status text check in ('queued','running','completed','failed'), drafts_created int, error_code text null, created_at, completed_at`. The topic text itself is not stored (it is in the queue message only, ≤500 chars, PII-scrubbed, §6.4).
- **`member_invites`**: `id, org_id, email_sha256 text (64 hex), roles org_role[], workspace_id null, status text check in ('pending','provisioned','failed','cancelled'), invited_by, created_at`. The address itself travels in the queue message only; `member_invites` stores its hash (dedupe) and the membership stores `display_name`.

### 3.3 Changed D1 tables
- **`item_versions`**: `section_id`, `test_version_id`, `test_id`, `position` become nullable (bank rows); CHECK `(section_id is null) = (test_version_id is null) = (position is null)`. New columns: `status item_status not null default 'draft'`, `origin item_origin not null default 'human'` (enum `human|import|ai_draft|library`; the old text CHECK is replaced), `skill_key text null`, `difficulty numeric(3,2) null check 0..1`, `language text check in ('en')` (Hindi items with M3b), `is_parameterised boolean default false`, `param_spec jsonb null` (§6.3), `media jsonb null` (≤4 `{key, alt}` refs, `alt` 1–300 required), `ai_draft_job_id uuid null`, `import_job_id uuid null`, `source_item_version_id uuid null` (library copy), `approved_by uuid null`, `approved_at null`, `reviewed_by uuid null`, `key_reviewed_by uuid null`. Unique `(org_id, item_id, version_no)` (new), partial unique `(org_id, source_item_version_id) where source_item_version_id is not null`. **CHECKs (ABH-6, ABH-8):** `status in ('approved','retired') ⇒ skill_key, difficulty not null`; `(origin = 'ai_draft' and status in ('approved','retired')) ⇒ approved_by is not null and approved_at is not null` (**the exit-gate DB constraint**); `status = 'approved' ⇒ approved_by is not null` for every origin; `is_parameterised ⇒ format = 'mcq' and param_spec is not null`; `origin = 'library' ⇒ source_item_version_id is not null`. Inline section rows (D1 mode) keep working: they are created `approved` by the guard with `approved_by = created_by` because the author is the approver (Q23 self-approval, audited) — they are human-written only (an `ai_draft` row can never be inline).
- **`item_answer_keys`**: add `library_sourced boolean not null default false`; `item_version_id` may now point at bank rows. The draft-only freeze becomes "item version status is `draft`" for bank rows (inline rows keep the test-version freeze).
- **`sections`**: add `pool_id uuid null` (composite FK), `draw_count int null check > 0`, `shuffle_items boolean not null default false`, `shuffle_options boolean not null default false`, `navigation text not null default 'free' check in ('free','forward_only')`, `paste_rule text null check in ('blocked','allowed_logged')` (written only), `blueprint jsonb null` (strata quotas, §6.5). CHECK `(pool_id is null) = (draw_count is null)`; `format = 'written' ⇒ navigation = 'forward_only'`. Freeze unchanged (draft only).
- **`tests`**: add `job_id uuid null` (composite FK to `jobs`).
- **`test_versions`**: add `min_pool_ratio numeric(6,2) null` (set by the publish guard: min over sections of `snapshot size / draw_count`; `null` when no section draws), `package_version smallint not null default 1 check in (1,2)`, `role_template_version_id uuid null`. Both outside every grant; the guard sets them.
- **`ruleset_versions`**: add `catalog_version text`, `preset_key text check in ('strict','standard','open_book')`, `preset_version int`, `settings jsonb`. `signal_settings` (D1 five keys) is now **derived** by `private.derive_signal_settings(settings, catalog_version)` in the guard; D1 rows (no `settings`) are left as they are. `authenticated` may UPDATE `preset_key`, `preset_version`, `settings` while the ruleset is unpublished (new column grant; the D1 SELECT-only grant widens); the guard validates against defs + the org's locks + always-locked keys and refuses a locked key with a different value (`TRACE_GUARD: setting locked by admin`).
- **`session_items`**: add `item_variant_id uuid null` (composite FK), `option_order jsonb null` (array of option ids, a permutation of the served options), `draw_seed_sha256 text null`. The D1 trigger "item's `test_version_id` equals the session's" becomes "the item version is in `section_pool_snapshot` for the session's test version and section" (inline sections are snapshotted too, so one rule). **New serving trigger** `session_items_ai_gate` (BEFORE INSERT, ALWAYS, binds `trace_worker`): refuses an item version with `origin = 'ai_draft'` and `approved_by is null`, or with `status not in ('approved','retired')`, raising `TRACE_GUARD: unapproved item cannot be served` (exit gate, defence in depth behind the CHECK and the publish guard). New AFTER INSERT trigger `session_items_exposure` (M1-6).
- **`memberships`** guard v2: an `invited` row may be inserted only by `private.provision_invited_member()`; the invitee may UPDATE their own row `invited → active` only (no other column); everything else unchanged.

### 3.4 Guards and functions (all `private`, DEFINER, `search_path = ''`, EXECUTE revoked from public unless stated)
| Function / trigger | What it does |
| --- | --- |
| `item_versions_guard` v2 | Sets `origin` from the path (editor `human`, `import_item_batch` `import`, authoring worker `ai_draft`, `copy_library_items` `library`; the client cannot choose it, carried n-3); state machine §4.1; content immutable once not `draft`; approval sets `approved_by = auth.uid()` and `approved_at = now()` and requires the caller to hold admin/recruiter/reviewer counting at its aal; in a library org enforces `reviewed_by ≠ created_by`, `key_reviewed_by ≠ created_by`; on `draft → in_review` of a parameterised item calls `private.generate_variants()` (§6.3). |
| `private.generate_variants(item_version_id)` | Not SQL arithmetic: the api generates variants with `packages/item-variants` and inserts them through `public.save_item_variants()` (invoker) **before** the status change; the guard only checks that ≥1 variant exists, that every variant has a key, and the ±0.10 rule. (One evaluator, in TypeScript; SQL never re-evaluates expressions.) |
| `test_versions_guard` v2 (publish) | Adds to D1's checks: each section is either inline or pool mode; pool sections have `|pool_items approved| ≥ draw_count`; every served item version is `approved` (or inline-approved) and every `ai_draft` has `approved_by`; every MCQ item (or each of its variants) has a key; all-or-none section timers and `total_time_seconds = Σ time_limit_seconds` when present; writes `section_pool_snapshot`; sets `min_pool_ratio`, `package_version = 2` when any M1 feature is used; requires `content_sha256` (api-supplied, D1 OPEN-7) as before. |
| `private.assert_drive_pool_ratio(p_org uuid, p_test_version uuid) returns void` | Raises `TRACE_GUARD: pool must be at least 10x the draw for drives` unless every drawing section has ratio ≥ 10 **and** no section is inline-only (an inline section serves all its items: ratio 1). EXECUTE: none; called from M2 triggers. |
| `private.derive_signal_settings(settings jsonb, catalog_version text) returns jsonb` | Immutable. Maps settings to the D1 five keys by `integrity_setting_defs.maps_to_signals` (table in §6.6). Unknown catalog → error. |
| `private.blueprint_valid(jsonb)` | Immutable shape check of a role-template blueprint (§5). |
| `public.save_test_draft(p_test_version uuid, p_payload jsonb)` | **INVOKER**; replaces a draft's sections, inline items, keys and settings in one transaction (fixes D1 r3 m-4's non-atomic chain for the editor). EXECUTE `authenticated`. |
| `public.import_item_batch(p_job uuid, p_rows jsonb)` | **INVOKER**; inserts ≤100 validated rows (items, versions as `approved` by the importer, keys, media refs) and their per-row errors; idempotent on `(import_job_id, row_no)`. EXECUTE `authenticated`. |
| `public.copy_library_items(p_workspace uuid, p_library_versions uuid[])` | **INVOKER**, but the read of library rows goes through `private.library_item_payload(uuid[])` (DEFINER, returns content + keys only for `approved` library versions, enforces the daily cap and audits `library.copy` `{count}`). Returns the org-local item version ids (existing copies are reused). EXECUTE `authenticated` (staff roles, checked inside). |
| `public.save_item_variants(p_item_version uuid, p_variants jsonb)` | **INVOKER**; inserts variants + keys for a `draft` parameterised version. |
| `private.provision_invited_member(p_invite uuid, p_user uuid, p_display_name text)` | EXECUTE `trace_admin_worker`; inserts the `invited` membership for a `pending` invite and marks it `provisioned`; audit `membership.create` `{status: invited}`. |
| `private.library_org_id()` | Stable; the single `trace_library` org id (raises if not exactly one). |

### 3.5 RLS matrix (new and changed tables; OW owner · AD admin · RC recruiter · RV reviewer (assigned tests, D1) · W workers; ✗ = no policy; every cell gets allowed + denied pgTAP cases plus a cross-org and a workspace-fenced persona)
| Table | S | I | U | D |
| --- | --- | --- | --- | --- |
| `skill_taxonomy` | all active members (any org) | ✗ | ✗ | ✗ |
| `items`, `item_versions` (bank rows) | OW AD RC (staff arm); RV (workspace arm, for approval) | OW AD RC; `trace_authoring_worker` (ai_draft only) | OW AD RC (draft content; submit); RV AD RC (approve/reject, guard) | OW AD RC (draft only) |
| `item_versions` (inline rows) | as D1 | as D1 | as D1 | as D1 |
| `item_answer_keys`, `item_variant_keys` | OW AD RC RV **where `library_sourced = false`**; `trace_quality_worker` all | OW AD RC (draft parent); `trace_authoring_worker` | OW AD RC (draft parent) | OW AD RC (draft parent) |
| `item_variants` | OW AD RC RV; `trace_quality_worker` | via `save_item_variants` (invoker: OW AD RC) | ✗ | ✗ |
| `item_exposure` | OW AD RC | trigger only | trigger only | ✗ |
| `pools`, `pool_items` | OW AD RC | OW AD RC | OW AD RC (`pools`) | OW AD RC (`pool_items`) |
| `section_pool_snapshot` | OW AD RC; RV assigned; `trace_quality_worker` | publish guard only | ✗ | ✗ |
| `jobs` | OW AD RC; RV (jobs of assigned tests) | OW AD RC | OW AD RC (title, archived_at) | ✗ |
| `role_templates` | OW AD RC own org (library: api only) | AD own org | AD (draft only) | ✗ |
| `integrity_setting_defs`, `integrity_presets` | OW AD RC RV (library rows via `private.library_org_id()`) | ✗ | ✗ | ✗ |
| `org_integrity_locks` | OW AD RC RV | AD (aal2) | ✗ | AD (aal2) |
| `ruleset_versions` | as D1 | as D1 (seed trigger) | **new:** OW AD RC (settings, unpublished) | as D1 |
| `import_jobs`, `import_row_errors` | OW AD RC (own workspace) | OW AD RC (jobs; errors via `import_item_batch`) | OW AD RC (cancel) | ✗ |
| `ai_draft_jobs` | OW AD RC | OW AD RC | `trace_authoring_worker` (status columns) | ✗ |
| `member_invites` | OW AD | AD (aal2) | AD (cancel); `trace_admin_worker` (status) | ✗ |
| `memberships` | as M0b | `provision_invited_member` only for `invited` | **new:** invitee own row `invited → active` | ✗ |
`trace_candidate`, `anon`, `service_role`, hiring_manager and client viewer hold nothing on any M1 table (catalog MT-4 + `rls_m1_candidate_denied`).

### 3.6 Invariants enforced in the database (new)
I-M1-1 AI-drafted versions cannot be `approved`/`retired` without `approved_by` (CHECK) and cannot be snapshotted or served without it (publish guard, `session_items_ai_gate`). I-M1-2 A published test version, its sections, inline items, keys, ruleset, settings and snapshot are immutable for every role, workers included (D1 freeze + new tables; ENABLE ALWAYS, no operator bypass). I-M1-3 Item content is immutable once a version leaves `draft`. I-M1-4 Variant difficulty within ±0.10 of its parent. I-M1-5 Library answer keys are never readable by an org role. I-M1-6 A locked setting cannot be saved with another value; always-locked settings have one value. I-M1-7 `signal_settings` is derived, never client-written. I-M1-8 Exposure counts move only on a served item, exactly once. I-M1-9 No score, band or outcome column in any M1 table (meta-test unchanged). I-M1-10 Nothing in M1 reads or writes `quality.*` or `integrity.*` except the existing D1 seed trigger's read of `integrity.band_rule_versions` (MT-5 closure check stays green).

## 4. State machines

### 4.1 Item version (`item_versions.status`)
`draft → in_review` (author or importer; parameterised: variants must exist) · `in_review → approved` (approver, M1-3; AI drafts too) · `in_review → rejected` (approver; terminal) · `in_review → draft` is **not** allowed (an edit is a new version) · `approved → retired` (OW AD RC; a retired version stays valid in already-published snapshots; it cannot be added to pools or new drafts) · imported rows go `draft → approved` in one statement by the importer (Q23) · inline section rows are inserted `approved` (M1 §3.3). Every transition is audited `item.<verb>` `{item_version_id, from, to, self_approved}`.

### 4.2 Test version
D1's `draft → published → retired` unchanged. **New action "Edit"** on a published test: `POST …/tests/:id/versions` clones the latest published version into a new draft (`version_no + 1`, new `ruleset_versions` by the D1 seed trigger, then its `settings` copied from the source ruleset). The one-open-draft index stays. Invitations keep `test_version_id` (D1 immutable column); M2 drives point new invites at a chosen published version.

### 4.3 Import job
`open → validating → completed | failed`; `open|validating → cancelled` (author). Per-row error codes: `missing_field`, `bad_format`, `bad_skill`, `bad_difficulty`, `bad_options`, `bad_key`, `too_long`, `bad_image_ref`, `image_missing`, `image_too_large`, `image_bad_type`, `duplicate_in_file`, `duplicate_in_bank`, `bad_param_spec`, `variant_generation_failed`, `row_limit`. Max 2,000 rows per job.

### 4.4 AI draft job
`queued → running → completed | failed`. A job never moves an item past `in_review`.

### 4.5 Member invite
`pending → provisioned | failed`; `pending → cancelled` (admin). Membership `invited → active` (invitee) or `invited → removed` (admin).

## 5. Contracts (`packages/shared/src/contracts-m1.ts`, lead-written in Wave 0; zod 4 strict objects)
- `ItemStatus`, `ItemOrigin`, `SkillKey` (`/^[a-z][a-z0-9_]{1,40}$/`), `Difficulty` (number, multiple of 0.01, 0–1).
- `ItemMedia` = `{ key: /^item-media\/[0-9a-f-]{36}\/[0-9a-f]{64}\.(png|jpg|webp)$/, alt: string 1–300 }`.
- `ParamSpec` = `{ params: Record<name, {kind:'int', min, max, step} | {kind:'choice', values: (int|string)[] 1–20}>  (1–8 params), derived: Record<name, Expr string ≤200> (0–8), constraints: Expr[] (0–8), stem: template ≤4000, options: {id, text template}[] 2–6, correctOptionId, count: int 5–200 }`.
- `BankItemDraft` (discriminated on `format`): mcq `{ stem, options, key: {optionId}, skillKey, difficulty, media?, paramSpec? }`; written `{ stem, rubricVersionId, skillKey, difficulty, media? }`.
- `BankItemSummary` (list row; no key), `BankItemDetail` (key present only when the caller may read it and `librarySourced = false`).
- `ApproveItemRequest { itemVersionId, decision: 'approve' | 'reject' }`.
- `PoolRequest`, `PoolDetail`.
- `SectionDraft` = D1 section + `{ mode: 'inline' | 'pool', poolId?, drawCount?, shuffleItems, shuffleOptions, navigation, pasteRule?, timeLimitSeconds?, blueprint?: { strata: {skillKey, difficultyBand: 0|1|2|3|4, count}[] } }`.
- `SaveTestDraftRequest` (supersedes `UpdateTestDraftRequest` for M1 tests; D1's request stays valid and maps to inline mode) with **at most 10 sections and 200 inline items**; `qualityCutoff` required as D1 (FOUNDER-QUEUE rec. 2 is open; M1 does not change the cutoff, §6.8).
- `IntegritySettingsRequest { presetKey, values: Record<settingKey, value> }`, `IntegritySettingsView { presetKey, values, locked: Record<settingKey, 'admin' | 'always'>, candidateSummary: string[] }`.
- `RoleTemplateSummary`, `BlueprintProposal { templateKey, version, score, sections[] (with available) }`, `CreateTestFromTemplateRequest { jobTitle, templateKey, templateVersion, jdText? ≤50 000 }`.
- `ImportJobCreateRequest { sourceKind, templateVersion }`, `ImportRowsRequest { rows: ImportRow[] 1–100 }`, `ImportRowsResponse { accepted: int, errors: {rowNo, field, code}[] }`, `ImportImagePutResponse { key }`.
- `AiDraftRequest { format: 'mcq' | 'written', skillKey, difficulty, count 1–10, topic ≤500 }`, `AiDraftJobView`.
- `LibraryBrowseQuery { skillKey?, format?, difficultyMin?, difficultyMax?, cursor? }`, `LibraryItemCard { libraryItemVersionId, format, skillKey, difficulty, stem, options? (text only), isParameterised }` — **no key field exists in the type**.
- `MemberInviteRequest { email, roles, workspaceId? , displayName }`.
- **`TestPackageV2`** (in `contracts-candidate.ts`, alongside v1): `{ v: 2, testVersionId, rulesetVersionId, title, language: 'en', durationSeconds, heartbeatSeconds: 10, signalCatalogVersion, enabledSignals: CatalogSignal[], sections: { id, title, position, timeLimitSeconds?, navigation, shuffleItems, shuffleOptions, pasteRule?, draw: { count, strata[] } | null }[], items: { sectionId, itemVersionId, itemId, kind, prompt, options?, media?, skillKey, difficultyBand, variants?: { variantId, prompt, options }[] }[] (≤ 5,000) }`. A superRefine proves: every item's section exists; draw counts ≤ eligible items; no key-like field anywhere (`key`, `answer`, `correct*`, schema walk as `contracts-schema-walk.ts`). R2 object ≤ 5 MB.
- **`SessionMirrorMessage` v2**: `served[]` rows gain `sectionId`, `itemVariantId?`, `optionOrder?`, `drawSeedSha256?`.

## 6. Feature behaviour

### 6.1 Role templates and JD → blueprint (ABH-5)
Wizard step 1 "Job details": job title + either pick a template or paste a JD. `POST …/blueprints/propose { jdText }` → tokens (lowercase, NFKC, `[\p{L}\p{N}]+`, stop-words removed) → score per published template = |JD tokens ∩ keywords| / |keywords|; best ≥ 0.15 is proposed, else "Pick a template". Response carries no JD text. `POST …/tests/from-template` creates `jobs`, `tests`, the draft with sections from the blueprint (available sections only), pools populated by `copy_library_items` with the blueprint's strata (10× draw where the library has enough approved items; otherwise the section is created in pool mode with fewer items and the editor shows "needs N more items for drives"), and the preset from the template. Seed blueprints (synthetic placeholder items until real content): **Customer Support** — MCQ verbal (draw 10), MCQ customer-service SJT (draw 10), written communication (inline 1 item, rubric), 40 min, Standard. **BPO Voice** — MCQ verbal (draw 10), MCQ reading (draw 8), written communication (inline 1), voice spoken English (`available: false` until M3b), 35 min, Standard.

### 6.2 Item bank tooling (ABH-6)
`/bank`: list with filters (format, skill, difficulty range, status, origin, pool), item editor (draft only), "Submit for review", approval queue `/bank/review` (approver sees origin, draft checks for AI items, and "self-approval is logged" when approver = author), retire, pools editor (add approved items; shows size vs the draws of tests using it), library browser (api, rate-limited 60 req/min/user, copy to bank), exposure column. Library staff use the same screens inside the library org.

### 6.3 Parameterised variants (ABH-7)
Grammar (Pratt parser, `packages/item-variants`): numbers (integers and decimals ≤ 6 places), parameter names `[a-z][a-z0-9_]{0,15}`, `+ - * / ^` (integer exponent 0–6), parentheses, functions `min max abs round(x, d) floor ceil gcd lcm`, comparisons and `and/or/not` in constraints only; max 200 chars, max depth 16; anything else is a parse error. Arithmetic is exact rational (`bigint` numerator/denominator); division by zero rejects the candidate tuple. Templates substitute `{{name}}` or `{{name:fmt}}` (`fmt` = decimals 0–4, or `%`). Generation: PRNG `sfc32` seeded with the first 128 bits of `SHA-256(item_version_id ‖ variant_no)`; draw parameter tuples, evaluate derived values and constraints, render stem and options; reject a tuple that violates a constraint, renders two equal options, or duplicates an earlier variant; stop at `count` accepted variants or 50 × `count` attempts (`variant_generation_failed`). Each variant's difficulty = the parent's unless the author sets one (±0.10 enforced by the DB). The DO picks a variant per candidate with the session-seeded stream (§6.5); the chosen `itemVariantId` is mirrored. **Share metric:** `GET …/bank/stats` returns, per org (and for the library), `quant_items_approved` and `quant_items_parameterised` with `share = parameterised / approved` for `skill_key = 'quant'`; this is the ABH-7 "≥40%" measurement (content target deferred, §13).

### 6.4 AI drafting with human approval (ABH-8)
`POST …/bank/ai-drafts` (OW AD RC) → `ai_draft_jobs` row + Queue `trace-authoring` message `{ jobId, orgId, workspaceId, format, skillKey, difficulty, count, topic }`. The topic is scrubbed before enqueue (emails, phone-like digit runs ≥ 8, URLs replaced by `[removed]`) and capped at 500 chars. Consumer (`workers/jobs/src/drafting/`, role `trace_authoring_worker`): calls `LlmDrafter.draft({ format, skill, difficulty, count, topic })` with the topic **delimited as data** (same convention as `LlmGrader`); validates the structured output with zod (`DraftedItem[]`); runs checks — duplicate (normalised-text SHA-256 equal to an existing org version, or word-5-shingle Jaccard ≥ 0.8 against the same skill's approved items, capped at 2,000 comparisons), readability (stem 20–1,200 chars; options 1–200 chars; no option equal to the stem; Flesch reading ease ≥ 30 for English), and **no candidate-facing placeholders** (`{{`); inserts passing drafts as `origin = 'ai_draft'`, `status = 'in_review'`, `ai_draft_job_id`; check results go to the job row counters and an audit row `item.ai_drafted {checks_passed}` (counts only); failed drafts are discarded and counted. The approver sees the draft badge "AI draft — needs approval". Idempotency: key `${jobId}:ai_draft` in `idempotency_keys` (scope `ai_draft`, `trace_authoring_worker` policy). `MockLlmDrafter` returns deterministic, clearly synthetic items from `(skill, difficulty, seed)`; the production guard pattern of `messaging.ts` applies (the mock refuses `production`).

### 6.5 Pools, sections, shuffle, timers, server-side delivery (ABH-10)
Authoring as §3.3. **Publish** snapshots eligible items per section, records `min_pool_ratio`, writes package v2 (api, as D1: build → R2 → guarded update with `content_sha256` → rebuild and compare). **Delivery (edge, `SessionDO`):** at section enter the DO calls `drawSection(pkgSection, items, seed)` (`packages/item-delivery`, pure): strata from `section.draw.strata` (if absent, one stratum = all items); within a stratum a Fisher–Yates on the seeded stream; take `count`; then item order shuffled iff `shuffleItems`, options iff `shuffleOptions`; parameterised items pick `variantIndex = next() mod variants.length`. The draw result is stored in DO storage before the first item is served (a retry or a resumed device reads it, never re-draws). Section deadline = section start + `timeLimitSeconds` (+ granted extra time pro rata, M3b); the overall deadline is still the DO alarm; leaving a section (time-out or "Finish section") closes it for good; `forward_only` sections refuse `item.prev`. Items are served one at a time as in D1. **Images:** `GET /s/:sessionId/media/:hash` at the edge returns the R2 object only if the hash is in the media list of an item currently served to that session (DO check), `cache-control: no-store`, `content-type` from the stored extension.

### 6.6 Integrity presets, per-signal settings, admin locks (screen 04)
Catalog `m1-settings-v1` (seeded; values as screen 04 and build-notes Q18; the band rule table is **not** touched):
| setting_key | values | Strict | Standard | Open-book | always_locked | runs from | switches D1 signals |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `calibration_warmup` | on/off | on | on | on | no | M4 | — |
| `typing_provenance` | on/off | on | on | on | no | M4 | `untrusted_input` |
| `burst_after_tab` | on/off | on | on | off | no | M4 | — |
| `fullscreen_tab_focus` | off/warn_first/on | on | warn_first | off | no | D1 (context only) | `tab_hidden`, `fullscreen_exit` |
| `single_screen` | on/off | on | off | off | no | M4 | — |
| `camera_face_presence` | on/off | on | on | off | no | M4 | — |
| `mic_speech_presence` | on/off | on | off | off | no | M4 | — |
| `explain_probe` | on/off | on | off | off | no | M4 | — |
| `paste_written` | blocked/allowed_logged | blocked | allowed_logged | allowed_logged | no | D1 | `paste`, `drop` (see §6.7) |
| `integrity_review_scope` | shortlist_only | shortlist_only | shortlist_only | shortlist_only | **yes** (rule 6) | D1 | — |
| `accommodations` | on | on | on | on | **yes** | M3b | — |
| `id_verification` | off | off | off | off | **yes** (Phase 2) | phase2 | — |
A setting whose `runs from` is later than the current build is stored and shown as "Takes effect when available"; it runs nothing (no capture, no signal). Admins lock any non-always-locked setting at org level (`/settings/integrity`); the test editor shows "Locked by admin" and the guard refuses a different value. "What candidates will see" is rendered by `renderCandidateSummary(settings, catalogVersion)` in `@trace/shared` (pure, versioned, English) from the **enabled** settings that run now.

### 6.7 Settings that touch the band (rule 3) — built with the safe default, founder question open
`paste_written = blocked`: the D1 behaviour (paste/drop attempts are blocked on the client and logged; the existing D1 rule table raises Review). `allowed_logged`: **default pending founder answer (SPEC-M1-M2.md Q-M1-1): `paste`/`drop` are recorded as timeline context and switched off as band inputs** (`signal_settings.paste.enabled = false`), so allowing paste can never raise a band. `fullscreen_tab_focus = off` switches `tab_hidden`/`fullscreen_exit` off entirely (not captured); `warn_first`/`on` keep them as D1 context (never a band input until M4 validates them). `typing_provenance = off` switches `untrusted_input` off. **Turning a signal on never makes an unvalidated rule raise the band** (the rule table's `validated` flag decides; AT-M1-17). The package lists `enabledSignals`; the client captures only those and the DO drops any other kind (data minimisation). The consent notice stays the D1 template until M3b renders it per ruleset; because M1 only switches signals off relative to D1, the D1 notice over-states, never under-states, what is recorded (SPEC-M1-M2.md Q-M1-2).

### 6.8 Cutoff
Unchanged from D1 (mandatory, pinned at publish). The open founder item "where the Answer Quality cutoff lives" (FOUNDER-QUEUE rec. 2, rule 6) is not decided here; M1 adds no cutoff field, endpoint or behaviour.

### 6.9 Import (ABH-9)
Templates: `trace-items-v1.xlsx` (sheet `Items`, header row fixed: `format, skill, difficulty, stem, option_a … option_f, correct, rubric_key, image_file, image_alt, param_spec_json`) and `trace-items-v1.docx` (one item per `Heading 2` block; styles `Trace Stem`, `Trace Option`, `Trace Correct`, `Trace Meta`; images inline). Browser flow: pick file (+ optional images `.zip` for xlsx) → Web Worker parses (cap 10 MB file, 2,000 rows, 2,000 images) → `POST …/imports` → images `PUT …/imports/:id/images/:sha256` (api checks magic bytes PNG/JPEG/WebP, ≤1 MB, dimensions ≤4096, re-hashes; content-addressed key `item-media/{org}/{sha256}.{ext}`; existing key = no-op) with concurrency 6 → rows `POST …/imports/:id/rows` in batches of 100 (api zod + rules, then `import_item_batch`) with concurrency 3 → `POST …/imports/:id/complete`. The screen shows a table of every bad row (row number, field, plain-language reason from the code) and a downloadable error CSV generated **in the browser** from the codes. Parameterised rows generate variants server-side in the api before insert (§6.3).

### 6.10 Recruiter app (`apps/recruiter`)
Routes: `/tests/new` wizard (1 Job details · 2 Questions · 3 Integrity · 4 Review and publish), `/tests/:id` (draft editor or read-only published view with **"Edit as new version"**), `/bank`, `/bank/items/:itemId`, `/bank/review`, `/bank/pools`, `/bank/import`, `/bank/ai-drafts`, `/library`, `/settings/integrity` (admin), `/settings/members` (admin). The publish dialog keeps D1's copy: "Settings freeze when you publish, including the cutoff; later changes create a new version". Never shown (AT-M1-24): AI-likeness, solvability (M10), any reject/decision control, any blended number. Client gating is UX only.

### 6.11 `services/api` endpoints (new modules `bank`, `pools`, `library`, `imports`, `ai-drafts`, `templates`, `integrity-settings`, `members`; D1 `tests` extended)
| Method and path | Roles (RLS decides) | Contract |
| --- | --- | --- |
| `GET/POST /v1/orgs/:orgId/bank/items`, `GET/PUT …/bank/items/:itemId` | OW AD RC (RV read) | `BankItemDraft`, `BankItemSummary`, `BankItemDetail` |
| `POST …/bank/items/:itemId/versions` | OW AD RC | new draft version from the latest |
| `POST …/bank/item-versions/:id/submit`, `…/review` | author; approver | `ApproveItemRequest` |
| `POST …/bank/item-versions/:id/retire` | OW AD RC | — |
| `GET …/bank/stats` | OW AD RC | share metric (§6.3) |
| `GET/POST/PUT …/pools`, `POST/DELETE …/pools/:id/items` | OW AD RC | `PoolRequest`, `PoolDetail` |
| `GET …/library/items` (rate-limited), `POST …/library/copy` | OW AD RC | `LibraryBrowseQuery`, `LibraryItemCard`; copy returns local ids |
| `POST …/blueprints/propose`, `GET …/templates`, `POST …/tests/from-template` | OW AD RC | §5 |
| `PUT …/tests/:testId/draft` | OW AD RC | `SaveTestDraftRequest` → `public.save_test_draft` |
| `POST …/tests/:testId/versions` | OW AD RC | clone published → draft |
| `GET/PUT …/tests/:testId/integrity` | OW AD RC (PUT draft only) | `IntegritySettingsRequest/View` |
| `GET/POST/DELETE …/settings/integrity-locks` | AD (aal2) | locks |
| `POST …/imports`, `PUT …/imports/:id/images/:sha256`, `POST …/imports/:id/rows`, `POST …/imports/:id/complete`, `POST …/imports/:id/cancel`, `GET …/imports/:id` | OW AD RC | §5 |
| `POST …/bank/ai-drafts`, `GET …/bank/ai-drafts/:id` | OW AD RC | `AiDraftRequest`, `AiDraftJobView` |
| `POST/GET/DELETE …/members/invites` | AD (aal2) | `MemberInviteRequest` |
The D1 publish endpoint gains package v2 building; the D1 route-inventory test's allow-list is extended (still no `reject|decision|…` path).

## 7. Edge cases (plan §11 and authoring-specific)
| # | Case | Behaviour |
| --- | --- | --- |
| E1 | Edit a published test | `PUT …/draft` on a published version → 409; DB raises `frozen`; "Edit as new version" clones |
| E2 | Two recruiters publish the same draft at once | D1 `for no key update` on `tests` serialises; the second gets 409 |
| E3 | An item in a pool is retired after a test was published | The snapshot keeps it; new publishes exclude it; pool editor shows the gap vs 10× |
| E4 | Pool shrinks below `draw_count` while a draft references it | Publish refuses with `pool_too_small` (count shown) |
| E5 | AI draft approved, then edited | The edit is a new `draft` version with `approved_by = null`; the old approved version stays servable until retired |
| E6 | Approver is suspended between approval and serving | Approval stands (it is a historical fact, audited); a new approval needs an active member |
| E7 | Library item updated by Trace after a customer copied it | The copy is a frozen version; the library change creates a new library version; customers may copy the new one (new local item) |
| E8 | Library daily copy cap exceeded | 429 `library_cap`; audited; partial copies are all-or-nothing per call |
| E9 | Import file with formulas, macros, external links | Formulas: cached value used, never evaluated; `.xlsm`/macros refused by extension and content type; external relationships ignored |
| E10 | Import row with HTML or script in the stem | Stored as plain text; React renders text; no HTML anywhere |
| E11 | Zip-bomb or huge image | Browser caps uncompressed size (50 MB total, 1 MB per image) and aborts; api re-checks each image |
| E12 | Same image used by many rows | Content-addressed key; uploaded once |
| E13 | Re-sent import batch (network retry) | Idempotent on `(import_job_id, row_no)`; counts unchanged |
| E14 | Parameterised spec cannot produce `count` distinct variants | Row/item error `variant_generation_failed`; nothing inserted for that item |
| E15 | Option text identical after rendering | Tuple rejected; generation continues |
| E16 | Admin locks a setting while a draft has another value | The draft keeps its stored value but cannot be saved or published until changed (guard runs on update and on publish) |
| E17 | Lock removed after publish | Published rulesets are frozen; nothing changes |
| E18 | Template blueprint asks for a format not yet servable | Section skipped with a note (M1-16) |
| E19 | JD contains a phone number or name | Not stored, not logged, not sent to any model (deterministic matcher) |
| E20 | AI drafter returns malformed JSON or a key outside its options | zod rejects; counted as failed; never inserted |
| E21 | AI topic with injection text ("ignore previous instructions") | Delimited as data; output still schema-checked and human-approved; nothing reaches a candidate without approval |
| E22 | Package v2 larger than 5 MB | Publish refuses `package_too_large` (pool size × variants bound) |
| E23 | Candidate reloads mid-section | DO returns the stored draw; never re-draws (AT-M1-19) |
| E24 | Candidate tries to return to a closed section or go back in a written section | DO refuses 409 `section_closed` / `forward_only` |
| E25 | Item image requested for an item not served to this session | 404 (indistinguishable from missing) |
| E26 | Member invite to an address that already has an Auth user | The worker reuses the user id; one live membership per org (M0b index) |
| E27 | Invitee never accepts | Stays `invited` (no access: helpers count `active` only); admin can remove |
| E28 | Two orgs, same library item copied | Each org has its own copy and counter; the library counter sums both |

## 8. Day-one checks (BUILD Wave 0, results recorded here)
DC-M1-1 PostgREST calls an INVOKER `public` function with the caller's JWT and RLS + guards apply (local + `trace-dev`). DC-M1-2 `fflate` in a Web Worker under the recruiter CSP (`worker-src 'self'`, no `unsafe-eval`). DC-M1-3 Package v2 of 5,000 items fits the DO memory and loads < 200 ms from R2 at section start. DC-M1-4 Workers CPU per `import_item_batch` call and per variant generation on the Free plan (OPEN-8a; a failure is a founder gate, not a spec change). DC-M1-5 Supabase admin API "create user" works from `workers/jobs` with the staging secret key (founder credential, SPEC-M1-M2.md F-1).

## 9. Security notes for reviewers
Library keys (I-M1-5) and the copy definer function; the import path (browser-parsed data is untrusted: every row re-validated, images re-checked; no file stored); AI drafting (prompt-injection in topic, output schema, no candidate data); the member-provisioning secret lives only in `workers/jobs`; the image route at the edge; `public` INVOKER functions (EXECUTE only to `authenticated`, `search_path = ''`, every statement subject to RLS).

## 10. pgTAP plan (`supabase/tests/rls_m1_*.test.sql`, lead)
`rls_m1_bank` (items, versions, lifecycle, approval roles/aal, self-approval audit, library rules, content immutability) · `rls_m1_keys` (library_sourced invisible to every org role, visible to quality worker; variant keys) · `rls_m1_variants` (±0.10, immutability) · `rls_m1_pools` · `rls_m1_snapshot` (publish writes it, immutable, ratio) · `rls_m1_publish_v2` (all publish refusals; frozen after publish for every role incl. workers) · `rls_m1_serving` (`session_items_ai_gate`, snapshot membership, exposure counter once, library counter) · `rls_m1_settings` (defs/presets read-only, locks, always-locked, derivation function vectors) · `rls_m1_imports` · `rls_m1_ai_drafts` (authoring worker grants, denied elsewhere) · `rls_m1_templates_jobs` · `rls_m1_members` (invite provisioning, invitee acceptance only own row, nobody else) · `rls_m1_candidate_denied` · `rls_m1_carried` (B0-SP7 rest). The `rls-min-count` floor rises by the new count; catalog MT lists updated (new role in MT-14, new INVOKER functions allowed in `public`).

## 11. BUILD plan

### 11.1 Branching and migration order (M1 ∥ M2)
Both milestones build on **one integration branch `m12/integration`** cut from the D1 CLOSE commit, because their migrations interleave (M2's drive trigger calls M1's `assert_drive_pool_ratio`). Order: **M1-a, M1-b, M1-c, M1-d, then M2's migrations**. Each milestone still has its own REVIEW, summary and tag (`m1-reviewed`, `m2-reviewed`); CLOSE merges `m12/integration` once both PASS. This is a HOW change the lead records under build-notes "Autopilot changes" at BUILD start (SPEC-M1-M2.md F-6).

### 11.2 Wave 0 (lead, no writers)
Migrations M1-a…d with their pgTAP files written red first; `contracts-m1.ts`, `TestPackageV2`, mirror v2; ADR-032 (`fflate`); `trace_authoring_worker`/`trace_admin_worker` logins in the operator runbook; wrangler bindings (Queue `trace-authoring`, `trace-admin`; R2 prefix `item-media/` in the packages bucket's sibling `trace-item-media-<env>`); `check-boundaries` rules (no `eval`/`Function` in `packages/item-variants`; vendors mock production guard); carried items owned by the lead (§1.5); pre-flight agent (AUTOPILOT §2 efficiency rules).

### 11.3 Streams (≤3 writers at once; strict directories)
| Stream | Owns | Needs | Model | Reviews |
| --- | --- | --- | --- | --- |
| A1 pure packages | `packages/item-variants/**`, `packages/item-delivery/**` (new) | contracts | Opus (delivery seeds = rule-3 adjacent determinism) | spec-reviewer |
| A2 api authoring | `services/api/src/modules/{bank,pools,library,imports,ai-drafts,templates,integrity-settings,members}/**`, D1 `modules/tests/**` changes | contracts, migrations, A1 | Opus | spec, security, database |
| A3 jobs | `workers/jobs/src/{drafting,members}/**`, `workers/jobs/src/mirror/**` (v2 fields), `workers/jobs/src/quality/**` (variant keys) | migrations, contracts | Opus (quality touches rule 1 paths) | spec, security, database |
| A4 edge delivery | `workers/edge/src/session-do*` draw/section/navigation, `workers/edge/src/item-media*` (M2's B4 owns `workers/edge/src/lobby/**` and touches `session-do*` only after A4 merges) | A1, contracts | Opus | spec, security |
| A5 recruiter app | `apps/recruiter/src/{tests,bank,library,settings}/**` (M2's B5 owns `drives/**`; `routes.tsx`, the shell nav and `auth/**` are lead-only) | contracts; A2 types (fake fetch) | Sonnet writer, Opus review | spec, security |
| A6 vendors | `packages/vendors/src/llm-drafter*.ts` | contracts | Sonnet | spec, security |
Waves: Wave 1 = A1, A6, A2 · Wave 2 = A3, A4, A5 · then e2e (lead + Sonnet: `e2e/tests/m1-*.spec.ts`).

## 12. Acceptance tests (each runs in `pnpm verify` unless marked E2E or MEASURE)
| AT | Gate item | Test file(s) and what it proves |
| --- | --- | --- |
| AT-M1-01 | ABH-5 Done when (proxy) | E2E `e2e/tests/m1-template-publish.spec.ts`: from sign-in to a published test via the Customer Support template, scripted at human pace (fixed waits per field), finishes ≤ 5 min and records `elapsed_ms`; real 5-recruiter median deferred (§13) |
| AT-M1-02 | ABH-6 reviewed + tagged | `rls_m1_bank`: `approved` without `skill_key`/`difficulty`/`approved_by` fails; library org: `reviewed_by = created_by` or `key_reviewed_by = created_by` fails; customer self-approval allowed and audited |
| AT-M1-03 | ABH-6 exposure counter | `rls_m1_serving`: inserting a `session_items` row increments `item_exposure` once (and the library counter for a copy); a duplicate insert is refused by the unique key and counts nothing |
| AT-M1-04 | ABH-7 generator | `packages/item-variants/src/*.test.ts`: parser grammar (accept/refuse table, no `eval`, depth/length caps), exact rationals, seeded determinism (same seed → same variants), constraint and distinct-option rejection, fast-check property "every generated variant satisfies its constraints and its key is one of its options" |
| AT-M1-05 | ABH-7 difficulty ±0.1 | `rls_m1_variants`: 0.11 away refused, 0.10 accepted; `packages/item-variants` refuses author difficulty outside ±0.10 before insert |
| AT-M1-06 | ABH-7 "≥40% vary" metric | `services/api/src/modules/bank/stats.test.ts` (share computed from fixture counts; only `quant`, only approved); content target deferred (§13) |
| AT-M1-07 | ABH-8 / exit: DB constraint | `rls_m1_bank`: an `ai_draft` version cannot become `approved` or `retired` without `approved_by` (CHECK), for every role **and** `trace_authoring_worker` |
| AT-M1-08 | ABH-8 / exit: cannot be served | `rls_m1_serving`: `trace_worker` inserting a `session_items` row for an unapproved `ai_draft` version is refused by `session_items_ai_gate` (fixture: an `ai_draft` version left in `in_review`, inserted on the operator path; no guard is disabled); `rls_m1_publish_v2`: publish refuses a section snapshot containing it |
| AT-M1-09 | ABH-8 approver logged | `rls_m1_bank`: approval writes `item.approve` with `actor_user_id` = approver; `workers/jobs/src/drafting/handler.test.ts`: drafts land `in_review` only, never `approved`; mock drafter refuses `production` |
| AT-M1-10 | ABH-9 / exit: 500 items with images < 5 min | MEASURE + E2E `e2e/tests/m1-import-500.spec.ts` (local stack in Linux CI): a generated `trace-items-v1.xlsx` with 500 rows and 500 distinct images (≈60 KB each) imported end to end; asserts `elapsed_ms < 300000` and 500 approved versions; the time is recorded in the M1 summary |
| AT-M1-11 | ABH-9 error per bad row | `services/api/src/modules/imports/rows.test.ts` (each code in §4.3 from a fixture row; response lists every bad row; no cell value in any error or log); `apps/recruiter/src/bank/import/parse.test.ts` (xlsx + docx fixtures, caps, formulas not evaluated, macro files refused) |
| AT-M1-12 | ABH-10 pool ≥10× for drives | `rls_m1_snapshot`: `min_pool_ratio` set at publish; `private.assert_drive_pool_ratio` raises at 9.9× and for any inline-only section, passes at 10× (M2's AT-M2-14 calls it from the drive trigger) |
| AT-M1-13 | Exit: editing a published version rejected by the DB | `rls_m1_publish_v2`: UPDATE/DELETE on the published `test_versions`, `sections`, inline `item_versions`, keys, `ruleset_versions` (incl. `settings`), `section_pool_snapshot` refused for owner/admin/recruiter, `trace_api`, `trace_worker`, `trace_quality_worker` and the operator |
| AT-M1-14 | Q20 edit → new draft; invitation keeps version | `services/api/src/modules/tests/versions.test.ts` + `rls_m1_publish_v2`: clone creates `version_no + 1` draft with copied settings; existing invitations still pin the old id (D1 immutable column) |
| AT-M1-15 | Presets | `rls_m1_settings`: each preset's values match §6.6; `derive_signal_settings` vectors (all presets × paste/focus/provenance values) |
| AT-M1-16 | Admin locks + always-locked | `rls_m1_settings`: locked key with another value refused on save and publish; `integrity_review_scope` only `shortlist_only`; `accommodations` only `on`; non-admin cannot lock |
| AT-M1-17 | Settings never raise an unvalidated rule (rule 3) | `packages/band-engine` property test extended: for every derived `signal_settings`, a band computed with signals switched on is never above the band with the rule table's `validated = false` rules removed; `paste_written = allowed_logged` → paste events never raise the band (default of Q-M1-1) |
| AT-M1-18 | Draw determinism | `packages/item-delivery/src/draw.property.test.ts`: same seed → same draw/order/options/variant; strata quotas met; no item twice; uniform spread (χ² over 10,000 seeds within bound) |
| AT-M1-19 | Server-side delivery | `workers/edge/src/session-do.draw.test.ts`: draw stored before first serve; reload/second device gets the same draw; closed section refused; forward-only refused; section deadline enforced by the DO clock; package v1 still served as D1 |
| AT-M1-20 | No key reaches the edge or candidate | `packages/shared` `TestPackageV2` schema walk (no key-like field); `services/api/src/modules/tests/package.test.ts` builds a package from fixtures with keys present in DB and finds none in the JSON |
| AT-M1-21 | Mirror and scoring with draws/variants | `workers/jobs/src/mirror/*.test.ts` (v2 fields stored; snapshot check passes) and `workers/jobs/src/quality/score.test.ts` (variant key used; shuffled options scored by option id) |
| AT-M1-22 | Library keys hidden | `rls_m1_keys`: every org role reads 0 `library_sourced` keys; quality worker reads them; `LibraryItemCard` type has no key (contract test) |
| AT-M1-23 | Item images only for served items | `workers/edge/src/item-media.test.ts` |
| AT-M1-24 | Never-build and no reject path | `route-inventory.test.ts` extended; `apps/recruiter/src/m1-guards.test.tsx` (no reject/decision control, no AI-likeness/solvability, no blended number on any M1 route); `never-build.test.ts` unchanged and green |
| AT-M1-25 | Audit details carry no free text (B0-SEC7) | `rls_m1_bank` + `rls_m1_imports`: every new action's `details` keys/values are ids, enums or counts |
| AT-M1-26 | Member invitations | `rls_m1_members` + `workers/jobs/src/members/provision.test.ts` (fake admin API) |
| AT-M1-27 | Carried auth items | `apps/recruiter/src/auth/*.test.tsx` (account-existence copy, `onAuthStateChange`, http only in dev) |

## 13. Deferred gates (for `docs/milestones/M1-summary.md`)
| Check | Proxy that closes M1 | Owner |
| --- | --- | --- |
| ABH-5: 5 real recruiters, median ≤ 5 min | AT-M1-01 | ≤ M8 (Q21) |
| ABH-7: ≥40% of library quant items parameterised (content) | AT-M1-06 metric | ≤ M8 (library v1 delivered, ABH-84) |
| ABH-7: empirical difficulty within ±0.1 of the parent | AT-M1-05 (expert-tagged constraint) | **M10** if the founder confirms build-notes Q58, else M8 (SPEC-M1-M2.md Q-M1-3) |
| ABH-6: every library item expert-reviewed (real content) | AT-M1-02 constraints | ≤ M8 (ABH-84) |
| Real Bedrock drafting adapter | mock + interface tests | after ABH-87 (M5 picks the model) |

## 14. OPEN
- OPEN-M1-1: Q-M1-1 (paste "allowed, logged" never raises the band) — founder; safe default built.
- OPEN-M1-2: Q-M1-2 (D1 notice until M3b) — founder; default stands.
- OPEN-M1-3: Q-M1-3 (Q58 owner of ABH-7 empirical check) — founder.
- OPEN-M1-4: DC-M1-4 Workers CPU (OPEN-8a) — founder gate if it fails.
