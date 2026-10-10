// trace/vite-config-env (spec specs/m0-foundations.md §10.1). Applied to Vite config files only.
// - `define` may not read `process.env` (directly, through local variables or destructuring) or call
//   `loadEnv`, because whatever `define` reads is inlined into the public browser bundle.
// - `envPrefix`, if set, must be exactly the string literal 'VITE_', so only VITE_* variables reach the client.

/** @typedef {import('eslint').Rule.Node} Node */
/** @typedef {import('eslint').Scope.Scope} Scope */

/**
 * Static key name of an object property, or null.
 * @param {Node} node
 * @returns {string | null}
 */
function propertyName(node) {
  if (node.type !== 'Property' || node.computed) return null;
  if (node.key.type === 'Identifier') return node.key.name;
  if (node.key.type === 'Literal' && typeof node.key.value === 'string') return node.key.value;
  return null;
}

/**
 * True for `process.env` and `process['env']`.
 * @param {Node} node
 */
function isProcessEnv(node) {
  if (node.type !== 'MemberExpression') return false;
  if (node.object.type !== 'Identifier' || node.object.name !== 'process') return false;
  const prop = node.property;
  return node.computed
    ? prop.type === 'Literal' && prop.value === 'env'
    : prop.type === 'Identifier' && prop.name === 'env';
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "In vite.config, `define` may not read process.env and `envPrefix` must be 'VITE_'.",
    },
    schema: [],
    messages: {
      defineReadsEnv:
        '`define` may not read process.env or loadEnv(): its values are inlined into the public bundle. Use VITE_* variables via import.meta.env.',
      envPrefix: "`envPrefix` must be exactly 'VITE_'.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    /**
     * Finds the variable an identifier refers to, walking up from its scope.
     * @param {Node & { type: 'Identifier' }} id
     */
    function findVariable(id) {
      /** @type {Scope | null} */
      let scope = sourceCode.getScope(id);
      while (scope) {
        const variable = scope.set.get(id.name);
        if (variable) return variable;
        scope = scope.upper;
      }
      return null;
    }

    /**
     * True if the subtree reads process.env or calls loadEnv, following local variable initialisers.
     * @param {Node} root
     * @param {Set<unknown>} seen
     * @returns {boolean}
     */
    function readsEnv(root, seen) {
      /** @type {Node[]} */
      const stack = [root];
      while (stack.length > 0) {
        const node = /** @type {Node} */ (stack.pop());
        if (isProcessEnv(node)) return true;
        if (
          node.type === 'CallExpression' &&
          node.callee.type === 'Identifier' &&
          node.callee.name === 'loadEnv'
        ) {
          return true;
        }
        if (node.type === 'Identifier') {
          const variable = findVariable(node);
          if (variable && !seen.has(variable)) {
            seen.add(variable);
            for (const def of variable.defs) {
              if (def.type === 'Variable' && def.node.init) {
                stack.push(/** @type {Node} */ (def.node.init));
              }
            }
          }
          continue;
        }
        const keys = sourceCode.visitorKeys[node.type] ?? [];
        for (const key of keys) {
          // Static property names are labels, not reads.
          if (key === 'key' && node.type === 'Property' && !node.computed) continue;
          if (key === 'property' && node.type === 'MemberExpression' && !node.computed) continue;
          /** @type {unknown} */
          const child = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (node))[key];
          const children = Array.isArray(child) ? child : [child];
          for (const c of children) {
            if (c && typeof c === 'object' && 'type' in c) stack.push(/** @type {Node} */ (c));
          }
        }
      }
      return false;
    }

    return {
      Property(node) {
        const name = propertyName(node);
        if (name === 'define') {
          if (readsEnv(/** @type {Node} */ (node.value), new Set())) {
            context.report({ node: node.value, messageId: 'defineReadsEnv' });
          }
        } else if (name === 'envPrefix') {
          const value = node.value;
          if (!(value.type === 'Literal' && value.value === 'VITE_')) {
            context.report({ node: value, messageId: 'envPrefix' });
          }
        }
      },
    };
  },
};

export default rule;
