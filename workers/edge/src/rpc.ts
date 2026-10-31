// The CandidateRpc client (specs/d1-demo-slice.md §4.2): the edge reaches services/api only through the `API` service
// binding to the named entrypoint `CandidateRpc`, so it needs no secret. Every call is zod-checked on the way in and
// on the way out (security review bindings F6): an answer that does not fit its contract, a missing binding or any
// failure that is not one of the constant candidate codes becomes `unavailable`. Nothing here logs the input or the
// answer; a failure is returned as a code only.
//
// M2 (build-notes "M2 BUILD 2, Wave 1 lead part" decision f): the three portal methods (`portalMint`, `portalSlots`,
// `portalReschedule`) are typed from `PortalRpcSchemas`, kept apart from `CandidateRpcSchemas` until stream B2
// implements them; the edge client checks both registries the same way.
import {
  CANDIDATE_ERROR_STATUS,
  CandidateRpcSchemas,
  PortalRpcSchemas,
  type CandidateErrorCode,
} from '@trace/shared/contracts/candidate';
import type { z } from 'zod';

/** Every method the edge calls on the `API` binding: D1's CandidateRpc methods plus the M2 portal methods. */
const EdgeRpcSchemas = { ...CandidateRpcSchemas, ...PortalRpcSchemas } as const;
type Schemas = typeof EdgeRpcSchemas;
export type CandidateMethod = keyof typeof CandidateRpcSchemas;
export type PortalMethod = keyof typeof PortalRpcSchemas;
export type EdgeMethod = keyof Schemas;
export type RpcIn<M extends EdgeMethod> = z.input<Schemas[M]['in']>;
export type RpcOut<M extends EdgeMethod> = z.infer<Schemas[M]['out']>;

/** The shape of the `API` binding as the edge uses it: one async method per CandidateRpc method. */
export type CandidateRpcStub = { [M in CandidateMethod]: (input: unknown) => Promise<unknown> };
/** The M2 portal methods of the same binding. */
export type PortalRpcStub = { [M in PortalMethod]: (input: unknown) => Promise<unknown> };
type EdgeRpcStub = CandidateRpcStub & PortalRpcStub;

/** A CandidateRpc failure, as one constant code. */
export class RpcFailure extends Error {
  readonly code: CandidateErrorCode;

  constructor(code: CandidateErrorCode) {
    super(code);
    this.name = 'RpcFailure';
    this.code = code;
  }
}

const isCode = (value: unknown): value is CandidateErrorCode =>
  typeof value === 'string' && Object.hasOwn(CANDIDATE_ERROR_STATUS, value);

/**
 * The code a thrown RPC error carries. services/api throws `new Error(<code>)` (its errors.ts); the runtime carries the
 * message across the binding. Any other message (a runtime failure, an overload) is `unavailable`.
 */
export const codeOf = (err: unknown): CandidateErrorCode => {
  if (err instanceof RpcFailure) return err.code;
  const message = err instanceof Error ? err.message : undefined;
  return isCode(message) ? message : 'unavailable';
};

const stubOf = (env: Env): EdgeRpcStub | null => {
  const api = env.API as unknown;
  if (api === undefined || api === null) return null;
  return api as EdgeRpcStub;
};

export interface CandidateRpcClient {
  call<M extends EdgeMethod>(method: M, input: RpcIn<M>): Promise<RpcOut<M>>;
}

/** The client over this request's env. A missing binding fails closed (`unavailable`) at the first call. */
export const candidateRpc = (env: Env): CandidateRpcClient => ({
  async call<M extends EdgeMethod>(method: M, input: RpcIn<M>): Promise<RpcOut<M>> {
    const schemas = EdgeRpcSchemas[method];
    const parsedIn = schemas.in.safeParse(input);
    if (!parsedIn.success) throw new RpcFailure('bad_request');
    const stub = stubOf(env);
    if (stub === null) throw new RpcFailure('unavailable');
    let answer: unknown;
    try {
      answer = await stub[method](parsedIn.data);
    } catch (err) {
      throw new RpcFailure(codeOf(err));
    }
    const parsedOut = schemas.out.safeParse(answer);
    if (!parsedOut.success) throw new RpcFailure('unavailable');
    return parsedOut.data as RpcOut<M>;
  },
});
