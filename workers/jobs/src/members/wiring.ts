// The production dependencies of member provisioning, built per invocation from its env (specs/m1-test-authoring.md
// M1-20, R5-11, R5-12, R5-13). The lead swaps the stub at merge:
//   members: createMembersConsumer((env) => membersDepsFor(env))
// Each stage runs on the admin login as trace_admin_worker with the message's org as the job org (queue/stage-db.ts).
// The pepper (MEMBER_INVITE_PEPPER) and the Auth admin secret (SUPABASE_SECRET_KEY_JOBS, SUPABASE_URL) are jobs Worker
// secrets (queue/env.ts); a missing one fails closed.
import { resolveVersion } from '@trace/shared';
import { createLogger, type ErrorReporter } from '@trace/shared/log';
import { withStageConnection } from '../queue/stage-db.js';
import type { OpenStage } from '../drafting/wiring.js';
import { createSupabaseAuthAdmin } from './auth-admin.js';
import type { MembersConsumerDeps } from './consumer.js';
import { sqlInviteStore } from './store.js';

export const membersDepsFor = (
  env: Env,
  open: OpenStage = withStageConnection,
  opts: { reporter?: ErrorReporter; sink?: (line: string) => void; fetch?: typeof fetch } = {},
): MembersConsumerDeps => {
  const release = resolveVersion(env.VERSION);
  return {
    db: { run: (orgId, fn) => open(env, 'admin', orgId, (tx) => fn(sqlInviteStore(tx))) },
    authAdmin: createSupabaseAuthAdmin({
      url: env.SUPABASE_URL,
      secretKey: env.SUPABASE_SECRET_KEY_JOBS,
      ...(opts.fetch === undefined ? {} : { fetch: opts.fetch }),
    }),
    pepper: env.MEMBER_INVITE_PEPPER,
    log: createLogger({
      service: 'jobs',
      version: release,
      ...(opts.sink === undefined ? {} : { sink: opts.sink }),
    }),
    reporter: opts.reporter,
    release,
  };
};
