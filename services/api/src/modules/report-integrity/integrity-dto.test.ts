// AT-D3 (rule 1, L-19) and AT-D19 (evidence) for GET …/reports/:id/integrity. The payload is the strict IntegrityCard;
// it holds no quality value and no key matching overall|combined|total|trust|honesty|composite at any depth; the
// module reads only reports, integrity_cards, integrity_timeline_entries and `quality_cards.meets_cutoff`, always with
// the path org. Every flag carries atMs, ruleId, observed, tier and signalSeqs (gseq values); connectivity gaps are
// labelled Connectivity, never Focus. Errors are constant `{ error: { code } }` and 404 for anything not visible.
import { IntegrityCard } from '@trace/shared/contracts/d1';
import { describe, expect, it } from 'vitest';
import {
  contextEntry,
  ENV,
  entryRow,
  fakeIntegritySource,
  integrityCardRow,
  keysDeep,
  ORG,
  ORG_B,
  orgLikeError,
  qualityRow,
  REPORT,
  reportRow,
  type Row,
  type Tables,
} from './integrity.test-helpers.js';
import { createReportIntegrityRoutes } from './routes.js';

const FORBIDDEN_KEY = /overall|combined|total|trust|honesty|composite/i;
// The quality side's value keys (QualityCard, ResultRow); none may appear in an integrity payload (rule 1).
const QUALITY_KEYS = [
  'score',
  'sections',
  'belowCutoff',
  'meetsCutoff',
  'meets_cutoff',
  'graderModelId',
  'scoreHundredths',
  'rubricVersion',
  'scoringVersion',
  'cutoff',
];

const url = (org = ORG, report = REPORT) =>
  `http://api.test/v1/orgs/${org}/reports/${report}/integrity`;

const get = async (tables: Tables, path = url()) => {
  const fake = fakeIntegritySource(tables);
  const app = createReportIntegrityRoutes(fake.source);
  const res = await app.request(path, {}, ENV);
  return { res, body: (await res.json()) as unknown, seen: fake.seen };
};

const fullTables = (): Tables => ({
  reports: [reportRow()],
  quality_cards: [qualityRow(true)],
  integrity_cards: [integrityCardRow()],
  integrity_timeline_entries: [
    entryRow({ position: 1, signal_seqs: [3, 7] }),
    entryRow({
      position: 2,
      signal_kind: 'untrusted_input',
      family: 'input_origin',
      rule_id: 'D1-UNTRUSTED',
      offset_ms: 60000,
      observed: { count: 4 },
      signal_seqs: [9],
    }),
    contextEntry({ position: 3, offset_ms: 70000, signal_seqs: [11] }),
    contextEntry({
      position: 4,
      signal_kind: 'connectivity_gap',
      family: 'connectivity',
      offset_ms: 80000,
      observed: { duration_ms: 9000 },
      signal_seqs: [],
    }),
  ],
});

describe('GET …/reports/:id/integrity (AT-D3, AT-D19)', () => {
  it('returns the strict ready card, with no quality value and no blended key', async () => {
    const { res, body } = await get(fullTables());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(IntegrityCard.parse(body)).toStrictEqual(body);
    const keys = keysDeep(body);
    expect(keys.filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
    expect(keys.filter((k) => QUALITY_KEYS.includes(k))).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/score|quality|cutoff/i);
  });

  it('every flag carries atMs, ruleId, observed, tier and its gseq values (AT-D19)', async () => {
    const { body } = await get(fullTables());
    const card = IntegrityCard.parse(body);
    if (card.state !== 'ready') throw new Error('not ready');
    expect(card.flags).toStrictEqual([
      {
        ruleId: 'D1-PASTE',
        family: 'paste',
        tier: 'T3',
        atMs: 45000,
        count: 1,
        observed: { len: 120 },
        signalSeqs: [3, 7],
        state: 'pending',
      },
      {
        ruleId: 'D1-UNTRUSTED',
        family: 'input_origin',
        tier: 'T3',
        atMs: 60000,
        count: 1,
        observed: { count: 4 },
        signalSeqs: [9],
        state: 'pending',
      },
    ]);
    expect(card.timeline.map((e) => [e.position, e.entryKind, e.family])).toEqual([
      [1, 'flag', 'paste'],
      [2, 'flag', 'input_origin'],
      [3, 'context', 'focus'],
      [4, 'context', 'connectivity'],
    ]);
    expect(card.timeline[3]?.observed).toStrictEqual({ durationMs: 9000 });
    expect(card.signalsByFamily).toStrictEqual([
      { family: 'paste', flagCount: 1, contextCount: 0 },
      { family: 'input_origin', flagCount: 1, contextCount: 0 },
      { family: 'focus', flagCount: 0, contextCount: 1 },
      { family: 'connectivity', flagCount: 0, contextCount: 1 },
    ]);
  });

  it('labels connectivity gaps Connectivity, never Focus', async () => {
    const tables = fullTables();
    tables.integrity_cards = [integrityCardRow({ band: 'clear', evidence_strength: 0 })];
    tables.integrity_timeline_entries = [
      contextEntry({
        position: 1,
        signal_kind: 'connectivity_gap',
        family: 'connectivity',
        observed: { duration_ms: 5000 },
      }),
    ];
    const card = IntegrityCard.parse((await get(tables)).body);
    if (card.state !== 'ready') throw new Error('not ready');
    expect(card.timeline[0]?.family).toBe('connectivity');
    expect(card.signalsByFamily.find((f) => f.family === 'focus')).toStrictEqual({
      family: 'focus',
      flagCount: 0,
      contextCount: 0,
    });
    expect(card.reasons.some((r) => r.includes('Connectivity'))).toBe(true);
    expect(card.reasons.filter((r) => /focus/i.test(r))).toEqual([]);
  });

  it('derives the reasons from the band and the timeline (R-12 copy; not assessed on thin coverage)', async () => {
    const strong = fullTables();
    strong.integrity_cards = [integrityCardRow({ band: 'strong_concern', evidence_strength: 1 })];
    const s = IntegrityCard.parse((await get(strong)).body);
    expect(s.state === 'ready' ? s.reasons[0] : null).toBe(
      'Input events not produced by the keyboard were recorded.',
    );

    const thin = fullTables();
    thin.integrity_cards = [
      integrityCardRow({
        band: 'insufficient_evidence',
        coverage_permille: 500,
        photo_missing: true,
      }),
    ];
    thin.integrity_timeline_entries = [];
    const t = IntegrityCard.parse((await get(thin)).body);
    if (t.state !== 'ready') throw new Error('not ready');
    expect(t.reasons[0]).toMatch(/^Not assessed/);
    expect(t.reasons).toContain('No start photo, so coverage was lowered.');
    expect(t.coveragePct).toBe(50);
    for (const r of t.reasons) {
      expect(r.length).toBeLessThanOrEqual(300);
      expect(r).not.toMatch(/score|cheat|honest|trust|quality/i);
    }
  });

  it('reads only its four tables, meets_cutoff alone from quality_cards, always with the path org', async () => {
    const { seen } = await get(fullTables());
    expect(seen.map((s) => s.table)).toEqual([
      'reports',
      'quality_cards',
      'integrity_cards',
      'integrity_timeline_entries',
    ]);
    expect(seen.find((s) => s.table === 'quality_cards')?.query.select).toBe('meets_cutoff');
    for (const s of seen) expect(s.query.org_id).toBe(`eq.${ORG}`);
    expect(seen.find((s) => s.table === 'integrity_cards')?.query.review_state).toBe('eq.reviewed');
  });

  it('does not answer for another org: a report of org B through the org A path is 404', async () => {
    const tables = fullTables();
    tables.reports = [reportRow({ org_id: ORG_B })];
    const { res, body } = await get(tables);
    expect(res.status).toBe(404);
    expect(body).toStrictEqual({ error: { code: 'not_found' } });
  });

  it('a malformed or unknown id is 404 with a constant body that echoes nothing', async () => {
    for (const path of [
      url(ORG, 'not-a-uuid'),
      url('x', REPORT),
      url(ORG, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
    ]) {
      const { res, body } = await get(fullTables(), path);
      expect(res.status).toBe(404);
      expect(body).toStrictEqual({ error: { code: 'not_found' } });
    }
  });

  it('maps a source org error to its constant code and rethrows anything else', async () => {
    const fake = fakeIntegritySource(fullTables());
    const app = createReportIntegrityRoutes(fake.source);
    fake.failNext(Object.assign(orgLikeError('unauthorized'), { status: 401 }));
    const res = await app.request(url(), {}, ENV);
    expect(res.status).toBe(401);
    expect(await res.json()).toStrictEqual({ error: { code: 'unauthorized' } });

    const fake2 = fakeIntegritySource(fullTables());
    const app2 = createReportIntegrityRoutes(fake2.source);
    fake2.failNext(new Error('boom'));
    const res2 = await app2.request(url(), {}, ENV);
    expect(res2.status).toBe(500);
    expect(await res2.text()).not.toContain('boom');
  });

  it('a row that breaks the contract is unavailable, never passed through', async () => {
    const tables = fullTables();
    tables.integrity_cards = [{ ...integrityCardRow(), band: 'blended' } as unknown as Row];
    const { res, body } = await get(tables);
    expect(res.status).toBe(503);
    expect(body).toStrictEqual({ error: { code: 'unavailable' } });
  });
});

describe('report-integrity routes (AT-D13 api part: no reject path)', () => {
  it('serves exactly one GET route and no write verb (no confirm or decision in D1)', async () => {
    const app = createReportIntegrityRoutes(fakeIntegritySource(fullTables()).source);
    expect(app.routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /v1/orgs/:orgId/reports/:reportId/integrity',
    ]);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect((await app.request(url(), { method }, ENV)).status, method).toBe(404);
    }
  });
});
