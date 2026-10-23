// The production dependencies of the drafting job (R5-11, R5-52 g, M1-19): the authoring stage login only, and the mock
// drafter only in dev and staging for exactly the pinned mock provider, model and prompt version.
import type { SqlTx } from '@trace/shared/jobs';
import {
  DRAFT_PROMPT_VERSION,
  MOCK_DRAFTER_MODEL_ID,
  MOCK_DRAFTER_PROVIDER,
  MockLlmDrafter,
} from '@trace/vendors';
import { describe, expect, it } from 'vitest';
import { draftingDepsFor, drafterForEnv } from './wiring.js';

const SPEC = {
  provider: MOCK_DRAFTER_PROVIDER,
  modelId: MOCK_DRAFTER_MODEL_ID,
  promptVersion: DRAFT_PROMPT_VERSION,
  seed: 7,
};
const envOf = (traceEnv: string | undefined) =>
  ({ VERSION: 'dev', TRACE_ENV: traceEnv }) as unknown as Env;

describe('drafterForEnv', () => {
  it.each(['dev', 'staging'])('serves the mock in %s', (e) => {
    expect(drafterForEnv(envOf(e))(SPEC)).toBeInstanceOf(MockLlmDrafter);
  });

  it.each(['production', '', undefined, 'prod'])('serves nothing in %s', (e) => {
    expect(drafterForEnv(envOf(e))(SPEC)).toBeNull();
  });

  it.each([
    ['provider', { provider: 'bedrock' }],
    ['model', { modelId: 'other-model' }],
    ['prompt version', { promptVersion: 'draft-v2' }],
  ])('serves nothing for another pinned %s', (_label, patch) => {
    expect(drafterForEnv(envOf('dev'))({ ...SPEC, ...patch })).toBeNull();
  });
});

describe('draftingDepsFor', () => {
  it('opens the authoring stage bound to the message org', async () => {
    const opened: [string, string | null][] = [];
    const tx: SqlTx = { query: async () => [] };
    const deps = draftingDepsFor(envOf('dev'), async (_env, stage, orgId, fn) => {
      opened.push([stage, orgId]);
      return fn(tx);
    });
    const org = '3f2b8c1e-9a47-4d6b-8e15-7c0a2d94b101';
    expect(await deps.db.run(org, (store) => store.lockJob(org))).toBeNull();
    expect(opened).toEqual([['authoring', org]]);
  });
});
