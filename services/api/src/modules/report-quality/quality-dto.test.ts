// AT-D3 (rule 1, L-19) and the api part of AT-D15 (versions recorded) for GET …/reports/:id/quality. The payload is
// the strict QualityCard; it holds no integrity value and no key matching overall|combined|total|trust|honesty|composite
// at any depth; the module reads only reports, quality_cards and the section names, always with the path org.
// Errors are constant `{ error: { code } }`, 404 for anything not visible.
import { QualityCard } from '@trace/shared/contracts/d1';
import { describe, expect, it } from 'vitest';
import {
  ENV,
  fakeQualitySource,
  keysDeep,
  ORG,
  ORG_B,
  orgLikeError,
  qualityCardRow,
  REPORT,
  reportRow,
  RUBRIC_SET,
  SEC_MCQ,
  SEC_WRITTEN,
  sectionRows,
  type Row,
  type Tables,
} from './quality.test-helpers.js';
import { qualityCardFromRow, rubricVersionLabel } from './quality-dto.js';
import { createReportQualityRoutes } from './routes.js';

const FORBIDDEN_KEY = /overall|combined|total|trust|honesty|composite/i;
// The integrity side's value keys (IntegrityCard); none may appear in a quality payload (rule 1).
const INTEGRITY_KEYS = [
  'band',
  'evidenceStrength',
  'coveragePct',
  'photoMissing',
  'reasons',
  'flags',
  'timeline',
  'signalsByFamily',
  'ruleTableVersion',
  'engineVersion',
  'reviewState',
];

const url = (org = ORG, report = REPORT) =>
  `http://api.test/v1/orgs/${org}/reports/${report}/quality`;

const fullTables = (): Tables => ({
  reports: [reportRow()],
  quality_cards: [qualityCardRow()],
  sections: sectionRows(),
});

const get = async (tables: Tables, path = url()) => {
  const fake = fakeQualitySource(tables);
  const res = await createReportQualityRoutes(fake.source).request(path, {}, ENV);
  return { res, body: (await res.json()) as unknown, seen: fake.seen };
};

describe('GET …/reports/:id/quality (AT-D3, AT-D15 api part)', () => {
  it('returns the strict ready card with its versions, and no integrity value or blended key', async () => {
    const { res, body } = await get(fullTables());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body).toStrictEqual({
      state: 'ready',
      score: 72,
      sections: [
        { sectionId: SEC_MCQ, name: 'Part A', weight: 1, scoreHundredths: 8000 },
        { sectionId: SEC_WRITTEN, name: 'Part B', weight: 2, scoreHundredths: 6800 },
      ],
      graderModelId: 'mock-grader-v1',
      rubricVersion: `rubric-set-${RUBRIC_SET.slice(0, 12)}`,
      scoringVersion: 'd1-scoring-v1',
    });
    expect(QualityCard.parse(body)).toStrictEqual(body);
    const keys = keysDeep(body);
    expect(keys.filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
    expect(keys.filter((k) => INTEGRITY_KEYS.includes(k))).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/integrity|band|flag|signal|coverage|evidence/i);
  });

  it('carries exactly one number on the card face: the score (sections are its parts)', async () => {
    const card = QualityCard.parse((await get(fullTables())).body);
    if (card.state !== 'ready') throw new Error('not ready');
    const topNumbers = Object.entries(card).filter(([, v]) => typeof v === 'number');
    expect(topNumbers).toEqual([['score', 72]]);
  });

  it('reads only reports, quality_cards and sections, always with the path org', async () => {
    const { seen } = await get(fullTables());
    expect(seen.map((s) => s.table)).toEqual(['reports', 'quality_cards', 'sections']);
    for (const s of seen) expect(s.query.org_id).toBe(`eq.${ORG}`);
    expect(seen.map((s) => s.table).join(',')).not.toMatch(/integrity/);
  });

  it('a report of org B through the org A path is 404', async () => {
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

  it('a section the caller cannot name, or a row that breaks the contract, is unavailable', async () => {
    const noNames = fullTables();
    noNames.sections = [];
    expect((await get(noNames)).body).toStrictEqual({ error: { code: 'unavailable' } });

    const bad = fullTables();
    bad.quality_cards = [{ ...qualityCardRow(), meets_cutoff: false } as unknown as Row];
    const r = await get(bad);
    expect(r.res.status).toBe(503);
    expect(r.body).toStrictEqual({ error: { code: 'unavailable' } });
  });

  it('maps a source org error to its constant code and rethrows anything else', async () => {
    const fake = fakeQualitySource(fullTables());
    fake.failNext(orgLikeError('unauthorized', 401));
    const res = await createReportQualityRoutes(fake.source).request(url(), {}, ENV);
    expect(res.status).toBe(401);
    expect(await res.json()).toStrictEqual({ error: { code: 'unauthorized' } });

    const fake2 = fakeQualitySource(fullTables());
    fake2.failNext(new Error('boom'));
    const res2 = await createReportQualityRoutes(fake2.source).request(url(), {}, ENV);
    expect(res2.status).toBe(500);
    expect(await res2.text()).not.toContain('boom');
  });

  it('the rubric label is a stable prefix of the rubric set hash', () => {
    expect(rubricVersionLabel('0123456789abcdef'.repeat(4))).toBe('rubric-set-0123456789ab');
    expect(qualityCardFromRow(qualityCardRow(), new Map())).toBeNull();
  });
});
