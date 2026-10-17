// AT-D3 (rule 1, L-19) for GET /v1/orgs/:orgId/reports/:reportId: the strict ReportMetaResponse with metadata and
// versions only. It has no card field and no key matching overall|combined|total|trust|honesty|composite at any depth;
// its `versions` come from no integrity card (the module never reads integrity_cards or timeline entries, so a
// below-cutoff or awaiting band cannot leak through the header); its reads all carry the path org and never select a
// contact. Anything the caller cannot see is 404 with a constant body.
import { ReportMetaResponse } from '@trace/shared/contracts/d1';
import { describe, expect, it } from 'vitest';
import {
  baseTables,
  candidateRows,
  ENV,
  fakeDeps,
  keysDeep,
  merge,
  ORG,
  ORG_B,
  reportId,
  RULESET,
  type Tables,
} from './reports.test-helpers.js';
import { createReportsRoutes } from './routes.js';

const FORBIDDEN_KEY = /overall|combined|total|trust|honesty|composite/i;
const CARD_VALUE_KEYS = [
  'score',
  'sections',
  'belowCutoff',
  'band',
  'evidenceStrength',
  'coveragePct',
  'flags',
  'timeline',
  'signalsByFamily',
  'reasons',
  'photoMissing',
  'ruleTableVersion',
  'engineVersion',
  'quality_card_id',
  'integrity_card_id',
];

const url = (org = ORG, report = reportId(1)) => `http://api.test/v1/orgs/${org}/reports/${report}`;

const get = async (tables: Tables, path = url()) => {
  const { deps, seen } = fakeDeps(tables);
  const res = await createReportsRoutes(deps).request(path, {}, ENV);
  return { res, body: (await res.json()) as unknown, seen };
};

describe('GET /v1/orgs/:orgId/reports/:reportId (AT-D3)', () => {
  it('returns exactly the strict metadata and versions', async () => {
    const { res, body } = await get(
      merge(baseTables(), candidateRows({ n: 1, score: 72, integrity: 'reviewed' })),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body).toStrictEqual({
      report: {
        id: reportId(1),
        label: 'Candidate 1',
        testName: 'Sample test',
        testVersion: 1,
        submittedAt: '2026-10-17T08:01:00+00:00',
        receiptRefPrefix: 'ABCD1001',
        noticeHashPrefix: 'bb'.repeat(8),
      },
      versions: {
        quality: { rubricVersion: `rubric-set-${'ab'.repeat(6)}`, scoringVersion: 'd1-scoring-v1' },
        integrity: { rulesetVersion: RULESET },
      },
    });
    expect(ReportMetaResponse.parse(body)).toStrictEqual(body);
  });

  it('has no card field, no card value and no blended key at any depth', async () => {
    for (const integrity of [
      'reviewed',
      'not_reviewed_below_cutoff',
      'awaiting_quality',
    ] as const) {
      for (const score of [72, 10, null]) {
        const { body } = await get(merge(baseTables(), candidateRows({ n: 1, score, integrity })));
        const keys = keysDeep(body);
        expect(keys.filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
        expect(keys.filter((k) => CARD_VALUE_KEYS.includes(k))).toEqual([]);
        expect(JSON.stringify(body)).not.toMatch(/strong_concern|d1-v1|"72"|cand1@/);
      }
    }
  });

  it('is identical whatever the integrity side holds (the header never reads it)', async () => {
    const a = await get(merge(baseTables(), candidateRows({ n: 1, score: 10 })));
    const b = await get(
      merge(
        baseTables(),
        candidateRows({ n: 1, score: 10, integrity: 'not_reviewed_below_cutoff' }),
      ),
    );
    const c = await get(
      merge(baseTables(), candidateRows({ n: 1, score: 10, integrity: 'reviewed' })),
    );
    expect(a.body).toStrictEqual(b.body);
    expect(a.body).toStrictEqual(c.body);
  });

  it('quality versions are null while no quality card exists', async () => {
    const { body } = await get(merge(baseTables(), candidateRows({ n: 1, score: null })));
    expect((body as { versions: { quality: unknown } }).versions.quality).toBeNull();
  });

  it('reads no integrity table, never a contact, and always the path org', async () => {
    const { seen } = await get(
      merge(baseTables(), candidateRows({ n: 1, score: 72, integrity: 'reviewed' })),
    );
    expect(seen.map((s) => s.table).sort()).toEqual([
      'consents',
      'invitations',
      'quality_cards',
      'reports',
      'sessions',
      'test_versions',
      'tests',
    ]);
    for (const s of seen) {
      expect(s.query.org_id).toBe(`eq.${ORG}`);
      expect(s.query.select).not.toMatch(/\*|contact|link_token|score|band/);
    }
  });

  it('a report of org B through the org A path is 404, as are malformed and unknown ids', async () => {
    const otherOrg = merge(baseTables(), candidateRows({ n: 1, score: 72, org: ORG_B }));
    for (const [tables, path] of [
      [otherOrg, url()],
      [baseTables(), url()],
      [baseTables(), url(ORG, 'nope')],
      [baseTables(), url('nope', reportId(1))],
    ] as const) {
      const { res, body } = await get(tables, path);
      expect(res.status).toBe(404);
      expect(body).toStrictEqual({ error: { code: 'not_found' } });
    }
  });

  it('a hidden linked row (the consent) is 404; a receipt that breaks the contract is unavailable', async () => {
    const hidden = merge(baseTables(), candidateRows({ n: 1, score: 72 }));
    hidden.consents = [];
    expect((await get(hidden)).body).toStrictEqual({ error: { code: 'not_found' } });

    const bad = merge(baseTables(), candidateRows({ n: 1, score: 72, receiptRef: 'ILOU1234' }));
    const r = await get(bad);
    expect(r.res.status).toBe(503);
    expect(r.body).toStrictEqual({ error: { code: 'unavailable' } });
  });
});
