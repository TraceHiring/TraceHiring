// trace/static-module-paths (spec specs/m0-foundations.md §10.1).
// eslint-plugin-boundaries only sees string-literal module paths, and never sees Vite's glob imports or
// asset URLs. So, in every workspace:
// - `import(x)` and `require(x)` take a plain string literal (no variables, templates or concatenation);
// - every `import.meta.glob` pattern is a string literal that starts with './' and has no '..' segment;
// - `new URL(path, import.meta.url)` takes a literal or template whose text has no '..' segment.
// The Vite plugin `@trace/config/vite` (forbid-server-imports) is the build-time backstop.

/** @typedef {import('eslint').Rule.Node} Node */

/** @param {string} text */
const climbs = (text) => text.split(/[/\\]+/).includes('..');

/**
 * Static text of a string literal, or null.
 * @param {Node | undefined} node
 * @returns {string | null}
 */
function literalText(node) {
  return node !== undefined && node.type === 'Literal' && typeof node.value === 'string'
    ? node.value
    : null;
}

/**
 * True for `import.meta`.
 * @param {Node} node
 */
const isImportMeta = (node) =>
  node.type === 'MetaProperty' && node.meta.name === 'import' && node.property.name === 'meta';

/**
 * True for `import.meta.url`.
 * @param {Node | undefined} node
 */
const isImportMetaUrl = (node) =>
  node !== undefined &&
  node.type === 'MemberExpression' &&
  !node.computed &&
  isImportMeta(/** @type {Node} */ (node.object)) &&
  node.property.type === 'Identifier' &&
  node.property.name === 'url';

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require static, local module paths in import(), require(), import.meta.glob and new URL(..., import.meta.url).',
    },
    schema: [],
    messages: {
      dynamicImport: '`import()` needs a plain string literal so import boundaries can be checked.',
      dynamicRequire:
        '`require()` needs a plain string literal so import boundaries can be checked.',
      globPattern:
        "`import.meta.glob` patterns must be string literals that start with './' and contain no '..'.",
      urlPath:
        "`new URL(path, import.meta.url)` needs a literal path with no '..' segment, so assets stay inside the workspace.",
    },
  },
  create(context) {
    return {
      ImportExpression(node) {
        if (literalText(/** @type {Node} */ (node.source)) === null) {
          context.report({ node: node.source, messageId: 'dynamicImport' });
        }
      },
      CallExpression(node) {
        const callee = /** @type {Node} */ (node.callee);
        const first = /** @type {Node | undefined} */ (node.arguments[0]);
        if (callee.type === 'Identifier' && callee.name === 'require') {
          if (literalText(first) === null) {
            context.report({ node: first ?? node, messageId: 'dynamicRequire' });
          }
          return;
        }
        if (
          callee.type === 'MemberExpression' &&
          isImportMeta(/** @type {Node} */ (callee.object)) &&
          !callee.computed &&
          callee.property.type === 'Identifier' &&
          callee.property.name.startsWith('glob')
        ) {
          const patterns =
            first !== undefined && first.type === 'ArrayExpression'
              ? first.elements.map((e) => /** @type {Node | undefined} */ (e ?? undefined))
              : [first];
          const bad = patterns.some((p) => {
            const text = literalText(p);
            return text === null || !text.startsWith('./') || climbs(text);
          });
          if (bad) context.report({ node: first ?? node, messageId: 'globPattern' });
        }
      },
      NewExpression(node) {
        const callee = /** @type {Node} */ (node.callee);
        if (callee.type !== 'Identifier' || callee.name !== 'URL') return;
        if (!isImportMetaUrl(/** @type {Node | undefined} */ (node.arguments[1]))) return;
        const target = /** @type {Node | undefined} */ (node.arguments[0]);
        /** @type {string | null} */
        let text = literalText(target);
        if (text === null && target !== undefined && target.type === 'TemplateLiteral') {
          text = target.quasis.map((q) => q.value.cooked ?? q.value.raw).join('*');
        }
        if (text === null || climbs(text)) {
          context.report({ node: target ?? node, messageId: 'urlPath' });
        }
      },
    };
  },
};

export default rule;
