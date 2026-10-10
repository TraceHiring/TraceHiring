// trace/log-event-literal (spec specs/m0-foundations.md §9.1, §10.1).
// The logger's `event` argument is a plain string literal that matches the LogLine contract
// (`^[a-z0-9_.]+$`, §9.4): no variables, template strings (even without placeholders), concatenation,
// conditionals or spreads, so events stay greppable and can never carry interpolated data (PII).
//
// This rule is the lint-time backstop. The logger itself enforces the same contract at the type level
// and at runtime (S1.7), so a call this heuristic cannot see is still caught there.
//
// Call shape: `<logger>.<debug|info|warn|error>(event, data?)`. `<logger>` is recognised by name: an
// identifier, member or private field named `log` or `logger`, or ending in `Log` / `Logger`
// (`requestLogger`, `this.logger`, `this.#logger`), through TS wrappers (`logger!`, `logger as T`,
// `<T>logger`, `logger satisfies T`), optional chaining, `.child(...)` chains and factory calls
// (`createLogger(...)`, `getLogger(...)`). Computed methods (`logger['info']`, `logger[level]`) count as
// level calls. `.call(thisArg, event)`, `.apply(thisArg, [event])` and `.bind(thisArg, event)` are
// checked too, and any other use of a logger method (aliasing, passing it as a callback) is reported,
// because the event it will be called with cannot be checked.

/** @typedef {import('eslint').Rule.Node} Node */

const LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const LOGGER_NAME = /^(?:log|logger|\w*Log|\w*Logger)$/;
const LOGGER_FACTORY = /^(?:create|get|make|new)\w*Logger$/;
const EVENT_PATTERN = /^[a-z0-9_.]+$/;
const WRAPPERS = new Set([
  'TSNonNullExpression',
  'TSAsExpression',
  'TSTypeAssertion',
  'TSSatisfiesExpression',
  'ChainExpression',
]);

/**
 * Strips TS-only wrappers and optional-chain wrappers.
 * @param {Node} node
 * @returns {Node}
 */
function unwrap(node) {
  let current = node;
  while (WRAPPERS.has(current.type)) {
    current = /** @type {Node} */ (/** @type {{ expression: unknown }} */ (current).expression);
  }
  return current;
}

/**
 * Static name of a member's property (identifier, private field or string literal), or null.
 * @param {Node} member a MemberExpression
 * @returns {string | null}
 */
function memberName(member) {
  if (member.type !== 'MemberExpression') return null;
  const prop = /** @type {Node} */ (member.property);
  if (!member.computed && (prop.type === 'Identifier' || prop.type === 'PrivateIdentifier')) {
    return prop.name;
  }
  if (member.computed && prop.type === 'Literal' && typeof prop.value === 'string') {
    return prop.value;
  }
  return null;
}

/**
 * True if `node` evaluates to a logger.
 * @param {Node} node
 * @returns {boolean}
 */
function isLogger(node) {
  const target = unwrap(node);
  if (target.type === 'Identifier') return LOGGER_NAME.test(target.name);
  if (target.type === 'MemberExpression') {
    const name = memberName(target);
    return name !== null && LOGGER_NAME.test(name);
  }
  if (target.type === 'CallExpression') {
    const callee = unwrap(/** @type {Node} */ (target.callee));
    if (callee.type === 'Identifier') return LOGGER_FACTORY.test(callee.name);
    if (callee.type === 'MemberExpression') {
      const name = memberName(callee);
      if (name === 'child') return isLogger(/** @type {Node} */ (callee.object));
      return name !== null && LOGGER_FACTORY.test(name);
    }
  }
  return false;
}

/**
 * True for `<logger>.<level>` and `<logger>[<computed>]` (a computed method may be any level).
 * @param {Node} member
 */
function isLoggerMethod(member) {
  if (member.type !== 'MemberExpression') return false;
  if (!isLogger(/** @type {Node} */ (member.object))) return false;
  const name = memberName(member);
  return name === null ? member.computed : LEVELS.has(name);
}

/**
 * The nearest ancestor that is not a TS/optional-chain wrapper, and the child it was reached through.
 * @param {Node} node
 * @returns {{ parent: Node | null, child: Node }}
 */
function outerParent(node) {
  let child = node;
  let parent = /** @type {Node | null} */ (node.parent ?? null);
  while (parent !== null && WRAPPERS.has(parent.type)) {
    child = parent;
    parent = /** @type {Node | null} */ (parent.parent ?? null);
  }
  return { parent, child };
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Require the logger event argument to be a string literal (spec §9.1).' },
    schema: [],
    messages: {
      notLiteral:
        'Logger event must be a plain string literal (no variables, templates or concatenation); put values in `data`.',
      badFormat: 'Logger event "{{event}}" must match ^[a-z0-9_.]+$ (LogLine contract, spec §9.4).',
      indirect:
        'Call logger methods directly (or via .call/.apply/.bind with a literal event) so the event can be checked.',
    },
  },
  create(context) {
    /**
     * @param {Node | undefined} event
     * @param {Node} fallback
     */
    function checkEvent(event, fallback) {
      if (event === undefined || event.type !== 'Literal' || typeof event.value !== 'string') {
        context.report({ node: event ?? fallback, messageId: 'notLiteral' });
        return;
      }
      if (!EVENT_PATTERN.test(event.value)) {
        context.report({ node: event, messageId: 'badFormat', data: { event: event.value } });
      }
    }

    return {
      MemberExpression(node) {
        const member = /** @type {Node} */ (node);
        if (!isLoggerMethod(member)) return;
        const { parent, child } = outerParent(member);

        // logger.info(event, data)
        if (parent !== null && parent.type === 'CallExpression' && parent.callee === child) {
          checkEvent(/** @type {Node | undefined} */ (parent.arguments[0]), parent);
          return;
        }

        // logger.info.call(thisArg, event) / .apply(thisArg, [event]) / .bind(thisArg, event)
        if (parent !== null && parent.type === 'MemberExpression' && parent.object === child) {
          const how = memberName(parent);
          const call = outerParent(parent);
          if (
            (how === 'call' || how === 'apply' || how === 'bind') &&
            call.parent !== null &&
            call.parent.type === 'CallExpression' &&
            call.parent.callee === call.child
          ) {
            const second = /** @type {Node | undefined} */ (call.parent.arguments[1]);
            if (how === 'apply') {
              if (second === undefined || second.type !== 'ArrayExpression') {
                context.report({ node: second ?? call.parent, messageId: 'notLiteral' });
              } else {
                checkEvent(
                  /** @type {Node | undefined} */ (second.elements[0] ?? undefined),
                  second,
                );
              }
            } else {
              checkEvent(second, call.parent);
            }
            return;
          }
        }

        context.report({ node: member, messageId: 'indirect' });
      },
    };
  },
};

export default rule;
