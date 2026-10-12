// @trace/workers-http (specs/m0b-tenancy.md §1.1 item 9b). This file covers the shared constants and
// the static 500; the error and 404 handling (createHttpApp) is tested in error-handling.test.ts.
import { describe, expect, it } from 'vitest';
import { NO_STORE, staticInternalError } from './index';

describe('staticInternalError', () => {
  it('is a 500 JSON body with no message, never cached', async () => {
    const res = staticInternalError();
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('{"error":"internal"}');
  });

  it('returns a fresh Response each time (a body can be read once)', async () => {
    const a = staticInternalError();
    const b = staticInternalError();
    expect(a).not.toBe(b);
    await a.text();
    expect(await b.text()).toBe('{"error":"internal"}');
  });
});

describe('NO_STORE', () => {
  it('is the only cache header the Workers send on JSON answers', () => {
    expect(NO_STORE).toEqual({ 'cache-control': 'no-store' });
    expect(Object.isFrozen(NO_STORE)).toBe(true);
  });
});
