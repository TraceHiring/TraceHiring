// The demo outbox (spec D1-2, R-9, §6.1 /demo-outbox): the Messaging mock's only sink. One SQLite-backed
// DemoOutboxDO per org. It holds a kind, the candidate label and the body; never the recipient address (the
// writer checks it is @example.test and drops it). Non-production only: the writer refuses production (L-11).
// The statements are synchronous `sql.exec` calls, so each method runs to completion inside the object.

/** The slice of the Durable Object SQLite API this store uses (a fake implements it in tests). */
export interface SqlCursorLike {
  toArray(): Record<string, SqlStorageValue>[];
}
export interface SqlStorageLike {
  exec(query: string, ...bindings: SqlStorageValue[]): SqlCursorLike;
}

export type OutboxKind = 'invite' | 'otp';

export interface OutboxEntryInput {
  kind: OutboxKind;
  candidateLabel: string;
  bodyText: string;
  idempotencyKey: string;
}

export interface AppendResult {
  id: string;
  created: boolean;
}

export interface OutboxEntry {
  id: string;
  createdAt: string;
  kind: OutboxKind;
  candidateLabel: string;
  bodyText: string;
}

/** Entries kept per org; older ones are dropped (demo data only). */
export const OUTBOX_KEEP = 200;
export const OUTBOX_LIST_LIMIT = 50;

export const OUTBOX_SQL = {
  create:
    'create table if not exists entries (seq integer primary key autoincrement, id text not null unique, created_at text not null, kind text not null, candidate_label text not null, body_text text not null, idem text not null unique)',
  insert:
    'insert into entries (id, created_at, kind, candidate_label, body_text, idem) values (?, ?, ?, ?, ?, ?) on conflict (idem) do nothing returning id',
  byIdem: 'select id from entries where idem = ?',
  trim: 'delete from entries where seq <= (select max(seq) from entries) - ?',
  list: 'select id, created_at, kind, candidate_label, body_text from entries order by seq desc limit ?',
} as const;

export class OutboxStore {
  readonly #sql: SqlStorageLike;

  constructor(sql: SqlStorageLike) {
    this.#sql = sql;
    this.#sql.exec(OUTBOX_SQL.create);
  }

  /** Idempotent by key: a retried send writes one entry and answers the first entry's id. */
  append(entry: OutboxEntryInput, id: string, createdAt: string): AppendResult {
    const inserted = this.#sql
      .exec(
        OUTBOX_SQL.insert,
        id,
        createdAt,
        entry.kind,
        entry.candidateLabel,
        entry.bodyText,
        entry.idempotencyKey,
      )
      .toArray();
    if (inserted.length === 1) {
      this.#sql.exec(OUTBOX_SQL.trim, OUTBOX_KEEP);
      return { id, created: true };
    }
    const [first] = this.#sql.exec(OUTBOX_SQL.byIdem, entry.idempotencyKey).toArray();
    return { id: String(first?.id ?? id), created: false };
  }

  list(limit: number = OUTBOX_LIST_LIMIT): OutboxEntry[] {
    return this.#sql
      .exec(OUTBOX_SQL.list, Math.max(1, Math.min(limit, OUTBOX_LIST_LIMIT)))
      .toArray()
      .map((r) => ({
        id: String(r.id),
        createdAt: String(r.created_at),
        kind: r.kind === 'invite' ? 'invite' : 'otp',
        candidateLabel: String(r.candidate_label),
        bodyText: String(r.body_text),
      }));
  }
}
