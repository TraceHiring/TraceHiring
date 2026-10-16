import { randomBytes } from 'node:crypto';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Two projects, both inside workerd (nodejs_compat is the platform default from compatibility_date 2026-08-04):
// - d4: DC-D4 crypto checks (no bindings).
// - d5: DC-D5 media link Worker with R2 + SQLite Durable Object bindings. The HMAC key is generated at run time and
//   handed to the Worker as a miniflare binding; it is never written to a file or printed.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [cloudflareTest({ wrangler: { configPath: './workers/test.wrangler.jsonc' } })],
        test: { name: 'd4', include: ['test/d4.test.ts'] },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './workers/media-link/wrangler.jsonc' },
            miniflare: {
              bindings: {
                MEDIA_LINK_HMAC_KEY: randomBytes(32).toString('base64'),
                SPIKE_ROUTES: '1',
                ALLOWED_ORIGINS: 'https://recruiter.synthetic.example',
              },
            },
          }),
        ],
        test: { name: 'd5', include: ['test/media-link.test.ts'] },
      },
    ],
  },
});
