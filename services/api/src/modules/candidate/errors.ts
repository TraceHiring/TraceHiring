// CandidateRpc failures carry exactly one constant candidate error code as the message (spec §4.2 codes); the edge
// maps it to its status. Nothing else ever crosses the RPC boundary: no input, no SQL text, no PII.
import type { CandidateErrorCode } from '@trace/shared/contracts/candidate';

export class CandidateRpcError extends Error {
  readonly code: CandidateErrorCode;

  constructor(code: CandidateErrorCode) {
    super(code);
    this.name = 'CandidateRpcError';
    this.code = code;
  }
}

export const fail = (code: CandidateErrorCode): never => {
  throw new CandidateRpcError(code);
};

/**
 * A refusal whose transaction must still commit the writes made before it (the lazy `expired`, DB review r3 m-1).
 * The service's `inOrg` returns it out of the transaction and raises it after COMMIT; anywhere else it is an
 * ordinary CandidateRpcError.
 */
export class FailAfterCommit extends CandidateRpcError {
  constructor(code: CandidateErrorCode) {
    super(code);
    this.name = 'FailAfterCommit';
  }
}
