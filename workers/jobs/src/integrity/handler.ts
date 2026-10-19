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
import { BAND_ENGINE_VERSION } from '@trace/band-engine';
import type { SessionMirrorMessage } from '@trace/shared/contracts/candidate';
import { jobKey, type EvidenceReader, type SqlTx } from '@trace/shared/jobs';
import { callBand, flagRows, ruleTableOf, timelineRows } from './band-call.js';
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
  readCard,
  readMeetsCutoff,
  readResult,
  upsertResult,
  type Ids,
  type ReviewState,
} from './store.js';

export interface IntegrityDeps {
  tx: SqlTx;
  evidence: EvidenceReader;
}

const fail = (code: string): never => {
  throw new Error(code);
};

const finalState = (meetsCutoff: boolean): ReviewState =>
  meetsCutoff ? 'reviewed' : 'not_reviewed_below_cutoff';

export const runIntegrity = async (
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
  const photoMissing = await isPhotoMissing(evidence, message);
  const band = await callBand(
    table,
    signals,
    message.coverage,
    message.signalCatalogVersion,
    photoMissing,
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
    if (result.input_hash !== band.inputHash) return fail('integrity_input_changed');
    resultId = result.id;
    if (gate === null) {
      // awaiting_quality outcome (m-6): signals, result and card commit together; no flag, timeline, pointer or key.
      try {
        await insertCard(tx, ids, resultId, ruleRow.id, 'awaiting_quality');
      } catch {
        return fail('integrity_retry');
      }
      return;
    }
  } else {
    const result = await readResult(tx, ids);
    // The stored result was computed from the same frozen evidence and rule table; anything else is a bug.
    if (result.input_hash !== band.inputHash || BAND_ENGINE_VERSION !== band.output.engineVersion) {
      return fail('integrity_input_changed');
    }
    resultId = result.id;
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
