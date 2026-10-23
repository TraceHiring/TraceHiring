// CandidateRpc: the named WorkerEntrypoint the edge reaches over its `API` service binding (spec §4.2; DC-D3: RPC
// methods are not reachable over the public URL). Every method zod-validates its input, runs the service with deps
// built from this Worker's env (each binding guarded: a missing one is `unavailable`, never `!`), validates its own
// output against the contract (so no extra key such as a contact address can leave), and turns any failure into one
// constant candidate error code (security review bindings F6, F7). Helpers are #private.
import { resolveVersion } from '@trace/shared';
import { CandidateRpcSchemas } from '@trace/shared/contracts/candidate';
import { createLogger, type Logger } from '@trace/shared/log';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { z } from 'zod';
import { createDemoOutbox, outboxNamespace } from '../outbox/outbox-writer.js';
import { openApiDb } from './api-db.js';
import { CandidateRpcError, fail } from './errors.js';
import { createCandidateService, DEFAULT_NONCE, type CandidateDeps } from './service.js';
import { createSqlCandidateStore } from './store.js';
import { importSigningKey, parsePublicJwks } from './token.js';

type Schemas = typeof CandidateRpcSchemas;
export type CandidateMethod = keyof Schemas;
type In<M extends CandidateMethod> = z.infer<Schemas[M]['in']>;
type Out<M extends CandidateMethod> = z.infer<Schemas[M]['out']>;

const SQLSTATE = /^[0-9A-Z]{5}$/;

/** What a method needs for one call; `close` runs in `finally`. */
export interface CandidateCall {
  deps: CandidateDeps;
  close(): Promise<void>;
}

/** Validates, runs, validates the answer and maps every failure to a constant code. Exported for the tests. */
export const runCandidateMethod = async <M extends CandidateMethod>(
  method: M,
  input: unknown,
  open: () => CandidateCall,
  log: Logger,
): Promise<Out<M>> => {
  const parsed = CandidateRpcSchemas[method].in.safeParse(input);
  if (!parsed.success) throw new Error('bad_request');
  let call: CandidateCall | undefined;
  try {
    call = open();
    const service = createCandidateService(call.deps) as unknown as Record<
      CandidateMethod,
      (i: In<M>) => Promise<unknown>
    >;
    const out = CandidateRpcSchemas[method].out.safeParse(
      await service[method](parsed.data as In<M>),
    );
    if (!out.success) return fail('unavailable');
    return out.data as Out<M>;
  } catch (err) {
    if (err instanceof CandidateRpcError) throw new Error(err.code);
    const code = (err as { code?: unknown } | null)?.code;
    log.warn('candidate_rpc.failed', {
      method,
      ...(typeof code === 'string' && SQLSTATE.test(code) ? { sqlstate: code } : {}),
    });
    throw new Error('unavailable');
  } finally {
    await call?.close();
  }
};

/** Builds the deps from the Worker env. A missing binding fails closed with `unavailable` at first use. */
export const depsFromEnv = (env: Env): CandidateCall => {
  const handle = openApiDb(env);
  if (handle === null) return fail('unavailable');
  const privateJwk = env.CANDIDATE_TOKEN_PRIVATE_JWK;
  const publicJwk = env.CANDIDATE_TOKEN_PUBLIC_JWK;
  const outbox = createDemoOutbox(env, outboxNamespace(env));
  const deps: CandidateDeps = {
    store: createSqlCandidateStore(handle.db),
    signer: async () =>
      privateJwk === undefined || privateJwk === ''
        ? fail('unavailable')
        : importSigningKey(privateJwk).catch(() => fail('unavailable')),
    verifyKeys: async () =>
      publicJwk === undefined || publicJwk === ''
        ? fail('unavailable')
        : parsePublicJwks(publicJwk).catch(() => fail('unavailable')),
    outbox: {
      write: async (orgId, message) =>
        outbox === null ? fail('unavailable') : outbox.write(orgId, message),
    },
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
    newNonce: DEFAULT_NONCE,
  };
  return { deps, close: () => handle.close() };
};

const loggerFor = (env: Env): Logger => {
  let version = 'dev';
  try {
    version = resolveVersion(env.VERSION);
  } catch {
    // keep 'dev'
  }
  return createLogger({ service: 'api', version });
};

export class CandidateRpc extends WorkerEntrypoint<Env> {
  #run<M extends CandidateMethod>(method: M, input: unknown): Promise<Out<M>> {
    return runCandidateMethod(method, input, () => depsFromEnv(this.env), loggerFor(this.env));
  }

  inviteResolve(input: unknown) {
    return this.#run('inviteResolve', input);
  }
  messagingSend(input: unknown) {
    return this.#run('messagingSend', input);
  }
  lobbyMint(input: unknown) {
    return this.#run('lobbyMint', input);
  }
  ageDeclare(input: unknown) {
    return this.#run('ageDeclare', input);
  }
  noticeGet(input: unknown) {
    return this.#run('noticeGet', input);
  }
  consentRecord(input: unknown) {
    return this.#run('consentRecord', input);
  }
  photoPermit(input: unknown) {
    return this.#run('photoPermit', input);
  }
  sessionGrant(input: unknown) {
    return this.#run('sessionGrant', input);
  }
  sessionStarted(input: unknown) {
    return this.#run('sessionStarted', input);
  }
}
