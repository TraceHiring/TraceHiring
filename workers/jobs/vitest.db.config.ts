import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Real-database tests of the jobs stages (db-test/*.db.test.ts): plain Node, one file at a time, against the shared
// local Supabase database. Run from workers/jobs: `npx vitest run -c vitest.db.config.ts`. The database URL is read
// by db-test/harness.ts at run time, never here.
export default defineConfig({
  // Production stage code imports cloudflare:sockets as its default transport; the tests inject a Node socket.
  resolve: {
    alias: {
      'cloudflare:sockets': fileURLToPath(
        new URL('./db-test/cloudflare-sockets-stub.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['db-test/**/*.db.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    passWithNoTests: false,
  },
});
