// The production dependencies of the AI drafting job, built per invocation from its env (specs/m1-test-authoring.md
// R5-11, R5-13, R5-52 g, M1-8, M1-19). The lead swaps the stub at merge:
//   drafting: createDraftingConsumer((env) => draftingDepsFor(env))
// Each stage runs on the authoring login as trace_authoring_worker with the message's org as the job org
// (queue/stage-db.ts); a missing binding or secret fails closed there. The only drafter in M1 is MockLlmDrafter, and only
// in dev and staging for exactly the pinned mock provider, model and prompt version; anything else gets no drafter, so the
// job ends `drafter_error` (the Bedrock adapter arrives with ABH-87, M5).
import { resolveVersion } from '@trace/shared';
import { createLogger, type ErrorReporter } from '@trace/shared/log';
import type { SqlTx } from '@trace/shared/jobs';
import {
  DRAFT_PROMPT_VERSION,
  MOCK_DRAFTER_MODEL_ID,
  MOCK_DRAFTER_PROVIDER,
  MockLlmDrafter,
  type LlmDrafter,
} from '@trace/vendors';
import { withStageConnection, type StageDbName } from '../queue/stage-db.js';
import type { DraftingConsumerDeps } from './consumer.js';
import type { DrafterSpec } from './handler.js';
import { sqlDraftStore } from './store.js';

/** How a stage gets its transaction (queue/wiring.ts OpenStage). */
export type OpenStage = <T>(
  env: Env,
  stage: StageDbName,
  orgId: string | null,
  fn: (tx: SqlTx) => Promise<T>,
) => Promise<T>;

const MOCK_ENVS: readonly string[] = ['dev', 'staging'];

/** The drafter for a job's pinned spec in this environment, or null. */
export const drafterForEnv =
  (env: Env) =>
  (spec: DrafterSpec): LlmDrafter | null => {
    if (
      spec.provider !== MOCK_DRAFTER_PROVIDER ||
      spec.modelId !== MOCK_DRAFTER_MODEL_ID ||
      spec.promptVersion !== DRAFT_PROMPT_VERSION ||
      typeof env.TRACE_ENV !== 'string' ||
      !MOCK_ENVS.includes(env.TRACE_ENV)
    ) {
      return null;
    }
    try {
      return new MockLlmDrafter(env.TRACE_ENV, { seed: spec.seed });
    } catch {
      return null;
    }
  };

export const draftingDepsFor = (
  env: Env,
  open: OpenStage = withStageConnection,
  opts: { reporter?: ErrorReporter; sink?: (line: string) => void } = {},
): DraftingConsumerDeps => {
  const release = resolveVersion(env.VERSION);
  return {
    db: { run: (orgId, fn) => open(env, 'authoring', orgId, (tx) => fn(sqlDraftStore(tx, orgId))) },
    drafterFor: drafterForEnv(env),
    log: createLogger({
      service: 'jobs',
      version: release,
      ...(opts.sink === undefined ? {} : { sink: opts.sink }),
    }),
    reporter: opts.reporter,
    release,
  };
};
