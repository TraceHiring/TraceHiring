// The production dependencies of member provisioning (M1-20, R5-11, R5-12): the admin stage login only, the pepper and
// the Auth admin secret from the jobs Worker's own secrets, failing closed when one is missing.
import type { SqlTx } from '@trace/shared/jobs';
import { describe, expect, it } from 'vitest';
import { AUTH_ADMIN_UNAVAILABLE } from './auth-admin.js';
import { membersDepsFor } from './wiring.js';

const ORG = '4a1c7e2d-8b36-4f5a-9d04-6b1f3c85a201';

describe('membersDepsFor', () => {
  it('opens the admin stage bound to the message org and reads the pepper secret', async () => {
    const opened: [string, string | null][] = [];
    const tx: SqlTx = { query: async () => [] };
    const pepper = ['synthetic', 'pepper'].join('-');
    const env = { VERSION: 'dev', MEMBER_INVITE_PEPPER: pepper } as unknown as Env;
    const deps = membersDepsFor(env, async (_env, stage, orgId, fn) => {
      opened.push([stage, orgId]);
      return fn(tx);
    });
    expect(deps.pepper).toBe(pepper);
    expect(await deps.db.run(ORG, (store) => store.loadInvite(ORG))).toBeNull();
    expect(opened).toEqual([['admin', ORG]]);
  });

  it('without the Auth secrets the Auth admin API fails closed', async () => {
    const deps = membersDepsFor({ VERSION: 'dev' } as unknown as Env);
    expect(deps.pepper).toBeUndefined();
    await expect(
      deps.authAdmin.ensureUser('p-someone@example.test', async () => null),
    ).rejects.toThrow(AUTH_ADMIN_UNAVAILABLE);
  });
});
