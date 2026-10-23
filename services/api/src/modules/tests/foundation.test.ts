// The shared org-module foundation of M1 (spec m1 R5-56 f, R5-53 d, R5-54 a, R5-60 e): the PostgREST `rpc` call, the
// guard-message error mapping (a constant key from a closed table, never the SQL text), keyset pages on the exact
// `created_at` text the database returns, per-route body caps, and a JSON body reader that refuses prototype keys.
// Synthetic data only.
import { decodePageCursor, encodePageCursor, PageCursor } from '@trace/shared/contracts/m1';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { answer, BODY_CAPS, MAX_ORG_BODY_BYTES, noContent, readJson, readQuery } from './http.js';
import {
  createRest,
  guardKeyOf,
  isSnapshotConflict,
  OrgError,
  restErrorCode,
  RestError,
} from './org-context.js';
import { fakeDb } from './rest.test-helpers.js';
import { cursorOf, keysetQuery, PAGE_SIZE, pageOf } from './rest-keyset.js';

const SUPA = 'http://127.0.0.1:54321';
const USER = '0f000000-0000-4000-8000-000000000001';
const caller = { userId: USER, aal: 'aal2' as const, amr: [], jwt: 'h.p.s' };

const failOf = async (p: Promise<unknown>): Promise<unknown> => {
  try {
    await p;
  } catch (err) {
    return err;
  }
  throw new Error('expected a failure');
};

describe('createRest().rpc', () => {
  it('POSTs the named arguments to /rest/v1/rpc/<fn> as the caller and returns the JSON value', async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return Response.json({ sections: 2, items: 3 });
    }) as unknown as typeof fetch;
    const rest = createRest(
      { supabaseUrl: `${SUPA}/`, publishableKey: 'sb_publishable_test', fetch: fakeFetch },
      caller,
    );
    const out = await rest.rpc('save_test_draft', { p_test_version: 'x', p_payload: { a: 1 } });
    expect(out).toEqual({ sections: 2, items: 3 });
    expect(seen[0]?.url).toBe(`${SUPA}/rest/v1/rpc/save_test_draft`);
    expect(seen[0]?.init?.method).toBe('POST');
    const headers = seen[0]?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer h.p.s');
    expect(headers.apikey).toBe('sb_publishable_test');
    expect(headers['content-type']).toBe('application/json');
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({
      p_test_version: 'x',
      p_payload: { a: 1 },
    });
  });

  it('refuses a function name outside [a-z_] before any fetch', async () => {
    let fetched = 0;
    const rest = createRest(
      {
        supabaseUrl: SUPA,
        publishableKey: 'k',
        fetch: (async () => {
          fetched += 1;
          return Response.json(null);
        }) as unknown as typeof fetch,
      },
      caller,
    );
    for (const name of ['../tests', 'Save', 'save-draft', '', 'a'.repeat(65)]) {
      expect(await failOf(rest.rpc(name, {}))).toBeInstanceOf(RestError);
    }
    expect(fetched).toBe(0);
  });

  it('a guard refusal keeps the SQLSTATE and a constant guard key, never the message text', async () => {
    const message = 'TRACE_GUARD: the package was built from another snapshot';
    const rest = createRest(
      {
        supabaseUrl: SUPA,
        publishableKey: 'k',
        fetch: (async () =>
          Response.json(
            { code: '40001', message, details: null, hint: null },
            { status: 409 },
          )) as unknown as typeof fetch,
      },
      caller,
    );
    const err = await failOf(rest.rpc('save_test_draft', {}));
    expect(err).toBeInstanceOf(RestError);
    const e = err as RestError;
    expect(e.sqlstate).toBe('40001');
    expect(e.guard).toBe('snapshot_changed');
    expect(e.message).toBe('rest_failed');
    expect(JSON.stringify(e)).not.toContain('snapshot');
    expect(Object.values(e).join(' ')).not.toContain('TRACE_GUARD');
    expect(isSnapshotConflict(e)).toBe(true);
  });

  it('a failure with no JSON body is a RestError with neither SQLSTATE nor guard', async () => {
    const rest = createRest(
      {
        supabaseUrl: SUPA,
        publishableKey: 'k',
        fetch: (async () => new Response('down', { status: 502 })) as unknown as typeof fetch,
      },
      caller,
    );
    const err = (await failOf(rest.rpc('save_test_draft', {}))) as RestError;
    expect([err.status, err.sqlstate, err.guard]).toEqual([502, null, null]);
    expect(restErrorCode(err)).toBe('unavailable');
  });
});

describe('guardKeyOf and restErrorCode', () => {
  it('maps the constant guard texts the api reacts to, and nothing else', () => {
    expect(guardKeyOf('TRACE_GUARD: the package was built from another snapshot')).toBe(
      'snapshot_changed',
    );
    expect(guardKeyOf('TRACE_GUARD: a published test version is frozen')).toBe('version_frozen');
    expect(guardKeyOf('TRACE_GUARD: setting locked by admin')).toBe('setting_locked');
    expect(guardKeyOf('TRACE_GUARD: settings required while admin locks exist')).toBe(
      'settings_required',
    );
    expect(
      guardKeyOf('TRACE_GUARD: the pool has fewer approved items than the section draws'),
    ).toBe('pool_too_small');
    expect(guardKeyOf('TRACE_GUARD: a version holds at most 5,000 items')).toBe(
      'package_too_large',
    );
    expect(guardKeyOf('TRACE_GUARD: library copy cap reached')).toBe('library_cap');
    // An unknown guard is "other"; a non-guard message, or one that merely contains the prefix, is null.
    expect(guardKeyOf('TRACE_GUARD: something new')).toBe('other');
    expect(guardKeyOf('permission denied for table tests')).toBeNull();
    expect(guardKeyOf('x TRACE_GUARD: setting locked by admin')).toBeNull();
    expect(guardKeyOf(undefined)).toBeNull();
    expect(guardKeyOf(42)).toBeNull();
  });

  it('40001 is a snapshot conflict only with the snapshot guard text (R5-60 e)', () => {
    expect(isSnapshotConflict(new RestError(409, '40001', 'snapshot_changed'))).toBe(true);
    expect(isSnapshotConflict(new RestError(409, '40001', null))).toBe(false);
    expect(isSnapshotConflict(new RestError(409, '40001', 'other'))).toBe(false);
    expect(isSnapshotConflict(new RestError(403, '42501', 'snapshot_changed'))).toBe(false);
    expect(isSnapshotConflict(new Error('x'))).toBe(false);
  });

  it('maps guard keys to stable api codes before the SQLSTATE fallback', () => {
    expect(restErrorCode(new RestError(403, '42501', 'setting_locked'))).toBe('setting_locked');
    expect(restErrorCode(new RestError(403, '42501', 'settings_required'))).toBe('setting_locked');
    expect(restErrorCode(new RestError(403, '42501', 'version_frozen'))).toBe('conflict');
    expect(restErrorCode(new RestError(403, '42501', 'pool_too_small'))).toBe('pool_too_small');
    expect(restErrorCode(new RestError(403, '42501', 'package_too_large'))).toBe(
      'package_too_large',
    );
    expect(restErrorCode(new RestError(403, '42501', 'library_cap'))).toBe('library_cap');
    expect(restErrorCode(new RestError(409, '40001', 'snapshot_changed'))).toBe('conflict');
    // D1 behaviour is unchanged for everything else.
    expect(restErrorCode(new RestError(403, '42501', 'other'))).toBe('not_found');
    expect(restErrorCode(new RestError(403, '42501'))).toBe('not_found');
    expect(restErrorCode(new RestError(409, '23505'))).toBe('conflict');
    expect(restErrorCode(new RestError(400, '23514'))).toBe('bad_request');
    expect(restErrorCode(new OrgError('cutoff_required'))).toBe('cutoff_required');
  });
});

describe('keyset pages on the PageCursor (R5-54 a)', () => {
  const T = '2026-10-23T05:00:00.123456+00:00';
  const ID = 'e1000000-0000-4000-8000-000000000001';

  it('asks for one row past the page, ordered by (created_at, id) in the page direction', () => {
    expect(keysetQuery(null, 'asc')).toEqual({
      order: 'created_at.asc,id.asc',
      limit: String(PAGE_SIZE + 1),
    });
    expect(keysetQuery({ createdAt: T, id: ID }, 'asc')).toEqual({
      or: `(created_at.gt."${T}",and(created_at.eq."${T}",id.gt.${ID}))`,
      order: 'created_at.asc,id.asc',
      limit: String(PAGE_SIZE + 1),
    });
    expect(keysetQuery({ createdAt: T, id: ID }, 'desc')).toEqual({
      or: `(created_at.lt."${T}",and(created_at.eq."${T}",id.lt.${ID}))`,
      order: 'created_at.desc,id.desc',
      limit: String(PAGE_SIZE + 1),
    });
  });

  it('refuses a cursor whose parts do not parse (never built into a filter)', () => {
    expect(() => keysetQuery({ createdAt: 'x"),or(', id: ID }, 'asc')).toThrow(OrgError);
    expect(() => keysetQuery({ createdAt: T, id: 'not-a-uuid' }, 'asc')).toThrow(OrgError);
  });

  it('cuts the page and builds the next cursor from the exact created_at text (microseconds kept)', () => {
    const rows = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => ({
      id: `e1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      created_at: `2026-10-23T05:00:00.${String(100001 + i)}+00:00`,
    }));
    const page = pageOf(rows);
    expect(page.rows).toHaveLength(PAGE_SIZE);
    const last = rows[PAGE_SIZE - 1];
    expect(page.nextCursor).not.toBeNull();
    const decoded = decodePageCursor(page.nextCursor ?? '');
    expect(decoded).toEqual({ createdAt: last?.created_at, id: last?.id });
    expect(pageOf(rows.slice(0, PAGE_SIZE)).nextCursor).toBeNull();
    expect(pageOf([]).nextCursor).toBeNull();
  });

  it('decodes a query cursor to its keyset; a malformed one is 400', () => {
    const text = encodePageCursor(PageCursor.parse({ createdAt: T, id: ID }));
    expect(cursorOf(text)).toEqual({ createdAt: T, id: ID });
    expect(cursorOf(undefined)).toBeNull();
    expect(() => cursorOf('bm90LWEtY3Vyc29y')).toThrow(OrgError);
  });

  it('the fake PostgREST applies the keyset filter the way PostgREST does', async () => {
    const rows = [
      { id: 'e1000000-0000-4000-8000-000000000001', created_at: T },
      { id: 'e1000000-0000-4000-8000-000000000002', created_at: T },
      {
        id: 'e1000000-0000-4000-8000-000000000003',
        created_at: '2026-10-23T05:00:00.123457+00:00',
      },
      {
        id: 'e1000000-0000-4000-8000-000000000004',
        created_at: '2026-10-23T05:00:00.123455+00:00',
      },
    ];
    const db = fakeDb({ things: rows });
    const after = await db.rest.select('things', {
      select: 'id',
      ...keysetQuery({ createdAt: T, id: 'e1000000-0000-4000-8000-000000000001' }, 'asc'),
    });
    expect(after.map((r) => r.id)).toEqual([
      'e1000000-0000-4000-8000-000000000002',
      'e1000000-0000-4000-8000-000000000003',
    ]);
    const before = await db.rest.select('things', {
      select: 'id',
      ...keysetQuery({ createdAt: T, id: 'e1000000-0000-4000-8000-000000000002' }, 'desc'),
    });
    expect(before.map((r) => r.id)).toEqual([
      'e1000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000004',
    ]);
  });
});

const req = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request('https://api.test/x', { method: 'POST', body, headers });

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof OrgError ? err.code : 'thrown';
  }
};

describe('readJson', () => {
  it('parses a JSON body under the default cap', async () => {
    expect(await readJson(req('{"a":[1,{"b":"c"}]}'))).toEqual({ a: [1, { b: 'c' }] });
    expect(MAX_ORG_BODY_BYTES).toBe(256 * 1024);
  });

  it('refuses __proto__, constructor and prototype keys at any depth (400)', async () => {
    for (const text of [
      '{"__proto__":{"admin":true}}',
      '{"a":{"constructor":{"prototype":1}}}',
      '{"a":[{"prototype":1}]}',
      '[{"b":{"__proto__":null}}]',
    ]) {
      expect(await codeOf(readJson(req(text)))).toBe('bad_request');
    }
    // The words as values are fine.
    expect(await readJson(req('{"a":"__proto__","b":["constructor"]}'))).toEqual({
      a: '__proto__',
      b: ['constructor'],
    });
  });

  it('refuses a body over the cap, declared or streamed without a length (400)', async () => {
    const big = `"${'x'.repeat(2000)}"`;
    expect(await codeOf(readJson(req(big), 1000))).toBe('bad_request');
    expect(await codeOf(readJson(req(big, { 'content-length': '999999999999' }), 1000))).toBe(
      'bad_request',
    );
    const chunks = [
      new TextEncoder().encode(`"${'y'.repeat(600)}`),
      new TextEncoder().encode(`${'y'.repeat(600)}"`),
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });
    expect(
      await codeOf(
        readJson(
          new Request('https://api.test/x', {
            method: 'POST',
            body: stream,
            duplex: 'half',
          } as RequestInit),
          1000,
        ),
      ),
    ).toBe('bad_request');
    expect(await codeOf(readJson(req('not json')))).toBe('bad_request');
    expect(await codeOf(readJson(req('')))).toBe('bad_request');
  });

  it('per-route caps admit the largest valid draft and import batch (R5-53 d)', async () => {
    expect(BODY_CAPS.saveTestDraft).toBeGreaterThan(MAX_ORG_BODY_BYTES);
    expect(BODY_CAPS.importRows).toBeGreaterThan(MAX_ORG_BODY_BYTES);
    expect(BODY_CAPS.default).toBe(MAX_ORG_BODY_BYTES);
    // About 1 MB of JSON: over the default cap, under the draft cap.
    const body = JSON.stringify({ items: Array.from({ length: 250 }, () => 'z'.repeat(4000)) });
    expect(await codeOf(readJson(req(body)))).toBe('bad_request');
    expect(await readJson(req(body), BODY_CAPS.saveTestDraft)).toEqual(JSON.parse(body));
  });
});

describe('readQuery, answer and noContent', () => {
  const Q = z.strictObject({
    cursor: z.string().max(10).optional(),
    format: z.enum(['mcq']).optional(),
  });

  it('parses each query key once with a strict schema; a repeated or unknown key is 400', () => {
    expect(readQuery('https://api.test/x?format=mcq', Q)).toEqual({ format: 'mcq' });
    expect(readQuery('https://api.test/x', Q)).toEqual({});
    expect(() => readQuery('https://api.test/x?format=mcq&format=mcq', Q)).toThrow(OrgError);
    expect(() => readQuery('https://api.test/x?other=1', Q)).toThrow(OrgError);
    expect(() => readQuery('https://api.test/x?format=written', Q)).toThrow(OrgError);
  });

  it('answer parses the body with its contract (a misfit is 503, never echoed); noContent is an empty 204', async () => {
    const S = z.strictObject({ a: z.int() });
    const ok = answer(S, { a: 1 }, 201);
    expect(ok.status).toBe(201);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(await ok.json()).toEqual({ a: 1 });
    expect(() => answer(S, { a: 'secret-value' })).toThrow(OrgError);
    const none = noContent();
    expect(none.status).toBe(204);
    expect(await none.text()).toBe('');
    expect(none.headers.get('cache-control')).toBe('no-store');
  });
});
