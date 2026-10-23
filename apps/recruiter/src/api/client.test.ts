// The api client: bearer token, constant error codes, every response parsed with its contract.
import { ReportMetaResponse } from '@trace/shared/contracts/d1';
import { ImportImagePutResponse } from '@trace/shared/contracts/m1';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient, type FetchLike } from './client';

const ORG = '11111111-1111-4111-8111-111111111111';
const ORIGIN = 'https://trace-api-staging.example-sub.workers.dev';
const META = {
  report: {
    id: '22222222-2222-4222-8222-222222222222',
    label: 'Candidate 1',
    testName: 'Synthetic test',
    testVersion: 1,
    submittedAt: '2026-10-19T10:00:00.000Z',
    receiptRefPrefix: 'ABCD1234',
    noticeHashPrefix: 'a1b2c3d4',
  },
  versions: { quality: null, integrity: { rulesetVersion: 'd1-v1' } },
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function client(fetchImpl: FetchLike, token: string | null = 'tok-synthetic') {
  return new ApiClient({
    origin: ORIGIN,
    orgId: ORG,
    getAccessToken: () => Promise.resolve(token),
    fetch: fetchImpl,
  });
}

describe('ApiClient', () => {
  it('sends the bearer token to the org path and parses with the given contract', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const api = client((url, init) => {
      calls.push({ url, init });
      return Promise.resolve(json(META));
    });
    const res = await api.call({
      method: 'GET',
      path: `/reports/${META.report.id}`,
      schema: ReportMetaResponse,
    });
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${ORIGIN}/v1/orgs/${ORG}/reports/${META.report.id}`);
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('authorization')).toBe('Bearer tok-synthetic');
    expect(calls[0]?.init.credentials).toBe('omit');
    expect(calls[0]?.init.cache).toBe('no-store');
  });

  it('a response that fails its contract is invalid_response, never raw data', async () => {
    const api = client(() => Promise.resolve(json({ ...META, extra: 'x' })));
    const res = await api.call({ method: 'GET', path: '/r', schema: ReportMetaResponse });
    expect(res).toEqual({ ok: false, code: 'invalid_response' });
  });

  it('maps an api error body to its constant code and anything else to unavailable', async () => {
    const coded = client(() => Promise.resolve(json({ error: { code: 'aal2_required' } }, 403)));
    expect(await coded.call({ method: 'GET', path: '/r', schema: ReportMetaResponse })).toEqual({
      ok: false,
      code: 'aal2_required',
    });
    const odd = client(() => Promise.resolve(new Response('<html>boom</html>', { status: 502 })));
    expect(await odd.call({ method: 'GET', path: '/r', schema: ReportMetaResponse })).toEqual({
      ok: false,
      code: 'unavailable',
    });
  });

  it('a network failure is code network, and no token means unauthorized without a request', async () => {
    const down = client(() => Promise.reject(new TypeError('failed')));
    expect(await down.call({ method: 'GET', path: '/r', schema: ReportMetaResponse })).toEqual({
      ok: false,
      code: 'network',
    });
    const spy = vi.fn<FetchLike>();
    const none = client(spy, null);
    expect(await none.call({ method: 'GET', path: '/r', schema: ReportMetaResponse })).toEqual({
      ok: false,
      code: 'unauthorized',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('sends a JSON body with a content type for writes', async () => {
    let seen: RequestInit | undefined;
    const api = client((_url, init) => {
      seen = init;
      return Promise.resolve(json(META));
    });
    await api.call({ method: 'POST', path: '/x', schema: ReportMetaResponse, body: { a: 1 } });
    expect(seen?.method).toBe('POST');
    expect(seen?.body).toBe('{"a":1}');
    expect(new Headers(seen?.headers).get('content-type')).toBe('application/json');
  });
});

describe('ApiClient.fetchImageBytes (start photo)', () => {
  const link = `${ORIGIN}/media/00000000-0000-4000-8000-000000000001?exp=1&sig=abc`;
  it('fetches once from the api origin without credentials or referrer', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const api = client((url, init) => {
      calls.push({ url, init });
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }),
      );
    });
    const res = await api.fetchImageBytes(link);
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBeNull();
    expect(calls[0]?.init.credentials).toBe('omit');
    expect(calls[0]?.init.referrerPolicy).toBe('no-referrer');
  });

  it('refuses a link on another origin without any request', async () => {
    const spy = vi.fn<FetchLike>();
    const res = await client(spy).fetchImageBytes('https://evil.example.test/media/x?exp=1&sig=a');
    expect(res).toEqual({ ok: false, code: 'unavailable' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('a non-image or failed response yields no bytes', async () => {
    const wrongType = client(() =>
      Promise.resolve(new Response('x', { headers: { 'content-type': 'text/html' } })),
    );
    expect(await wrongType.fetchImageBytes(link)).toEqual({ ok: false, code: 'unavailable' });
    const gone = client(() => Promise.resolve(json({ error: { code: 'not_found' } }, 404)));
    expect(await gone.fetchImageBytes(link)).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('ApiClient.putImage (import images, R5-18)', () => {
  const PATH = '/imports/22222222-2222-4222-8222-222222222222/images/' + 'a'.repeat(64);
  const STORED = { key: `item-media/${ORG}/${'a'.repeat(64)}.png` };
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const base = { path: PATH, schema: ImportImagePutResponse, contentType: 'image/png' } as const;

  it('PUTs the raw bytes with the explicit content type through the same fetch and auth', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const api = client((url, init) => {
      calls.push({ url, init });
      return Promise.resolve(json(STORED, 200));
    });
    const res = await api.putImage({ ...base, bytes: PNG });
    expect(res).toEqual({ ok: true, data: STORED });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${ORIGIN}/v1/orgs/${ORG}${PATH}`);
    expect(calls[0]?.init.method).toBe('PUT');
    expect(calls[0]?.init.body).toBe(PNG);
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('content-type')).toBe('image/png');
    expect(headers.get('authorization')).toBe('Bearer tok-synthetic');
    expect(headers.get('accept')).toBe('application/json');
    expect(calls[0]?.init.credentials).toBe('omit');
    expect(calls[0]?.init.cache).toBe('no-store');
  });

  it.each(['image/png', 'image/jpeg', 'image/webp'] as const)('accepts %s', async (contentType) => {
    let seen: RequestInit | undefined;
    const api = client((_url, init) => {
      seen = init;
      return Promise.resolve(json(STORED));
    });
    const res = await api.putImage({ ...base, contentType, bytes: PNG });
    expect(res.ok).toBe(true);
    expect(new Headers(seen?.headers).get('content-type')).toBe(contentType);
  });

  it.each([
    'image/gif',
    'image/svg+xml',
    'application/json',
    'application/octet-stream',
    'text/html',
    'IMAGE/PNG',
    'image/png; charset=binary',
    '',
  ])('refuses %j without any request', async (contentType) => {
    const spy = vi.fn<FetchLike>();
    const res = await client(spy).putImage({
      ...base,
      contentType: contentType as 'image/png',
      bytes: PNG,
    });
    expect(res).toEqual({ ok: false, code: 'bad_request' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses an empty body and a body over 1 MiB without any request', async () => {
    const spy = vi.fn<FetchLike>();
    const api = client(spy);
    expect(await api.putImage({ ...base, bytes: new Uint8Array(0) })).toEqual({
      ok: false,
      code: 'bad_request',
    });
    expect(await api.putImage({ ...base, bytes: new Uint8Array(1_048_577) })).toEqual({
      ok: false,
      code: 'bad_request',
    });
    expect(spy).not.toHaveBeenCalled();
    // The limit itself is allowed.
    const ok = client(() => Promise.resolve(json(STORED)));
    expect((await ok.putImage({ ...base, bytes: new Uint8Array(1_048_576) })).ok).toBe(true);
  });

  it('sends a Blob body untouched and measures its size', async () => {
    let seen: RequestInit | undefined;
    const api = client((_url, init) => {
      seen = init;
      return Promise.resolve(json(STORED));
    });
    const blob = new Blob([PNG], { type: 'image/png' });
    expect((await api.putImage({ ...base, bytes: blob })).ok).toBe(true);
    expect(seen?.body).toBe(blob);
    const big = new Blob([new Uint8Array(1_048_577)]);
    expect(await api.putImage({ ...base, bytes: big })).toEqual({ ok: false, code: 'bad_request' });
  });

  it('no token means unauthorized without a request', async () => {
    const spy = vi.fn<FetchLike>();
    const res = await client(spy, null).putImage({ ...base, bytes: PNG });
    expect(res).toEqual({ ok: false, code: 'unauthorized' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('maps an api error body to its constant code, anything else to unavailable, a failure to network', async () => {
    const coded = client(() => Promise.resolve(json({ error: { code: 'image_bad_type' } }, 422)));
    expect(await coded.putImage({ ...base, bytes: PNG })).toEqual({
      ok: false,
      code: 'image_bad_type',
    });
    const odd = client(() => Promise.resolve(new Response('<html>boom</html>', { status: 502 })));
    expect(await odd.putImage({ ...base, bytes: PNG })).toEqual({
      ok: false,
      code: 'unavailable',
    });
    const down = client(() => Promise.reject(new TypeError('failed')));
    expect(await down.putImage({ ...base, bytes: PNG })).toEqual({ ok: false, code: 'network' });
  });

  it('a response that fails its contract is invalid_response', async () => {
    const api = client(() => Promise.resolve(json({ key: 'not-a-key' })));
    expect(await api.putImage({ ...base, bytes: PNG })).toEqual({
      ok: false,
      code: 'invalid_response',
    });
  });
});

describe('ApiClient.call with an empty answer', () => {
  it('a 204 with no body parses with a schema that accepts only nothing', async () => {
    const api = client(() => Promise.resolve(new Response(null, { status: 204 })));
    const nothing = {
      safeParse: (data: unknown) =>
        data === undefined
          ? { success: true as const, data: undefined }
          : { success: false as const },
    };
    expect(await api.call({ method: 'DELETE', path: '/x', schema: nothing })).toEqual({
      ok: true,
      data: undefined,
    });
  });
});
