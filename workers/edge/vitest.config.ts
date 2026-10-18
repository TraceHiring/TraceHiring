import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { baseTest } from '@trace/config/vitest';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd with this Worker's wrangler.jsonc (spec §4, §14 S1), in two pools:
// - `edge`: the top level of wrangler.jsonc, bound to nothing but the VERSION var. Every test except the real-DO ones.
// - `edge-do`: the same config plus local miniflare bindings, so `*.real.test.ts` run the real SessionDO and
//   InviteOtpDO classes (C1a SR-6, C1b need 2). The bindings live only here, in miniflare options: no wrangler file
//   and no env block holds them, so nothing deployable or generated (`wrangler types`, worker-configuration.d.ts)
//   changes, and wrangler can never deploy this pool. Buckets and the queue are miniflare's local, in-memory ones;
//   no secret, no TRACE_ENV and no service binding (the DOs never call API).
// no-error-reporter.test.ts runs in both pools and asserts each pool's exact binding set (security review F1).
const wrangler = { configPath: './wrangler.jsonc' };
const REAL_DO_TESTS = 'src/**/*.real.test.ts';
const BINDING_SET_TEST = 'src/no-error-reporter.test.ts';

export default defineConfig({
  test: {
    passWithNoTests: false,
    projects: [
      {
        plugins: [cloudflareTest({ wrangler })],
        test: {
          ...baseTest,
          name: 'edge',
          exclude: [...(baseTest?.exclude ?? []), REAL_DO_TESTS],
          provide: { bindingPool: 'top' },
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler,
            miniflare: {
              bindings: { MIRROR_TRANSPORT: 'queue' },
              durableObjects: {
                SESSION: { className: 'SessionDO', useSQLite: true },
                OTP: { className: 'InviteOtpDO', useSQLite: true },
              },
              r2Buckets: { PACKAGES: 'test-packages', EVIDENCE: 'test-evidence' },
              queueProducers: { MIRROR_QUEUE: { queueName: 'test-session-mirror' } },
            },
          }),
        ],
        test: {
          ...baseTest,
          name: 'edge-do',
          include: [REAL_DO_TESTS, BINDING_SET_TEST],
          provide: { bindingPool: 'do' },
        },
      },
    ],
  },
});
