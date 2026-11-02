// GET /v1/orgs/:orgId/reports/:reportId/quality -> QualityCard (spec §6.2 "Three report payloads, three modules",
// L-19, rule 1). Reads `reports` and `quality_cards` (plus the section names of the card's test version), every read
// as the caller (RLS decides) and filtered by the path org. Nothing integrity-related is read or returned. A report the
// caller cannot see is 404; no attached or visible card is `pending`. This module imports no neutral or integrity
// module: it gets the structural row source from the lead's mount.
import { QualityCard, QualityCardRow } from '@trace/shared/contracts/d1';
import { Hono } from 'hono';
import { z } from 'zod';
import { qualityErrorAnswer, qualityFail, qualityJson } from './errors.js';
import { qualityCardFromRow } from './quality-dto.js';

/** Structural twin of the shared `CardSource`: authenticates the request and selects as the caller. */
export interface QualityRowSource {
  select(
    request: Request,
    env: Env,
    table: string,
    query: Readonly<Record<string, string>>,
  ): Promise<unknown[]>;
}

export const QUALITY_CARD_PATH = '/v1/orgs/:orgId/reports/:reportId/quality';

const Id = z.uuid();
const ReportRow = z.strictObject({
  id: z.uuid(),
  session_id: z.uuid(),
  quality_card_id: z.uuid().nullable(),
});
const SectionRow = z.strictObject({ id: z.uuid(), name: z.string().min(1).max(120) });

const CARD_COLUMNS = Object.keys(QualityCardRow.shape).join(',');

const pathId = (value: string | undefined): string => {
  const r = Id.safeParse(value);
  return r.success ? r.data : qualityFail('not_found');
};

/** At most one row, strictly parsed; a second row or a bad shape is `unavailable` (fail closed). */
const atMostOne = <T>(schema: z.ZodType<T>, rows: unknown[]): T | null => {
  if (rows.length > 1) return qualityFail('unavailable');
  if (rows.length === 0) return null;
  const r = schema.safeParse(rows[0]);
  return r.success ? r.data : qualityFail('unavailable');
};

export const loadQualityCard = async (
  source: QualityRowSource,
  request: Request,
  env: Env,
  orgId: string,
  reportId: string,
): Promise<QualityCard> => {
  const read = (table: string, query: Record<string, string>) =>
    source.select(request, env, table, { ...query, org_id: `eq.${orgId}` });

  const report = atMostOne(
    ReportRow,
    await read('reports', { select: 'id,session_id,quality_card_id', id: `eq.${reportId}` }),
  );
  if (report === null) return qualityFail('not_found');
  if (report.quality_card_id === null) return { state: 'pending' };

  const card = atMostOne(
    QualityCardRow,
    await read('quality_cards', {
      select: CARD_COLUMNS,
      id: `eq.${report.quality_card_id}`,
      session_id: `eq.${report.session_id}`,
    }),
  );
  if (card?.org_id !== orgId) return { state: 'pending' };

  const sections = z.array(SectionRow).safeParse(
    await read('sections', {
      select: 'id,name',
      test_version_id: `eq.${card.test_version_id}`,
    }),
  );
  if (!sections.success) return qualityFail('unavailable');
  const ready = qualityCardFromRow(card, new Map(sections.data.map((s) => [s.id, s.name])));
  return ready ?? qualityFail('unavailable');
};

/** The sub-router the lead mounts with `app.route('/', createReportQualityRoutes(cardSource(orgDeps)))`. */
export const createReportQualityRoutes = (source: QualityRowSource): Hono<{ Bindings: Env }> => {
  const app = new Hono<{ Bindings: Env }>();
  app.get(QUALITY_CARD_PATH, async (c) => {
    try {
      const orgId = pathId(c.req.param('orgId'));
      const reportId = pathId(c.req.param('reportId'));
      const card = await loadQualityCard(source, c.req.raw, c.env, orgId, reportId);
      const out = QualityCard.safeParse(card);
      return out.success ? qualityJson(out.data) : qualityFail('unavailable');
    } catch (err) {
      const answer = qualityErrorAnswer(err);
      if (answer !== null) return answer;
      throw err;
    }
  });
  return app;
};
