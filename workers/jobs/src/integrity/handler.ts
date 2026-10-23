// Integrity stage (spec d1 §5.1 row `integrity`, "Cutoff and not_used", "Transactions and retries"; D1-6, D1-7,
// D1-10; R-2, R-11, L-3, L-4, L-14, L-28, m-6, n-6), as trace_integrity_worker in the one transaction the consumer
// opens and commits. The band is always computed and stored from the evidence alone (rule 3); score-first triage
// (rule 6) then uses ONLY public.quality_cards.meets_cutoff:
//   - no card yet, quality card meets the cutoff: flags `pending`, card inserted `reviewed`, timeline, pointer, key;
//   - no card yet, quality card below the cutoff: flags `not_used`, card `not_reviewed_below_cutoff`, no timeline,
//     no pointer (the attach guard refuses it), key;
//   - no card yet, no quality card: card `awaiting_quality` with no flag, timeline, pointer or key;
//   - card awaiting and the quality card now exists: flags in the state meets_cutoff requires, then the single
//     UPDATE, plus timeline/pointer (reviewed only) and the key; never a re-insert of the card (n-6);
//   - card final: nothing to do.
// A card guard error because a quality card landed between the gate read and the awaiting insert aborts the
// transaction: it is thrown as `integrity_retry`, so the message is retried and the next run takes the final path.
// Rule 1: no score, no quality type; an integrity result never touches a quality card.
// Package v2 messages run this stage unchanged (it reads no item data). A result stored under another engine version
// (a D1 awaiting card under band-engine-1) is never overwritten: the flip fails with integrity_input_changed and the
// message reaches the DLQ (spec m1 R5-52 f names no other behaviour; the repair is an open lead question).
import type { SessionMirrorMessage } from '@trace/shared/contracts/candidate';
import { jobKey, type EvidenceReader, type SqlTx } from '@trace/shared/jobs';
import { callBand, flagRows, ruleTableOf, signalSettingsOf, timelineRows } from './band-call.js';
import { isPhotoMissing, loadSignals } from './load.js';
import {
  attachCard,
  flipCard,
  insertCard,
  insertFlags,
  insertKey,
  insertSignals,
  insertTimeline,
  keyExists,
  loadRuleTable,
  loadSession,
  lockKey,
  readCard,
  readMeetsCutoff,
  readResult,
  upsertResult,
  type Ids,
  type ReviewState,
  type StoredResult,
} from './store.js';

export interface IntegrityDeps {
  tx: SqlTx;
  evidence: EvidenceReader;
}

const fail = (code: string): never => {
  throw new Error(code);
};

/** The integrity_cards_guard refusal of an awaiting card (a quality card exists): errcode 42501 and its text. */
const AWAITING_GUARD = 'TRACE_GUARD: awaiting_quality needs no quality card';
const isAwaitingGuardError = (err: unknown): boolean =>
  err instanceof Error &&
  (err as { code?: unknown }).code === '42501' &&
  err.message.startsWith(AWAITING_GUARD);

/**
 * Spec F1, rule 3: the stored result must be the one this run computes: the same input hash, engine version and
 * band. A result from another engine version (or with another band) is never re-used for a card.
 */
const sameResult = (
  stored: StoredResult,
  band: { inputHash: string; output: { engineVersion: string; band: string } },
): boolean =>
  stored.input_hash === band.inputHash &&
  stored.engine_version === band.output.engineVersion &&
  stored.band === band.output.band;

const finalState = (meetsCutoff: boolean): ReviewState =>
  meetsCutoff ? 'reviewed' : 'not_reviewed_below_cutoff';

const runIntegrityUnsafe = async (
  message: SessionMirrorMessage,
  deps: IntegrityDeps,
): Promise<void> => {
  const { tx, evidence } = deps;
  const ids: Ids = {
    orgId: message.orgId,
    sessionId: message.sessionId,
    rulesetVersionId: message.rulesetVersionId,
  };
  const key = jobKey(ids.sessionId, 'integrity_band', ids.rulesetVersionId);
  if (await keyExists(tx, ids.orgId, key)) return;
  // DB review #1: a concurrent run of the same job waits here; once it holds the lock the first run has committed
  // (or rolled back), so the key is checked again and every read below sees that run's rows.
  await lockKey(tx, key);
  if (await keyExists(tx, ids.orgId, key)) return;

  const session = await loadSession(tx, ids.orgId, ids.sessionId);
  if (session === null) return fail('integrity_session_missing');
  if (session.ruleset_version_id !== ids.rulesetVersionId) return fail('integrity_pin_mismatch');
  if (session.state === 'in_progress') return fail('integrity_session_open');

  // n-6: read the existing card first; a final card is never touched, an awaiting one is never re-inserted.
  const existing = await readCard(tx, ids);
  if (existing !== null && existing.review_state !== 'awaiting_quality') return;
  const gate = await readMeetsCutoff(tx, ids);
  if (existing !== null && gate === null) return; // still waiting for the quality card

  const ruleRow = await loadRuleTable(tx, ids);
  const table = ruleTableOf(ruleRow);
  const signals = await loadSignals(evidence, message);
  // Spec F2 / O4: the flip takes photo_missing from integrity's own stored result (no new R2 head), so a photo that
  // disappears between the runs cannot change the input; input_hash still checks the events.
  const stored = existing === null ? null : await readResult(tx, ids);
  const photoMissing =
    stored === null ? await isPhotoMissing(evidence, message) : stored.photo_missing;
  const band = await callBand(
    table,
    signals,
    message.coverage,
    message.signalCatalogVersion,
    photoMissing,
    signalSettingsOf(ruleRow),
  );

  let resultId: string;
  if (existing === null) {
    await insertSignals(tx, ids, signals);
    const result = await upsertResult(tx, ids, {
      bandRuleVersionId: ruleRow.id,
      engineVersion: band.output.engineVersion,
      band: band.output.band,
      evidenceStrength: band.output.evidenceStrength.toFixed(2),
      coveragePermille: band.output.coveragePermille,
      coverageFloorPermille: table.coverageFloorPermille,
      photoMissing,
      inputHash: band.inputHash,
    });
    if (!sameResult(result, band)) return fail('integrity_input_changed');
    resultId = result.id;
    if (gate === null) {
      // awaiting_quality outcome (m-6): signals, result and card commit together; no flag, timeline, pointer or key.
      try {
        await insertCard(tx, ids, resultId, ruleRow.id, 'awaiting_quality');
      } catch (err) {
        // DB review #2: only the card guard's refusal is a retry; anything else (40001, 40P01, an RLS 42501, a
        // dropped connection) leaves through constantError with its SQLSTATE.
        if (isAwaitingGuardError(err)) return fail('integrity_retry');
        throw err;
      }
      return;
    }
  } else {
    // The stored result was computed from the same frozen evidence and rule table; anything else is a bug.
    if (stored === null || !sameResult(stored, band)) return fail('integrity_input_changed');
    resultId = stored.id;
  }

  // Final outcome (gate known): flags first, in the state the card will need (L-28), then the card.
  if (gate === null) return fail('integrity_retry');
  const state = finalState(gate);
  await insertFlags(tx, ids, gate ? 'pending' : 'not_used', flagRows(table, band.output));
  let cardId: string;
  if (existing === null) {
    const card = await insertCard(tx, ids, resultId, ruleRow.id, state);
    if (card.review_state !== state) return fail('integrity_retry');
    cardId = card.id;
  } else {
    await flipCard(tx, ids, state);
    cardId = existing.id;
  }
  if (state === 'reviewed') {
    await insertTimeline(tx, ids, cardId, timelineRows(band.output, signals));
    await attachCard(tx, ids, cardId);
  }
  await insertKey(tx, ids.orgId, key, cardId, message.submittedAt);
};

const FALLBACK = 'integrity_failed';

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
export const runIntegrity = async (
  message: SessionMirrorMessage,
  deps: IntegrityDeps,
): Promise<void> => {
  try {
    await runIntegrityUnsafe(message, deps);
  } catch (err) {
    throw constantError(err);
  }
};
