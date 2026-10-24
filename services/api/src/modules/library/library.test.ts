// Library browse and copy (spec m1 M1-4, §6.2, §6.11 `GET …/library/items`, `POST …/library/copy`, R2-5, R3-7, R5-56 g,
// R5-57 b, E8; AT-M1-22 api part): browse reads approved library stems through the injected LibrarySource (trace_api,
// the verified viewer only) and pages by the exact `created_at` text; each call spends one token of the caller's
// library budget (the same LibraryLimiter as from-template: unbound is 503 before any read, spent is 429). A card
// carries no key. Copy is the guarded `library_copy_requests` insert and answers the local ids. Synthetic data only.
import {
  decodePageCursor,
  LibraryBrowseResponse,
  LibraryCopyResponse,
  LibraryItemCard,
} from '@trace/shared/contracts/m1';
import { describe, expect, it } from 'vitest';
import {
  a2aDb,
  callerOf,
  codeOf,
  harness,
  LIBRARY_ORG,
  ORG,
  seedVersion,
  USER,
  WS,
  WS2,
} from '../bank/a2a.test-helpers.js';
import type { LibraryLimiter } from '../templates/routes.js';
import { RestError } from '../tests/org-context.js';
import { createLibraryRoutes } from './routes.js';
import type { LibraryBrowseInput, LibraryCardRow, LibrarySource } from './source.js';

const card = (n: number): LibraryCardRow => ({
  card: {
    libraryItemVersionId: `c7000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`,
    format: 'mcq',
    skillKey: 'verbal',
    difficulty: 0.4,
    stem: `[synthetic] Library item ${String(n)}`,
    options: ['One', 'Two'],
    isParameterised: false,
  },
  createdAt: `2026-10-23T08:00:00.${String(n).padStart(6, '0')}+00:00`,
});

const fakeSource = (total: number) => {
  const calls: LibraryBrowseInput[] = [];
  const rows = Array.from({ length: total }, (_, i) => card(i + 1));
  const source: LibrarySource = {
    async browse(_caller, _orgId, input) {
      calls.push(input);
      const start =
        input.after === null
          ? 0
          : rows.findIndex((r) => r.card.libraryItemVersionId === input.after?.id) + 1;
      return rows.slice(start, start + input.limit);
    },
  };
  return { source, calls };
};

const fakeLimiter = (allow: number) => {
  const keys: string[] = [];
  const limiter: LibraryLimiter = {
    async limit({ key }) {
      keys.push(key);
      return { success: keys.length <= allow };
    },
  };
  return { limiter, keys };
};

const setup = (
  opts: {
    total?: number;
    allow?: number;
    noLimiter?: boolean;
    noSource?: boolean;
    roles?: string[];
  } = {},
) => {
  const db = a2aDb(opts.roles === undefined ? {} : { roles: opts.roles });
  const { source, calls } = fakeSource(opts.total ?? 3);
  const { limiter, keys } = fakeLimiter(opts.allow ?? 100);
  const { call } = harness(
    (org) =>
      createLibraryRoutes({
        org,
        source: () => (opts.noSource === true ? null : source),
        limiter: () => (opts.noLimiter === true ? null : limiter),
      }),
    db,
    callerOf(),
  );
  return { db, call, calls, keys };
};

describe('GET …/library/items', () => {
  it('answers keyless cards and spends one token of the caller budget', async () => {
    const { call, calls, keys } = setup();
    const res = await call('GET', '/library/items?skillKey=verbal&format=mcq&difficultyMin=0.2');
    expect(res.status).toBe(200);
    const body = LibraryBrowseResponse.parse(await res.json());
    expect(body.items).toHaveLength(3);
    expect(body.nextCursor).toBeNull();
    for (const item of body.items)
      expect(Object.keys(LibraryItemCard.parse(item))).not.toContain('key');
    expect(keys).toEqual([USER]);
    expect(calls[0]).toMatchObject({
      skillKey: 'verbal',
      format: 'mcq',
      difficultyMin: 0.2,
      after: null,
      limit: 51,
    });
  });

  it('pages by the exact created_at text of the last card (R5-57 b)', async () => {
    const { call, calls } = setup({ total: 51 });
    const first = LibraryBrowseResponse.parse(await (await call('GET', '/library/items')).json());
    expect(first.items).toHaveLength(50);
    const cursor = decodePageCursor(String(first.nextCursor));
    expect(cursor).toEqual({
      createdAt: card(50).createdAt,
      id: card(50).card.libraryItemVersionId,
    });
    const second = LibraryBrowseResponse.parse(
      await (await call('GET', `/library/items?cursor=${String(first.nextCursor)}`)).json(),
    );
    expect(second.items).toHaveLength(1);
    expect(calls[1]?.after).toEqual(cursor);
  });

  it('answers 503 before any read when no limiter is bound, and 429 when the budget is spent', async () => {
    const unbound = setup({ noLimiter: true });
    const res = await unbound.call('GET', '/library/items');
    expect(res.status).toBe(503);
    expect(unbound.calls).toEqual([]);
    expect(unbound.db.calls).toEqual([]);
    const spent = setup({ allow: 0 });
    const r2 = await spent.call('GET', '/library/items');
    expect(r2.status).toBe(429);
    expect(await codeOf(r2)).toBe('rate_limited');
    expect(spent.calls).toEqual([]);
  });

  it('answers 503 without a library source, 400 for a bad query, 404 for a reviewer', async () => {
    expect((await setup({ noSource: true }).call('GET', '/library/items')).status).toBe(503);
    expect((await setup().call('GET', '/library/items?difficultyMin=2')).status).toBe(400);
    expect((await setup({ roles: ['reviewer'] }).call('GET', '/library/items')).status).toBe(404);
  });
});

describe('POST …/library/copy', () => {
  const libItem = (db: ReturnType<typeof a2aDb>) =>
    seedVersion(db, { org_id: LIBRARY_ORG, workspace_id: 'b1000000-0000-4000-8000-00000000000f' });

  it('copies approved library versions into the default workspace and answers the local ids', async () => {
    const { db, call } = setup();
    const a = libItem(db);
    const b = libItem(db);
    const res = await call('POST', '/library/copy', { libraryItemVersionIds: [a.id, b.id] });
    expect(res.status).toBe(200);
    const body = LibraryCopyResponse.parse(await res.json());
    expect(body.itemVersionIds).toHaveLength(2);
    expect(db.tables.library_copy_requests?.[0]).toMatchObject({
      org_id: ORG,
      workspace_id: WS,
    });
    // A re-copy hands back the same local ids (the guard reuses copies, R3-8).
    const again = LibraryCopyResponse.parse(
      await (await call('POST', '/library/copy', { libraryItemVersionIds: [a.id] })).json(),
    );
    expect(again.itemVersionIds).toEqual([body.itemVersionIds[0]]);
  });

  it('copies into a named workspace', async () => {
    const { db, call } = setup();
    const a = libItem(db);
    await call('POST', '/library/copy', { libraryItemVersionIds: [a.id], workspaceId: WS2 });
    expect(db.tables.library_copy_requests?.[0]?.workspace_id).toBe(WS2);
  });

  it('answers 409 for a library item that is not approved and 429 library_cap at the daily cap (E8)', async () => {
    const { db, call } = setup();
    const a = libItem(db);
    a.status = 'retired';
    const res = await call('POST', '/library/copy', { libraryItemVersionIds: [a.id] });
    expect(res.status).toBe(409);
    db.failNext('insert', 'library_copy_requests', new RestError(403, '42501', 'library_cap'));
    const capped = await call('POST', '/library/copy', { libraryItemVersionIds: [a.id] });
    expect(capped.status).toBe(429);
    expect(await codeOf(capped)).toBe('library_cap');
  });
});
