// Test doubles for the media link (AT-D10 api half): a fake of the DO SQLite surface that interprets only LINK_SQL,
// a model of the two grant functions (migration 4: viewer check, link issued to this viewer for this media within
// 330 s, single view; the audit row is written in the caller's transaction and rolled back with it), an R2 reader,
// and a fake caller context. Synthetic data only.
import type { ApiDb, SqlParam, SqlTx } from '../candidate/api-db.js';
import type { SqlStorageLike } from '../outbox/outbox-store.js';
import type { OrgCaller, OrgContext, OrgDeps, Query, Rest } from '../tests/org-context.js';
import { LINK_SQL, LinkStore } from './link-store.js';
import { MEDIA_SQL, type EvidenceReader, type LinkClient } from './media-link.js';

export const ORG = 'a1000000-0000-4000-8000-000000000001';
export const ORG_B = 'a1000000-0000-4000-8000-000000000003';
export const REPORT = 'd1000000-0000-4000-8000-000000000001';
export const SESSION = '5e000000-0000-4000-8000-000000000001';
export const MEDIA = '3e000000-0000-4000-8000-000000000001';
export const VIEWER = '00000000-0000-4000-8000-000000000007';
export const KEY = `media/${ORG}/${SESSION}/start_photo.jpg`;

export const fakeLinkSql = (): SqlStorageLike => {
  const links = new Map<string, { record: string; exp: number; state: string }>();
  const rate = new Map<number, number>();
  const empty = { toArray: () => [] };
  return {
    exec(query, ...b) {
      if (query === LINK_SQL.createLinks || query === LINK_SQL.createRate) return empty;
      if (query === LINK_SQL.insert) {
        const jti = String(b[0]);
        if (links.has(jti)) throw new Error('UNIQUE constraint failed');
        links.set(jti, { record: String(b[1]), exp: Number(b[2]), state: 'open' });
        return empty;
      }
      if (query === LINK_SQL.burn) {
        const row = links.get(String(b[0]));
        if (row === undefined || row.state !== 'open' || row.exp < Number(b[1])) return empty;
        row.state = 'burnt';
        return { toArray: () => [{ record: row.record }] };
      }
      if (query === LINK_SQL.rateTrim) {
        for (const k of [...rate.keys()]) if (k < Number(b[0])) rate.delete(k);
        return empty;
      }
      if (query === LINK_SQL.rateBump) {
        const k = Number(b[0]);
        const n = (rate.get(k) ?? 0) + 1;
        rate.set(k, n);
        return { toArray: () => [{ n }] };
      }
      throw new Error('unexpected statement');
    },
  };
};

/** One LinkStore per DO name, as `idFromName` would give. */
export const fakeLinks = (): LinkClient & { calls: string[] } => {
  const stores = new Map<string, LinkStore>();
  const calls: string[] = [];
  const store = (name: string) => {
    let s = stores.get(name);
    if (s === undefined) {
      s = new LinkStore(fakeLinkSql());
      stores.set(name, s);
    }
    return s;
  };
  return {
    calls,
    issue: async (jti, record) => {
      calls.push('issue');
      store(jti).issue(jti, record);
    },
    burn: async (jti, nowSec) => {
      calls.push('burn');
      return store(jti).burn(jti, nowSec);
    },
    allowIssue: async (viewer, nowSec) => store(`viewer:${viewer}`).allowIssue(nowSec),
  };
};

export interface AuditRow {
  action: 'media.link_issued' | 'media.view';
  linkId: string;
  mediaId: string;
  actor: string;
  at: number;
}

/** A model of the media grant functions and the trace_api transaction around them. */
export const fakeMediaDb = (opts: { now: () => number }) => {
  const audit: AuditRow[] = [];
  const allowed = new Set<string>([`${MEDIA}|${VIEWER}`]);
  const mediaOrg = new Map<string, string>([[MEDIA, ORG]]);
  const state = { failCommit: false, dbCalls: 0 };
  const denied = () =>
    Object.assign(new Error('TRACE_GUARD: media access denied'), { code: '42501' });
  const db: ApiDb = {
    async withOrg<T>(orgId: string | null, fn: (tx: SqlTx) => Promise<T>): Promise<T> {
      state.dbCalls += 1;
      const pending: AuditRow[] = [];
      const tx: SqlTx = {
        async query<R extends object>(text: string, params: readonly SqlParam[] = []) {
          const [media, viewer, , , link] = params.map(String) as [
            string,
            string,
            string,
            string,
            string,
          ];
          const visible = mediaOrg.get(media) === orgId && allowed.has(`${media}|${viewer}`);
          const recent = (r: AuditRow) => opts.now() - r.at <= 330_000;
          if (text === MEDIA_SQL.linkGrant) {
            if (!visible || audit.some((r) => r.linkId === link && recent(r))) throw denied();
            pending.push({
              action: 'media.link_issued',
              linkId: link,
              mediaId: media,
              actor: viewer,
              at: opts.now(),
            });
            return [{ session_id: SESSION }] as unknown as R[];
          }
          if (text === MEDIA_SQL.viewGrant) {
            const issued = audit.some(
              (r) =>
                r.action === 'media.link_issued' &&
                r.linkId === link &&
                r.mediaId === media &&
                r.actor === viewer &&
                recent(r),
            );
            const viewed = audit.some(
              (r) => r.action === 'media.view' && r.linkId === link && recent(r),
            );
            if (!visible || !issued || viewed) throw denied();
            pending.push({
              action: 'media.view',
              linkId: link,
              mediaId: media,
              actor: viewer,
              at: opts.now(),
            });
            return [{ r2_key: KEY }] as unknown as R[];
          }
          throw new Error('unexpected statement');
        },
      };
      const out = await fn(tx);
      if (state.failCommit) throw new Error('commit failed');
      audit.push(...pending);
      return out;
    },
  };
  return { db, audit, allowed, mediaOrg, state };
};

export const fakeEvidence = (): EvidenceReader & { reads: string[] } => {
  const reads: string[] = [];
  return {
    reads,
    get: async (key) => {
      reads.push(key);
      if (key !== KEY) return null;
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
      return { body: new Blob([bytes]).stream(), size: bytes.length };
    },
  };
};

/** PostgREST rows visible to the caller, keyed by table; filters are applied on `eq.` values. */
export const fakeRest = (
  tables: Record<string, Record<string, unknown>[]>,
): Rest & { selects: string[] } => {
  const selects: string[] = [];
  const match = (row: Record<string, unknown>, query: Query) =>
    Object.entries(query).every(
      ([k, v]) =>
        k === 'select' ||
        k === 'order' ||
        k === 'limit' ||
        !v.startsWith('eq.') ||
        String(row[k]) === v.slice(3),
    );
  const rows = (table: string, query: Query) =>
    (tables[table] ?? []).filter((r) => match(r, query));
  return {
    selects,
    select: async <T>(table: string, query: Query) => {
      selects.push(table);
      return rows(table, query) as T[];
    },
    insert: async () => [],
    update: async () => [],
    remove: async () => [],
  };
};

export const caller = (patch: Partial<OrgCaller> = {}): OrgCaller => ({
  userId: VIEWER,
  aal: 'aal2',
  amr: ['password', 'totp'],
  jwt: 'h.p.s',
  ...patch,
});

export const orgDeps = (ctx: OrgContext | (() => OrgContext)): OrgDeps => ({
  context: async () => (typeof ctx === 'function' ? ctx() : ctx),
});

export const mediaTables = () => ({
  reports: [{ id: REPORT, org_id: ORG, session_id: SESSION }],
  media_objects: [{ id: MEDIA, org_id: ORG, session_id: SESSION, kind: 'start_photo' }],
  orgs: [{ id: ORG, name: 'Synthetic Org A' }],
  memberships: [{ org_id: ORG, user_id: VIEWER, status: 'active', roles: ['reviewer'] }],
});
