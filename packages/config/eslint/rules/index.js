// Local ESLint plugin `trace` with Trace's custom rules (spec specs/m0-foundations.md §10.1).
import logEventLiteral from './log-event-literal.js';
import staticModulePaths from './static-module-paths.js';
import viteConfigEnv from './vite-config-env.js';

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: { name: 'trace' },
  rules: {
    'log-event-literal': logEventLiteral,
    'static-module-paths': staticModulePaths,
    'vite-config-env': viteConfigEnv,
  },
};

export default plugin;
