import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { baseTest } from '@trace/config/vitest';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd with this Worker's wrangler.jsonc (spec §4, §14 S1), in two pools:
// - `api`: the top level of wrangler.jsonc (public vars only). Every test except the real-DO ones.
// - `api-do`: the same config plus local miniflare bindings, so `*.real.test.ts` run the real DemoOutboxDO and
//   MediaLinkDO classes (C1a SR-6). The bindings live only here, in miniflare options: no wrangler file and no env
//   block holds them, so nothing deployable or generated (`wrangler types`, worker-configuration.d.ts) changes, and
//   wrangler can never deploy this pool. Neither class reads env, so nothing else is bound: no secret, no TRACE_ENV,
//   no bucket and no service binding.
const wrangler = { configPath: './wrangler.jsonc' };
const REAL_DO_TESTS = 'src/**/*.real.test.ts';

export default defineConfig({
  test: {
    passWithNoTests: false,
    projects: [
      {
        plugins: [cloudflareTest({ wrangler })],
        test: {
          ...baseTest,
          name: 'api',
          exclude: [...(baseTest?.exclude ?? []), REAL_DO_TESTS],
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler,
            miniflare: {
              durableObjects: {
                OUTBOX: { className: 'DemoOutboxDO', useSQLite: true },
                MEDIA_LINKS: { className: 'MediaLinkDO', useSQLite: true },
              },
            },
          }),
        ],
        // The first call to an object in a file imports the api main module (Sentry, postgres, every route); cold,
        // as in CI, that took more than the default 5 s on this machine.
        test: { ...baseTest, name: 'api-do', include: [REAL_DO_TESTS], testTimeout: 30_000 },
      },
    ],
  },
});
