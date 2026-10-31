// The library reference reads as trace_api (spec m1 R2-5, R3-7, R5-57 b, R5-60 b): each read is one ApiDb transaction
// with the path org as `trace.api_org_id`; only the verified JWT's sub, aal and amr are bound (as parameters, never in
// the SQL text); a page cursor passes both parts or neither; rows that do not fit are 503. A recording ApiDb stands in
// for the trace_api connection (the SQL itself runs against the local stack in the lead's E2E).
import { describe, expect, it } from 'vitest';
import type { ApiDb, SqlParam } from '../candidate/api-db.js';
import { OrgError } from '../tests/org-context.js';
import { STANDARD, STRICT, callerOf } from '../tests/tests.test-helpers.js';
import { referenceFromApiDb } from './reference.js';

const ORG = 'a1000000-0000-4000-8000-000000000001';

const recordingDb = (answer: (text: string) => unknown[]) => {
  const seen: { org: string | null; text: string; params: readonly SqlParam[] }[] = [];
  const db: ApiDb = {
    withOrg: async (org, fn) =>
      fn({
        query: async <R extends object>(text: string, params: readonly SqlParam[] = []) => {
          seen.push({ org, text, params });
          return answer(text) as R[];
        },
      }),
  };
  return { db, seen };
};

const failsWith = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof OrgError ? err.code : 'thrown';
  }
};

describe('referenceFromApiDb', () => {
  it('reads the settings catalog as the verified viewer in the path org, keeping the newest version of each preset', async () => {
    const { db, seen } = recordingDb(() => [
      {
        r: [
          {
            catalogVersion: 'm1-settings-v1',
            settings: [],
            presets: [
              { presetKey: 'standard', version: 1, values: STRICT },
              { presetKey: 'standard', version: 2, values: STANDARD },
            ],
          },
        ],
      },
    ]);
    const caller = callerOf({ aal: 'aal2', amr: ['password', 'totp'] });
    const catalog = await referenceFromApiDb(db).settingsCatalog(caller, ORG);
    expect(catalog.catalogVersion).toBe('m1-settings-v1');
    expect(catalog.presets.standard).toEqual({ version: 2, values: STANDARD });
    expect(seen[0]?.org).toBe(ORG);
    expect(seen[0]?.text).toContain('private.library_reference($1::uuid, $2,');
    expect(seen[0]?.params).toEqual([caller.userId, 'aal2', '["password","totp"]', 'settings']);
    expect(seen[0]?.text).not.toContain(caller.userId);
  });

  it('a viewer the function refuses ([]) or a malformed row is 503', async () => {
    expect(
      await failsWith(
        referenceFromApiDb(recordingDb(() => [{ r: [] }]).db).settingsCatalog(callerOf(), ORG),
      ),
    ).toBe('unavailable');
    expect(
      await failsWith(
        referenceFromApiDb(recordingDb(() => [{ r: [{ templateKey: 'x' }] }]).db).templates(
          callerOf(),
          ORG,
        ),
      ),
    ).toBe('unavailable');
  });

  it('browses one keyset page with both cursor parts or neither, keeping the created_at text', async () => {
    const row = {
      library_item_version_id: 'b1000000-0000-4000-8000-000000000001',
      format: 'mcq',
      skill_key: 'verbal',
      difficulty: '0.45',
      created_at: '2026-10-01T00:00:00.123456+00:00',
    };
    const { db, seen } = recordingDb(() => [row]);
    const source = referenceFromApiDb(db);
    const first = await source.browse(callerOf(), ORG, {
      skillKey: 'verbal',
      format: 'mcq',
      after: null,
      limit: 20,
    });
    expect(first).toEqual([
      {
        libraryItemVersionId: row.library_item_version_id,
        format: 'mcq',
        skillKey: 'verbal',
        difficulty: 0.45,
        createdAt: row.created_at,
      },
    ]);
    expect(seen[0]?.params.slice(3)).toEqual(['verbal', 'mcq', null, null, 20]);
    await source.browse(callerOf(), ORG, {
      skillKey: 'verbal',
      format: 'mcq',
      after: { createdAt: row.created_at, id: row.library_item_version_id },
      limit: 20,
    });
    expect(seen[1]?.params.slice(5)).toEqual([row.created_at, row.library_item_version_id, 20]);
    expect(seen[1]?.text).toContain('private.library_browse(');
  });
});
