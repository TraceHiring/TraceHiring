// Mirror stage (spec d1 §5.1 row `mirror`, §3.4 mirror_session semantics, §10-DB; L-6, L-12, L-35, R-14), as
// trace_worker in the one transaction the consumer opens and commits. Neutral code (rule 1): it writes public session
// facts only and knows no score or band.
//
// Order: hash-check final.json and the start photo (R2) -> lock the invitation -> `session_mirror` key present:
// done (duplicate) -> invitation revoked/expired/blocked_age: `mirror_dead_invitation` (retried, then the DLQ for an
// operator look) -> the invitation's session id must be the message's -> the consent row must exist for the message's
// consentId, invitation and ruleset -> both adult answers (rule 9) -> sessions, session_items, responses,
// media_objects (verified photo only), reports, invitation `submitted`, key.
//
// The job writes the rows itself rather than through private.mirror_session because the carried C1b binding needs
// a photo the head check refused to be dropped while the message still names it, and mirror_session refuses a
// message with neither a photo nor a skip reason (see docs/reviews/D1-r2-writer-report.md).
import type { SessionMirrorMessage } from '@trace/shared/contracts/candidate';
import { jobKey, type EvidenceReader, type SqlTx } from '@trace/shared/jobs';
import { readFinalAnswers, sha256Hex, verifiedPhoto } from './evidence.js';
import {
  consentExists,
  insertKey,
  insertMedia,
  insertReport,
  insertResponses,
  keyExists,
  lockInvitation,
  submitInvitation,
  upsertItems,
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

export const runMirror = async (message: SessionMirrorMessage, deps: MirrorDeps): Promise<void> => {
  const { tx, evidence } = deps;
  const orgId = message.orgId;
  const sessionId = message.sessionId;
  const key = jobKey(sessionId, 'session_mirror', message.rulesetVersionId);
  if (message.jobKey !== key) return fail('mirror_bad_message');

  // Served items: one per position and per item version (a repeat is a malformed message, never a retry).
  const positions = new Set(message.served.map((s) => s.position));
  const itemIds = new Set(message.served.map((s) => s.itemVersionId));
  if (positions.size !== message.served.length || itemIds.size !== message.served.length) {
    return fail('mirror_bad_message');
  }
  if (message.served.some((s) => !Number.isInteger(s.position) || s.position < 1)) {
    return fail('mirror_bad_message');
  }

  const final = await readFinalAnswers(evidence, message);
  const itemAt = new Map(message.served.map((s) => [s.position, s.itemVersionId]));
  const answers: { itemVersionId: string; row: Omit<ResponseInsert, 'session_item_id'> }[] = [];
  for (const a of final.answers) {
    const itemVersionId = itemAt.get(a.position);
    if (itemVersionId === undefined) return fail('mirror_final_invalid');
    if (a.kind === 'text') {
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
  const photo = await verifiedPhoto(evidence, message);

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
  const sessionItem = await upsertItems(
    tx,
    orgId,
    sessionId,
    message.served.map((s) => ({
      item_version_id: s.itemVersionId,
      position: s.position,
      served_at: s.servedAt,
    })),
  );
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
