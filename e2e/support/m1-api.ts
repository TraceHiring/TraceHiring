// The recruiter-side api and database reads of the M1 specs, called the way the recruiter app and the D1 specs call them
// (specs/m1-test-authoring.md §6.11; support/recruiter.ts for the style). `jwt` is a function so a token the app has
// refreshed is used. Failures carry the step, the HTTP status and the constant error code only (support/http.ts).
//
// Placeholder item bank (spec §1.3 M1-4, R5-28): the local stack has no library content, so a template's pools start
// empty and "needs N more items" (§6.1). `seedBank` creates approved synthetic items in the CALLER'S org through the
// import api (an import approves its rows at import, Q23), and `fillPools` adds them to a draft's pools through the pool
// api. A recruiter with a real library would not do either; the specs run both inside `PaceClock.excluded()`.
import type { APIRequestContext } from '@playwright/test';
import { createHash } from 'node:crypto';
import { jsonOf } from './http.js';
import type { Rest } from './recruiter-ui.js';

export interface M1Api {
  request: APIRequestContext;
  /** The api origin (E2E_API_URL). */
  api: string;
  orgId: string;
  supabaseUrl: string;
  publishableKey: string;
  /** The current aal2 access token of the signed-in recruiter page. */
  jwt: () => Promise<string>;
}

const orgUrl = (c: M1Api, path: string): string => `${c.api}/v1/orgs/${c.orgId}${path}`;
const bearer = async (c: M1Api) => ({ Authorization: `Bearer ${await c.jwt()}` });

// ---- tests, pools -----------------------------------------------------------------------------------------------

/** The fields of `GET …/tests/:testId` (TestDraftView, contracts-m1.ts:708) the specs read; hand-typed. */
export interface DraftView {
  test: { id: string; name: string };
  version: {
    id: string;
    versionNo: number;
    status: 'draft' | 'published' | 'retired';
    publishedAt: string | null;
    sections: {
      id: string;
      name: string;
      format: 'mcq' | 'written';
      mode: 'inline' | 'pool';
      poolId?: string;
      drawCount?: number;
    }[];
  };
}

export const readDraft = async (c: M1Api, testId: string): Promise<DraftView> =>
  jsonOf<DraftView>(
    await c.request.get(orgUrl(c, `/tests/${testId}`), { headers: await bearer(c) }),
    200,
    'reading the test',
  );

/** The fields of PoolDetail (contracts-m1.ts:525) the specs read. */
export interface PoolView {
  id: string;
  name: string;
  format: 'mcq' | 'written';
  skillKey: string | null;
  itemCount: number;
  approvedCount: number;
}

export const readPool = async (c: M1Api, poolId: string): Promise<PoolView> =>
  jsonOf<PoolView>(
    await c.request.get(orgUrl(c, `/pools/${poolId}`), { headers: await bearer(c) }),
    200,
    'reading a pool',
  );

export const addPoolItems = async (
  c: M1Api,
  poolId: string,
  itemVersionIds: readonly string[],
): Promise<PoolView> =>
  jsonOf<PoolView>(
    await c.request.post(orgUrl(c, `/pools/${poolId}/items`), {
      headers: await bearer(c),
      data: { itemVersionIds },
    }),
    200,
    'adding items to a pool',
  );

// ---- the placeholder bank ---------------------------------------------------------------------------------------

export interface BankNeed {
  skill: string;
  format: 'mcq' | 'written';
  count: number;
}

/** Approved item version ids by `format:skill`. */
export type SeededBank = ReadonlyMap<string, readonly string[]>;
export const bankKey = (format: string, skill: string): string => `${format}:${skill}`;

const ROW_BATCH = 100;

interface ImportJob {
  id: string;
  status: string;
}
interface RowsAnswer {
  accepted: number;
  errors: { rowNo: number; field: string; code: string }[];
}

/**
 * Creates approved synthetic items in the caller's org: one rubric for the written items (a direct insert as the
 * recruiter, as the rubric grants allow, supabase/migrations/20261014065417_d1_authoring.sql:1082), then one import
 * job with every row and `complete`. `runTag` (lower case, digits) keeps the stems unique to the run, so the bank's
 * duplicate check never fires. Returns the ids of the created versions, by format and skill.
 */
export const seedBank = async (
  c: M1Api,
  rest: Rest,
  runTag: string,
  needs: readonly BankNeed[],
): Promise<SeededBank> => {
  const auth = await bearer(c);
  const rubricKey = `e2e-m1-${runTag}`;
  if (needs.some((n) => n.format === 'written')) {
    const criteria = [
      {
        id: 'c1',
        label: '[synthetic] names the idea',
        max_points: 10,
        anchors: ['queue', 'retry', 'idempotent'],
        min_hits: 2,
      },
    ];
    const res = await c.request.post(`${c.supabaseUrl}/rest/v1/rubric_versions`, {
      headers: {
        apikey: c.publishableKey,
        ...auth,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      data: {
        org_id: c.orgId,
        rubric_key: rubricKey,
        version_no: 1,
        criteria,
        content_sha256: createHash('sha256').update(JSON.stringify(criteria)).digest('hex'),
      },
    });
    if (res.status() !== 201) {
      throw new Error(`creating the rubric: expected HTTP 201, got ${res.status()}`);
    }
  }

  type Row = Record<string, unknown>;
  const rows: Row[] = [];
  let rowNo = 2;
  for (const need of needs) {
    for (let i = 1; i <= need.count; i += 1) {
      const stem = `[synthetic] ${runTag} ${need.skill} item ${String(i).padStart(2, '0')}: ${
        need.format === 'mcq'
          ? 'which option is marked correct?'
          : 'explain how a job avoids doing work twice.'
      }`;
      rows.push(
        need.format === 'mcq'
          ? {
              rowNo,
              format: 'mcq',
              skillKey: need.skill,
              difficulty: 0.5,
              stem,
              options: ['The marked option', 'A different option', 'Another different option'],
              correct: 'a',
            }
          : { rowNo, format: 'written', skillKey: need.skill, difficulty: 0.5, stem, rubricKey },
      );
      rowNo += 1;
    }
  }

  const job = await jsonOf<ImportJob>(
    await c.request.post(orgUrl(c, '/imports'), {
      headers: auth,
      data: { sourceKind: 'xlsx', templateVersion: 'trace-items-v1' },
    }),
    201,
    'opening the set-up import',
  );
  for (let at = 0; at < rows.length; at += ROW_BATCH) {
    const answer = await jsonOf<RowsAnswer>(
      await c.request.post(orgUrl(c, `/imports/${job.id}/rows`), {
        headers: auth,
        data: { rows: rows.slice(at, at + ROW_BATCH) },
      }),
      200,
      'sending the set-up rows',
    );
    if (answer.errors.length > 0) {
      const first = answer.errors[0];
      throw new Error(
        `the set-up rows: ${answer.errors.length} refused (first: ${first?.field}/${first?.code})`,
      );
    }
  }
  const done = await jsonOf<ImportJob>(
    await c.request.post(orgUrl(c, `/imports/${job.id}/complete`), { headers: auth, data: {} }),
    200,
    'completing the set-up import',
  );
  if (done.status !== 'completed') throw new Error('the set-up import did not complete');

  const versions = await rest.select<{
    id: string;
    format: string;
    skill_key: string;
    status: string;
  }>(
    'item_versions',
    `select=id,format,skill_key,status&import_job_id=eq.${job.id}&limit=1000`,
    await c.jwt(),
  );
  const out = new Map<string, string[]>();
  for (const v of versions) {
    if (v.status !== 'approved') throw new Error('a set-up item is not approved');
    const key = bankKey(v.format, v.skill_key);
    out.set(key, [...(out.get(key) ?? []), v.id]);
  }
  for (const need of needs) {
    if ((out.get(bankKey(need.format, need.skill))?.length ?? 0) !== need.count) {
      throw new Error('the set-up bank does not hold the items asked for');
    }
  }
  return out;
};

/**
 * Tops up every pool section of a draft whose pool holds fewer approved items than its draw count: adds the seeded
 * items of the pool's format and skill (up to the draw count plus two). Returns how many items it added. A pool the
 * library already filled is left alone.
 */
export const fillPools = async (c: M1Api, testId: string, bank: SeededBank): Promise<number> => {
  const draft = await readDraft(c, testId);
  let added = 0;
  for (const section of draft.version.sections) {
    if (
      section.mode !== 'pool' ||
      section.poolId === undefined ||
      section.drawCount === undefined
    ) {
      continue;
    }
    const pool = await readPool(c, section.poolId);
    if (pool.approvedCount >= section.drawCount) continue;
    const have = bank.get(bankKey(pool.format, pool.skillKey ?? ''));
    if (have === undefined || have.length < section.drawCount) {
      throw new Error('the set-up bank has too few items for a pool');
    }
    const take = have.slice(0, section.drawCount + 2);
    await addPoolItems(c, pool.id, take);
    added += take.length;
  }
  return added;
};
