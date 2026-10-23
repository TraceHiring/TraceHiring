// Fixtures for the A2a module tests (bank, pools, library, imports, ai-drafts; spec m1 §6.2-§6.5, §6.9, §6.11): the
// fake PostgREST of tests/rest.test-helpers.ts with hooks that stand in for the M1-a/M1-c guards the routes rely on
// (ids, timestamps, version numbers, the item_versions state machine of §4.1, draft-only keys, RLS on library-sourced
// keys, the pool and import job guards) and a harness that mounts one router as a caller. Synthetic data only; the real
// triggers and policies are proven by supabase/tests (lead).
import { Hono } from 'hono';
import type { VariantEngine } from './content.js';
import type { OrgCaller, OrgDeps, Query, Rest } from '../tests/org-context.js';
import { RestError } from '../tests/org-context.js';
import {
  fakeDb,
  idMaker,
  type FakeDb,
  type Row,
  type RpcFake,
} from '../tests/rest.test-helpers.js';
import {
  callerOf,
  LIBRARY_ORG,
  MEMBERSHIP,
  ORG,
  ORG_B,
  USER,
  WS,
} from '../tests/tests.test-helpers.js';

export { callerOf, LIBRARY_ORG, MEMBERSHIP, ORG, ORG_B, USER, WS };

/** A second workspace of ORG (not the default one). */
export const WS2 = 'b1000000-0000-4000-8000-000000000002';
export const RUBRIC = '7b900000-0000-4000-8000-000000000001';

let clock = 0;
/** Increasing `created_at` text with microseconds, as PostgREST returns timestamptz. */
export const stamp = (): string => {
  clock += 1;
  const s = clock % 60;
  const m = Math.floor(clock / 60) % 60;
  const h = 8 + Math.floor(clock / 3600);
  const two = (n: number) => String(n).padStart(2, '0');
  return `2026-10-23T${two(h)}:${two(m)}:${two(s)}.${String(clock).padStart(6, '0')}+00:00`;
};

const guard = (key: ConstructorParameters<typeof RestError>[2] = 'other') =>
  new RestError(403, '42501', key);

const CONTENT = [
  'stem',
  'options',
  'rubric_version_id',
  'content_sha256',
  'skill_key',
  'difficulty',
  'is_parameterised',
  'param_spec',
  'media',
] as const;

const tableOf = (db: FakeDb, name: string): Row[] => (db.tables[name] ??= []);

/**
 * `private.item_version_ready` as M1-m (R5-64 b): an mcq key naming one of the version's current options, a written
 * item's rubric, a parameterised item's variants.
 */
const ready = (v: Row, db: FakeDb): void => {
  if (v.format === 'mcq' && v.is_parameterised !== true) {
    const options = (v.options as { id: string }[] | null) ?? [];
    const key = tableOf(db, 'item_answer_keys').find((k) => k.item_version_id === v.id);
    const optionId = (key?.key as { option_id?: string } | undefined)?.option_id;
    if (!options.some((o) => o.id === optionId)) throw guard('mcq_key_missing');
  }
  if (v.format === 'written' && v.rubric_version_id === null) throw guard('rubric_missing');
  if (v.is_parameterised === true) {
    const n = tableOf(db, 'item_variants').filter((x) => x.item_version_id === v.id).length;
    if (n === 0) throw guard('variants_missing');
  }
};

/** The item_versions guard of §4.1 for bank rows (M1-a), reduced to what the routes observe. */
const versionUpdate = (old: Row, next: Row, db: FakeDb): Row => {
  const content = CONTENT.some((c) => JSON.stringify(old[c]) !== JSON.stringify(next[c]));
  if (old.status === next.status) {
    if (old.status !== 'draft' && content) throw guard('item_frozen');
    return next;
  }
  if (content) throw guard('other');
  const from = String(old.status);
  const to = String(next.status);
  if (from === 'draft' && to === 'in_review') {
    ready(next, db);
    return next;
  }
  if (from === 'in_review' && (to === 'approved' || to === 'not_approved')) {
    if (to === 'not_approved') return next;
    ready(next, db);
    return { ...next, approved_by: USER, approved_at: stamp() };
  }
  if (from === 'approved' && to === 'retired') return next;
  throw guard('item_status_change');
};

export interface A2aDbOptions {
  /** The caller's roles in ORG (default recruiter). */
  roles?: string[];
}

/** The fake database of the A2a modules: one org, its default workspace WS and a second workspace WS2. */
export const a2aDb = (opts: A2aDbOptions = {}) => {
  const ids = idMaker('f1');
  const functions: Record<string, RpcFake> = {};
  const db = fakeDb(
    {
      memberships: [
        {
          id: MEMBERSHIP,
          org_id: ORG,
          user_id: USER,
          status: 'active',
          roles: opts.roles ?? ['recruiter'],
        },
      ],
      workspaces: [
        { id: WS, org_id: ORG, is_default: true },
        { id: WS2, org_id: ORG, is_default: false },
      ],
      items: [],
      item_versions: [],
      item_answer_keys: [],
      item_variants: [],
      v_item_exposure: [],
      v_item_bank_quant_share: [],
      pools: [],
      pool_items: [],
      sections: [],
      library_copy_requests: [],
      import_jobs: [],
      import_row_errors: [],
      ai_draft_jobs: [],
    },
    {
      items: {
        insert: (row) => ({
          id: ids(),
          created_by: USER,
          created_at: stamp(),
          archived_at: null,
          ...row,
        }),
        remove: (row, d) => {
          if (tableOf(d, 'item_versions').some((v) => v.item_id === row.id)) throw guard();
        },
      },
      item_versions: {
        insert: (row, d) => {
          const item = tableOf(d, 'items').find((i) => i.id === row.item_id);
          if (item === undefined) throw new RestError(409, '23503');
          if (item.format !== row.format) throw guard();
          // M1-m `item_versions_one_open_per_item` (R5-64 a): one draft or in-review bank version per item.
          if (
            tableOf(d, 'item_versions').some(
              (v) =>
                v.item_id === row.item_id &&
                v.section_id === null &&
                (v.status === 'draft' || v.status === 'in_review'),
            )
          ) {
            throw new RestError(409, '23505');
          }
          const versionNo =
            Math.max(
              0,
              ...tableOf(d, 'item_versions')
                .filter((v) => v.item_id === row.item_id)
                .map((v) => Number(v.version_no)),
            ) + 1;
          return {
            id: ids(),
            section_id: null,
            test_version_id: null,
            test_id: null,
            position: null,
            options: null,
            rubric_version_id: null,
            is_parameterised: false,
            param_spec: null,
            media: null,
            origin: 'human',
            approved_by: null,
            approved_at: null,
            import_job_id: null,
            import_row_no: null,
            source_item_version_id: null,
            ...row,
            workspace_id: item.workspace_id,
            version_no: versionNo,
            status: 'draft',
            created_by: USER,
            created_at: stamp(),
          };
        },
        update: (old, next, d) => versionUpdate(old, next, d),
        remove: (row) => {
          if (row.status !== 'draft') throw guard();
        },
      },
      item_answer_keys: {
        insert: (row, d) => {
          const v = tableOf(d, 'item_versions').find((x) => x.id === row.item_version_id);
          if (v === undefined) throw new RestError(409, '23503');
          if (v.status !== 'draft') throw guard('item_frozen');
          return { library_sourced: false, workspace_id: v.workspace_id, ...row };
        },
        update: (old, next, d) => {
          const v = tableOf(d, 'item_versions').find((x) => x.id === old.item_version_id);
          if (v?.status !== 'draft') throw guard('item_frozen');
          return next;
        },
        // I-M1-5: no org role reads a library-sourced key.
        visible: (row) => row.library_sourced !== true,
      },
      pools: {
        insert: (row) => ({
          id: ids(),
          status: 'active',
          skill_key: null,
          created_by: USER,
          created_at: stamp(),
          ...row,
        }),
      },
      pool_items: {
        insert: (row, d) => {
          const pool = tableOf(d, 'pools').find((p) => p.id === row.pool_id);
          if (pool === undefined) throw new RestError(409, '23503');
          if (pool.status === 'archived') throw guard('pool_archived');
          const v = tableOf(d, 'item_versions').find((x) => x.id === row.item_version_id);
          if (v === undefined || v.status !== 'approved' || v.format !== pool.format) {
            throw guard('other');
          }
          if (
            tableOf(d, 'pool_items').some(
              (p) => p.pool_id === row.pool_id && p.item_version_id === row.item_version_id,
            )
          ) {
            throw new RestError(409, '23505');
          }
          return { workspace_id: pool.workspace_id, added_by: USER, ...row };
        },
      },
      import_jobs: {
        insert: (row) => ({
          id: ids(),
          status: 'open',
          rows_total: 0,
          rows_ok: 0,
          rows_error: 0,
          images_ok: 0,
          error_code: null,
          created_by: USER,
          created_at: stamp(),
          completed_at: null,
          ...row,
        }),
        update: (old, next, d) => {
          // M1-m (R5-64 c): `images_ok` has no client update grant (permission denied for the column).
          if (next.images_ok !== old.images_ok) throw new RestError(401, '42501');
          if (['completed', 'cancelled', 'failed'].includes(String(old.status))) throw guard();
          if (old.status === next.status) return next;
          if (old.status === 'open' && next.status === 'completed') throw guard();
          const mine = tableOf(d, 'item_versions').filter((v) => v.import_job_id === old.id);
          const bad = new Set(
            tableOf(d, 'import_row_errors')
              .filter((e) => e.import_job_id === old.id)
              .map((e) => e.row_no),
          ).size;
          // The guard counts the distinct image keys of the job's stored items when the job ends.
          const images = new Set(
            mine.flatMap((v) => ((v.media as { key: string }[] | null) ?? []).map((m) => m.key)),
          ).size;
          return {
            ...next,
            rows_ok: mine.length,
            rows_error: bad,
            rows_total: mine.length + bad,
            images_ok: images,
            completed_at: stamp(),
          };
        },
      },
      ai_draft_jobs: {
        insert: (row) => ({
          id: ids(),
          status: 'queued',
          drafts_created: 0,
          drafts_discarded: 0,
          error_code: null,
          requested_by: USER,
          created_at: stamp(),
          completed_at: null,
          ...row,
        }),
      },
      library_copy_requests: {
        insert: (row, d) => {
          const lib = tableOf(d, 'item_versions');
          const out: string[] = [];
          for (const src of row.library_item_version_ids as string[]) {
            const s = lib.find((v) => v.id === src && v.org_id === LIBRARY_ORG);
            if (s === undefined || s.status !== 'approved') throw guard('library_not_approved');
            const existing = lib.find(
              (v) =>
                v.org_id === ORG &&
                v.workspace_id === row.workspace_id &&
                v.source_item_version_id === src,
            );
            if (existing !== undefined) {
              out.push(String(existing.id));
              continue;
            }
            const id = ids();
            lib.push({
              ...s,
              id,
              org_id: ORG,
              workspace_id: row.workspace_id,
              origin: 'library',
              source_item_version_id: src,
            });
            out.push(id);
          }
          return {
            id: ids(),
            requested_by: USER,
            created_at: stamp(),
            ...row,
            result_item_version_ids: out,
          };
        },
      },
    },
    functions,
  );
  // Every insert body as sent, so a test can check what the api never sends (a client id, an origin).
  const sentInserts: { table: string; body: Row[] }[] = [];
  const insert = db.rest.insert.bind(db.rest);
  db.rest.insert = <T>(table: string, body: unknown, query?: Query): Promise<T[]> => {
    sentInserts.push({
      table,
      body: structuredClone((Array.isArray(body) ? body : [body]) as Row[]),
    });
    return insert<T>(table, body, query);
  };
  // Every update patch as sent (a test checks a column the api never writes, e.g. import_jobs.images_ok).
  const sentUpdates: { table: string; patch: Row }[] = [];
  const update = db.rest.update.bind(db.rest);
  db.rest.update = <T>(table: string, query: Query, patch: unknown): Promise<T[]> => {
    sentUpdates.push({ table, patch: structuredClone(patch as Row) });
    return update<T>(table, query, patch);
  };
  // The fake applies `or=(…)` logic trees only: an `and=(…)` filter is moved into a one-arm `or` (first pages only).
  const select = db.rest.select.bind(db.rest);
  db.rest.select = <T>(table: string, query: Query): Promise<T[]> => {
    const { and, ...rest } = query;
    if (and === undefined) return select<T>(table, query);
    if (rest.or !== undefined) throw new Error('fake rest: and with or');
    return select<T>(table, { ...rest, or: `(and${and})` });
  };
  return Object.assign(db, { sentInserts, sentUpdates });
};

export type A2aDb = ReturnType<typeof a2aDb>;

/** One bank item and its version (M1-a columns), stored directly (as a fixture on the operator path). */
export const seedVersion = (db: FakeDb, patch: Row = {}): Row => {
  const n = tableOf(db, 'item_versions').length + 1;
  const hex = n.toString(16).padStart(12, '0');
  const itemId = (patch.item_id as string | undefined) ?? `c3000000-0000-4000-8000-${hex}`;
  const format = (patch.format as string | undefined) ?? 'mcq';
  if (!tableOf(db, 'items').some((i) => i.id === itemId)) {
    tableOf(db, 'items').push({
      id: itemId,
      org_id: (patch.org_id as string | undefined) ?? ORG,
      workspace_id: (patch.workspace_id as string | undefined) ?? WS,
      format,
      skill_key: 'verbal',
      created_by: USER,
      created_at: stamp(),
    });
  }
  const row: Row = {
    id: `c4000000-0000-4000-8000-${hex}`,
    item_id: itemId,
    org_id: ORG,
    workspace_id: WS,
    section_id: null,
    test_version_id: null,
    test_id: null,
    position: null,
    version_no: 1,
    format,
    stem: `[synthetic] Bank item ${n}`,
    options:
      format === 'mcq'
        ? [
            { id: 'a', text: 'Synthetic option A' },
            { id: 'b', text: 'Synthetic option B' },
          ]
        : null,
    rubric_version_id: format === 'written' ? RUBRIC : null,
    skill_key: 'verbal',
    difficulty: 0.45,
    status: 'approved',
    origin: 'human',
    is_parameterised: false,
    param_spec: null,
    media: null,
    created_by: USER,
    approved_by: USER,
    approved_at: '2026-10-23T07:00:00.000001+00:00',
    import_job_id: null,
    import_row_no: null,
    source_item_version_id: null,
    content_sha256: 'cd'.repeat(32),
    created_at: stamp(),
    ...patch,
  };
  if (row.status !== 'approved' && row.status !== 'retired' && !('approved_by' in patch)) {
    row.approved_by = null;
    row.approved_at = null;
  }
  tableOf(db, 'item_versions').push(row);
  if (format === 'mcq' && row.is_parameterised !== true) {
    tableOf(db, 'item_answer_keys').push({
      org_id: row.org_id,
      item_version_id: row.id,
      workspace_id: row.workspace_id,
      format: 'mcq',
      key: { option_id: 'a' },
      library_sourced: row.origin === 'library',
    });
  }
  return row;
};

/** Mounts one router with a fixed caller acting through the fake database. */
export const harness = (
  mount: (org: OrgDeps) => Hono<{ Bindings: Env }>,
  db: { rest: Rest },
  caller: OrgCaller = callerOf(),
) => {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/', mount({ context: async () => ({ caller, rest: db.rest }) }));
  const call = (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = { 'content-type': 'application/json' },
  ) =>
    app.request(
      `https://api.test/v1/orgs/${ORG}${path}`,
      {
        method,
        headers,
        ...(body === undefined
          ? {}
          : { body: body instanceof Uint8Array ? body : JSON.stringify(body) }),
      },
      {} as Env,
    );
  return { app, call };
};

/**
 * A stand-in for `@trace/item-variants` (the real parser and generator are AT-M1-04/05 in that package): `check` refuses
 * the grammar's reserved names (functions and keywords, which the contract's ParamName lets through) and `generate`
 * walks the first int param from its minimum, failing when its range holds fewer values than the spec's count.
 */
export const RESERVED_PARAM_NAMES = [
  'min',
  'max',
  'abs',
  'round',
  'floor',
  'ceil',
  'gcd',
  'lcm',
  'and',
  'or',
  'not',
];
export const fakeVariants: VariantEngine = {
  check: (spec) =>
    typeof spec === 'object' &&
    spec !== null &&
    Object.keys((spec as { params?: object }).params ?? {}).every(
      (n) => !RESERVED_PARAM_NAMES.includes(n),
    ),
  generate: (spec, seeds) => {
    if (seeds.length !== spec.count) throw new RangeError('seeds');
    const [name, def] = Object.entries(spec.params)[0] ?? [];
    if (name === undefined || def === undefined || (def as { kind: string }).kind !== 'int') {
      return { ok: false };
    }
    const { min, max, step } = def as { min: number; max: number; step: number };
    if (Math.floor((max - min) / step) + 1 < spec.count) return { ok: false };
    const render = (t: string, value: number) => t.split(`{{${name}}}`).join(String(value));
    return {
      ok: true,
      variants: Array.from({ length: spec.count }, (_, k) => {
        const value = min + k * step;
        return {
          variantNo: k + 1,
          params: { [name]: value },
          stem: render(spec.stem, value),
          options: spec.options.map((o) => ({ id: o.id, text: render(o.text, value) })),
          correctOptionId: spec.correctOptionId,
        };
      }),
    };
  },
};

export const codeOf = async (res: Response): Promise<string> =>
  ((await res.json()) as { error: { code: string } }).error.code;

export const jsonOf = async <T = Record<string, unknown>>(res: Response): Promise<T> =>
  (await res.json()) as T;
