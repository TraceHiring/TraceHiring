// AT-D33 (part): DB work only through trace_api with api_org_id set (spec §4.2, §6.2 R3-2). A fake transaction
// records the statements in order; the driver adapter itself is exercised against the local stack by the lead's E2E.
import { describe, expect, it } from 'vitest';
import {
  createApiDb,
  SET_CONTEXT_SQL,
  SET_ROLE_SQL,
  type BeginTx,
  type SqlParam,
} from './api-db.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const REQ = '99999999-9999-4999-8999-999999999999';

const recordingBegin = () => {
  const statements: { text: string; params: readonly SqlParam[] }[] = [];
  const state = { committed: 0, rolledBack: 0 };
  const begin: BeginTx = async (cb) => {
    try {
      const out = await cb(async (text, params) => {
        statements.push({ text, params });
        return [{ ok: 1 }];
      });
      state.committed += 1;
      return out;
    } catch (err) {
      state.rolledBack += 1;
      throw err;
    }
  };
  return { statements, state, begin };
};

describe('createApiDb', () => {
  it('sets the role, then the org and a server request id, before any statement', async () => {
    const { statements, begin, state } = recordingBegin();
    const db = createApiDb(begin, () => REQ);
    const rows = await db.withOrg(ORG, (tx) => tx.query('select 1 as ok', []));
    expect(rows).toEqual([{ ok: 1 }]);
    expect(statements.map((l) => l.text)).toEqual([
      SET_ROLE_SQL,
      SET_CONTEXT_SQL,
      'select 1 as ok',
    ]);
    expect(statements[1]?.params).toEqual([ORG, REQ]);
    expect(state.committed).toBe(1);
  });

  it('leaves the org unset (empty) for the token-hash lookup', async () => {
    const { statements, begin } = recordingBegin();
    await createApiDb(begin, () => REQ).withOrg(null, async () => 'x');
    expect(statements[1]?.params).toEqual(['', REQ]);
  });

  it('refuses an org that is not a uuid without opening a transaction', async () => {
    const { statements, begin } = recordingBegin();
    await expect(createApiDb(begin).withOrg("x', true); --", async () => 1)).rejects.toThrow(
      'bad_org',
    );
    expect(statements).toEqual([]);
  });

  it('rolls back and rejects when the work throws, so no result escapes', async () => {
    const { begin, state } = recordingBegin();
    await expect(
      createApiDb(begin).withOrg(ORG, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(state).toEqual({ committed: 0, rolledBack: 1 });
  });

  it('uses a fresh request id per transaction', async () => {
    const { statements, begin } = recordingBegin();
    const db = createApiDb(begin);
    await db.withOrg(ORG, async () => 1);
    await db.withOrg(ORG, async () => 1);
    const ids = statements.filter((l) => l.text === SET_CONTEXT_SQL).map((l) => l.params[1]);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
