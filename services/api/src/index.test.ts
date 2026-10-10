// Smoke test, run inside the Workers runtime by @cloudflare/vitest-pool-workers (spec §14 S1).
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('api placeholder', () => {
  it('answers every request with 404', async () => {
    const response = await exports.default.fetch('https://api.test/anything');

    expect(response.status).toBe(404);
  });
});
