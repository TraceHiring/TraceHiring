#!/usr/bin/env node
// GitHub Actions hardening checks (spec specs/m0-foundations.md §7.1, §7.2, AT-12 local part).
// Reads .github/workflows/*.y{a,}ml and .github/actions/**/action.y{a,}ml and fails (exit 1) unless:
//   - triggers are only pull_request, push and workflow_dispatch (§7.1; d1 §7.1: a manual staging
//     deploy from d1/** and milestone/** proves staging before main moves); pull_request_target /
//     workflow_run are named
//   - workflow-level permissions are exactly `contents: read`; no job asks for more
//   - every remote `uses:` is pinned to a full 40-hex commit SHA (docker:// images to a sha256 digest);
//     local `./` actions (also those used by another local action) must exist under
//     .github/actions and pass the same rules; a cycle of local actions fails
//   - every actions/checkout step sets `persist-credentials: false` (and, in a required job, no
//     `ref:` or `repository:`, so the check tests the commit under review); static, security and
//     migrations check out with `fetch-depth: 0`; static sets MIGRATIONS_BASE=origin/main (§8.4)
//   - only deploy-staging and e2e-staging name an environment (environments hold the staging secrets)
//   - github.token (and the whole github context) counts as a secret (GITHUB_TOKEN); contexts
//     match case-insensitively, as GitHub evaluates them
//   - no job or step sets continue-on-error; the required jobs exist, have no `if:` on the job or
//     any of its steps, and no other job (in any workflow) reports a required check name; a job
//     `name:` must equal its id
//   - no bare CR, U+0085, U+2028 or U+2029 line break anywhere in the file
//   - every env: (workflow, job, step, composite-action step) is a mapping whose keys are all on
//     ENV_ALLOW_LIST; a whole-env expression or any other name fails (fail closed)
//   - secrets appear only in step-level env:/with: of deploy-staging and e2e-staging, never on or
//     before an install/build step, and each staging secret only on the steps that use it (§7.2,
//     §7.3); e2e-staging holds only the six E2E credentials, on its pinned Playwright step only
//   - e2e-staging (when present; d1 §7.1, AT-D1) has the exact needs / if / environment /
//     permissions and step list of E2E_STAGING_*: the preflight with the public contract only, the
//     Playwright step, then an always() upload of e2e/test-results without any trace.zip (7 days)
//   - deploy-staging (when present) has the exact needs / if / environment / concurrency of §7.2
//     (the if: admits a push on main, or a workflow_dispatch on d1/** or milestone/**, never a PR)
//   - deploy-staging's D1 chain (specs/d1-demo-slice.md §7.1, docs/reviews/D1-security-review-bindings.md
//     F4/F5): check-deploy-vars, then migrations, then ensure-staging-resources, then exactly three
//     `wrangler deploy --env staging` steps in the order services/api, workers/jobs, workers/edge
//     with the exact `--var NAME:$SOURCE` set per Worker, public values only from `vars.*`, then
//     check-staging-secrets; no wrangler delete anywhere in the job
//   - the scanned bundle is what ships (m0-foundations §7.2 step 5, S3B-1): every dry-run line is
//     exactly WORKER_BUILD_CMD and runs before scan-dist, scan-dist runs before the first Worker
//     deploy, every other line naming wrangler and deploy (any form, D1 security review S2) is
//     exactly WORKER_DEPLOY_CMD plus `--var`s (one per step) unless it is a plain
//     `wrangler pages deploy`, each Worker deploy step's whole run text is pinned (no cd, pushd,
//     --cwd, -c/--config, dlx or npx), and `wrangler versions` (an upload re-bundles) never runs
// No YAML library is a root dependency, so this file carries a small parser for the YAML subset
// workflows use (block mappings and sequences, plain/quoted/block scalars, flow collections).
// Anything outside that subset (anchors, aliases, tags, merge keys, multiple documents) is an
// error, so the check fails closed instead of misreading a file.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_VARS } from './check-deploy-vars.mjs';

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
// d1 §7.1 (D1-16): main deploys stay push-only; a manual dispatch may deploy from d1/** and
// milestone/** (staging proof before merge, build-notes §0 founder-queue walkthrough 2026-10-15).
// A pull_request run matches neither branch of the expression.
export const DEPLOY_IF =
  "(github.event_name == 'push' && github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch' && (startsWith(github.ref, 'refs/heads/d1/') || startsWith(github.ref, 'refs/heads/milestone/'))) && github.repository == 'TraceHiring/TraceHiring'";
export const DEPLOY_ENVIRONMENT = 'staging';
export const DEPLOY_CONCURRENCY = 'deploy-staging';
/**
 * DC-D9 and the Linux half of DC-D6 (specs/d1-demo-slice.md §7.1, §8): the local E2E stack
 * (scripts/e2e-local.mjs) runs in its own job on a manual dispatch with run_e2e, or on a pull
 * request from a d1/** branch (the draft PR from d1/integration), never on every PR, to spare the
 * free CI minutes. It holds no secret and no environment (the general rules), and its artifact is
 * only the Playwright report and test results (synthetic data), kept at most 7 days.
 */
export const E2E_JOB = 'e2e-local';
export const E2E_IF =
  "github.event_name == 'workflow_dispatch' && inputs.run_e2e || github.event_name == 'pull_request' && startsWith(github.head_ref, 'd1/') && github.event.pull_request.head.repo.full_name == github.repository";
export const E2E_MAX_MINUTES = 25;
export const E2E_RUNNER = 'ubuntu-24.04';
export const E2E_ARTIFACT_PATHS = Object.freeze(['e2e/playwright-report', 'e2e/test-results']);
export const E2E_ARTIFACT_MAX_DAYS = 7;
const E2E_RUN = /^\s*node scripts\/e2e-local\.mjs --ci\s*$/;

/**
 * d1 §7.1, AT-D1, AT-D20 (stream R5): the slice spec against staging. It runs after deploy-staging,
 * only on a manual dispatch from d1/** or milestone/** in this repository with run_e2e (the dispatch
 * half of DEPLOY_IF: never a push, never a pull request), in the staging environment, which holds
 * the E2E credentials. Its steps are pinned: checkout, setup, the Chromium cache and install, the
 * preflight (the public contract only, no secret), the Playwright step (the only one holding the six
 * credentials) and the upload of e2e/test-results without any trace.zip, kept at most 7 days.
 */
export const E2E_STAGING_JOB = 'e2e-staging';
export const E2E_STAGING_IF =
  "github.event_name == 'workflow_dispatch' && inputs.run_e2e && (startsWith(github.ref, 'refs/heads/d1/') || startsWith(github.ref, 'refs/heads/milestone/')) && github.repository == 'TraceHiring/TraceHiring'";
export const E2E_STAGING_MAX_MINUTES = 25;
export const E2E_STAGING_PREFLIGHT_CMD = 'pnpm e2e:staging:preflight';
export const E2E_STAGING_RUN_CMD =
  'pnpm --filter @trace/e2e exec playwright test tests/d1-slice.spec.ts --project staging';
const E2E_STAGING_RUN_RE =
  /^\s*pnpm --filter @trace\/e2e exec playwright test tests\/d1-slice\.spec\.ts --project staging\s*$/;
const E2E_CHROMIUM_CMD = 'pnpm --filter @trace/e2e exec playwright install --with-deps chromium';
/** Upload paths, in order: the results folder, minus any Playwright trace (d1 bindings review F8). */
export const E2E_STAGING_ARTIFACT_PATHS = Object.freeze([
  'e2e/test-results',
  '!e2e/test-results/**/trace.zip',
]);
/**
 * The public half of the E2E env contract (the four staging origins as literals, H4 label
 * `abhayraj`, like VITE_EDGE_ORIGIN; the Supabase pair from the public staging variables; the
 * deployed commit). The preflight step gets exactly this.
 */
export const E2E_STAGING_PREFLIGHT_ENV = Object.freeze({
  E2E_CANDIDATE_URL: 'https://trace-candidate-staging.pages.dev',
  E2E_RECRUITER_URL: 'https://trace-recruiter-staging.pages.dev',
  E2E_API_URL: 'https://trace-api-staging.abhayraj.workers.dev',
  E2E_EDGE_URL: 'https://trace-edge-staging.abhayraj.workers.dev',
  E2E_SUPABASE_URL: '${{ vars.SUPABASE_STAGING_URL }}',
  E2E_SUPABASE_PUBLISHABLE_KEY: '${{ vars.SUPABASE_STAGING_PUBLISHABLE_KEY }}',
  E2E_SHA: '${{ github.sha }}',
});
/** The Playwright step's env: the staging flag, the public contract and the six credentials. */
export const E2E_STAGING_PLAYWRIGHT_ENV = Object.freeze({
  E2E_STAGING: '1',
  ...E2E_STAGING_PREFLIGHT_ENV,
  // The H9 recruiter smoke user (m0b AT-B9) and the D1 reviewer smoke user (FOUNDER-QUEUE "D1: a
  // staging reviewer smoke user with TOTP"; scripts/ops/enrol-smoke-user.mjs --roles reviewer).
  E2E_RECRUITER_EMAIL: '${{ secrets.STAGING_SMOKE_EMAIL }}',
  E2E_RECRUITER_PASSWORD: '${{ secrets.STAGING_SMOKE_PASSWORD }}',
  E2E_RECRUITER_TOTP_SECRET: '${{ secrets.STAGING_SMOKE_TOTP_SECRET }}',
  E2E_REVIEWER_EMAIL: '${{ secrets.STAGING_REVIEWER_EMAIL }}',
  E2E_REVIEWER_PASSWORD: '${{ secrets.STAGING_REVIEWER_PASSWORD }}',
  E2E_REVIEWER_TOTP_SECRET: '${{ secrets.STAGING_REVIEWER_TOTP_SECRET }}',
});
/** Names that may be set only in the env: of the e2e-staging preflight and Playwright steps. */
export const E2E_STAGING_ONLY_ENV = Object.freeze(Object.keys(E2E_STAGING_PLAYWRIGHT_ENV));
/**
 * The secrets e2e-staging may hold and the command a step must run to hold one: the Playwright step
 * only, whose whole run text is that one command (no other line, flag or comment can read them).
 */
export const E2E_STAGING_SECRET_USERS = Object.freeze({
  STAGING_SMOKE_EMAIL: [E2E_STAGING_RUN_RE],
  STAGING_SMOKE_PASSWORD: [E2E_STAGING_RUN_RE],
  STAGING_SMOKE_TOTP_SECRET: [E2E_STAGING_RUN_RE],
  STAGING_REVIEWER_EMAIL: [E2E_STAGING_RUN_RE],
  STAGING_REVIEWER_PASSWORD: [E2E_STAGING_RUN_RE],
  STAGING_REVIEWER_TOTP_SECRET: [E2E_STAGING_RUN_RE],
});
export const WORKFLOW_PERMISSIONS = { contents: 'read' };
export const FORBIDDEN_TRIGGERS = ['pull_request_target', 'workflow_run'];
export const ALLOWED_TRIGGERS = ['pull_request', 'push', 'workflow_dispatch'];
/** Jobs whose checkout needs the full history (§7.1: static and security; §7.1 table: migrations). */
export const FULL_HISTORY_JOBS = ['static', 'security', 'migrations'];
export const MIGRATIONS_BASE = 'origin/main';

/** The org sign-in smoke step's entire run text (m0b AT-B9). */
const SMOKE_AUTH_RUN = /^\s*node scripts\/smoke-staging-auth\.mjs\s*$/;

// d1 §7.1: the two scripts of the deploy chain. Each step's whole run text is that one command, so
// no extra line, flag or comment can reach the Cloudflare token or skip the guard.
const GUARD_RUN = /^\s*node scripts\/check-deploy-vars\.mjs\s*$/;
const RESOURCES_RUN = /^\s*node scripts\/ensure-staging-resources\.mjs\s*$/;

/** §7.3 staging secrets and the commands a step must run to be allowed to hold each one (§7.2). */
export const STAGING_SECRET_USERS = {
  SUPABASE_STAGING_DB_URL: [/\bsupabase\s+db\s+push\b/, /\bpsql\b/],
  // wrangler (deploy, pages), check-staging-secrets, and d1 §7.1's bucket and queue creation.
  CLOUDFLARE_API_TOKEN: [/\bwrangler\b/, /\bcheck-staging-secrets\b/, RESOURCES_RUN],
  // specs/m0b-tenancy.md AT-B9, AT-B10 [R5]: the org sign-in smoke step only, whose whole run text
  // is that one command (no other line, comment or argument can read the secrets; B4-SEC-2).
  STAGING_SMOKE_EMAIL: [SMOKE_AUTH_RUN],
  STAGING_SMOKE_PASSWORD: [SMOKE_AUTH_RUN],
  STAGING_SMOKE_TOTP_SECRET: [SMOKE_AUTH_RUN],
};

/** The jobs that may hold secrets, each with its own list (a secret on no list, or off it, fails). */
const SECRET_USERS_BY_JOB = Object.freeze({
  [DEPLOY_JOB]: { list: '§7.3 staging', users: STAGING_SECRET_USERS },
  [E2E_STAGING_JOB]: {
    list: `${E2E_STAGING_JOB} (Playwright step only)`,
    users: E2E_STAGING_SECRET_USERS,
  },
});

/**
 * Build variables the recruiter bundle reads (specs/m0b-tenancy.md §2.7): set only on the
 * deploy-staging build step, and only from these public staging variables (never a secret), so
 * every other build (local, CI static) has none and the app shows "not configured".
 */
export const BUILD_ONLY_ENV = Object.freeze({
  VITE_SUPABASE_URL: '${{ vars.SUPABASE_STAGING_URL }}',
  VITE_SUPABASE_PUBLISHABLE_KEY: '${{ vars.SUPABASE_STAGING_PUBLISHABLE_KEY }}',
  // d1 AT-D22 (m0-foundations §7.3): the recruiter's Sentry DSN, a public value (H6).
  VITE_SENTRY_DSN: '${{ vars.VITE_SENTRY_DSN }}',
  // d1 §7.1 check-headers: the recruiter CSP's connect-src api origin
  // (https://trace-api-staging.<label>.workers.dev), a public value; unset drops the CSP token.
  VITE_API_ORIGIN: '${{ vars.API_STAGING_ORIGIN }}',
  // d1 §6.1, AT-D18: only the staging recruiter build includes the demo outbox (mock Messaging); every other
  // build is production-flavour and is checked by scripts/check-no-demo-outbox.mjs.
  VITE_DEMO_OUTBOX: '1',
  // d1 §4.7: the candidate app's edge origin, the same literal its public/_headers connect-src names
  // (H4 label `abhayraj`, docs/infra/environments.md); a public value, so no variable is needed.
  VITE_EDGE_ORIGIN: 'https://trace-edge-staging.abhayraj.workers.dev',
  // d1 AT-D18 (SEC-W2-1): the recruiter registers the demo outbox only for VITE_DEMO_OUTBOX=1 with
  // VITE_TRACE_ENV exactly dev or staging (an allow-list); the staging build says staging explicitly.
  VITE_TRACE_ENV: 'staging',
});

/**
 * Public values the deploy-staging steps read (d1 §7.1, review F4): wrangler.jsonc ships them as
 * empty placeholders and `wrangler deploy` replaces dashboard vars, so the deploy passes them with
 * `--var` from GitHub variables. Wherever one is set in a deploy-staging step's env:, it must be
 * exactly its `vars.*` expression: never a secret (they are public) and never a literal.
 */
export const PUBLIC_DEPLOY_ENV = Object.freeze({
  CANDIDATE_TOKEN_KID: '${{ vars.CANDIDATE_TOKEN_KID }}',
  CANDIDATE_TOKEN_PUBLIC_JWK: '${{ vars.CANDIDATE_TOKEN_PUBLIC_JWK }}',
  SENTRY_DSN_WORKERS: '${{ vars.SENTRY_DSN_WORKERS }}',
  SUPABASE_STAGING_URL: '${{ vars.SUPABASE_STAGING_URL }}',
  SUPABASE_STAGING_PUBLISHABLE_KEY: '${{ vars.SUPABASE_STAGING_PUBLISHABLE_KEY }}',
  // Security review S8: check-deploy-vars pins it to the exact staging api origin.
  API_STAGING_ORIGIN: '${{ vars.API_STAGING_ORIGIN }}',
});

/** What the guard step must see: exactly the variables scripts/check-deploy-vars.mjs requires. */
export const DEPLOY_GUARD_ENV = REQUIRED_VARS;

/**
 * S3B-1 (m0-foundations §7.2 step 5): the no-secret build step writes each Worker's staging bundle
 * into its dist/ with WORKER_BUILD_CMD, scan-dist scans it, and each Worker deploy uploads exactly
 * that dist/index.js with WORKER_DEPLOY_CMD (plus its `--var`s), so the deployed bytes are the
 * scanned bytes. wrangler --no-bundle still applies the env block's bindings, DO migrations, queue
 * producers and consumers and crons: they come from the wrangler.jsonc env, not from the build.
 */
export const WORKER_BUILD_CMD = 'pnpm exec wrangler deploy --dry-run --env staging --outdir dist';
export const WORKER_DEPLOY_CMD =
  'pnpm exec wrangler deploy dist/index.js --no-bundle --env staging';
const SCAN_RUN = /^\s*node scripts\/scan-dist\.mjs\s*$/;

/**
 * The three Worker deploys in the order spec §7.1 requires (edge's service binding targets api, so
 * api first). `vars` maps each `--var NAME` to the shell variable that must feed it, exactly:
 * `--var "NAME:$SOURCE"`. These are the wrangler.jsonc vars the deploy supplies (empty
 * placeholders or "dev"): VERSION everywhere, the Sentry DSN to jobs and api only (never edge,
 * m0-foundations §9.2), the candidate-token public values and the Supabase pair as the bindings
 * table (d1 §4.2) assigns them. Changing the set is a spec change.
 */
export const WORKER_DEPLOYS = Object.freeze([
  {
    dir: 'services/api',
    vars: {
      VERSION: 'GITHUB_SHA',
      SENTRY_DSN_WORKERS: 'SENTRY_DSN_WORKERS',
      CANDIDATE_TOKEN_KID: 'CANDIDATE_TOKEN_KID',
      CANDIDATE_TOKEN_PUBLIC_JWK: 'CANDIDATE_TOKEN_PUBLIC_JWK',
      SUPABASE_URL: 'SUPABASE_STAGING_URL',
      SUPABASE_PUBLISHABLE_KEY: 'SUPABASE_STAGING_PUBLISHABLE_KEY',
    },
  },
  {
    dir: 'workers/jobs',
    vars: { VERSION: 'GITHUB_SHA', SENTRY_DSN_WORKERS: 'SENTRY_DSN_WORKERS' },
  },
  {
    dir: 'workers/edge',
    vars: { VERSION: 'GITHUB_SHA', CANDIDATE_TOKEN_PUBLIC_JWK: 'CANDIDATE_TOKEN_PUBLIC_JWK' },
  },
]);

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
  'VITE_SENTRY_DSN',
  // d1 §7.1 check-headers: the recruiter CSP api origin, the deploy-staging build step only.
  'VITE_API_ORIGIN',
  // d1 §6.1, AT-D18: the staging recruiter build's demo-outbox flag, the deploy-staging build step only.
  'VITE_DEMO_OUTBOX',
  // d1 §4.7: the candidate app's edge origin, the deploy-staging build step only.
  'VITE_EDGE_ORIGIN',
  // d1 AT-D18 (SEC-W2-1): the deploy flavour of the staging recruiter build, the deploy-staging build step only.
  'VITE_TRACE_ENV',
  // The check-deploy-vars step reads the same public variable (security review S8).
  'API_STAGING_ORIGIN',
  // d1 AT-D22 (specs/d1-demo-slice.md §7.1, L-24): the Workers deploy step passes it to jobs and api
  // only, as a var (a DSN is public, not a secret).
  'SENTRY_DSN_WORKERS',
  // d1 §7.1 (security review F4): the candidate-token public values. The check-deploy-vars step and
  // the api/edge deploy steps read them (PUBLIC_DEPLOY_ENV: exactly a GitHub variable, never a secret).
  'CANDIDATE_TOKEN_KID',
  'CANDIDATE_TOKEN_PUBLIC_JWK',
  // specs/m0b-tenancy.md AT-B9 [R5]: the org sign-in smoke step (public variables, then the three
  // smoke secrets bound by STAGING_SECRET_USERS).
  'SUPABASE_STAGING_URL',
  'SUPABASE_STAGING_PUBLISHABLE_KEY',
  'STAGING_SMOKE_EMAIL',
  'STAGING_SMOKE_PASSWORD',
  'STAGING_SMOKE_TOTP_SECRET',
  // d1 §7.1, AT-D1 (R5): the e2e-staging env contract (E2E_STAGING_PLAYWRIGHT_ENV), set only on that
  // job's preflight step (the public names) and Playwright step (all of them, the credentials bound
  // by E2E_STAGING_SECRET_USERS); E2E_STAGING_ONLY_ENV refuses them anywhere else. E2E_TRACE is not
  // listed, so no workflow can turn Playwright traces on.
  ...E2E_STAGING_ONLY_ENV,
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
  // Security review S7: GitHub expands ${{ }} into the script text before bash runs it, so an
  // attacker-chosen value (a branch name, a PR title) would become code. Values go through env:.
  if (run.includes('${{')) {
    out.push(
      v(file, where, 'run: may not contain a ${{ }} expression; pass the value through env:'),
    );
  }
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
    if (job.environment !== undefined && name !== DEPLOY_JOB && name !== E2E_STAGING_JOB) {
      out.push(
        v(
          file,
          where,
          `only ${DEPLOY_JOB} may use an environment: (it holds secrets), and ${E2E_STAGING_JOB} for its E2E credentials`,
        ),
      );
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
      const allowed = Object.hasOwn(SECRET_USERS_BY_JOB, name) ? SECRET_USERS_BY_JOB[name] : null;
      if (allowed === null) {
        out.push(
          v(
            file,
            sw,
            `secrets (${all.join(', ')}) are not allowed outside ${DEPLOY_JOB} (and the ${E2E_STAGING_JOB} Playwright step); pull requests run this job`,
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
        const users = Object.hasOwn(allowed.users, s) ? allowed.users[s] : undefined;
        if (!users)
          out.push(
            v(
              file,
              sw,
              `secret ${s === '*' ? 'context (all secrets)' : s} is not on the ${allowed.list} list`,
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
    checkDeployChain(d, where, file, out);
  }
  checkE2eLocal(doc, file, out);
  checkE2eStaging(doc, file, out);
  if (isObj(doc.jobs[E2E_JOB]) || isObj(doc.jobs[E2E_STAGING_JOB]))
    checkRunE2eInput(doc, file, out);
  checkBuildOnlyEnv(doc, file, out);
  checkE2eStagingOnlyEnv(doc, file, out);
  return out;
}

const DRY_RUN_RE = /--dry-run\b/;
const WRANGLER_DELETE_RE = /\bwrangler\b[^\n]*\b(?:delete|remove)\b/;
const WRANGLER_VERSIONS_RE = /\bwrangler\s+versions\b/;
// Bash removes a backslash-newline outright (no space), so `wrang\<newline>ler` is `wrangler`
// (S2 re-review L1).
const joinContinuations = (run) => run.replace(/\\\r?\n/g, '');
/** A step's run text as commands: continuations joined, one per line, whitespace normalised. */
const commandLines = (run) =>
  joinContinuations(run)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '');
/** The dry-run line is exactly WORKER_BUILD_CMD, bare or as `(cd "$dir" && …)` (S2: nothing else on it). */
const isDryRunBuild = (line) =>
  line === WORKER_BUILD_CMD || line === `(cd "$dir" && ${WORKER_BUILD_CMD})`;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SCANNED_DEPLOY_LINE = new RegExp(`^${escapeRe(WORKER_DEPLOY_CMD)}(?: --var "[^"]*")*$`);
/**
 * Security review S2: any command line naming both wrangler and deploy is a deploy line, whatever
 * its form (`wrangler --env staging deploy`, `pnpm dlx wrangler@… deploy`, a `-c` config). Only a
 * plain `pnpm exec wrangler pages deploy` with no shell syntax (so no second command) is not one.
 */
const isWranglerDeployLine = (line) => /\bwrangler\b/.test(line) && /\bdeploy\b/.test(line);
const PAGES_DEPLOY_LINE = /^pnpm exec wrangler pages deploy [\w./ =-]+$/;
/** The run text of a Worker deploy step, before its deploy line (S2: the whole step is pinned). */
export const WORKER_DEPLOY_STEP_PREFIX = Object.freeze([
  'set -euo pipefail',
  'export WRANGLER_OUTPUT_FILE_PATH="$RUNNER_TEMP/wrangler-output.ndjson"',
]);
/**
 * The Pages deploy step's whole run text, as command lines (S2 re-review L1): with the Cloudflare
 * token, any other line could deploy a Worker without spelling `wrangler deploy` (`de''ploy`, a
 * variable, a backslash-newline split), so the step is pinned like the Worker deploy steps.
 */
export const PAGES_STEP_LINES = Object.freeze([
  'set -euo pipefail',
  'export WRANGLER_OUTPUT_FILE_PATH="$RUNNER_TEMP/wrangler-output.ndjson"',
  'projects="$(pnpm exec wrangler pages project list --json)"',
  `jq -e 'type == "array"' <<<"$projects" >/dev/null`,
  'for project in trace-candidate-staging trace-recruiter-staging; do',
  `if ! jq -e --arg p "$project" 'any(.[]; .["Project Name"] == $p)' <<<"$projects" >/dev/null; then`,
  'pnpm exec wrangler pages project create "$project" --production-branch main',
  'fi',
  'done',
  'pnpm exec wrangler pages deploy apps/candidate/dist --project-name trace-candidate-staging --branch main',
  'pnpm exec wrangler pages deploy apps/recruiter/dist --project-name trace-recruiter-staging --branch main',
]);
const SECRETS_CHECK_LINE = 'node scripts/check-staging-secrets.mjs';
/** Words that change where or what a Worker deploy step runs (S2), each with its own pattern. */
const WORKER_DEPLOY_FORBIDDEN = Object.freeze([
  ['cd', /(?:^|[\s;&|(])cd(?:\s|$)/m],
  ['pushd', /(?:^|[\s;&|(])pushd(?:\s|$)/m],
  ['--cwd', /(?:^|\s)--cwd(?:[\s=]|$)/m],
  ['-c', /(?:^|\s)-c(?:[\s=]|$)/m],
  ['--config', /(?:^|\s)--config(?:[\s=]|$)/m],
  ['dlx', /\bdlx\b/],
  ['npx', /\bnpx\b/],
]);

/**
 * deploy-staging's D1 chain (specs/d1-demo-slice.md §7.1; docs/reviews/D1-security-review-bindings.md
 * F4, F5): the public-variable guard, then migrations, then bucket and queue creation, then exactly
 * three Worker deploys in the order api, jobs, edge, each `--env staging` with its exact `--var` set
 * from GitHub variables, then check-staging-secrets. `d` is the job; `where` is `jobs.deploy-staging`.
 */
function checkDeployChain(d, where, file, out) {
  const steps = Array.isArray(d.steps) ? d.steps : [];
  const runOf = (s) => (isObj(s) && typeof s.run === 'string' ? s.run : '');
  const indexOf = (pred) => steps.findIndex((s) => pred(s));
  const sw = (i) => `${where}.steps[${i}]`;

  // Public values: wherever a deploy-staging step sets one, it is exactly its GitHub variable.
  steps.forEach((s, i) => {
    if (!isObj(s) || !isObj(s.env)) return;
    for (const [name, want] of Object.entries(PUBLIC_DEPLOY_ENV)) {
      if (Object.hasOwn(s.env, name) && normExpr(s.env[name]) !== normExpr(want)) {
        out.push(
          v(
            file,
            sw(i),
            `env: ${name} must be exactly ${want} (a public GitHub variable; never a secret or a literal)`,
          ),
        );
      }
    }
    // CI never deletes a staging resource (F5: create only if missing).
    if (WRANGLER_DELETE_RE.test(joinContinuations(runOf(s)))) {
      out.push(
        v(
          file,
          sw(i),
          'wrangler delete commands are not allowed in deploy-staging (CI only creates staging resources, never removes them)',
        ),
      );
    }
  });

  // S3B-1 and S2: classify every command line naming wrangler and deploy (except a plain
  // `wrangler pages deploy`). A dry-run line builds a staging bundle into dist/; any other is a
  // Worker deploy and must upload exactly that scanned dist/index.js. A step is a Worker deploy
  // step if it holds one such line.
  const lines = steps.map((s) => commandLines(runOf(s)));
  const dryRunSteps = [];
  const deploys = [];
  lines.forEach((ls, i) => {
    const wranglerDeploys = ls.filter((l) => isWranglerDeployLine(l) && !PAGES_DEPLOY_LINE.test(l));
    const real = wranglerDeploys.filter((l) => !DRY_RUN_RE.test(l));
    for (const l of wranglerDeploys) {
      if (DRY_RUN_RE.test(l) && !isDryRunBuild(l)) {
        out.push(
          v(
            file,
            sw(i),
            `a dry-run build must be exactly ${WORKER_BUILD_CMD} (S3B-1: each Worker's staging bundle, into the dist/ that scan-dist scans)`,
          ),
        );
      } else if (!DRY_RUN_RE.test(l) && !SCANNED_DEPLOY_LINE.test(l)) {
        out.push(
          v(
            file,
            sw(i),
            `a line with wrangler and deploy must be a plain wrangler pages deploy, the dry-run build or exactly ${WORKER_DEPLOY_CMD} followed only by --var "NAME:$SOURCE" (S3B-1, S2: --no-bundle uploads the dist/index.js that scan-dist checked; any other form re-bundles)`,
          ),
        );
      }
    }
    if (wranglerDeploys.length > real.length) dryRunSteps.push(i);
    if (real.length > 1) {
      out.push(v(file, sw(i), 'a Worker deploy step must run exactly one wrangler deploy (S3B-1)'));
    }
    if (real.length > 0) deploys.push([steps[i], i]);
    if (ls.some((l) => WRANGLER_VERSIONS_RE.test(l))) {
      out.push(
        v(
          file,
          sw(i),
          'wrangler versions is not allowed in deploy-staging (an upload re-bundles; the scanned dist/index.js must be what ships, S3B-1)',
        ),
      );
    }
  });
  // S2 re-review L1: a step holding the Cloudflare token is one of the Worker deploy steps (pinned
  // below), or its whole run text is the bucket and queue step, the secrets check or the pinned
  // Pages step. No other command may run next to the token.
  const sameLines = (ls, want) => ls.length === want.length && want.every((l, k) => ls[k] === l);
  steps.forEach((s, i) => {
    if (!isObj(s) || !secretRefs(s).includes('CLOUDFLARE_API_TOKEN')) return;
    const ls = lines[i];
    const allowed =
      deploys.some(([step]) => step === s) ||
      (ls.length === 1 && RESOURCES_RUN.test(ls[0])) ||
      sameLines(ls, [SECRETS_CHECK_LINE]) ||
      sameLines(ls, PAGES_STEP_LINES);
    if (!allowed) {
      out.push(
        v(
          file,
          sw(i),
          'a step holding CLOUDFLARE_API_TOKEN must be a pinned Worker deploy step, or exactly node scripts/ensure-staging-resources.mjs, node scripts/check-staging-secrets.mjs or the pinned Pages deploy (PAGES_STEP_LINES; S2 re-review L1)',
        ),
      );
    }
  });
  const firstDeploy = deploys.length > 0 ? deploys[0][1] : -1;
  const scan = indexOf((s) => SCAN_RUN.test(runOf(s)));
  if (dryRunSteps.length === 0) {
    out.push(
      v(
        file,
        where,
        `the staging Worker bundles must be built with the dry-run ${WORKER_BUILD_CMD} before scan-dist (S3B-1)`,
      ),
    );
  } else if (scan >= 0 && Math.max(...dryRunSteps) > scan) {
    out.push(
      v(
        file,
        sw(Math.max(...dryRunSteps)),
        'every dry-run build must come before scan-dist (S3B-1: a later build would ship bytes that were never scanned)',
      ),
    );
  }
  if (scan < 0) {
    out.push(
      v(
        file,
        where,
        'a step must run exactly node scripts/scan-dist.mjs before the first Worker deploy (S3B-1)',
      ),
    );
  } else if (firstDeploy >= 0 && scan > firstDeploy) {
    out.push(
      v(
        file,
        sw(scan),
        'node scripts/scan-dist.mjs must run before the first Worker deploy (S3B-1)',
      ),
    );
  }

  // The guard: exactly check-deploy-vars, seeing the four required variables, before the migrations
  // and before every Worker deploy.
  const guard = indexOf((s) => GUARD_RUN.test(runOf(s)));
  const migrate = indexOf((s) => /\bsupabase\s+db\s+push\b/.test(runOf(s)));
  if (guard < 0) {
    out.push(
      v(
        file,
        where,
        'a step must run exactly node scripts/check-deploy-vars.mjs (it fails the deploy on an empty public variable or a private JWK member, F4)',
      ),
    );
  } else {
    if ((migrate >= 0 && guard > migrate) || (firstDeploy >= 0 && guard > firstDeploy)) {
      out.push(
        v(
          file,
          sw(guard),
          'node scripts/check-deploy-vars.mjs must run before the migrations and before the Worker deploys',
        ),
      );
    }
    const env = isObj(steps[guard].env) ? steps[guard].env : {};
    for (const name of DEPLOY_GUARD_ENV) {
      if (!Object.hasOwn(env, name)) {
        out.push(
          v(
            file,
            sw(guard),
            `the check-deploy-vars step must set ${name} in env: (${PUBLIC_DEPLOY_ENV[name]})`,
          ),
        );
      }
    }
  }

  // Bucket and queue creation, before the first Worker deploy.
  const resources = indexOf((s) => RESOURCES_RUN.test(runOf(s)));
  if (resources < 0) {
    out.push(
      v(
        file,
        where,
        'a step must run exactly node scripts/ensure-staging-resources.mjs (idempotent bucket and queue creation, F5)',
      ),
    );
  } else if (firstDeploy >= 0 && resources > firstDeploy) {
    out.push(
      v(
        file,
        sw(resources),
        'node scripts/ensure-staging-resources.mjs must run before the first Worker deploy',
      ),
    );
  }

  // Exactly three Worker deploys, in order.
  const order = WORKER_DEPLOYS.map((w) => w.dir);
  const dirs = deploys.map(([s]) => (isObj(s) ? s['working-directory'] : undefined));
  if (JSON.stringify(dirs) !== JSON.stringify(order)) {
    out.push(
      v(
        file,
        where,
        `deploy-staging must run exactly three wrangler deploy steps, in the order ${order.join(', ')} (a service-binding target must exist first), each with working-directory: set to its Worker; found ${dirs.length === 0 ? 'none' : dirs.map((x) => x ?? '(none)').join(', ')}`,
      ),
    );
  } else {
    deploys.forEach(([step, i], k) => checkWorkerDeploy(step, sw(i), WORKER_DEPLOYS[k], file, out));
  }

  // check-staging-secrets stays, after the last deploy.
  const secrets = indexOf((s) => /\bcheck-staging-secrets\b/.test(runOf(s)));
  const lastDeploy = deploys.length > 0 ? deploys[deploys.length - 1][1] : -1;
  if (secrets < 0 || secrets < lastDeploy) {
    out.push(
      v(file, where, 'check-staging-secrets must run after the last Worker deploy (§7.2 step 6)'),
    );
  }
}

/**
 * The e2e-local job (E2E_JOB; DC-D9): its exact if:, runner and time limit, no container or
 * services, one unconditional step running exactly `node scripts/e2e-local.mjs --ci`, artifacts
 * only from E2E_ARTIFACT_PATHS and kept at most E2E_ARTIFACT_MAX_DAYS (checkRunE2eInput pins the
 * run_e2e dispatch input it reads). Secrets and environments are already refused for every job but
 * deploy-staging and e2e-staging.
 */
function checkE2eLocal(doc, file, out) {
  const j = doc.jobs[E2E_JOB];
  if (!isObj(j)) return;
  const where = `jobs.${E2E_JOB}`;
  if (typeof j.if !== 'string' || normExpr(j.if) !== normExpr(E2E_IF)) {
    out.push(v(file, where, `${E2E_JOB} must have exactly if: ${E2E_IF}`));
  }
  if (j['runs-on'] !== E2E_RUNNER) {
    out.push(v(file, where, `${E2E_JOB} must run on ${E2E_RUNNER}`));
  }
  const t = j['timeout-minutes'];
  if (typeof t !== 'number' || !Number.isInteger(t) || t < 1 || t > E2E_MAX_MINUTES) {
    out.push(
      v(file, where, `${E2E_JOB} must set timeout-minutes: 1 to ${E2E_MAX_MINUTES} (DC-D9)`),
    );
  }
  if (j.container !== undefined || j.services !== undefined) {
    out.push(v(file, where, `${E2E_JOB} may not use container: or services:`));
  }
  const steps = Array.isArray(j.steps) ? j.steps : [];
  const runs = steps.filter(
    (s) => isObj(s) && typeof s.run === 'string' && /e2e-local\.mjs/.test(s.run),
  );
  if (runs.length !== 1 || !E2E_RUN.test(runs[0].run) || runs[0].if !== undefined) {
    out.push(
      v(
        file,
        where,
        `${E2E_JOB} must run exactly node scripts/e2e-local.mjs --ci in one step with no if:`,
      ),
    );
  }
  steps.forEach((s, i) => {
    if (!isObj(s) || typeof s.uses !== 'string' || !/^actions\/upload-artifact@/i.test(s.uses)) {
      return;
    }
    const w = isObj(s.with) ? s.with : {};
    const paths =
      typeof w.path === 'string'
        ? w.path
            .split(/\r?\n/)
            .map((p) => p.trim())
            .filter((p) => p !== '')
        : [];
    const days = w['retention-days'];
    const ok =
      paths.length > 0 &&
      paths.every((p) => E2E_ARTIFACT_PATHS.includes(p)) &&
      typeof days === 'number' &&
      Number.isInteger(days) &&
      days >= 1 &&
      days <= E2E_ARTIFACT_MAX_DAYS;
    if (!ok) {
      out.push(
        v(
          file,
          `${where}.steps[${i}]`,
          `${E2E_JOB} artifacts must be only ${E2E_ARTIFACT_PATHS.join(' and ')}, kept at most ${E2E_ARTIFACT_MAX_DAYS} days (retention-days; synthetic data only)`,
        ),
      );
    }
  });
}

/** The e2e jobs read inputs.run_e2e; the dispatch declares exactly that one input. */
function checkRunE2eInput(doc, file, out) {
  const wd = isObj(doc.on) ? doc.on.workflow_dispatch : undefined;
  const inputs = isObj(wd) && isObj(wd.inputs) ? wd.inputs : undefined;
  const runE2e = inputs !== undefined && isObj(inputs.run_e2e) ? inputs.run_e2e : undefined;
  if (
    inputs === undefined ||
    Object.keys(inputs).length !== 1 ||
    runE2e === undefined ||
    runE2e.type !== 'boolean' ||
    runE2e.default !== true
  ) {
    out.push(
      v(
        file,
        'on.workflow_dispatch',
        'workflow_dispatch must declare exactly one input, run_e2e (type: boolean, default: true)',
      ),
    );
  }
}

/** Is `env` exactly the mapping `want` (same keys; values equal as expressions)? */
const sameEnv = (env, want) =>
  isObj(env) &&
  Object.keys(env).length === Object.keys(want).length &&
  Object.entries(want).every(
    ([k, val]) => Object.hasOwn(env, k) && normExpr(env[k]) === normExpr(val),
  );

/** The upload paths of an upload-artifact step's `with.path`, one per line, trimmed. */
const artifactPaths = (w) =>
  typeof w.path === 'string'
    ? w.path
        .split(/\r?\n/)
        .map((p) => p.trim())
        .filter((p) => p !== '')
    : [];

/**
 * The e2e-staging job (E2E_STAGING_JOB; d1 §7.1, AT-D1, AT-D20): its exact needs, if:, environment,
 * permissions, runner and time limit, no container or services, and a pinned step list. The
 * preflight runs exactly E2E_STAGING_PREFLIGHT_CMD with exactly E2E_STAGING_PREFLIGHT_ENV (no secret),
 * before the one Playwright step, which runs exactly E2E_STAGING_RUN_CMD with exactly
 * E2E_STAGING_PLAYWRIGHT_ENV; the general secret rules bind the credentials to that command
 * (E2E_STAGING_SECRET_USERS). Then one `if: always()` upload of exactly E2E_STAGING_ARTIFACT_PATHS
 * (no trace.zip), kept at most 7 days. No other step, if: or working-directory.
 */
function checkE2eStaging(doc, file, out) {
  const j = doc.jobs[E2E_STAGING_JOB];
  if (!isObj(j)) return;
  const where = `jobs.${E2E_STAGING_JOB}`;
  const sw = (i) => `${where}.steps[${i}]`;
  const needs = typeof j.needs === 'string' ? [j.needs] : Array.isArray(j.needs) ? j.needs : [];
  if (needs.length !== 1 || needs[0] !== DEPLOY_JOB) {
    out.push(
      v(file, where, `${E2E_STAGING_JOB} must have needs: ${DEPLOY_JOB} (and nothing else)`),
    );
  }
  if (typeof j.if !== 'string' || normExpr(j.if) !== normExpr(E2E_STAGING_IF)) {
    out.push(v(file, where, `${E2E_STAGING_JOB} must have exactly if: ${E2E_STAGING_IF}`));
  }
  const env = isObj(j.environment) ? j.environment.name : j.environment;
  if (env !== DEPLOY_ENVIRONMENT) {
    out.push(v(file, where, `${E2E_STAGING_JOB} must use environment: ${DEPLOY_ENVIRONMENT}`));
  }
  if (
    !isObj(j.permissions) ||
    JSON.stringify(Object.entries(j.permissions).sort()) !==
      JSON.stringify(Object.entries(WORKFLOW_PERMISSIONS))
  ) {
    out.push(v(file, where, `${E2E_STAGING_JOB} must set permissions: { contents: read }`));
  }
  if (j['runs-on'] !== E2E_RUNNER) {
    out.push(v(file, where, `${E2E_STAGING_JOB} must run on ${E2E_RUNNER}`));
  }
  const t = j['timeout-minutes'];
  if (typeof t !== 'number' || !Number.isInteger(t) || t < 1 || t > E2E_STAGING_MAX_MINUTES) {
    out.push(
      v(
        file,
        where,
        `${E2E_STAGING_JOB} must set timeout-minutes: 1 to ${E2E_STAGING_MAX_MINUTES}`,
      ),
    );
  }
  if (j.container !== undefined || j.services !== undefined) {
    out.push(v(file, where, `${E2E_STAGING_JOB} may not use container: or services:`));
  }

  const steps = Array.isArray(j.steps) ? j.steps : [];
  const runOf = (s) => (isObj(s) && typeof s.run === 'string' ? s.run : '');
  const usesOf = (s) => (isObj(s) && typeof s.uses === 'string' ? s.uses : '');
  const preflights = [];
  const playwrights = [];
  const uploads = [];
  steps.forEach((s, i) => {
    if (!isObj(s)) return;
    const run = runOf(s);
    const uses = usesOf(s);
    if (/e2e:staging:preflight/.test(run)) preflights.push(i);
    if (/playwright\s+test/.test(run)) playwrights.push(i);
    if (/^actions\/upload-artifact@/i.test(uses)) uploads.push(i);
    // Every step is one of the pinned kinds.
    const known =
      (s.run === undefined &&
        (/^actions\/(?:checkout|cache|upload-artifact)@/i.test(uses) ||
          uses === './.github/actions/setup')) ||
      (s.uses === undefined &&
        (run.trim() === E2E_CHROMIUM_CMD ||
          /e2e:staging:preflight/.test(run) ||
          /playwright\s+test/.test(run)));
    if (!known) {
      out.push(
        v(
          file,
          sw(i),
          `${E2E_STAGING_JOB} may only run its pinned steps: checkout, ./.github/actions/setup, the Playwright browser cache, ${E2E_CHROMIUM_CMD}, ${E2E_STAGING_PREFLIGHT_CMD}, ${E2E_STAGING_RUN_CMD} and the upload`,
        ),
      );
    }
    if (s['working-directory'] !== undefined) {
      out.push(
        v(
          file,
          sw(i),
          `${E2E_STAGING_JOB} may only run its steps from the repository root (no working-directory:)`,
        ),
      );
    }
    if (s.if !== undefined && !uploads.includes(i)) {
      out.push(v(file, sw(i), `${E2E_STAGING_JOB} may only put an if: on the upload step`));
    }
    // The checkout tests the deployed commit: no other ref or repository.
    if (/^actions\/checkout@/i.test(uses)) {
      const w = isObj(s.with) ? s.with : {};
      if (Object.keys(w).some((k) => k !== 'persist-credentials')) {
        out.push(
          v(
            file,
            sw(i),
            `${E2E_STAGING_JOB} may only set persist-credentials on its checkout (it tests the deployed commit)`,
          ),
        );
      }
    }
    // Only the preflight and Playwright steps set env:, each exactly its contract.
    if (s.env !== undefined && !preflights.includes(i) && !playwrights.includes(i)) {
      out.push(
        v(
          file,
          sw(i),
          `${E2E_STAGING_JOB} may only set env: on the preflight and Playwright steps`,
        ),
      );
    }
  });

  const pwOk =
    playwrights.length === 1 &&
    E2E_STAGING_RUN_RE.test(runOf(steps[playwrights[0]])) &&
    steps[playwrights[0]].if === undefined;
  if (!pwOk) {
    out.push(
      v(
        file,
        where,
        `${E2E_STAGING_JOB} must run exactly ${E2E_STAGING_RUN_CMD} in one step with no if:`,
      ),
    );
  } else if (!sameEnv(steps[playwrights[0]].env, E2E_STAGING_PLAYWRIGHT_ENV)) {
    out.push(
      v(
        file,
        sw(playwrights[0]),
        'env: must be exactly the Playwright contract (E2E_STAGING_PLAYWRIGHT_ENV in scripts/check-workflows.mjs: the staging flag, the public values and the six credentials)',
      ),
    );
  }
  const pw = playwrights.length === 1 ? playwrights[0] : -1;
  const pfOk =
    preflights.length === 1 &&
    runOf(steps[preflights[0]]).trim() === E2E_STAGING_PREFLIGHT_CMD &&
    steps[preflights[0]].if === undefined &&
    (pw < 0 || preflights[0] < pw);
  if (!pfOk) {
    out.push(
      v(
        file,
        where,
        `${E2E_STAGING_JOB} must run exactly ${E2E_STAGING_PREFLIGHT_CMD} in one step with no if:, before the Playwright step`,
      ),
    );
  }
  if (preflights.length === 1 && !sameEnv(steps[preflights[0]].env, E2E_STAGING_PREFLIGHT_ENV)) {
    out.push(
      v(
        file,
        sw(preflights[0]),
        'env: must be exactly the public preflight contract (E2E_STAGING_PREFLIGHT_ENV in scripts/check-workflows.mjs; no secret)',
      ),
    );
  }

  const upload = uploads.length === 1 ? steps[uploads[0]] : null;
  const w = upload !== null && isObj(upload.with) ? upload.with : {};
  const paths = artifactPaths(w);
  const days = w['retention-days'];
  const uploadOk =
    upload !== null &&
    normExpr(upload.if ?? '') === 'always()' &&
    pw >= 0 &&
    uploads[0] > pw &&
    Object.keys(w).every((k) => ['name', 'path', 'retention-days'].includes(k)) &&
    JSON.stringify(paths) === JSON.stringify(E2E_STAGING_ARTIFACT_PATHS) &&
    typeof days === 'number' &&
    Number.isInteger(days) &&
    days >= 1 &&
    days <= E2E_ARTIFACT_MAX_DAYS;
  if (!uploadOk) {
    out.push(
      v(
        file,
        uploads.length === 1 ? sw(uploads[0]) : where,
        `${E2E_STAGING_JOB} must upload exactly e2e/test-results without trace.zip (path: ${E2E_STAGING_ARTIFACT_PATHS.join(' then ')}; retention-days 1 to ${E2E_ARTIFACT_MAX_DAYS}; only name, path and retention-days), in one step with if: always(), after the Playwright step (synthetic data only; d1 bindings review F8: never a trace)`,
      ),
    );
  }
}

/**
 * E2E_STAGING_ONLY_ENV names: set only in the env: of the e2e-staging preflight and Playwright steps
 * (whose exact values checkE2eStaging pins). Anywhere else (workflow or job env, any other step, any
 * other job) they could hand the staging contract or a credential to another command.
 */
function checkE2eStagingOnlyEnv(doc, file, out) {
  const misplaced = (env, where) => {
    if (!isObj(env)) return;
    for (const n of E2E_STAGING_ONLY_ENV) {
      if (Object.hasOwn(env, n))
        out.push(
          v(
            file,
            where,
            `${n} may be set only on the ${E2E_STAGING_JOB} preflight and Playwright steps (d1 §7.1)`,
          ),
        );
    }
  };
  misplaced(doc.env, 'env');
  for (const [name, job] of Object.entries(isObj(doc.jobs) ? doc.jobs : {})) {
    if (!isObj(job)) continue;
    const where = `jobs.${name}`;
    misplaced(job.env, where);
    (Array.isArray(job.steps) ? job.steps : []).forEach((step, i) => {
      if (!isObj(step)) return;
      const run = typeof step.run === 'string' ? step.run : '';
      const own =
        name === E2E_STAGING_JOB &&
        (/e2e:staging:preflight/.test(run) || /playwright\s+test/.test(run));
      if (!own) misplaced(step.env, `${where}.steps[${i}]`);
    });
  }
}

/** One Worker deploy step: --env staging, and exactly the --var set `spec.vars`, each from its source. */
function checkWorkerDeploy(step, sw, spec, file, out) {
  const text = joinContinuations(step.run);
  // S2: the whole run text is pinned (the prefix, then the one scanned deploy line), and no word
  // that moves the step to another directory, config or wrangler copy may appear in it.
  const ls = commandLines(step.run);
  const pinned =
    ls.length === WORKER_DEPLOY_STEP_PREFIX.length + 1 &&
    WORKER_DEPLOY_STEP_PREFIX.every((l, k) => ls[k] === l) &&
    SCANNED_DEPLOY_LINE.test(ls[ls.length - 1]);
  if (!pinned) {
    out.push(
      v(
        file,
        sw,
        `a Worker deploy step must run exactly: ${WORKER_DEPLOY_STEP_PREFIX.join('; ')}; then ${WORKER_DEPLOY_CMD} with its --var set, and nothing else (S2)`,
      ),
    );
  }
  for (const [word, re] of WORKER_DEPLOY_FORBIDDEN) {
    if (re.test(text)) out.push(v(file, sw, `${word} is not allowed in a Worker deploy step (S2)`));
  }
  if (!/(?<![\w-])--env\s+staging(?![\w-])/.test(text)) {
    out.push(v(file, sw, `wrangler deploy must use --env staging (${spec.dir})`));
  }
  const found = [...text.matchAll(/--var\s+"([A-Z][A-Z0-9_]*):([^"]*)"/g)].map((m) => [m[1], m[2]]);
  if ((text.match(/--var\b/g) ?? []).length !== found.length) {
    out.push(
      v(file, sw, 'every --var must be written --var "NAME:$SOURCE" (quoted, no other form)'),
    );
  }
  const seen = new Set();
  for (const [name, value] of found) {
    const source = spec.vars[name];
    if (source === undefined) {
      out.push(v(file, sw, `--var ${name} is not allowed on ${spec.dir}`));
    } else if (seen.has(name)) {
      out.push(v(file, sw, `--var ${name} is given twice`));
    } else if (value !== `$${source}`) {
      out.push(v(file, sw, `--var ${name} must be "${name}:$${source}"`));
    }
    seen.add(name);
  }
  const env = isObj(step.env) ? step.env : {};
  for (const [name, source] of Object.entries(spec.vars)) {
    if (!seen.has(name)) out.push(v(file, sw, `--var ${name} is missing on ${spec.dir}`));
    else if (source !== 'GITHUB_SHA' && !Object.hasOwn(env, source)) {
      out.push(
        v(file, sw, `the step uses $${source} for --var ${name} but does not set it in env:`),
      );
    }
  }
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
    for (const n of E2E_STAGING_ONLY_ENV) {
      if (Object.hasOwn(s.env, n))
        out.push(
          v(
            file,
            `runs.steps[${i}]`,
            `${n} may be set only on the ${E2E_STAGING_JOB} preflight and Playwright steps (d1 §7.1)`,
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
