// Mirror stage (spec d1 §5.1 row `mirror`, §3.4 mirror_session semantics, §10-DB; L-6, L-12, L-35, R-14), as
// trace_worker in the one transaction the consumer opens and commits. Neutral code (rule 1): it writes public session
// facts only and knows no score or band.
//
// Order: message checks -> lock the invitation -> `session_mirror` key present: done (duplicate; spec F5, before any
// R2 read, so a redelivery after success never depends on R2) -> invitation revoked/expired/blocked_age:
// `mirror_dead_invitation` (retried, then the DLQ for an operator look) -> the invitation's session id must be the
// message's -> the consent row must exist for the message's consentId, invitation and ruleset -> both adult answers
// (rule 9) -> package v2: the served layout against the pinned version (R5-62 b, below) -> hash-check final.json
// and the start photo (R2) -> sessions, session_items, responses, media_objects (verified photo only), reports,
// invitation `submitted`, key.
//
// Package v2 (spec m1 R5-19, R5-42, R5-47, R5-59 a): the session_items rows are built by ./draws.ts before anything is
// read (one per drawn pool item at its draw position, served facts merged; inline rows as D1) and inserted in one
// statement; answers still map to items only through served[] (position -> item), so an answer at a position with
// no served row is `mirror_final_invalid` (retry, then the DLQ). Before anything is written (and after the key, so a
// re-delivery of a mirrored session still returns there), the served slots and the pool section list are checked
// against the pinned version's layout, read with the M1-i column grants (../quality/layout.ts: a pure check with no
// score or key, the one implementation the quality stage repeats): a served row at another item's slot, or a pool
// section missing from poolSectionIds, is `mirror_bad_served_position` / `mirror_bad_draws` (retry, then the DLQ),
// and nothing is stored. Two different bodies for one session can therefore never be scored from the first body's
// mapping (R5-62 b).
//
// The job writes the rows itself rather than through private.mirror_session because the carried C1b binding needs
// a photo the head check refused to be dropped while the message still names it, and mirror_session refuses a
// message with neither a photo nor a skip reason (see docs/reviews/D1-r2-writer-report.md).
import { isStorableText, type SessionMirrorMessage } from '@trace/shared/contracts/candidate';
import { jobKey, type EvidenceReader, type SqlTx } from '@trace/shared/jobs';
import { sessionItemsV2 } from './draws.js';
import { readFinalAnswers, sha256Hex, verifiedPhoto } from './evidence.js';
import { MIRROR_LAYOUT_CODES, checkServedLayout } from '../quality/layout.js';
import {
  consentExists,
  insertKey,
  insertMedia,
  insertReport,
  insertResponses,
  keyExists,
  loadLayout,
  lockInvitation,
  submitInvitation,
  upsertItems,
  upsertItemsV2,
  upsertSession,
  type ResponseInsert,
} from './writes.js';

export interface MirrorDeps {
  tx: SqlTx;
  evidence: EvidenceReader;
}

const fail = (code: string): never => {
  throw new Error(code);
};

const DEAD = new Set(['revoked', 'expired', 'blocked_age']);

/** final.json's answers as response rows (hash-checked, served positions only, storable text only). */
const readAnswers = async (
  evidence: EvidenceReader,
  message: SessionMirrorMessage,
): Promise<{ itemVersionId: string; row: Omit<ResponseInsert, 'session_item_id'> }[]> => {
  const final = await readFinalAnswers(evidence, message);
  const itemAt = new Map(message.served.map((s) => [s.position, s.itemVersionId]));
  const answers: { itemVersionId: string; row: Omit<ResponseInsert, 'session_item_id'> }[] = [];
  for (const a of final.answers) {
    const itemVersionId = itemAt.get(a.position);
    if (itemVersionId === undefined) return fail('mirror_final_invalid');
    if (a.kind === 'text') {
      // Security review #2 (defence in depth; the contract refuses it too): text Postgres cannot store would fail
      // every redelivery with a database error, so it is a malformed file here, before any write.
      if (!isStorableText(a.text)) return fail('mirror_final_invalid');
      if ((await sha256Hex(a.text)) !== a.sha256) return fail('mirror_final_invalid');
      answers.push({
        itemVersionId,
        row: {
          answer_kind: 'text',
          final_text: a.text,
          final_choice: null,
          answer_sha256: a.sha256,
          final_seq: a.finalSeq,
        },
      });
    } else {
      if ((await sha256Hex(a.choice ?? '')) !== a.sha256) return fail('mirror_final_invalid');
      // A cleared choice is no answer (responses has no "choice = null" row).
      if (a.choice === null) continue;
      answers.push({
        itemVersionId,
        row: {
          answer_kind: 'choice',
          final_text: null,
          final_choice: a.choice,
          answer_sha256: a.sha256,
          final_seq: a.finalSeq,
        },
      });
    }
  }

  return answers;
};

const runMirrorUnsafe = async (message: SessionMirrorMessage, deps: MirrorDeps): Promise<void> => {
  const { tx, evidence } = deps;
  const orgId = message.orgId;
  const sessionId = message.sessionId;
  const key = jobKey(sessionId, 'session_mirror', message.rulesetVersionId);
  if (message.jobKey !== key) return fail('mirror_bad_message');
  // Spec F4: exactly one of photo and photoSkippedReason (private.mirror_session's rule).
  if ((message.photo === null) === (message.photoSkippedReason === null)) {
    return fail('mirror_bad_message');
  }

  // Served items: one per position and per item version (a repeat is a malformed message, never a retry).
  const positions = new Set(message.served.map((s) => s.position));
  const itemIds = new Set(message.served.map((s) => s.itemVersionId));
  if (positions.size !== message.served.length || itemIds.size !== message.served.length) {
    return fail('mirror_bad_message');
  }
  if (message.served.some((s) => !Number.isInteger(s.position) || s.position < 1)) {
    return fail('mirror_bad_message');
  }
  // Package v2 (spec m1 R5-42): every row is built, and every invariant checked, before anything is read or written.
  const rowsV2 = message.v === 2 ? sessionItemsV2(message) : null;

  const invitation = await lockInvitation(tx, orgId, message.invitationId);
  if (invitation === null) return fail('mirror_invitation_missing');
  if (await keyExists(tx, orgId, key)) return; // duplicate: the first mirror committed everything
  if (DEAD.has(invitation.status)) return fail('mirror_dead_invitation');
  if (invitation.session_id !== sessionId) return fail('mirror_session_mismatch');
  if (
    !(await consentExists(
      tx,
      orgId,
      message.consentId,
      message.invitationId,
      message.rulesetVersionId,
    ))
  ) {
    return fail('mirror_consent_missing');
  }
  if (invitation.adult_self_declared !== true || invitation.adult_confirmed_by_inviter === false) {
    return fail('mirror_not_adult');
  }

  // Package v2 (R5-59 a, R5-62 b): the served layout against the pinned version, before anything is written.
  if (message.v === 2) {
    const layout = await loadLayout(tx, orgId, message.testVersionId);
    checkServedLayout(layout.sections, layout.inline, message, MIRROR_LAYOUT_CODES);
  }

  // Spec F5: R2 is read only now, after the key check, so a redelivery after success never depends on it.
  const answers = await readAnswers(evidence, message);
  const photo = await verifiedPhoto(evidence, message);

  await upsertSession(tx, orgId, {
    sessionId,
    testVersionId: message.testVersionId,
    rulesetVersionId: message.rulesetVersionId,
    invitationId: message.invitationId,
    consentId: message.consentId,
    state: message.state,
    startedAt: message.startedAt,
    deadlineAt: message.deadlineAt,
    submittedAt: message.submittedAt,
    mirrorSeq: message.mirrorSeq,
    receiptRef: message.receiptRef,
  });
  const sessionItem =
    rowsV2 === null
      ? await upsertItems(
          tx,
          orgId,
          sessionId,
          message.served.map((s) => ({
            item_version_id: s.itemVersionId,
            position: s.position,
            served_at: s.servedAt,
          })),
        )
      : await upsertItemsV2(tx, orgId, sessionId, rowsV2);
  await insertResponses(
    tx,
    orgId,
    sessionId,
    message.submittedAt,
    answers.map((a) => {
      const sessionItemId = sessionItem.get(a.itemVersionId);
      if (sessionItemId === undefined) return fail('mirror_items_not_stored');
      return { session_item_id: sessionItemId, ...a.row };
    }),
  );
  if (photo !== null) await insertMedia(tx, orgId, sessionId, photo);
  await insertReport(tx, orgId, sessionId);
  // After the sessions row exists (L-35: the invitations guard requires it for `submitted`).
  await submitInvitation(tx, orgId, message.invitationId);
  await insertKey(tx, orgId, key, sessionId, message.submittedAt);
};

const FALLBACK = 'mirror_failed';

const CONSTANT_CODE = /^[a-z][a-z0-9_]{2,63}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * Every error leaves the stage as a constant code: our own codes pass through; anything else (a driver or database
 * error, whose fields may quote row values) becomes `FALLBACK`, keeping only a well-formed SQLSTATE in `code` so a
 * caller can still tell a serialization failure (40001) from other failures.
 */
const constantError = (err: unknown): Error => {
  if (err instanceof Error && CONSTANT_CODE.test(err.message)) return err;
  const out = new Error(FALLBACK);
  const code =
    typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && SQLSTATE.test(code)) Object.assign(out, { code });
  return out;
};

/** The stage entry point (the consumer injects `deps.tx`, one transaction as the stage's worker role). */
export const runMirror = async (message: SessionMirrorMessage, deps: MirrorDeps): Promise<void> => {
  try {
    await runMirrorUnsafe(message, deps);
  } catch (err) {
    throw constantError(err);
  }
};
