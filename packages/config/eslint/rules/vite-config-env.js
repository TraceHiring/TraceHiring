// trace/vite-config-env (spec specs/m0-foundations.md §10.1). Applied to vite.config.* and vitest.config.*.
// Whatever `define` holds is inlined into the public browser bundle, so this is an allow-list:
// - `define` is an object literal whose values are literals or `JSON.stringify(<literal>)`;
// - `envPrefix`, if set, is exactly the string literal 'VITE_';
// - the file never touches the environment or the disk: no `process` (global, `globalThis.process`,
//   `import 'node:process'`), no `loadEnv` (any import form, aliased or namespaced), no `fs`;
// - `define`/`envPrefix` are only written as plain keys of an object literal: computed keys, the
//   strings 'define'/'envPrefix' anywhere else, and assignments to `.define`/`.envPrefix` are reported.

/** @typedef {import('eslint').Rule.Node} Node */

const BANNED_MODULES = new Set([
  'process',
  'node:process',
  'fs',
  'node:fs',
  'fs/promises',
  'node:fs/promises',
]);
const GLOBAL_OBJECTS = new Set(['globalThis', 'global', 'window', 'self']);
const GUARDED_KEYS = new Set(['define', 'envPrefix']);
const TS_WRAPPERS = new Set([
  'TSNonNullExpression',
  'TSAsExpression',
  'TSTypeAssertion',
  'TSSatisfiesExpression',
]);

/**
 * Static string value of a literal or placeholder-free template, or null.
 * @param {Node | null | undefined} node
 * @returns {string | null}
 */
function staticString(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

/**
 * Name of a non-computed property key, or null.
 * @param {Node} property
 * @returns {string | null}
 */
function plainKey(property) {
  if (property.type !== 'Property' || property.computed) return null;
  if (property.key.type === 'Identifier') return property.key.name;
  return staticString(/** @type {Node} */ (property.key));
}

/**
 * True for an allowed `define` value: a literal (not a template) or JSON.stringify(<literal>).
 * @param {Node} value
 */
function isAllowedDefineValue(value) {
  if (value.type === 'Literal') return true;
  if (value.type !== 'CallExpression' || value.arguments.length !== 1) return false;
  const callee = value.callee;
  const arg = /** @type {Node} */ (value.arguments[0]);
  return (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'JSON' &&
    callee.property.type === 'Identifier' &&
    callee.property.name === 'stringify' &&
    arg.type === 'Literal'
  );
}

/**
 * True if `node` is a property key or member name, i.e. a label rather than a read.
 * @param {Node} node
 */
function isLabel(node) {
  const parent = /** @type {Node | null} */ (node.parent ?? null);
  if (parent === null) return false;
  if (parent.type === 'MemberExpression') return parent.property === node && !parent.computed;
  if (parent.type === 'Property')
    return parent.key === node && !parent.computed && !parent.shorthand;
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "Vite/Vitest config: `define` holds literals only, `envPrefix` is 'VITE_', and the environment is never read.",
    },
    schema: [],
    messages: {
      defineValue:
        '`define` must be an object literal of literals or JSON.stringify(<literal>): its values are inlined into the public bundle.',
      envPrefix: "`envPrefix` must be exactly 'VITE_'.",
      process:
        'Vite/Vitest configs may not read `process` (the environment); use VITE_* variables via import.meta.env.',
      loadEnv: 'Vite/Vitest configs may not use `loadEnv`.',
      module: "Vite/Vitest configs may not import '{{name}}'.",
      indirectKey: '`{{name}}` may only be written as a plain key of an object literal.',
      computedKey:
        'Computed keys are not allowed in Vite/Vitest configs (they can hide `define`/`envPrefix`).',
    },
  },
  create(context) {
    /**
     * @param {Node} node
     * @param {Node | null | undefined} source
     */
    function checkModule(node, source) {
      const name = staticString(source);
      if (name !== null && BANNED_MODULES.has(name)) {
        context.report({ node, messageId: 'module', data: { name } });
      }
    }

    return {
      ImportDeclaration(node) {
        checkModule(/** @type {Node} */ (node), /** @type {Node} */ (node.source));
      },
      ImportExpression(node) {
        checkModule(/** @type {Node} */ (node), /** @type {Node} */ (node.source));
      },
      ExportAllDeclaration(node) {
        checkModule(/** @type {Node} */ (node), /** @type {Node} */ (node.source));
      },
      ExportNamedDeclaration(node) {
        if (node.source) checkModule(/** @type {Node} */ (node), /** @type {Node} */ (node.source));
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          checkModule(
            /** @type {Node} */ (node),
            /** @type {Node | undefined} */ (node.arguments[0]),
          );
        }
      },
      Identifier(node) {
        const id = /** @type {Node & { type: 'Identifier' }} */ (node);
        if (id.name === 'loadEnv') {
          context.report({ node: id, messageId: 'loadEnv' });
        } else if (id.name === 'process' && !isLabel(id)) {
          context.report({ node: id, messageId: 'process' });
        }
      },
      Literal(node) {
        const value = /** @type {Node} */ (node);
        const text = staticString(value);
        if (text === null) return;
        if (text === 'loadEnv') {
          context.report({ node: value, messageId: 'loadEnv' });
          return;
        }
        if (!GUARDED_KEYS.has(text)) return;
        const parent = /** @type {Node | null} */ (value.parent ?? null);
        const isPlainKey =
          parent !== null && parent.type === 'Property' && parent.key === value && !parent.computed;
        if (!isPlainKey)
          context.report({ node: value, messageId: 'indirectKey', data: { name: text } });
      },
      TemplateLiteral(node) {
        const text = staticString(/** @type {Node} */ (node));
        if (text === 'loadEnv') {
          context.report({ node, messageId: 'loadEnv' });
        } else if (text !== null && GUARDED_KEYS.has(text)) {
          context.report({ node, messageId: 'indirectKey', data: { name: text } });
        }
      },
      MemberExpression(node) {
        const member = /** @type {Node & { type: 'MemberExpression' }} */ (node);
        // globalThis.process, globalThis['process'], (globalThis as any)[anything]
        let object = /** @type {Node} */ (member.object);
        while (TS_WRAPPERS.has(object.type)) {
          object = /** @type {Node} */ (/** @type {{ expression: unknown }} */ (object).expression);
        }
        if (object.type === 'Identifier' && GLOBAL_OBJECTS.has(object.name)) {
          const prop = member.property;
          const named = !member.computed && prop.type === 'Identifier' && prop.name === 'process';
          if (named || member.computed) context.report({ node: member, messageId: 'process' });
        }
      },
      AssignmentExpression(node) {
        const left = /** @type {Node} */ (node.left);
        if (left.type !== 'MemberExpression') return;
        const name =
          !left.computed && left.property.type === 'Identifier'
            ? left.property.name
            : staticString(/** @type {Node} */ (left.property));
        if (name !== null && GUARDED_KEYS.has(name)) {
          context.report({ node: left, messageId: 'indirectKey', data: { name } });
        }
      },
      Property(node) {
        const property = /** @type {Node & { type: 'Property' }} */ (node);
        if (property.computed) {
          const key = staticString(/** @type {Node} */ (property.key));
          // Literal guarded keys are reported by the Literal/TemplateLiteral visitors.
          if (key === null) context.report({ node: property.key, messageId: 'computedKey' });
          return;
        }
        const name = plainKey(property);
        const value = /** @type {Node} */ (property.value);
        if (name === 'define') {
          const ok =
            property.kind === 'init' &&
            !property.shorthand &&
            value.type === 'ObjectExpression' &&
            value.properties.every(
              (p) =>
                p.type === 'Property' &&
                p.kind === 'init' &&
                !p.method &&
                isAllowedDefineValue(/** @type {Node} */ (p.value)),
            );
          if (!ok) context.report({ node: value, messageId: 'defineValue' });
        } else if (name === 'envPrefix') {
          if (!(value.type === 'Literal' && value.value === 'VITE_')) {
            context.report({ node: value, messageId: 'envPrefix' });
          }
        }
      },
    };
  },
};

export default rule;
