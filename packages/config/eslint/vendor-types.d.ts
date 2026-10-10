// eslint-plugin-jsx-a11y 6.10.2 ships no type declarations; this covers the part the config uses.
declare module 'eslint-plugin-jsx-a11y' {
  import type { ESLint, Linter } from 'eslint';

  const plugin: ESLint.Plugin & {
    flatConfigs: { recommended: Linter.Config; strict: Linter.Config };
  };
  export default plugin;
}
