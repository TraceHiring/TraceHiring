// Shared pieces of the candidate routes (specs/d1-demo-slice.md §4.2, §4.3): the logger (literal events, ids and
// counts only), the CandidateRpc call that turns every failure into its constant code, the InviteOtpDO stub for an
// invitation id that came from api or from verified claims, and lobby authentication (token, then nonce and limit).
import type { CandidateTokenClaims } from '@trace/shared/contracts/candidate';
import { resolveVersion } from '@trace/shared';
import { createLogger, type Logger } from '@trace/shared/log';
import { fail, bearer, type EdgeContext } from './http.js';
import type { OtpApi } from './otp-do.js';
import type { LobbyBucket, Refusal } from './otp-core.js';
import { candidateRpc, RpcFailure, type CandidateMethod, type RpcIn, type RpcOut } from './rpc.js';
import type { SessionApi } from './session-core.js';
import { verifyCandidateToken } from './token.js';

export interface RouteDeps {
  now: () => Date;
  readonly sink?: ((line: string) => void) | undefined;
}

export const nowSec = (deps: RouteDeps): number => Math.floor(deps.now().getTime() / 1000);

/** The redacting logger of the edge (routes and Durable Objects): literal events, ids and counts only. */
export const edgeLogger = (
  versionVar: string | undefined,
  sink?: (line: string) => void,
): Logger => {
  let version = 'dev';
  try {
    version = resolveVersion(versionVar);
  } catch {
    // keep 'dev'
  }
  return createLogger({ service: 'edge', version, ...(sink === undefined ? {} : { sink }) });
};

export const loggerFor = (c: EdgeContext, deps: RouteDeps): Logger =>
  edgeLogger(c.env.VERSION, deps.sink);

/** The SessionDO of one invitation; the id comes from verified claims only. A missing binding fails closed. */
export const sessionFor = (c: EdgeContext, invitationId: string): SessionApi => {
  const ns = c.env.SESSION;
  if (ns === undefined) return fail('unavailable');
  return ns.get(ns.idFromName(invitationId)) as unknown as SessionApi;
};

/** Calls api; a failure becomes its constant code (an `unavailable` is logged with the method name only). */
export const rpc = async <M extends CandidateMethod>(
  c: EdgeContext,
  deps: RouteDeps,
  method: M,
  input: RpcIn<M>,
): Promise<RpcOut<M>> => {
  try {
    return await candidateRpc(c.env).call(method, input);
  } catch (err) {
    const code = err instanceof RpcFailure ? err.code : 'unavailable';
    if (code === 'unavailable') loggerFor(c, deps).warn('candidate_rpc.unavailable', { method });
    return fail(code);
  }
};

/** The InviteOtpDO of one invitation. A missing binding fails closed. */
export const otpFor = (c: EdgeContext, invitationId: string): OtpApi => {
  const ns = c.env.OTP;
  if (ns === undefined) return fail('unavailable');
  return ns.get(ns.idFromName(invitationId)) as unknown as OtpApi;
};

/** Runs one object call; a runtime failure (object unavailable, reset) is `unavailable`. */
export const otpCall = async <T>(fn: () => T | Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch {
    return fail('unavailable');
  }
};

/** Answers a refusal with its code (and `Retry-After` on a 429). */
export const refuse = (result: Refusal): never =>
  'retryAfterSeconds' in result ? fail(result.error, result.retryAfterSeconds) : fail(result.error);

export interface LobbyAuth {
  /** The raw lobby token; api re-verifies it on every call after lobbyMint (§4.2). */
  lobbyToken: string;
  claims: CandidateTokenClaims;
}

/**
 * Authenticates a lobby request: Bearer, the token checks of §4.3 with typ `lobby`, then the nonce held by the
 * invitation's InviteOtpDO (a newer login supersedes the token) and the route's per-invitation limit. The object id
 * comes from the verified claims only.
 */
export const lobbyAuth = async (
  c: EdgeContext,
  deps: RouteDeps,
  bucket: LobbyBucket,
): Promise<LobbyAuth> => {
  const lobbyToken = bearer(c);
  const claims = await verifyCandidateToken(lobbyToken, c.env, 'lobby', nowSec(deps));
  const otp = otpFor(c, claims.invitation_id);
  const gate = await otpCall(() => otp.lobbyGate(claims.nonce, bucket));
  if (!gate.ok) return refuse(gate);
  return { lobbyToken, claims };
};
