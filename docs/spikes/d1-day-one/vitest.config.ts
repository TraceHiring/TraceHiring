import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// DC-D4 runs inside workerd (nodejs_compat is the platform default from compatibility_date 2026-08-04).
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './workers/test.wrangler.jsonc' } })],
  test: { include: ['test/**/*.test.ts'] },
});
