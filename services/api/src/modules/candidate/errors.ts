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
