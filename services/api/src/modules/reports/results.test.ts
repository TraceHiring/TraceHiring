// The results list and the reviewer queue (spec §6.1, §6.2, §6.3; AT-D3 rule 1, AT-D14 rule 6, AT-D15 L-15): rows are
// Answer Quality only, `belowCutoff` is a boolean and never null, no row has an integrity field, no integrity table is
// read, the list is sorted by score with pending rows last, and the queue needs aal2 and a reviewer membership with
// assignments. Everything is filtered by the path org; anything the caller cannot see is 404.
import { ResultsListResponse, ReviewQueueResponse } from '@trace/shared/contracts/d1';
import { describe, expect, it } from 'vitest';
import {
  baseTables,
  callerOf,
  candidateRows,
  ENV,
  fakeDeps,
  keysDeep,
  merge,
  ORG,
  ORG_B,
  reportId,
  TEST,
  TEST_2,
  type Tables,
} from './reports.test-helpers.js';
import { createReportsRoutes } from './routes.js';

const FORBIDDEN_KEY = /overall|combined|total|trust|honesty|composite/i;
const INTEGRITY_KEY = /integrity|band|flag|signal|coverage|evidence|timeline|photo|reason/i;

const resultsUrl = (org = ORG, test = TEST) =>
  `http://api.test/v1/orgs/${org}/tests/${test}/results`;
const queueUrl = (org = ORG) => `http://api.test/v1/orgs/${org}/review/reports`;

const get = async (tables: Tables, path: string, aal: 'aal1' | 'aal2' = 'aal2') => {
  const { deps, seen } = fakeDeps(tables, callerOf(aal));
  const res = await createReportsRoutes(deps).request(path, {}, ENV);
  return { res, body: (await res.json()) as unknown, seen };
};

const cohort = (): Tables =>
  merge(
    baseTables(),
    candidateRows({ n: 1, score: 72, integrity: 'reviewed' }),
    candidateRows({ n: 2, score: 15, integrity: 'not_reviewed_below_cutoff' }),
    candidateRows({ n: 3, score: null, integrity: 'awaiting_quality' }),
    candidateRows({ n: 4, score: 40 }),
    candidateRows({ n: 5, score: 72, integrity: 'reviewed' }),
  );

describe('GET …/tests/:testId/results', () => {
  it('returns quality-only rows sorted by score, pending last, with a boolean below-cutoff mark', async () => {
    const { res, body } = await get(cohort(), resultsUrl());
    expect(res.status).toBe(200);
    const list = ResultsListResponse.parse(body);
    expect(list).toStrictEqual(body);
    expect(list.cutoff).toBe(40);
    expect(list.rows.map((r) => [r.label, r.quality])).toEqual([
      ['Candidate 5', { state: 'ready', score: 72, belowCutoff: false }],
      ['Candidate 1', { state: 'ready', score: 72, belowCutoff: false }],
      ['Candidate 4', { state: 'ready', score: 40, belowCutoff: false }],
      ['Candidate 2', { state: 'ready', score: 15, belowCutoff: true }],
      ['Candidate 3', { state: 'pending' }],
    ]);
    for (const row of list.rows) {
      if (row.quality.state === 'ready') expect(typeof row.quality.belowCutoff).toBe('boolean');
    }
  });

  it('no row has an integrity field and no key is blended; no integrity table is read', async () => {
    const { body, seen } = await get(cohort(), resultsUrl());
    const keys = keysDeep(body);
    expect(keys.filter((k) => FORBIDDEN_KEY.test(k) || INTEGRITY_KEY.test(k))).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/strong_concern|reviewed|@example/);
    expect(seen.map((s) => s.table).filter((t) => t.startsWith('integrity'))).toEqual([]);
    for (const s of seen) expect(s.query.org_id).toBe(`eq.${ORG}`);
    expect(seen.map((s) => s.query.select).join(' ')).not.toMatch(/contact|link_token|\*/);
  });

  it('uses the cutoff pinned in the newest published version, and the draft cutoff before any publish', async () => {
    const t = cohort();
    t.test_versions = [
      { id: 'x1', org_id: ORG, test_id: TEST, version_no: 2, status: 'draft', quality_cutoff: 90 },
      {
        id: 'x2',
        org_id: ORG,
        test_id: TEST,
        version_no: 1,
        status: 'published',
        quality_cutoff: 35,
      },
    ];
    expect(ResultsListResponse.parse((await get(t, resultsUrl())).body).cutoff).toBe(35);
    t.test_versions = [
      { id: 'x1', org_id: ORG, test_id: TEST, version_no: 1, status: 'draft', quality_cutoff: 55 },
    ];
    expect(ResultsListResponse.parse((await get(t, resultsUrl())).body).cutoff).toBe(55);
    t.test_versions = [];
    expect((await get(t, resultsUrl())).body).toStrictEqual({ error: { code: 'not_found' } });
  });

  it('leaves out reports of another org, another test and unsubmitted sessions', async () => {
    const t = merge(
      cohort(),
      candidateRows({ n: 6, score: 99, org: ORG_B }),
      candidateRows({ n: 7, score: 98, test: TEST_2 }),
      candidateRows({ n: 8, score: 97, submittedAt: null }),
    );
    const list = ResultsListResponse.parse((await get(t, resultsUrl())).body);
    expect(list.rows.map((r) => r.label)).not.toContain('Candidate 6');
    expect(list.rows.map((r) => r.label)).not.toContain('Candidate 7');
    expect(list.rows.map((r) => r.label)).not.toContain('Candidate 8');
    expect(list.rows).toHaveLength(5);
  });

  it('a test the caller cannot see, of another org, or a malformed id is 404', async () => {
    for (const path of [
      resultsUrl(ORG, '44444444-4444-4444-8444-0000000000ff'),
      resultsUrl(ORG_B, TEST),
      resultsUrl(ORG, 'x'),
    ]) {
      const { res, body } = await get(cohort(), path);
      expect(res.status).toBe(404);
      expect(body).toStrictEqual({ error: { code: 'not_found' } });
    }
  });
});

describe('GET …/review/reports', () => {
  it('needs aal2 (aal2_required, 403)', async () => {
    const { res, body, seen } = await get(cohort(), queueUrl(), 'aal1');
    expect(res.status).toBe(403);
    expect(body).toStrictEqual({ error: { code: 'aal2_required' } });
    expect(seen).toEqual([]);
  });

  it('lists the reports of the tests assigned to the reviewer, newest first, quality only', async () => {
    const t = merge(cohort(), candidateRows({ n: 7, score: 98, test: TEST_2 }));
    const { res, body, seen } = await get(t, queueUrl());
    expect(res.status).toBe(200);
    const queue = ReviewQueueResponse.parse(body);
    expect(queue).toStrictEqual(body);
    expect(queue.reports.map((r) => r.label)).toEqual([
      'Candidate 5',
      'Candidate 4',
      'Candidate 3',
      'Candidate 2',
      'Candidate 1',
    ]);
    expect(queue.reports.every((r) => r.testId === TEST && r.testName === 'Sample test')).toBe(
      true,
    );
    expect(queue.reports[0]?.reportId).toBe(reportId(5));
    const keys = keysDeep(body);
    expect(keys.filter((k) => FORBIDDEN_KEY.test(k) || INTEGRITY_KEY.test(k))).toEqual([]);
    expect(seen.map((s) => s.table).filter((x) => x.startsWith('integrity'))).toEqual([]);
    for (const s of seen) expect(s.query.org_id).toBe(`eq.${ORG}`);
  });

  it('an assignment held as another role does not put a test in the queue', async () => {
    const t = cohort();
    t.assignments = [{ ...(t.assignments?.[0] ?? {}), as_role: 'recruiter' }];
    expect(ReviewQueueResponse.parse((await get(t, queueUrl())).body)).toStrictEqual({
      reports: [],
    });
  });

  it('a caller with no active reviewer membership in this org is 404', async () => {
    const notReviewer = cohort();
    notReviewer.memberships = [{ ...(notReviewer.memberships?.[0] ?? {}), roles: ['recruiter'] }];
    const otherOrg = cohort();
    otherOrg.memberships = [{ ...(otherOrg.memberships?.[0] ?? {}), org_id: ORG_B }];
    for (const t of [notReviewer, otherOrg]) {
      const { res, body } = await get(t, queueUrl());
      expect(res.status).toBe(404);
      expect(body).toStrictEqual({ error: { code: 'not_found' } });
    }
  });
});
