// Vitest config for the repo scripts (`vitest run --root scripts`, spec §5).
// Default include patterns are kept on purpose, so every `scripts/test/*.test.mjs` is picked up.
// The tests create throwaway git repositories and run git, sh and gitleaks, which is slow on
// Windows, hence the longer timeouts.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
