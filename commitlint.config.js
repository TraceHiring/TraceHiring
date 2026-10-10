// Conventional commits for Trace (spec specs/m0-foundations.md §6, AT-7).
// Same rules as @commitlint/config-conventional, plus `wip` for checkpoint commits.
import conventional from '@commitlint/config-conventional';

const [level, applicable, types] = conventional.rules['type-enum'];

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [level, applicable, [...types, 'wip']],
  },
};
