// AT-D17 (ADR-021, L-19), quality card: the per-card state matrix over what the caller can see. No card attached, a
// pointer to a card the caller cannot see and a missing card are `pending`; a visible attached card is `ready`. The
// integrity side's state (awaiting_quality, reviewed, below the cutoff) changes nothing here. A report the caller
// cannot see is 404.
import { describe, expect, it } from 'vitest';
import {
  ENV,
  fakeQualitySource,
  ORG,
  ORG_B,
  qualityCardRow,
  REPORT,
  reportRow,
  sectionRows,
  type Tables,
} from './quality.test-helpers.js';
import { createReportQualityRoutes } from './routes.js';

const URL = `http://api.test/v1/orgs/${ORG}/reports/${REPORT}/quality`;

const stateOf = async (tables: Tables) => {
  const fake = fakeQualitySource(tables);
  const res = await createReportQualityRoutes(fake.source).request(URL, {}, ENV);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe('quality card readiness (AT-D17)', () => {
  it.each<[string, Tables, string]>([
    [
      'no card attached yet (scoring)',
      { reports: [reportRow({ quality_card_id: null })] },
      'pending',
    ],
    [
      'a card exists but is not attached yet',
      { reports: [reportRow({ quality_card_id: null })], quality_cards: [qualityCardRow()] },
      'pending',
    ],
    ['attached but missing', { reports: [reportRow()], sections: sectionRows() }, 'pending'],
    [
      'attached card of another org',
      {
        reports: [reportRow()],
        quality_cards: [qualityCardRow({ org_id: ORG_B })],
        sections: sectionRows(),
      },
      'pending',
    ],
    [
      'attached and visible',
      { reports: [reportRow()], quality_cards: [qualityCardRow()], sections: sectionRows() },
      'ready',
    ],
    [
      'attached and visible, below the cutoff (quality is shown; the cutoff gates integrity only)',
      {
        reports: [reportRow()],
        quality_cards: [qualityCardRow({ score: 20, meets_cutoff: false })],
        sections: sectionRows(),
      },
      'ready',
    ],
  ])('%s -> %s', async (_name, tables, expected) => {
    const { status, body } = await stateOf(tables);
    expect(status).toBe(200);
    expect(body.state).toBe(expected);
    if (expected === 'pending') expect(body).toStrictEqual({ state: 'pending' });
  });

  it('the integrity side does not change the quality card (rule 1)', async () => {
    const base = { quality_cards: [qualityCardRow()], sections: sectionRows() };
    const a = await stateOf({ ...base, reports: [reportRow({ integrity_card_id: null })] });
    const b = await stateOf({
      ...base,
      reports: [reportRow({ integrity_card_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })],
    });
    expect(a).toStrictEqual(b);
  });

  it('a report the caller cannot see is 404 not_found', async () => {
    const { status, body } = await stateOf({ quality_cards: [qualityCardRow()] });
    expect(status).toBe(404);
    expect(body).toStrictEqual({ error: { code: 'not_found' } });
  });
});
