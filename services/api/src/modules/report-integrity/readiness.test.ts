// AT-D17 (ADR-021, L-19) and AT-D14 (rule 6), integrity card: the per-card state matrix over what the caller can see.
// `awaiting_quality`, a card not yet attached, a missing card and a missing quality card are all `pending`; below the
// cutoff is `not_used_below_cutoff` and no integrity row is even read; only a `reviewed` card attached to the report,
// with `meets_cutoff = true`, is `ready`. A report the caller cannot see is 404.
import { describe, expect, it } from 'vitest';
import {
  ENV,
  entryRow,
  fakeIntegritySource,
  integrityCardRow,
  ORG,
  qualityRow,
  REPORT,
  reportRow,
  type Tables,
} from './integrity.test-helpers.js';
import { createReportIntegrityRoutes } from './routes.js';

const URL = `http://api.test/v1/orgs/${ORG}/reports/${REPORT}/integrity`;

const stateOf = async (tables: Tables) => {
  const fake = fakeIntegritySource(tables);
  const res = await createReportIntegrityRoutes(fake.source).request(URL, {}, ENV);
  const body = (await res.json()) as { state?: string; error?: { code: string } };
  return { status: res.status, body, tables: fake.seen.map((s) => s.table) };
};

const INTEGRITY_TABLES = ['integrity_cards', 'integrity_timeline_entries'];

describe('integrity card readiness (AT-D17)', () => {
  it.each<[string, Tables, string]>([
    [
      'no quality card yet, nothing attached',
      { reports: [reportRow({ quality_card_id: null, integrity_card_id: null })] },
      'pending',
    ],
    [
      'awaiting_quality card, not attached',
      {
        reports: [reportRow({ quality_card_id: null, integrity_card_id: null })],
        integrity_cards: [integrityCardRow({ review_state: 'awaiting_quality' })],
      },
      'pending',
    ],
    [
      'quality card at the cutoff, integrity card not yet attached',
      {
        reports: [reportRow({ integrity_card_id: null })],
        quality_cards: [qualityRow(true)],
      },
      'pending',
    ],
    [
      'pointer set but the card is awaiting_quality (RLS hides it)',
      {
        reports: [reportRow()],
        quality_cards: [qualityRow(true)],
        integrity_cards: [integrityCardRow({ review_state: 'awaiting_quality' })],
      },
      'pending',
    ],
    [
      'pointer set but the card is missing',
      { reports: [reportRow()], quality_cards: [qualityRow(true)] },
      'pending',
    ],
    [
      'a reviewed card attached but no quality card visible',
      { reports: [reportRow()], integrity_cards: [integrityCardRow()] },
      'pending',
    ],
    [
      'reviewed card attached, meets_cutoff = true',
      {
        reports: [reportRow()],
        quality_cards: [qualityRow(true)],
        integrity_cards: [integrityCardRow()],
        integrity_timeline_entries: [entryRow()],
      },
      'ready',
    ],
  ])('%s -> %s', async (_name, tables, expected) => {
    const { status, body } = await stateOf(tables);
    expect(status).toBe(200);
    expect(body.state).toBe(expected);
    if (expected !== 'ready') expect(Object.keys(body)).toEqual(['state']);
  });

  it.each<[string, Tables]>([
    [
      'below the cutoff, card not_reviewed_below_cutoff and not attached',
      {
        reports: [reportRow({ integrity_card_id: null })],
        quality_cards: [qualityRow(false)],
        integrity_cards: [integrityCardRow({ review_state: 'not_reviewed_below_cutoff' })],
      },
    ],
    [
      'below the cutoff even if a reviewed card were attached (impossible by the guard)',
      {
        reports: [reportRow()],
        quality_cards: [qualityRow(false)],
        integrity_cards: [integrityCardRow()],
        integrity_timeline_entries: [entryRow()],
      },
    ],
  ])('%s -> not_used_below_cutoff, and no integrity row is read', async (_name, tables) => {
    const { status, body, tables: read } = await stateOf(tables);
    expect(status).toBe(200);
    expect(body).toStrictEqual({ state: 'not_used_below_cutoff' });
    expect(read.filter((t) => INTEGRITY_TABLES.includes(t))).toEqual([]);
  });

  it('a pending card reads no timeline entry', async () => {
    const { tables } = await stateOf({ reports: [reportRow()], quality_cards: [qualityRow(true)] });
    expect(tables).not.toContain('integrity_timeline_entries');
  });

  it('a report the caller cannot see is 404 not_found', async () => {
    const { status, body } = await stateOf({ quality_cards: [qualityRow(true)] });
    expect(status).toBe(404);
    expect(body).toStrictEqual({ error: { code: 'not_found' } });
  });
});
