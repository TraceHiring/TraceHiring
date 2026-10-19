import { defineConfig } from 'vitest/config';

// Real-database tests of the jobs stages (db-test/*.db.test.ts): plain Node, one file at a time, against the shared
// local Supabase database. Run from workers/jobs: `npx vitest run -c vitest.db.config.ts`. The database URL is read
// by db-test/harness.ts at run time, never here.
export default defineConfig({
  test: {
    include: ['db-test/**/*.db.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    passWithNoTests: false,
  },
});
