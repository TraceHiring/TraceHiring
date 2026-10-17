// MediaLinkDO storage (spec §4.5, §6.2 R3-4, R3-7; DC-D5). One object per link (`idFromName(jti)`) holds the issued
// record; the burn is ONE statement, `UPDATE … WHERE state = 'open' AND exp >= ? RETURNING`, so of any number of
// concurrent fetches exactly one gets the record (DC-D5: a read-await-write burn let five through). One object per
// viewer (`idFromName('viewer:' + id)`) counts link issues per minute. All calls are synchronous `sql.exec`.
import type { SqlStorageLike } from '../outbox/outbox-store.js';

export interface LinkRecord {
  mediaId: string;
  orgId: string;
  viewerUserId: string;
  aal: 'aal1' | 'aal2';
  amr: string[];
  /** Integer epoch seconds; issue time + 300 exactly. */
  exp: number;
}

export const LINK_SQL = {
  createLinks:
    "create table if not exists links (jti text primary key, record text not null, exp integer not null, state text not null check (state in ('open', 'burnt')))",
  createRate:
    'create table if not exists issue_rate (window_start integer primary key, n integer not null)',
  insert: "insert into links (jti, record, exp, state) values (?, ?, ?, 'open')",
  burn: "update links set state = 'burnt' where jti = ? and state = 'open' and exp >= ? returning record",
  rateBump:
    'insert into issue_rate (window_start, n) values (?, 1) on conflict (window_start) do update set n = n + 1 returning n',
  rateTrim: 'delete from issue_rate where window_start < ?',
} as const;

/** Link issues allowed per viewer per minute (R3-7). */
export const ISSUE_LIMIT_PER_MINUTE = 20;

export class LinkStore {
  readonly #sql: SqlStorageLike;

  constructor(sql: SqlStorageLike) {
    this.#sql = sql;
    this.#sql.exec(LINK_SQL.createLinks);
    this.#sql.exec(LINK_SQL.createRate);
  }

  /** Stores the record once; a second issue for the same jti throws (a jti is never reused). */
  issue(jti: string, record: LinkRecord): void {
    this.#sql.exec(LINK_SQL.insert, jti, JSON.stringify(record), record.exp);
  }

  /** Burns an open, unexpired link and returns its record; null for a burnt, unknown or expired one. */
  burn(jti: string, nowSec: number): LinkRecord | null {
    const [row] = this.#sql.exec(LINK_SQL.burn, jti, nowSec).toArray();
    if (row === undefined || typeof row.record !== 'string') return null;
    return JSON.parse(row.record) as LinkRecord;
  }

  /** Counts one issue in the current minute; false once the limit is passed. */
  allowIssue(nowSec: number, limit: number = ISSUE_LIMIT_PER_MINUTE): boolean {
    const window = Math.floor(nowSec / 60) * 60;
    this.#sql.exec(LINK_SQL.rateTrim, window - 120);
    const [row] = this.#sql.exec(LINK_SQL.rateBump, window).toArray();
    return Number(row?.n ?? Infinity) <= limit;
  }
}
