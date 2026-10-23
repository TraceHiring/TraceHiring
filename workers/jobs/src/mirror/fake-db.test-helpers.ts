// In-memory stand-in for the mirror stage's SQL (test only), with what migration d1_invites_sessions enforces for
// trace_worker: the job-org binding, unique keys with ON CONFLICT DO NOTHING, the sessions guard (no session for a
// dead invitation), the session_items guard (the item belongs to the session's version; section copied), the media
// key shape, and `submitted` only once a sessions row exists (L-35). The real SQL is proven in db-test/.
import type { SqlParam, SqlTx } from '@trace/shared/jobs';
import { SQL } from './writes.js';

export type Row = Record<string, unknown>;
export interface FakeDb {
  tables: Record<string, Row[]>;
  jobOrg: string | null;
  seq: number;
}
export type Handler = (db: FakeDb, p: readonly SqlParam[]) => Row[];

export const newDb = (): FakeDb => ({ tables: {}, jobOrg: null, seq: 0 });

export const fakeId = (db: FakeDb): string => {
  db.seq += 1;
  return `4c7e1a9d-3b5f-4e2a-8d61-9b3f5c${db.seq.toString(16).padStart(6, '0')}`;
};

export const table = (db: FakeDb, name: string): Row[] => (db.tables[name] ??= []);

const visible = (db: FakeDb, name: string, org: unknown): Row[] => {
  if (db.jobOrg === null || org !== db.jobOrg) return [];
  return table(db, name).filter((r) => r['org_id'] === org);
};

const guard = (reason: string): never => {
  throw new Error(`TRACE_GUARD: ${reason}`);
};

const insertUnique = (
  db: FakeDb,
  name: string,
  row: Row,
  keys: readonly (readonly string[])[],
): void => {
  if (db.jobOrg === null || row['org_id'] !== db.jobOrg) throw new Error('42501 rls');
  const rows = table(db, name);
  if (!keys.some((k) => rows.some((r) => k.every((c) => r[c] === row[c])))) rows.push(row);
};

export const mirrorHandlers: Record<string, Handler> = {
  [SQL.lockInvitation]: (db, [org, id]) =>
    visible(db, 'invitations', org)
      .filter((r) => r['id'] === id)
      .map((r) => ({
        status: r['status'],
        session_id: r['session_id'] ?? null,
        adult_confirmed_by_inviter: r['adult_confirmed_by_inviter'] ?? null,
        adult_self_declared: r['adult_self_declared'] ?? null,
      })),
  [SQL.keyExists]: (db, [org, key]) =>
    visible(db, 'idempotency_keys', org)
      .filter((r) => r['scope'] === 'session_mirror' && r['key'] === key)
      .map(() => ({ one: 1 })),
  [SQL.consent]: (db, [org, id, inv, rs]) =>
    visible(db, 'consents', org)
      .filter((r) => r['id'] === id && r['invitation_id'] === inv && r['ruleset_version_id'] === rs)
      .map(() => ({ one: 1 })),
  [SQL.insertSession]: (db, p) => {
    const [
      id,
      org,
      tv,
      rs,
      inv,
      consent,
      state,
      kind,
      startedAt,
      deadlineAt,
      submittedAt,
      seq,
      receipt,
    ] = p;
    const invitation = table(db, 'invitations').find((r) => r['org_id'] === org && r['id'] === inv);
    if (invitation === undefined) guard('invitation not found');
    if (['blocked_age', 'expired', 'revoked'].includes(String(invitation?.['status'])))
      guard('dead invitation');
    insertUnique(
      db,
      'sessions',
      {
        id,
        org_id: org,
        test_version_id: tv,
        ruleset_version_id: rs,
        invitation_id: inv,
        consent_id: consent,
        state,
        submit_kind: kind,
        started_at: startedAt,
        server_deadline_at: deadlineAt,
        submitted_at: submittedAt,
        mirror_seq: seq,
        receipt_ref: receipt,
      },
      [['id'], ['org_id', 'invitation_id'], ['org_id', 'receipt_ref']],
    );
    return [];
  },
  [SQL.session]: (db, [org, id]) =>
    visible(db, 'sessions', org)
      .filter((r) => r['id'] === id)
      .map((r) => ({
        id: r['id'],
        invitation_id: r['invitation_id'],
        mirror_seq: r['mirror_seq'],
      })),
  [SQL.insertItems]: (db, [org, s, rows]) => {
    const session = table(db, 'sessions').find((r) => r['id'] === s);
    for (const x of JSON.parse(String(rows)) as Row[]) {
      const item = table(db, 'item_versions').find((r) => r['id'] === x['item_version_id']);
      if (item === undefined) throw new Error('23503 item version');
      if (item['test_version_id'] !== session?.['test_version_id'])
        guard('item of another version');
      insertUnique(
        db,
        'session_items',
        { id: fakeId(db), org_id: org, session_id: s, section_id: item['section_id'], ...x },
        [
          ['org_id', 'session_id', 'item_version_id'],
          ['org_id', 'session_id', 'section_id', 'position'],
        ],
      );
    }
    return [];
  },
  // session_items guard v2 (migration m1_tests, R5-39 a, R5-43, DB-M1-4) for a package v2 session: the section is
  // named and the item is in its published snapshot; an inline row is stored served; a pool row sits at a draw
  // position 1..draw_count and the section holds at most draw_count rows; a parameterised item comes as a variant.
  [SQL.insertItemsV2]: (db, [org, s, rows]) => {
    const session = table(db, 'sessions').find((r) => r['id'] === s);
    if (session === undefined) throw new Error('23503 session');
    const version = table(db, 'test_versions').find((r) => r['id'] === session['test_version_id']);
    for (const x of JSON.parse(String(rows)) as Row[]) {
      const item = table(db, 'item_versions').find((r) => r['id'] === x['item_version_id']);
      if (item === undefined) throw new Error('23503 item version');
      if (Number(version?.['package_version'] ?? 1) !== 2) {
        if (x['served_at'] === null) guard('a version 1 item is stored when served');
        if (x['item_variant_id'] !== null || x['option_order'] !== null) guard('version 1 extras');
        if (item['test_version_id'] !== session['test_version_id'])
          guard('item of another version');
      } else {
        if (x['section_id'] == null) guard('a version 2 item names its section');
        const inSnapshot = table(db, 'section_pool_snapshot').some(
          (sp) =>
            sp['test_version_id'] === session['test_version_id'] &&
            sp['section_id'] === x['section_id'] &&
            sp['item_version_id'] === x['item_version_id'],
        );
        if (!inSnapshot) guard('the item is not in the published snapshot of its section');
        const section = table(db, 'sections').find((r) => r['id'] === x['section_id']);
        const draw = section?.['draw_count'] ?? null;
        if (draw === null && x['served_at'] === null) guard('an inline item is stored when served');
        if (draw !== null) {
          if (Number(x['position']) > Number(draw)) guard('outside the draw');
          const held = table(db, 'session_items').filter(
            (r) => r['session_id'] === s && r['section_id'] === x['section_id'],
          ).length;
          if (held >= Number(draw)) guard('the draw is full');
        }
        if ((x['item_variant_id'] !== null) !== (item['is_parameterised'] === true))
          guard('a parameterised item is served as one of its variants');
        if (
          x['item_variant_id'] !== null &&
          !table(db, 'item_variants').some(
            (v) =>
              v['id'] === x['item_variant_id'] && v['item_version_id'] === x['item_version_id'],
          )
        ) {
          throw new Error('23503 variant');
        }
      }
      insertUnique(db, 'session_items', { id: fakeId(db), org_id: org, session_id: s, ...x }, [
        ['org_id', 'session_id', 'item_version_id'],
        ['org_id', 'session_id', 'section_id', 'position'],
      ]);
    }
    return [];
  },
  [SQL.itemsV2]: (db, [org, s]) =>
    visible(db, 'session_items', org)
      .filter((r) => r['session_id'] === s)
      .map((r) => ({
        id: r['id'],
        item_version_id: r['item_version_id'],
        section_id: r['section_id'],
        position: r['position'],
        served: r['served_at'] != null,
      })),
  [SQL.items]: (db, [org, s]) =>
    visible(db, 'session_items', org)
      .filter((r) => r['session_id'] === s)
      .map((r) => ({
        id: r['id'],
        item_version_id: r['item_version_id'],
        position: r['position'],
      })),
  [SQL.insertResponses]: (db, [org, s, submittedAt, rows]) => {
    for (const x of JSON.parse(String(rows)) as Row[]) {
      // responses guard v2 (R5-43): an item that was not served has no response.
      const item = table(db, 'session_items').find((r) => r['id'] === x['session_item_id']);
      if (item === undefined) throw new Error('23503 session item');
      if (item['served_at'] == null) guard('an item that was not served has no response');
      // As Postgres: the jsonb cast refuses \u0000 (22P05) and a lone surrogate escape (22P02), quoting the input.
      const text = typeof x['final_text'] === 'string' ? x['final_text'] : '';
      if (text.includes('\u0000')) {
        throw Object.assign(new Error('unsupported Unicode escape sequence: ' + text), {
          code: '22P05',
        });
      }
      if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)) {
        throw Object.assign(new Error('invalid input syntax for type json: ' + text), {
          code: '22P02',
        });
      }
      insertUnique(
        db,
        'responses',
        { id: fakeId(db), org_id: org, session_id: s, submitted_at: submittedAt, ...x },
        [['session_item_id']],
      );
    }
    return [];
  },
  [SQL.insertMedia]: (db, [org, s, key, sha, bytes]) => {
    if (key !== `media/${String(org)}/${String(s)}/start_photo.jpg`) guard('media key');
    insertUnique(
      db,
      'media_objects',
      {
        id: fakeId(db),
        org_id: org,
        session_id: s,
        kind: 'start_photo',
        r2_key: key,
        sha256: sha,
        bytes,
        mime: 'image/jpeg',
        blurred_on_device: true,
      },
      [['org_id', 'session_id', 'kind'], ['r2_key']],
    );
    return [];
  },
  [SQL.insertReport]: (db, [org, s]) => {
    insertUnique(
      db,
      'reports',
      {
        id: fakeId(db),
        org_id: org,
        session_id: s,
        quality_card_id: null,
        integrity_card_id: null,
      },
      [['org_id', 'session_id']],
    );
    return [];
  },
  [SQL.submitInvitation]: (db, [org, id]) => {
    for (const r of visible(db, 'invitations', org)) {
      if (r['id'] !== id || r['status'] === 'submitted') continue;
      if (!table(db, 'sessions').some((s) => s['invitation_id'] === id))
        guard('submitted needs a session');
      r['status'] = 'submitted';
    }
    return [];
  },
  [SQL.insertKey]: (db, [org, key, ref]) => {
    insertUnique(
      db,
      'idempotency_keys',
      { org_id: org, scope: 'session_mirror', key, result_ref: ref },
      [['org_id', 'scope', 'key']],
    );
    return [];
  },
};

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

/** Runs `fn` directly on the shared tables (two such runs interleave like two concurrent connections). */
export const shared = <T>(
  db: FakeDb,
  org: string | null,
  handlers: Record<string, Handler>,
  fn: (tx: SqlTx) => Promise<T>,
): Promise<T> => {
  db.jobOrg = org;
  return fn(fakeTx(db, handlers));
};

/** One transaction: a copy of the tables replaces the originals only if `fn` resolves. */
export const inTx = async <T>(
  db: FakeDb,
  org: string | null,
  handlers: Record<string, Handler>,
  fn: (tx: SqlTx) => Promise<T>,
): Promise<T> => {
  const work: FakeDb = { tables: structuredClone(db.tables), jobOrg: org, seq: db.seq };
  const out = await fn(fakeTx(work, handlers));
  db.tables = work.tables;
  db.seq = work.seq;
  return out;
};
