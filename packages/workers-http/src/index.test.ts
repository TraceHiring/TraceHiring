// @trace/workers-http (specs/m0b-tenancy.md §1.1 item 9b). The skeleton's one shared piece; stream B5
// moves the rest of the Workers' error and 404 handling here with its tests.
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
