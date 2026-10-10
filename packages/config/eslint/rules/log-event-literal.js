// trace/log-event-literal (spec specs/m0-foundations.md §9.1, §10.1).
// The logger's `event` argument is a plain string literal that matches the LogLine contract
// (`^[a-z0-9_.]+$`, §9.4): no variables, template strings, concatenation or spreads, so events stay
// greppable and can never carry interpolated data (PII) into a log line.
//
// Call shape: `<logger>.<debug|info|warn|error>(event, data?)`, where `<logger>` is an identifier or
// member named `log` or `logger`, or ending in `Log` / `Logger` (e.g. `requestLogger`, `this.logger`).

const LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const LOGGER_NAME = /^(?:log|logger|\w*Log|\w*Logger)$/;
const EVENT_PATTERN = /^[a-z0-9_.]+$/;

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Require the logger event argument to be a string literal (spec §9.1).' },
    schema: [],
    messages: {
      notLiteral:
        'Logger event must be a string literal (no variables, templates or concatenation); put values in `data`.',
      badFormat: 'Logger event "{{event}}" must match ^[a-z0-9_.]+$ (LogLine contract, spec §9.4).',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed) return;
        if (callee.property.type !== 'Identifier' || !LEVELS.has(callee.property.name)) return;
        // `logger` in `logger.info(...)` and in `this.logger.info(...)`.
        const target = callee.object;
        const name =
          target.type === 'Identifier'
            ? target.name
            : target.type === 'MemberExpression' &&
                !target.computed &&
                target.property.type === 'Identifier'
              ? target.property.name
              : null;
        if (name === null || !LOGGER_NAME.test(name)) return;

        const event = node.arguments[0];
        if (event === undefined || event.type !== 'Literal' || typeof event.value !== 'string') {
          context.report({ node: event ?? node, messageId: 'notLiteral' });
          return;
        }
        if (!EVENT_PATTERN.test(event.value)) {
          context.report({ node: event, messageId: 'badFormat', data: { event: event.value } });
        }
      },
    };
  },
};

export default rule;
