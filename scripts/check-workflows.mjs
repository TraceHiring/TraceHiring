#!/usr/bin/env node
// GitHub Actions hardening checks (spec specs/m0-foundations.md §7.1, §7.2, AT-12 local part).
// Reads .github/workflows/*.y{a,}ml and .github/actions/**/action.y{a,}ml and fails (exit 1) unless:
//   - triggers are only pull_request and push (§7.1); pull_request_target / workflow_run are named
//   - workflow-level permissions are exactly `contents: read`; no job asks for more
//   - every remote `uses:` is pinned to a full 40-hex commit SHA (docker:// images to a sha256 digest);
//     local `./` actions (also those used by another local action) must exist under
//     .github/actions and pass the same rules; a cycle of local actions fails
//   - every actions/checkout step sets `persist-credentials: false` (and, in a required job, no
//     `ref:` or `repository:`, so the check tests the commit under review); static, security and
//     migrations check out with `fetch-depth: 0`; static sets MIGRATIONS_BASE=origin/main (§8.4)
//   - only deploy-staging names an environment (environments hold the staging secrets)
//   - github.token (and the whole github context) counts as a secret (GITHUB_TOKEN); contexts
//     match case-insensitively, as GitHub evaluates them
//   - no job or step sets continue-on-error; the required jobs exist, have no `if:` on the job or
//     any of its steps, and no other job (in any workflow) reports a required check name; a job
//     `name:` must equal its id
//   - no bare CR, U+0085, U+2028 or U+2029 line break anywhere in the file
//   - every env: (workflow, job, step, composite-action step) is a mapping whose keys are all on
//     ENV_ALLOW_LIST; a whole-env expression or any other name fails (fail closed)
//   - secrets appear only in step-level env:/with: of deploy-staging, never on or before an
//     install/build step, and each staging secret only on the steps that use it (§7.2, §7.3)
//   - deploy-staging (when present) has the exact needs / if / environment / concurrency of §7.2
// No YAML library is a root dependency, so this file carries a small parser for the YAML subset
// workflows use (block mappings and sequences, plain/quoted/block scalars, flow collections).
// Anything outside that subset (anchors, aliases, tags, merge keys, multiple documents) is an
// error, so the check fails closed instead of misreading a file.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ===================== YAML subset parser =====================

export class YamlError extends Error {}

const indentOf = (raw) => raw.length - raw.trimStart().length;
const isBlankOrComment = (raw) => {
  const t = raw.trim();
  return t === '' || t.startsWith('#');
};
const isSeqItem = (text) => text === '-' || text.startsWith('- ');

function resolvePlain(s) {
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s === 'true' || s === 'True' || s === 'TRUE') return true;
  if (s === 'false' || s === 'False' || s === 'FALSE') return false;
  if (/^[-+]?(0|[1-9][0-9]*)$/.test(s)) return Number(s);
  return s;
}

/** Strips a trailing ` # comment` from plain-scalar text. */
function stripPlainComment(s) {
  const m = /(^|\s)#/.exec(s);
  return (m ? s.slice(0, m.index) : s).trimEnd();
}

const DQ_ESCAPES = {
  0: '\0',
  a: '\x07',
  b: '\b',
  t: '\t',
  n: '\n',
  v: '\v',
  f: '\f',
  r: '\r',
  e: '\x1b',
  ' ': ' ',
  '"': '"',
  '/': '/',
  '\\': '\\',
  N: '\x85',
  _: '\xa0',
};

/** Reads a quoted scalar starting at s[pos]. Returns { value, end } (end is past the closing quote) or null. */
function readQuoted(s, pos) {
  const q = s[pos];
  let out = '';
  for (let i = pos + 1; i < s.length; i++) {
    const c = s[i];
    if (q === "'") {
      if (c === "'") {
        if (s[i + 1] === "'") {
          out += "'";
          i++;
          continue;
        }
        return { value: out, end: i + 1 };
      }
      out += c;
    } else {
      if (c === '"') return { value: out, end: i + 1 };
      if (c === '\\') {
        const e = s[i + 1];
        const hex = { x: 2, u: 4, U: 8 }[e];
        if (hex) {
          const h = s.slice(i + 2, i + 2 + hex);
          if (!/^[0-9a-fA-F]+$/.test(h) || h.length !== hex) return null;
          out += String.fromCodePoint(parseInt(h, 16));
          i += 1 + hex;
        } else if (e in DQ_ESCAPES) {
          out += DQ_ESCAPES[e];
          i++;
        } else return null;
        continue;
      }
      out += c;
    }
  }
  return null;
}

class Parser {
  constructor(text) {
    this.lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    this.i = 0;
  }

  fail(msg, line = this.i) {
    throw new YamlError(`line ${line + 1}: ${msg}`);
  }

  /** Next significant line (skipping blanks and comments) without consuming it. */
  peek() {
    while (this.i < this.lines.length) {
      const raw = this.lines[this.i];
      if (/^ *\t/.test(raw) && raw.trim() !== '') this.fail('tab in indentation');
      if (isBlankOrComment(raw)) {
        this.i++;
        continue;
      }
      const indent = indentOf(raw);
      return { indent, text: raw.slice(indent) };
    }
    return null;
  }

  parseDocument() {
    let n = this.peek();
    if (n && n.text.startsWith('%')) this.fail('directives are not supported');
    if (n && n.indent === 0 && /^---(\s|$)/.test(n.text)) {
      if (!isBlankOrComment(n.text.slice(3))) this.fail('content after --- is not supported');
      this.i++;
    }
    n = this.peek();
    const value = n ? this.parseNode(-1) : null;
    n = this.peek();
    if (n) {
      if (n.indent === 0 && /^---(\s|$)/.test(n.text))
        this.fail('multiple documents are not supported');
      if (n.indent === 0 && /^\.\.\.(\s|$)/.test(n.text)) {
        this.i++;
        if (this.peek()) this.fail('content after the document end marker');
      } else this.fail('unexpected content (bad indentation?)');
    }
    return value;
  }

  /** `key: rest` → { key, rest } or null if the text is not a mapping entry. */
  keyOf(text) {
    if (/^\?(\s|$)/.test(text)) this.fail('complex mapping keys are not supported');
    const c = text[0];
    if (c === '"' || c === "'") {
      const q = readQuoted(text, 0);
      if (!q) return null;
      const after = text.slice(q.end);
      const m = /^\s*:(\s|$)/.exec(after);
      return m ? { key: q.value, rest: after.slice(m[0].length - m[1].length) } : null;
    }
    if ('[{&*!|>%@`#'.includes(c) || isSeqItem(text)) return null;
    const m = /:(\s|$)/.exec(text);
    if (!m) return null;
    const key = text.slice(0, m.index).trimEnd();
    if (key === '' || /\s#/.test(key)) return null;
    return { key, rest: text.slice(m.index + 1) };
  }

  /** Parses the block node starting at the next significant line, which must be indented > parentIndent. */
  parseNode(parentIndent) {
    const n = this.peek();
    if (!n || n.indent <= parentIndent) return null;
    if (isSeqItem(n.text)) return this.parseSeq(n.indent);
    if (this.keyOf(n.text)) return this.parseMap(n.indent);
    this.i++;
    return this.parseInline(n.text, parentIndent);
  }

  parseMap(indent) {
    const obj = {};
    for (;;) {
      const n = this.peek();
      if (!n || n.indent < indent) break;
      if (n.indent > indent) this.fail('bad indentation');
      if (isSeqItem(n.text)) this.fail('a sequence item where a mapping key was expected');
      const k = this.keyOf(n.text);
      if (!k) this.fail('expected a "key: value" entry');
      if (k.key === '<<') this.fail('merge keys (<<) are not supported');
      if (Object.hasOwn(obj, k.key)) this.fail(`duplicate key "${k.key}"`);
      const line = this.i;
      this.i++;
      const value = this.parseValue(k.rest, indent, true, line);
      Object.defineProperty(obj, k.key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return obj;
  }

  parseSeq(indent) {
    const arr = [];
    for (;;) {
      const n = this.peek();
      if (!n || n.indent < indent) break;
      if (n.indent > indent) this.fail('bad indentation');
      if (!isSeqItem(n.text)) break;
      const rest = n.text.slice(1);
      if (isBlankOrComment(rest)) {
        this.i++;
        arr.push(this.parseNode(indent));
        continue;
      }
      // Re-indent the item's content to its own column and parse it as a node there.
      const col = indent + 1 + (rest.length - rest.trimStart().length);
      this.lines[this.i] = ' '.repeat(col) + rest.trimStart();
      const inner = this.peek();
      if (isSeqItem(inner.text)) arr.push(this.parseSeq(col));
      else if (this.keyOf(inner.text)) arr.push(this.parseMap(col));
      else {
        this.i++;
        arr.push(this.parseInline(inner.text, indent));
      }
    }
    return arr;
  }

  /** Value after `key:`; `rest` is the remainder of that (already consumed) line. */
  parseValue(rest, ownerIndent, allowSameIndentSeq, line) {
    if (isBlankOrComment(rest)) {
      const n = this.peek();
      if (n && n.indent > ownerIndent) return this.parseNode(ownerIndent);
      if (n && allowSameIndentSeq && n.indent === ownerIndent && isSeqItem(n.text)) {
        return this.parseSeq(ownerIndent);
      }
      return null;
    }
    return this.parseInline(rest.trimStart(), ownerIndent, line);
  }

  /** A scalar or flow collection that starts on an already-consumed line. */
  parseInline(t, ownerIndent, line = this.i - 1) {
    const c = t[0];
    if (c === '|' || c === '>') return this.parseBlockScalar(t, ownerIndent, line);
    if (c === '[' || c === '{') return this.parseFlowText(t, line);
    if (c === '"' || c === "'") {
      const q = readQuoted(t, 0);
      if (!q)
        this.fail(
          'unterminated or invalid quoted scalar (multi-line quotes are not supported)',
          line,
        );
      if (!isBlankOrComment(t.slice(q.end)))
        this.fail('unexpected text after a quoted scalar', line);
      return q.value;
    }
    if (c === '&') this.fail('anchors are not supported', line);
    if (c === '*') this.fail('aliases are not supported', line);
    if (c === '!') this.fail('tags are not supported', line);
    if (c === '%' || c === '@' || c === '`')
      this.fail(`a plain scalar cannot start with ${c}`, line);
    if (isSeqItem(t)) this.fail('a sequence cannot start on the same line as its key', line);
    let value = stripPlainComment(t);
    let ended = value.length < t.trimEnd().length; // a comment ends a plain scalar
    let blanks = 0;
    while (!ended && this.i < this.lines.length) {
      const raw = this.lines[this.i];
      if (raw.trim() === '') {
        blanks++;
        this.i++;
        continue;
      }
      if (indentOf(raw) <= ownerIndent || raw.trim().startsWith('#')) break;
      const text = raw.trim();
      if (this.keyOf(text) && indentOf(raw) <= ownerIndent + 0) break;
      const part = stripPlainComment(text);
      ended = part.length < text.length;
      value += blanks > 0 ? '\n'.repeat(blanks) + part : ' ' + part;
      blanks = 0;
      this.i++;
    }
    return resolvePlain(value);
  }

  parseBlockScalar(header, ownerIndent, line) {
    const m = /^([|>])([+-]?)(\s+#.*)?$/.exec(header.trimEnd());
    if (!m)
      this.fail('unsupported block scalar header (indentation indicators are not supported)', line);
    const [, style, chomp] = m;
    const body = [];
    let contentIndent = null;
    while (this.i < this.lines.length) {
      const raw = this.lines[this.i];
      if (raw.trim() === '') {
        body.push('');
        this.i++;
        continue;
      }
      const ind = indentOf(raw);
      if (contentIndent === null) {
        if (ind <= ownerIndent) break;
        contentIndent = ind;
      }
      if (ind < contentIndent) {
        if (ind > ownerIndent) this.fail('bad indentation in a block scalar');
        break;
      }
      body.push(raw.slice(contentIndent));
      this.i++;
    }
    let trailing = 0;
    while (body.length > 0 && body[body.length - 1] === '') {
      body.pop();
      trailing++;
    }
    let text;
    if (style === '|') text = body.join('\n');
    else {
      text = '';
      for (let k = 0; k < body.length; k++) {
        const cur = body[k];
        if (k === 0) text = cur;
        else if (cur === '') text += '\n';
        else if (body[k - 1] === '' || /^\s/.test(cur) || /^\s/.test(body[k - 1]))
          text += (body[k - 1] === '' ? '' : '\n') + cur;
        else text += ' ' + cur;
      }
    }
    if (body.length === 0) return chomp === '+' ? '\n'.repeat(trailing) : '';
    if (chomp === '-') return text;
    if (chomp === '+') return text + '\n' + '\n'.repeat(trailing);
    return text + '\n';
  }

  /** A flow collection starting at `t`, possibly continued on later lines. */
  parseFlowText(t, line) {
    let s = t;
    let end = flowEnd(s);
    while (end < 0 && this.i < this.lines.length) {
      s += '\n' + this.lines[this.i];
      this.i++;
      end = flowEnd(s);
    }
    if (end < 0) this.fail('unterminated flow collection', line);
    const tail = s.slice(end);
    if (!isBlankOrComment(tail)) this.fail('unexpected text after a flow collection', line);
    const p = new FlowParser(s.slice(0, end), (msg) => this.fail(msg, line));
    const value = p.parseValue();
    p.ws();
    if (p.pos !== p.s.length) this.fail('unexpected text in a flow collection', line);
    return value;
  }
}

/** Index just past the bracket that closes the flow collection at s[0], or -1. */
function flowEnd(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") {
      const q = readQuoted(s, i);
      if (!q) return -1;
      i = q.end - 1;
    } else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
      const nl = s.indexOf('\n', i);
      if (nl < 0) return -1;
      i = nl;
    } else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Characters that may not start a flow key or scalar (see FlowParser.rejectIndicator). */
const FLOW_INDICATORS = '&*!?|>%@`';

class FlowParser {
  constructor(s, fail) {
    this.s = s;
    this.pos = 0;
    this.fail = fail;
  }

  ws() {
    while (this.pos < this.s.length) {
      const c = this.s[this.pos];
      if (c === ' ' || c === '\n' || c === '\r') this.pos++;
      else if (c === '\t') this.pos++;
      else if (c === '#') {
        const nl = this.s.indexOf('\n', this.pos);
        this.pos = nl < 0 ? this.s.length : nl;
      } else break;
    }
  }

  parseValue() {
    this.ws();
    const c = this.s[this.pos];
    if (c === '[') return this.parseSeq();
    if (c === '{') return this.parseMap();
    if (c === '"' || c === "'") {
      const q = readQuoted(this.s, this.pos);
      if (!q) this.fail('invalid quoted scalar in a flow collection');
      this.pos = q.end;
      return q.value;
    }
    this.rejectIndicator(c);
    return resolvePlain(this.plain(false));
  }

  /**
   * A flow key or scalar that starts with a YAML indicator (anchor, alias, tag, complex key, block
   * scalar, directive or reserved character) means something else to GitHub/js-yaml than the
   * literal text, so it is refused (S1.4 security review H2).
   */
  rejectIndicator(c) {
    if (c !== undefined && FLOW_INDICATORS.includes(c))
      this.fail(`unsupported "${c}" in a flow collection`);
  }

  plain(isKey) {
    const start = this.pos;
    while (this.pos < this.s.length) {
      const c = this.s[this.pos];
      if (',[]{}'.includes(c)) break;
      if (c === ':' && (isKey || /[\s,\]}]/.test(this.s[this.pos + 1] ?? ' '))) break;
      if (c === '\n') break;
      if (c === '#' && this.pos > start && /\s/.test(this.s[this.pos - 1])) break; // a comment
      this.pos++;
    }
    return this.s.slice(start, this.pos).trim();
  }

  parseSeq() {
    this.pos++; // [
    const arr = [];
    for (;;) {
      this.ws();
      if (this.s[this.pos] === ']') {
        this.pos++;
        return arr;
      }
      arr.push(this.parseValue());
      this.ws();
      const c = this.s[this.pos];
      if (c === ',') this.pos++;
      else if (c !== ']') this.fail('expected , or ] in a flow sequence');
    }
  }

  parseMap() {
    this.pos++; // {
    const obj = {};
    for (;;) {
      this.ws();
      if (this.s[this.pos] === '}') {
        this.pos++;
        return obj;
      }
      let key;
      const c = this.s[this.pos];
      if (c === '"' || c === "'") {
        const q = readQuoted(this.s, this.pos);
        if (!q) this.fail('invalid quoted key in a flow mapping');
        this.pos = q.end;
        key = q.value;
      } else {
        this.rejectIndicator(c);
        key = this.plain(true);
        if (key === '') this.fail('empty key in a flow mapping');
      }
      if (key === '<<') this.fail('merge keys (<<) are not supported');
      this.ws();
      let value = null;
      if (this.s[this.pos] === ':') {
        this.pos++;
        this.ws();
        if (this.s[this.pos] !== ',' && this.s[this.pos] !== '}') value = this.parseValue();
      }
      if (Object.hasOwn(obj, key)) this.fail(`duplicate key "${key}"`);
      Object.defineProperty(obj, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      this.ws();
      const d = this.s[this.pos];
      if (d === ',') this.pos++;
      else if (d !== '}') this.fail('expected , or } in a flow mapping');
    }
  }
}

/**
 * Line breaks other than LF / CRLF. YAML 1.1 parsers (js-yaml) break lines at these, but this
 * line-based parser would not, so the two could read different keys (S1.4 security review L7).
 */
const FOREIGN_LINE_BREAK = /\r(?!\n)|[\u0085\u2028\u2029]/;

/** Parses the YAML subset described at the top of this file. Throws YamlError on anything else. */
export function parseYaml(text) {
  const m = FOREIGN_LINE_BREAK.exec(text);
  if (m) {
    const line = text.slice(0, m.index).split('\n').length;
    throw new YamlError(
      `line ${line}: a bare CR, U+0085, U+2028 or U+2029 line break is not supported (use LF)`,
    );
  }
  return new Parser(text).parseDocument();
}

// ===================== workflow rules =====================

export const REQUIRED_JOBS = ['static', 'rls', 'security', 'migrations'];
export const DEPLOY_JOB = 'deploy-staging';
export const DEPLOY_IF =
  "github.event_name == 'push' && github.ref == 'refs/heads/main' && github.repository == 'TraceHiring/TraceHiring'";
export const DEPLOY_ENVIRONMENT = 'staging';
export const DEPLOY_CONCURRENCY = 'deploy-staging';
export const WORKFLOW_PERMISSIONS = { contents: 'read' };
export const FORBIDDEN_TRIGGERS = ['pull_request_target', 'workflow_run'];
export const ALLOWED_TRIGGERS = ['pull_request', 'push'];
/** Jobs whose checkout needs the full history (§7.1: static and security; §7.1 table: migrations). */
export const FULL_HISTORY_JOBS = ['static', 'security', 'migrations'];
export const MIGRATIONS_BASE = 'origin/main';

/** The org sign-in smoke step's entire run text (m0b AT-B9). */
const SMOKE_AUTH_RUN = /^\s*node scripts\/smoke-staging-auth\.mjs\s*$/;

/** §7.3 staging secrets and the commands a step must run to be allowed to hold each one (§7.2). */
export const STAGING_SECRET_USERS = {
  SUPABASE_STAGING_DB_URL: [/\bsupabase\s+db\s+push\b/, /\bpsql\b/],
  CLOUDFLARE_API_TOKEN: [/\bwrangler\b/, /\bcheck-staging-secrets\b/],
  // specs/m0b-tenancy.md AT-B9, AT-B10 [R5]: the org sign-in smoke step only, whose whole run text
  // is that one command (no other line, comment or argument can read the secrets; B4-SEC-2).
  STAGING_SMOKE_EMAIL: [SMOKE_AUTH_RUN],
  STAGING_SMOKE_PASSWORD: [SMOKE_AUTH_RUN],
  STAGING_SMOKE_TOTP_SECRET: [SMOKE_AUTH_RUN],
};

/**
 * Build variables the recruiter bundle reads (specs/m0b-tenancy.md §2.7): set only on the
 * deploy-staging build step, and only from these public staging variables (never a secret), so
 * every other build (local, CI static) has none and the app shows "not configured".
 */
export const BUILD_ONLY_ENV = Object.freeze({
  VITE_SUPABASE_URL: '${{ vars.SUPABASE_STAGING_URL }}',
  VITE_SUPABASE_PUBLISHABLE_KEY: '${{ vars.SUPABASE_STAGING_PUBLISHABLE_KEY }}',
});

const INSTALL_RE = /\b(?:pnpm|npm|yarn)\s+(?:install|i|ci|add)\b/;
const BUILD_RE = /\bpnpm\s+(?:(?:-r|--recursive|--filter\s+\S+)\s+)*(?:run\s+)?build\b/;
const SHA_PIN_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40}$/;
const DOCKER_PIN_RE = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/;

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const v = (file, where, message) => ({ file, where, message });

const normExpr = (s) =>
  String(s)
    .trim()
    .replace(/^\$\{\{([\s\S]*)\}\}$/, '$1')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The bodies of the ${{ }} expressions in a string. Each expression is read twice, once ending at
 * the first `}}` and once skipping `}}` inside a '…' string literal, and both bodies are returned,
 * so a `}}` inside a string can never hide part of an expression from the secret scan.
 */
function expressionBodies(s) {
  const out = [];
  for (const m of s.matchAll(/\$\{\{([\s\S]*?)(?:\}\}|$)/g)) out.push(m[1]);
  let i = 0;
  while ((i = s.indexOf('${{', i)) >= 0) {
    let j = i + 3;
    let inString = false;
    for (; j < s.length; j++) {
      if (s[j] === "'")
        inString = !inString; // '' (an escaped quote) toggles twice
      else if (!inString && s[j] === '}' && s[j + 1] === '}') break;
    }
    out.push(s.slice(i + 3, j));
    i = j + 2;
  }
  return out;
}

/**
 * Secret names referenced in a node, upper-cased. Strings are searched inside ${{ }} expressions;
 * values of `if` keys are expressions as a whole. Contexts and property names match
 * case-insensitively, as GitHub evaluates them (S1.4 security review H1). A bare or computed
 * `secrets` reference (toJSON(secrets), secrets[format(…)], secrets.*) yields '*'. The `github`
 * context holds the token, so github.token, github['token'] and a bare github (toJSON(github)) all
 * yield GITHUB_TOKEN; ordinary properties such as github.ref do not.
 */
export function secretRefs(node, key = null) {
  const out = new Set();
  const scan = (expr) => {
    const re =
      /\b(secrets|github)\b\s*(?:\.\s*([A-Za-z_][A-Za-z0-9_-]*)|\[\s*(?:'([^']*)'|"([^"]*)")\s*\])?/gi;
    for (const m of expr.matchAll(re)) {
      const prop = m[2] ?? m[3] ?? m[4];
      if (m[1].toLowerCase() === 'secrets') out.add(prop === undefined ? '*' : prop.toUpperCase());
      else if (prop === undefined || prop.toLowerCase() === 'token') out.add('GITHUB_TOKEN');
    }
  };
  const walk = (n, k) => {
    if (typeof n === 'string') {
      if (k === 'if') scan(n);
      else for (const body of expressionBodies(n)) scan(body);
    } else if (Array.isArray(n)) n.forEach((x) => walk(x, null));
    else if (isObj(n)) {
      for (const [kk, vv] of Object.entries(n)) {
        // GitHub evaluates an expression used as a key in mappings that allow contexts (env:,
        // with:), so keys are scanned like values (S1.4 security re-review N2).
        for (const body of expressionBodies(kk)) scan(body);
        walk(vv, kk);
      }
    }
  };
  walk(node, key);
  return [...out];
}

function checkUses(uses, file, where, out, ctx) {
  if (typeof uses !== 'string') {
    out.push(v(file, where, 'uses: must be a string'));
    return;
  }
  if (uses.startsWith('./')) {
    ctx?.localActions?.add(uses.replace(/^\.\//, '').replace(/\/+$/, ''));
    return;
  }
  if (uses.startsWith('docker://')) {
    if (!DOCKER_PIN_RE.test(uses))
      out.push(v(file, where, `uses: ${uses} is not pinned to a full commit SHA / image digest`));
    return;
  }
  if (!SHA_PIN_RE.test(uses))
    out.push(v(file, where, `uses: ${uses} is not pinned to a full commit SHA`));
}

const isTruthyFlag = (x) => !(x === undefined || x === null || x === false || x === 'false');

function checkStepCommon(step, file, where, out, ctx) {
  if (!isObj(step)) {
    out.push(v(file, where, 'step must be a mapping'));
    return;
  }
  if (step.uses !== undefined) checkUses(step.uses, file, where, out, ctx);
  if (typeof step.uses === 'string' && /^actions\/checkout@/i.test(step.uses)) {
    const pc = isObj(step.with) ? step.with['persist-credentials'] : undefined;
    if (!(pc === false || pc === 'false')) {
      out.push(v(file, where, 'actions/checkout must set persist-credentials: false'));
    }
  }
  if (isTruthyFlag(step['continue-on-error'])) {
    out.push(v(file, where, 'continue-on-error is not allowed (a failing step must fail the job)'));
  }
  if (step.shell !== undefined && step.shell !== 'bash') {
    out.push(v(file, where, SHELL_MESSAGE));
  }
  checkEnv(step.env, file, where, out);
  checkRun(step.run, file, where, out);
  checkKeyCase(step, file, where, out);
}

/**
 * The only names an env: mapping may set, at workflow, job, step and composite-action-step level.
 * bash, node, pnpm/npm, the dynamic loader and the runner all read variables at startup
 * (SHELLOPTS, BASH_ENV, BASH_FUNC_*, NODE_OPTIONS, pnpm_config_*, LD_PRELOAD, PATH, ACTIONS_*), and
 * several of them make every run: step exit 0 without running it, so a deny-list can never be
 * complete: the check fails closed (S1.4 N8/N9 security review N10, after N9). Each name must match
 * ENV_NAME_RE. Add one only in a reviewed change, with a comment naming where it is used (the S3
 * deploy-staging job extends this list in its own review).
 */
export const ENV_ALLOW_LIST = Object.freeze([
  // .github/workflows/ci.yml, workflow env: (no telemetry from CI).
  'DO_NOT_TRACK',
  'WRANGLER_SEND_METRICS',
  // .github/workflows/ci.yml, jobs.static.env (spec §7.1, §8.4: a PR checkout has no local main).
  'MIGRATIONS_BASE',
  // .github/workflows/ci.yml, jobs.security, the osv-scanner step.
  'OSV_SCANNER_VERSION',
  'OSV_SCANNER_SHA256',
  // .github/actions/setup/action.yml, the gitleaks install step.
  'GITLEAKS_VERSION',
  'GITLEAKS_SHA256',
  // The S3 deploy-staging job (specs/m0-foundations.md §7.2 step 3, line 409, and the §7.3
  // secrets row, line 431): migrations and catalog-check steps only.
  'SUPABASE_STAGING_DB_URL',
  // specs/m0-foundations.md §7.2 step 5, line 415, and the §7.3 secrets row, line 431: the
  // wrangler and check-staging-secrets steps only.
  'CLOUDFLARE_API_TOKEN',
  // specs/m0-foundations.md §7.3 variables row, line 432 (a public staging variable; used by the
  // wrangler steps 5-7 per docs/infra/environments.md).
  'CLOUDFLARE_ACCOUNT_ID',
  // specs/m0b-tenancy.md §2.7: the deploy-staging build step only (BUILD_ONLY_ENV).
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  // specs/m0b-tenancy.md AT-B9 [R5]: the org sign-in smoke step (public variables, then the three
  // smoke secrets bound by STAGING_SECRET_USERS).
  'SUPABASE_STAGING_URL',
  'SUPABASE_STAGING_PUBLISHABLE_KEY',
  'STAGING_SMOKE_EMAIL',
  'STAGING_SMOKE_PASSWORD',
  'STAGING_SMOKE_TOTP_SECRET',
]);
export const ENV_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const ENV_ALLOWED = new Set(ENV_ALLOW_LIST);

/**
 * Why a name off the allow-list is dangerous: [env: key pattern, run: text pattern, reason].
 * The env: pattern matches in any case (only used for the message; every name off the allow-list
 * fails, whatever its case). The run: pattern is the deny rule for run text (checkRun), where
 * names are case-sensitive like bash's, except npm and pnpm config, which they read in any case.
 */
const ENV_DENY_REASONS = [
  // SHELLOPTS=noexec or a BASH_ENV/ENV script skips every run: step, like a shell template (N9).
  [
    /^(?:shellopts|bashopts|bash_env|env)$/i,
    /^(?:SHELLOPTS|BASHOPTS|BASH_ENV|ENV)$/,
    'bash reads it at startup and can skip every run: step',
  ],
  [/^bash_func_/i, /^BASH_FUNC_/, 'bash imports it as a function, which can replace any command'],
  [
    /^node_/i,
    /^NODE_/,
    'node reads it at startup (NODE_OPTIONS can preload code or exit before running)',
  ],
  [
    /^(?:npm|pnpm|yarn)_config_/i,
    /^(?:npm|pnpm|yarn)_config_/i,
    'pnpm and npm read it as config (script-shell can skip scripts)',
  ],
  [
    /^(?:ld|dyld)_/i,
    /^(?:LD|DYLD)_/,
    'the dynamic loader reads it (LD_PRELOAD loads code into every program)',
  ],
  [/^path$/i, /^PATH$/, 'it decides which program every command runs'],
  [/^(?:actions|github|runner)_/i, /^(?:ACTIONS|GITHUB|RUNNER)_/, 'the runner reads it'],
  // m0b §2.7, B4-SEC-2: BUILD_ONLY_ENV values come only from env: on the deploy build step.
  [
    /^vite_supabase_/i,
    /^VITE_SUPABASE_/,
    'it is set only through env: on the deploy build step (m0b §2.7)',
  ],
];

/** null when an env: key may be set, else the reason it may not. */
function envKeyProblem(key) {
  if (ENV_NAME_RE.test(key) && ENV_ALLOWED.has(key)) return null;
  if (key.includes('${{')) return 'a key built from an expression can name any variable';
  const deny = ENV_DENY_REASONS.find(([re]) => re.test(key));
  if (deny) return deny[2];
  if (!ENV_NAME_RE.test(key)) return 'a name must be upper-case letters, digits and _';
  return 'it is not on the allow-list';
}

/** An env: name as printed in a violation: as is when plain ASCII, else JSON-quoted. */
const showKey = (key) => (/^[\x21-\x7e]+$/.test(key) ? key : JSON.stringify(key));

/**
 * An env: at any level must be a mapping (a whole-env ${{ }} expression could set any variable)
 * whose every key is on ENV_ALLOW_LIST.
 */
function checkEnv(env, file, where, out) {
  if (env === undefined) return;
  if (!isObj(env)) {
    out.push(
      v(
        file,
        where,
        'env: must be a mapping of listed names (a whole-env expression can set any variable)',
      ),
    );
    return;
  }
  for (const key of Object.keys(env)) {
    const why = envKeyProblem(key);
    if (why !== null) {
      out.push(
        v(
          file,
          where,
          `env: may not set ${showKey(key)}: ${why} (only ENV_ALLOW_LIST names in scripts/check-workflows.mjs may be set)`,
        ),
      );
    }
  }
}

// The one GITHUB_PATH write run text may make: the setup action adds its checksum-verified
// gitleaks directory, on a line of its own. Any other directory (even under $RUNNER_TEMP) could
// hold a shim that every later step runs (follow-up review of 0179e2a, Low).
const SETUP_ACTION_FILE = '.github/actions/setup/action.yml';
const GITHUB_PATH_LINE_RE = /^\s*echo "\$RUNNER_TEMP\/gitleaks" >> "\$GITHUB_PATH"\s*$/;

/**
 * run: text may only read the names ENV_DENY_REASONS covers ($NAME, ${NAME}, ${#NAME}, ${!NAME},
 * ${NAME:-x}, ${NAME[0]}); any other use (an assignment, export, declare, read, unset, printf -v,
 * a GITHUB_ENV line, a workflow command, even a comment) is rejected, so run text cannot set what
 * env: may not (S3b security review). Every GITHUB_ENV use is rejected: a line written to it sets
 * any variable, named however the text builds it, for every later step. GITHUB_PATH only takes
 * GITHUB_PATH_LINE_RE in SETUP_ACTION_FILE. bash joins a backslash-newline before it parses and
 * drops quotes and backslashes inside a word, so names are looked for in the joined text and
 * again with quotes and backslashes removed (follow-up review of 0179e2a). This is a deny rule,
 * unlike env:'s allow-list, because run text sets ordinary shell variables; names built at run
 * time, eval and everything else run text can do are for the protected-branch review of .github/.
 */
function checkRun(run, file, where, out) {
  if (typeof run !== 'string') return;
  const text = run.replace(/\\\r?\n/g, '');
  // An empty $'' or $"" inside a word disappears too (re-review of dbb20c7, Low).
  const unquoted = text.replace(/\$(?=["'])/g, '').replace(/["'\\]/g, '');
  const named = new Set();
  for (const scanned of [text, unquoted, ...braceVariants(unquoted)]) {
    for (const m of scanned.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      const name = m[0];
      const before = scanned.slice(Math.max(0, m.index - 3), m.index);
      const after = scanned.slice(m.index + name.length);
      // The whole identifier only (no match inside MY_PATH or PATH_X).
      if (/[A-Za-z0-9_]$/.test(before)) continue;
      // ${NAME=x}, ${NAME:=x} and ${NAME[0]=x} assign; every other ${NAME...} form reads.
      const braced = /\$\{[#!]?$/.test(before);
      if (/\$$/.test(before) || (braced && !/^(?:\[[^\]]*\])?:?=/.test(after))) continue;
      const deny = ENV_DENY_REASONS.find(([, re]) => re.test(name));
      if (deny && !named.has(name)) {
        named.add(name);
        out.push(
          v(
            file,
            where,
            `run: may only read ${name} (as $${name}); it may not set, export or name it: ${deny[2]}`,
          ),
        );
      }
    }
  }
  if (/(?<![A-Za-z0-9_])GITHUB_ENV(?![A-Za-z0-9_])/.test(text)) {
    out.push(
      v(
        file,
        where,
        'run: may not use GITHUB_ENV (a line written to it sets any variable for every later step; set ENV_ALLOW_LIST names in env:)',
      ),
    );
  }
  const pathLines = text
    .split('\n')
    .filter((line) => /(?<![A-Za-z0-9_])GITHUB_PATH(?![A-Za-z0-9_])/.test(line));
  if (pathLines.some((line) => !(file === SETUP_ACTION_FILE && GITHUB_PATH_LINE_RE.test(line)))) {
    out.push(
      v(
        file,
        where,
        `run: may not write GITHUB_PATH (a PATH entry reaches every later step); only ${SETUP_ACTION_FILE} may add its gitleaks line: echo "$RUNNER_TEMP/gitleaks" >> "$GITHUB_PATH"`,
      ),
    );
  }
}

/**
 * bash brace-expands NO{,x}DE_OPTIONS=y into NODE_OPTIONS=y NOxDE_OPTIONS=y before export reads
 * it (re-review of dbb20c7, Low). Each variant picks the k-th alternative of every brace list (the
 * last one when a list is shorter); nested lists stay a residual. ${...} is not a brace list.
 */
function braceVariants(s) {
  const re = /(?<!\$)\{([^{}]*,[^{}]*)\}/g;
  const longest = Math.max(0, ...[...s.matchAll(re)].map((m) => m[1].split(',').length));
  const out = [];
  for (let k = 0; k < longest; k++) {
    out.push(
      s.replace(re, (_, body) => {
        const alts = body.split(',');
        return alts[Math.min(k, alts.length - 1)];
      }),
    );
  }
  return out;
}

/**
 * Every real key of a workflow, job, step, action or runs: mapping is lower-case. How GitHub reads
 * a key such as Run: or Env: was not verified, and this check would not see one, so it fails
 * closed (follow-up review of 0179e2a, "not checked"). Names inside env:, with: and jobs: are
 * not keys of these mappings and keep their case.
 */
function checkKeyCase(node, file, where, out) {
  if (!isObj(node)) return;
  for (const key of Object.keys(node)) {
    if (key !== key.toLowerCase()) {
      out.push(
        v(file, where, `key ${showKey(key)} must be lower-case (it is not checked as written)`),
      );
    }
  }
}

// A custom shell template such as 'true {0}' makes every run: step exit 0 without running it
// (S1.4 security re-review N3), so shell: is always exactly bash.
const SHELL_MESSAGE = 'shell: must be exactly bash (a shell template can skip every run: step)';

/** Workflow- or job-level `defaults:` may only set `run.shell: bash` (and other run keys). */
function checkDefaults(defaults, file, where, out) {
  if (defaults === undefined) return;
  if (!isObj(defaults) || (defaults.run !== undefined && !isObj(defaults.run))) {
    out.push(v(file, where, 'defaults: must be a mapping with a run: mapping'));
    return;
  }
  // A Run: or Shell: key would hide a shell template from the check below (re-review of dbb20c7).
  checkKeyCase(defaults, file, where, out);
  checkKeyCase(defaults.run, file, `${where}.run`, out);
  if (defaults.run?.shell !== undefined && defaults.run.shell !== 'bash') {
    out.push(v(file, where, SHELL_MESSAGE));
  }
}

/** Is this step an install or build step (directly, or through a local action that installs)? */
function isInstallOrBuild(step, ctx) {
  if (!isObj(step)) return false;
  if (typeof step.run === 'string' && (INSTALL_RE.test(step.run) || BUILD_RE.test(step.run)))
    return true;
  if (typeof step.uses === 'string' && step.uses.startsWith('./')) {
    const p = step.uses.replace(/^\.\//, '').replace(/\/+$/, '');
    return ctx?.installActions?.has(p) ?? false;
  }
  return false;
}

function triggerNames(on) {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on.map(String);
  if (isObj(on)) return Object.keys(on);
  return [];
}

const LEVEL = { none: 0, read: 1, write: 2 };

/** The required job a check name stands for, compared case-insensitively, or null. */
function requiredNameOf(checkName) {
  if (typeof checkName !== 'string') return null;
  return REQUIRED_JOBS.find((r) => r.toLowerCase() === checkName.trim().toLowerCase()) ?? null;
}

/**
 * Checks one parsed workflow.
 * @param ctx {{ installActions?: Set<string>, localActions?: Set<string> }} local actions (repo-relative
 *   dirs) that run an install; `localActions` collects every local action the workflow references.
 */
export function checkWorkflow(doc, file, ctx = {}) {
  const out = [];
  if (!isObj(doc)) return [v(file, '', 'workflow must be a mapping')];
  // Triggers.
  if (doc.on === undefined) out.push(v(file, 'on', 'workflow has no on: triggers'));
  for (const t of triggerNames(doc.on)) {
    if (FORBIDDEN_TRIGGERS.includes(t)) out.push(v(file, 'on', `trigger ${t} is not allowed`));
    else if (!ALLOWED_TRIGGERS.includes(t))
      out.push(
        v(file, 'on', `trigger ${t} is not allowed (§7.1: ${ALLOWED_TRIGGERS.join(', ')} only)`),
      );
  }
  // Workflow permissions: exactly contents: read.
  const wp = doc.permissions;
  if (
    !isObj(wp) ||
    JSON.stringify(Object.entries(wp).sort()) !==
      JSON.stringify(Object.entries(WORKFLOW_PERMISSIONS))
  ) {
    out.push(
      v(file, 'permissions', 'workflow-level permissions must be exactly { contents: read }'),
    );
  }
  // Secrets outside jobs.
  for (const [k, val] of Object.entries(doc)) {
    if (k === 'jobs') continue;
    if (secretRefs(val, k).length > 0)
      out.push(
        v(file, k, 'secrets may only be set at step level (env: or with:) in deploy-staging'),
      );
  }
  checkDefaults(doc.defaults, file, 'defaults', out);
  checkEnv(doc.env, file, 'env', out);
  checkKeyCase(doc, file, '', out);
  if (!isObj(doc.jobs)) {
    out.push(v(file, 'jobs', 'workflow has no jobs mapping'));
    return out;
  }
  for (const [name, job] of Object.entries(doc.jobs)) {
    const where = `jobs.${name}`;
    if (!isObj(job)) {
      out.push(v(file, where, 'job must be a mapping'));
      continue;
    }
    checkDefaults(job.defaults, file, `${where}.defaults`, out);
    checkKeyCase(job, file, where, out);
    // Job permissions never broader than the workflow's.
    if (job.permissions !== undefined) {
      const jp = job.permissions;
      const ok =
        isObj(jp) &&
        Object.entries(jp).every(
          ([scope, level]) =>
            Object.hasOwn(WORKFLOW_PERMISSIONS, scope) &&
            level in LEVEL &&
            LEVEL[level] <= LEVEL[WORKFLOW_PERMISSIONS[scope]],
        );
      if (!ok)
        out.push(
          v(
            file,
            where,
            'job permissions may not be broader than the workflow-level { contents: read }',
          ),
        );
    }
    if (isTruthyFlag(job['continue-on-error'])) {
      out.push(v(file, where, 'continue-on-error is not allowed on a job'));
    }
    checkEnv(job.env, file, where, out);
    // A job container (or service) image decides which bash runs the steps (N9), and its env: and
    // options: are not checked by checkEnv; deploy-staging's steps hold the staging secrets (P2).
    if (
      (REQUIRED_JOBS.includes(name) || name === DEPLOY_JOB) &&
      (job.container !== undefined || job.services !== undefined)
    ) {
      out.push(
        v(file, where, 'a required job or deploy-staging may not use container: or services:'),
      );
    }
    if (REQUIRED_JOBS.includes(name) && job.if !== undefined) {
      out.push(
        v(file, where, 'a required job may not have an if: (a skipped job reports success)'),
      );
    }
    // A required job that needs another job is skipped when that job is skipped or fails, and a
    // skipped job also reports success (S1.4 re-review N1). It may only need other required jobs.
    if (REQUIRED_JOBS.includes(name) && job.needs !== undefined) {
      const needs = typeof job.needs === 'string' ? [job.needs] : job.needs;
      if (!Array.isArray(needs) || !needs.every((n) => typeof n === 'string')) {
        out.push(v(file, where, 'needs: must be a job id or a list of job ids'));
      } else {
        const others = needs.filter((n) => !REQUIRED_JOBS.includes(n));
        if (others.length > 0) {
          out.push(
            v(
              file,
              where,
              `a required job may only needs: other required jobs, not ${others.join(', ')}`,
            ),
          );
        }
      }
    }
    // The check name is the job's name: (or its id). A renamed job, or a second job reporting a
    // required name, could satisfy branch protection without running the real checks (S1.4 M4).
    if (job.name !== undefined && job.name !== name) {
      out.push(v(file, where, 'a job name: must equal its job id (check names are protected)'));
    }
    const required = requiredNameOf(name);
    if (required !== null && name !== required) {
      out.push(
        v(file, where, `job id "${name}" collides with the required job "${required}" (case)`),
      );
    }
    if (REQUIRED_JOBS.includes(name) && Array.isArray(job.steps)) {
      job.steps.forEach((s, i) => {
        if (isObj(s) && s.if !== undefined)
          out.push(
            v(
              file,
              `${where}.steps[${i}]`,
              'a step of a required job may not have an if: (a skipped step reports success)',
            ),
          );
        // A required check must test the commit under review (N10–N13 re-review P3). Input names
        // are case-insensitive on GitHub, so compare them trimmed and lowercased.
        const isCheckout =
          isObj(s) && typeof s.uses === 'string' && /^actions\/checkout@/i.test(s.uses);
        if (
          isCheckout &&
          isObj(s.with) &&
          Object.keys(s.with).some((k) => ['ref', 'repository'].includes(k.trim().toLowerCase()))
        ) {
          out.push(
            v(
              file,
              `${where}.steps[${i}]`,
              'actions/checkout in a required job may not set ref: or repository: (it must test the commit under review)',
            ),
          );
        }
      });
    }
    if (job.uses !== undefined) checkUses(job.uses, file, where, out, ctx);
    if (job.environment !== undefined && name !== DEPLOY_JOB) {
      out.push(v(file, where, `only ${DEPLOY_JOB} may use an environment: (it holds secrets)`));
    }
    if (FULL_HISTORY_JOBS.includes(name)) {
      const checkouts = (Array.isArray(job.steps) ? job.steps : []).filter(
        (s) => isObj(s) && typeof s.uses === 'string' && /^actions\/checkout@/i.test(s.uses),
      );
      const full = (s) =>
        isObj(s.with) && (s.with['fetch-depth'] === 0 || s.with['fetch-depth'] === '0');
      if (checkouts.length === 0 || !checkouts.every(full)) {
        out.push(v(file, where, 'actions/checkout must set fetch-depth: 0 (full history)'));
      }
    }
    if (name === 'static') {
      const base =
        (isObj(job.env) ? job.env.MIGRATIONS_BASE : undefined) ??
        (isObj(doc.env) ? doc.env.MIGRATIONS_BASE : undefined);
      if (base !== MIGRATIONS_BASE) {
        out.push(
          v(
            file,
            where,
            `static must set MIGRATIONS_BASE: ${MIGRATIONS_BASE} (a PR checkout has no local main)`,
          ),
        );
      }
    }
    // Secrets anywhere in the job outside its steps (env, secrets:, services, container, if...).
    for (const [k, val] of Object.entries(job)) {
      if (k === 'steps') continue;
      if (k === 'secrets' || secretRefs(val, k).length > 0) {
        out.push(v(file, where, `secrets may only be set at step level (found in ${k}:)`));
      }
    }
    const steps = Array.isArray(job.steps) ? job.steps : [];
    if (job.steps !== undefined && !Array.isArray(job.steps))
      out.push(v(file, where, 'steps must be a sequence'));
    let lastInstall = -1;
    steps.forEach((s, i) => {
      if (isInstallOrBuild(s, ctx)) lastInstall = i;
    });
    steps.forEach((step, i) => {
      const sw = `${where}.steps[${i}]`;
      checkStepCommon(step, file, sw, out, ctx);
      if (!isObj(step)) return;
      const all = secretRefs(step);
      if (all.length === 0) return;
      if (name !== DEPLOY_JOB) {
        out.push(
          v(
            file,
            sw,
            `secrets (${all.join(', ')}) are not allowed outside ${DEPLOY_JOB}; pull requests run this job`,
          ),
        );
        return;
      }
      if (i <= lastInstall) {
        out.push(
          v(file, sw, `no secrets on or before the install/build steps (found ${all.join(', ')})`),
        );
        return;
      }
      for (const [k, val] of Object.entries(step)) {
        if (k === 'env' || k === 'with') continue;
        if (secretRefs(val, k).length > 0) {
          out.push(v(file, sw, `secrets belong only in env: or with: (found in ${k}:)`));
        }
      }
      const run = typeof step.run === 'string' ? step.run : '';
      for (const s of all) {
        const users = STAGING_SECRET_USERS[s];
        if (!users)
          out.push(
            v(
              file,
              sw,
              `secret ${s === '*' ? 'context (all secrets)' : s} is not on the §7.3 staging list`,
            ),
          );
        else if (!users.some((re) => re.test(run))) {
          out.push(
            v(file, sw, `secret ${s} is set on a step that does not use it (§7.2 step scoping)`),
          );
        }
      }
    });
  }
  // deploy-staging gate (§7.2).
  const d = doc.jobs[DEPLOY_JOB];
  if (isObj(d)) {
    const where = `jobs.${DEPLOY_JOB}`;
    const needs = typeof d.needs === 'string' ? [d.needs] : Array.isArray(d.needs) ? d.needs : [];
    if (JSON.stringify([...needs].sort()) !== JSON.stringify([...REQUIRED_JOBS].sort())) {
      out.push(v(file, where, `${DEPLOY_JOB} must have needs: [${REQUIRED_JOBS.join(', ')}]`));
    }
    if (typeof d.if !== 'string' || normExpr(d.if) !== normExpr(DEPLOY_IF)) {
      out.push(v(file, where, `${DEPLOY_JOB} must have exactly if: ${DEPLOY_IF}`));
    }
    const env = isObj(d.environment) ? d.environment.name : d.environment;
    if (env !== DEPLOY_ENVIRONMENT)
      out.push(v(file, where, `${DEPLOY_JOB} must use environment: ${DEPLOY_ENVIRONMENT}`));
    const c = d.concurrency;
    const group = isObj(c) ? c.group : c;
    const cancel = isObj(c) ? c['cancel-in-progress'] : undefined;
    if (group !== DEPLOY_CONCURRENCY || isTruthyFlag(cancel)) {
      out.push(
        v(
          file,
          where,
          `${DEPLOY_JOB} must use concurrency: ${DEPLOY_CONCURRENCY} without cancel-in-progress`,
        ),
      );
    }
  }
  checkBuildOnlyEnv(doc, file, out);
  return out;
}

/**
 * BUILD_ONLY_ENV names (specs/m0b-tenancy.md §2.7): set only in the env: of a deploy-staging step
 * that builds, and only to their listed public variables. Anywhere else (workflow or job env, any
 * other step) they would put staging values into a build that is not the staging one.
 */
function checkBuildOnlyEnv(doc, file, out) {
  const names = Object.keys(BUILD_ONLY_ENV);
  const misplaced = (env, where) => {
    if (!isObj(env)) return;
    for (const n of names) {
      if (Object.hasOwn(env, n))
        out.push(v(file, where, `${n} may be set only on the ${DEPLOY_JOB} build step (§2.7)`));
    }
  };
  misplaced(doc.env, 'env');
  for (const [name, job] of Object.entries(isObj(doc.jobs) ? doc.jobs : {})) {
    if (!isObj(job)) continue;
    const where = `jobs.${name}`;
    misplaced(job.env, where);
    (Array.isArray(job.steps) ? job.steps : []).forEach((step, i) => {
      if (!isObj(step) || !isObj(step.env)) return;
      const sw = `${where}.steps[${i}]`;
      const run = typeof step.run === 'string' ? step.run : '';
      if (name !== DEPLOY_JOB || !BUILD_RE.test(run)) {
        misplaced(step.env, sw);
        return;
      }
      for (const n of names) {
        if (Object.hasOwn(step.env, n) && normExpr(step.env[n]) !== normExpr(BUILD_ONLY_ENV[n]))
          out.push(
            v(file, sw, `${n} must be exactly ${BUILD_ONLY_ENV[n]} (a public variable, §2.7)`),
          );
      }
    });
  }
}

/** Checks a local action's action.yml. Only composite actions are allowed. */
export function checkAction(doc, file, ctx = {}) {
  const out = [];
  if (!isObj(doc) || !isObj(doc.runs)) return [v(file, '', 'action must have a runs: mapping')];
  if (doc.runs.using !== 'composite')
    out.push(v(file, 'runs.using', 'local actions must be composite actions'));
  if (secretRefs(doc).length > 0) out.push(v(file, '', 'a local action may not reference secrets'));
  checkKeyCase(doc, file, '', out);
  checkKeyCase(doc.runs, file, 'runs', out);
  const steps = Array.isArray(doc.runs.steps) ? doc.runs.steps : [];
  steps.forEach((s, i) => {
    checkStepCommon(s, file, `runs.steps[${i}]`, out, ctx);
    if (!isObj(s) || !isObj(s.env)) return;
    for (const n of Object.keys(BUILD_ONLY_ENV)) {
      if (Object.hasOwn(s.env, n))
        out.push(
          v(
            file,
            `runs.steps[${i}]`,
            `${n} may be set only on the ${DEPLOY_JOB} build step (§2.7)`,
          ),
        );
    }
  });
  return out;
}

/** Does this composite action run an install or build? */
export function actionInstalls(doc) {
  const steps =
    isObj(doc) && isObj(doc.runs) && Array.isArray(doc.runs.steps) ? doc.runs.steps : [];
  return steps.some((s) => isInstallOrBuild(s, {}));
}

// ===================== repo walk =====================

function listFiles(dir, pred, acc = []) {
  if (!existsSync(dir)) return acc;
  // Sorted, so the result never depends on the file system's directory order (N4).
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(abs, pred, acc);
    else if (pred(e.name)) acc.push(abs);
  }
  return acc;
}

/** Runs every rule over `.github/` in `root`. Returns a list of violations `{ file, where, message }`. */
export function runChecks(root) {
  const out = [];
  const relp = (abs) => path.relative(root, abs).split(path.sep).join('/');
  const load = (abs) => {
    try {
      return { doc: parseYaml(readFileSync(abs, 'utf8')) };
    } catch (err) {
      if (!(err instanceof YamlError)) throw err;
      out.push(v(relp(abs), '', `YAML: ${err.message}`));
      return null;
    }
  };

  // Local actions first, so workflows know which ones install. Every action.yml under
  // .github/actions is checked; the local actions each one uses must exist there too.
  const actions = new Map(); // dir → { doc, file, refs }
  for (const abs of listFiles(path.join(root, '.github', 'actions'), (n) =>
    /^action\.ya?ml$/.test(n),
  )) {
    const r = load(abs);
    if (!r) continue;
    const refs = new Set();
    out.push(...checkAction(r.doc, relp(abs), { localActions: refs }));
    const dir = relp(path.dirname(abs));
    // GitHub prefers action.yml; with both present the Map could keep a decoy action.yaml and
    // compute installs from the wrong file (S1.4 security re-review N4), so both fail.
    if (actions.has(dir)) {
      out.push(v(dir, '', 'an action directory may not hold both action.yml and action.yaml'));
      continue;
    }
    actions.set(dir, { doc: r.doc, file: relp(abs), refs });
  }
  for (const { file, refs } of actions.values()) {
    for (const a of refs) {
      if (!actions.has(a))
        out.push(v(file, a, `local action ./${a} not found (expected ${a}/action.yml)`));
    }
  }
  // An action installs if it, or any local action it uses (transitively), installs (S1.4 M3).
  const installs = new Map(); // dir → boolean, once resolved
  const cycles = new Set();
  const resolveInstalls = (dir, stack) => {
    if (installs.has(dir)) return installs.get(dir);
    const a = actions.get(dir);
    if (!a) return false; // reported as not found above
    if (stack.includes(dir)) {
      cycles.add([...stack.slice(stack.indexOf(dir)), dir].join(' -> '));
      return false;
    }
    let result = actionInstalls(a.doc);
    for (const ref of a.refs) if (resolveInstalls(ref, [...stack, dir])) result = true;
    installs.set(dir, result);
    return result;
  };
  for (const dir of actions.keys()) resolveInstalls(dir, []);
  for (const c of cycles)
    out.push(v('.github/actions', '', `local actions use each other in a cycle: ${c}`));
  const installActions = new Set([...installs].filter(([, i]) => i).map(([k]) => k));

  const wfDir = path.join(root, '.github', 'workflows');
  const workflows = existsSync(wfDir)
    ? readdirSync(wfDir)
        .filter((n) => /\.ya?ml$/.test(n) && statSync(path.join(wfDir, n)).isFile())
        .sort()
    : [];
  if (workflows.length === 0) {
    out.push(
      v('.github/workflows', '', 'no workflow files found (the check never passes vacuously)'),
    );
    return out;
  }
  const jobs = []; // { file, id, check } for every job in every workflow
  for (const name of workflows) {
    const abs = path.join(wfDir, name);
    const r = load(abs);
    if (!r) continue;
    const localActions = new Set();
    out.push(...checkWorkflow(r.doc, relp(abs), { installActions, localActions }));
    for (const a of localActions) {
      if (!actions.has(a))
        out.push(v(relp(abs), a, `local action ./${a} not found (expected ${a}/action.yml)`));
    }
    if (isObj(r.doc) && isObj(r.doc.jobs)) {
      for (const [id, job] of Object.entries(r.doc.jobs)) {
        const check = isObj(job) && job.name !== undefined ? job.name : id;
        jobs.push({ file: relp(abs), id, check });
      }
    }
  }
  // Each required check name must come from exactly one job, the one whose id is that name.
  for (const j of REQUIRED_JOBS) {
    const owners = jobs.filter((x) => x.id === j);
    if (owners.length === 0)
      out.push(
        v('.github/workflows', '', `required job "${j}" is missing (branch protection needs it)`),
      );
    const claimants = jobs.filter(
      (x) => requiredNameOf(x.id) === j || requiredNameOf(x.check) === j,
    );
    if (claimants.length > 1) {
      out.push(
        v(
          '.github/workflows',
          '',
          `required job "${j}" is reported by ${claimants.length} jobs (` +
            `${claimants.map((x) => `${x.file} jobs.${x.id}`).join(', ')}); exactly one may use it`,
        ),
      );
    }
  }
  return out;
}

function isMain() {
  if (!process.argv[1]) return false;
  const a = path.resolve(process.argv[1]);
  const b = fileURLToPath(import.meta.url);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

if (isMain()) {
  const root = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const violations = runChecks(root);
  for (const x of violations) {
    console.error(`check-workflows: ${x.file}${x.where ? ` (${x.where})` : ''}: ${x.message}`);
  }
  if (violations.length > 0) {
    console.error(`check-workflows: ${violations.length} violation(s) (spec §7.1, §7.2)`);
    process.exit(1);
  }
  console.log('check-workflows: OK');
}
