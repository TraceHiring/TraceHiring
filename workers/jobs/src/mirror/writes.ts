// SQL of the mirror stage (spec d1 §5.1 row `mirror`, §3.2, §3.4, §10-DB), run as trace_worker inside the one
// transaction the consumer opens. Only public session rows: sessions, session_items, responses, media_objects, one
// reports row (both card ids null), invitation -> submitted after the sessions row exists, and the session_mirror
// key. No consent, signal or result is written. Constant SQL, bound parameters, jsonb as `$n::text::jsonb` (a text
// parameter: postgres.js would otherwise JSON-encode a string bound to an inferred jsonb parameter a second time).
//
// The invitation row is locked first (FOR UPDATE), as private.mirror_session does, so two connections mirroring the
// same message serialise: the second waits, then (READ COMMITTED) finds the committed key and stops. Every insert is
// ON CONFLICT DO NOTHING followed by a re-read, so a replay returns the same ids.
import type { SqlTx } from '@trace/shared/jobs';
import type { SessionItemInsert } from './draws.js';

export const SQL = {
  lockInvitation:
    'select status::text as status, session_id::text as session_id, adult_confirmed_by_inviter, ' +
    'adult_self_declared from public.invitations where org_id = $1::uuid and id = $2::uuid for update',
  keyExists:
    "select 1 as one from public.idempotency_keys where org_id = $1::uuid and scope = 'session_mirror' and key = $2",
  consent:
    'select 1 as one from public.consents where org_id = $1::uuid and id = $2::uuid and invitation_id = $3::uuid ' +
    'and ruleset_version_id = $4::uuid',
  insertSession:
    'insert into public.sessions (id, org_id, test_version_id, ruleset_version_id, invitation_id, consent_id, state, ' +
    'submit_kind, adult_confirmed_at_start, started_at, server_deadline_at, submitted_at, mirror_seq, receipt_ref) ' +
    'values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7, $8, true, $9::timestamptz, ' +
    '$10::timestamptz, $11::timestamptz, $12::int, $13) on conflict do nothing',
  session:
    'select id::text as id, invitation_id::text as invitation_id, mirror_seq::int as mirror_seq ' +
    'from public.sessions where org_id = $1::uuid and id = $2::uuid',
  insertItems:
    'insert into public.session_items (org_id, session_id, item_version_id, position, served_at) ' +
    'select $1::uuid, $2::uuid, x.item_version_id, x.position, x.served_at from jsonb_to_recordset($3::text::jsonb) ' +
    'as x(item_version_id uuid, position int, served_at timestamptz) on conflict do nothing',
  items:
    'select id::text as id, item_version_id::text as item_version_id, position::int as position ' +
    'from public.session_items where org_id = $1::uuid and session_id = $2::uuid',
  // Package v2 (spec m1 R5-19, R5-39 a, R5-42): the section, variant, option order and draw seed hash are written; a
  // drawn item never served has served_at null. One statement per session, so every row is inserted exactly once.
  insertItemsV2:
    'insert into public.session_items (org_id, session_id, section_id, item_version_id, position, served_at, ' +
    'item_variant_id, option_order, draw_seed_sha256) select $1::uuid, $2::uuid, x.section_id, x.item_version_id, ' +
    'x.position, x.served_at, x.item_variant_id, x.option_order, x.draw_seed_sha256 ' +
    'from jsonb_to_recordset($3::text::jsonb) as x(section_id uuid, item_version_id uuid, position int, ' +
    'served_at timestamptz, item_variant_id uuid, option_order jsonb, draw_seed_sha256 text) on conflict do nothing',
  itemsV2:
    'select id::text as id, item_version_id::text as item_version_id, section_id::text as section_id, ' +
    'position::int as position, (served_at is not null) as served ' +
    'from public.session_items where org_id = $1::uuid and session_id = $2::uuid',
  insertResponses:
    'insert into public.responses (org_id, session_id, session_item_id, answer_kind, final_text, final_choice, ' +
    'answer_sha256, final_seq, submitted_at) select $1::uuid, $2::uuid, x.session_item_id, x.answer_kind, ' +
    'x.final_text, x.final_choice, x.answer_sha256, x.final_seq, $3::timestamptz from jsonb_to_recordset($4::text::jsonb) ' +
    'as x(session_item_id uuid, answer_kind text, final_text text, final_choice text, answer_sha256 text, ' +
    'final_seq int) on conflict do nothing',
  insertMedia:
    'insert into public.media_objects (org_id, session_id, kind, r2_key, sha256, bytes, mime, blurred_on_device) ' +
    "values ($1::uuid, $2::uuid, 'start_photo', $3, $4, $5::int, 'image/jpeg', true) on conflict do nothing",
  insertReport:
    'insert into public.reports (org_id, session_id) values ($1::uuid, $2::uuid) on conflict do nothing',
  submitInvitation:
    "update public.invitations set status = 'submitted' where org_id = $1::uuid and id = $2::uuid " +
    "and status <> 'submitted'",
  insertKey:
    'insert into public.idempotency_keys (org_id, scope, key, result_ref, expires_at) ' +
    "values ($1::uuid, 'session_mirror', $2, $3, $4::timestamptz + interval '90 days') on conflict do nothing",
} as const;

export interface InvitationLock {
  status: string;
  session_id: string | null;
  adult_confirmed_by_inviter: boolean | null;
  adult_self_declared: boolean | null;
}

export interface SessionInsert {
  sessionId: string;
  testVersionId: string;
  rulesetVersionId: string;
  invitationId: string;
  consentId: string;
  state: 'submitted' | 'auto_submitted';
  startedAt: string;
  deadlineAt: string;
  submittedAt: string;
  mirrorSeq: number;
  receiptRef: string;
}

export interface ServedInsert {
  item_version_id: string;
  position: number;
  served_at: string;
}

export interface ResponseInsert {
  session_item_id: string;
  answer_kind: 'text' | 'choice';
  final_text: string | null;
  final_choice: string | null;
  answer_sha256: string;
  final_seq: number;
}

export const lockInvitation = async (
  tx: SqlTx,
  orgId: string,
  invitationId: string,
): Promise<InvitationLock | null> =>
  (await tx.query<InvitationLock>(SQL.lockInvitation, [orgId, invitationId]))[0] ?? null;

export const keyExists = async (tx: SqlTx, orgId: string, key: string): Promise<boolean> =>
  (await tx.query(SQL.keyExists, [orgId, key])).length > 0;

export const consentExists = async (
  tx: SqlTx,
  orgId: string,
  consentId: string,
  invitationId: string,
  rulesetVersionId: string,
): Promise<boolean> =>
  (await tx.query(SQL.consent, [orgId, consentId, invitationId, rulesetVersionId])).length > 0;

/** Inserts the session (once) and checks the stored row is this invitation's. */
export const upsertSession = async (tx: SqlTx, orgId: string, s: SessionInsert): Promise<void> => {
  await tx.query(SQL.insertSession, [
    s.sessionId,
    orgId,
    s.testVersionId,
    s.rulesetVersionId,
    s.invitationId,
    s.consentId,
    s.state,
    s.state === 'submitted' ? 'candidate' : 'deadline',
    s.startedAt,
    s.deadlineAt,
    s.submittedAt,
    s.mirrorSeq,
    s.receiptRef,
  ]);
  const row = (
    await tx.query<{ id: string; invitation_id: string; mirror_seq: number }>(SQL.session, [
      orgId,
      s.sessionId,
    ])
  )[0];
  if (row === undefined) throw new Error('mirror_session_not_stored');
  if (row.invitation_id !== s.invitationId) throw new Error('mirror_session_mismatch');
};

/** Inserts the served items (once) and returns session_item ids by item version id. */
export const upsertItems = async (
  tx: SqlTx,
  orgId: string,
  sessionId: string,
  served: readonly ServedInsert[],
): Promise<Map<string, string>> => {
  if (served.length > 0) {
    await tx.query(SQL.insertItems, [orgId, sessionId, JSON.stringify(served)]);
  }
  const rows = await tx.query<{ id: string; item_version_id: string; position: number }>(
    SQL.items,
    [orgId, sessionId],
  );
  const byItem = new Map(rows.map((r) => [r.item_version_id, r.id]));
  for (const s of served)
    if (!byItem.has(s.item_version_id)) throw new Error('mirror_items_not_stored');
  return byItem;
};

/**
 * Package v2: inserts the session's rows (once) and returns session_item ids by item version id. The stored rows
 * must be exactly the ones built from the message (same section, position and served state), else nothing commits.
 */
export const upsertItemsV2 = async (
  tx: SqlTx,
  orgId: string,
  sessionId: string,
  rows: readonly SessionItemInsert[],
): Promise<Map<string, string>> => {
  if (rows.length > 0) {
    await tx.query(SQL.insertItemsV2, [orgId, sessionId, JSON.stringify(rows)]);
  }
  const stored = await tx.query<{
    id: string;
    item_version_id: string;
    section_id: string;
    position: number;
    served: boolean;
  }>(SQL.itemsV2, [orgId, sessionId]);
  const byItem = new Map(stored.map((r) => [r.item_version_id, r]));
  if (stored.length !== rows.length) throw new Error('mirror_items_mismatch');
  for (const row of rows) {
    const s = byItem.get(row.item_version_id);
    if (s === undefined) throw new Error('mirror_items_not_stored');
    if (
      s.section_id !== row.section_id ||
      s.position !== row.position ||
      s.served !== (row.served_at !== null)
    ) {
      throw new Error('mirror_items_mismatch');
    }
  }
  return new Map(stored.map((r) => [r.item_version_id, r.id]));
};

export const insertResponses = async (
  tx: SqlTx,
  orgId: string,
  sessionId: string,
  submittedAt: string,
  responses: readonly ResponseInsert[],
): Promise<void> => {
  if (responses.length === 0) return;
  await tx.query(SQL.insertResponses, [orgId, sessionId, submittedAt, JSON.stringify(responses)]);
};

export const insertMedia = async (
  tx: SqlTx,
  orgId: string,
  sessionId: string,
  photo: { key: string; sha256: string; bytes: number },
): Promise<void> => {
  await tx.query(SQL.insertMedia, [orgId, sessionId, photo.key, photo.sha256, photo.bytes]);
};

export const insertReport = async (tx: SqlTx, orgId: string, sessionId: string): Promise<void> => {
  await tx.query(SQL.insertReport, [orgId, sessionId]);
};

export const submitInvitation = async (
  tx: SqlTx,
  orgId: string,
  invitationId: string,
): Promise<void> => {
  await tx.query(SQL.submitInvitation, [orgId, invitationId]);
};

export const insertKey = async (
  tx: SqlTx,
  orgId: string,
  key: string,
  sessionId: string,
  submittedAt: string,
): Promise<void> => {
  await tx.query(SQL.insertKey, [orgId, key, sessionId, submittedAt]);
};
