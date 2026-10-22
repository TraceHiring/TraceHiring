import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { baseTest } from '@trace/config/vitest';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd with this Worker's wrangler.jsonc (spec §4, §14 S1).
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: { ...baseTest },
});
