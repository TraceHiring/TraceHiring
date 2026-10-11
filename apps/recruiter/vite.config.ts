import { forbidServerImports } from '@trace/config/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Same pattern as `Version` in @trace/shared/contracts (spec §9.4). It is repeated here because a
// tooling config may import only @trace/config (spec §10.1); version-file.test.ts keeps them in step.
const VERSION = /^[0-9a-f]{7,40}$|^dev$/;

/**
 * Emits dist/version.json as { app, version } (`AppVersionFile`, spec §9.3, §9.4).
 * The version is VITE_APP_VERSION when it is a commit SHA, else "dev". It is read from Vite's
 * resolved env, because the `vite-config-env` lint rule bars `process`, `fs` and `loadEnv` here.
 */
export function versionFilePlugin(app: 'recruiter'): Plugin {
  let version = 'dev';
  return {
    name: 'trace:version-file',
    configResolved(config) {
      const value: unknown = config.env['VITE_APP_VERSION'];
      version = typeof value === 'string' && VERSION.test(value) ? value : 'dev';
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ app, version })}\n`,
      });
    },
  };
}

// No `define` that reads process.env, and envPrefix stays the default `VITE_` (spec §10.1).
export default defineConfig({
  plugins: [forbidServerImports(), react(), versionFilePlugin('recruiter')],
});
