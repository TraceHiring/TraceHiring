// In-memory stand-in for the quality stage's SQL (test only). Each constant statement of ./store.ts has a handler
// over plain rows that keeps what the real schema guarantees for this stage: unique keys with ON CONFLICT DO NOTHING,
// the card filled from its score (quality_cards_fill), set-once reports.quality_card_id (reports_set_once) and the
// job-org binding of the worker policies. The real SQL is proven against Postgres in db-test/.
// Rule 1: this helper lives in quality/ and knows no integrity table.
import type { SqlParam, SqlTx } from '@trace/shared/jobs';
import { SQL } from './store.js';

export type Row = Record<string, unknown>;
export interface FakeDb {
  tables: Record<string, Row[]>;
  /** The org the transaction runs for (trace.job_org_id); rows of other orgs are invisible. */
  jobOrg: string | null;
  seq: number;
}
export type Handler = (db: FakeDb, p: readonly SqlParam[]) => Row[];

export const newDb = (): FakeDb => ({ tables: {}, jobOrg: null, seq: 0 });

/** A random-looking v4 uuid from a counter (synthetic; the redactor ignores it). */
export const fakeId = (db: FakeDb): string => {
  db.seq += 1;
  const n = db.seq.toString(16).padStart(6, '0');
  return `5e8a3c1d-7b2f-4a9e-8c64-1d3f7a${n}`;
};

export const table = (db: FakeDb, name: string): Row[] => (db.tables[name] ??= []);

const visible = (db: FakeDb, name: string, org: unknown): Row[] => {
  if (db.jobOrg === null || org !== db.jobOrg) return [];
  return table(db, name).filter((r) => r['org_id'] === org);
};

const insertUnique = (
  db: FakeDb,
  name: string,
  row: Row,
  keys: readonly (readonly string[])[],
): void => {
  if (db.jobOrg === null || row['org_id'] !== db.jobOrg) throw new Error('42501 rls');
  const rows = table(db, name);
  const clash = keys.some((k) => rows.some((r) => k.every((c) => r[c] === row[c])));
  if (!clash) rows.push(row);
};

export const qualityHandlers: Record<string, Handler> = {
  [SQL.keyExists]: (db, [org, key]) =>
    visible(db, 'idempotency_keys', org)
      .filter((r) => r['scope'] === 'quality_score' && r['key'] === key)
      .map(() => ({ one: 1 })),
  [SQL.session]: (db, [org, id]) =>
    visible(db, 'sessions', org)
      .filter((r) => r['id'] === id)
      .map((r) => ({
        id: r['id'],
        test_version_id: r['test_version_id'],
        ruleset_version_id: r['ruleset_version_id'],
        state: r['state'],
      })),
  [SQL.cutoff]: (db, [org, tv]) =>
    table(db, 'test_versions')
      .filter((r) => r['org_id'] === org && db.jobOrg === org && r['id'] === tv)
      .map((r) => ({ quality_cutoff: r['quality_cutoff'] })),
  [SQL.sections]: (db, [org, tv]) =>
    visible(db, 'sections', org)
      .filter((r) => r['test_version_id'] === tv)
      .sort((a, b) => Number(a['position']) - Number(b['position']))
      .map((r) => ({ id: r['id'], position: r['position'], weight: r['weight'] })),
  [SQL.items]: (db, [org, tv]) => {
    const sectionPos = (r: Row): number =>
      Number(table(db, 'sections').find((s) => s['id'] === r['section_id'])?.['position']);
    return visible(db, 'item_versions', org)
      .filter((r) => r['test_version_id'] === tv)
      .sort(
        (a, b) =>
          sectionPos(a) - sectionPos(b) ||
          Number(a['position']) - Number(b['position']) ||
          (String(a['id']) < String(b['id']) ? -1 : 1),
      )
      .map((r) => ({
        id: r['id'],
        section_id: r['section_id'],
        format: r['format'],
        position: r['position'],
        stem: r['stem'],
        rubric_version_id: r['rubric_version_id'] ?? null,
      }));
  },
  [SQL.answerKeys]: (db, [org, tv]) => {
    const items = new Set(
      visible(db, 'item_versions', org)
        .filter((r) => r['test_version_id'] === tv)
        .map((r) => r['id']),
    );
    return visible(db, 'item_answer_keys', org)
      .filter((r) => items.has(r['item_version_id']))
      .map((r) => ({ item_version_id: r['item_version_id'], option_id: r['option_id'] }));
  },
  [SQL.rubrics]: (db, [org, tv]) => {
    const used = new Set(
      visible(db, 'item_versions', org)
        .filter((r) => r['test_version_id'] === tv && r['rubric_version_id'] != null)
        .map((r) => r['rubric_version_id']),
    );
    return visible(db, 'rubric_versions', org)
      .filter((r) => used.has(r['id']))
      .map((r) => ({ id: r['id'], criteria: r['criteria'], content_sha256: r['content_sha256'] }));
  },
  // Package v2 (spec m1 R5-19): the same joins as the SQL, over plain rows.
  [SQL.versionV2]: (db, [org, tv]) =>
    visible(db, 'test_versions', org)
      .filter((r) => r['id'] === tv)
      .map((r) => ({
        quality_cutoff: r['quality_cutoff'],
        package_version: r['package_version'] ?? 1,
      })),
  [SQL.sectionsV2]: (db, [org, tv]) =>
    visible(db, 'sections', org)
      .filter((r) => r['test_version_id'] === tv)
      .sort((a, b) => Number(a['position']) - Number(b['position']))
      .map((r) => ({
        id: r['id'],
        position: r['position'],
        weight: r['weight'],
        draw_count: r['draw_count'] ?? null,
      })),
  [SQL.drawn]: (db, [org, s]) => {
    const sectionOf = (r: Row) =>
      visible(db, 'sections', org).find((x) => x['id'] === r['section_id']);
    return visible(db, 'session_items', org)
      .filter((r) => r['session_id'] === s && (sectionOf(r)?.['draw_count'] ?? null) !== null)
      .map((r) => ({
        r,
        i: visible(db, 'item_versions', org).find((x) => x['id'] === r['item_version_id']),
      }))
      .filter((x): x is { r: Row; i: Row } => x.i !== undefined)
      .sort(
        (a, b) =>
          Number(sectionOf(a.r)?.['position']) - Number(sectionOf(b.r)?.['position']) ||
          Number(a.r['position']) - Number(b.r['position']),
      )
      .map(({ r, i }) => ({
        id: r['id'],
        item_version_id: r['item_version_id'],
        section_id: r['section_id'],
        position: r['position'],
        item_variant_id: r['item_variant_id'] ?? null,
        format: i['format'],
        stem: i['stem'],
        rubric_version_id: i['rubric_version_id'] ?? null,
      }));
  },
  [SQL.drawnKeys]: (db, [org, s]) => {
    const items = new Set(
      visible(db, 'session_items', org)
        .filter((r) => r['session_id'] === s && r['item_variant_id'] == null)
        .map((r) => r['item_version_id']),
    );
    return visible(db, 'item_answer_keys', org)
      .filter((r) => items.has(r['item_version_id']))
      .map((r) => ({ item_version_id: r['item_version_id'], option_id: r['option_id'] }));
  },
  [SQL.variantKeys]: (db, [org, s]) => {
    const variants = new Set(
      visible(db, 'session_items', org)
        .filter((r) => r['session_id'] === s && r['item_variant_id'] != null)
        .map((r) => r['item_variant_id']),
    );
    return visible(db, 'item_variant_keys', org)
      .filter((r) => variants.has(r['item_variant_id']))
      .map((r) => ({ item_variant_id: r['item_variant_id'], option_id: r['option_id'] }));
  },
  [SQL.rubricsV2]: (db, [org, tv, s]) => {
    const drawnItems = new Set(
      visible(db, 'session_items', org)
        .filter((r) => r['session_id'] === s)
        .map((r) => r['item_version_id']),
    );
    const used = new Set(
      visible(db, 'item_versions', org)
        .filter(
          (r) =>
            (r['test_version_id'] === tv || drawnItems.has(r['id'])) &&
            r['rubric_version_id'] != null,
        )
        .map((r) => r['rubric_version_id']),
    );
    return visible(db, 'rubric_versions', org)
      .filter((r) => used.has(r['id']))
      .map((r) => ({ id: r['id'], criteria: r['criteria'], content_sha256: r['content_sha256'] }));
  },
  [SQL.served]: (db, [org, s]) =>
    visible(db, 'session_items', org)
      .filter((r) => r['session_id'] === s)
      .map((r) => ({ id: r['id'], item_version_id: r['item_version_id'] })),
  [SQL.responses]: (db, [org, s]) =>
    visible(db, 'responses', org)
      .filter((r) => r['session_id'] === s)
      .map((r) => ({
        session_item_id: r['session_item_id'],
        answer_kind: r['answer_kind'],
        final_text: r['final_text'] ?? null,
        final_choice: r['final_choice'] ?? null,
      })),
  [SQL.insertRun]: (db, [org, s, si, model, adapter, rubric, raw, criteria]) => {
    insertUnique(
      db,
      'grader_runs',
      {
        id: fakeId(db),
        org_id: org,
        session_id: s,
        session_item_id: si,
        pass_no: 1,
        grader_kind: 'llm',
        model_id: model,
        adapter_version: adapter,
        rubric_version_id: rubric,
        raw_score: raw,
        criteria: JSON.parse(String(criteria)),
      },
      [['org_id', 'session_item_id', 'rubric_version_id', 'model_id', 'pass_no']],
    );
    return [];
  },
  [SQL.insertScore]: (db, p) => {
    const [
      org,
      s,
      tv,
      score,
      sections,
      cutoff,
      meets,
      version,
      rubricSet,
      rubricIds,
      model,
      adapter,
    ] = p;
    const pinned = table(db, 'test_versions').find((r) => r['id'] === tv);
    if (pinned?.['quality_cutoff'] !== cutoff) throw new Error('42501 cutoff pin');
    if (meets !== Number(score) >= Number(cutoff)) throw new Error('23514 meets_cutoff');
    insertUnique(
      db,
      'scores',
      {
        id: fakeId(db),
        org_id: org,
        session_id: s,
        test_version_id: tv,
        score,
        section_scores: JSON.parse(String(sections)),
        quality_cutoff: cutoff,
        meets_cutoff: meets,
        scoring_version: version,
        rubric_set_sha256: rubricSet,
        rubric_version_ids: JSON.parse(String(rubricIds)),
        grader_model_id: model,
        grader_adapter_version: adapter,
      },
      [['org_id', 'session_id', 'scoring_version']],
    );
    return [];
  },
  [SQL.scoreId]: (db, [org, s, version]) =>
    visible(db, 'scores', org)
      .filter((r) => r['session_id'] === s && r['scoring_version'] === version)
      .map((r) => ({ id: r['id'] })),
  [SQL.insertCard]: (db, [org, s, scoreId]) => {
    const score = table(db, 'scores').find((r) => r['id'] === scoreId && r['session_id'] === s);
    if (score === undefined) throw new Error('23503 score');
    insertUnique(
      db,
      'quality_cards',
      {
        id: fakeId(db),
        org_id: org,
        session_id: s,
        quality_score_id: scoreId,
        score: score['score'],
        section_scores: score['section_scores'],
        quality_cutoff: score['quality_cutoff'],
        meets_cutoff: score['meets_cutoff'],
        scoring_version: score['scoring_version'],
        rubric_set_sha256: score['rubric_set_sha256'],
        rubric_version_ids: score['rubric_version_ids'],
        grader_model_id: score['grader_model_id'],
        grader_adapter_version: score['grader_adapter_version'],
        test_version_id: score['test_version_id'],
      },
      [['org_id', 'session_id']],
    );
    return [];
  },
  [SQL.cardId]: (db, [org, s]) =>
    visible(db, 'quality_cards', org)
      .filter((r) => r['session_id'] === s)
      .map((r) => ({ id: r['id'] })),
  [SQL.attach]: (db, [org, s, card]) => {
    for (const r of visible(db, 'reports', org)) {
      if (r['session_id'] === s && r['quality_card_id'] == null) r['quality_card_id'] = card;
    }
    return [];
  },
  [SQL.pointer]: (db, [org, s]) =>
    visible(db, 'reports', org)
      .filter((r) => r['session_id'] === s)
      .map((r) => ({ quality_card_id: r['quality_card_id'] ?? null })),
  [SQL.insertKey]: (db, [org, key, ref]) => {
    insertUnique(
      db,
      'idempotency_keys',
      { org_id: org, scope: 'quality_score', key, result_ref: ref },
      [['org_id', 'scope', 'key']],
    );
    return [];
  },
};

/** A SqlTx over the fake: unknown SQL fails loudly, so every statement the stage runs is one of the constants. */
export const fakeTx = (db: FakeDb, handlers: Record<string, Handler>, log?: string[]): SqlTx => ({
  query: <R extends object>(text: string, params: readonly SqlParam[] = []): Promise<R[]> => {
    const h = handlers[text];
    if (h === undefined) return Promise.reject(new Error('fake: unknown statement'));
    log?.push(text);
    try {
      return Promise.resolve(h(db, params) as R[]);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error('fake'));
    }
  },
});

/** Runs `fn` directly on the shared tables (no copy): two such runs interleave like two concurrent connections. */
export const shared = <T>(
  db: FakeDb,
  org: string,
  handlers: Record<string, Handler>,
  fn: (tx: SqlTx) => Promise<T>,
): Promise<T> => {
  db.jobOrg = org;
  return fn(fakeTx(db, handlers));
};

/**
 * Runs `fn` as one transaction for `org`: it works on a copy of the tables, which replaces the originals only if
 * `fn` resolves (COMMIT); a throw discards the copy (ROLLBACK).
 */
export const inTx = async <T>(
  db: FakeDb,
  org: string,
  handlers: Record<string, Handler>,
  fn: (tx: SqlTx) => Promise<T>,
  log?: string[],
): Promise<T> => {
  const work: FakeDb = { tables: structuredClone(db.tables), jobOrg: org, seq: db.seq };
  const out = await fn(fakeTx(work, handlers, log));
  db.tables = work.tables;
  db.seq = work.seq;
  return out;
};
