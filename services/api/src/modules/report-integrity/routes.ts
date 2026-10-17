// GET /v1/orgs/:orgId/reports/:reportId/integrity -> IntegrityCard (spec §6.2 "Three report payloads, three modules",
// L-19, rule 1; §6.3 rule 6). Reads `reports`, `integrity_cards`, `integrity_timeline_entries` and only the boolean
// `quality_cards.meets_cutoff`, every read as the caller (RLS decides) and filtered by the path org. No score is
// selected, compared or returned. Below the cutoff it reads no integrity row at all. A report the caller cannot see is
// 404. This module imports no neutral or quality module: it gets the structural row source from the lead's mount.
import {
  IntegrityCard,
  IntegrityCardRow,
  IntegrityTimelineEntryRow,
} from '@trace/shared/contracts/d1';
import { Hono } from 'hono';
import { z } from 'zod';
import { integrityErrorAnswer, integrityFail, integrityJson } from './errors.js';
import { projectIntegrityCard } from './projection.js';

/** Structural twin of the shared `CardSource`: authenticates the request and selects as the caller. */
export interface IntegrityRowSource {
  select(
    request: Request,
    env: Env,
    table: string,
    query: Readonly<Record<string, string>>,
  ): Promise<unknown[]>;
}

export const INTEGRITY_CARD_PATH = '/v1/orgs/:orgId/reports/:reportId/integrity';

const Id = z.uuid();
const ReportRow = z.strictObject({
  id: z.uuid(),
  session_id: z.uuid(),
  integrity_card_id: z.uuid().nullable(),
});
const CutoffRow = z.strictObject({ meets_cutoff: z.boolean() });

const CARD_COLUMNS = Object.keys(IntegrityCardRow.shape).join(',');
const ENTRY_COLUMNS = Object.keys(IntegrityTimelineEntryRow.shape).join(',');
const MAX_ENTRIES = 500;

const pathId = (value: string | undefined): string => {
  const r = Id.safeParse(value);
  return r.success ? r.data : integrityFail('not_found');
};

/** At most one row, strictly parsed; a second row or a bad shape is `unavailable` (fail closed). */
const atMostOne = <T>(schema: z.ZodType<T>, rows: unknown[]): T | null => {
  if (rows.length > 1) return integrityFail('unavailable');
  if (rows.length === 0) return null;
  const r = schema.safeParse(rows[0]);
  return r.success ? r.data : integrityFail('unavailable');
};

export const loadIntegrityCard = async (
  source: IntegrityRowSource,
  request: Request,
  env: Env,
  orgId: string,
  reportId: string,
): Promise<IntegrityCard> => {
  const read = (table: string, query: Record<string, string>) =>
    source.select(request, env, table, { ...query, org_id: `eq.${orgId}` });

  const report = atMostOne(
    ReportRow,
    await read('reports', { select: 'id,session_id,integrity_card_id', id: `eq.${reportId}` }),
  );
  if (report === null) return integrityFail('not_found');

  const cutoff = atMostOne(
    CutoffRow,
    await read('quality_cards', { select: 'meets_cutoff', session_id: `eq.${report.session_id}` }),
  );
  const meetsCutoff = cutoff === null ? null : cutoff.meets_cutoff;
  // Below the cutoff, without a quality card, or before the card is attached: no integrity row is read (rule 6).
  if (meetsCutoff !== true || report.integrity_card_id === null) {
    return projectIntegrityCard({ meetsCutoff, card: null, entries: [] });
  }

  const card = atMostOne(
    IntegrityCardRow,
    await read('integrity_cards', {
      select: CARD_COLUMNS,
      id: `eq.${report.integrity_card_id}`,
      session_id: `eq.${report.session_id}`,
      review_state: 'eq.reviewed',
    }),
  );
  if (card?.review_state !== 'reviewed' || card.org_id !== orgId) {
    return projectIntegrityCard({ meetsCutoff, card: null, entries: [] });
  }

  const rawEntries = await read('integrity_timeline_entries', {
    select: ENTRY_COLUMNS,
    integrity_card_id: `eq.${card.id}`,
    session_id: `eq.${card.session_id}`,
    order: 'position.asc',
    // One past the cap, so a longer timeline fails closed instead of a cut flag list served as `ready`.
    limit: String(MAX_ENTRIES + 1),
  });
  if (rawEntries.length > MAX_ENTRIES) return integrityFail('unavailable');
  const entries = z.array(IntegrityTimelineEntryRow).safeParse(rawEntries);
  if (!entries.success) return integrityFail('unavailable');
  return projectIntegrityCard({
    meetsCutoff,
    card,
    entries: entries.data.filter((e) => e.org_id === orgId),
  });
};

/** The sub-router the lead mounts with `app.route('/', createReportIntegrityRoutes(cardSource(orgDeps)))`. */
export const createReportIntegrityRoutes = (
  source: IntegrityRowSource,
): Hono<{ Bindings: Env }> => {
  const app = new Hono<{ Bindings: Env }>();
  app.get(INTEGRITY_CARD_PATH, async (c) => {
    try {
      const orgId = pathId(c.req.param('orgId'));
      const reportId = pathId(c.req.param('reportId'));
      const card = await loadIntegrityCard(source, c.req.raw, c.env, orgId, reportId);
      const out = IntegrityCard.safeParse(card);
      return out.success ? integrityJson(out.data) : integrityFail('unavailable');
    } catch (err) {
      const answer = integrityErrorAnswer(err);
      if (answer !== null) return answer;
      throw err;
    }
  });
  return app;
};
